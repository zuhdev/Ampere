/**
 * Ampere set-relayer — rotate the GaslessPaymaster relayer (owner-only).
 *
 *   RELAYER_ADDRESS=0x... CONFIRM_MAINNET=1 npx hardhat run scripts/set-relayer.ts --network botMainnet
 *
 * Use a fresh key for the relay service; the deployer should not stay relayer in production.
 */
import { ethers, network } from "hardhat";
import { loadDeployments } from "../deploy/deployments";

async function main() {
  const relayer = process.env.RELAYER_ADDRESS;
  if (!relayer || !ethers.isAddress(relayer)) {
    throw new Error("set RELAYER_ADDRESS=0x... (the address of the new relayer key)");
  }
  const net = await ethers.provider.getNetwork();
  if (net.chainId === 677n && process.env.CONFIRM_MAINNET !== "1") {
    throw new Error("Mainnet (677) setRelayer blocked — set CONFIRM_MAINNET=1 to proceed.");
  }

  const d = loadDeployments(network.name);
  const paymaster = await ethers.getContractAt("GaslessPaymaster", d.GaslessPaymaster!);
  const current = await paymaster.relayer();
  console.log(`paymaster ${d.GaslessPaymaster} (chain ${d.chainId})`);
  console.log(`relayer: ${current} → ${relayer}`);

  if (current.toLowerCase() === relayer.toLowerCase()) {
    console.log("already set — nothing to do");
    return;
  }
  await (await paymaster.setRelayer(relayer)).wait();
  const now = await paymaster.relayer();
  if (now.toLowerCase() !== relayer.toLowerCase()) {
    throw new Error(`setRelayer did not stick — relayer is still ${now}`);
  }
  console.log("relayer rotated ✅ →", now);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
