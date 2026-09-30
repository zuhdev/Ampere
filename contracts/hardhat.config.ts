import dotenv from "dotenv";
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

dotenv.config();

// BOT Chain quirks (see README):
// - eth_feeHistory is broken (rejects "latest", baseFeePerGas = 0x0); always set
//   gasPrice explicitly (eth_gasPrice returns 20 gwei). Never rely on fee estimation.
const DEFAULT_GAS_PRICE_GWEI = "20";
const DEFAULT_GAS_LIMIT = "3000000";

const deployerKey = process.env.DEPLOYER_PRIVATE_KEY ?? "";
const rpcUrl = process.env.BOT_TESTNET_RPC_URL ?? "https://rpc.bohr.life";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "paris",
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    localhost: {
      chainId: 31337,
      url: process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545",
    },
    botTestnet: {
      chainId: 968,
      url: rpcUrl,
      accounts: deployerKey ? [deployerKey] : [],
      gasPrice: parseInt(DEFAULT_GAS_PRICE_GWEI, 10) * 1_000_000_000,
      gas: parseInt(DEFAULT_GAS_LIMIT, 10),
    },
  },
  etherscan: {
    apiKey: {
      botTestnet: process.env.ETHERSCAN_API_KEY ?? "",
    },
    customChains: [
      {
        network: "botTestnet",
        chainId: 968,
        urls: {
          apiURL: process.env.BOT_EXPLORER_API_URL ?? "https://scan.bohr.life/api",
          browserURL: "https://scan.bohr.life",
        },
      },
    ],
  },
};

export default config;
