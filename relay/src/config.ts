import "dotenv/config";

/**
 * BOT Chain TESTNET (968) only. Mainnet (677) is out of scope for v1.
 *
 * Chain quirks handled here:
 *  - eth_feeHistory is broken → we never use it; gasPrice comes from eth_gasPrice
 *    (20 gwei) and we ALWAYS send explicit gasPrice + gas.
 *  - eth_getLogs disabled on mainnet public RPC → not used; usage is read from
 *    SponsorPolicyRegistry state directly.
 */
// Chain id must match the RPC we point at (BOT testnet = 968; local fork = 31337).
// viem signs EIP-155 with this id — a mismatch makes eth_sendRawTransaction fail.
export const CHAIN_ID = Number(process.env.BOT_TESTNET_CHAIN_ID ?? "968");
export const RPC_URL = process.env.BOT_TESTNET_RPC_URL ?? "https://rpc.bohr.life";
export const DEFAULT_GAS_PRICE_WEI = 20n * 10n ** 9n; // 20 gwei
export const DEFAULT_GAS_LIMIT = 500_000n;

export const RELAY_PRIVATE_KEY = required("RELAY_PRIVATE_KEY");
export const REGISTRY_ADDRESS = required("REGISTRY_ADDRESS");
export const VAULT_ADDRESS = required("VAULT_ADDRESS");
export const PAYMASTER_ADDRESS = required("PAYMASTER_ADDRESS");
export const HEARTBEAT_SECONDS = Number(process.env.HEARTBEAT_SECONDS ?? "60");
export const PORT = Number(process.env.PORT ?? "8788");

export const MAX_ATTEMPTS = 3;
export const BACKOFF_MS = [1_000, 2_000, 4_000]; // 1s → 2s → 4s

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}
