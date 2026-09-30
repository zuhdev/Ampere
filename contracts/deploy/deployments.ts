import fs from "fs";
import path from "path";

export interface Deployments {
  network: string;
  chainId: number;
  deployer: string;
  deployedAt: string;
  SponsorPolicyRegistry?: string;
  BudgetVault?: string;
  GaslessPaymaster?: string;
  Counter?: string;
}

const DEPLOY_DIR = path.join(__dirname, "..", "deployments");

export function saveDeployments(network: string, data: Deployments): void {
  if (!fs.existsSync(DEPLOY_DIR)) fs.mkdirSync(DEPLOY_DIR, { recursive: true });
  const file = path.join(DEPLOY_DIR, `${network}.json`);
  const prev: Partial<Deployments> =
    fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  const merged = { ...prev, ...data };
  fs.writeFileSync(file, JSON.stringify(merged, null, 2));
  console.log(`saved deployments → ${file}`);
}

export function loadDeployments(network: string): Deployments {
  const file = path.join(DEPLOY_DIR, `${network}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`No deployments for network "${network}" — run deploy first (${file})`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
