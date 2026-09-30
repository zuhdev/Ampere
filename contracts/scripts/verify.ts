/**
 * Ampere verify — source verification on scan.bohr.life.
 *
 * The BOT Chain explorer uses an ETHERSCAN-COMPATIBLE API (POST /api,
 * module=contract&action=verifysourcecode) — NOT Blockscout v2 REST paths.
 *
 * Strategy (mirrors bot-dca):
 *   1. Locate the build-info file containing the compiled contract
 *      (artifacts/build-info/*.json → `input` is the standard-JSON input).
 *   2. POST codeformat=solidity-standard-json-input with the full input JSON.
 *   3. Append ABI-encoded constructor arguments.
 *   4. Poll the guid until status=1, then fetch `is_fully_verified`.
 */
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { ethers, network } from "hardhat";
import { loadDeployments } from "../deploy/deployments";

dotenv.config();

const API_URL = process.env.BOT_EXPLORER_API_URL ?? "https://scan.bohr.life/api";
const API_KEY = process.env.ETHERSCAN_API_KEY ?? "";

const CONTRACTS = [
  { name: "SponsorPolicyRegistry", ctorArgs: [] },
  { name: "BudgetVault", ctorTypes: ["address", "address"] },
  { name: "GaslessPaymaster", ctorTypes: ["address", "address", "address"] },
  { name: "Counter", ctorArgs: [] },
];

interface BuildInfo {
  input: Record<string, { sources?: Record<string, unknown> }> & Record<string, any>;
  output: {
    contracts: Record<string, Record<string, { evm: { bytecode: { object: string } } }>>;
  };
  /** exact solc long version the artifacts were built with, e.g. 0.8.20+commit.a1b79de6 */
  solcLongVersion?: string;
}

interface VerifyResponse {
  status: string;
  result: string;
}

function findBuildInfo(contractName: string): BuildInfo {
  const dir = path.join(__dirname, "..", "artifacts", "build-info");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  // use the most recent build-info
  files.sort((a, b) => {
    const sa = fs.statSync(path.join(dir, a)).mtimeMs;
    const sb = fs.statSync(path.join(dir, b)).mtimeMs;
    return sb - sa;
  });
  for (const f of files) {
    const info = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as BuildInfo;
    const sources = (info.input?.sources ?? {}) as Record<string, unknown>;
    for (const src of Object.keys(sources)) {
      if (src.endsWith(`/${contractName}.sol`) || src === `${contractName}.sol`) {
        const inOutput = Object.values(info.output?.contracts ?? {}).some((c) => contractName in c);
        if (inOutput) return info;
      }
    }
  }
  throw new Error(`build-info containing ${contractName} not found — run hardhat compile first`);
}

async function verifyContract(
  contractName: string,
  address: string,
  ctorArgTypes: string[],
  ctorArgValues: unknown[]
) {
  console.log(`\nverifying ${contractName} at ${address}`);
  const existing = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      apikey: API_KEY,
      module: "contract",
      action: "getsourcecode",
      address,
    }).toString(),
  })
    .then((r) => r.json() as Promise<{ result?: Array<{ IsProxy?: boolean }> }>)
    .then((j) => j?.result?.[0]);
  if (existing?.IsProxy === true) {
    console.log("  proxy — skipping");
    return;
  }
  const abiEncoded =
    ctorArgValues.length > 0
      ? ethers.AbiCoder.defaultAbiCoder().encode(ctorArgTypes, ctorArgValues).slice(2)
      : "";

  const buildInfo = findBuildInfo(contractName);
  if (!buildInfo.solcLongVersion) {
    throw new Error("build-info missing solcLongVersion — recompile with hardhat compile");
  }
  const sourceCode = JSON.stringify(buildInfo.input);

  const body = new URLSearchParams({
    apikey: API_KEY,
    module: "contract",
    action: "verifysourcecode",
    codeformat: "solidity-standard-json-input",
    contractaddress: address,
    sourceCode,
    contractname: `contracts/${contractName}.sol:${contractName}`,
    compilerversion: `v${buildInfo.solcLongVersion}`, // explorer's solc list is commit-exact
    constructorArguements: abiEncoded, // NOTE: explorer's spelling
  });

  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  }).then((r) => r.json() as Promise<VerifyResponse>);

  if (Number(res.status) !== 1) {
    if (String(res.result).toLowerCase().includes("already verified")) {
      console.log("  already verified ✅");
      return;
    }
    console.error(`  submit failed: ${JSON.stringify(res)}`);
    return;
  }
  const guid = res.result;
  console.log(`  submitted, guid=${guid}`);

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    const check = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        apikey: API_KEY,
        module: "contract",
        action: "checkverifystatus",
        guid,
      }).toString(),
    }).then((r) => r.json() as Promise<VerifyResponse>);
    if (String(check.result) === "Pending in queue") continue;
    // Etherscan says "Successfully ..."; this explorer says "Pass - Verified"
    const ok = String(check.result).startsWith("Successfully") || String(check.result).startsWith("Pass");
    if (ok) {
      console.log(`  ✅ verified`);
      return;
    }
    console.error(`  verification failed: ${JSON.stringify(check)}`);
    return;
  }
  console.error("  timed out waiting for verification");
}

async function main() {
  const d = loadDeployments("botTestnet");
  console.log(`verifying on ${API_URL} (chain ${await network.provider.send("eth_chainId")})`);

  const vaultArgs = [d.GaslessPaymaster!, ethers.ZeroAddress];
  const paymasterArgs = [d.SponsorPolicyRegistry!, d.BudgetVault!, "0x0000000071727De22E5E9d8BAf0edAc6f37da032"];

  const jobs = [
    { name: "SponsorPolicyRegistry", types: [] as string[], values: [] as unknown[] },
    { name: "BudgetVault", types: ["address", "address"], values: vaultArgs },
    { name: "GaslessPaymaster", types: ["address", "address", "address"], values: paymasterArgs },
    { name: "Counter", types: [], values: [] },
  ];

  for (const job of jobs) {
    const address = (d as unknown as Record<string, string>)[job.name];
    if (!address) {
      console.log(`skip ${job.name} (not deployed)`);
      continue;
    }
    await verifyContract(job.name, address, job.types, job.values);
  }

  console.log("\nverify pass complete. confirm is_fully_verified on scan.bohr.life.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
