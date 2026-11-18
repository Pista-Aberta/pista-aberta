import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { __test, resolveCategoryMinutes } from "./match-csv.js";

describe("match-csv helpers", () => {
  it("parses comma and semicolon CSV", () => {
    const comma = __test.parseCsv("a,b\n1,2");
    assert.deepEqual(comma, [
      ["a", "b"],
      ["1", "2"],
    ]);
    const semi = __test.parseCsv("a;b\n1;2");
    assert.deepEqual(semi, [
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("maps Galician/Spanish headers", () => {
    const idx = __test.mapHeaders([
      "Data",
      "Hora",
      "Local",
      "Visitante",
      "Club",
      "Categoría",
      "Pista",
    ]);
    assert.equal(idx.date, 0);
    assert.equal(idx.start, 1);
    assert.equal(idx.home, 2);
    assert.equal(idx.away, 3);
    assert.equal(idx.club, 4);
    assert.equal(idx.category, 5);
    assert.equal(idx.unit, 6);
  });

  it("adds duration by category", () => {
    assert.equal(__test.addMinutes("18:00", 90), "19:30");
    assert.equal(resolveCategoryMinutes("senior"), 90);
    assert.equal(resolveCategoryMinutes("infantil"), 60);
    assert.equal(resolveCategoryMinutes("xuvenil", { xuvenil: 80 }), 80);
  });

  it("detects time overlaps", () => {
    assert.equal(__test.overlaps("10:00", "11:30", "10:15", "11:45"), true);
    assert.equal(__test.overlaps("10:00", "11:00", "11:00", "12:00"), false);
  });

  it("Q2: findClub prefers exact match, allows single partial, rejects >1 partials", () => {
    const clubs = [
      { id: "club-atletismo", name: "Club Deportivo Exemplo Atletismo", shortName: "Atletismo Exemplo" },
      { id: "club-basquet", name: "Club Deportivo Exemplo", shortName: "Club Deportivo Exemplo" },
      { id: "club-patin", name: "HC Costa da Morte", shortName: "Costa" },
    ];

    // Exact match wins even when a partial match comes earlier in the list
    const exactName = __test.findClub(clubs, "Club Deportivo Exemplo");
    assert.equal(exactName.ambiguous, false);
    assert.equal(exactName.club?.id, "club-basquet");

    const exactId = __test.findClub(clubs, "club-atletismo");
    assert.equal(exactId.ambiguous, false);
    assert.equal(exactId.club?.id, "club-atletismo");

    const exactShort = __test.findClub(clubs, "costa");
    assert.equal(exactShort.ambiguous, false);
    assert.equal(exactShort.club?.id, "club-patin");

    // Unique partial match works
    const singlePartial = __test.findClub(clubs, "Costa da Morte");
    assert.equal(singlePartial.ambiguous, false);
    assert.equal(singlePartial.club?.id, "club-patin");

    // Multiple partial matches with no exact match -> ambiguous
    const multiPartial = __test.findClub(clubs, "Exemplo");
    assert.equal(multiPartial.ambiguous, true);
    assert.equal(multiPartial.club, undefined);

    // No match at all -> neither club nor ambiguous
    const none = __test.findClub(clubs, "Club Inexistente");
    assert.equal(none.ambiguous, false);
    assert.equal(none.club, undefined);
  });
});
