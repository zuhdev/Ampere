/**
 * Ampere API — policy CRUD, simulate, relay, usage.
 *
 * Endpoints (v1):
 *   POST   /v1/sponsors                 → create appKey + policy (owner-auth);
 *                                          pushes setPolicy + optional deposit ON-CHAIN
 *   PATCH  /v1/sponsors/:appKey         → update policy (pushed on-chain first)
 *   POST   /v1/sponsors/:appKey/simulate → { sponsorable, gasCost, budgetRemaining }
 *   POST   /v1/sponsors/:appKey/relay   → relayed tx (rate-limited per appKey)
 *   GET    /v1/sponsors/:appKey/usage   → { relayed, failed, budgetUsed, perAddress[] }
 *   GET    /v1/sponsors/:appKey/tx      → recent relays
 *
 * Security: policy enforcement is ON-CHAIN (registry.isSponsorable). This API is
 * convenience + telemetry; a compromised API cannot bypass on-chain caps.
 */
import "dotenv/config";
import express, { type Request, type Response, type NextFunction } from "express";
import { type Address, type Hex, parseEther, formatEther } from "viem";
import {
  relayWithRetry,
  isSponsorable,
  budgetOf,
  currentGasPrice,
  publicClient,
  setPolicy,
  depositNative,
  readPolicy,
  NETWORK,
  CHAIN_ID,
  CHAIN_NAME,
  EXPLORER_URL,
  type PolicyOnChain,
} from "@ampere/relay/client";
import {
  createSponsor,
  getSponsor,
  updatePolicy,
  authorize,
  hashKey,
  newAppKey,
  recordRelayResult,
  rateLimit,
  type PolicyJson,
} from "./store.js";

const app = express();
app.use(express.json());

// CORS: the dashboard (Vite dev server, e.g. :5174) is cross-origin from :8787.
// Auth is a header key — no cookies — so a wildcard origin is safe; set
// API_ALLOWED_ORIGINS to a comma-separated list to restrict it (origin is echoed).
const ALLOWED_ORIGINS = (process.env.API_ALLOWED_ORIGINS ?? "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.header("Origin");
  const allow =
    ALLOWED_ORIGINS.includes("*")
      ? "*"
      : origin && ALLOWED_ORIGINS.includes(origin)
        ? origin
        : ALLOWED_ORIGINS[0];
  res.setHeader("Access-Control-Allow-Origin", allow);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-ampere-key");
  res.setHeader("Access-Control-Max-Age", "600");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

const PORT = Number(process.env.PORT ?? "8787");
const OWNER_KEY = process.env.AMPERE_OWNER_KEY ?? "dev-owner-key"; // bootstrap; rotate in prod
const RELAY_RATE_LIMIT = Number(process.env.RELAY_RATE_LIMIT ?? "30"); // per appKey / min

// Relay cost upper bound (eth_estimateGas is unreliable on BOT Chain). The paymaster
// charges the measured cost and reverts GasBudgetExceeded if it exceeds the
// authorized `gasBudget`, so authorization must cover this bound × gas price.
const EST_RELAY_GAS = 350_000n;

// ---------- helpers ----------

function parsePolicy(body: any): PolicyJson | null {
  if (!body || typeof body !== "object") return null;
  const { allowlist, blocklist, perAddressCap, dailyBudget, expiresAt, paused } = body;
  if (!Array.isArray(allowlist)) return null;
  return {
    allowlist: allowlist.map(String),
    blocklist: Array.isArray(blocklist) ? blocklist.map(String) : [],
    perAddressCap: String(perAddressCap ?? "0.05"), // one relay ≈ 0.004–0.007 BOT @20 gwei
    dailyBudget: String(dailyBudget ?? "200"),
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    paused: Boolean(paused ?? false),
  };
}

function authOwner(req: Request, res: Response): boolean {
  const key = req.header("x-ampere-key");
  if (!key || key !== OWNER_KEY) {
    res.status(401).json({ error: "unauthorized: invalid x-ampere-key" });
    return false;
  }
  return true;
}

/** Mirror of the SponsorPolicy struct: decimal BOT strings → wei, ISO → unix seconds. */
function toOnChainPolicy(policy: PolicyJson): PolicyOnChain {
  return {
    allowlist: policy.allowlist as Address[],
    blocklist: policy.blocklist as Address[],
    perAddressCap: parseEther(policy.perAddressCap),
    dailyBudget: parseEther(policy.dailyBudget),
    expiresAt: policy.expiresAt ? BigInt(Math.floor(Date.parse(policy.expiresAt) / 1000)) : 0n,
    paused: policy.paused,
  };
}

function parseDepositBot(body: any): bigint | null {
  const raw = body?.depositBot;
  if (raw === undefined || raw === null || raw === "") return 0n;
  try {
    const wei = parseEther(String(raw));
    if (wei < 0n) throw new Error("negative");
    return wei;
  } catch {
    return null;
  }
}

const asyncH = (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

// ---------- health ----------

app.get("/v1/health", asyncH(async (_req, res) => {
  const block = await publicClient.getBlockNumber();
  const gasPrice = await currentGasPrice();
  res.json({ ok: true, chain: `bot-${NETWORK}-${CHAIN_ID}`, block: block.toString(), gasPriceGwei: Number(gasPrice) / 1e9 });
}));

// ---------- sponsors ----------

app.post("/v1/sponsors", asyncH(async (req, res) => {
  if (!authOwner(req, res)) return;
  const policy = parsePolicy(req.body?.policy);
  if (!policy) {
    res.status(400).json({ error: "body.policy must include allowlist[]" });
    return;
  }
  if (policy.allowlist.length === 0) {
    res.status(400).json({ error: "empty allowlist is deny-all — add at least one target" });
    return;
  }
  const depositWei = parseDepositBot(req.body);
  if (depositWei === null) {
    res.status(400).json({ error: "body.depositBot must be a decimal BOT amount" });
    return;
  }

  // Chain first, store second: a failed on-chain registration must not leave a
  // store record that looks usable but has no policy (relay would fail anyway).
  const appKey = newAppKey();
  const onchain: Record<string, string> = {};
  try {
    onchain.setPolicy = await setPolicy(appKey as Hex, toOnChainPolicy(policy));
    if (depositWei > 0n) onchain.deposit = await depositNative(appKey as Hex, depositWei);
  } catch (err: any) {
    res.status(502).json({
      error: "on-chain registration failed (no sponsor created)",
      detail: String(err?.message ?? err),
      onchain,
    });
    return;
  }

  // owner must be hashed the same way authorize() verifies it (sha256, no 0x prefix)
  const rec = createSponsor(hashKey(OWNER_KEY), policy, appKey);
  res.status(201).json({
    appKey: rec.appKey,
    policy: rec.policy,
    onchain: { ...onchain, depositWei: depositWei.toString() },
  });
}));

app.patch("/v1/sponsors/:appKey", asyncH(async (req, res) => {
  const apiKey = req.header("x-ampere-key") ?? "";
  const appKey = req.params.appKey;
  if (!authorize(appKey, apiKey)) {
    res.status(403).json({ error: "forbidden: not policy owner" });
    return;
  }
  const policy = parsePolicy(req.body?.policy);
  if (!policy) {
    res.status(400).json({ error: "body.policy invalid" });
    return;
  }
  if (!getSponsor(appKey)) {
    res.status(404).json({ error: "appKey not found" });
    return;
  }
  // chain first — if the relayer is not the on-chain policy owner, store it unchanged
  try {
    await setPolicy(appKey as Hex, toOnChainPolicy(policy));
  } catch (err: any) {
    res.status(502).json({ error: "on-chain setPolicy failed (store unchanged)", detail: String(err?.message ?? err) });
    return;
  }
  const rec = updatePolicy(appKey, policy);
  if (!rec) {
    res.status(404).json({ error: "appKey not found" });
    return;
  }
  res.json({ appKey, policy: rec.policy });
}));

// ---------- simulate ----------

app.post("/v1/sponsors/:appKey/simulate", asyncH(async (req, res) => {
  const appKey = req.params.appKey as Hex;
  const { to, data, value } = req.body ?? {};
  if (!to || !data) {
    res.status(400).json({ error: "body requires to, data" });
    return;
  }
  const rec = getSponsor(req.params.appKey);
  if (!rec) {
    res.status(404).json({ error: "appKey not found" });
    return;
  }

  const gasPrice = await currentGasPrice();
  const gasBudget = EST_RELAY_GAS * gasPrice; // same authorization the relay endpoint uses
  const beneficiary = (req.body?.beneficiary as Address) ?? (to as Address);

  const [onChainOk, remaining] = await Promise.all([
    isSponsorable(appKey, to as Address, beneficiary, gasBudget),
    budgetOf(appKey),
  ]);

  const estGasCost = gasBudget;
  res.json({
    sponsorable: onChainOk && remaining > estGasCost,
    policyPaused: rec.policy.paused,
    gasCost: estGasCost.toString(),
    gasPriceGwei: Number(gasPrice) / 1e9,
    budgetRemaining: remaining.toString(),
  });
}));

// ---------- relay ----------

app.post("/v1/sponsors/:appKey/relay", asyncH(async (req, res) => {
  const appKey = req.params.appKey;
  const { to, data, value, beneficiary, gasBudget } = req.body ?? {};
  if (!to || !data) {
    res.status(400).json({ error: "body requires to, data" });
    return;
  }

  const rl = rateLimit(appKey, RELAY_RATE_LIMIT, 60_000);
  if (!rl.ok) {
    res.set("Retry-After", String(rl.retryAfterSec));
    res.status(429).json({ error: "rate limited", retryAfterSec: rl.retryAfterSec });
    return;
  }

  const rec = getSponsor(appKey);
  if (!rec) {
    res.status(404).json({ error: "appKey not found" });
    return;
  }

  const ben = (beneficiary as Address) ?? (to as Address);
  const gasPrice = await currentGasPrice();
  const gasBudgetWei = gasBudget ? BigInt(gasBudget) : EST_RELAY_GAS * gasPrice;

  try {
    const result = await relayWithRetry({
      appKey: appKey as Hex,
      target: to as Address,
      beneficiary: ben,
      gasBudget: gasBudgetWei,
      data: data as Hex,
      value: value ? BigInt(value) : 0n,
    });

    const gasCostWei = (result.gasUsed * gasPrice).toString();
    recordRelayResult(appKey, ben, gasCostWei, result.success, result.txHash);

    res.json({
      tx: result.txHash,
      status: result.success ? "success" : "failed",
      gasUsed: result.gasUsed.toString(),
      explorer: `${EXPLORER_URL}/tx/${result.txHash}`,
    });
  } catch (err: any) {
    recordRelayResult(appKey, ben, "0", false, "");
    res.status(422).json({ error: "relay failed", detail: String(err?.message ?? err) });
  }
}));

// ---------- usage ----------

app.get("/v1/sponsors/:appKey/usage", asyncH(async (req, res) => {
  const rec = getSponsor(req.params.appKey);
  if (!rec) {
    res.status(404).json({ error: "appKey not found" });
    return;
  }
  const remaining = await budgetOf(req.params.appKey as Hex).catch(() => 0n);
  res.json({
    relayed: rec.usage.relayed,
    failed: rec.usage.failed,
    budgetUsed: rec.usage.budgetUsedWei,
    budgetRemaining: remaining.toString(),
    perAddress: rec.usage.perAddress,
  });
}));

app.get("/v1/sponsors/:appKey/tx", asyncH(async (req, res) => {
  const rec = getSponsor(req.params.appKey);
  if (!rec) {
    res.status(404).json({ error: "appKey not found" });
    return;
  }
  res.json({ recentTx: rec.recentTx });
}));

// ---------- errors ----------

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "internal", detail: err.message });
});

// ---------- sponsor seeding ----------

/**
 * The store is in-memory; a restart forgets sponsors that live on-chain (e.g. the
 * demo appKey created by contracts/scripts/init.ts). SEED_APP_KEY re-registers one
 * from its on-chain policy at startup so the dashboard/playground keep working.
 */
const SEED_APP_KEY = process.env.SEED_APP_KEY?.trim();

async function seedFromChain(appKey: string): Promise<void> {
  if (getSponsor(appKey)) return;
  const p = await readPolicy(appKey as Hex);
  const policy: PolicyJson = {
    allowlist: p.allowlist,
    blocklist: p.blocklist,
    perAddressCap: formatEther(p.perAddressCap),
    dailyBudget: formatEther(p.dailyBudget),
    expiresAt: p.expiresAt > 0n ? new Date(Number(p.expiresAt) * 1000).toISOString() : null,
    paused: p.paused,
  };
  createSponsor(hashKey(OWNER_KEY), policy, appKey);
  console.log(
    `seeded sponsor ${appKey} from on-chain policy (cap ${policy.perAddressCap} BOT, ${policy.allowlist.length} target(s))`
  );
}

(async () => {
  if (SEED_APP_KEY) {
    try {
      await seedFromChain(SEED_APP_KEY);
    } catch (err) {
      console.error("sponsor seed failed:", String((err as Error)?.message ?? err));
    }
  }
  app.listen(PORT, () => {
    console.log(`Ampere API listening on :${PORT} (${CHAIN_NAME} ${CHAIN_ID})`);
  });
})();
