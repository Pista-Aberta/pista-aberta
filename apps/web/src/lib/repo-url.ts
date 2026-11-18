/**
 * URL pública do código (sen barra final).
 * Baleira por defecto; en demo/landing póñese via VITE_REPO_URL.
 */
const raw = (import.meta.env.VITE_REPO_URL as string | undefined)?.trim() ?? "";

export const REPO_URL = raw.replace(/\/+$/, "").replace(/\.git$/, "");

export const REPO_GIT_URL = REPO_URL ? `${REPO_URL}.git` : "";

export function repoBlobUrl(relPath: string): string {
  if (!REPO_URL) return "";
  const clean = relPath.replace(/^\/+/, "");
  return `${REPO_URL}/blob/main/${clean}`;
}
