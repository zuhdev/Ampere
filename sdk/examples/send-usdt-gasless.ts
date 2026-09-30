/**
 * Ampere example — "send 1 USDT with 0 BOT in the wallet."
 *
 * The user's wallet holds USDT but no BOT for gas. The USDT transfer is relayed
 * through Ampere; gas is paid from the app's sponsorship budget.
 *
 * Run: AMPERE_KEY=0x... AMPERE_API_URL=https://api.ampere.xxx npx tsx examples/send-usdt-gasless.ts
 */
import { parseUnits } from "viem";
import { Ampere } from "../src/index.js";

const USDT_TESTNET = "0x75edC9335175Fc0552D51D48439F229c10420fe3" as const; // 6 dp

async function main() {
  const ampere = new Ampere({
    appKey: process.env.AMPERE_KEY!,
    apiUrl: process.env.AMPERE_API_URL ?? "http://localhost:8787",
  });

  const to = process.env.RECIPIENT! as `0x${string}`;
  const amount = parseUnits("1", 6); // 1 USDT

  const data = Ampere.erc20Transfer(USDT_TESTNET, to, amount);

  // 1) would this be sponsored?
  const sim = await ampere.simulate({ to: USDT_TESTNET, data });
  console.log("simulate:", sim);
  if (!sim.sponsorable) throw new Error("not sponsorable — check policy / budget");

  // 2) relay it (user pays 0 gas)
  const result = await ampere.execute({
    to: USDT_TESTNET,
    data,
    beneficiary: to,
  });
  console.log("executed:", result);
  console.log("explorer:", result.explorer);

  // 3) budget after
  console.log("usage:", await ampere.usage());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
