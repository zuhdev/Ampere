import { createConfig, http } from "wagmi";
import { defineChain } from "viem";

/** Network selection: VITE_NETWORK=testnet|mainnet (default testnet). */
export const IS_MAINNET = (import.meta.env.VITE_NETWORK ?? "testnet") === "mainnet";

const TESTNET_RPC = "https://rpc.bohr.life";
const MAINNET_RPC = "https://rpc.botchain.ai";

/** BOT Chain — feeHistory broken; wallets may show "unavailable gas fees". */
const testnetChain = defineChain({
  id: 968,
  name: "BOT Chain Testnet",
  nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
  rpcUrls: { default: { http: [import.meta.env.VITE_RPC_URL ?? TESTNET_RPC] } },
  blockExplorers: { default: { name: "scan", url: "https://scan.bohr.life" } },
});

const mainnetChain = defineChain({
  id: 677,
  name: "BOT Chain Mainnet",
  nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
  rpcUrls: { default: { http: [import.meta.env.VITE_RPC_URL ?? MAINNET_RPC] } },
  blockExplorers: { default: { name: "scan", url: "https://scan.botchain.ai" } },
});

export const botChain = IS_MAINNET ? mainnetChain : testnetChain;
export const CHAIN_ID = botChain.id;
export const CHAIN_NAME = botChain.name;

export const wagmiConfig = createConfig({
  chains: [botChain],
  transports: {
    [testnetChain.id]: http(import.meta.env.VITE_RPC_URL ?? TESTNET_RPC),
    [mainnetChain.id]: http(import.meta.env.VITE_RPC_URL ?? MAINNET_RPC),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
