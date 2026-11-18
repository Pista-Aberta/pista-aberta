/**
 * REVISION-42 Q7 — instalador: copia obrigada, compose -f, sen source, git pull.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const install = readFileSync(join(root, "install.sh"), "utf8");
const dotenvHelper = join(root, "scripts/dotenv-safe.sh");

describe("REVISION-42 Q7 install.sh", () => {
  it("copia fallida para sen --sen-copia", () => {
    assert.match(install, /--sen-copia/);
    assert.match(install, /ALLOW_NO_BACKUP/);
    assert.match(install, /non se actualiza sen copia/);
    assert.doesNotMatch(
      install,
      /AVISO: a copia fallou[\s\S]{0,80}Continúase, pero o rollback/,
    );
  });

  it("print_rollback_help usa compose_files_args", () => {
    assert.match(install, /print_rollback_help[\s\S]{0,400}compose_files_args/);
    assert.match(install, /compose_cli/);
  });

  it("do_update non fai source do .env.install", () => {
    const doUpdate = install.slice(install.indexOf("do_update()"));
    const body = doUpdate.slice(0, doUpdate.indexOf("\ndo_reconfig"));
    assert.doesNotMatch(body, /source\s+"\$ENV_FILE"/);
    assert.doesNotMatch(body, /source\s+\$ENV_FILE/);
    assert.match(body, /env_get INSTALL_EDGE/);
  });

  it("ningún fluxo executa .env.install e usa o parser estrito", () => {
    assert.doesNotMatch(install, /source\s+["']?\$ENV_FILE/);
    assert.match(install, /DOTENV_HELPER/);
    assert.match(install, /bash "\$DOTENV_HELPER" get/);
    assert.match(install, /bash "\$DOTENV_HELPER" set/);
  });

  it("conserva espazos, #, comiñas, barras, backticks e $() sen executar", () => {
    const dir = mkdtempSync(join(tmpdir(), "pa-dotenv-"));
    const envFile = join(dir, ".env.install");
    const marker = join(dir, "must-not-exist");
    const values = [
      "space value # literal",
      String.raw`quotes '" and backslash \ stay`,
      `backtick \`touch ${marker}\``,
      `subshell $(touch ${marker}) and $HOME`,
    ];
    try {
      values.forEach((value, index) => {
        const key = `SECRET_${index}`;
        execFileSync("bash", [dotenvHelper, "set", envFile, key, value]);
        const actual = execFileSync(
          "bash",
          [dotenvHelper, "get", envFile, key],
          { encoding: "utf8" },
        );
        assert.equal(actual, value);
      });
      assert.throws(() => readFileSync(marker));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("git pull fallido amosa axuda de rollback", () => {
    assert.match(install, /if ! git pull --ff-only; then/);
    assert.match(install, /if ! pull_new_version; then/);
    assert.match(install, /print_rollback_help "\$prev"/);
  });
});
