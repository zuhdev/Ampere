/**
 * Nonce queue with lock — serializes transaction submission per relayer address
 * so bursts never collide on nonce. Pending txs are tracked so a replacement or
 * stuck tx can be detected before picking the next nonce.
 */
export class NonceQueue {
  private chainNonce: bigint | null = null;
  private pending: bigint[] = [];
  private lock: Promise<void> = Promise.resolve();

  /**
   * Run `fn` while holding the nonce lock. Each holder gets its OWN release
   * promise and resolves it in `finally` — assigning a fresh unresolved promise
   * to `this.lock` without ever resolving it deadlocked the 2nd caller forever.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const prev = this.lock;
    this.lock = new Promise<void>((r) => (release = r));
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /** Reserve the next free nonce (must be called under lock). */
  next(fresh?: bigint): bigint {
    if (fresh !== undefined) this.chainNonce = fresh;
    if (this.chainNonce === null) throw new Error("nonce not initialized");

    let candidate = this.chainNonce;
    while (this.pending.includes(candidate)) candidate += 1n;
    this.pending.push(candidate);
    return candidate;
  }

  /** Mark a nonce as resolved (tx mined or definitively dropped). */
  settle(nonce: bigint): void {
    this.pending = this.pending.filter((n) => n !== nonce);
    // advance the base nonce past settled txs
    if (this.chainNonce !== null && nonce >= this.chainNonce) {
      this.chainNonce = nonce + 1n;
    }
  }

  pendingCount(): number {
    return this.pending.length;
  }
}
