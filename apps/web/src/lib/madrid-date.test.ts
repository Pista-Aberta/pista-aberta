import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { madridTodayAndHm } from "./madrid-date";

const here = path.dirname(fileURLToPath(import.meta.url));

test("madridTodayAndHm calculates local date in Europe/Madrid between 00:00 and 02:00", () => {
  // Winter (CET = UTC+1): 2026-01-15T23:30:00Z is 2026-01-16 00:30 in Madrid
  const winter = madridTodayAndHm(new Date("2026-01-15T23:30:00Z"), "Europe/Madrid");
  assert.equal(winter.today, "2026-01-16");
  assert.equal(winter.hm, "00:30");

  // Summer (CEST = UTC+2): 2026-07-15T22:45:00Z is 2026-07-16 00:45 in Madrid
  const summer = madridTodayAndHm(new Date("2026-07-15T22:45:00Z"), "Europe/Madrid");
  assert.equal(summer.today, "2026-07-16");
  assert.equal(summer.hm, "00:45");
});

test("MyBookingsPage does not use UTC toISOString().slice(0, 10)", () => {
  const src = fs.readFileSync(
    path.resolve(here, "../pages/MyBookingsPage.tsx"),
    "utf8",
  );
  assert.equal(src.includes("toISOString().slice(0, 10)"), false);
  assert.equal(src.includes("madridTodayAndHm"), true);
});
