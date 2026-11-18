/**
 * Xera deploy/demo-ca/ con openssl se faltan ficheiros (copia limpa / CI).
 * Usado por tests e e2e. Non committea segredos.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root =
  typeof import.meta !== "undefined" && import.meta.url
    ? join(dirname(fileURLToPath(import.meta.url)), "..")
    : process.cwd();

const REQUIRED = [
  "deploy/demo-ca/demo-ca.pem",
  "deploy/demo-ca/revogado-demo.pem",
  "deploy/demo-ca/cidada-demo.pem",
  "deploy/demo-ca/admin-demo.p12",
  "deploy/demo-ca/index.txt",
];

export function demoCaRoot(base = root) {
  return join(base, "deploy/demo-ca");
}

export function ensureDemoCa(base = root) {
  const missing = REQUIRED.some((rel) => !existsSync(join(base, rel)));
  if (!missing) return false;
  const script = join(base, "scripts/demo-ca.sh");
  execFileSync("bash", [script], { stdio: "inherit", cwd: base });
  for (const rel of REQUIRED) {
    if (!existsSync(join(base, rel))) {
      throw new Error(`demo-ca: falta ${rel} despois de xerarlo`);
    }
  }
  return true;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ran = ensureDemoCa();
  console.log(ran ? "[ensure-demo-ca] xerado" : "[ensure-demo-ca] xa presente");
}
