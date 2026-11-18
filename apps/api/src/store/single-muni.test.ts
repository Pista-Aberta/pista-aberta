/**
 * REVISION-22 A8 — PA_SINGLE_MUNI no /api/config e helpers.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { getSingleMuniSlug } from "../env.js";

describe("REVISION-22 A8 PA_SINGLE_MUNI", () => {
  afterEach(() => {
    delete process.env.PA_SINGLE_MUNI;
    delete process.env.VITE_PA_SINGLE_MUNI;
  });

  it("le PA_SINGLE_MUNI e normaliza o slug", () => {
    process.env.PA_SINGLE_MUNI = "Exemplo!";
    assert.equal(getSingleMuniSlug(), "exemplo");
  });

  it("acepta VITE_PA_SINGLE_MUNI como fallback", () => {
    process.env.VITE_PA_SINGLE_MUNI = "ribeira";
    assert.equal(getSingleMuniSlug(), "ribeira");
  });

  it("null se non está definido", () => {
    assert.equal(getSingleMuniSlug(), null);
  });

  it("o texto «Escolle o teu concello» só vive na UI multiconcello (gardas de código)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    /* npm test -w api → cwd = apps/api */
    const root = path.resolve(process.cwd(), "..", "..");
    const maybeWeb = path.join(root, "apps/web/src/App.tsx");
    const rootAlt = fs.existsSync(maybeWeb)
      ? root
      : path.resolve(process.cwd(), "..");
    const r = fs.existsSync(maybeWeb) ? root : rootAlt;
    const app = fs.readFileSync(path.join(r, "apps/web/src/App.tsx"), "utf8");
    assert.match(app, /SingleMuniRedirect/);
    const gl = fs.readFileSync(path.join(r, "apps/web/src/i18n/gl.json"), "utf8");
    assert.match(gl, /Escolle o teu concello/);
    const demoBar = fs.readFileSync(
      path.join(r, "apps/web/src/components/DemoProfileBar.tsx"),
      "utf8",
    );
    assert.match(demoBar, /singleMuni/);
    const gate = fs.readFileSync(
      path.join(r, "apps/web/src/components/DeputacionGate.tsx"),
      "utf8",
    );
    assert.match(gate, /singleMuni/);
  });
});
