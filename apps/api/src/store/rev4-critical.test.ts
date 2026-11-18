/**
 * Rev4 erros 1–3: HTTP 201 lista-espera/incidencias, OTP prod sen código nos logs,
 * waitlist orde/hold/límite.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-rev4-"));
process.env.PGLITE_DATA_DIR = tmp;
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-secret-rev4-critical";
delete process.env.DATABASE_URL;
delete process.env.SMTP_HOST;

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { createSession } = await import("../identity/sessions.js");
const { completeRoutes } = await import("../routes/complete.js");
const { SAML_DEMO_USERS } = await import("../identity/saml-users.js");
const {
  addWaitlist,
  offerWaitlistOnCancel,
  WAITLIST_MAX_QUEUES,
  expireWaitlistOffers,
} = await import("./extra.js");
const { createBooking, cancelBooking, listSlots } = await import("./db.js");
const { addDaysIso, todayIso } = await import("./business-rules.js");
const t = await import("../db/schema.js");
const { eq } = await import("drizzle-orm");

async function cookieFor(userKey: keyof typeof SAML_DEMO_USERS): Promise<string> {
  const u = SAML_DEMO_USERS[userKey]!;
  const { key: _k, givenName: _g, familyName: _f, ...rest } = u;
  const sid = await createSession(rest);
  return `pa_sesion=${sid}`;
}

function buildApp() {
  const app = new Hono();
  app.route("/", completeRoutes);
  return app;
}

describe("Rev4 critical 1–3", () => {
  const app = buildApp();
  const mid = "muni-exemplo";

  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("lint: requireSameMunicipality sen () non aparece como middleware", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const routesDir = path.resolve(here, "../routes");
    const indexFile = path.resolve(here, "../index.ts");
    const files = [
      ...fs.readdirSync(routesDir).map((f) => path.join(routesDir, f)),
      indexFile,
    ].filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    const bare: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      // Quitar bloques import { ... } para non false-positive.
      const stripped = src.replace(/import\s*\{[\s\S]*?\}\s*from\s*["'][^"']+["'];?/g, "");
      const re = /requireSameMunicipality(?!\()/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(stripped))) {
        const ctx = stripped.slice(Math.max(0, m.index - 20), m.index + 30).replace(/\s+/g, " ");
        bare.push(`${path.basename(f)}: …${ctx}…`);
      }
    }
    assert.deepEqual(bare, [], `requireSameMunicipality sen (): ${bare.join("; ")}`);
  });

  it("HTTP POST /incidencias → 201 + fila BD", async () => {
    const cookie = await cookieFor("cidada");
    const res = await app.request("/api/c/exemplo/incidencias", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        facilityId: "fac-exemplo-padel",
        body: "Proba incidencia Rev4 — a porta non pecha.",
      }),
    });
    assert.equal(res.status, 201, await res.clone().text());
    const body = (await res.json()) as { data?: { id: string; status: string } };
    assert.ok(body.data?.id);
    assert.equal(body.data?.status, "open");
    const rows = await getDb()
      .select()
      .from(t.incidents)
      .where(eq(t.incidents.id, body.data!.id))
      .limit(1);
    assert.equal(rows.length, 1);
  });

  async function insertSlot(opts: {
    id: string;
    date: string;
    start: string;
    end: string;
  }) {
    await getDb().insert(t.timeSlots).values({
      id: opts.id,
      unitId: "unit-padel-1",
      municipalityId: mid,
      date: opts.date,
      start: opts.start,
      end: opts.end,
      closed: false,
    });
  }

  it("HTTP POST /lista-espera → 201 + fila BD", async () => {
    const cookie = await cookieFor("brais");
    const date = addDaysIso(todayIso(), 2);
    const slotId = `slot-rev4-wl-${Date.now().toString(36)}`;
    await insertSlot({ id: slotId, date, start: "05:00", end: "06:00" });

    const res = await app.request("/api/c/exemplo/lista-espera", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ slotId }),
    });
    assert.equal(res.status, 201, await res.clone().text());
    const body = (await res.json()) as { data?: { id: string; status: string } };
    assert.ok(body.data?.id);
    assert.equal(body.data?.status, "waiting");
    const rows = await getDb()
      .select()
      .from(t.waitlistEntries)
      .where(eq(t.waitlistEntries.id, body.data!.id))
      .limit(1);
    assert.equal(rows.length, 1);
  });

  it("OTP produción + SMTP fallido non loguea o código", async () => {
    const prevEnv = process.env.NODE_ENV;
    const prevHost = process.env.SMTP_HOST;
    process.env.NODE_ENV = "production";
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = "1"; // porto pechado
    const logs: string[] = [];
    const origInfo = console.info;
    const origWarn = console.warn;
    console.info = (...a: unknown[]) => {
      logs.push(a.map(String).join(" "));
    };
    console.warn = (...a: unknown[]) => {
      logs.push(a.map(String).join(" "));
    };
    try {
      const { EmailOtpIdentityProvider } = await import("../identity/email-otp.js");
      const provider = new EmailOtpIdentityProvider();
      // Inxectar código coñecido vía login (lanzará ao fallar SMTP)
      await assert.rejects(
        () =>
          provider.login({
            method: "email_otp",
            identifier: "otp-prod-test@demo.pistaaberta.com",
            municipalityId: mid,
          }),
        /Non se puido enviar/,
      );
      const joined = logs.join("\n");
      // Non debe aparecer un código de 6 díxitos nos logs
      assert.equal(/\b\d{6}\b/.test(joined), false, `logs filtraron código: ${joined}`);
    } finally {
      console.info = origInfo;
      console.warn = origWarn;
      process.env.NODE_ENV = prevEnv;
      if (prevHost === undefined) delete process.env.SMTP_HOST;
      else process.env.SMTP_HOST = prevHost;
    }
  });

  it("waitlist: Ana reserva, Luis cola, Ana cancela → Luis offered + hold", async () => {
    const date = addDaysIso(todayIso(), 2);
    const slotId = `slot-rev4-flow-${Date.now().toString(36)}`;
    await insertSlot({ id: slotId, date, start: "05:30", end: "06:30" });

    const booking = await createBooking({
      municipalityId: mid,
      slotId,
      userId: "user-cidada",
      userDisplayName: "Ana Demo",
    });
    await addWaitlist({
      municipalityId: mid,
      slotId,
      userId: "user-brais",
      userDisplayName: "Luis Demo",
    });
    await cancelBooking(booking.id, "user-cidada");
    /* O hook de cancelación (await) xa oferta a waitlist; unha 2ª chamada
     * baleira waiting e limpa o hold. */

    const entries = await getDb()
      .select()
      .from(t.waitlistEntries)
      .where(eq(t.waitlistEntries.slotId, slotId));
    const brais = entries.find((e) => e.userId === "user-brais");
    assert.equal(brais?.status, "offered");
    assert.ok(brais?.offeredUntil);

    const slots = await getDb()
      .select()
      .from(t.timeSlots)
      .where(eq(t.timeSlots.id, slotId))
      .limit(1);
    assert.equal(slots[0]?.heldForUserId, "user-brais");
    assert.ok(slots[0]?.heldUntil);

    // Outra persoa non pode reservar mentres hai hold
    await getDb()
      .insert(t.users)
      .values({
        id: "user-carla",
        municipalityId: mid,
        role: "citizen",
        displayName: "Carla Test",
        email: "carla@demo.pistaaberta.com",
        locale: "gl",
        active: true,
      })
      .onConflictDoNothing();
    await assert.rejects(
      () =>
        createBooking({
          municipalityId: mid,
          slotId,
          userId: "user-carla",
          userDisplayName: "Carla Test",
        }),
      /slot_held/,
    );

    // Franxa aparece ocupada na grella
    const listed = await listSlots({ municipalityId: mid, date });
    const row = listed.find((s) => s.id === slotId);
    assert.equal(row?.occupied, true);

    // Aviso in-app para Luis
    const notices = await getDb()
      .select()
      .from(t.notices)
      .where(eq(t.notices.userId, "user-brais"));
    assert.ok(notices.some((n) => n.type === "waitlist" && n.body.includes("Apartámosche")));
  });

  it("waitlist: máximo 3 colas por persoa", async () => {
    const date = addDaysIso(todayIso(), 3);
    for (let i = 0; i < WAITLIST_MAX_QUEUES; i++) {
      const slotId = `slot-rev4-lim-${Date.now().toString(36)}-${i}`;
      await insertSlot({
        id: slotId,
        date,
        start: `0${4 + i}:00`.slice(-5),
        end: `0${5 + i}:00`.slice(-5),
      });
      await addWaitlist({
        municipalityId: mid,
        slotId,
        userId: "user-carla",
        userDisplayName: "Carla Test",
      });
    }
    const extraId = `slot-rev4-lim-x-${Date.now().toString(36)}`;
    await insertSlot({ id: extraId, date, start: "07:45", end: "08:45" });
    await assert.rejects(
      () =>
        addWaitlist({
          municipalityId: mid,
          slotId: extraId,
          userId: "user-carla",
          userDisplayName: "Carla Test",
        }),
      /waitlist_limit/,
    );
  });

  it("waitlist: oferta caducada pasa á seguinte", async () => {
    const date = addDaysIso(todayIso(), 4);
    const slotId = `slot-rev4-exp-${Date.now().toString(36)}`;
    await insertSlot({ id: slotId, date, start: "04:45", end: "05:45" });
    await addWaitlist({
      municipalityId: mid,
      slotId,
      userId: "user-brais",
      userDisplayName: "Luis Demo",
    });
    await getDb()
      .insert(t.users)
      .values({
        id: "user-diego",
        municipalityId: mid,
        role: "citizen",
        displayName: "Miguel Test",
        email: "diego@demo.pistaaberta.com",
        locale: "gl",
        active: true,
      })
      .onConflictDoNothing();
    await addWaitlist({
      municipalityId: mid,
      slotId,
      userId: "user-diego",
      userDisplayName: "Miguel Test",
    });
    await offerWaitlistOnCancel(slotId, mid);
    // Forzar caducidade
    const past = new Date(Date.now() - 60_000);
    await getDb()
      .update(t.waitlistEntries)
      .set({ offeredUntil: past })
      .where(eq(t.waitlistEntries.slotId, slotId));
    await getDb()
      .update(t.timeSlots)
      .set({ heldUntil: past })
      .where(eq(t.timeSlots.id, slotId));

    const result = await expireWaitlistOffers(new Date());
    assert.ok(result.expiredOffers >= 1 || result.reoffered >= 1);
    const diego = await getDb()
      .select()
      .from(t.waitlistEntries)
      .where(eq(t.waitlistEntries.userId, "user-diego"));
    assert.ok(diego.some((e) => e.slotId === slotId && e.status === "offered"));
  });
});
