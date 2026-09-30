/**
 * Ampere init — post-deploy setup on BOT Chain testnet:
 *  1. fund the paymaster gas float
 *  2. fund the BudgetVault for the appKey
 *  3. set a default demo policy (allowlist: Counter)
 */
import dotenv from "dotenv";
import { ethers, network } from "hardhat";
import { loadDeployments } from "../deploy/deployments";

dotenv.config();

// Default demo appKey: keccak256("ampere.demo") — teams derive their own via keccak256("team.app")
const DEMO_APP_KEY = ethers.id("ampere.demo");

// One relay costs ~0.004–0.007 BOT at 20 gwei, so the per-address cap must be a
// multiple of that (0.05 ≈ 7–10 relays per address per rolling 24h).
const PER_ADDRESS_CAP = ethers.parseEther("0.05"); // BOT per address / rolling 24h
const DAILY_BUDGET = ethers.parseEther("200"); // BOT / day
const EXPIRES_AT = 0; // never (set a unix ts in production)

// Funding sizes are env-tunable (defaults match a faucet-funded testnet account).
const FLOAT_BOT = process.env.INIT_FLOAT_BOT ?? "10"; // paymaster gas float
const VAULT_BOT = process.env.INIT_VAULT_BOT ?? "50"; // demo appKey budget

async function main() {
  const [deployer] = await ethers.getSigners();
  const d = loadDeployments(network.name);
  console.log(`init on ${d.chainId} with ${deployer.address}`);

  const registry = await ethers.getContractAt("SponsorPolicyRegistry", d.SponsorPolicyRegistry!);
  const vault = await ethers.getContractAt("BudgetVault", d.BudgetVault!);
  const paymaster = await ethers.getContractAt("GaslessPaymaster", d.GaslessPaymaster!);

  // 1) paymaster float (gas pre-fund)
  const floatAmount = ethers.parseEther(FLOAT_BOT);
  const currentFloat = await ethers.provider.getBalance(d.GaslessPaymaster!);
  if (currentFloat < floatAmount) {
    const send = floatAmount - currentFloat;
    console.log(`funding paymaster float with ${ethers.formatEther(send)} BOT`);
    await (await deployer.sendTransaction({ to: d.GaslessPaymaster!, value: send })).wait();
  } else {
    console.log("paymaster float already funded");
  }

  // 2) vault budget for the demo appKey
  const budgetAmount = ethers.parseEther(VAULT_BOT);
  const currentBudget = await vault.budgetOf(DEMO_APP_KEY);
  if (currentBudget < budgetAmount) {
    const deposit = budgetAmount - currentBudget;
    console.log(`funding vault budget with ${ethers.formatEther(deposit)} BOT for appKey ${DEMO_APP_KEY}`);
    await (await vault.depositNative(DEMO_APP_KEY, { value: deposit })).wait();
  } else {
    console.log("vault budget already funded");
  }

  // 3) default policy: allowlist = [Counter]
  const d2 = loadDeployments(network.name);
  const counter = d2.Counter!;
  const existing = await registry.policyOwner(DEMO_APP_KEY);
  const policy = {
    allowlist: [counter],
    blocklist: [] as string[],
    perAddressCap: PER_ADDRESS_CAP,
    dailyBudget: DAILY_BUDGET,
    expiresAt: EXPIRES_AT,
    paused: false,
  };
  if (existing === ethers.ZeroAddress) {
    console.log("setting demo policy:", policy);
    await (await registry.setPolicy(DEMO_APP_KEY, policy)).wait();
  } else {
    console.log("policy already set");
  }

  console.log("\ninit complete. demo appKey:", DEMO_APP_KEY);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
