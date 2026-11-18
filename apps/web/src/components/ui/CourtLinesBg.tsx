/** Debuxo de pista en liña (hero claro v3) — sen recheo. */
export function CourtLinesBg({
  className = "",
  stroke = "#CFE3F2",
  strokeWidth = 3,
}: {
  className?: string;
  stroke?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 360 220"
      className={className}
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
    >
      <rect x="10" y="10" width="340" height="200" rx="6" />
      <path d="M180 10v200" />
      <circle cx="180" cy="110" r="38" />
    </svg>
  );
}
