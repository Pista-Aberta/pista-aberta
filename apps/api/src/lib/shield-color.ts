/**
 * REVISION-27 §3.1 — cor do escudo proposta (determinística por slug, non sempre marrón).
 */
const PALETTE = [
  "#006633",
  "#003366",
  "#8B1538",
  "#5A4636",
  "#007BC4",
  "#2E5C4A",
  "#6B4C9A",
  "#B85C00",
  "#1E4D6B",
  "#4A6741",
] as const;

function hashSlug(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) {
    h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function detectShieldBrandColor(slug: string, _province?: string): string {
  const s = slug.trim().toLowerCase();
  if (!s) return PALETTE[0]!;
  return PALETTE[hashSlug(s) % PALETTE.length]!;
}
