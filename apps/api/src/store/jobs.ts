/**
 * Tarefas periódicas horarias (REVISION-2 §6–§7).
 * Sen dependencias externas: setInterval no proceso da API.
 */
import { eq, getTableName, lt } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { randomUUID } from "node:crypto";
import { getDb, type AppDb } from "../db/client.js";
import * as t from "../db/schema.js";
import {
  isDemoEmptyMode,
  isDemoMode,
  isDemoNightlyResetEnabled,
} from "../env.js";
import { drainNotificationOutbox } from "../notify/notification-outbox.js";
import { anonymizePastBookings } from "./db.js";
import {
  ensureAnaTomorrowBooking,
  ensureAnaWaitlistOffer,
  ensureDemoTodayBookings,
  ensureEveningSlotsExtended,
} from "./demo-bookings.js";
import { ensureDemoLiveActivity } from "./demo-live-activity.js";
import { isDemoResetHour, resetDemoData } from "./demo-reset.js";
import { hasDemoSnapshot } from "./demo-snapshot.js";
import { ensureSlotsAhead } from "./slots-ahead.js";

const HOUR_MS = 60 * 60 * 1000;
const FIVE_MIN_MS = 5 * 60 * 1000;
const THIRTY_MIN_MS = 30 * 60 * 1000;

export type JobRunSummary = {
  anonymized: number;
  sandboxesDeleted: number;
  otpDeleted: number;
  certStatesDeleted: number;
  certTicketsDeleted: number;
  sessionsDeleted: number;
  demoSlotsEnsured: number;
  demoBookingsEnsured?: number;
  waitlistExpired?: number;
  remindersSent?: number;
  outboxDelivered?: number;
  outboxFailed?: number;
  noShowReleased?: number;
  demoReset?: boolean;
};

async function auditJob(summary: JobRunSummary): Promise<void> {
  try {
    /* REVISION-58 J6: concello da plataforma, non muni-exemplo fixo. */
    const { DEPUTACION_PLATFORM_MUNI_ID } = await import("./deputacion-org.js");
    await getDb().insert(t.auditEvents).values({
      id: randomUUID(),
      municipalityId: DEPUTACION_PLATFORM_MUNI_ID,
      actor: "system:jobs",
      action: "hourly_cleanup",
      detail: JSON.stringify(summary),
    });
  } catch (e) {
    console.warn("[jobs] audit fallou:", (e as Error).message);
  }
}

type MunicipalityCleanupStep = {
  table: PgTable;
  run: (tx: AppDb, mid: string) => Promise<void>;
};

const MUNICIPALITY_CLEANUP_STEPS: readonly MunicipalityCleanupStep[] = [
  {
    table: t.openMatchInvites,
    run: async (tx, mid) => {
      await tx
        .delete(t.openMatchInvites)
        .where(eq(t.openMatchInvites.municipalityId, mid));
    },
  },
  {
    table: t.openMatches,
    run: async (tx, mid) => {
      const openRows = await tx
        .select({ id: t.openMatches.id })
        .from(t.openMatches)
        .where(eq(t.openMatches.municipalityId, mid));
      for (const om of openRows) {
        await tx
          .delete(t.openMatchPlayers)
          .where(eq(t.openMatchPlayers.openMatchId, om.id));
      }
      await tx
        .delete(t.openMatches)
        .where(eq(t.openMatches.municipalityId, mid));
    },
  },
  {
    table: t.bookings,
    run: async (tx, mid) => {
      await tx.delete(t.bookings).where(eq(t.bookings.municipalityId, mid));
    },
  },
  {
    table: t.timeSlots,
    run: async (tx, mid) => {
      await tx.delete(t.timeSlots).where(eq(t.timeSlots.municipalityId, mid));
    },
  },
  {
    table: t.matches,
    run: async (tx, mid) => {
      await tx.delete(t.matches).where(eq(t.matches.municipalityId, mid));
    },
  },
  {
    table: t.slotSwaps,
    run: async (tx, mid) => {
      await tx.delete(t.slotSwaps).where(eq(t.slotSwaps.municipalityId, mid));
    },
  },
  {
    table: t.activityApplications,
    run: async (tx, mid) => {
      await tx
        .delete(t.activityApplications)
        .where(eq(t.activityApplications.municipalityId, mid));
    },
  },
  {
    table: t.activities,
    run: async (tx, mid) => {
      await tx.delete(t.activities).where(eq(t.activities.municipalityId, mid));
    },
  },
  {
    table: t.seasonSlots,
    run: async (tx, mid) => {
      await tx
        .delete(t.seasonSlots)
        .where(eq(t.seasonSlots.municipalityId, mid));
    },
  },
  {
    table: t.seasons,
    run: async (tx, mid) => {
      await tx.delete(t.seasons).where(eq(t.seasons.municipalityId, mid));
    },
  },
  {
    table: t.waitlistEntries,
    run: async (tx, mid) => {
      await tx
        .delete(t.waitlistEntries)
        .where(eq(t.waitlistEntries.municipalityId, mid));
    },
  },
  {
    table: t.clubRequests,
    run: async (tx, mid) => {
      await tx
        .delete(t.clubRequests)
        .where(eq(t.clubRequests.municipalityId, mid));
    },
  },
  {
    table: t.clubMembers,
    run: async (tx, mid) => {
      await tx
        .delete(t.clubMembers)
        .where(eq(t.clubMembers.municipalityId, mid));
    },
  },
  {
    table: t.teams,
    run: async (tx, mid) => {
      await tx.delete(t.teams).where(eq(t.teams.municipalityId, mid));
    },
  },
  {
    table: t.clubs,
    run: async (tx, mid) => {
      await tx.delete(t.clubs).where(eq(t.clubs.municipalityId, mid));
    },
  },
  {
    table: t.fixedGroups,
    run: async (tx, mid) => {
      await tx
        .delete(t.fixedGroups)
        .where(eq(t.fixedGroups.municipalityId, mid));
    },
  },
  {
    table: t.incidents,
    run: async (tx, mid) => {
      await tx.delete(t.incidents).where(eq(t.incidents.municipalityId, mid));
    },
  },
  {
    table: t.openingHours,
    run: async (tx, mid) => {
      await tx
        .delete(t.openingHours)
        .where(eq(t.openingHours.municipalityId, mid));
    },
  },
  {
    table: t.closures,
    run: async (tx, mid) => {
      await tx.delete(t.closures).where(eq(t.closures.municipalityId, mid));
    },
  },
  {
    table: t.units,
    run: async (tx, mid) => {
      await tx.delete(t.units).where(eq(t.units.municipalityId, mid));
    },
  },
  {
    table: t.facilities,
    run: async (tx, mid) => {
      await tx.delete(t.facilities).where(eq(t.facilities.municipalityId, mid));
    },
  },
  {
    table: t.familyMembers,
    run: async (tx, mid) => {
      await tx
        .delete(t.familyMembers)
        .where(eq(t.familyMembers.municipalityId, mid));
    },
  },
  {
    table: t.notificationOutbox,
    run: async (tx, mid) => {
      await tx
        .delete(t.notificationOutbox)
        .where(eq(t.notificationOutbox.municipalityId, mid));
    },
  },
  {
    table: t.notificationDedupes,
    run: async (tx, mid) => {
      await tx
        .delete(t.notificationDedupes)
        .where(eq(t.notificationDedupes.municipalityId, mid));
    },
  },
  {
    table: t.notices,
    run: async (tx, mid) => {
      // notice_reads ten ON DELETE CASCADE desde notices
      await tx.delete(t.notices).where(eq(t.notices.municipalityId, mid));
    },
  },
  {
    table: t.auditEvents,
    run: async (tx, mid) => {
      await tx
        .delete(t.auditEvents)
        .where(eq(t.auditEvents.municipalityId, mid));
    },
  },
  {
    table: t.invitations,
    run: async (tx, mid) => {
      await tx
        .delete(t.invitations)
        .where(eq(t.invitations.municipalityId, mid));
    },
  },
  {
    table: t.userRoles,
    run: async (tx, mid) => {
      await tx.delete(t.userRoles).where(eq(t.userRoles.municipalityId, mid));
    },
  },
  {
    table: t.users,
    run: async (tx, mid) => {
      const userRows = await tx
        .select({ id: t.users.id })
        .from(t.users)
        .where(eq(t.users.municipalityId, mid));
      for (const u of userRows) {
        await tx.delete(t.sessions).where(eq(t.sessions.userId, u.id));
      }
      await tx.delete(t.users).where(eq(t.users.municipalityId, mid));
    },
  },
  {
    table: t.otpChallenges,
    run: async (tx, mid) => {
      await tx
        .delete(t.otpChallenges)
        .where(eq(t.otpChallenges.municipalityId, mid));
    },
  },
  {
    table: t.certLoginStates,
    run: async (tx, mid) => {
      await tx
        .delete(t.certLoginStates)
        .where(eq(t.certLoginStates.municipalityId, mid));
    },
  },
];

/** Táboas limpadas antes de borrar `municipalities` (REVISION-60 M6). */
export const SANDBOX_CLEANUP_TABLE_NAMES: readonly string[] =
  MUNICIPALITY_CLEANUP_STEPS.map((s) => getTableName(s.table));

/**
 * Borra sandbox caducados e concellos de demo doutros días (transacción).
 * REVISION-57 J5 + REVISION-60 M6: borrar todas as táboas con FK a municipalities
 * (incluídas notification_outbox e notification_dedupes) antes do concello.
 */
export async function deleteExpiredSandboxes(
  now: Date = new Date(),
): Promise<number> {
  const db = getDb();
  const seedIds = new Set([
    "muni-exemplo",
    "muni-proba",
    "muni-deputacion-platform",
  ]);
  const todayMadrid = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const munis = await db.select().from(t.municipalities);
  const expired = munis.filter((m) => {
    const s = m.settings as {
      sandbox?: boolean;
      sandboxExpiresAt?: string;
      demoCreatedDay?: string;
    };
    if (s.sandbox && s.sandboxExpiresAt) {
      return new Date(s.sandboxExpiresAt).getTime() <= now.getTime();
    }
    if (
      isDemoMode() &&
      !hasDemoSnapshot() &&
      !isDemoEmptyMode() &&
      !seedIds.has(m.id) &&
      s.demoCreatedDay &&
      s.demoCreatedDay < todayMadrid
    ) {
      return true;
    }
    return false;
  });
  let deleted = 0;
  for (const m of expired) {
    await db.transaction(async (tx) => {
      const txDb = tx as unknown as AppDb;
      const mid = m.id;
      for (const step of MUNICIPALITY_CLEANUP_STEPS) {
        await step.run(txDb, mid);
      }
      await tx.delete(t.municipalities).where(eq(t.municipalities.id, mid));
    });
    deleted += 1;
    console.info(`[jobs] concello demo/sandbox borrado: ${m.slug} (${m.id})`);
  }
  return deleted;
}

export async function cleanupExpiredAuth(now: Date = new Date()): Promise<{
  otpDeleted: number;
  certStatesDeleted: number;
  certTicketsDeleted: number;
  sessionsDeleted: number;
}> {
  const db = getDb();
  const otp = await db
    .delete(t.otpChallenges)
    .where(lt(t.otpChallenges.expiresAt, now));
  const states = await db
    .delete(t.certLoginStates)
    .where(lt(t.certLoginStates.expiresAt, now));
  const tickets = await db
    .delete(t.certLoginTickets)
    .where(lt(t.certLoginTickets.expiresAt, now));
  const sessions = await db
    .delete(t.sessions)
    .where(lt(t.sessions.expiresAt, now));
  return {
    otpDeleted: (otp as { rowCount?: number }).rowCount ?? 0,
    certStatesDeleted: (states as { rowCount?: number }).rowCount ?? 0,
    certTicketsDeleted: (tickets as { rowCount?: number }).rowCount ?? 0,
    sessionsDeleted: (sessions as { rowCount?: number }).rowCount ?? 0,
  };
}

/**
 * REVISION-57 J5: cada paso no seu try/catch para que un fallo non aborte o resto.
 */
export async function runHourlyJobs(now: Date = new Date()): Promise<JobRunSummary> {
  let anonymized = 0;
  try {
    anonymized = await anonymizePastBookings(now);
  } catch (e) {
    console.warn("[jobs] anonymize:", (e as Error).message);
  }

  let sandboxesDeleted = 0;
  try {
    sandboxesDeleted = await deleteExpiredSandboxes(now);
  } catch (e) {
    console.warn("[jobs] sandboxes:", (e as Error).message);
  }

  let auth = {
    otpDeleted: 0,
    certStatesDeleted: 0,
    certTicketsDeleted: 0,
    sessionsDeleted: 0,
  };
  try {
    auth = await cleanupExpiredAuth(now);
  } catch (e) {
    console.warn("[jobs] auth cleanup:", (e as Error).message);
  }

  let demoSlotsEnsured = 0;
  let demoBookingsEnsured = 0;
  let waitlistExpired = 0;
  let remindersSent = 0;
  try {
    const { expireWaitlistOffers } = await import("./extra.js");
    const wl = await expireWaitlistOffers(now);
    waitlistExpired = wl.expiredOffers + wl.expiredStarted;
  } catch (e) {
    console.warn("[jobs] waitlist expire:", (e as Error).message);
  }
  try {
    const { sendBookingReminders } = await import("./rev4-ops.js");
    remindersSent = await sendBookingReminders(now);
  } catch (e) {
    console.warn("[jobs] reminders:", (e as Error).message);
  }
  let outboxDelivered = 0;
  let outboxFailed = 0;
  try {
    const outbox = await drainNotificationOutbox();
    outboxDelivered = outbox.delivered;
    outboxFailed = outbox.failed;
  } catch (e) {
    console.warn("[jobs] notification outbox:", (e as Error).message);
  }
  let demoReset = false;
  if (isDemoMode()) {
    try {
      if (isDemoResetHour(now)) {
        if (!isDemoNightlyResetEnabled()) {
          console.info(
            "[jobs] reseteo nocturno omitido: DEMO_NIGHTLY_RESET=0",
          );
        } else if (!hasDemoSnapshot()) {
          console.info(
            "[jobs] reseteo nocturno omitido: no hay foto de la demo",
          );
        } else {
          const dayKey = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Europe/Madrid",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(now);
          const rows = await getDb()
            .select()
            .from(t.meta)
            .where(eq(t.meta.key, "demo_reset_day"))
            .limit(1);
          if (rows[0]?.value !== dayKey) {
            await resetDemoData("system:nightly-04", now);
            await getDb()
              .insert(t.meta)
              .values({ key: "demo_reset_day", value: dayKey })
              .onConflictDoUpdate({
                target: t.meta.key,
                set: { value: dayKey },
              });
            demoReset = true;
          }
        }
      }
    } catch (e) {
      console.warn("[jobs] demo reset:", (e as Error).message);
    }
    if (!demoReset && isDemoEmptyMode()) {
      try {
        await ensureDemoLiveActivity(now);
      } catch (e) {
        console.warn("[jobs] demo live activity:", (e as Error).message);
      }
    } else if (!demoReset && !hasDemoSnapshot() && !isDemoEmptyMode()) {
      try {
        await ensureEveningSlotsExtended(now);
        demoBookingsEnsured = await ensureDemoTodayBookings(now);
        await ensureAnaTomorrowBooking(now);
        await ensureAnaWaitlistOffer(now);
      } catch (e) {
        console.warn("[jobs] demo bookings:", (e as Error).message);
      }
    } else {
      demoBookingsEnsured = 0;
    }
  }
  /* REVISION-20 H1: franxas para todas as unidades activas (demo e produción). */
  if (!demoReset) {
    try {
      demoSlotsEnsured = await ensureSlotsAhead(now);
    } catch (e) {
      console.warn("[jobs] ensureSlotsAhead:", (e as Error).message);
    }
  } else {
    demoSlotsEnsured = 0;
  }
  const summary: JobRunSummary = {
    anonymized,
    sandboxesDeleted,
    ...auth,
    demoSlotsEnsured,
    demoBookingsEnsured,
    waitlistExpired,
    remindersSent,
    outboxDelivered,
    outboxFailed,
    noShowReleased: 0,
    demoReset,
  };
  try {
    await auditJob(summary);
  } catch (e) {
    console.warn("[jobs] audit:", (e as Error).message);
  }
  console.info("[jobs] hourly", summary);
  return summary;
}

/** REVISION-25 N2: liberación sen check-in (cada 5 min). */
export async function runNoShowReleaseJob(now: Date = new Date()): Promise<number> {
  try {
    const { releaseNoShowBookings } = await import("./no-show-release.js");
    const n = await releaseNoShowBookings(now);
    if (n > 0) console.info("[jobs] no-show-release", { released: n });
    return n;
  } catch (e) {
    console.warn("[jobs] no-show-release:", (e as Error).message);
    return 0;
  }
}

let noShowReleaseStarted = false;

export function startNoShowReleaseJobs(): void {
  if (noShowReleaseStarted) return;
  noShowReleaseStarted = true;
  void runNoShowReleaseJob().catch((e) =>
    console.warn("[jobs] no-show-release inicial:", (e as Error).message),
  );
  setInterval(() => {
    void runNoShowReleaseJob().catch((e) =>
      console.error("[jobs] no-show-release erro:", (e as Error).message),
    );
  }, FIVE_MIN_MS);
  console.info("[jobs] intervalo liberación no-show (5 min) activo");
}

let started = false;

/** REVISION-39 L4 — renovar oferta Ana cada 30 min (demo sen foto nin demo baleira). */
async function renewAnaWaitlistIfDemo(now: Date = new Date()): Promise<void> {
  if (!isDemoMode() || hasDemoSnapshot() || isDemoEmptyMode()) return;
  try {
    await ensureAnaWaitlistOffer(now);
  } catch (e) {
    console.warn("[jobs] ana-waitlist:", (e as Error).message);
  }
}

let anaOfferStarted = false;

function startAnaWaitlistJobs(): void {
  if (anaOfferStarted || !isDemoMode()) return;
  anaOfferStarted = true;
  void renewAnaWaitlistIfDemo().catch(() => undefined);
  setInterval(() => {
    void renewAnaWaitlistIfDemo().catch(() => undefined);
  }, THIRTY_MIN_MS);
  console.info("[jobs] intervalo oferta Ana (30 min) activo");
}

/** Arranca o intervalo horario (unha soa vez por proceso). */
export function startHourlyJobs(): void {
  if (started) return;
  started = true;
  startNoShowReleaseJobs();
  startAnaWaitlistJobs();
  // Limpeza inmediata de auth caducado ao arrancar
  void cleanupExpiredAuth().catch((e) =>
    console.warn("[jobs] limpeza inicial:", (e as Error).message),
  );
  setInterval(() => {
    void runHourlyJobs().catch((e) =>
      console.error("[jobs] erro:", (e as Error).message),
    );
  }, HOUR_MS);
  console.info("[jobs] intervalo horario activo");
}
