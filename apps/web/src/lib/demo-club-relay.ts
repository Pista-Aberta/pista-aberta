/** Resolución do destino do botón «club» da barra demo (DEMO_USERS_FILE). */

export type DemoClubRef = {
  id: string;
  name: string;
  shortName?: string | null;
};

export function normalizeDemoClubKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ");
}

/**
 * Se hai `clubName`, busca o club no concello; se non existe aínda,
 * devolve `/c/<slug>/clubs` (nunca `club-basquet` fixo).
 */
export function resolveDemoClubRelayPath(
  slug: string,
  clubName: string | null | undefined,
  clubs: DemoClubRef[],
): string {
  const base = `/c/${slug}/clubs`;
  if (!clubName?.trim()) return base;
  const key = normalizeDemoClubKey(clubName);
  const match = clubs.find(
    (c) =>
      normalizeDemoClubKey(c.name) === key ||
      normalizeDemoClubKey(c.shortName ?? "") === key,
  );
  return match ? `${base}/${match.id}` : base;
}
