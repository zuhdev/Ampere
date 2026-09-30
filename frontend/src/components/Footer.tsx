import { AmpereLogo } from "./Logo";
import { REGISTRY, VAULT, PAYMASTER, COUNTER, BOT_LINKS, explorerAddress, type Tab } from "../lib/constants";

interface LinkDef {
  label: string;
  href: string;
}

function LinkList({ links }: { links: LinkDef[] }) {
  return (
    <>
      {links.map((l) => (
        <a key={l.label} className="footer-link" href={l.href} target="_blank" rel="noreferrer">
          {l.label}
          <span className="ext" aria-hidden="true">
            ↗
          </span>
        </a>
      ))}
    </>
  );
}

export default function Footer({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const contracts: LinkDef[] = [
    { label: "SponsorPolicyRegistry", href: REGISTRY },
    { label: "GaslessPaymaster", href: PAYMASTER },
    { label: "BudgetVault", href: VAULT },
    { label: "Counter (demo)", href: COUNTER },
  ]
    .filter((c) => c.href)
    .map((c) => ({ label: c.label, href: explorerAddress(c.href) }));

  const product: LinkDef[] = [
    { label: "Dashboard", href: "#dashboard" },
    { label: "Policy editor", href: "#policy" },
    { label: "Relay playground", href: "#playground" },
  ];

  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-grid">
          <div className="footer-brand">
            <AmpereLogo />
            <span className="chip ok">
              <span className="dot" /> Live on BOT Testnet · chain 968
            </span>
          </div>

          <div className="footer-col">
            <h4>Product</h4>
            {product.map((p) => (
              <button
                key={p.label}
                className="footer-link as-button"
                onClick={() => onNavigate(p.href.slice(1) as Tab)}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="footer-col">
            <h4>Contracts</h4>
            <LinkList links={contracts} />
          </div>

          <div className="footer-col">
            <h4>BOT Chain</h4>
            <LinkList
              links={[
                { label: "Website", href: BOT_LINKS.website },
                { label: "Block explorer", href: BOT_LINKS.explorer },
                { label: "Developer docs", href: BOT_LINKS.docs },
                { label: "Testnet faucet", href: BOT_LINKS.faucet },
                { label: "GitHub", href: BOT_LINKS.github },
              ]}
            />
          </div>
        </div>

        <div className="footer-bottom">
          <a
            className="botchain-badge"
            href={BOT_LINKS.website}
            target="_blank"
            rel="noreferrer"
            title="botchain.ai"
          >
            <span className="badge-label">Built on</span>
            <img src="/botchain-footer-logo.png" alt="BOT Chain" className="botchain-logo" />
          </a>
          <span className="muted">© 2026 Ampere · Testnet-only (chain 968)</span>
        </div>
      </div>
    </footer>
  );
}
