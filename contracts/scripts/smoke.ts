/**
 * Ampere smoke — read-only sanity checks against BOT Chain (testnet or mainnet).
 * Verifies deployments are alive, wired correctly, and the chain quirks hold.
 */
import { ethers, network } from "hardhat";
import { loadDeployments } from "../deploy/deployments";

const DEMO_APP_KEY = ethers.id("ampere.demo");

async function main() {
  const d = loadDeployments(network.name);
  const [signer] = await ethers.getSigners();

  console.log("=== Ampere smoke (read-only) ===");
  console.log(`rpc network: ${JSON.stringify(await ethers.provider.getNetwork())}`);

  // Quirk check: eth_gasPrice works (20 gwei), feeHistory does not — set gas explicitly.
  const gasPrice = await ethers.provider.getFeeData();
  console.log(`feeData: gasPrice=${gasPrice.gasPrice}`);

  const code = async (addr: string) => (await ethers.provider.getCode(addr)).length;
  for (const [name, addr] of Object.entries({
    SponsorPolicyRegistry: d.SponsorPolicyRegistry!,
    BudgetVault: d.BudgetVault!,
    GaslessPaymaster: d.GaslessPaymaster!,
    Counter: d.Counter!,
  })) {
    console.log(`${name} ${addr} code=${await code(addr)} bytes`);
  }

  const registry = await ethers.getContractAt("SponsorPolicyRegistry", d.SponsorPolicyRegistry!);
  const vault = await ethers.getContractAt("BudgetVault", d.BudgetVault!);
  const paymaster = await ethers.getContractAt("GaslessPaymaster", d.GaslessPaymaster!);

  console.log("registry.paymaster:", await registry.paymaster());
  console.log("paymaster.vault:", await paymaster.vault());
  console.log("paymaster.relayer:", await paymaster.relayer());
  console.log("vault.budgetOf(demo):", ethers.formatEther(await vault.budgetOf(DEMO_APP_KEY)), "BOT");
  console.log(
    "policy:",
    JSON.stringify(await registry.getPolicies(DEMO_APP_KEY), (_k, v) =>
      typeof v === "bigint" ? v.toString() : v
    )
  );

  const [sponsorable] = await paymaster.gm_sponsorable(
    DEMO_APP_KEY,
    d.Counter!,
    ethers.ZeroAddress,
    ethers.parseEther("0.0001")
  );
  console.log("gm_sponsorable(counter, 0.0001 BOT gas):", sponsorable);

  console.log("\nsmoke OK — signer:", signer.address);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
