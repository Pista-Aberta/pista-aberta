import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Hono } from "hono";
import { originGuard } from "./origin-guard.js";
import { requireAuth } from "./auth.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("REVISION-46 originGuard", () => {
  it("rexeita cross-site e Origin allea; exceptúa widget e auth", () => {
    const src = readFileSync(join(here, "origin-guard.ts"), "utf8");
    assert.match(src, /forbidden_origin/);
    assert.match(src, /sec-fetch-site/);
    assert.match(src, /cross-site/);
    assert.match(src, /\/widget/);
    assert.match(src, /\/auth\//);
    assert.match(src, /POST/);
    assert.match(src, /PATCH/);
    assert.match(src, /DELETE/);
  });

  it("está cableado en index.ts", () => {
    const idx = readFileSync(join(here, "../index.ts"), "utf8");
    assert.match(idx, /originGuard/);
  });

  it("CORS landing permite facilities e partidos-abertos", () => {
    const idx = readFileSync(join(here, "../index.ts"), "utf8");
    assert.match(idx, /partidos-abertos\$/);
    assert.match(idx, /facilities\$/);
    assert.match(idx, /LANDING_ORIGIN/);
  });

  it("aplica originGuard e auth con terminadores codificados e barras inversas", async () => {
    const app = new Hono();
    app.use("*", originGuard);
    app.use("*", requireAuth);
    app.all("*", (c) => c.body(null, 204));

    for (const path of [
      "/api/private%0a/ignored",
      "/api/private%0d/ignored",
      "/api/private%00/ignored",
      String.raw`/api/private\ignored`,
    ]) {
      const rejectedByOrigin = await app.request(path, {
        method: "POST",
        headers: { origin: "https://attacker.invalid" },
      });
      assert.equal(rejectedByOrigin.status, 403, path);

      const rejectedByAuth = await app.request(path, {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      });
      assert.equal(rejectedByAuth.status, 401, path);
    }
  });
});
