/**
 * REVISION-43 R1 — a semente usa weekendSaturdayIso (domingo = sábado de onte).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSeed } from "./seed.js";
import {
  DEFAULT_TIMEZONE,
  localDateIso,
  weekendSaturdayIso,
} from "./business-rules.js";

/** Mediodía Madrid nun día ISO (evita ambigüidade DST). */
function madridNoon(iso: string): Date {
  return new Date(`${iso}T12:00:00+01:00`);
}

describe("REVISION-43 R1 weekendSaturdayIso na semente", () => {
  it("sábado → partidos dese sábado; domingo → sábado de onte; luns → sábado seguinte", () => {
    const sat = madridNoon("2026-11-07"); // sábado
    const sun = madridNoon("2026-11-08"); // domingo
    const mon = madridNoon("2026-11-09"); // luns

    assert.equal(localDateIso(sat, DEFAULT_TIMEZONE), "2026-11-07");
    assert.equal(localDateIso(sun, DEFAULT_TIMEZONE), "2026-11-08");
    assert.equal(localDateIso(mon, DEFAULT_TIMEZONE), "2026-11-09");

    assert.equal(weekendSaturdayIso(sat, DEFAULT_TIMEZONE), "2026-11-07");
    assert.equal(weekendSaturdayIso(sun, DEFAULT_TIMEZONE), "2026-11-07");
    assert.equal(weekendSaturdayIso(mon, DEFAULT_TIMEZONE), "2026-11-14");

    const seedSat = buildSeed(sat);
    const seedSun = buildSeed(sun);
    const seedMon = buildSeed(mon);

    const pavDates = (data: ReturnType<typeof buildSeed>) =>
      [
        ...new Set(
          data.matches
            .filter((m) => m.facilityId === "fac-exemplo-pav")
            .map((m) => m.date),
        ),
      ].sort();

    /* REVISION-47: a semente engade tamén a fin de semana seguinte (m9–m12). */
    assert.deepEqual(pavDates(seedSat), [
      "2026-11-07",
      "2026-11-08",
      "2026-11-14",
      "2026-11-15",
    ]);
    assert.deepEqual(pavDates(seedSun), [
      "2026-11-07",
      "2026-11-08",
      "2026-11-14",
      "2026-11-15",
    ]);
    assert.deepEqual(pavDates(seedMon), ["2026-11-14", "2026-11-15", "2026-11-21", "2026-11-22"]);

    assert.ok(seedSat.matches.filter((m) => m.facilityId === "fac-exemplo-pav").length >= 6);
    assert.ok(seedSun.matches.filter((m) => m.facilityId === "fac-exemplo-pav").length >= 6);
    assert.ok(seedMon.matches.filter((m) => m.facilityId === "fac-exemplo-pav").length >= 6);
  });
});
