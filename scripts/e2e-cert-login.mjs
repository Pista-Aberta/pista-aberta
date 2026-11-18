/**
 * CERTIFICADO-DEMO §3 — e2e Playwright con clientCertificates.
 * Require: demo-ca xerada, stack local/demo con CERT_LOGIN_ENABLED,
 *          CERT_E2E_URL (ex. https://cert.localhost ou demo).
 *
 *   CERT_E2E_URL=https://demo.pistaaberta.com \
 *   CERT_E2E_USER=demo CERT_E2E_PASS=… \
 *   node scripts/e2e-cert-login.mjs
 *
 * Sen CERT_E2E_URL → exit 0 (skip) para non romper CI sen stack mTLS.
 */
import { chromium } from "playwright";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDemoCa } from "./ensure-demo-ca.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
ensureDemoCa(root);
const p12Ok = join(root, "deploy/demo-ca/cidada-demo.p12");
const p12Bad = join(root, "deploy/demo-ca/revogado-demo.p12");
const base = process.env.CERT_E2E_URL?.replace(/\/$/, "");

if (!base) {
  console.log("[e2e-cert] skip: CERT_E2E_URL non definido");
  process.exit(0);
}

const httpUser = process.env.CERT_E2E_USER;
const httpPass = process.env.CERT_E2E_PASS;
const origin = new URL(base).origin;

const browser = await chromium.launch({ headless: true });

async function withCert(p12Path, run) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    httpCredentials:
      httpUser && httpPass ? { username: httpUser, password: httpPass } : undefined,
    clientCertificates: [
      {
        origin: process.env.CERT_E2E_CERT_ORIGIN || origin.replace("demo.", "cert."),
        pfxPath: p12Path,
        passphrase: "demo",
      },
    ],
  });
  try {
    await run(context);
  } finally {
    await context.close();
  }
}

let failed = 0;

await withCert(p12Ok, async (ctx) => {
  const page = await ctx.newPage();
  await page.goto(`${origin}/acceso?returnTo=/c/exemplo`, { waitUntil: "networkidle" });
  await page.getByTestId("login-cert-card").locator("button").first().click();
  await page.waitForURL(/\/c\/exemplo/, { timeout: 45_000 });
  const body = await page.locator("body").innerText();
  if (!/Ola|Hola|Ana/i.test(body)) {
    console.error("[e2e-cert] FAIL: portada sen Ola/Ana tras cert OK");
    failed++;
  } else {
    console.log("[e2e-cert] OK: certificado → sesión");
  }
});

if (existsSync(p12Bad)) {
  await withCert(p12Bad, async (ctx) => {
    const page = await ctx.newPage();
    await page.goto(`${origin}/acceso?returnTo=/c/exemplo`, { waitUntil: "networkidle" });
    await page.getByTestId("login-cert-card").locator("button").first().click();
    await page.waitForTimeout(3000);
    const text = await page.locator("body").innerText();
    if (!/revog|revoc|erro|cert/i.test(text)) {
      console.error("[e2e-cert] FAIL: revogado sen mensaxe de erro");
      failed++;
    } else {
      console.log("[e2e-cert] OK: revogado → erro");
    }
  });
}

await browser.close();
process.exit(failed ? 1 : 0);
