/**
 * REVISION-25 N4 — toda clave t() (tamén dinámicas) debe existir en GL e ES.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const glPath = path.join(root, "web/src/i18n/gl.json");
const esPath = path.join(root, "web/src/i18n/es.json");

/**
 * Valores posibles por prefixo dinámico
 * (`t(\`prefix.${x}\`)` ou `const key = \`prefix.${x}\``).
 */
const DYNAMIC_VALUES: Record<string, string[]> = {
  "notices.type": ["reminder", "closure", "waitlist", "change", "info"],
  "staff.reason": [
    "asinatura_invalida",
    "cancelada",
    "dia_incorrecto",
    "fora_de_ventan",
    "reserva_inexistente",
    "wrong_municipality",
    "xa_rexistrado",
  ],
  "admin.csvErr": [
    "ambiguous_club",
    "bad_date",
    "bad_end",
    "bad_range",
    "bad_start",
    "missing_away",
    "missing_club",
    "missing_headers",
    "missing_home",
    "no_facility",
    "unknown_club",
    "unknown_unit",
  ],
  dow: ["0", "1", "2", "3", "4", "5", "6"],
  weekdayShort: ["0", "1", "2", "3", "4", "5", "6"],
  "facilities.type": ["pista", "pavillon", "campo", "sala"],
  "openMatch.level": [
    "iniciacion",
    "principiante",
    "medio",
    "avanzado",
  ],
  "openMatch.sport": ["padel", "tenis", "futbol_sala", "baloncesto"],
  role: ["admin", "citizen", "club_manager", "staff"],
  "userMenu.role": ["admin", "citizen", "club", "deputacion", "staff"],
  "clubs.status": [
    "approved",
    "change_requested",
    "conflict",
    "moved",
    "proposed",
    "scheduled",
  ],
  "admin.brandingLegal": ["address", "dpd", "email", "nif", "titular"],
  "admin.brandingContact": [
    "serviceName",
    "phone",
    "email",
    "address",
    "hours",
    "web",
  ],
  "admin.svc": [
    "aparcadoiro",
    "aparcamiento",
    "auga",
    "cafeteria",
    "duchas",
    "espellos",
    "iluminacion",
    "marcador",
    "son",
    "vestiarios",
  ],
  "account.notifyType": [
    "cambio",
    "cancelacion",
    "confirmacion",
    "partido_club",
    "partido_aberto",
    "praza_liberada",
    "recordatorio",
  ],
  legal: ["privacy", "a11y", "notice", "cookies"],
  status: [
    "accepted",
    "cancelled",
    "checked_in",
    "closed",
    "confirmed",
    "conflict",
    "declined",
    "done",
    "drawn",
    "first_come",
    "in_progress",
    "lottery",
    "no_show",
    "open",
    "pending",
    "renovacion",
    "resolved",
    "scheduled",
    "sorteo",
    "swapped",
    "waitlist",
  ],
  "admin.launch": [
    "facilities",
    "schedules",
    "norms",
    "branding",
    "staff",
    "qr",
    "publish",
  ],
  "convite.role": ["admin", "staff", "monitor", "club_manager"],
};

function walkFiles(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === "dist" || ent.name === "i18n") {
      continue;
    }
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkFiles(p, acc);
    else if (/\.(tsx?|jsx?|mjs)$/.test(ent.name)) acc.push(p);
  }
  return acc;
}

function collectUsedKeys(
  corpus: string,
  glKeys: string[],
): { used: Set<string>; unknownPrefixes: string[] } {
  const used = new Set<string>();
  const unknownPrefixes: string[] = [];

  const reLiteral =
    /\bt\(\s*(?:[\w.]+\s*,\s*)?["'`]([a-zA-Z0-9_.-]+)["'`]/g;
  let m: RegExpExecArray | null;
  while ((m = reLiteral.exec(corpus))) used.add(m[1]!);

  const reAlt = /(?:i18n\.t|i18nKey)\s*[=(:]\s*["'`]([a-zA-Z0-9_.-]+)["'`]/g;
  while ((m = reAlt.exec(corpus))) used.add(m[1]!);

  const prefixes = new Set<string>();
  const reDynT = /\bt\(\s*[`]([a-zA-Z0-9_.-]+)\.\$\{/g;
  while ((m = reDynT.exec(corpus))) prefixes.add(m[1]!);
  const reDynKey = /(?:const|let)\s+key\s*=\s*[`]([a-zA-Z0-9_.-]+)\.\$\{/g;
  while ((m = reDynKey.exec(corpus))) prefixes.add(m[1]!);

  for (const prefix of prefixes) {
    if (prefix === "error") {
      for (const k of glKeys) if (k.startsWith("error.")) used.add(k);
      continue;
    }
    if (prefix === "admin.auditAction") {
      for (const k of glKeys) if (k.startsWith("admin.auditAction.")) used.add(k);
      continue;
    }
    const values = DYNAMIC_VALUES[prefix];
    if (!values || values.length === 0) {
      unknownPrefixes.push(prefix);
      continue;
    }
    for (const v of values) used.add(`${prefix}.${v}`);
  }

  return { used, unknownPrefixes };
}

describe("i18n coverage (REVISION-25 N4)", () => {
  it("cada t() literal e dinámico ten tradución en GL e ES", () => {
    const gl = JSON.parse(fs.readFileSync(glPath, "utf8")) as Record<string, string>;
    const es = JSON.parse(fs.readFileSync(esPath, "utf8")) as Record<string, string>;
    const glKeys = Object.keys(gl);

    const files = [
      ...walkFiles(path.join(root, "web/src")),
      ...walkFiles(path.join(root, "landing/src")),
    ];
    let corpus = "";
    for (const f of files) corpus += fs.readFileSync(f, "utf8") + "\n";

    const { used, unknownPrefixes } = collectUsedKeys(corpus, glKeys);
    assert.deepEqual(
      unknownPrefixes.sort(),
      [],
      `Prefixos dinámicos sen DYNAMIC_VALUES: ${unknownPrefixes.join(", ")}`,
    );

    const missingGl: string[] = [];
    const missingEs: string[] = [];
    const empty: string[] = [];

    for (const key of [...used].sort()) {
      if (!(key in gl)) missingGl.push(key);
      if (!(key in es)) missingEs.push(key);
      const gv = gl[key];
      const ev = es[key];
      if (gv !== undefined && String(gv).trim() === "") empty.push(`gl:${key}`);
      if (ev !== undefined && String(ev).trim() === "") empty.push(`es:${key}`);
    }

    assert.deepEqual(missingGl, [], `Faltan en gl.json: ${missingGl.join(", ")}`);
    assert.deepEqual(missingEs, [], `Faltan en es.json: ${missingEs.join(", ")}`);
    assert.deepEqual(empty, [], `Claves baleiras: ${empty.join(", ")}`);
  });

  it("os 22 prefixos N4 (notices/staff/csvErr) existen nos dous idiomas", () => {
    const gl = JSON.parse(fs.readFileSync(glPath, "utf8")) as Record<string, string>;
    const es = JSON.parse(fs.readFileSync(esPath, "utf8")) as Record<string, string>;
    for (const prefix of ["notices.type", "staff.reason", "admin.csvErr"] as const) {
      for (const v of DYNAMIC_VALUES[prefix]!) {
        const key = `${prefix}.${v}`;
        assert.ok(gl[key], `GL falta ${key}`);
        assert.ok(es[key], `ES falta ${key}`);
      }
    }
  });
});
