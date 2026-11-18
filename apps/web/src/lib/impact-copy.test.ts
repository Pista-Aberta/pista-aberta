import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import i18next from "i18next";
import gl from "../i18n/gl.json" with { type: "json" };
import es from "../i18n/es.json" with { type: "json" };
import {
  formatClosureImpactBody,
  formatDrawConfirmBody,
  formatFacilityDeactivateImpactBody,
  formatFixedGroupImpactBody,
} from "./impact-copy";

const here = path.dirname(fileURLToPath(import.meta.url));
const webSrcDir = path.resolve(here, "..");
const landingSrcDir = path.resolve(here, "../../../landing/src");

async function makeT(lng: "gl" | "es") {
  const inst = i18next.createInstance();
  await inst.init({
    lng,
    fallbackLng: "gl",
    interpolation: { escapeValue: false },
    resources: {
      gl: { translation: gl },
      es: { translation: es },
    },
  });
  return inst.getFixedT(lng);
}

test("impact-copy pluralizes all 4 (bookings, people) combinations in GL and ES", async () => {
  const tGl = await makeT("gl");
  const tEs = await makeT("es");

  assert.equal(
    formatFixedGroupImpactBody(tGl, { bookings: 1, people: 1 }),
    "Este grupo afecta a 1 reserva (1 persoa). Ao confirmar cancelarase e avisarase.",
  );
  assert.equal(
    formatFixedGroupImpactBody(tGl, { bookings: 2, people: 1 }),
    "Este grupo afecta a 2 reservas (1 persoa). Ao confirmar cancelaranse e avisaranse.",
  );
  assert.equal(
    formatFixedGroupImpactBody(tGl, { bookings: 1, people: 2 }),
    "Este grupo afecta a 1 reserva (2 persoas). Ao confirmar cancelarase e avisarase.",
  );
  assert.equal(
    formatFixedGroupImpactBody(tGl, { bookings: 2, people: 2 }),
    "Este grupo afecta a 2 reservas (2 persoas). Ao confirmar cancelaranse e avisaranse.",
  );

  assert.equal(
    formatFixedGroupImpactBody(tEs, { bookings: 1, people: 1 }),
    "Este grupo afecta a 1 reserva (1 persona). Al confirmar se cancelará y se avisará.",
  );
  assert.equal(
    formatFixedGroupImpactBody(tEs, { bookings: 2, people: 1 }),
    "Este grupo afecta a 2 reservas (1 persona). Al confirmar se cancelarán y se avisará.",
  );
  assert.equal(
    formatFixedGroupImpactBody(tEs, { bookings: 1, people: 2 }),
    "Este grupo afecta a 1 reserva (2 personas). Al confirmar se cancelará y se avisará.",
  );
  assert.equal(
    formatFixedGroupImpactBody(tEs, { bookings: 2, people: 2 }),
    "Este grupo afecta a 2 reservas (2 personas). Al confirmar se cancelarán y se avisará.",
  );
});

test("closure, facility-deactivate, and lottery impact plurals have 0 uninterpolated placeholders", async () => {
  const tGl = await makeT("gl");
  const tEs = await makeT("es");

  assert.equal(
    formatClosureImpactBody(tGl, { bookings: 1, people: 1, matches: 1 }),
    "Este peche afecta a 1 reserva (1 persoa) e a 1 partido.",
  );
  assert.equal(
    formatClosureImpactBody(tGl, { bookings: 3, people: 1, matches: 0 }),
    "Este peche afecta a 3 reservas (1 persoa) e a 0 partidos.",
  );
  assert.equal(
    formatClosureImpactBody(tEs, { bookings: 1, people: 1, matches: 1 }),
    "Este cierre afecta a 1 reserva (1 persona) y a 1 partido.",
  );
  assert.equal(
    formatClosureImpactBody(tEs, { bookings: 1, people: 2, matches: 2 }),
    "Este cierre afecta a 1 reserva (2 personas) y a 2 partidos.",
  );

  assert.equal(
    formatFacilityDeactivateImpactBody(tGl, { bookings: 1, people: 1, matches: 1 }),
    "Seguirá habendo 1 reserva futura (1 persoa) e 1 partido programado. A instalación deixará de verse na reserva; as reservas mantéñense.",
  );
  assert.equal(
    formatFacilityDeactivateImpactBody(tEs, { bookings: 2, people: 1, matches: 0 }),
    "Seguirá habiendo 2 reservas futuras (1 persona) y 0 partidos programados. La instalación dejará de verse en la reserva; las reservas se mantienen.",
  );

  assert.equal(
    formatDrawConfirmBody(tGl, { applications: 1, places: 1 }),
    "Vas sortear con 1 solicitude e 1 praza. Esta acción non se pode desfacer. Continuar?",
  );
  assert.equal(
    formatDrawConfirmBody(tEs, { applications: 1, places: 10 }),
    "Vas a sortear con 1 solicitud y 10 plazas. Esta acción no se puede deshacer. ¿Continuar?",
  );

  for (const s of [
    tGl("openMatch.cancelConfirmN", { count: 1, n: 1 }),
    tEs("openMatch.cancelConfirmN", { count: 1, n: 1 }),
    tGl("admin.todoRequests", { count: 1 }),
    tEs("admin.todoRequests", { count: 1 }),
    tGl("admin.openIncidents", { count: 1 }),
    tEs("admin.openIncidents", { count: 1 }),
  ]) {
    assert.equal(/\{\{.*?\}\}/.test(s), false, `Uninterpolated placeholder in: ${s}`);
  }
});

test("gl.json and es.json keep exact key and placeholder parity", () => {
  const glKeys = Object.keys(gl).sort();
  const esKeys = Object.keys(es).sort();
  assert.deepEqual(glKeys, esKeys);

  assert.ok("admin.closureImpactBody_one" in gl);
  assert.ok("admin.closureImpactBody_other" in gl);
  assert.ok("admin.fixedGroupImpactBody_one" in gl);
  assert.ok("admin.fixedGroupImpactBody_other" in gl);
  assert.equal(
    (gl as Record<string, string>)["activities.citizenStep3"]?.includes("comprobálo"),
    false,
  );

  for (const key of glKeys) {
    const glVars = [...(gl as Record<string, string>)[key]!.matchAll(/\{\{(\w+)\}\}/g)]
      .map((m) => m[1])
      .sort();
    const esVars = [...(es as Record<string, string>)[key]!.matchAll(/\{\{(\w+)\}\}/g)]
      .map((m) => m[1])
      .sort();
    assert.deepEqual(glVars, esVars, `Placeholder mismatch on key ${key}`);
  }
});

function walkTsx(dir: string, acc: string[] = []): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkTsx(p, acc);
    else if (ent.name.endsWith(".tsx")) acc.push(p);
  }
  return acc;
}

test("no TSX file in web or landing uses bare pa-btn without variant or undefined bg-azul-600", () => {
  const stringOrTemplateBtnRe = /["'`]([^"'`]*\bpa-btn\b[^"'`]*)["'`]/g;
  const variantRe = /\bpa-btn-(?:primary|secondary|danger)\b/;

  const dirs = [webSrcDir, ...(fs.existsSync(landingSrcDir) ? [landingSrcDir] : [])];
  for (const baseDir of dirs) {
    for (const file of walkTsx(baseDir)) {
      const src = fs.readFileSync(file, "utf8");
      const rel = path.relative(path.resolve(webSrcDir, "../.."), file);
      assert.equal(
        src.includes("bg-azul-600"),
        false,
        `Undefined bg-azul-600 found in ${rel}`,
      );
      let m: RegExpExecArray | null;
      while ((m = stringOrTemplateBtnRe.exec(src))) {
        assert.equal(
          variantRe.test(m[1]!),
          true,
          `Bare pa-btn without variant in ${rel}: ${m[0]}`,
        );
      }
    }
  }

  const indexCss = fs.readFileSync(path.join(webSrcDir, "index.css"), "utf8");
  assert.match(indexCss, /\.pa-btn-primary\s*\{[\s\S]*?background:\s*var\(--pa-azul\)/);
});
