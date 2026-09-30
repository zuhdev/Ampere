/**
 * @ampere/sdk — drop-in gasless transactions for BOT Chain.
 *
 *   const ampere = new Ampere({ appKey: process.env.AMPERE_KEY });
 *   await ampere.simulate({ to, data });   // "would sponsor?"
 *   await ampere.execute({ to, data });    // relayed; returns tx hash
 *   await ampere.usage();                  // budget + per-address spend
 *
 * Users and agents never need BOT for gas. Ampere pays; the app's policy
 * (allowlist / caps / budget) is enforced on-chain.
 */
export interface AmpereOptions {
  appKey: string;
  /** Ampere API base URL. Defaults to http://localhost:8787 (dev). */
  apiUrl?: string;
  /** Extra headers (e.g. auth for your own backend proxying Ampere). */
  headers?: Record<string, string>;
  fetchFn?: typeof fetch;
}

export interface CallIntent {
  to: `0x${string}`;
  data: `0x${string}`;
  value?: string; // wei as decimal string
  beneficiary?: `0x${string}`; // defaults to `to`
  gasBudget?: string; // wei as decimal string
}

export interface SimulateResult {
  sponsorable: boolean;
  policyPaused: boolean;
  gasCost: string;
  gasPriceGwei: number;
  budgetRemaining: string;
}

export interface ExecuteResult {
  tx: `0x${string}`;
  status: "success" | "failed";
  gasUsed: string;
  explorer: string;
}

export interface UsageResult {
  relayed: number;
  failed: number;
  budgetUsed: string;
  budgetRemaining: string;
  perAddress: Record<string, string>;
}

export class AmpereError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(message);
    this.name = "AmpereError";
  }
}

export class Ampere {
  private readonly appKey: string;
  private readonly apiUrl: string;
  private readonly headers: Record<string, string>;
  private readonly fetchFn: typeof fetch;

  constructor(opts: AmpereOptions) {
    if (!opts.appKey) throw new Error("Ampere: appKey is required");
    this.appKey = opts.appKey;
    this.apiUrl = (opts.apiUrl ?? "http://localhost:8787").replace(/\/$/, "");
    this.headers = { "Content-Type": "application/json", ...opts.headers };
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  /** "Would this be sponsored?" — policy check + budget, no tx sent. */
  async simulate(intent: CallIntent): Promise<SimulateResult> {
    return this.post<SimulateResult>(`/v1/sponsors/${this.appKey}/simulate`, intent);
  }

  /** Relay the call — Ampere pays gas, returns the tx hash. */
  async execute(intent: CallIntent): Promise<ExecuteResult> {
    return this.post<ExecuteResult>(`/v1/sponsors/${this.appKey}/relay`, intent);
  }

  /** Budget + per-address spend for this appKey. */
  async usage(): Promise<UsageResult> {
    const res = await this.fetchFn(`${this.apiUrl}/v1/sponsors/${this.appKey}/usage`, {
      headers: this.headers,
    });
    return this.handle<UsageResult>(res);
  }

  /** Recent relays (tx, status, gasUsed). */
  async recentTx(): Promise<{ recentTx: ExecuteResult[] }> {
    const res = await this.fetchFn(`${this.apiUrl}/v1/sponsors/${this.appKey}/tx`, {
      headers: this.headers,
    });
    return this.handle<{ recentTx: ExecuteResult[] }>(res);
  }

  /** Convenience: ERC-20 transfer calldata (e.g. "send 1 USDT with 0 BOT"). */
  static erc20Transfer(
    token: `0x${string}`,
    to: `0x${string}`,
    amount: bigint
  ): `0x${string}` {
    const selector = "a9059cbb"; // transfer(address,uint256)
    const enc = (v: bigint | string) =>
      (typeof v === "string" ? BigInt(v) : v).toString(16).padStart(64, "0");
    return ("0x" + selector + enc(to) + enc(amount)) as `0x${string}`;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await this.fetchFn(`${this.apiUrl}${path}`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
    });
    return this.handle<T>(res);
  }

  private async handle<T>(res: Response): Promise<T> {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new AmpereError(
        `Ampere request failed (${res.status}): ${JSON.stringify(body)}`,
        res.status,
        body
      );
    }
    return body as T;
  }
}

export default Ampere;
