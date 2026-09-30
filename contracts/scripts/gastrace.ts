/**
 * Gas segmentation trace â€” calibrates GaslessPaymaster's accounting constants.
 *
 * Splits a relay tx into:
 *   intrinsic  = gasLimit - gas at first opcode        (21k + calldata)
 *   entry      = first opcode -> first external call   (dispatch + decode + modifiers)
 *   window     = startGas -> after target call         (measured in-contract)
 *   post       = after target call -> end of frame     (recordSpend + debit + emit)
 *
 * Acceptance for the fixed contract: Sponsored.gasUsed >= receipt.gasUsed
 * (sponsor never undercharged; relayer never eats the difference).
 */
import { ethers, network } from "hardhat";

const APP_KEY = ethers.id("trace.app");

interface Segments {
  intrinsic: bigint;
  entry: bigint;
  post: bigint;
  gasAtFrameStart: bigint;
}

async function traceSegments(txHash: string, targetAddr: string): Promise<Segments> {
  const tx: any = await ethers.provider.getTransaction(txHash);
  if (!tx) throw new Error("tx not found: " + txHash);
  const receipt = await ethers.provider.getTransactionReceipt(txHash);
  const trace = await network.provider.send("debug_traceTransaction", [txHash]);
  const logs: any[] = trace.structLogs;
  if (!logs.length) throw new Error("empty structLogs");

  const gasAtFrameStart = BigInt(logs[0].gas);
  const intrinsic = BigInt(tx.gasLimit) - gasAtFrameStart;

  const isCall = (op: string) => op === "CALL" || op === "STATICCALL" || op === "DELEGATECALL";
  const addrOf = (log: any): string => {
    const st: string[] = log.stack ?? [];
    if (st.length < 2) return "";
    // stack is bottom->top; CALL args: [... , addr, gas] with gas on top
    return ("0x" + st[st.length - 2].replace(/^0x/, "").slice(-40)).toLowerCase();
  };

  let firstCallIdx = -1;
  for (let i = 0; i < logs.length; i++) {
    if (logs[i].depth === 1 && isCall(logs[i].op)) { firstCallIdx = i; break; }
  }
  if (firstCallIdx < 0) throw new Error("no external call found");
  const entry = gasAtFrameStart - BigInt(logs[firstCallIdx].gas);

  // target call = first depth-1 CALL to targetAddr
  let targetIdx = -1;
  for (let i = firstCallIdx; i < logs.length; i++) {
    if (logs[i].depth === 1 && isCall(logs[i].op) && addrOf(logs[i]) === targetAddr.toLowerCase()) {
      targetIdx = i;
      break;
    }
  }
  if (targetIdx < 0) throw new Error("target call not found in trace");

  // first depth-1 log after the target's inner frame returns
  let afterIdx = -1;
  for (let i = targetIdx + 1; i < logs.length; i++) {
    if (logs[i].depth === 1) { afterIdx = i; break; }
  }
  if (afterIdx < 0) throw new Error("target frame never returned");

  // end of depth-1 frame: last depth-1 log (gas after its cost = frame end approx)
  let lastIdx = -1;
  for (let i = logs.length - 1; i >= 0; i--) {
    if (logs[i].depth === 1) { lastIdx = i; break; }
  }
  const gasAtFrameEnd = BigInt(logs[lastIdx].gas) - BigInt(logs[lastIdx].gasCost);

  const post = BigInt(logs[afterIdx].gas) - gasAtFrameEnd;
  return { intrinsic, entry, post, gasAtFrameStart };
}

function sponsoredGasUsed(receipt: any): bigint | null {
  const abi = [
    "event Sponsored(bytes32 indexed appKey, address indexed target, address indexed beneficiary, uint256 gasUsed, uint256 gasCost, bool success)",
  ];
  const iface = new ethers.Interface(abi);
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog({ topics: log.topics, data: log.data });
      if (parsed?.name === "Sponsored") return parsed.args.gasUsed as bigint;
    } catch {}
  }
  return null;
}

async function main() {
  const [owner, relayer, user, user2] = await ethers.getSigners();

  const Registry = await ethers.getContractFactory("SponsorPolicyRegistry");
  const registry: any = await Registry.deploy();
  const EP = await ethers.getContractFactory("MockEntryPoint");
  const entryPoint: any = await EP.deploy();
  const Paymaster = await ethers.getContractFactory("GaslessPaymaster");
  const paymaster: any = await Paymaster.deploy(await registry.getAddress(), await entryPoint.getAddress());
  const Vault = await ethers.getContractFactory("BudgetVault");
  const vault: any = await Vault.deploy(await paymaster.getAddress(), ethers.ZeroAddress);
  const Target = await ethers.getContractFactory("MockTarget");
  const target: any = await Target.deploy();

  await registry.setPaymaster(await paymaster.getAddress());
  await paymaster.setRelayer(relayer.address);
  await paymaster.setVault(await vault.getAddress());

  await owner.sendTransaction({ to: await paymaster.getAddress(), value: ethers.parseEther("5") });
  await vault.depositNative(APP_KEY, { value: ethers.parseEther("10") });

  const policy = {
    allowlist: [await target.getAddress()],
    blocklist: [] as string[],
    perAddressCap: ethers.parseEther("100"),
    dailyBudget: ethers.parseEther("1000"),
    expiresAt: 0,
    paused: false,
  };
  await registry.setPolicy(APP_KEY, policy);

  const GAS_BUDGET = ethers.parseEther("1");
  const workData = target.interface.encodeFunctionData("doWork", ["0x"]);
  const cases: { label: string; beneficiary: string; data: string; expectRevert?: boolean }[] = [
    { label: "1 cold (first-ever relay)", beneficiary: user.address, data: workData },
    { label: "2 warm (same beneficiary)", beneficiary: user.address, data: workData },
    { label: "3 new beneficiary (cold slots)", beneficiary: user2.address, data: workData },
    { label: "4 empty data (cheap target)", beneficiary: user.address, data: "0x" },
  ];

  console.log(
    "case".padEnd(38),
    "gasUsed".padStart(9),
    "charged".padStart(10),
    "intrinsic".padStart(10),
    "entry".padStart(7),
    "post".padStart(8),
    "entry+post".padStart(11)
  );

  for (const c of cases) {
    const tx = await paymaster
      .connect(relayer)
      .sponsorAndSend(APP_KEY, await target.getAddress(), c.beneficiary, GAS_BUDGET, c.data);
    const receipt = await tx.wait();
    if (!receipt) throw new Error("no receipt");

    const seg = await traceSegments(tx.hash, await target.getAddress());
    const charged = sponsoredGasUsed(receipt);

    console.log(
      c.label.padEnd(38),
      receipt.gasUsed.toString().padStart(9),
      (charged?.toString() ?? "-").padStart(10),
      seg.intrinsic.toString().padStart(10),
      seg.entry.toString().padStart(7),
      seg.post.toString().padStart(8),
      (seg.entry + seg.post).toString().padStart(11)
    );
  }

  // target revert path (success=false) â€” accounting must still cover cost
  await target.setShouldRevert(true);
  const tx = await paymaster
    .connect(relayer)
    .sponsorAndSend(APP_KEY, await target.getAddress(), user.address, GAS_BUDGET, workData);
  const receipt = await tx.wait();
  const seg = await traceSegments(tx.hash, await target.getAddress());
  const charged = sponsoredGasUsed(receipt);
  console.log(
    "5 target revert".padEnd(38),
    receipt.gasUsed.toString().padStart(9),
    (charged?.toString() ?? "-").padStart(10),
    seg.intrinsic.toString().padStart(10),
    seg.entry.toString().padStart(7),
    seg.post.toString().padStart(8),
    (seg.entry + seg.post).toString().padStart(11)
  );
  await target.setShouldRevert(false);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});



