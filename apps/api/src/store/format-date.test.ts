/**
 * Redeseno A2 — formatDateTime na zona Europe/Madrid.
 * Revisión 10 R2 — táboas propias GL (sen toLocaleDateString).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatDate,
  formatDateTime,
  formatDayChip,
  formatDayTimeChip,
  formatMonthYear,
  formatSentAt,
  formatWeekendRangeShort,
} from "@pista-aberta/shared";

describe("formatDate / formatDateTime", () => {
  it("formatDate gl", () => {
    const s = formatDate("2026-10-24", "gl");
    assert.match(s, /outubro/);
    assert.match(s, /24/);
  });

  it("formatDateTime usa Europe/Madrid (non UTC cru)", () => {
    // 16:27 UTC = 18:27 en Europe/Madrid (CEST out 2026)
    const iso = "2026-10-23T16:27:00.000Z";
    const s = formatDateTime(iso, "gl", "Europe/Madrid");
    assert.match(s, /18:27/);
    assert.doesNotMatch(s, /16:27/);
  });

  it("formatDateTime fallback con ISO inválido", () => {
    assert.equal(formatDateTime("not-a-date", "gl"), "not-a-date");
  });

  it("formatMonthYear gl sen M10", () => {
    assert.equal(formatMonthYear(2026, 10, "gl"), "outubro de 2026");
  });

  it("formatDayChip gl", () => {
    assert.equal(formatDayChip("2026-10-28", "gl"), "mér 28");
  });

  it("formatDayTimeChip para resumo de cambio", () => {
    assert.equal(formatDayTimeChip("2026-10-28", "18:00", "gl"), "mér 28, 18:00");
    assert.equal(formatDayTimeChip("2026-10-30", "10:00", "gl"), "ven 30, 10:00");
  });

  it("formatWeekendRangeShort (REVISION-18 T6)", () => {
    assert.equal(
      formatWeekendRangeShort("2026-10-31", "2026-11-01", "gl"),
      "31 out – 1 nov",
    );
  });

  it("formatSentAt hoxe en Europe/Madrid (REVISION-18 T4)", () => {
    // 2026-10-29 xa en CET (UTC+1) tras o cambio de hora
    const iso = "2026-10-29T16:24:00.000Z"; // 17:24 Madrid
    const now = new Date("2026-10-29T18:00:00.000Z");
    const s = formatSentAt(iso, "gl", "Europe/Madrid", now);
    assert.match(s, /enviada hoxe ás 17:24/);
  });
});
