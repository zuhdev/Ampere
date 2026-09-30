import { useEffect, useState } from "react";
import { useWriteContract, useWaitForTransactionReceipt, type UseWriteContractReturnType } from "wagmi";
import { parseEther } from "viem";
import { REGISTRY, DEMO_APP_KEY, explorerTx } from "../lib/constants";
import { registryAbi } from "../lib/abi";

export default function PolicyEditor({ pushToast }: { pushToast: (k: any, t: string) => void }) {
  const [allowlist, setAllowlist] = useState("");
  const [perAddressCap, setPerAddressCap] = useState("0.05");
  const [dailyBudget, setDailyBudget] = useState("200");
  const [expiresAt, setExpiresAt] = useState("");

  const {
    writeContractAsync,
    data: txHash,
    isPending: signing,
  }: UseWriteContractReturnType = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (receipt.isSuccess) pushToast("ok", "Policy updated on-chain");
  }, [receipt.isSuccess, pushToast]);
  useEffect(() => {
    if (receipt.isError) pushToast("err", String(receipt.error?.message ?? "transaction failed").slice(0, 140));
  }, [receipt.isError, receipt.error, pushToast]);

  async function save() {
    const targets = allowlist
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((a) => a.trim() as `0x${string}`);

    if (targets.length === 0) {
      pushToast("err", "Empty allowlist is deny-all — add at least one target");
      return;
    }

    try {
      await writeContractAsync({
        address: REGISTRY,
        abi: registryAbi,
        functionName: "setPolicy",
        args: [
          DEMO_APP_KEY,
          {
            allowlist: targets,
            blocklist: [],
            perAddressCap: parseEther(perAddressCap),
            dailyBudget: parseEther(dailyBudget),
            expiresAt: expiresAt ? Math.floor(new Date(expiresAt).getTime() / 1000) : 0,
            paused: false,
          },
        ],
      });
      pushToast("info", "Transaction sent — waiting for confirmation…");
    } catch (e: any) {
      pushToast("err", String(e?.message ?? e).slice(0, 140));
    }
  }

  return (
    <>
      <div className="page-head">
        <span className="kicker">Policy</span>
        <h2>Sponsorship rules</h2>
        <p className="muted">Written on-chain — the API can't loosen them.</p>
      </div>

      <section className="card narrow">
        <div className="card-head">
          <h2>Policy</h2>
          <span className="chip neutral">
            <span className="mono">{DEMO_APP_KEY.slice(0, 10)}…{DEMO_APP_KEY.slice(-6)}</span>
          </span>
        </div>

        <div className="field">
          <label htmlFor="allowlist">Allowlist — target contracts (comma or newline separated)</label>
          <textarea
            id="allowlist"
            rows={3}
            value={allowlist}
            onChange={(e) => setAllowlist(e.target.value)}
            placeholder="0x1b1d2Db0…, 0xRouter…"
          />
          <p className="hint">Empty = deny-all.</p>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="cap">Per-address cap (BOT / 24h)</label>
            <input id="cap" className="mono" value={perAddressCap} onChange={(e) => setPerAddressCap(e.target.value)} />
            <p className="hint">Rolling, per beneficiary.</p>
          </div>
          <div className="field">
            <label htmlFor="daily">Daily budget (BOT)</label>
            <input id="daily" className="mono" value={dailyBudget} onChange={(e) => setDailyBudget(e.target.value)} />
            <p className="hint">Resets 00:00 UTC.</p>
          </div>
        </div>

        <div className="field">
          <label htmlFor="expires">Expires at (optional, ISO date)</label>
          <input
            id="expires"
            className="mono"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            placeholder="2026-12-31T00:00:00Z"
          />
        </div>

        <div className="card-actions">
          <button className="btn primary" onClick={save} disabled={signing || receipt.isPending}>
            {signing ? "Awaiting signature…" : receipt.isPending ? "Confirming…" : "Save policy"}
          </button>
          {txHash && (
            <span className="tx-pill">
              <span className="dot" />
              <a href={explorerTx(txHash)} target="_blank" rel="noreferrer">
                {txHash.slice(0, 14)}…
              </a>
            </span>
          )}
        </div>
      </section>
    </>
  );
}
