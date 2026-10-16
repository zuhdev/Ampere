import { useState } from "react";
import { useAccount, usePublicClient, useWriteContract, type UseWriteContractReturnType } from "wagmi";
import { encodeFunctionData, formatEther } from "viem";
import { COUNTER, DEMO_APP_KEY, API_URL, explorerTx, DEFAULT_GAS_PRICE_WEI } from "../lib/constants";
import { counterAbi } from "../lib/abi";

export default function Playground({ pushToast }: { pushToast: (k: any, t: string) => void }) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const [gaslessTx, setGaslessTx] = useState<string | null>(null);
  const [directTx, setDirectTx] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { writeContractAsync }: UseWriteContractReturnType = useWriteContract();

  async function relayGasless() {
    if (!address) {
      pushToast("err", "Connect a wallet first");
      return;
    }
    setBusy(true);
    try {
      const data = encodeFunctionData({ abi: counterAbi, functionName: "increment" });
      const res = await fetch(`${API_URL}/v1/sponsors/${DEMO_APP_KEY}/relay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: COUNTER, data, beneficiary: address }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "relay failed");
      setGaslessTx(j.tx);
      pushToast("ok", `Confirmed — you paid 0 BOT (gasUsed ${j.gasUsed})`);
    } catch (e: any) {
      pushToast("err", String(e?.message ?? e).slice(0, 140));
    } finally {
      setBusy(false);
    }
  }

  async function sendDirect() {
    if (!address) {
      pushToast("err", "Connect a wallet first");
      return;
    }
    setBusy(true);
    try {
      const hash = (await (window as any).ethereum?.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: address,
            to: COUNTER,
            data: encodeFunctionData({ abi: counterAbi, functionName: "increment" }),
            gasPrice: ("0x" + DEFAULT_GAS_PRICE_WEI.toString(16)) as `0x${string}`,
          },
        ],
      })) as `0x${string}`;
      if (!hash) throw new Error("no wallet provider");
      setDirectTx(hash);
      const rc = await publicClient.waitForTransactionReceipt({ hash });
      pushToast("info", `Direct — you paid ${formatEther(rc.gasUsed * DEFAULT_GAS_PRICE_WEI)} BOT`);
    } catch (e: any) {
      pushToast("err", String(e?.shortMessage ?? e?.message ?? e).slice(0, 140));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <span className="kicker">Playground</span>
        <h2>Gasless vs direct</h2>
        <p className="muted">Same call. Two payers.</p>
      </div>

      <div className="cards-row two">
        <section className="card featured">
          <div className="card-head">
            <h2>Gasless</h2>
            <span className="chip ok">
              <span className="dot" /> sponsor pays
            </span>
          </div>
          <p className="muted">You sign, the sponsor pays. 0 BOT from your wallet.</p>

          <dl className="call-preview mono">
            <div>
              <dt>to</dt>
              <dd>{COUNTER || "—"}</dd>
            </div>
            <div>
              <dt>method</dt>
              <dd>increment()</dd>
            </div>
            <div>
              <dt>you pay</dt>
              <dd className="accent">0 BOT</dd>
            </div>
          </dl>

          <div className="card-actions">
            <button className="btn primary" disabled={busy} onClick={relayGasless}>
              {busy ? "Relaying…" : "Send gasless"}
            </button>
            {gaslessTx && (
              <span className="tx-pill">
                <span className="dot" />
                <a href={explorerTx(gaslessTx)} target="_blank" rel="noreferrer">
                  {gaslessTx.slice(0, 14)}…
                </a>
              </span>
            )}
          </div>
        </section>

        <section className="card dashed">
          <div className="card-head">
            <h2>Direct</h2>
            <span className="chip neutral">needs BOT</span>
          </div>
          <p className="muted">Straight from your wallet — and fee estimation is broken on BOT Chain.</p>

          <dl className="call-preview mono dim">
            <div>
              <dt>to</dt>
              <dd>{COUNTER || "—"}</dd>
            </div>
            <div>
              <dt>method</dt>
              <dd>increment()</dd>
            </div>
            <div>
              <dt>you pay</dt>
              <dd>gas</dd>
            </div>
          </dl>

          <div className="card-actions">
            <button className="btn" disabled={busy} onClick={sendDirect}>
              {busy ? "Sending…" : "Send direct"}
            </button>
            {directTx && (
              <span className="tx-pill">
                <a href={explorerTx(directTx)} target="_blank" rel="noreferrer">
                  {directTx.slice(0, 14)}…
                </a>
              </span>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
