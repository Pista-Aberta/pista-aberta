/**
 * Revisión 10 R1–R3 — QR visible, calendario GL, cambio de reserva.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  formatDayChip,
  formatDayTimeChip,
  formatMonthYear,
} from "@pista-aberta/shared";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

function loadI18n(lang: "gl" | "es"): Record<string, string> {
  return JSON.parse(
    readFileSync(join(root, `apps/web/src/i18n/${lang}.json`), "utf8"),
  ) as Record<string, string>;
}

describe("revisión 10 R1–R3", () => {
  it("R1 Ticket Ver QR usa variant primary (texto e contraste)", () => {
    const src = readFileSync(
      join(root, "apps/web/src/components/ui/Ticket.tsx"),
      "utf8",
    );
    assert.match(src, /variant="primary"/);
    assert.doesNotMatch(
      src,
      /variant="secondary"[\s\S]{0,120}onClick=\{onQr\}/,
    );
    const btn = readFileSync(
      join(root, "apps/web/src/components/ui/Button.tsx"),
      "utf8",
    );
    assert.match(btn, /primary:[\s\S]*?bg-azul[\s\S]*?text-on-dark/);
    const gl = loadI18n("gl");
    assert.ok((gl["ui.ticket.qr"] ?? "").length > 0);
  });

  it("R2 calendario: mês, iniciais e chip de día en galego", () => {
    assert.equal(formatMonthYear(2026, 10, "gl"), "outubro de 2026");
    assert.equal(formatDayChip("2026-10-28", "gl"), "mér 28");
    const cal = readFileSync(
      join(root, "apps/web/src/components/PersonalMonthCalendar.tsx"),
      "utf8",
    );
    assert.match(cal, /\["L", "M", "M", "X", "V", "S", "D"\]/);
    assert.doesNotMatch(cal, /toLocaleDateString/);
    const bookings = readFileSync(
      join(root, "apps/web/src/pages/MyBookingsPage.tsx"),
      "utf8",
    );
    assert.match(bookings, /calendarTab/);
  });

  it("R3 cambio: faixa, resumo e confirmación «Reserva cambiada»", () => {
    const gl = loadI18n("gl");
    assert.match(gl["bookings.modifyBanner"] ?? "", /cambiar/i);
    assert.match(gl["bookings.modifyCancel"] ?? "", /Cancelar/);
    assert.equal(gl["booking.changed"], "Reserva cambiada");
    assert.match(gl["booking.changedNote"] ?? "", /libre/i);
    assert.equal(
      formatDayTimeChip("2026-10-28", "18:00", "gl"),
      "mér 28, 18:00",
    );
    const reserve = readFileSync(
      join(root, "apps/web/src/pages/ReservePage.tsx"),
      "utf8",
    );
    assert.match(reserve, /modifyBanner/);
    assert.match(reserve, /cambiada=1/);
    const confirm = readFileSync(
      join(root, "apps/web/src/pages/BookingConfirmPage.tsx"),
      "utf8",
    );
    assert.match(confirm, /booking\.changed/);
  });
});
