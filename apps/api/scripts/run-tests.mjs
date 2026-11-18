#!/usr/bin/env node
/**
 * Suite API estable: un proceso por ficheiro *.test.ts.
 *
 * Evita:
 * - ERR_INVALID_PACKAGE_CONFIG do script monolítico enorme
 * - contaminación ESM entre ficheiros (createX is not a function)
 * - cancelacións en cadea con --test-concurrency>1
 *
 * Middleware (origin-guard) queda no posttest de package.json.
 * PA_TEST_CONCURRENCY=N → ata N ficheiros en paralelo (por defecto 1).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const concurrency = Math.max(
  1,
  Number(process.env.PA_TEST_CONCURRENCY || "1") || 1,
);

/* TMPDIR curto e illado por execución/ficheiro para limpar PGlite tras cada test. */
const runnerTmpRoot = fs.mkdtempSync("/tmp/pa-trun-");
function cleanupRunnerTmp() {
  try {
    fs.rmSync(runnerTmpRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
process.on("exit", cleanupRunnerTmp);
process.on("SIGINT", () => {
  cleanupRunnerTmp();
  process.exit(130);
});
process.on("SIGTERM", () => {
  cleanupRunnerTmp();
  process.exit(143);
});

function collectTests(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      collectTests(full, out);
    } else if (name.endsWith(".test.ts")) {
      if (full.includes(`${path.sep}middleware${path.sep}`)) continue;
      out.push(full);
    }
  }
  return out;
}

function runOne(file) {
  const rel = path.relative(apiRoot, file);
  const fileTmpDir = fs.mkdtempSync(path.join(runnerTmpRoot, "f-"));
  return new Promise((resolve) => {
    const child = spawn(
      "npx",
      ["tsx", "--test", rel],
      {
        cwd: apiRoot,
        env: { ...process.env, NODE_ENV: "test", TMPDIR: fileTmpDir },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let out = "";
    child.stdout.on("data", (b) => {
      const s = b.toString();
      out += s;
      process.stdout.write(s);
    });
    child.stderr.on("data", (b) => {
      const s = b.toString();
      out += s;
      process.stderr.write(s);
    });
    child.on("close", (code) => {
      try {
        fs.rmSync(fileTmpDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      resolve({ file: rel, code: code ?? 1, out });
    });
  });
}

async function runPool(files) {
  const failed = [];
  let idx = 0;
  let active = 0;
  let done = 0;

  return new Promise((resolve) => {
    const kick = () => {
      while (active < concurrency && idx < files.length) {
        const file = files[idx++];
        active += 1;
        const rel = path.relative(apiRoot, file);
        console.log(
          `[api-test] (${done + active}/${files.length}) ${rel}`,
        );
        runOne(file).then((result) => {
          active -= 1;
          done += 1;
          if (result.code !== 0) failed.push(result);
          if (done === files.length) resolve(failed);
          else kick();
        });
      }
    };
    kick();
  });
}

const tests = collectTests(path.join(apiRoot, "src")).sort();
if (tests.length === 0) {
  console.error("No *.test.ts found under src/");
  process.exit(1);
}

console.log(
  `[api-test] ${tests.length} files, concurrency=${concurrency}, 1 proceso/ficheiro`,
);

const failed = await runPool(tests);
if (failed.length === 0) {
  console.log(`[api-test] OK ${tests.length}/${tests.length}`);
  process.exit(0);
}

console.warn(
  `[api-test] ${failed.length} fallos; reintento individual…`,
);
let hard = 0;
for (const f of failed) {
  console.log(`[api-test] retry ${f.file}`);
  const again = await runOne(path.join(apiRoot, f.file));
  if (again.code !== 0) {
    hard = again.code;
    console.error(`[api-test] retry FAILED ${f.file}`);
  } else {
    console.log(`[api-test] retry OK ${f.file}`);
  }
}
process.exit(hard);
