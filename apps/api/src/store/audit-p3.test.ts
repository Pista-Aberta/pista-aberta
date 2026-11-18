import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isDemoMode } from "../env.js";
import { quietHoursDateTo } from "./horas-tranquilas.js";

describe("audit P3 regressions", () => {
  it("inclúe unha viewDate afastada no rango de horas tranquilas", () => {
    assert.equal(quietHoursDateTo("2026-11-13", "2026-11-18"), "2026-11-18");
    assert.equal(quietHoursDateTo("2026-11-13", "2026-11-13"), "2026-11-14");
  });

  it("só activa demo explicitamente fóra de tests", () => {
    const previous = { NODE_ENV: process.env.NODE_ENV, PA_DEMO: process.env.PA_DEMO };
    try {
      process.env.NODE_ENV = "development";
      delete process.env.PA_DEMO;
      assert.equal(isDemoMode(), false);

      process.env.PA_DEMO = "1";
      assert.equal(isDemoMode(), true);

      delete process.env.PA_DEMO;
      process.env.NODE_ENV = "test";
      assert.equal(isDemoMode(), true);
    } finally {
      if (previous.NODE_ENV === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous.NODE_ENV;
      if (previous.PA_DEMO === undefined) delete process.env.PA_DEMO;
      else process.env.PA_DEMO = previous.PA_DEMO;
    }
  });
});
