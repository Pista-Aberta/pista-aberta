/** Liñas de pista (docs/diseno/v2 · campo `lines`). Tons vía tokens. */

export type CourtArtType = "padel" | "pavillon" | "futbol" | "tenis" | "atletismo" | "sala";

const LINES: Record<CourtArtType, string> = {
  padel: "M52 2v64M2 24h100M2 44h100",
  pavillon:
    "M52 2v64M52 22a12 12 0 1 1 0 24 12 12 0 0 1 0-24M2 20h16v28H2M86 20h16v28H86",
  futbol:
    "M52 2v64M52 24a10 10 0 1 1 0 20 10 10 0 0 1 0-20M2 18h14v32H2M88 18h14v32H88",
  tenis: "M52 2v64M2 34h100M18 2v64M86 2v64",
  atletismo: "M20 10h64v48H20zM32 18v32M72 18v32M20 34h64",
  sala: "M52 2v64M52 22a12 12 0 1 1 0 24 12 12 0 0 1 0-24",
};

const TONE_CLASS: Record<CourtArtType, string> = {
  padel: "bg-court-padel",
  pavillon: "bg-court-pav",
  futbol: "bg-court-futbol",
  tenis: "bg-court-padel",
  atletismo: "bg-court-pav",
  sala: "bg-court-pav",
};

export function CourtArt({
  type = "padel",
  width = 104,
  height = 68,
  className = "",
  toneClass,
  fill = false,
  stroke = "currentColor",
}: {
  type?: CourtArtType;
  width?: number;
  height?: number;
  className?: string;
  /** Override Tailwind bg-* class (debe usar tokens). */
  toneClass?: string;
  /** Se true, non aplica width/height en liña (usa a clase). */
  fill?: boolean;
  /** Cor das liñas (REVISION-12 V9: #9CC6E4 sobre hero claro). */
  stroke?: string;
}) {
  return (
    <span
      aria-hidden
      className={[
        "inline-flex items-center justify-center text-on-dark",
        toneClass ?? TONE_CLASS[type] ?? TONE_CLASS.padel,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={fill ? undefined : { width, height }}
    >
      <svg
        width={fill ? 104 : Math.min(width * 0.85, 104)}
        height={fill ? 68 : Math.min(height * 0.7, 68)}
        viewBox="0 0 104 68"
        className={fill ? "h-[70%] w-[85%] max-w-[104px]" : undefined}
      >
        <g fill="none" stroke={stroke} strokeWidth="2">
          <rect x="2" y="2" width="100" height="64" rx="3" />
          <path d={LINES[type] ?? LINES.padel} />
        </g>
      </svg>
    </span>
  );
}

export function courtToneClass(type: CourtArtType): string {
  return TONE_CLASS[type] ?? TONE_CLASS.padel;
}
