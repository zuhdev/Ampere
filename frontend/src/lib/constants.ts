import { botChain, IS_MAINNET } from "../wagmi";

/** Contract addresses — read from Vite env (frontend/.env, see .env.example). */
export const REGISTRY = (import.meta.env.VITE_REGISTRY ?? "") as `0x${string}`;
export const VAULT = (import.meta.env.VITE_VAULT ?? "") as `0x${string}`;
export const PAYMASTER = (import.meta.env.VITE_PAYMASTER ?? "") as `0x${string}`;
export const COUNTER = (import.meta.env.VITE_COUNTER ?? "") as `0x${string}`;

/** Demo appKey shown in the dashboard (init.ts sets this on-chain). */
const ZERO_APP_KEY = ("0x" + "0".repeat(64)) as `0x${string}`;
export const DEMO_APP_KEY =
  (import.meta.env.VITE_APP_KEY as `0x${string}` | undefined) ?? ZERO_APP_KEY;

export const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:8787") as string;

/** BOT Chain explorer for the selected network */
export const EXPLORER = botChain.blockExplorers?.default.url ?? "https://scan.bohr.life";

/** BOT Chain gas quirk: eth_gasPrice is a flat 20 gwei on both nets; feeHistory is broken. */
export const DEFAULT_GAS_PRICE_WEI = 20n * 10n ** 9n;

/** Official BOT Chain links (footer). Faucet is testnet-only. */
export const BOT_LINKS = {
  website: IS_MAINNET ? "https://www.botchain.ai/" : "https://www.bohr.life/en",
  explorer: EXPLORER,
  docs: IS_MAINNET ? "https://dev-docs.botchain.ai/" : "https://dev-docs.bohr.life/",
  faucet: "https://faucet.bohr.life/", // test tokens only — no faucet on mainnet
  github: "https://github.com/BOTChain-bot",
} as const;

export const explorerTx = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const explorerAddress = (addr: string) => `${EXPLORER}/address/${addr}`;

export type Tab = "dashboard" | "policy" | "playground";
