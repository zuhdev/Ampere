import { useState } from "react";
import { useReadContract } from "wagmi";
import { formatEther } from "viem";
import { REGISTRY, VAULT, API_URL, DEMO_APP_KEY, explorerAddress } from "../lib/constants";
import { registryAbi, vaultAbi } from "../lib/abi";

interface Usage {
  relayed: number;
  failed: number;
}

export default function Dashboard({ pushToast }: { pushToast: (k: any, t: string) => void }) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(false);

  const policy = useReadContract({
    address: REGISTRY,
    abi: registryAbi,
    functionName: "getPolicies",
    args: [DEMO_APP_KEY],
  });

  const daySpent = useReadContract({
    address: REGISTRY,
    abi: registryAbi,
    functionName: "daySpent",
    args: [DEMO_APP_KEY],
  });

  const budget = useReadContract({
    address: VAULT,
    abi: vaultAbi,
    functionName: "budgetOf",
    args: [DEMO_APP_KEY],
  });

  async function refreshUsage() {
    setLoadingUsage(true);
    try {
      const res = await fetch(`${API_URL}/v1/sponsors/${DEMO_APP_KEY}/usage`);
      const j = await res.json();
      if (!res.ok || typeof j.relayed !== "number") throw new Error(j.error ?? "usage unavailable");
      setUsage({ relayed: j.relayed, failed: j.failed });
      pushToast("info", `Relayed ${j.relayed} · failed ${j.failed}`);
    } catch (e: any) {
      pushToast("err", String(e?.message ?? e).slice(0, 140));
    } finally {
      setLoadingUsage(false);
    }
  }

  const p = policy.data as any;
  const dailyBudget = p ? BigInt(p.dailyBudget) : 0n;
  const spent = (daySpent.data as bigint) ?? 0n;
  const pct = dailyBudget > 0n ? Number((spent * 10000n) / dailyBudget) / 100 : 0;
  const remaining = budget.data as bigint | undefined;

  return (
    <>
      <div className="page-head">
        <span className="kicker">Overview</span>
        <h2>Budget &amp; policy</h2>
      </div>

      <div className="stat-grid">
        <div className="stat-tile">
          <span className="stat-label">Vault</span>
          <span className="stat-value">{remaining !== undefined ? formatEther(remaining) : "—"}</span>
          <span className="stat-unit">BOT available</span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">Spent today</span>
          <span className="stat-value">{formatEther(spent)}</span>
          <span className="stat-unit">resets 00:00 UTC</span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">Cap / address</span>
          <span className="stat-value">{p ? formatEther(BigInt(p.perAddressCap)) : "—"}</span>
          <span className="stat-unit">BOT per 24h</span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">API</span>
          <span className="stat-value">
            {usage ? usage.relayed : "—"}
            {usage && usage.failed > 0 && <span className="stat-err"> / {usage.failed}</span>}
          </span>
          <button className="stat-action" onClick={refreshUsage} disabled={loadingUsage}>
            {loadingUsage ? "Loading…" : usage ? "Refresh" : "Load usage"}
          </button>
        </div>
      </div>

      <div className="cards-row">
        <section className="card">
          <div className="card-head">
            <h2>Daily budget</h2>
            <span className={`chip ${pct >= 90 ? "err" : "ok"}`}>
              <span className="dot" /> {pct.toFixed(1)}%
            </span>
          </div>
          <div className="bar">
            <div className="bar-fill" style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
          <div className="bar-meta">
            <span>{formatEther(spent)} BOT spent</span>
            <span>
              {dailyBudget > 0n && dailyBudget > spent ? formatEther(dailyBudget - spent) : "0"} left of{" "}
              {dailyBudget > 0n ? formatEther(dailyBudget) : "—"}
            </span>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Policy</h2>
            {p ? (
              <span className={`chip ${p.paused ? "err" : "ok"}`}>
                <span className="dot" /> {p.paused ? "Paused" : "Active"}
              </span>
            ) : (
              <span className="chip neutral">Loading…</span>
            )}
          </div>
          {p ? (
            <>
              <div className="kv">
                <span className="k">Daily budget</span>
                <span className="v mono">{formatEther(BigInt(p.dailyBudget))} BOT</span>
              </div>
              <div className="kv">
                <span className="k">Expires</span>
                <span className="v mono">
                  {BigInt(p.expiresAt) > 0n
                    ? new Date(Number(BigInt(p.expiresAt)) * 1000).toISOString().slice(0, 10)
                    : "never"}
                </span>
              </div>
              <div className="kv">
                <span className="k">Targets</span>
                <span className="v mono">{p.allowlist.length}</span>
              </div>
              <div className="target-list">
                {p.allowlist.map((t: string) => (
                  <a key={t} className="addr" href={explorerAddress(t)} target="_blank" rel="noreferrer">
                    {t.slice(0, 10)}…{t.slice(-6)}
                  </a>
                ))}
              </div>
            </>
          ) : (
            <p className="muted">Loading…</p>
          )}
        </section>
      </div>
    </>
  );
}
