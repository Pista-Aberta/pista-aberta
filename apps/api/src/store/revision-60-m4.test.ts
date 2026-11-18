import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Hono } from "hono";
import { initDb, closeDb } from "../db/client.js";
import { migrateSchema } from "../db/migrate.js";
import { seedDb } from "../db/seed-db.js";
import { applyToActivity, getActivity } from "./db.js";
import { createActivityAdmin, updateActivityAdmin } from "./admin-ops.js";
import { createSession, setSessionActiveMuniRole } from "../identity/sessions.js";
import { optionalAuth } from "../middleware/auth.js";
import { adminMellorasRoutes } from "../routes/admin-melloras.js";
import { addDaysIso, todayIso } from "./business-rules.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-rev60-m4-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.SESSION_SECRET = "test-secret-revision-60-m4";
process.env.NODE_ENV = "test";
process.env.PA_DEMO = "1";

describe("REVISION-60 M4 PUT admin/actividades/:id e bloqueo post-sorteo", () => {
  const mid = "muni-exemplo";
  const app = new Hono();
  app.use("*", optionalAuth);
  app.route("/", adminMellorasRoutes);

  let adminCookie = "";
  let actId = "";

  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();

    const sid = await createSession({
      id: "user-admin",
      municipalityId: mid,
      role: "admin",
      displayName: "Admin Exemplo",
      email: "admin@exemplo.gal",
      locale: "gl",
    });
    await setSessionActiveMuniRole(sid, "admin", mid);
    adminCookie = `pa_sesion=${sid}`;

    const act = await createActivityAdmin(mid, "Admin Exemplo", {
      name: "Pádel xuvenil M4",
      description: "Actividade con sorteo",
      facilityId: "fac-exemplo-padel",
      days: "Martes e xoves",
      hours: "17:00–18:00",
      places: 2,
      ageMin: 6,
      ageMax: 16,
      method: "lottery",
      deadline: addDaysIso(todayIso(), 10),
    });
    assert.ok(act);
    actId = act!.id;
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("rexeita poñer lotteryStatus='drawn' por PUT (400) e na función interna", async () => {
    const res = await app.request(`/api/c/exemplo/admin/actividades/${actId}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: adminCookie,
      },
      body: JSON.stringify({ lotteryStatus: "drawn" }),
    });
    assert.equal(res.status, 400);

    await assert.rejects(
      () =>
        updateActivityAdmin(
          mid,
          actId,
          "Admin Exemplo",
          { lotteryStatus: "drawn" as unknown as "open" },
        ),
      /invalid_lottery_status/,
    );

    const check = await getActivity(actId);
    assert.equal(check?.lotteryStatus, "open");
    assert.equal(check?.lotterySecret, null);
  });

  it("permite cambiar open <-> closed antes do sorteo", async () => {
    const closeRes = await app.request(`/api/c/exemplo/admin/actividades/${actId}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: adminCookie,
      },
      body: JSON.stringify({ lotteryStatus: "closed" }),
    });
    assert.equal(closeRes.status, 200);
    assert.equal((await getActivity(actId))?.lotteryStatus, "closed");

    const openRes = await app.request(`/api/c/exemplo/admin/actividades/${actId}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: adminCookie,
      },
      body: JSON.stringify({ lotteryStatus: "open" }),
    });
    assert.equal(openRes.status, 200);
    assert.equal((await getActivity(actId))?.lotteryStatus, "open");
  });

  it("tras runLottery devolve 409 lottery_already_drawn ao tentar cambiar places, method ou lotteryStatus", async () => {
    await applyToActivity({
      activityId: actId,
      municipalityId: mid,
      userId: "user-cidada",
      forMemberId: "fam-1",
    });

    const drawRes = await app.request(`/api/c/exemplo/admin/actividades/${actId}/sortear`, {
      method: "POST",
      headers: { cookie: adminCookie },
    });
    assert.equal(drawRes.status, 200);
    assert.equal((await getActivity(actId))?.lotteryStatus, "drawn");

    const placesRes = await app.request(`/api/c/exemplo/admin/actividades/${actId}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: adminCookie,
      },
      body: JSON.stringify({ places: 10 }),
    });
    assert.equal(placesRes.status, 409);
    assert.deepEqual(await placesRes.json(), { error: "lottery_already_drawn" });

    const methodRes = await app.request(`/api/c/exemplo/admin/actividades/${actId}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: adminCookie,
      },
      body: JSON.stringify({ method: "first_come" }),
    });
    assert.equal(methodRes.status, 409);
    assert.deepEqual(await methodRes.json(), { error: "lottery_already_drawn" });

    const reopenRes = await app.request(`/api/c/exemplo/admin/actividades/${actId}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: adminCookie,
      },
      body: JSON.stringify({ lotteryStatus: "open" }),
    });
    assert.equal(reopenRes.status, 409);
    assert.deepEqual(await reopenRes.json(), { error: "lottery_already_drawn" });

    const descRes = await app.request(`/api/c/exemplo/admin/actividades/${actId}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: adminCookie,
      },
      body: JSON.stringify({ description: "Descrición actualizada" }),
    });
    assert.equal(descRes.status, 200);
    assert.equal((await getActivity(actId))?.places, 2);
  });

  it("P2: con solicitude pending devolve 409 has_applications ao tentar cambiar method", async () => {
    const p2Act = await createActivityAdmin(mid, "Admin Exemplo", {
      name: "Tenis infantil P2",
      description: "Actividade para probar cambio de método",
      facilityId: "fac-exemplo-padel",
      days: "Mércores",
      hours: "18:00–19:00",
      places: 4,
      ageMin: 6,
      ageMax: 16,
      method: "lottery",
      deadline: addDaysIso(todayIso(), 10),
    });
    assert.ok(p2Act);

    const noAppsSwitch = await app.request(
      `/api/c/exemplo/admin/actividades/${p2Act!.id}`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: adminCookie,
        },
        body: JSON.stringify({ method: "first_come" }),
      },
    );
    assert.equal(noAppsSwitch.status, 200);
    assert.equal((await getActivity(p2Act!.id))?.method, "first_come");

    const backToLottery = await app.request(
      `/api/c/exemplo/admin/actividades/${p2Act!.id}`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: adminCookie,
        },
        body: JSON.stringify({ method: "lottery" }),
      },
    );
    assert.equal(backToLottery.status, 200);
    assert.equal((await getActivity(p2Act!.id))?.method, "lottery");

    const pendingApp = await applyToActivity({
      activityId: p2Act!.id,
      municipalityId: mid,
      userId: "user-cidada",
      forMemberId: "fam-1",
    });
    assert.equal(pendingApp.status, "pending");

    const changeMethodRes = await app.request(
      `/api/c/exemplo/admin/actividades/${p2Act!.id}`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: adminCookie,
        },
        body: JSON.stringify({ method: "first_come" }),
      },
    );
    assert.equal(changeMethodRes.status, 409);
    assert.deepEqual(await changeMethodRes.json(), { error: "has_applications" });
    assert.equal((await getActivity(p2Act!.id))?.method, "lottery");

    await assert.rejects(
      () =>
        updateActivityAdmin(mid, p2Act!.id, "Admin Exemplo", {
          method: "first_come",
        }),
      /has_applications/,
    );

    const sameMethodRes = await app.request(
      `/api/c/exemplo/admin/actividades/${p2Act!.id}`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: adminCookie,
        },
        body: JSON.stringify({ method: "lottery", places: 6 }),
      },
    );
    assert.equal(sameMethodRes.status, 200);
    assert.equal((await getActivity(p2Act!.id))?.places, 6);
  });
});
