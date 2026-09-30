/** Ampere mark — geometric "A" monogram: two precise strokes, open accent crossbar. */

export function AmpereMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="ampere-mark"
    >
      <path
        d="M4.5 20.5 L12 4 L19.5 20.5"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7 15 H9.2"
        stroke="var(--accent)"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <path
        d="M14.8 15 H17"
        stroke="var(--accent)"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function AmpereLogo({ markSize = 30 }: { markSize?: number }) {
  return (
    <span className="logo-lockup">
      <AmpereMark size={markSize} />
      <span className="logo-text">
        <strong>Ampere</strong>
      </span>
    </span>
  );
}
