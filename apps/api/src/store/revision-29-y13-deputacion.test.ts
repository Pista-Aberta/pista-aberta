/**
 * REVISION-29 Y13 — entidade Deputación (smoke sen DB).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("REVISION-29 Y13 Deputación entity", () => {
  it("install multiconcello + admin --deputacion --invite", () => {
    const install = fs.readFileSync(path.join(ROOT, "install.sh"), "utf8");
    assert.match(install, /--deputacion --invite/);
    assert.match(install, /DEPUTACION_NAME/);
    /* REVISION-39 L6 */
    assert.match(install, /DEPUTACION_EMAIL/);
    assert.match(install, /--org-email/);
    const admin = fs.readFileSync(
      path.join(ROOT, "apps/api/scripts/create-admin.ts"),
      "utf8",
    );
    assert.match(admin, /--deputacion/);
    /* REVISION-33: NIF obrigatorio + --list; sen superadmin xenérica. */
    assert.match(admin, /--list/);
    assert.match(admin, /NIF é obrigatorio|nif é obrigatorio/i);
    assert.match(admin, /superadmin xenérica|sen superadmin/i);
    const org = fs.readFileSync(
      path.join(ROOT, "apps/api/src/store/deputacion-org.ts"),
      "utf8",
    );
    assert.match(org, /DEPUTACION_PLATFORM_MUNI_ID/);
    const users = fs.readFileSync(
      path.join(ROOT, "apps/api/src/identity/saml-users.ts"),
      "utf8",
    );
    assert.match(users, /muni-deputacion-platform/);
    const instalacion = fs.readFileSync(
      path.join(ROOT, "docs/INSTALACION.md"),
      "utf8",
    );
    assert.match(instalacion, /--deputacion --list/);
    assert.match(instalacion, /NIF obrigatorio/i);
  });
});
