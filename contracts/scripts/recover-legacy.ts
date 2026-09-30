/**
 * Ampere recover-legacy — one-time recovery of funds stranded in the SUPERSEDED
 * testnet deployment (the addresses before the contracts were redeployed with
 * the cost-model fix). Those contracts are still owned by the deployer but are
 * no longer referenced by relay/.env or api/.env, so their balances can never
 * be spent by the current stack.
 *
 * Reports + (optionally) owner-withdraws:
 *   - legacy BudgetVault    → all escrowed sponsor budgets
 *   - legacy GaslessPaymaster → gas float
 *   - probes the EntryPoint deposit (NOT recoverable — no contract function
 *     forwards EntryPoint.withdrawTo; reported for transparency)
 *
 * DRY_RUN=1 (default) only reports; DRY_RUN=0 executes the withdrawals.
 * Overrides: LEGACY_VAULT, LEGACY_PAYMASTER, LEGACY_RECEIVER.
 */
import { ethers } from "hardhat";

const LEGACY_VAULT = process.env.LEGACY_VAULT ?? "0xc3cd36A554b4BD7917324FD5536A3a4b6D20D552";
const LEGACY_PAYMASTER = process.env.LEGACY_PAYMASTER ?? "0x06Ca1e57816892bBC99044a7a66cc17CB688be16";
const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
const DRY_RUN = (process.env.DRY_RUN ?? "1") !== "0";

// both contracts expose owner() + withdraw(address,uint256) with identical semantics
const OWNED_WITHDRAW_ABI = [
  "function owner() view returns (address)",
  "function withdraw(address to, uint256 amount)",
];
const ENTRY_POINT_ABI = ["function balanceOf(address account) view returns (uint256)"];

const TX_OPTS = {
  gasLimit: 300_000n,
  gasPrice: 20n * 10n ** 9n, // BOT testnet: fixed 20 gwei, never estimate fees
} as const;

async function recover(label: string, address: string, receiver: string, signerAddr: string): Promise<void> {
  const c = await ethers.getContractAt(OWNED_WITHDRAW_ABI, address);
  const owner = (await c.owner()) as string;
  const balance = await ethers.provider.getBalance(address);
  console.log(`${label}: ${address}`);
  console.log(`  balance = ${ethers.formatEther(balance)} BOT, owner = ${owner}`);

  if (balance === 0n) {
    console.log("  nothing to recover");
    return;
  }
  if (owner.toLowerCase() !== signerAddr.toLowerCase()) {
    console.log(`  SKIP: owner is not the deployer (${signerAddr})`);
    return;
  }
  if (DRY_RUN) {
    console.log(`  DRY_RUN — would withdraw ${ethers.formatEther(balance)} BOT → ${receiver}`);
    return;
  }
  const tx = await c.withdraw(receiver, balance, TX_OPTS);
  console.log(`  withdraw tx: ${tx.hash}`);
  await tx.wait();
  const after = await ethers.provider.getBalance(address);
  console.log(`  done — contract balance now ${ethers.formatEther(after)} BOT`);
}

async function main(): Promise<void> {
  const signer = (await ethers.getSigners())[0];
  if (!signer) throw new Error("no signer — set DEPLOYER_PRIVATE_KEY in contracts/.env");
  const signerAddr = await signer.getAddress();
  const receiver = process.env.LEGACY_RECEIVER ?? signerAddr;
  const net = await ethers.provider.getNetwork();

  console.log(`network chainId=${net.chainId}  signer=${signerAddr}  receiver=${receiver}`);
  console.log(`mode: ${DRY_RUN ? "DRY RUN (report only)" : "WITHDRAW"}`);

  await recover("legacy BudgetVault", LEGACY_VAULT, receiver, signerAddr);
  await recover("legacy GaslessPaymaster", LEGACY_PAYMASTER, receiver, signerAddr);

  const ep = await ethers.getContractAt(ENTRY_POINT_ABI, ENTRY_POINT);
  for (const [label, addr] of [
    ["legacy vault", LEGACY_VAULT],
    ["legacy paymaster", LEGACY_PAYMASTER],
  ] as const) {
    try {
      const dep = (await ep.balanceOf(addr)) as bigint;
      if (dep > 0n) {
        console.log(`EntryPoint deposit of ${label} = ${ethers.formatEther(dep)} BOT — NOT recoverable`);
        console.log("  (the contract has no EntryPoint.withdrawTo forwarder)");
      }
    } catch {
      // EntryPoint probe is informational only
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
