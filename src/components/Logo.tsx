export function LogoMark({ size = 32, blink = false }: { size?: number; blink?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="18" fill="#D4683F" />
      <path d="M40.4 19.6A15 15 0 1 0 40.4 44.4" fill="none" stroke="#FBF6EE" strokeWidth="8.5" strokeLinecap="round" />
      <rect x="46.5" y="20.5" width="5" height="23" rx="2.5" fill="#1B1714" className={blink ? "caret-blink" : undefined} />
    </svg>
  );
}

export function Logo({ size = 28, dark = false, blink = false }: { size?: number; dark?: boolean; blink?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2" aria-label="Clayform">
      <LogoMark size={size} blink={blink} />
      <span
        className={`font-display font-bold tracking-tight ${dark ? "text-cream" : "text-ink"}`}
        style={{ fontSize: size * 0.78, letterSpacing: "-0.03em" }}
      >
        clayform
      </span>
    </span>
  );
}
