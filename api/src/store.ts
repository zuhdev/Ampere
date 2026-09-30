/**
 * Policy + usage store.
 *
 * Policies are stored ON-CHAIN (SponsorPolicyRegistry — source of truth for
 * enforcement) and mirrored here for the hot path (fast simulate/usage reads
 * without an RPC roundtrip). Redis is the production mirror (REDIS_URL);
 * this in-process map is the fallback for dev/test.
 */
import { createHash, randomBytes } from "node:crypto";

export interface PolicyJson {
  allowlist: string[];
  blocklist: string[];
  perAddressCap: string; // decimal BOT
  dailyBudget: string; // decimal BOT
  expiresAt: string | null; // ISO date or null
  paused: boolean;
}

export interface SponsorRecord {
  appKey: string;
  owner: string; // api key hash — owner auth
  policy: PolicyJson;
  createdAt: string;
  usage: {
    relayed: number;
    failed: number;
    budgetUsedWei: string;
    perAddress: Record<string, string>; // addr → wei spent
  };
  recentTx: Array<{ tx: string; status: string; gasUsed: string; at: string }>;
}

export interface RateBucket {
  count: number;
  resetAt: number;
}

const sponsors = new Map<string, SponsorRecord>();
const rateBuckets = new Map<string, RateBucket>();

export function newAppKey(): string {
  return "0x" + createHash("sha256").update(randomBytes(32)).digest("hex");
}

export function hashKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

export function createSponsor(apiKeyHash: string, policy: PolicyJson, appKey = newAppKey()): SponsorRecord {
  const rec: SponsorRecord = {
    appKey,
    owner: apiKeyHash,
    policy,
    createdAt: new Date().toISOString(),
    usage: { relayed: 0, failed: 0, budgetUsedWei: "0", perAddress: {} },
    recentTx: [],
  };
  sponsors.set(appKey, rec);
  return rec;
}

export function getSponsor(appKey: string): SponsorRecord | undefined {
  return sponsors.get(appKey);
}

export function updatePolicy(appKey: string, policy: PolicyJson): SponsorRecord | undefined {
  const rec = sponsors.get(appKey);
  if (!rec) return undefined;
  rec.policy = policy;
  return rec;
}

export function authorize(appKey: string, apiKey: string): boolean {
  const rec = sponsors.get(appKey);
  if (!rec) return false;
  return rec.owner === hashKey(apiKey);
}

export function recordRelayResult(
  appKey: string,
  beneficiary: string,
  gasUsedWei: string,
  success: boolean,
  txHash: string
): void {
  const rec = sponsors.get(appKey);
  if (!rec) return;
  if (success) rec.usage.relayed += 1;
  else rec.usage.failed += 1;

  const prev = BigInt(rec.usage.budgetUsedWei);
  rec.usage.budgetUsedWei = (prev + BigInt(gasUsedWei)).toString();
  const addrPrev = BigInt(rec.usage.perAddress[beneficiary] ?? "0");
  rec.usage.perAddress[beneficiary] = (addrPrev + BigInt(gasUsedWei)).toString();

  rec.recentTx.unshift({ tx: txHash, status: success ? "success" : "failed", gasUsed: gasUsedWei, at: new Date().toISOString() });
  if (rec.recentTx.length > 50) rec.recentTx.pop();
}

// ---- rate limiting (per appKey) ----

export function rateLimit(appKey: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  let b = rateBuckets.get(appKey);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    rateBuckets.set(appKey, b);
  }
  b.count += 1;
  if (b.count > limit) {
    return { ok: false, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfterSec: 0 };
}
