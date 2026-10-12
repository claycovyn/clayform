/** The Clayform mark: clay turning on a potter's wheel, forming a C. */
export function LogoMark({ size = 32, spin = false }: { size?: number; spin?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#2F5BFF" />
      <g fill="none" stroke="#FFFFFF" strokeLinecap="round" strokeWidth="5.5">
        <path d="M45 19A18.5 18.5 0 1 0 45 45" />
        <path d="M39.5 24.5A10.5 10.5 0 1 0 39.5 39.5" className={spin ? "wheel-spin" : undefined} />
      </g>
      <circle cx="32" cy="32" r="3.2" fill="#FFFFFF" />
    </svg>
  );
}

export function Logo({ size = 28, dark = false, spin = false }: { size?: number; dark?: boolean; spin?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2" aria-label="Clayform">
      <LogoMark size={size} spin={spin} />
      <span
        className={`font-display font-extrabold ${dark ? "text-white" : "text-ink"}`}
        style={{ fontSize: size * 0.82, letterSpacing: "-0.04em" }}
      >
        clayform
      </span>
    </span>
  );
}
