/**
 * REVISION-28 X1 — xera a CA de proba se falta (copia limpa).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

const REQUIRED = [
  "deploy/demo-ca/demo-ca.pem",
  "deploy/demo-ca/revogado-demo.pem",
  "deploy/demo-ca/cidada-demo.pem",
  "deploy/demo-ca/admin-demo.p12",
  "deploy/demo-ca/index.txt",
];

export function ensureDemoCa(root = ROOT): string {
  const missing = REQUIRED.some((rel) => !fs.existsSync(path.join(root, rel)));
  if (missing) {
    execFileSync("bash", [path.join(root, "scripts/demo-ca.sh")], {
      stdio: "inherit",
      cwd: root,
    });
  }
  for (const rel of REQUIRED) {
    if (!fs.existsSync(path.join(root, rel))) {
      throw new Error(`demo-ca: falta ${rel}`);
    }
  }
  return root;
}
