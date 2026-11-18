/** Cliente: mesma paleta que apps/api/src/lib/shield-color.ts */
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

export function detectShieldBrandColor(slug: string): string {
  const s = slug.trim().toLowerCase();
  if (!s) return PALETTE[0]!;
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return PALETTE[h % PALETTE.length]!;
}
