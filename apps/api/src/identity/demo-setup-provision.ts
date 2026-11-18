import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "../db/client.js";
import * as t from "../db/schema.js";
import { isDemoEmptyMode, isDemoMode } from "../env.js";
import {
  censusFacilityNamesForIne,
  createMunicipalityFromWizard,
  publishPortal,
} from "../store/municipality-launch.js";
import { getMunicipalityBySlug, listClubs } from "../store/db.js";
import { getLoadedDemoFileUsers } from "./demo-users-file.js";
import { normalizeClubLookupKey } from "./demo-users-provision.js";
import {
  getLoadedDemoSetup,
  hasDemoSetupFile,
  type DemoSetupConcello,
} from "./demo-setup-file.js";

/** Horarios recomendados do asistente de alta (OnboardWizardPage). */
const WIZARD_DEFAULT_SCHEDULE: Record<string, { open: string; close: string }> =
  {
    pista: { open: "09:00", close: "22:00" },
    pavillon: { open: "08:00", close: "23:00" },
    campo: { open: "09:00", close: "21:00" },
    sala: { open: "10:00", close: "21:00" },
    piscina: { open: "07:00", close: "22:00" },
    futbol: { open: "09:00", close: "21:00" },
    atletismo: { open: "08:00", close: "21:00" },
    default: { open: "09:00", close: "22:00" },
  };

function slugifyShort(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

async function activateFacilitiesAndUnits(municipalityId: string): Promise<void> {
  const db = getDb();
  await db
    .update(t.facilities)
    .set({ active: true })
    .where(eq(t.facilities.municipalityId, municipalityId));
  await db
    .update(t.units)
    .set({ active: true })
    .where(eq(t.units.municipalityId, municipalityId));
}

async function ensureClubs(
  municipalityId: string,
  clubs: DemoSetupConcello["clubs"],
): Promise<number> {
  if (!clubs.length) return 0;
  const existing = await listClubs(municipalityId);
  const db = getDb();
  let created = 0;
  for (const club of clubs) {
    const key = normalizeClubLookupKey(club.name);
    const already = existing.find(
      (c) =>
        normalizeClubLookupKey(c.name) === key ||
        normalizeClubLookupKey(c.shortName) === key,
    );
    if (already) continue;
    const short =
      club.shortName.trim() || slugifyShort(club.name) || "club";
    const id = `club-${slugifyShort(club.name) || randomUUID().slice(0, 8)}-${randomUUID().slice(0, 4)}`;
    await db.insert(t.clubs).values({
      id,
      municipalityId,
      name: club.name.trim(),
      shortName: short.slice(0, 32),
      cif: null,
      sport: null,
      email: null,
    });
    created += 1;
  }
  return created;
}

/**
 * REVISION-63 F3: NIF do admin dese concello en DEMO_USERS_FILE,
 * ou null se non hai (sen crear convite).
 */
function adminNifForSetupSlug(slug: string): string | null {
  const users = getLoadedDemoFileUsers();
  if (!users?.length) return null;
  const admin = users.find(
    (u) => u.role === "admin" && u.municipalitySlug === slug,
  );
  return admin?.normalizedNif ?? null;
}

/**
 * Con PA_DEMO_EMPTY=1 e DEMO_SETUP_FILE: crea concellos que aínda non existen
 * coa mesma función do asistente de alta (censo + normas recomendadas + portal
 * publicado) e os seus clubs. Se o concello xa existe, non toca o concello nin
 * as instalacións, pero crea os clubs do ficheiro que falten.
 */
export async function applyDemoSetupFile(): Promise<{
  created: string[];
  skipped: string[];
}> {
  const created: string[] = [];
  const skipped: string[] = [];

  if (!isDemoMode() || !isDemoEmptyMode() || !hasDemoSetupFile()) {
    return { created, skipped };
  }

  const setup = getLoadedDemoSetup();
  if (!setup?.length) return { created, skipped };

  for (const entry of setup) {
    const existing = await getMunicipalityBySlug(entry.slug);
    if (existing) {
      const clubsAdded = await ensureClubs(existing.id, entry.clubs);
      skipped.push(entry.slug);
      if (clubsAdded > 0) {
        console.info(
          `[demo-setup] clubs engadidos en ${entry.slug}: +${clubsAdded}`,
        );
      }
      continue;
    }

    const marked = censusFacilityNamesForIne(entry.ineCode, entry.slug);
    const brand = entry.colors?.brand?.trim() || undefined;
    const accent = entry.colors?.accent?.trim() || brand;
    const adminNif = adminNifForSetupSlug(entry.slug);

    const muni = await createMunicipalityFromWizard({
      name: entry.name,
      slug: entry.slug,
      ine: entry.ineCode,
      accentColor: brand,
      markedFacilities: marked,
      schedule: WIZARD_DEFAULT_SCHEDULE,
      norms: { rule1: true, rule2: true, rule3: true },
      ...(adminNif
        ? { adminNif }
        : { allowWithoutAdminInvite: true }),
      legalEmail: `deportes@${entry.slug}.demo.local`,
      sandbox: false,
      createdBy: "system:demo-setup-file",
    });

    if (accent && accent !== muni.accentColor) {
      const db = getDb();
      await db
        .update(t.municipalities)
        .set({
          accentColor: accent,
          settings: {
            ...muni.settings,
            theme: {
              brand: brand ?? accent,
              accent,
            },
          },
        })
        .where(eq(t.municipalities.id, muni.id));
    }

    await activateFacilitiesAndUnits(muni.id);
    const pub = await publishPortal(muni.id, "system:demo-setup-file");
    if (!pub.ok) {
      console.warn(
        `[demo-setup] non se puido publicar ${entry.slug}: ${(pub.missing ?? []).join(",")}`,
      );
    }

    await ensureClubs(muni.id, entry.clubs);
    created.push(entry.slug);
    console.info(
      `[demo-setup] concello creado: ${entry.slug} (+${entry.clubs.length} clubs)${
        adminNif ? "" : " (sen convite admin)"
      }`,
    );
  }

  return { created, skipped };
}
