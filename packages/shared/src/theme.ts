/** Tema visual por concello (REVISION-20 H5: brand só no escudo; barras internas mariño). */

export type MunicipalityTheme = {
  /** Cor do escudo / acentos (--pa-brand). Non se usa como fondo de barra. */
  brand: string;
  /** Acento secundario (destaques suaves; por defecto = brand). */
  accent: string;
};

/** Fallback de plataforma (mariño neutro), NUNCA a cor dun concello demo. */
export const DEFAULT_THEME: MunicipalityTheme = {
  brand: "#002B4A",
  accent: "#002B4A",
};

const HEX = /^#([0-9a-fA-F]{6})$/;

export function normalizeHex(input: string | undefined | null, fallback: string): string {
  if (!input) return fallback;
  const s = input.trim();
  if (HEX.test(s)) return s.toUpperCase();
  if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s.toUpperCase()}`;
  return fallback;
}

function luminance(hex: string): number {
  const h = normalizeHex(hex, "#000000").slice(1);
  const rgb = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!;
}

/** Contraste relativo WCAG entre dous hex. */
export function contrastRatio(a: string, b: string): number {
  const L1 = luminance(a);
  const L2 = luminance(b);
  const light = Math.max(L1, L2);
  const dark = Math.min(L1, L2);
  return (light + 0.05) / (dark + 0.05);
}

/** Asegura contraste ≥ 4.5:1 con texto branco; se non, escurece o brand. */
export function ensureBrandContrast(brand: string): {
  brand: string;
  ok: boolean;
  ratio: number;
} {
  const white = "#FFFFFF";
  let b = normalizeHex(brand, DEFAULT_THEME.brand);
  let ratio = contrastRatio(b, white);
  if (ratio >= 4.5) return { brand: b, ok: true, ratio };

  // Escurecer ata AA ou fallback institucional
  for (let i = 0; i < 8 && ratio < 4.5; i++) {
    b = darkenHex(b, 0.12);
    ratio = contrastRatio(b, white);
  }
  if (ratio < 4.5) {
    return { brand: DEFAULT_THEME.brand, ok: false, ratio: contrastRatio(DEFAULT_THEME.brand, white) };
  }
  return { brand: b, ok: false, ratio };
}

function darkenHex(hex: string, amount: number): string {
  const h = normalizeHex(hex, "#000000").slice(1);
  const parts = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16);
    return Math.max(0, Math.round(v * (1 - amount)))
      .toString(16)
      .padStart(2, "0");
  });
  return `#${parts.join("")}`.toUpperCase();
}

export function resolveTheme(input?: {
  accentColor?: string;
  theme?: Partial<MunicipalityTheme> | null;
}): MunicipalityTheme {
  const rawBrand =
    input?.theme?.brand ?? input?.accentColor ?? DEFAULT_THEME.brand;
  const { brand } = ensureBrandContrast(rawBrand);
  const accent = normalizeHex(
    input?.theme?.accent ?? input?.accentColor ?? brand,
    brand,
  );
  return { brand, accent };
}

/** CSS custom properties a aplicar no documento. */
export function themeToCssVars(theme: MunicipalityTheme): Record<string, string> {
  return {
    "--pa-brand": theme.brand,
    "--pa-accent": theme.accent,
  };
}
