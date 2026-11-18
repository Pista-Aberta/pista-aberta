/**
 * Reinicio da demo: se existe foto en DEMO_SNAPSHOT_PATH restáuraa
 * (TRUNCATE + restauración na mesma transacción);
 * se non, limpa e reseeda os datos de proba.
 * Só ten sentido con PA_DEMO / isDemoMode().
 */
import { eq, sql } from "drizzle-orm";
import { getDb, getDbMode } from "../db/client.js";
import * as t from "../db/schema.js";
import { seedDb, seedEmptyDemoDb } from "../db/seed-db.js";
import { isDemoEmptyMode, isDemoMode } from "../env.js";
import { applyDemoSetupFile } from "../identity/demo-setup-provision.js";
import { newId } from "../lib/ids.js";
import { DEPUTACION_PLATFORM_MUNI_ID } from "./deputacion-org.js";
import {
  ensureAnaTomorrowBooking,
  ensureAnaWaitlistOffer,
  ensureDemoTodayBookings,
  ensureEveningSlotsExtended,
} from "./demo-bookings.js";
import { ensureDemoLiveActivity } from "./demo-live-activity.js";
import {
  ALL_DEMO_TABLE_NAMES,
  clearDemoRestoreLastError,
  hasDemoSnapshot,
  recordDemoRestoreFailure,
  restoreDemoSnapshot,
} from "./demo-snapshot.js";
import { ensureSlotsAhead } from "./slots-ahead.js";

export async function resetDemoData(
  actor = "system:demo-reset",
  now: Date = new Date(),
): Promise<{
  ok: true;
  mode: string;
  at: string;
  restoredFromSnapshot: boolean;
}> {
  if (!isDemoMode()) {
    throw new Error("demo_only");
  }
  const db = getDb();
  const mode = getDbMode();
  const useSnapshot = hasDemoSnapshot();

  if (useSnapshot) {
    try {
      await restoreDemoSnapshot();
      await clearDemoRestoreLastError();
      await ensureSlotsAhead(now);
      if (isDemoEmptyMode()) {
        await ensureDemoLiveActivity(now);
      }
    } catch (err) {
      await recordDemoRestoreFailure(actor, err);
      throw err;
    }
  } else {
    const list = ALL_DEMO_TABLE_NAMES.map((x) => `"${x}"`).join(", ");
    await db.execute(sql.raw(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`));

    if (isDemoEmptyMode()) {
      await seedEmptyDemoDb();
      const setup = await applyDemoSetupFile();
      if (setup.created.length || setup.skipped.length) {
        console.info(
          `[demo-reset] DEMO_SETUP_FILE: creados=${setup.created.length} omitidos=${setup.skipped.length}`,
        );
      }
      await ensureSlotsAhead(now);
      await ensureDemoLiveActivity(now);
    } else {
      await seedDb(now);
      await ensureSlotsAhead(now);
      await ensureEveningSlotsExtended(now);
      await ensureDemoTodayBookings(now);
      await ensureAnaTomorrowBooking(now);
      await ensureAnaWaitlistOffer(now);
    }
  }

  const at = now.toISOString();
  const platformMuni = await db
    .select({ id: t.municipalities.id })
    .from(t.municipalities)
    .where(eq(t.municipalities.id, DEPUTACION_PLATFORM_MUNI_ID))
    .limit(1);
  if (platformMuni[0]) {
    await db.insert(t.auditEvents).values({
      id: newId("audit-demo-reset"),
      municipalityId: DEPUTACION_PLATFORM_MUNI_ID,
      actor,
      action: "demo.reset",
      detail: useSnapshot ? `mode=${mode}; source=snapshot` : `mode=${mode}`,
    });
  }

  await db
    .insert(t.meta)
    .values({ key: "demo_reset_at", value: at })
    .onConflictDoUpdate({
      target: t.meta.key,
      set: { value: at },
    });

  return { ok: true, mode, at, restoredFromSnapshot: useSnapshot };
}

/** REVISION-33 D2 — instante da última restauración da demo (ISO) ou null. */
export async function getLastDemoResetAt(): Promise<string | null> {
  if (!isDemoMode()) return null;
  const rows = await getDb()
    .select()
    .from(t.meta)
    .where(eq(t.meta.key, "demo_reset_at"))
    .limit(1);
  return rows[0]?.value ?? null;
}

/** true se a hora local Europe/Madrid é 04:xx (fiestra de 1 h). */
export function isDemoResetHour(now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "-1");
  return hour === 4;
}
