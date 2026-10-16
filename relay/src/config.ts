import "dotenv/config";

/**
 * BOT Chain — testnet (968) or mainnet (677), selected by AMPERE_NETWORK
 * (default "testnet" so existing .env files keep working unchanged).
 *
 * Chain quirks handled here (both nets):
 *  - eth_feeHistory is broken → we never use it; gasPrice comes from eth_gasPrice
 *    (20 gwei) and we ALWAYS send explicit gasPrice + gas.
 *  - eth_getLogs disabled on the mainnet public RPC → not used; usage is read from
 *    SponsorPolicyRegistry state directly.
 */
export type AmpereNetwork = "testnet" | "mainnet";

const NETWORK_RAW = (process.env.AMPERE_NETWORK ?? "testnet").trim().toLowerCase();
if (NETWORK_RAW !== "testnet" && NETWORK_RAW !== "mainnet") {
  throw new Error(`AMPERE_NETWORK must be "testnet" or "mainnet", got "${process.env.AMPERE_NETWORK}"`);
}
export const NETWORK: AmpereNetwork = NETWORK_RAW;

const PRESETS: Record<
  AmpereNetwork,
  { chainId: string; rpcUrl: string; explorerUrl: string; chainName: string }
> = {
  testnet: {
    chainId: "968",
    rpcUrl: "https://rpc.bohr.life",
    explorerUrl: "https://scan.bohr.life",
    chainName: "BOT Chain Testnet",
  },
  mainnet: {
    chainId: "677",
    rpcUrl: "https://rpc.botchain.ai",
    explorerUrl: "https://scan.botchain.ai",
    chainName: "BOT Chain Mainnet",
  },
};
const preset = PRESETS[NETWORK];

// Chain id must match the RPC we point at (testnet = 968, mainnet = 677; local fork = 31337).
// viem signs EIP-155 with this id — a mismatch makes eth_sendRawTransaction fail.
export const CHAIN_ID = Number(
  process.env[NETWORK === "mainnet" ? "BOT_MAINNET_CHAIN_ID" : "BOT_TESTNET_CHAIN_ID"] ?? preset.chainId
);
export const RPC_URL =
  process.env[NETWORK === "mainnet" ? "BOT_MAINNET_RPC_URL" : "BOT_TESTNET_RPC_URL"] ?? preset.rpcUrl;
export const EXPLORER_URL = preset.explorerUrl;
export const CHAIN_NAME = preset.chainName;
export const DEFAULT_GAS_PRICE_WEI = 20n * 10n ** 9n; // 20 gwei (eth_gasPrice on both nets)
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
