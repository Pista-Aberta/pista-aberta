#!/usr/bin/env node
/**
 * SBOM CycloneDX sen bloquear o build sen rede.
 * - Se existe sbom/cyclonedx.json e SBOM_FORCE non está posto → reutiliza.
 * - Se falla npx/rede → avisa e sai 0 (non bloquea landing/build).
 * - SBOM_REQUIRED=1 → falla se non hai ficheiro válido.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "sbom");
const outFile = path.join(outDir, "cyclonedx.json");
const force = process.env.SBOM_FORCE === "1";
const required = process.env.SBOM_REQUIRED === "1";

function hasValidSbom() {
  try {
    if (!fs.existsSync(outFile)) return false;
    const st = fs.statSync(outFile);
    if (st.size < 64) return false;
    const raw = fs.readFileSync(outFile, "utf8");
    const json = JSON.parse(raw);
    return json?.bomFormat === "CycloneDX";
  } catch {
    return false;
  }
}

fs.mkdirSync(outDir, { recursive: true });

if (!force && hasValidSbom()) {
  console.log(`[sbom] reuse ${path.relative(root, outFile)}`);
  process.exit(0);
}

console.log("[sbom] generating via cyclonedx-npm…");
const result = spawnSync(
  "npx",
  [
    "--yes",
    "@cyclonedx/cyclonedx-npm@1.19.3",
    "--output-file",
    outFile,
    "--output-format",
    "JSON",
    "--ignore-npm-errors",
  ],
  { cwd: root, encoding: "utf8", env: process.env },
);

if (result.status === 0 && hasValidSbom()) {
  console.log(`[sbom] wrote ${path.relative(root, outFile)}`);
  process.exit(0);
}

const err =
  (result.stderr || result.stdout || "").trim().slice(0, 400) ||
  `exit ${result.status}`;
if (hasValidSbom()) {
  console.warn(`[sbom] generation failed (${err}); keeping previous SBOM`);
  process.exit(0);
}
if (required) {
  console.error(`[sbom] required but unavailable: ${err}`);
  process.exit(1);
}
console.warn(`[sbom] skipped (non-blocking): ${err}`);
process.exit(0);
