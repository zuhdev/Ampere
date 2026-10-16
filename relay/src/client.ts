import { createPublicClient, createWalletClient, http, parseAbi, encodeFunctionData, type PublicClient, type WalletClient, type Address, type Hash, type TransactionReceipt } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { defineChain } from "viem";
import {
  CHAIN_ID,
  CHAIN_NAME,
  EXPLORER_URL,
  RPC_URL,
  DEFAULT_GAS_PRICE_WEI,
  DEFAULT_GAS_LIMIT,
  RELAY_PRIVATE_KEY,
  REGISTRY_ADDRESS,
  VAULT_ADDRESS,
  PAYMASTER_ADDRESS,
} from "./config.js";
import { NonceQueue } from "./nonceQueue.js";
import { recordRelay } from "./health.js";

/** BOT Chain (testnet or mainnet per AMPERE_NETWORK) — feeHistory is broken, so we always set explicit fees. */
export const botChain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_NAME,
  nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "scan", url: EXPLORER_URL } },
});

export const publicClient: PublicClient = createPublicClient({
  chain: botChain,
  transport: http(RPC_URL),
});

const account = privateKeyToAccount(RELAY_PRIVATE_KEY as `0x${string}`);

export const walletClient: WalletClient = createWalletClient({
  account,
  chain: botChain,
  transport: http(RPC_URL),
});

export const relayerAddress = account.address;

export { NETWORK, CHAIN_ID, CHAIN_NAME, EXPLORER_URL, RPC_URL } from "./config.js";

export const sponsorAbi = parseAbi([
  "function isSponsorable(bytes32 appKey, address target, address beneficiary, uint256 gasCost) view returns (bool)",
  "function daySpent(bytes32 appKey) view returns (uint256)",
  "function addressSpent(bytes32 appKey, address beneficiary) view returns (uint256)",
  "function getPolicies(bytes32 appKey) view returns ((address[] allowlist, address[] blocklist, uint256 perAddressCap, uint256 dailyBudget, uint256 expiresAt, bool paused))",
]);

export const vaultAbi = parseAbi([
  "function budgetOf(bytes32 appKey) view returns (uint256)",
]);

export const registryWriteAbi = parseAbi([
  "function setPolicy(bytes32 appKey, (address[] allowlist, address[] blocklist, uint256 perAddressCap, uint256 dailyBudget, uint256 expiresAt, bool paused) p)",
]);

export const vaultWriteAbi = parseAbi([
  "function depositNative(bytes32 appKey) payable",
]);

export const paymasterAbi = parseAbi([
  "function gm_sponsorable(bytes32 appKey, address to, address token, uint256 value) view returns (bool sponsorable, bytes32 policyId)",
  "function sponsorAndSend(bytes32 appKey, address target, address beneficiary, uint256 amount, bytes data) payable returns (uint256 gasUsed, bool success)",
]);

export const nonceQueue = new NonceQueue();

export interface RelayRequest {
  appKey: `0x${string}`;
  target: Address;
  beneficiary: Address;
  gasBudget: bigint;
  data: `0x${string}`;
  value?: bigint;
}

export interface RelayResult {
  txHash: Hash;
  gasUsed: bigint;
  success: boolean;
  blockNumber: bigint;
}

/** Read the relayer's current pending-safe nonce. */
export async function reserveNonce(): Promise<bigint> {
  return nonceQueue.run(async () => {
    const fresh = await publicClient.getTransactionCount({
      address: relayerAddress,
      blockTag: "pending",
    });
    return nonceQueue.next(BigInt(fresh));
  });
}

/**
 * Send sponsorAndSend with retry/backoff (3 attempts, 1s → 2s → 4s).
 * Reverts are NOT retried — a policy rejection is deterministic.
 */
export async function relayWithRetry(req: RelayRequest): Promise<RelayResult> {
  let lastErr: unknown;

  for (let attempt = 0; attempt < 3; attempt++) {
    let nonce: bigint | undefined;
    try {
      nonce = await reserveNonce();
      const gasPrice = await currentGasPrice();

      const txHash = await walletClient.sendTransaction({
        account,
        chain: botChain,
        to: PAYMASTER_ADDRESS as Address,
        data: encodeSponsorAndSend(req),
        value: req.value ?? 0n,
        nonce: Number(nonce),
        gas: DEFAULT_GAS_LIMIT,
        gasPrice, // explicit — never estimate fees on BOT Chain
      });

      const receipt: TransactionReceipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
        timeout: 60_000,
      });

      nonceQueue.settle(nonce);

      // heartbeat counters: relays driven by the API land in the same state the
      // standalone runner reports (this path used to never call recordRelay)
      recordRelay(receipt.gasUsed, receipt.status === "success", gasPrice);

      return {
        txHash,
        gasUsed: receipt.gasUsed,
        success: receipt.status === "success",
        blockNumber: receipt.blockNumber,
      } as RelayResult;
    } catch (err: any) {
      // release the reserved nonce — a leaked pending entry creates a permanent
      // nonce gap and every later tx would never be mined
      if (nonce !== undefined) nonceQueue.settle(nonce);
      lastErr = err;
      if (isRevert(err)) {
        recordRelay(0n, false); // deterministic revert before any receipt — gas unknown
        throw err;
      }
      if (attempt < 2) await sleep([1_000, 2_000][attempt]);
    }
  }
  recordRelay(0n, false); // retries exhausted without a receipt
  throw lastErr;
}

/** Explicit gas price: eth_gasPrice only (feeHistory is broken on BOT Chain). */
export async function currentGasPrice(): Promise<bigint> {
  try {
    const gp = await publicClient.getGasPrice();
    return gp > 0n ? gp : DEFAULT_GAS_PRICE_WEI;
  } catch {
    return DEFAULT_GAS_PRICE_WEI;
  }
}

export function encodeSponsorAndSend(req: RelayRequest): `0x${string}` {
  // viem encodes dynamically-typed calldata for us; no hand-rolled ABI packing.
  return encodeFunctionData({
    abi: paymasterAbi,
    functionName: "sponsorAndSend",
    args: [req.appKey, req.target, req.beneficiary, req.gasBudget, req.data],
  });
}

export async function isSponsorable(
  appKey: `0x${string}`,
  target: Address,
  beneficiary: Address,
  gasBudget: bigint
): Promise<boolean> {
  return (await publicClient.readContract({
    address: REGISTRY_ADDRESS as Address,
    abi: sponsorAbi,
    functionName: "isSponsorable",
    args: [appKey, target, beneficiary, gasBudget],
  })) as boolean;
}

export async function budgetOf(appKey: `0x${string}`): Promise<bigint> {
  return publicClient.readContract({
    address: VAULT_ADDRESS as Address,
    abi: vaultAbi,
    functionName: "budgetOf",
    args: [appKey],
  });
}

/** Sponsor policy in on-chain form (SponsorPolicy struct, wei amounts, unix seconds). */
export interface PolicyOnChain {
  allowlist: Address[];
  blocklist: Address[];
  perAddressCap: bigint;
  dailyBudget: bigint;
  expiresAt: bigint;
  paused: boolean;
}

/** Read the policy straight from the registry (e.g. to seed the API store). */
export async function readPolicy(appKey: `0x${string}`): Promise<PolicyOnChain> {
  return (await publicClient.readContract({
    address: REGISTRY_ADDRESS as Address,
    abi: sponsorAbi,
    functionName: "getPolicies",
    args: [appKey],
  })) as PolicyOnChain;
}

/**
 * Sponsor-management write (setPolicy / depositNative), routed through the same
 * NonceQueue as relays — the API and relay share one relayer key in one process,
 * and an independently fetched nonce would race with in-flight relays.
 */
async function sendGovernanceTx(params: {
  to: Address;
  data: `0x${string}`;
  value?: bigint;
  gas: bigint;
}): Promise<Hash> {
  let nonce: bigint | undefined;
  try {
    nonce = await reserveNonce();
    const txHash = await walletClient.sendTransaction({
      account,
      chain: botChain,
      to: params.to,
      data: params.data,
      value: params.value ?? 0n,
      nonce: Number(nonce),
      gas: params.gas,
      gasPrice: await currentGasPrice(),
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });
    nonceQueue.settle(nonce);
    if (receipt.status !== "success") throw new Error(`transaction reverted: ${txHash}`);
    return txHash;
  } catch (err) {
    if (nonce !== undefined) nonceQueue.settle(nonce);
    throw err;
  }
}

/** Create/update the on-chain policy for `appKey` (relayer is the policy owner). */
export async function setPolicy(appKey: `0x${string}`, p: PolicyOnChain): Promise<Hash> {
  return sendGovernanceTx({
    to: REGISTRY_ADDRESS as Address,
    data: encodeFunctionData({ abi: registryWriteAbi, functionName: "setPolicy", args: [appKey, p] }),
    gas: 1_000_000n, // cold allowlist writes + new policy slots; estimateGas is unreliable
  });
}

/** Deposit sponsorship budget against `appKey` from the relayer's float. */
export async function depositNative(appKey: `0x${string}`, value: bigint): Promise<Hash> {
  if (value <= 0n) throw new Error("depositNative: value must be > 0");
  return sendGovernanceTx({
    to: VAULT_ADDRESS as Address,
    data: encodeFunctionData({ abi: vaultWriteAbi, functionName: "depositNative", args: [appKey] }),
    value,
    gas: 200_000n,
  });
}

export function isRevert(err: unknown): boolean {
  const msg = String((err as any)?.message ?? err ?? "");
  return /revert|0x[0-9a-f]{8}/i.test(msg) && !/nonce|replacement|timeout/i.test(msg);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
