/**
 * Redeseno B — comprobacións de copy crítico (toast cancelar, consentimento).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

function loadI18n(lang: "gl" | "es"): Record<string, string> {
  return JSON.parse(
    readFileSync(join(root, `apps/web/src/i18n/${lang}.json`), "utf8"),
  ) as Record<string, string>;
}

describe("redeseno B copy", () => {
  it("B5 toast de cancelación presente en gl e es", () => {
    const gl = loadI18n("gl");
    const es = loadI18n("es");
    assert.match(gl["bookings.cancelToast"] ?? "", /lista de espera/i);
    assert.match(es["bookings.cancelToast"] ?? "", /lista de espera/i);
    assert.equal(gl["bookings.cancelConfirm"], "Si, cancelar a reserva");
  });

  it("B3 botón único de consentimento", () => {
    const gl = loadI18n("gl");
    assert.equal(gl["consent.acceptContinue"], "Aceptar e continuar");
    assert.ok(gl["consent.whatTitle"]);
    assert.ok(gl["consent.whyTitle"]);
    assert.ok(gl["consent.howLongTitle"]);
  });

  it("B7 cartel QR de check-in", () => {
    const gl = loadI18n("gl");
    assert.match(gl["poster.scanCheckIn"] ?? "", /Escanea ao chegar/i);
  });
});
