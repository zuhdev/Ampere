/**
 * Ampere deploy — BOT Chain testnet (968) or mainnet (677).
 *
 * Chain quirks handled (both nets):
 * - eth_feeHistory broken → explicit gasPrice (20 gwei) + gas limit set in hardhat.config.
 * - Never rely on fee estimation.
 *
 * Mainnet safety: deploying to chain 677 requires CONFIRM_MAINNET=1.
 */
import { ethers, network } from "hardhat";
import { saveDeployments } from "../deploy/deployments";

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  if (net.chainId === 677n && process.env.CONFIRM_MAINNET !== "1") {
    throw new Error("Mainnet (677) deploy blocked — set CONFIRM_MAINNET=1 to proceed.");
  }
  console.log(`deploying Ampere on chain ${net.chainId} (${network.name}) with ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`deployer balance: ${ethers.formatEther(balance)} BOT`);
  if (balance === 0n) {
    const hint =
      net.chainId === 677n
        ? "Fund the deployer with real BOT — there is no faucet on mainnet."
        : "Use the faucet: https://faucet.bohr.life/basic/";
    throw new Error(`Deployer has no BOT for gas. ${hint}`);
  }

  // 1) SponsorPolicyRegistry
  const Registry = await ethers.getContractFactory("SponsorPolicyRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();
  console.log(`SponsorPolicyRegistry: ${await registry.getAddress()}`);

  // 2) GaslessPaymaster (vault wired after vault deploy)
  const Paymaster = await ethers.getContractFactory("GaslessPaymaster");
  const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
  const paymaster = await Paymaster.deploy(
    await registry.getAddress(),
    ENTRY_POINT
  );
  await paymaster.waitForDeployment();
  const paymasterAddress = await paymaster.getAddress();
  console.log(`GaslessPaymaster: ${paymasterAddress}`);

  // 3) BudgetVault (immutable paymaster ref)
  const Vault = await ethers.getContractFactory("BudgetVault");
  const vault = await Vault.deploy(paymasterAddress, ethers.ZeroAddress);
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log(`BudgetVault: ${vaultAddress}`);

  // 4) Demo target
  const Counter = await ethers.getContractFactory("Counter");
  const counter = await Counter.deploy();
  await counter.waitForDeployment();
  console.log(`Counter: ${await counter.getAddress()}`);

  // 5) Wire registry paymaster
  await (await registry.setPaymaster(paymasterAddress)).wait();
  // 6) Wire paymaster <-> vault pairing (one-shot)
  await (await paymaster.setVault(vaultAddress)).wait();
  // 7) Relay = deployer until relay service key is provisioned
  await (await paymaster.setRelayer(deployer.address)).wait();

  await saveDeployments(network.name, {
    network: network.name,
    chainId: Number(net.chainId),
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    SponsorPolicyRegistry: await registry.getAddress(),
    BudgetVault: vaultAddress,
    GaslessPaymaster: paymasterAddress,
    Counter: await counter.getAddress(),
  });

  console.log("\nnext: fund the paymaster float + vault, then run smoke.ts");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
