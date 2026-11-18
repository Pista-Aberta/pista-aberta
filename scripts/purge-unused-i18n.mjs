/**
 * T23 — lista (e opcionalmente borra) claves i18n sen uso en t()/i18n.
 * Conta tamén `error.*` se hai `error.${…}` dinámico.
 *
 *   node scripts/purge-unused-i18n.mjs           # só informe
 *   node scripts/purge-unused-i18n.mjs --write   # borra de gl.json e es.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const GL = path.join(ROOT, "apps/web/src/i18n/gl.json");
const ES = path.join(ROOT, "apps/web/src/i18n/es.json");
const WRITE = process.argv.includes("--write");

function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

function unflatten(flat) {
  const root = {};
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split(".");
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      /* JSON xa é plano («nav.login»); non recrear árbore */
      if (i === 0 && parts.length > 1 && !(p in root && typeof root[p] === "object")) {
        /* manter claves planas tal cal */
      }
      cur[parts[i]] = cur[parts[i]] || {};
      if (typeof cur[parts[i]] !== "object") {
        /* colisión: clave plana vs árbore — gardar plana */
        root[key] = value;
        return root;
      }
      cur = cur[parts[i]];
    }
    if (typeof cur === "object" && cur !== null && !Array.isArray(cur)) {
      cur[parts[parts.length - 1]] = value;
    }
  }
  return root;
}

/** O gl.json é plano: claves con puntos. Ao escribir, manter plano. */
function writeFlat(file, flat) {
  const ordered = {};
  for (const k of Object.keys(flat).sort()) ordered[k] = flat[k];
  /* preservar orde orixinal aproximada */
  const original = JSON.parse(fs.readFileSync(file, "utf8"));
  const out = {};
  for (const k of Object.keys(original)) {
    if (k in flat) out[k] = flat[k];
  }
  for (const k of Object.keys(flat)) {
    if (!(k in out)) out[k] = flat[k];
  }
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
}

function walkFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === "dist" || ent.name === "i18n") continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkFiles(p, acc);
    else if (/\.(tsx?|jsx?|mjs|vue)$/.test(ent.name)) acc.push(p);
  }
  return acc;
}

const gl = JSON.parse(fs.readFileSync(GL, "utf8"));
const flat = flatten(gl);
const keys = Object.keys(flat);

const files = [
  ...walkFiles(path.join(ROOT, "apps/web/src")),
  ...walkFiles(path.join(ROOT, "apps/web/src")),
  ...walkFiles(path.join(ROOT, "packages")),
];

let corpus = "";
for (const f of files) {
  corpus += fs.readFileSync(f, "utf8") + "\n";
}

const used = new Set();
const reLiteral =
  /\bt\(\s*(?:[\w.]+\s*,\s*)?["'`]([a-zA-Z0-9_.-]+)["'`]/g;
let m;
while ((m = reLiteral.exec(corpus))) used.add(m[1]);

/* i18n.t / i18nKey= */
const reAlt = /(?:i18n\.t|i18nKey)\s*[=(:]\s*["'`]([a-zA-Z0-9_.-]+)["'`]/g;
while ((m = reAlt.exec(corpus))) used.add(m[1]);

const hasErrorDyn = /error\.\$\{|["'`]error\./.test(corpus) || /t\(\s*[`'"]error\./.test(corpus);
if (hasErrorDyn) {
  for (const k of keys) if (k.startsWith("error.")) used.add(k);
}

const dynPrefixes = new Set();
const reDyn = /\bt\(\s*[`]([a-zA-Z0-9_.-]+)\.\$\{/g;
while ((m = reDyn.exec(corpus))) dynPrefixes.add(m[1]);
/* tamén `t(\`prefix${` */
const reDyn2 = /\bt\(\s*[`]([a-zA-Z0-9_.-]*)\$\{/g;
while ((m = reDyn2.exec(corpus))) {
  if (m[1]) dynPrefixes.add(m[1].replace(/\.$/, ""));
}
for (const pref of dynPrefixes) {
  if (!pref) continue;
  for (const k of keys) if (k === pref || k.startsWith(pref + ".")) used.add(k);
}

/* String literal exacto da clave no código (sen t()) */
for (const k of keys) {
  if (used.has(k)) continue;
  if (
    corpus.includes(`"${k}"`) ||
    corpus.includes(`'${k}'`) ||
    corpus.includes("`" + k + "`")
  ) {
    used.add(k);
  }
}

const stillUnused = keys.filter((k) => !used.has(k));

console.log("total", keys.length);
console.log("used", used.size);
console.log("unused", stillUnused.length);
for (const k of stillUnused.slice(0, 60)) console.log(" -", k);
if (stillUnused.length > 60) console.log(` … e ${stillUnused.length - 60} máis`);

if (WRITE) {
  const glFlat = { ...JSON.parse(fs.readFileSync(GL, "utf8")) };
  const esFlat = { ...JSON.parse(fs.readFileSync(ES, "utf8")) };
  for (const k of stillUnused) {
    delete glFlat[k];
    delete esFlat[k];
  }
  writeFlat(GL, glFlat);
  writeFlat(ES, esFlat);
  console.log("escrito gl.json e es.json sen", stillUnused.length, "claves");
}

void unflatten;
