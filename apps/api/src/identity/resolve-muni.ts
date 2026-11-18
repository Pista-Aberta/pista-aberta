/**
 * REVISION-55 G2 — concello para persoas novas (Cl@ve / certificado / OTP).
 * Orde: municipalityId explícito → slug do RelayState/returnTo (/c/:slug) →
 * PA_SINGLE_MUNI → erro municipality_required. Nunca un muniId de demo fixo.
 */
import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import * as t from "../db/schema.js";
import { getSingleMuniSlug } from "../env.js";
import { getMunicipalityById, getMunicipalityBySlug } from "../store/db.js";

const SLUG_IN_PATH = /(?:^|\/)c\/([a-z0-9-]+)(?:\/|$|\?|#)/i;

export function slugFromReturnTo(returnTo: string | null | undefined): string | null {
  if (!returnTo || typeof returnTo !== "string") return null;
  const m = returnTo.match(SLUG_IN_PATH);
  return m?.[1]?.toLowerCase() ?? null;
}

export async function resolveNewUserMunicipalityId(opts: {
  municipalityId?: string | null;
  returnTo?: string | null;
}): Promise<string> {
  const explicit = opts.municipalityId?.trim();
  if (explicit) {
    const muni = await getMunicipalityById(explicit);
    if (muni) return muni.id;
  }

  const slugFromPath = slugFromReturnTo(opts.returnTo);
  if (slugFromPath) {
    const muni = await getMunicipalityBySlug(slugFromPath);
    if (muni) return muni.id;
  }

  const single = getSingleMuniSlug();
  if (single) {
    const muni = await getMunicipalityBySlug(single);
    if (muni) return muni.id;
  }

  throw new Error("municipality_required");
}

/** Slug para redireccións / URLs: o da BD, o único da instalación, ou erro. */
export async function resolveMunicipalitySlugOrThrow(
  municipalityId: string,
): Promise<string> {
  const rows = await getDb()
    .select({ slug: t.municipalities.slug })
    .from(t.municipalities)
    .where(eq(t.municipalities.id, municipalityId))
    .limit(1);
  if (rows[0]?.slug) return rows[0].slug;
  const single = getSingleMuniSlug();
  if (single) return single;
  throw new Error("municipality_required");
}

export async function resolveDefaultMunicipalitySlug(): Promise<string | null> {
  return getSingleMuniSlug();
}
