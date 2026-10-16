/* Ampere marketing site — no dependencies. */
(() => {
  "use strict";

  document.documentElement.classList.add("js");

  /* ---------------- nav ---------------- */
  const nav = document.getElementById("nav");
  const toggle = document.getElementById("navToggle");
  const links = document.getElementById("navLinks");

  const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 12);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  toggle.addEventListener("click", () => {
    const open = links.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
  });

  links.addEventListener("click", (e) => {
    if (e.target.tagName === "A") {
      links.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    }
  });

  /* ---------------- active section in nav ---------------- */
  const navAnchors = [...links.querySelectorAll("a[href^='#']")];
  const sections = navAnchors
    .map((a) => document.getElementById(a.getAttribute("href").slice(1)))
    .filter(Boolean);

  let ticking = false;
  const markActive = () => {
    ticking = false;
    const line = window.scrollY + window.innerHeight * 0.35;
    let current = null;
    for (const sec of sections) {
      if (sec.offsetTop <= line) current = sec;
    }
    navAnchors.forEach((a) =>
      a.classList.toggle("is-active", !!current && a.getAttribute("href") === `#${current.id}`)
    );
  };
  markActive();
  window.addEventListener(
    "scroll",
    () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(markActive);
      }
    },
    { passive: true }
  );
  window.addEventListener("load", markActive);

  /* ---------------- scroll reveal ---------------- */
  const revealAll = () =>
    document.querySelectorAll(".reveal").forEach((el) => el.classList.add("in"));

  // print / PDF export and ?noanim should never ship hidden content
  if (new URLSearchParams(window.location.search).has("noanim")) revealAll();
  window.addEventListener("beforeprint", revealAll);

  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          revealObserver.unobserve(entry.target);
        }
      });
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
  );

  document.querySelectorAll(".reveal").forEach((el, i) => {
    el.style.transitionDelay = `${Math.min(i % 4, 3) * 60}ms`;
    revealObserver.observe(el);
  });

  /* ---------------- tabs ---------------- */
  const tabs = document.querySelectorAll(".tab");
  const panels = document.querySelectorAll(".tab-panel");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const name = tab.dataset.tab;
      tabs.forEach((t) => {
        const on = t === tab;
        t.classList.toggle("is-active", on);
        t.setAttribute("aria-selected", String(on));
      });
      panels.forEach((p) => {
        const on = p.dataset.panel === name;
        p.classList.toggle("is-active", on);
        p.hidden = !on;
      });
    });
  });

  /* ---------------- syntax highlighting ---------------- */
  const TS_KEYWORDS = [
    "const","let","var","await","async","import","from","export","default","function",
    "return","new","if","else","for","of","in","try","catch","throw","class","extends",
    "type","interface","as","void","null","undefined","true","false","this","typeof",
  ];
  const SH_KEYWORDS = ["curl","npm","npx","git","cd","cp","node","npm-run"];

  const escapeHtml = (s) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  function highlight(codeEl) {
    const lang = codeEl.dataset.lang || "ts";
    const kw = lang === "sh" ? SH_KEYWORDS : TS_KEYWORDS;
    const kwRe = kw.join("|");

    const patterns = [
      // comments
      lang === "sh" ? /#[^\n]*/y : /\/\/[^\n]*|\/\*[\s\S]*?\*\//y,
      // strings
      /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\\n]|\\.)*`/y,
      // keywords
      new RegExp(`\\b(?:${kwRe})\\b`, "y"),
      // numbers
      /\b\d[\d_]*(?:\.\d+)?n?\b/y,
      // calls
      /[A-Za-z_$][\w$]*(?=\s*\()/y,
    ];

    const cls = ["tok-cm", "tok-str", "tok-kw", "tok-num", "tok-fn"];
    const text = codeEl.textContent;
    let out = "";
    let i = 0;

    while (i < text.length) {
      let matched = false;
      for (let p = 0; p < patterns.length; p++) {
        patterns[p].lastIndex = i;
        const m = patterns[p].exec(text);
        if (m && m.index === i && m[0].length > 0) {
          out += `<span class="${cls[p]}">${escapeHtml(m[0])}</span>`;
          i += m[0].length;
          matched = true;
          break;
        }
      }
      if (!matched) {
        const next = text.slice(i);
        const stop = next.search(/[&#<"'`/]/);
        const chunk = stop === -1 ? next : next.slice(0, stop);
        if (chunk) {
          out += escapeHtml(chunk);
          i += chunk.length;
        } else {
          out += escapeHtml(text[i]);
          i += 1;
        }
      }
    }
    codeEl.innerHTML = out;
  }

  document.querySelectorAll("code[data-lang]").forEach(highlight);

  /* ---------------- copy buttons ---------------- */
  document.querySelectorAll(".copy-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const scope = btn.closest(".code-card, .terminal");
      const code = scope && scope.querySelector("code");
      if (!code) return;
      try {
        await navigator.clipboard.writeText(code.textContent);
        const prev = btn.textContent;
        btn.textContent = "Copied";
        btn.classList.add("copied");
        setTimeout(() => {
          btn.textContent = prev;
          btn.classList.remove("copied");
        }, 1600);
      } catch {
        btn.textContent = "Press ⌘C";
        setTimeout(() => (btn.textContent = "Copy"), 1600);
      }
    });
  });
})();
