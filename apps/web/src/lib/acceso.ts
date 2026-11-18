/** Rutas e cookie/localStorage do último concello (REVISION-15 L1). */

export const LAST_MUNI_KEY = "pa_last_muni";

export type LastMuni = { slug: string; name: string };

export function readLastMuni(): LastMuni | null {
  try {
    const raw = localStorage.getItem(LAST_MUNI_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LastMuni;
    if (parsed?.slug && parsed?.name) return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

export function writeLastMuni(slug: string, name: string) {
  try {
    localStorage.setItem(LAST_MUNI_KEY, JSON.stringify({ slug, name }));
  } catch {
    /* ignore */
  }
}

/** Path de identificación dun concello. */
export function accesoPath(
  slug: string,
  opts?: {
    returnTo?: string;
    perfil?: "vecina" | "entidade" | "persoal";
    aviso?: "saida";
  },
): string {
  const qs = new URLSearchParams();
  if (opts?.returnTo) qs.set("returnTo", opts.returnTo);
  if (opts?.perfil && opts.perfil !== "vecina") qs.set("perfil", opts.perfil);
  if (opts?.aviso) qs.set("aviso", opts.aviso);
  const q = qs.toString();
  return q ? `/c/${slug}/acceso?${q}` : `/c/${slug}/acceso`;
}

/** Extrae slug dun returnTo ou path `/c/:slug/...`. */
export function slugFromReturnTo(returnTo: string | null | undefined): string | null {
  if (!returnTo) return null;
  return returnTo.match(/\/c\/([^/]+)/)?.[1] ?? null;
}
