/**
 * REVISION-40 — scrub de textos visibles nas pantallas da demo.
 * Heurística: literais JSX e valores i18n (non código de comparacións).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const webSrc = path.resolve(here, "../../../web/src");
const pagesDir = path.join(webSrc, "pages");
const componentsDir = path.join(webSrc, "components");
const i18nDir = path.join(webSrc, "i18n");

const ISO = /\b\d{4}-\d{2}-\d{2}\b/;
const TANDA = /\bTANDA\b|\bDemo TANDA\b/;
const INTERNAL_ID = /\b(user-cidada|user-club|fac-exemplo|unit-pav|om-[a-z0-9-]+|req-[a-z0-9-]+)\b/i;

function walk(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (/\.(tsx|json)$/.test(ent.name)) out.push(p);
  }
  return out;
}

/** Texto entre tags JSX: >texto< */
function jsxTextNodes(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/>([^<>{}\n]+)</g)) {
    const t = m[1]!.trim();
    if (t && !t.startsWith("{") && !/^[\s,;]+$/.test(t)) out.push(t);
  }
  return out;
}

describe("REVISION-40 UI copy scrub", () => {
  it("i18n gl/es sen ISO / TANDA / ids internos nos valores", () => {
    const bad: string[] = [];
    for (const lang of ["gl", "es"]) {
      const data = JSON.parse(
        fs.readFileSync(path.join(i18nDir, `${lang}.json`), "utf8"),
      ) as Record<string, string>;
      for (const [k, v] of Object.entries(data)) {
        if (typeof v !== "string") continue;
        if (k.startsWith("status.") || k.startsWith("error.") || k.includes("example")) continue;
        if (ISO.test(v)) bad.push(`${lang}:${k}: ISO`);
        if (TANDA.test(v)) bad.push(`${lang}:${k}: TANDA`);
        if (INTERNAL_ID.test(v)) bad.push(`${lang}:${k}: id`);
        /* Estado inglés cru como valor completo. */
        if (/^(open|full|pending|confirmed|cancelled|counter_proposed)$/.test(v)) {
          bad.push(`${lang}:${k}: estado inglés`);
        }
        if (/^[a-z]+_[a-z]+$/.test(v) && !k.startsWith("admin.svc.")) {
          bad.push(`${lang}:${k}: underscore type`);
        }
      }
    }
    assert.deepEqual(bad, []);
  });

  it("JSX visible sen ISO / TANDA / ids / estados ingleses crus", () => {
    const files = [
      ...walk(pagesDir),
      ...walk(componentsDir).filter((f) =>
        /PanelMobileTabBar|FacilityFreeCard|MobileTabBar|SiteFooter|UserMenu/.test(
          path.basename(f),
        ),
      ),
    ];
    const bad: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      const rel = path.relative(webSrc, f);
      for (const chunk of jsxTextNodes(src)) {
        if (TANDA.test(chunk)) bad.push(`${rel}: TANDA «${chunk}»`);
        if (ISO.test(chunk)) bad.push(`${rel}: ISO «${chunk}»`);
        if (INTERNAL_ID.test(chunk)) bad.push(`${rel}: id «${chunk}»`);
        if (/^(open|full|pending|confirmed|cancelled|counter_proposed)$/.test(chunk)) {
          bad.push(`${rel}: estado «${chunk}»`);
        }
        if (/^[a-z]+_[a-z]+$/.test(chunk)) bad.push(`${rel}: tipo «${chunk}»`);
      }
      /* Pílula crúa: >open_match_join< */
      if (/>\s*[a-z]+_[a-z]+\s*</.test(src)) {
        const m = src.match(/>\s*([a-z]+_[a-z]+)\s*</);
        if (m) bad.push(`${rel}: tipo visible «${m[1]}»`);
      }
    }
    assert.deepEqual(bad, []);
  });

  it("freeHourLabel amosa «N pistas»", () => {
    const src = fs.readFileSync(path.resolve(webSrc, "lib/free-hours.ts"), "utf8");
    assert.ok(src.includes("${group.start} · ${group.count} ${noun}"));
  });

  it("AdminMobileNav non usa overflow-x-auto (T17)", () => {
    const src = fs.readFileSync(path.join(pagesDir, "AdminPages.tsx"), "utf8");
    const nav = src.slice(
      src.indexOf("function AdminMobileNav"),
      src.indexOf("export function AdminShell"),
    );
    assert.equal(nav.includes("overflow-x-auto"), false);
    assert.ok(nav.includes("return null"));
  });

  it("PanelMobileTabBar cobre admin/staff/club", () => {
    const src = fs.readFileSync(
      path.join(componentsDir, "PanelMobileTabBar.tsx"),
      "utf8",
    );
    assert.ok(src.includes("admin.navToday"));
    assert.ok(src.includes("nav.more"));
    assert.ok(src.includes("staff.checkinShort") || src.includes("Check-in"));
    assert.ok(src.includes("nav.pavillon"));
    assert.ok(src.includes('data-testid="panel-mobile-tabbar"'));
  });
});
