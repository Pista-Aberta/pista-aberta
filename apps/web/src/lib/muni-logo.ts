/** URL pública do escudo dun concello (logoUrl) ou data URL interna. */
export function municipalityCrestSrc(muni: {
  settings?: {
    logoUrl?: string | null;
    logoDataUrl?: string | null;
  } | null;
}): string | null {
  const url = muni.settings?.logoUrl ?? muni.settings?.logoDataUrl ?? null;
  if (!url || !String(url).trim()) return null;
  return String(url);
}
