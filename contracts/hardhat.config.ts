import dotenv from "dotenv";
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

dotenv.config();

// BOT Chain quirks (both testnet 968 and mainnet 677, see README):
// - eth_feeHistory is broken (rejects "latest", baseFeePerGas = 0x0); always set
//   gasPrice explicitly (eth_gasPrice returns 20 gwei on both nets). Never rely on fee estimation.
const DEFAULT_GAS_PRICE_GWEI = "20";
const DEFAULT_GAS_LIMIT = "3000000";

const deployerKey = process.env.DEPLOYER_PRIVATE_KEY ?? "";
// Mainnet can use a dedicated signer; falls back to DEPLOYER_PRIVATE_KEY.
const mainnetDeployerKey = process.env.MAINNET_DEPLOYER_PRIVATE_KEY || deployerKey;
const testnetRpcUrl = process.env.BOT_TESTNET_RPC_URL ?? "https://rpc.bohr.life";
const mainnetRpcUrl = process.env.BOT_MAINNET_RPC_URL ?? "https://rpc.botchain.ai";
const testnetExplorerApi = process.env.BOT_EXPLORER_API_URL ?? "https://scan.bohr.life/api";
const mainnetExplorerApi = process.env.BOT_MAINNET_EXPLORER_API_URL ?? "https://scan.botchain.ai/api";

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
      url: testnetRpcUrl,
      accounts: deployerKey ? [deployerKey] : [],
      gasPrice: parseInt(DEFAULT_GAS_PRICE_GWEI, 10) * 1_000_000_000,
      gas: parseInt(DEFAULT_GAS_LIMIT, 10),
    },
    botMainnet: {
      chainId: 677,
      url: mainnetRpcUrl,
      accounts: mainnetDeployerKey ? [mainnetDeployerKey] : [],
      gasPrice: parseInt(DEFAULT_GAS_PRICE_GWEI, 10) * 1_000_000_000,
      gas: parseInt(DEFAULT_GAS_LIMIT, 10),
    },
  },
  etherscan: {
    apiKey: {
      botTestnet: process.env.ETHERSCAN_API_KEY ?? "",
      botMainnet: process.env.ETHERSCAN_API_KEY ?? "",
    },
    customChains: [
      {
        network: "botTestnet",
        chainId: 968,
        urls: {
          apiURL: testnetExplorerApi,
          browserURL: "https://scan.bohr.life",
        },
      },
      {
        network: "botMainnet",
        chainId: 677,
        urls: {
          apiURL: mainnetExplorerApi,
          browserURL: "https://scan.botchain.ai",
        },
      },
    ],
  },
};

export default config;
