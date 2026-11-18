import { initDb, getDb, getDbMode } from "./db/client.js";
import { migrateSchema } from "./db/migrate.js";
import * as t from "./db/schema.js";
import { seedDb, seedEmptyDemoDb } from "./db/seed-db.js";
import { assertProductionSafe, isDemoEmptyMode, isDemoMode } from "./env.js";
import { ensureDemoSamlCerts } from "./identity/saml-certs.js";
import { initDemoUsersFromEnv } from "./identity/demo-users-file.js";
import { initDemoSetupFromEnv } from "./identity/demo-setup-file.js";
import { applyDemoSetupFile } from "./identity/demo-setup-provision.js";
import { anonymizePastBookings } from "./store/db.js";
import {
  ensureAnaTomorrowBooking,
  ensureAnaWaitlistOffer,
  ensureDemoTodayBookings,
  ensureEveningSlotsExtended,
} from "./store/demo-bookings.js";
import { ensureDemoLiveActivity } from "./store/demo-live-activity.js";
import { hasDemoSnapshot, restoreDemoSnapshot } from "./store/demo-snapshot.js";
import { ensureSlotsAhead } from "./store/slots-ahead.js";
import { startHourlyJobs } from "./store/jobs.js";

export async function bootstrap(): Promise<void> {
  assertProductionSafe();
  ensureDemoSamlCerts();
  initDemoUsersFromEnv();
  initDemoSetupFromEnv();
  await initDb();
  await migrateSchema();
  const snapshotActive = isDemoMode() && hasDemoSnapshot();
  const demoEmpty = isDemoEmptyMode();
  const skipSeedBookings = snapshotActive || demoEmpty;
  /* REVISION-23 R1/R2: a semente de demo só en modo demo, sen foto gardada nin PA_DEMO_EMPTY.
   * Nun concello (NODE_ENV=production, PA_DEMO=0) o primeiro
   * arranque vai con `npm run setup` / `admin` (baleiro). */
  if (isDemoMode()) {
    if (snapshotActive) {
      const existingMunis = await getDb()
        .select({ id: t.municipalities.id })
        .from(t.municipalities)
        .limit(1);
      if (existingMunis.length === 0) {
        try {
          await restoreDemoSnapshot();
          console.info("[boot] foto da demo restaurada en BD baleira");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(
            `[boot] non se puido restaurar a foto da demo (${msg}); arranque co estado actual da BD`,
          );
        }
      } else {
        console.info("[boot] foto da demo activa (sen semente)");
      }
    } else if (demoEmpty) {
      await seedEmptyDemoDb();
      const setup = await applyDemoSetupFile();
      if (setup.created.length || setup.skipped.length) {
        console.info(
          `[boot] DEMO_SETUP_FILE: creados=${setup.created.length} omitidos=${setup.skipped.length}`,
        );
      }
    } else {
      await seedDb();
    }
  } else {
    console.info("[boot] sen semente de demo (produción / concello)");
  }
  await anonymizePastBookings();
  /* REVISION-20 H1: sempre (demo e produción). */
  const n = await ensureSlotsAhead();
  if (n > 0) console.info(`[boot] franxas +${n}`);
  if (isDemoMode() && !skipSeedBookings) {
    await ensureEveningSlotsExtended();
    const b = await ensureDemoTodayBookings();
    await ensureAnaTomorrowBooking();
    await ensureAnaWaitlistOffer();
    if (b > 0) console.info(`[boot] reservas demo hoxe +${b}`);
  }
  if (isDemoMode() && demoEmpty) {
    const live = await ensureDemoLiveActivity();
    if (live.bookingsCreated > 0 || live.openMatchesCreated > 0) {
      console.info(
        `[boot] actividade viva demo: reservas=+${live.bookingsCreated} partidos=+${live.openMatchesCreated}`,
      );
    }
  }
  startHourlyJobs();
  console.info(`[boot] DB lista (${getDbMode()})`);
}
