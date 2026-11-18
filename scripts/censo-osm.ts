/**
 * Censo OSM real (DESENO-V2 §0).
 *
 * Pipeline:
 *   1) Descargar PBF Galicia (Geofabrik)
 *   2) Extraer puntos deportivos → deporte.geojson  (scripts/censo-osm-extract.py + pyosmium)
 *   3) Asignar a concellos + agrupar <60 m → data/instalacions-por-concello.json
 *      (scripts/censo-osm-aggregate.py)
 *
 * Uso:
 *   npx tsx scripts/censo-osm.ts \
 *     --pbf /tmp/pa-osm/galicia-latest.osm.pbf \
 *     --extract-date 2026-10-25
 *
 * Dependencias do extracto: python3 + pyosmium + shapely (venv recomendado).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv) {
  console.log("+", cmd, args.join(" "));
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (r.status !== 0) {
    throw new Error(`${cmd} saíu con código ${r.status}`);
  }
}

function main() {
  const pbf =
    arg("--pbf") ??
    path.join("/tmp/pa-osm", "galicia-latest.osm.pbf");
  const extractDate =
    arg("--extract-date") ?? new Date().toISOString().slice(0, 10);
  const python =
    arg("--python") ??
    (fs.existsSync("/tmp/pa-osm-venv/bin/python")
      ? "/tmp/pa-osm-venv/bin/python"
      : "python3");
  const workDir = arg("--work") ?? path.dirname(pbf);
  const deporte = path.join(workDir, "deporte.geojson");
  const out = path.join(ROOT, "data/instalacions-por-concello.json");
  const concellos = path.join(ROOT, "data/concellos.geojson");

  if (!fs.existsSync(pbf)) {
    console.error("Falta o PBF:", pbf);
    console.error(
      "Descarga: curl -LO https://download.geofabrik.de/europe/spain/galicia-latest.osm.pbf",
    );
    process.exit(1);
  }

  run(python, [
    path.join(ROOT, "scripts/censo-osm-extract.py"),
    pbf,
    deporte,
  ]);
  run(python, [
    path.join(ROOT, "scripts/censo-osm-aggregate.py"),
    deporte,
    concellos,
    out,
    extractDate,
  ]);

  // Copia para a landing (principal + puntos + meta)
  const landingDir = path.join(ROOT, "apps/web/public/data");
  fs.copyFileSync(out, path.join(landingDir, "instalacions-por-concello.json"));
  const pointsSrc = path.join(ROOT, "data/instalacions-puntos.json");
  if (fs.existsSync(pointsSrc)) {
    fs.copyFileSync(pointsSrc, path.join(landingDir, "instalacions-puntos.json"));
  }
  const metaSrc = path.join(ROOT, "data/instalacions-por-concello.meta.json");
  if (fs.existsSync(metaSrc)) {
    fs.copyFileSync(
      metaSrc,
      path.join(landingDir, "instalacions-por-concello.meta.json"),
    );
  }

  const data = JSON.parse(fs.readFileSync(out, "utf8")) as Record<
    string,
    { count: number }
  >;
  const total = Object.values(data).reduce((s, c) => s + c.count, 0);
  console.log(`OK · ${Object.keys(data).length} concellos · ${total} instalacións`);
  console.log(`extractDate=${extractDate}`);
}

main();
