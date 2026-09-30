import { createConfig, http } from "wagmi";
import { defineChain } from "viem";

/** BOT Chain testnet — feeHistory broken; wallets may show "unavailable gas fees". */
export const botTestnet = defineChain({
  id: 968,
  name: "BOT Chain Testnet",
  nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
  rpcUrls: {
    default: {
      http: [import.meta.env.VITE_RPC_URL ?? "https://rpc.bohr.life"],
    },
  },
  blockExplorers: {
    default: { name: "scan", url: "https://scan.bohr.life" },
  },
});

export const wagmiConfig = createConfig({
  chains: [botTestnet],
  transports: {
    [botTestnet.id]: http(import.meta.env.VITE_RPC_URL ?? "https://rpc.bohr.life"),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
