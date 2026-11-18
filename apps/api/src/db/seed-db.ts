/**
 * Seed idempotente Exemplo + Proba (+ extras D).
 */
import { eq } from "drizzle-orm";
import { DEMO_MUNICIPALITIES } from "@pista-aberta/shared";
import { MOCK_USERS } from "../identity/saml-mock.js";
import { hasDemoUsersFile } from "../identity/demo-users-file.js";
import { seedDemoFileDeputacionUsers } from "../identity/demo-users-provision.js";
import { isDemoEmptyMode } from "../env.js";
import { getDb } from "./client.js";
import * as t from "./schema.js";
import { buildSeed } from "../store/seed.js";
import {
  DEPUTACION_DEMO_ORG_ID,
  DEPUTACION_PLATFORM_MUNI_ID,
  ensureDemoDeputacionEntity,
} from "../store/deputacion-org.js";
import { backfillUserRoles } from "../store/user-roles.js";
import { generateLotterySecret, hashSecret } from "../store/lottery.js";
import {
  DEFAULT_TIMEZONE,
  addDaysIso,
  localDateIso,
} from "../store/business-rules.js";

const SEED_VERSION = "d-completo-14-export-publico";
const LEGACY_LOTTERY_SECRET = "pista-aberta-demo-sorteo-2026";

function madridDayKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** REVISION-20 H1: horarios semanais para xeración de franxas (idempotente por id). */
async function ensureDemoOpeningHours(): Promise<void> {
  const db = getDb();

  type OH = {
    id: string;
    municipalityId: string;
    facilityId: string;
    unitId: string;
    weekday: number;
    open: string;
    close: string;
  };
  const rows: OH[] = [];
  const pushRange = (
    unitId: string,
    municipalityId: string,
    facilityId: string,
    weekdays: number[],
    open: string,
    close: string,
  ) => {
    for (const weekday of weekdays) {
      rows.push({
        id: `oh-${unitId}-${weekday}-${open.replace(":", "")}`,
        municipalityId,
        facilityId,
        unitId,
        weekday,
        open,
        close,
      });
    }
  };

  const weekdays = [0, 1, 2, 3, 4, 5, 6];
  const monFri = [1, 2, 3, 4, 5];
  const weekend = [0, 6];

  for (const unitId of ["unit-padel-1", "unit-padel-2"]) {
    pushRange(unitId, "muni-exemplo", "fac-exemplo-padel", weekdays, "09:00", "13:00");
    pushRange(unitId, "muni-exemplo", "fac-exemplo-padel", weekdays, "16:00", "22:00");
  }
  /* Pavillón: L–V 16–22; S–D apertura 09–14 e 16–21 (REVISION-48 Y1).
   * Partidos/tempadas de club validan contra este horario de apertura
   * (non só a ventá curta de reservas da veciñanza). */
  for (const unitId of ["unit-pav-full", "unit-pav-a", "unit-pav-b"]) {
    pushRange(unitId, "muni-exemplo", "fac-exemplo-pav", monFri, "16:00", "22:00");
    pushRange(unitId, "muni-exemplo", "fac-exemplo-pav", weekend, "09:00", "14:00");
    pushRange(unitId, "muni-exemplo", "fac-exemplo-pav", weekend, "16:00", "21:00");
  }
  pushRange("unit-proba-campo", "muni-proba", "fac-proba-campo", weekdays, "09:00", "13:00");
  pushRange("unit-proba-sala", "muni-proba", "fac-proba-sala", weekdays, "09:00", "13:00");

  for (const row of rows) {
    await db
      .insert(t.openingHours)
      .values(row)
      .onConflictDoUpdate({
        target: t.openingHours.id,
        set: {
          open: row.open,
          close: row.close,
          weekday: row.weekday,
          facilityId: row.facilityId,
          unitId: row.unitId,
          municipalityId: row.municipalityId,
        },
      });
  }
}

/** Sábado da fin de semana seguinte (+14 días se hoxe é sábado). */
function demoProposalMatchDate(): string {
  const today = localDateIso(new Date(), DEFAULT_TIMEZONE);
  const [y, mo, d] = today.split("-").map(Number);
  const noonUtc = new Date(Date.UTC(y!, mo! - 1, d!, 12, 0, 0));
  const day = noonUtc.getUTCDay();
  const toSat = day === 6 ? 0 : (6 - day + 7) % 7 || 7;
  return addDaysIso(today, toSat + 7);
}

/** Propostas pendentes para o panel de solicitudes (demo). */
async function ensurePendingClubRequests(): Promise<void> {
  const db = getDb();
  const matchDate = demoProposalMatchDate();
  const matchPayload = {
    facilityId: "fac-exemplo-pav",
    unitId: "unit-pav-full",
    date: matchDate,
    /* S–D pavillón 09–14 (REVISION-21 L4.3). */
    start: "10:00",
    end: "11:30",
    homeTeam: "CD Exemplo Senior",
    awayTeam: "Visitante demo",
  };

  const existing = await db
    .select({ id: t.clubRequests.id })
    .from(t.clubRequests)
    .where(eq(t.clubRequests.id, "req-demo-season-pending"))
    .limit(1);
  if (existing.length) {
    /* Alinear horario do partido pendente se a semente antiga tiña 18:00. */
    await db
      .update(t.clubRequests)
      .set({ payload: matchPayload })
      .where(eq(t.clubRequests.id, "req-demo-match-pending"));
    return;
  }

  await db.insert(t.clubRequests).values([
    {
      id: "req-demo-season-pending",
      municipalityId: "muni-exemplo",
      clubId: "club-basquet",
      type: "season",
      status: "pending",
      payload: {
        facilityId: "fac-exemplo-pav",
        unitId: "unit-pav-a",
        weekday: 3,
        start: "20:00",
        end: "21:30",
      },
      note: "Proposta demo: franxa de tempada (mércores)",
      createdByUserId: "user-club",
      createdByName: "Club Deportivo Exemplo",
    },
    {
      id: "req-demo-match-pending",
      municipalityId: "muni-exemplo",
      clubId: "club-basquet",
      type: "match",
      status: "pending",
      payload: matchPayload,
      note: "Proposta demo: partido de fin de semana",
      createdByUserId: "user-club",
      createdByName: "Club Deportivo Exemplo",
    },
  ]);

  await db.insert(t.notices).values({
    id: "n-req-demo-season",
    municipalityId: "muni-exemplo",
    userId: "user-admin",
    type: "info",
    title: "Nova solicitude de tempada: Club Deportivo Exemplo",
    body: "Proposta demo: franxa de tempada (mércores)",
    read: false,
  });
}

const DEMO_LOGO_DATA_URL =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="10" fill="#5A4636"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="26">N</text></svg>',
  );

/** REVISION-46 §3 — incidencia, inscricións baloncesto, tempada publicada, logo demo. */
async function ensureRevision46DemoData(): Promise<void> {
  const db = getDb();

  const muni = await db
    .select()
    .from(t.municipalities)
    .where(eq(t.municipalities.id, "muni-exemplo"))
    .limit(1);
  if (muni[0]) {
    type MuniSettings = NonNullable<(typeof muni)[0]["settings"]>;
    const settings: MuniSettings = { ...(muni[0].settings as MuniSettings) };
    if (!settings.logoDataUrl) {
      settings.logoDataUrl = DEMO_LOGO_DATA_URL;
      await db
        .update(t.municipalities)
        .set({ settings })
        .where(eq(t.municipalities.id, "muni-exemplo"));
    }
  }

  const inc = await db
    .select({ id: t.incidents.id })
    .from(t.incidents)
    .where(eq(t.incidents.id, "inc-demo-open"))
    .limit(1);
  if (!inc.length) {
    await db.insert(t.incidents).values({
      id: "inc-demo-open",
      municipalityId: "muni-exemplo",
      facilityId: "fac-exemplo-padel",
      userId: "user-cidada",
      userDisplayName: "Ana Demo",
      body: "Luz parpadeante na pista 1. Revisar antes da tarde.",
      status: "open",
      createdAt: new Date(),
    });
  }

  const basquetApps = await db
    .select({ id: t.activityApplications.id })
    .from(t.activityApplications)
    .where(eq(t.activityApplications.activityId, "act-basquet-escola"))
    .limit(1);
  if (!basquetApps.length) {
    const users = ["u-a", "u-b", "u-c", "u-d", "u-e", "u-f"];
    for (let i = 0; i < users.length; i++) {
      await db
        .insert(t.activityApplications)
        .values({
          id: `app-basquet-${i + 1}`,
          activityId: "act-basquet-escola",
          municipalityId: "muni-exemplo",
          userId: users[i]!,
          applicationNumber: `req-2${String(i + 1).padStart(3, "0")}`,
          priorityGroup: "sorteo",
          status: "pending",
          createdAt: new Date(),
        })
        .onConflictDoNothing();
    }
  }

  const seasonId = "season-demo-2627";
  const seasonRow = await db
    .select({ id: t.seasons.id })
    .from(t.seasons)
    .where(eq(t.seasons.id, seasonId))
    .limit(1);
  if (!seasonRow.length) {
    await db.insert(t.seasons).values({
      id: seasonId,
      municipalityId: "muni-exemplo",
      name: "Tempada 2026–27",
      startsAt: "2026-09-01",
      endsAt: "2027-06-30",
      facilityIds: ["fac-exemplo-pav"],
      criteriaGl: "Prioridade por categoría e antigüidade no club.",
      criteriaEs: "Prioridad por categoría y antigüedad en el club.",
      published: true,
    });
  }

  await db
    .update(t.seasonSlots)
    .set({ seasonId })
    .where(eq(t.seasonSlots.municipalityId, "muni-exemplo"));
}

/** PNG 1×1 da rev47 (fallback sen sharp). */
const REV47_PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/**
 * Tamaños exactos do data URL JPEG sintético da rev47 (sharp q82 mozjpeg,
 * SVG 1600×900 degradado + etiqueta). Unha foto subida pola UI ten outro tamaño.
 */
const REV47_JPEG_DATAURL_LENGTHS = new Set([14_251, 14_359]);

function isRev47SyntheticPhoto(raw: string): boolean {
  if (raw === REV47_PNG_1X1) return true;
  if (
    raw.startsWith("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAY")
  ) {
    return true;
  }
  if (
    raw.startsWith("data:image/jpeg;base64,") &&
    REV47_JPEG_DATAURL_LENGTHS.has(raw.length)
  ) {
    return true;
  }
  return false;
}

/**
 * REVISION-48 Y5 / REVISION-49 Z6 — quitar só as fotos sintéticas da rev47
 * (hash/tamaño exacto), unha soa vez (marca en `meta`). Nunca borrar unha
 * foto subida na demo.
 */
async function ensureRevision47FacilityPhotos(): Promise<void> {
  const db = getDb();
  const flag = await db
    .select()
    .from(t.meta)
    .where(eq(t.meta.key, "rev49_cleared_rev47_photos"))
    .limit(1);
  if (flag[0]?.value === "1") return;

  const ids = ["fac-exemplo-padel", "fac-exemplo-pav"] as const;
  for (const id of ids) {
    const rows = await db
      .select({
        id: t.facilities.id,
        imageDataUrl: t.facilities.imageDataUrl,
      })
      .from(t.facilities)
      .where(eq(t.facilities.id, id))
      .limit(1);
    const raw = rows[0]?.imageDataUrl ?? null;
    if (!raw) continue;
    if (!isRev47SyntheticPhoto(raw)) continue;
    await db
      .update(t.facilities)
      .set({ imageDataUrl: null, imageAlt: null })
      .where(eq(t.facilities.id, id));
  }

  await db
    .insert(t.meta)
    .values({ key: "rev49_cleared_rev47_photos", value: "1" })
    .onConflictDoUpdate({
      target: t.meta.key,
      set: { value: "1" },
    });
}

/** Substitúe segredos predicibles e alinea antelación 7 días (revisión pre-envío). */
async function hardenExistingSeed(): Promise<void> {
  const db = getDb();
  const legacyHash = hashSecret(LEGACY_LOTTERY_SECRET);
  const acts = await db.select().from(t.activities);
  for (const a of acts) {
    if (a.method !== "lottery" || a.lotteryStatus === "drawn") continue;
    const needsRotate =
      !a.lotterySecret ||
      a.lotterySecret === LEGACY_LOTTERY_SECRET ||
      a.lotterySeedHash === legacyHash;
    if (!needsRotate) continue;
    const secret = generateLotterySecret();
    await db
      .update(t.activities)
      .set({
        lotterySecret: secret,
        lotterySeedHash: hashSecret(secret),
        lotteryResultOrder: null,
      })
      .where(eq(t.activities.id, a.id));
  }

  await ensureDemoDeputacionEntity();

  const munis = await db.select().from(t.municipalities);
  const seedIds = new Set([
    "muni-exemplo",
    "muni-proba",
    "muni-deputacion-platform",
  ]);
  for (const m of munis) {
    const settings = {
      ...(m.settings as {
        maxHoursPerWeek: number;
        bookingAntelationDays: number;
        maxActiveBookings?: number;
        anonymizeAfterDays?: number;
        cancelMinHours?: number;
        checkInMarginMinutes?: number;
        noShowReleaseMinutes?: number;
        noShowPenaltyCount?: number;
        noShowPenaltyDays?: number;
        noShowPenaltyWindowDays?: number;
        rulesText?: Array<{ id: string; order: number; gl: string; es: string }>;
        rulesVersion?: string;
        timezone?: string;
        demoImage?: string;
        theme?: { brand: string; accent: string };
        sandbox?: boolean;
        sandboxExpiresAt?: string;
        demoCreatedDay?: string;
        deputacionPlatform?: boolean;
      }),
    };
    let dirty = false;
    if (settings.bookingAntelationDays !== 7) {
      settings.bookingAntelationDays = 7;
      dirty = true;
    }
    if (settings.maxActiveBookings == null) {
      settings.maxActiveBookings = 3;
      dirty = true;
    }
    if (settings.anonymizeAfterDays == null) {
      settings.anonymizeAfterDays = 90;
      dirty = true;
    }
    if (settings.cancelMinHours == null) {
      settings.cancelMinHours = 2;
      dirty = true;
    }
    if (settings.checkInMarginMinutes == null) {
      settings.checkInMarginMinutes = 30;
      dirty = true;
    }
    if (settings.noShowReleaseMinutes == null) {
      settings.noShowReleaseMinutes = 30;
      dirty = true;
    }
    /* Rev24 T20: penalización visible na demo (Exemplo / Proba). */
    if (seedIds.has(m.id)) {
      if (settings.noShowPenaltyCount !== 3) {
        settings.noShowPenaltyCount = 3;
        dirty = true;
      }
      if (settings.noShowPenaltyDays !== 7) {
        settings.noShowPenaltyDays = 7;
        dirty = true;
      }
      if (settings.noShowPenaltyWindowDays !== 30) {
        settings.noShowPenaltyWindowDays = 30;
        dirty = true;
      }
    }
    if (!settings.rulesText) {
      const { DEFAULT_RULES_TEXT, computeRulesVersion, rulesFromSettings } =
        await import("../store/rules.js");
      settings.rulesText = DEFAULT_RULES_TEXT;
      settings.rulesVersion = computeRulesVersion(
        rulesFromSettings(settings),
        DEFAULT_RULES_TEXT,
      );
      dirty = true;
    }
    if (!settings.timezone) {
      settings.timezone = "Europe/Madrid";
      dirty = true;
    }
    // Altas demo antigas sen flag: marcar día de creación (limpeza 04:00).
    if (!seedIds.has(m.id) && !settings.demoCreatedDay && !settings.sandbox) {
      settings.demoCreatedDay = madridDayKey();
      dirty = true;
    }
    /* REVISION-40 P1 — contacto do servizo (Exemplo / Proba). */
    if (m.id === "muni-exemplo" || m.id === "muni-proba") {
      const demo = DEMO_MUNICIPALITIES.find((x) => x.id === m.id);
      const seedContact = demo?.settings.contact;
      if (seedContact && !(settings as { contact?: unknown }).contact) {
        (settings as { contact?: typeof seedContact }).contact = seedContact;
        dirty = true;
      }
    }
    if (!dirty) continue;
    await db
      .update(t.municipalities)
      .set({ settings })
      .where(eq(t.municipalities.id, m.id));
  }

  /* REVISION-40 P1 — contacto nas instalacións demo. */
  for (const f of buildSeed().facilities) {
    if (!f.contactPhone && !f.contactEmail && !f.contactPerson) continue;
    await db
      .update(t.facilities)
      .set({
        contactPhone: f.contactPhone ?? null,
        contactEmail: f.contactEmail ?? null,
        contactPerson: f.contactPerson ?? null,
      })
      .where(eq(t.facilities.id, f.id));
  }

  /* Como chegar — textos nas instalacións demo (pádel / pavillón Exemplo). */
  for (const f of buildSeed().facilities) {
    if (!f.parkingInfo && !f.publicTransport && !f.entranceInfo) continue;
    await db
      .update(t.facilities)
      .set({
        accessibility: f.accessibility,
        parkingInfo: f.parkingInfo ?? null,
        publicTransport: f.publicTransport ?? null,
        entranceInfo: f.entranceInfo ?? null,
      })
      .where(eq(t.facilities.id, f.id));
  }

  /* REVISION-47 W2: sen solapes aprobados incompatíbeis (completa vs medias). */
  for (const [id, start, end, unitId] of [
    ["m3", "13:15", "14:00", "unit-pav-a"],
    ["m4", "09:00", "10:00", "unit-pav-b"],
    ["m5", "11:45", "13:15", "unit-pav-full"],
  ] as const) {
    await db
      .update(t.matches)
      .set({ start, end, unitId, status: "scheduled", conflictWith: [] })
      .where(eq(t.matches.id, id));
  }
  await db
    .update(t.matches)
    .set({ notes: "Coincide con CD Exemplo Senior" })
    .where(eq(t.matches.id, "m2"));
}

export async function seedEmptyDemoDb(): Promise<void> {
  const db = getDb();
  await ensureDemoDeputacionEntity();
  if (hasDemoUsersFile()) {
    await seedDemoFileDeputacionUsers();
    await backfillUserRoles();
    console.info("[seed] demo baleira aplicada (plataforma + Deputación + DEMO_USERS_FILE)");
    return;
  }
  const dep = MOCK_USERS.deputacion;
  if (dep) {
    await db
      .insert(t.users)
      .values({
        id: dep.id,
        municipalityId: DEPUTACION_PLATFORM_MUNI_ID,
        organizationId: DEPUTACION_DEMO_ORG_ID,
        role: "superadmin",
        displayName: dep.displayName,
        email: dep.email ?? null,
        personIdentifier: dep.personIdentifier ?? null,
        clubId: null,
        locale: dep.locale,
        active: true,
      })
      .onConflictDoUpdate({
        target: t.users.id,
        set: {
          municipalityId: DEPUTACION_PLATFORM_MUNI_ID,
          organizationId: DEPUTACION_DEMO_ORG_ID,
          role: "superadmin",
          displayName: dep.displayName,
          email: dep.email ?? null,
          personIdentifier: dep.personIdentifier ?? null,
          active: true,
        },
      });
  }
  await ensureDemoDeputacionEntity();
  await backfillUserRoles();
  console.info("[seed] demo baleira aplicada (plataforma + Deputación + superadmin)");
}

export async function seedDb(now: Date = new Date()): Promise<void> {
  if (isDemoEmptyMode()) {
    await seedEmptyDemoDb();
    return;
  }
  const db = getDb();
  const meta = await db.select().from(t.meta).where(eq(t.meta.key, "seed_version")).limit(1);

  async function upsertDemoUsers(): Promise<void> {
    /* REVISION-29 Y13: muni plataforma + org antes do user-deputacion. */
    await ensureDemoDeputacionEntity();
    for (const u of Object.values(MOCK_USERS)) {
      await db
        .insert(t.users)
        .values({
          id: u.id,
          municipalityId: u.municipalityId,
          role: u.role,
          displayName: u.displayName,
          email: u.email ?? null,
          personIdentifier: u.personIdentifier,
          clubId: u.clubId ?? null,
          locale: u.locale,
          active: true,
        })
        .onConflictDoUpdate({
          target: t.users.id,
          set: {
            municipalityId: u.municipalityId,
            role: u.role,
            displayName: u.displayName,
            email: u.email ?? null,
            personIdentifier: u.personIdentifier,
            clubId: u.clubId ?? null,
            active: true,
          },
        });
    }
    /* Ligar Deputación á entidade (organizationId) tras o upsert. */
    await ensureDemoDeputacionEntity();
  }

  if (meta[0]?.value === SEED_VERSION) {
    await ensureDemoOpeningHours();
    await hardenExistingSeed();
    await upsertDemoUsers();
    await ensurePendingClubRequests();
    await ensureRevision46DemoData();
    await ensureRevision47FacilityPhotos();
    /* TANDA-2 — partidos demo idempotentes (tamén en rearranques). */
    const { seedDemoOpenMatches } = await import("../store/open-matches.js");
    await seedDemoOpenMatches(new Date());
    console.info(`[seed] xa aplicado (${SEED_VERSION})`);
    return;
  }

  // Limpar e reseedar se versión distinta ou ausente
  if (meta.length) {
    console.info("[seed] re-seed (versión anterior)");
  }

  const data = buildSeed(now);

  // Upsert municipalities
  for (const m of data.municipalities) {
    await db
      .insert(t.municipalities)
      .values({
        id: m.id,
        slug: m.slug,
        name: m.name,
        accentColor: m.accentColor,
        locales: m.locales,
        settings: m.settings,
      })
      .onConflictDoUpdate({
        target: t.municipalities.id,
        set: {
          name: m.name,
          accentColor: m.accentColor,
          locales: m.locales,
          settings: m.settings,
        },
      });
  }

  // Demo users (SAML mock + OTP polos mesmos correos)
  await upsertDemoUsers();

  for (const f of data.facilities) {
    await db
      .insert(t.facilities)
      .values({
        id: f.id,
        municipalityId: f.municipalityId,
        name: f.name,
        type: f.type,
        address: f.address,
        lat: String(f.lat),
        lng: String(f.lng),
        accessibility: f.accessibility,
        services: f.services,
        rules: f.rules,
        rulesText: f.rulesText ?? null,
        active: f.active,
        outdoor: f.outdoor ?? (f.type === "pista" || f.type === "campo"),
        contactPhone: f.contactPhone ?? null,
        contactEmail: f.contactEmail ?? null,
        contactPerson: f.contactPerson ?? null,
        parkingInfo: f.parkingInfo ?? null,
        publicTransport: f.publicTransport ?? null,
        entranceInfo: f.entranceInfo ?? null,
      })
      .onConflictDoNothing();
  }

  /* REVISION-50 X1: normas de pádel na instalación (non no concello). */
  for (const f of data.facilities) {
    if (!f.rulesText?.length) continue;
    await db
      .update(t.facilities)
      .set({ rulesText: f.rulesText, rules: f.rules })
      .where(eq(t.facilities.id, f.id));
  }

  for (const u of data.units) {
    await db
      .insert(t.units)
      .values({
        id: u.id,
        facilityId: u.facilityId,
        municipalityId: u.municipalityId,
        name: u.name,
        incompatibleWith: u.incompatibleWith,
      })
      .onConflictDoNothing();
  }

  // Slots: só se non hai ningún
  const slotCount = await db.select().from(t.timeSlots).limit(1);
  if (!slotCount.length) {
    for (const s of data.slots) {
      await db.insert(t.timeSlots).values({
        id: s.id,
        unitId: s.unitId,
        municipalityId: s.municipalityId,
        date: s.date,
        start: s.start,
        end: s.end,
        closed: s.closed,
        closedReason: s.closedReason ?? null,
      });
    }
  }

  for (const c of data.clubs) {
    await db
      .insert(t.clubs)
      .values({
        id: c.id,
        municipalityId: c.municipalityId,
        name: c.name,
        shortName: c.shortName,
      })
      .onConflictDoUpdate({
        target: t.clubs.id,
        set: { name: c.name, shortName: c.shortName },
      });
  }

  for (const team of data.teams) {
    await db
      .insert(t.teams)
      .values({
        id: team.id,
        clubId: team.clubId,
        municipalityId: team.municipalityId,
        name: team.name,
        category: team.category,
      })
      .onConflictDoUpdate({
        target: t.teams.id,
        set: { name: team.name, category: team.category },
      });
  }

  const matchCount = await db.select().from(t.matches).limit(1);
  if (!matchCount.length) {
    for (const m of data.matches) {
      await db.insert(t.matches).values({
        id: m.id,
        municipalityId: m.municipalityId,
        facilityId: m.facilityId,
        unitId: m.unitId,
        date: m.date,
        start: m.start,
        end: m.end,
        homeTeamId: m.homeTeamId,
        awayTeamId: m.awayTeamId,
        clubId: m.clubId,
        status: m.status,
        conflictWith: m.conflictWith ?? [],
        notes: m.notes ?? null,
      });
    }
  }

  for (const a of data.activities) {
    await db
      .insert(t.activities)
      .values({
        id: a.id,
        municipalityId: a.municipalityId,
        facilityId: a.facilityId,
        name: a.name,
        description: a.description,
        days: a.days,
        hours: a.hours,
        places: a.places,
        ageMin: a.ageMin,
        ageMax: a.ageMax,
        method: a.method,
        deadline: a.deadline,
        lotteryStatus: a.lotteryStatus,
        lotterySeedHash: a.lotterySeedHash,
        lotterySecret: a.lotterySecret,
        lotteryResultOrder: a.lotteryResultOrder,
      })
      .onConflictDoNothing();
  }

  const appCount = await db.select().from(t.activityApplications).limit(1);
  if (!appCount.length) {
    for (const a of data.applications) {
      await db.insert(t.activityApplications).values({
        id: a.id,
        activityId: a.activityId,
        municipalityId: a.municipalityId,
        userId: a.userId,
        forMemberId: a.forMemberId ?? null,
        forMemberName: a.forMemberName ?? null,
        applicationNumber: a.applicationNumber,
        priorityGroup: a.priorityGroup,
        status: a.status,
        createdAt: new Date(a.createdAt),
      });
    }
  }

  // Extras D
  const noticeCount = await db.select().from(t.notices).limit(1);
  if (!noticeCount.length) {
    const now = new Date();
    await db.insert(t.notices).values([
      {
        id: "n1",
        municipalityId: "muni-exemplo",
        userId: "user-cidada",
        type: "reminder",
        title: "Recordatorio: reserva mañá",
        body: "Mañá ás 18:00 · Pistas de pádel · Cancelar se non vas.",
        read: false,
        createdAt: now,
      },
      {
        id: "n2",
        municipalityId: "muni-exemplo",
        userId: null,
        type: "closure",
        title: "Peche puntual pista 2",
        body: "A pista de pádel 2 pecha o venres pola tarde por mantemento.",
        read: false,
        createdAt: now,
      },
      /* n3 créao ensureAnaWaitlistOffer (REVISION-38 J1) tras slots/reset. */
    ]);
  }

  const famCount = await db.select().from(t.familyMembers).limit(1);
  if (!famCount.length) {
    await db.insert(t.familyMembers).values([
      {
        id: "fam-1",
        userId: "user-cidada",
        municipalityId: "muni-exemplo",
        displayName: "Carla Familiar",
        birthYear: 2016,
        relation: "filla",
      },
      {
        id: "fam-2",
        userId: "user-cidada",
        municipalityId: "muni-exemplo",
        displayName: "Luis Familiar",
        birthYear: 2019,
        relation: "fillo",
      },
    ]);
  }

  const ssCount = await db.select().from(t.seasonSlots).limit(1);
  if (!ssCount.length) {
    await db.insert(t.seasonSlots).values([
      {
        id: "ss1",
        municipalityId: "muni-exemplo",
        clubId: "club-basquet",
        facilityId: "fac-exemplo-pav",
        unitId: "unit-pav-full",
        weekday: 2,
        start: "18:00",
        end: "19:30",
        priority: 1,
      },
      {
        id: "ss2",
        municipalityId: "muni-exemplo",
        clubId: "club-volei",
        facilityId: "fac-exemplo-pav",
        unitId: "unit-pav-a",
        weekday: 4,
        start: "19:00",
        end: "20:30",
        priority: 2,
      },
      {
        id: "ss3",
        municipalityId: "muni-exemplo",
        clubId: "club-futsal",
        facilityId: "fac-exemplo-pav",
        unitId: "unit-pav-b",
        weekday: 5,
        start: "17:00",
        end: "18:30",
        priority: 2,
      },
      {
        id: "ss4",
        municipalityId: "muni-exemplo",
        clubId: "club-patin",
        facilityId: "fac-exemplo-pav",
        unitId: "unit-pav-full",
        weekday: 6,
        start: "10:00",
        end: "12:00",
        priority: 3,
      },
    ]);
  }

  // Modelo 1 conta/club: non se seedan «members» múltiples (legado club_members baleiro)

  const auCount = await db.select().from(t.auditEvents).limit(1);
  if (!auCount.length) {
    await db.insert(t.auditEvents).values({
      id: "au1",
      municipalityId: "muni-exemplo",
      at: new Date(),
      actor: "sistema",
      action: "seed",
      detail: "Datos de proba cargados (sorteo: hash por actividade)",
    });
  }

  await ensureDemoOpeningHours();
  await hardenExistingSeed();
  await ensurePendingClubRequests();
  await ensureRevision46DemoData();
  await ensureRevision47FacilityPhotos();

  await backfillUserRoles();

  const { seedDemoOpenMatches } = await import("../store/open-matches.js");
  await seedDemoOpenMatches(new Date());

  await db
    .insert(t.meta)
    .values({ key: "seed_version", value: SEED_VERSION })
    .onConflictDoUpdate({
      target: t.meta.key,
      set: { value: SEED_VERSION },
    });

  console.info(`[seed] Exemplo + Proba aplicados (${SEED_VERSION})`);
}
