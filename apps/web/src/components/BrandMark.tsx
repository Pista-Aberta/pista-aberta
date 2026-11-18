/** Icona Pista Aberta (Rev24 C11 — todas as cabeceiras). */
export function BrandMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden>
      <rect width="36" height="36" rx="10" fill="#007BC4" />
      <rect
        x="8"
        y="10"
        width="20"
        height="16"
        rx="2"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="2"
      />
      <path d="M18 10v16" stroke="#FFFFFF" strokeWidth="2" />
      <circle cx="18" cy="18" r="3.4" fill="#F2B33D" stroke="#F2B33D" strokeWidth="1" />
    </svg>
  );
}
