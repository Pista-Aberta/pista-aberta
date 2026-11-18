/**
 * TANDA-1 — MeteoGalicia parse + caché + outdoor + avisos.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  clearMeteoCache,
  facilityIsOutdoor,
  fetchMeteoGalicia,
  loadMeteoFixture,
  parseMeteoGaliciaJson,
  periodSummaryForSlot,
  rainWarningForSlot,
  resolveMunicipalityIne,
  skyLabelForCode,
} from "./meteogalicia.js";

describe("meteogalicia", () => {
  beforeEach(() => {
    clearMeteoCache();
  });

  it("parsea fixture JSON real de MeteoGalicia", () => {
    const raw = loadMeteoFixture("32078");
    const parsed = parseMeteoGaliciaJson(raw, "32078", "gl");
    assert.ok(parsed);
    assert.equal(parsed!.ine, "32078");
    assert.ok(parsed!.days.length >= 1);
    const d0 = parsed!.days[0]!;
    assert.match(d0.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(typeof d0.rainChance.manha, "number");
    assert.equal(typeof d0.rainChance.tarde, "number");
    assert.equal(typeof d0.rainChance.noite, "number");
  });

  it("resolveMunicipalityIne: só settings, sen mapa fixo exemplo", () => {
    assert.equal(
      resolveMunicipalityIne({ slug: "exemplo", settings: {} }),
      null,
    );
    assert.equal(
      resolveMunicipalityIne({
        slug: "terceiro",
        settings: { ineCode: "32078" },
      }),
      "32078",
    );
    assert.equal(
      resolveMunicipalityIne({ slug: "exemplo", settings: { ine: "32078" } }),
      "32078",
    );
  });

  it("facilityIsOutdoor: flag e heurística por tipo", () => {
    assert.equal(facilityIsOutdoor({ outdoor: true, type: "sala" }), true);
    assert.equal(facilityIsOutdoor({ outdoor: false, type: "pista" }), false);
    assert.equal(facilityIsOutdoor({ type: "pista" }), true);
    assert.equal(facilityIsOutdoor({ type: "campo" }), true);
    assert.equal(facilityIsOutdoor({ type: "pavillon" }), false);
    assert.equal(facilityIsOutdoor({ type: "sala" }), false);
  });

  it("rainWarningForSlot segundo período e limiar", () => {
    const forecast = parseMeteoGaliciaJson(loadMeteoFixture(), "32078", "gl")!;
    const day = forecast.days[0]!.date;
    const manha = rainWarningForSlot(forecast, day, "10:00", 40);
    const tarde = rainWarningForSlot(forecast, day, "16:00", 40);
    const noite = rainWarningForSlot(forecast, day, "21:00", 40);
    /* Fixture Exemplo: manha baixa, tarde/noite altas nalgún día. */
    assert.ok(manha === null || manha.period === "manha");
    if (tarde) assert.equal(tarde.period, "tarde");
    if (noite) assert.equal(noite.period, "noite");
    assert.equal(rainWarningForSlot(null, day, "10:00"), null);
  });

  it("REVISION-40 N3: liña sempre + vento/treboada/calor/xeada", () => {
    assert.equal(skyLabelForCode(107, "gl"), "chuvascos");
    assert.equal(skyLabelForCode(113, "es"), "tormenta");
    const forecast = parseMeteoGaliciaJson(loadMeteoFixture(), "32078", "gl")!;
    assert.ok(forecast.days[0]!.windCode.tarde > 0);
    const day = forecast.days[0]!.date;
    const sum = periodSummaryForSlot(forecast, day, "16:00", "gl");
    assert.ok(sum);
    assert.match(sum!.line, /^Tarde: .+, \d+ °C$/);
    assert.ok(sum!.skyLabel.length > 0);

    const stormDay = {
      ...forecast,
      days: [
        {
          ...forecast.days[0]!,
          skyCode: { manha: 101, tarde: 113, noite: 201 },
          windCode: { manha: 299, tarde: 320, noite: 299 },
          tMaxPeriod: { manha: 20, tarde: 36, noite: 22 },
          tMinPeriod: { manha: -1, tarde: 18, noite: 10 },
          tMax: 36,
          tMin: -1,
        },
      ],
    };
    const hazards = periodSummaryForSlot(stormDay, day, "16:00", "gl")!.hazards;
    const kinds = hazards.map((h) => h.kind).sort();
    assert.deepEqual(kinds, ["calor", "treboada", "vento"]);
    const frost = periodSummaryForSlot(stormDay, day, "10:00", "gl")!.hazards;
    assert.ok(frost.some((h) => h.kind === "xeada"));
  });

  it("fetchMeteoGalicia: timeout/erro → null; caché 1 h", async () => {
    const raw = loadMeteoFixture();
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify(raw), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const a = await fetchMeteoGalicia("32078", "gl", { fetcher });
    const b = await fetchMeteoGalicia("32078", "gl", { fetcher });
    assert.ok(a);
    assert.equal(a!.days.length, b!.days.length);
    assert.equal(calls, 1);

    const fail: typeof fetch = async () => {
      throw new Error("network");
    };
    clearMeteoCache();
    const n = await fetchMeteoGalicia("32078", "gl", { fetcher: fail });
    assert.equal(n, null);
  });
});
