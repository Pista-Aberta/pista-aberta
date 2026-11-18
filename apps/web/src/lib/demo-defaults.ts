/** Helpers da demo (fóra de .tsx). Sen slugs reais de concellos aquí. */

import { api } from "./api";

export type DemoPrimarySlug = string | null;

/**
 * Primeiro concello publicado (non sandbox) de `/api/municipalities`.
 * Se non hai ningún, `null` (a guía `/demo` amosa o aviso correspondente).
 */
export async function resolveDemoPrimarySlug(): Promise<DemoPrimarySlug> {
  try {
    const r = await api.municipalities();
    /* /api/municipalities xa exclúe sandbox e non publicados. */
    return r.data?.[0]?.slug ?? null;
  } catch {
    return null;
  }
}

/** Personas SAML por slug actual da barra demo. */
export function demoPersonaKey(
  base: "cidada" | "admin" | "club" | "staff" | "deputacion",
  slug: string | null,
): string | null {
  if (base === "deputacion") return "deputacion";
  if (slug === "proba") {
    if (base === "cidada") return "cidada-proba";
    if (base === "admin") return "admin-proba";
    /* Proba non ten club nin conserxe na demo */
    return null;
  }
  return base;
}
