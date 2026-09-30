/**
 * Ampere relay — standalone relay worker + heartbeat.
 *
 * The API (api/) calls into this module's relayWithRetry for /relay; when run
 * directly (`npm start`), it performs a self-check and emits a heartbeat every
 * HEARTBEAT_SECONDS with relayed / failed / gas spent / budget remaining.
 *
 * Runs as a Windows Scheduled Task (run-keeper.ps1 + install-keeper-task.ps1)
 * or a systemd unit; the supervisor restarts it on crash.
 */
import { publicClient, relayerAddress, currentGasPrice, budgetOf } from "./client.js";
import { HEARTBEAT_SECONDS, REGISTRY_ADDRESS, VAULT_ADDRESS, PAYMASTER_ADDRESS } from "./config.js";
import { state, reload } from "./health.js";
import { keccak256, toHex } from "viem";

// counters live in health.ts (persisted to relay/relay-state.json) so relays driven
// by the API in another process update the numbers this heartbeat prints;
// re-exported here to keep the module's public surface unchanged.
export { state, recordRelay } from "./health.js";

// must equal ethers.id("ampere.demo") used by contracts scripts — {size:32} right-pads
// the string hex before hashing and produced a DIFFERENT key (budget read as 0).
export const DEMO_APP_KEY = keccak256(toHex("ampere.demo")) as `0x${string}`;

async function heartbeat(): Promise<void> {
  reload(); // pick up relays recorded by the API process
  const [balance, gasPrice] = await Promise.all([
    publicClient.getBalance({ address: relayerAddress }),
    currentGasPrice(),
  ]);
  const budget = await budgetOf(DEMO_APP_KEY).catch(() => 0n);
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "heartbeat",
      relayed: state.relayed,
      failed: state.failed,
      gasUsedUnits: Number(state.gasUsedUnits),
      gasSpentBot: Number(state.gasSpentWei) / 1e18,
      budgetRemainingBot: Number(budget) / 1e18,
      relayerBalanceBot: Number(balance) / 1e18,
      gasPriceGwei: Number(gasPrice) / 1e9,
      uptimeSec: Math.floor((Date.now() - state.startedAt) / 1000),
    })
  );
}

async function selfCheck(): Promise<void> {
  console.log(`relayer: ${relayerAddress}`);
  console.log(`registry: ${REGISTRY_ADDRESS}`);
  console.log(`vault: ${VAULT_ADDRESS}`);
  console.log(`paymaster: ${PAYMASTER_ADDRESS}`);
  const code = await publicClient.getBytecode({ address: PAYMASTER_ADDRESS as `0x${string}` });
  if (!code || code === "0x") throw new Error("paymaster has no code — wrong address or RPC?");

  const [blockNumber, gasPrice] = await Promise.all([
    publicClient.getBlockNumber(),
    currentGasPrice(),
  ]);
  console.log(`chain ok: block=${blockNumber} gasPrice=${Number(gasPrice) / 1e9} gwei`);
}

async function main(): Promise<void> {
  await selfCheck();
  console.log(`heartbeat every ${HEARTBEAT_SECONDS}s`);
  await heartbeat();
  setInterval(() => heartbeat().catch((e) => console.error("heartbeat failed:", e)), HEARTBEAT_SECONDS * 1000);

  // Keep the process alive; relaying is driven by the API (or a future queue).
  setInterval(() => undefined, 1 << 30);
}

// Run standalone (`npm start`); when imported by the API, only the exports apply.
// (normalize separators — win32 argv uses backslashes, so the forward-slash match never hit)
const invokedDirectly = (process.argv[1] ?? "").replace(/\\/g, "/").includes("relay/src/index");
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
