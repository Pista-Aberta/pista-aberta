import { fetchPublicConfig } from "./public-config";

/** Cliente: VITE_PA_SINGLE_MUNI ou flag público da API. */
export function singleMuniBuildFlag(): string | null {
  const v = (import.meta.env.VITE_PA_SINGLE_MUNI as string | undefined)?.trim();
  if (!v) return null;
  const slug = v.toLowerCase().replace(/[^a-z0-9-]/g, "");
  return slug || null;
}

let cachedPromise: Promise<string | null> | null = null;

/** Slug do único concello (REVISION-22 A8), ou null se multiconcello. */
export async function resolveSingleMuni(): Promise<string | null> {
  const fromBuild = singleMuniBuildFlag();
  if (fromBuild) return fromBuild;
  if (!cachedPromise) {
    cachedPromise = fetchPublicConfig().then((c) => {
      const s = (c.singleMuni ?? "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
      return s || null;
    });
  }
  return cachedPromise;
}

export function singleMuniSyncHint(): string | null {
  return singleMuniBuildFlag();
}
