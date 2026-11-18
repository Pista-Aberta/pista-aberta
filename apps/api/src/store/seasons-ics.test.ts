/**
 * REVISION-23 R8 — DTSTART no primeiro día correcto + UNTIL con Z.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  firstWeekdayOnOrAfter,
  seasonSlotRrule,
  seasonUntilUtc,
} from "./seasons.js";

describe("REVISION-23 R8 ICS tempada", () => {
  it("firstWeekdayOnOrAfter: tempada martes → primeiro sábado", () => {
    // 2026-09-01 é martes (weekday 2); sábado = 6
    assert.equal(firstWeekdayOnOrAfter("2026-09-01", 6), "2026-09-05");
    assert.equal(firstWeekdayOnOrAfter("2026-09-05", 6), "2026-09-05");
  });

  it("UNTIL leva Z", () => {
    assert.equal(seasonUntilUtc("2027-06-30"), "20270630T215959Z");
    const r = seasonSlotRrule({ weekday: 6, untilDate: "2027-06-30" });
    assert.match(r, /UNTIL=20270630T215959Z/);
    assert.match(r, /BYDAY=SA/);
  });
});
