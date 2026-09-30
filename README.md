# Ampere

> **Ampere lets an app pay its users' transaction fees.**
>
> On a blockchain, every action costs gas — paid in the network's own token. That means a new user is stuck before they even start: no BOT, no transactions, no matter how good the app is. Ampere flips that. The app declares one simple spending rule — *which* contracts it will pay for, a cap per user, a budget per day — and then covers the gas on every eligible transaction. Users sign normally and pay **0 BOT**. The rule lives in the contracts themselves, so not even a compromised server can overspend the app's money.

Gas sponsorship (gasless transactions) for BOT Chain. Apps fund gas through an **on-chain policy** — users and agents sign with zero BOT in their wallet.

- **Scope:** BOT Chain **testnet only** — chain `968`, RPC `https://rpc.bohr.life`, explorer `https://scan.bohr.life`. Mainnet (677) is out of scope for v1.
- **Stack:** Hardhat + Solidity 0.8.20, viem, Express, React + wagmi. Node ≥ 22.
- **License:** MIT.

## How it works

```
client ──▶ API (:8787) ── policy pre-check, rate limit ──▶ relay client
   │             │                                            │
   │             │  store (in-memory)                         │ NonceQueue + retry
   │             ▼                                            ▼
   │      SponsorPolicyRegistry ◀── setPolicy/deposit ── GaslessPaymaster ──▶ target
   │      (allowlist, caps, budgets)                       (pays gas)
   └──────────── user signs intent ─────────────────────────────┘
```

| Contract | Role |
|---|---|
| `SponsorPolicyRegistry` | Policy per `bytes32 appKey`: allowlist, blocklist, per-address cap (rolling 24h), daily budget (00:00 UTC reset), expiry, pause. **All enforcement is on-chain** via `isSponsorable()` — a compromised API cannot bypass it. |
| `GaslessPaymaster` | Pays gas. EOA path `sponsorAndSend()` + ERC-4337 v0.7 path (`validatePaymasterUserOp`/`postOp`). Charges measured gas, reverts `GasBudgetExceeded` if cost exceeds the authorized `gasBudget`, refunds unspent gas. |
| `BudgetVault` | Sponsorship escrow per appKey: `depositNative`, `budgetOf`, owner-only `withdraw`. Never holds user funds. |
| `Counter` | Demo target contract (`increment()`). |

Demo policy (created by `init:testnet`): allowlist `[Counter]`, cap `0.05 BOT`/address/24h, budget `200 BOT`/day, `appKey = keccak256("ampere.demo")` (printed by `init:testnet`; also in `frontend/.env` as `VITE_APP_KEY`).

## Monorepo

```
contracts/   Hardhat — 4 contracts, 21 tests, deploy/init/smoke/e2e/verify scripts
sdk/         @ampere/sdk — simulate / execute / usage / recentTx
relay/       viem relay client (library) + standalone heartbeat monitor
api/         Express REST API (policy CRUD, simulate, relay, usage)
frontend/    Vite + React + wagmi — Dashboard, Policy editor, Relay playground
.github/     CI: contracts, typechecks, frontend build, testnet smoke, secret scan
```

## Quick start

```bash
npm install
cp .env.example contracts/.env     # fill DEPLOYER_PRIVATE_KEY
cp .env.example api/.env           # fill RELAY_PRIVATE_KEY + REGISTRY/VAULT/PAYMASTER addresses
npm run compile                    # hardhat compile
npm run test                       # 21 tests
```

Deploy + initialize testnet, then run the services:

```bash
npm run deploy:testnet -w contracts    # writes contracts/deployments/botTestnet.json
npm run init:testnet -w contracts      # funds paymaster float + vault, sets demo policy

npm run start -w relay                 # heartbeat monitor (self-check + JSON heartbeat)
npm run dev -w api                     # REST API on :8787
npm run dev -w frontend                # dashboard on :5173
```

Copy `frontend/.env.example` → `frontend/.env` and fill the addresses from `contracts/deployments/botTestnet.json`.

## Environment variables

Each service loads `.env` **from its own directory** (`dotenv`, cwd). Template: `.env.example` (repo root).

| Variable | Used by | Default | Notes |
|---|---|---|---|
| `BOT_TESTNET_RPC_URL` | contracts, relay | `https://rpc.bohr.life` | |
| `BOT_TESTNET_CHAIN_ID` | relay | `968` | must match the RPC (viem signs EIP-155 with it) |
| `DEPLOYER_PRIVATE_KEY` | contracts scripts | — | deploy/init/verify signer |
| `RELAY_PRIVATE_KEY` | relay, api | — | relayer/owner signer; **required** (fail-fast) |
| `REGISTRY_ADDRESS` / `VAULT_ADDRESS` / `PAYMASTER_ADDRESS` | relay, api | — | from `deployments/botTestnet.json`; **required** |
| `ETHERSCAN_API_KEY` | `verify:testnet` | — | Etherscan-compatible API on scan.bohr.life; `BOT_EXPLORER_API_URL` overrides the endpoint (default `https://scan.bohr.life/api`) |
| `INIT_FLOAT_BOT` / `INIT_VAULT_BOT` | `init:testnet` | `10` / `50` | paymaster gas float / vault funding (BOT) |
| `PORT` | api | `8787` | API port |
| `AMPERE_OWNER_KEY` | api | `dev-owner-key` | owner auth header value; rotate before any real deployment |
| `RELAY_RATE_LIMIT` | api | `30` | relay requests per appKey per minute |
| `API_ALLOWED_ORIGINS` | api | `*` | comma-separated origin allowlist for CORS |
| `SEED_APP_KEY` | api | — | registers this sponsor from its on-chain policy at startup (store is in-memory) |
| `HEARTBEAT_SECONDS` | relay | `60` | heartbeat interval |
| `LEGACY_VAULT` / `LEGACY_PAYMASTER` / `LEGACY_RECEIVER` / `DRY_RUN` | `recover:testnet` | `DRY_RUN=1` | legacy contract recovery |
| `VITE_REGISTRY` `VITE_VAULT` `VITE_PAYMASTER` `VITE_COUNTER` `VITE_APP_KEY` `VITE_API_URL` `VITE_RPC_URL` | frontend | — | see `frontend/.env.example` |

## Contracts

| Script | Command | What it does |
|---|---|---|
| deploy | `npm run deploy:testnet -w contracts` | Deploys Registry → Vault → Paymaster → Counter; writes `deployments/botTestnet.json` |
| init | `npm run init:testnet -w contracts` | Funds paymaster float + vault budget, sets the demo policy (allowlist: Counter) |
| smoke | `npm run smoke:testnet -w contracts` | Read-only health check against RPC + explorer |
| e2e | `npm run e2e:testnet -w contracts` | Gasless round trip: relays `Counter.increment()` for a 0-gas wallet, prints the gas delta |
| verify | `npm run verify:testnet -w contracts` | Source verification on scan.bohr.life (solc long version read from build-info) |
| recover | `npm run recover:testnet -w contracts` | Withdraws funds from legacy contracts. **`DRY_RUN=1` by default**; set `DRY_RUN=0` to execute |
| gastrace | `npx hardhat run scripts/gastrace.ts` | Gas calibration — measures relay intrinsic cost vs paymaster overhead constants |

### Deployed testnet addresses

| Contract | Address |
|---|---|
| SponsorPolicyRegistry | [`0xa6280A233e04127218aEf5769b719b3e08A88f4b`](https://scan.bohr.life/address/0xa6280A233e04127218aEf5769b719b3e08A88f4b) |
| BudgetVault | [`0xE11546ED280A18ebd200ba9Bf74D5B07cE7B7b26`](https://scan.bohr.life/address/0xE11546ED280A18ebd200ba9Bf74D5B07cE7B7b26) |
| GaslessPaymaster | [`0x7150605573EB08a9ffe6bB804B232fdf31c7DAC4`](https://scan.bohr.life/address/0x7150605573EB08a9ffe6bB804B232fdf31c7DAC4) |
| Counter | [`0x1b1d2Db06F560Fe78B9018B6641358b0aBadb322`](https://scan.bohr.life/address/0x1b1d2Db06F560Fe78B9018B6641358b0aBadb322) |

All four are verified. Source of truth: `contracts/deployments/botTestnet.json` (relayer: `0x2a9900a66C13361eb5495ef7dE6D2456Fe0B1B3c`).

## API

Base URL `http://localhost:8787`, JSON in/out. Auth: `x-ampere-key` header (owner key for admin routes; per-sponsor ownership is `sha256(key)` in the store).

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/health` | — | `{ ok, chain, block, gasPriceGwei }` |
| POST | `/v1/sponsors` | owner key | Create sponsor: **on-chain `setPolicy` (+ optional `depositBot`) first**, then store. `502` if the chain write fails — no store record is left behind. |
| PATCH | `/v1/sponsors/:appKey` | owner key | Update policy — chain-first; store unchanged on failure |
| POST | `/v1/sponsors/:appKey/simulate` | — | `{ sponsorable, policyPaused, gasCost, gasPriceGwei, budgetRemaining }` |
| POST | `/v1/sponsors/:appKey/relay` | — | Relays a call; `{ tx, status, gasUsed, explorer }` |
| GET | `/v1/sponsors/:appKey/usage` | — | `{ relayed, failed, budgetUsed, budgetRemaining, perAddress }` |
| GET | `/v1/sponsors/:appKey/tx` | — | `{ recentTx: [...] }` |

```bash
# create a sponsor (owner auth)
curl -X POST http://localhost:8787/v1/sponsors \
  -H "content-type: application/json" -H "x-ampere-key: dev-owner-key" \
  -d '{"policy":{"allowlist":["0x1b1d2Db06F560Fe78B9018B6641358b0aBadb322"],
       "perAddressCap":"0.05","dailyBudget":"200"},"depositBot":"5"}'

# relay a call
curl -X POST http://localhost:8787/v1/sponsors/$APP_KEY/relay \
  -H "content-type: application/json" \
  -d '{"to":"0x1b1d...b322","data":"0xd09de08a","beneficiary":"0x<you>"}'
```

Notes:
- **Empty allowlist is rejected** (deny-all).
- `relay` is rate-limited per appKey (`429` + `Retry-After`). Reverts are not retried (deterministic policy rejections).
- Default `gasBudget` = `350_000 gas × current gasPrice` (estimates are unreliable on BOT Chain — see quirks).
- The store is **in-memory**; `SEED_APP_KEY` re-registers a sponsor from its on-chain policy at startup.
- CORS via `API_ALLOWED_ORIGINS` (default `*`; auth is header-based, no cookies).
- `401` bad owner key · `403` not policy owner · `404` unknown appKey · `422` relay failed · `502` chain write failed.

## Relay package

Two surfaces:

1. **`@ampere/relay/client`** (library, used by the API): viem clients, ABIs, `relayWithRetry` (3 attempts, 1s→2s→4s backoff, reverts not retried), `isSponsorable`, `budgetOf`, `readPolicy`, `setPolicy`, `depositNative`. All governance writes go through a single `NonceQueue` (serialized nonces, one signer).
2. **`relay/src/index.ts`** (standalone, `npm run start -w relay`): self-check (bytecode exists, RPC ok) + JSON heartbeat every `HEARTBEAT_SECONDS` — relayed/failed counts, gas spent, budget remaining, relayer balance. Counters persist to `relay/relay-state.json` (git-ignored), so relays driven by the API process show up in the monitor. It has **no HTTP server**.

## SDK

```ts
import { Ampere } from "@ampere/sdk";

const ampere = new Ampere({ appKey: process.env.AMPERE_KEY }); // apiUrl defaults to localhost:8787

await ampere.simulate({ to, data });                  // { sponsorable, gasCost, budgetRemaining, ... }
await ampere.execute({ to, data, beneficiary });      // { tx, status, gasUsed, explorer }
await ampere.usage();                                 // { relayed, failed, budgetUsed, ... }
await ampere.recentTx();                              // { recentTx: [...] }
Ampere.erc20Transfer(token, to, amount);              // calldata helper
```

Errors throw `AmpereError` with `.status` and parsed `.body`.

## Frontend

Vite dev server (`npm run dev -w frontend`), three views:

- **Dashboard** — vault balance, spent today, cap, on-chain policy + budget bar, API usage.
- **Policy editor** — writes `setPolicy` directly from the wallet (bypasses the API entirely; requires policy owner).
- **Relay playground** — same `Counter.increment()` gasless vs direct.

Network for MetaMask: RPC `https://rpc.bohr.life`, chain ID `968`, currency `BOT`. The "direct" path typically fails in wallets — this is the problem Ampere works around (see quirks).

## Chain quirks & design decisions

- **`eth_feeHistory` is broken** (returns baseFee `0x0`) → never estimate EIP-1559 fees. Every send sets **explicit `gasPrice` (20 gwei, from `eth_gasPrice`) and explicit gas limit**. This is why ordinary wallets cannot send on BOT Chain as-is.
- **`eth_estimateGas` is unreliable** → relay transactions use a fixed `500_000` gas limit; the API authorizes `350_000 × gasPrice` as the sponsorship budget; the paymaster charges *measured* gas and reverts if it exceeds the authorized amount (calibrated by `scripts/gastrace.ts`).
- **Policy lives on-chain.** The API is convenience + telemetry: pre-checks and rate limits can be bypassed; caps/allowlists cannot. Writes are chain-first — a failed `setPolicy` returns `502` and creates no store record.
- **Single relayer signer**, serialized through `NonceQueue` — avoids nonce races between governance writes (`setPolicy`, `depositNative`) and relays.
- **Recovery**: `recover:testnet` is `DRY_RUN=1` by default.

## Security invariants

1. No user custody — vault holds sponsorship budget only; `withdraw` is owner-only.
2. Caps, allowlist, expiry and pause enforced by `isSponsorable()` + paymaster checks, not by the API.
3. Empty allowlist = deny-all.
4. `pause()`/`unpause()` owner-only; `nonReentrant` on state-mutating methods; state updated before external transfers.
5. Admin routes authenticated (`x-ampere-key`); policy ownership checked per appKey (`sha256`).
6. Rate limit per appKey (default 30 relays/min).
7. No secrets in the repo — `.env*` git-ignored; CI rejects committed `0x…64-hex` keys and `ghp_` tokens.

## Testing & CI

```bash
npm run typecheck     # all workspaces
npm test              # 21 Hardhat tests (contracts)
npm run build         # workspaces (frontend = tsc + vite)
```

CI (`.github/workflows/ci.yml`): contracts compile + test + typecheck · relay/api/sdk typecheck · frontend build · read-only testnet smoke on `main` · secret scan.
