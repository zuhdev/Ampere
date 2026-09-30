/**
 * Ampere e2e — on-chain gasless round trip on BOT Chain testnet:
 *   wallet with 0 gas → relay (sponsorAndSend) → Counter.increment()
 * Prints the gas delta (what the user WOULD have paid vs paid = 0).
 */
import { ethers, network } from "hardhat";
import { loadDeployments } from "../deploy/deployments";

const DEMO_APP_KEY = ethers.id("ampere.demo");
// Authorization must cover the measured cost (~0.0066 BOT at 20 gwei) — the paymaster
// reverts with GasBudgetExceeded if the charge would exceed it.
const GAS_BUDGET_WEI = ethers.parseEther("0.01"); // max gas cost authorized per relay

async function main() {
  const d = loadDeployments(network.name);
  const [deployer, maybeUser] = await ethers.getSigners();
  // The gasless user never signs — an address is enough. Testnet config only
  // carries the deployer key, so generate a random 0-BOT user there.
  const user = maybeUser ?? ethers.Wallet.createRandom();

  const registry = await ethers.getContractAt("SponsorPolicyRegistry", d.SponsorPolicyRegistry!) as any;
  const paymaster = await ethers.getContractAt("GaslessPaymaster", d.GaslessPaymaster!) as any;
  const counter = await ethers.getContractAt("Counter", d.Counter!) as any;

  console.log("=== Ampere e2e: gasless increment ===");
  console.log("user (gasless):", user.address);
  console.log("user balance BEFORE:", ethers.formatEther(await ethers.provider.getBalance(user.address)));

  const data = counter.interface.encodeFunctionData("increment");
  // estimate as the paymaster (raw provider call — signer-bound estimateGas rejects a foreign `from`)
  const estGas = await ethers.provider.estimateGas({
    to: d.Counter!,
    data,
    from: d.GaslessPaymaster!,
  });
  const gasPrice = (await ethers.provider.getFeeData()).gasPrice ?? 20n * 10n ** 9n;
  // BOT's eth_estimateGas under-reports (it returned 68k for a call that needs ~313k),
  // and ethers uses that as the tx gas limit → OOG. Never let it pick the limit.
  const STATIC_GAS = 350_000n;
  const wouldCost = STATIC_GAS * gasPrice;
  console.log(
    `user WOULD have paid: ~${ethers.formatEther(wouldCost)} BOT (${STATIC_GAS} gas @ ${gasPrice} wei; raw estimate ${estGas})`
  );

  // Relay: deployer is the relayer (testnet). In prod the relay service holds this key.
  const tx = await paymaster
    .connect(deployer)
    .sponsorAndSend(DEMO_APP_KEY, d.Counter!, user.address, GAS_BUDGET_WEI, data, {
      gasLimit: 3_000_000,
    });
  const receipt = await tx.wait();
  if (!receipt) throw new Error("no receipt");
  console.log("relay tx:", receipt.hash, "status:", receipt.status);
  console.log("actual relay gas used:", receipt.gasUsed.toString());

  const count = await counter.count();
  console.log("counter.count() =", count.toString());
  console.log("user balance AFTER:", ethers.formatEther(await ethers.provider.getBalance(user.address)));

  if (count === 0n) throw new Error("e2e FAILED — counter did not increment");
  console.log("\ne2e OK — user spent 0 BOT for gas ✅");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
