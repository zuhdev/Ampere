import { useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import Dashboard from "./pages/Dashboard";
import PolicyEditor from "./pages/PolicyEditor";
import Playground from "./pages/Playground";
import Footer from "./components/Footer";
import { AmpereMark } from "./components/Logo";
import type { Tab } from "./lib/constants";

export interface Toast {
  id: number;
  kind: "ok" | "err" | "info";
  text: string;
}

let toastId = 0;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  function pushToast(kind: Toast["kind"], text: string) {
    const id = ++toastId;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }

  return { toasts, pushToast };
}

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "dashboard", label: "Dashboard" },
  { id: "policy", label: "Policy editor" },
  { id: "playground", label: "Relay playground" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const { toasts, pushToast } = useToasts();
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <button className="brand" onClick={() => setTab("dashboard")}>
            <AmpereMark size={34} />
            <span className="brand-text">
              <strong>Ampere</strong>
            </span>
          </button>

          <nav className="nav">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={tab === t.id ? "tab active" : "tab"}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="header-right">
            <span className="network-chip" title="BOT Chain testnet">
              <span className="dot pulse" />
              Testnet · 968
            </span>
            {isConnected ? (
              <button className="btn ghost mono" onClick={() => disconnect()} title="Disconnect">
                {address?.slice(0, 6)}…{address?.slice(-4)}
              </button>
            ) : (
              <button className="btn primary" onClick={() => connect({ connector: connectors[0] })}>
                Connect wallet
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="main">
        {tab === "dashboard" && <Dashboard pushToast={pushToast} />}
        {tab === "policy" && <PolicyEditor pushToast={pushToast} />}
        {tab === "playground" && <Playground pushToast={pushToast} />}
      </main>

      <Footer onNavigate={setTab} />

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <span className="toast-dot" />
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
