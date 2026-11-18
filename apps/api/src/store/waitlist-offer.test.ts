/**
 * Redeseno B6 — contador da oferta de lista de espera.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { offerCountdown, formatOfferCountdown } from "@pista-aberta/shared";

describe("offerCountdown", () => {
  it("calcula minutos restantes e etiqueta HH:MM", () => {
    const now = new Date("2026-10-23T16:00:00.000Z"); // 18:00 CEST
    const until = new Date("2026-10-23T16:23:00.000Z"); // 18:23 CEST
    const c = offerCountdown(until.toISOString(), now, "Europe/Madrid");
    assert.ok(c);
    assert.equal(c!.minutesLeft, 23);
    assert.equal(c!.expired, false);
    assert.match(c!.untilLabel, /18:23/);
  });

  it("marca expirada se o prazo pasou", () => {
    const now = new Date("2026-10-23T17:00:00.000Z");
    const until = new Date("2026-10-23T16:00:00.000Z");
    const c = offerCountdown(until.toISOString(), now, "Europe/Madrid");
    assert.ok(c);
    assert.equal(c!.expired, true);
    assert.equal(c!.minutesLeft, 0);
  });

  it("formatOfferCountdown devolve o texto da UI", () => {
    const now = new Date("2026-10-23T16:00:00.000Z");
    const until = new Date("2026-10-23T16:30:00.000Z");
    const s = formatOfferCountdown(until.toISOString(), now, "Europe/Madrid");
    assert.ok(s);
    assert.match(s!, /Apartada ata as/);
    assert.match(s!, /quedan 30 min/);
  });

  it("null se non hai prazo", () => {
    assert.equal(offerCountdown(null), null);
    assert.equal(formatOfferCountdown(undefined), null);
  });
});
