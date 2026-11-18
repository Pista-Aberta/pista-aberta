import { useState } from "react";

/** Escudo: imaxe do concello ou marcador coa inicial. */
export function ShieldMark({
  initial,
  size = 40,
  className = "",
  src,
  variant = "onBrand",
  brandColor,
  eager = false,
}: {
  initial: string;
  size?: number;
  className?: string;
  src?: string | null;
  /** onBrand = sobre barra mariño; onLight = sobre fondo claro */
  variant?: "onBrand" | "onLight";
  /**
   * Cor do concello no escudo (REVISION-20 H5: nunca no fondo da barra).
   * En onBrand e onLight pinta o escudo con esta cor.
   */
  brandColor?: string;
  /** Sen lazy-load (tarxetas de inicio). */
  eager?: boolean;
}) {
  const letter = (initial || "?").slice(0, 1).toUpperCase();
  const h = Math.round(size * 1.15);
  const apiPrefix = import.meta.env.VITE_API_URL ?? "";
  const resolvedSrc =
    src && src.startsWith("/api/") && apiPrefix ? `${apiPrefix}${src}` : src;
  const [broken, setBroken] = useState(false);

  const onLight = variant === "onLight";
  const brand = brandColor ?? "var(--pa-brand, #1E2124)";
  const fill = brand;
  const stroke = onLight ? brand : "#FFFFFF";
  const textFill = "#FFFFFF";

  const fallback = (
    <svg
      width={size}
      height={h}
      viewBox="0 0 40 46"
      role="img"
      aria-hidden={false}
      aria-label={`Escudo ${letter}`}
      className={className}
    >
      <path
        d="M2 2h36v20c0 11-8 19-18 22C10 41 2 33 2 22z"
        fill={fill}
        fillOpacity={1}
        stroke={stroke}
        strokeWidth="2"
      />
      <text
        x="20"
        y="28"
        textAnchor="middle"
        fontFamily="Atkinson Hyperlegible, sans-serif"
        fontSize="18"
        fontWeight="700"
        fill={textFill}
      >
        {letter}
      </text>
    </svg>
  );

  if (resolvedSrc && !broken) {
    return (
      <img
        src={resolvedSrc}
        alt=""
        width={size}
        height={h}
        loading={eager ? "eager" : undefined}
        decoding="async"
        className={`object-contain ${className}`}
        style={{ width: size, height: h }}
        onError={() => setBroken(true)}
      />
    );
  }
  return fallback;
}
