import assert from "node:assert/strict";
import { describe, it } from "node:test";

/** Mirror of apps/web/src/lib/free-hours.ts — N1 regression. */
function slotsForUnit<T extends { start: string; unitId?: string; id: string }>(
  slots: T[],
  unitId: string | undefined,
): T[] {
  const filtered = unitId ? slots.filter((s) => !s.unitId || s.unitId === unitId) : slots;
  return [...filtered].sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
}

function hasDuplicateHours(slots: { start: string }[]): boolean {
  const seen = new Set<string>();
  for (const s of slots) {
    if (seen.has(s.start)) return true;
    seen.add(s.start);
  }
  return false;
}

function groupFreeHoursByStart<T extends { start: string; id: string }>(slots: T[]) {
  const byStart = new Map<string, T[]>();
  for (const s of slots) {
    const list = byStart.get(s.start) ?? [];
    list.push(s);
    byStart.set(s.start, list);
  }
  return [...byStart.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([start, group]) => ({ start, count: group.length, primary: group[0]! }));
}

describe("REVISION-9 N1 free hours", () => {
  const slots = [
    { id: "a", start: "20:00", unitId: "u1" },
    { id: "b", start: "20:00", unitId: "u2" },
    { id: "c", start: "21:00", unitId: "u1" },
    { id: "d", start: "09:00", unitId: "u2" },
  ];

  it("unit grid has no duplicate hours and is sorted", () => {
    const u1 = slotsForUnit(slots, "u1");
    assert.deepEqual(
      u1.map((s) => s.start),
      ["20:00", "21:00"],
    );
    assert.equal(hasDuplicateHours(u1), false);
  });

  it("hub/portada group same hour as «N pistas»", () => {
    const g = groupFreeHoursByStart(slots).find((x) => x.start === "20:00");
    assert.equal(g?.count, 2);
  });
});
