/** Ilustración de liñas de pista para o hero da portada. */
export function CourtLinesArt({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 480 280"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect
        x="24"
        y="28"
        width="432"
        height="224"
        rx="8"
        stroke="currentColor"
        strokeWidth="2.5"
        opacity="0.55"
      />
      <path d="M240 28v224" stroke="currentColor" strokeWidth="2" opacity="0.45" />
      <path d="M24 140h432" stroke="currentColor" strokeWidth="2" opacity="0.35" />
      <circle cx="240" cy="140" r="36" stroke="currentColor" strokeWidth="2" opacity="0.5" />
      <path
        d="M24 70h72v140H24"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.4"
      />
      <path
        d="M456 70h-72v140h72"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.4"
      />
      <circle cx="78" cy="140" r="18" stroke="currentColor" strokeWidth="1.75" opacity="0.35" />
      <circle cx="402" cy="140" r="18" stroke="currentColor" strokeWidth="1.75" opacity="0.35" />
    </svg>
  );
}
