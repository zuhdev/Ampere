/**
 * Relay heartbeat counters — shared between the standalone runner (relay/src/index.ts)
 * and the relay path (relay/src/client.ts).
 *
 * Two processes are involved: the API drives relays, the standalone runner prints
 * the heartbeat. In-memory counters are per-process and would always read zero in
 * the other one, so totals are persisted to relay/relay-state.json (next to this
 * file, so both processes resolve the same path regardless of cwd).
 *
 * Semantics: cumulative lifetime totals — they survive restarts. `uptimeSec` in the
 * heartbeat stays per-process. Writes are last-writer-wins (the API is the only
 * writer today; a second writer would only lose a concurrent increment).
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const STATE_FILE =
  process.env.RELAY_STATE_FILE ?? join(dirname(fileURLToPath(import.meta.url)), "..", "relay-state.json");

export interface HeartbeatState {
  /** Relays that got a receipt with status success. */
  relayed: number;
  /** Relays that reverted on-chain, reverted deterministically, or exhausted retries. */
  failed: number;
  /** gasUsed × gasPrice actually consumed by those relays. */
  gasSpentWei: bigint;
  /** Raw gas units consumed (fee-agnostic). */
  gasUsedUnits: bigint;
  startedAt: number;
}

export const state: HeartbeatState = {
  relayed: 0,
  failed: 0,
  gasSpentWei: 0n,
  gasUsedUnits: 0n,
  startedAt: Date.now(),
};

interface PersistedState {
  relayed: number;
  failed: number;
  gasSpentWei: string;
  gasUsedUnits: string;
}

function readPersisted(): PersistedState | null {
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    if (typeof parsed?.relayed !== "number" || typeof parsed?.failed !== "number") return null;
    return parsed;
  } catch {
    return null; // first run, or a torn read by a concurrent writer
  }
}

function persist(): void {
  try {
    const payload: PersistedState = {
      relayed: state.relayed,
      failed: state.failed,
      gasSpentWei: state.gasSpentWei.toString(),
      gasUsedUnits: state.gasUsedUnits.toString(),
    };
    const tmp = `${STATE_FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(payload));
    renameSync(tmp, STATE_FILE); // atomic swap — readers never see a half-written file
  } catch (err) {
    console.error("relay state persist failed:", err);
  }
}

/** Adopt persisted totals (heartbeat reads these each tick; also runs at module load). */
export function reload(): void {
  const persisted = readPersisted();
  if (!persisted) return;
  state.relayed = persisted.relayed;
  state.failed = persisted.failed;
  state.gasSpentWei = BigInt(persisted.gasSpentWei ?? "0");
  state.gasUsedUnits = BigInt(persisted.gasUsedUnits ?? "0");
}

reload(); // a restarted process resumes the lifetime totals

/**
 * Record one relay outcome. Called by relayWithRetry — relays driven by the API
 * update the same counters the standalone runner reports.
 *
 * @param gasUsed     gas from the receipt; 0 when no receipt was obtained
 *                    (deterministic revert at send / retries exhausted)
 * @param gasPriceWei price the tx actually paid; pass 0 when unknown
 */
export function recordRelay(gasUsed: bigint, success: boolean, gasPriceWei: bigint = 0n): void {
  if (success) state.relayed += 1;
  else state.failed += 1;
  state.gasUsedUnits += gasUsed;
  state.gasSpentWei += gasUsed * gasPriceWei;
  persist();
}
