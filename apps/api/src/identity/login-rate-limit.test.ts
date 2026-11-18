import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Hono } from "hono";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-login-rl-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.PA_DEMO = "1";

const { initDb, closeDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { CompositeIdentityProvider } = await import("./index.js");
const { registerAuthLoginRoute } = await import("./auth-login-route.js");
const {
  assertLoginRateLimit,
  clientIpFromHeaders,
  LoginRateLimitedError,
  maxHitsFor,
  withLoginParam,
} = await import("./login-rate-limit.js");

describe("login rate limit (REVISION-16 N1)", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("permite os primeiros intentos e bloquea ao 11.º (default)", async () => {
    const key = `test-login-rl-${Date.now()}`;
    for (let i = 0; i < 10; i++) {
      await assertLoginRateLimit(key);
    }
    await assert.rejects(
      () => assertLoginRateLimit(key),
      (e: unknown) => e instanceof LoginRateLimitedError,
    );
  });

  it("demo saml_start: 60 por IP, a 61.ª falla", async () => {
    assert.equal(maxHitsFor("saml_start"), 60);
    const key = `saml-ip-${Date.now()}`;
    for (let i = 0; i < 60; i++) {
      await assertLoginRateLimit(key, "saml_start");
    }
    await assert.rejects(
      () => assertLoginRateLimit(key, "saml_start"),
      (e: unknown) =>
        e instanceof LoginRateLimitedError && e.retryAfterMinutes >= 1,
    );
  });

  it("12 IPs distintas non se bloquean entre si (saml_start)", async () => {
    const stamp = Date.now();
    for (let i = 0; i < 12; i++) {
      await assertLoginRateLimit(`ip-${stamp}-${i}`, "saml_start");
    }
  });

  it("M3: sen TRUST_PROXY ignora X-Real-IP e X-Forwarded-For falsas (non salta o límite)", async () => {
    const prev = process.env.TRUST_PROXY;
    delete process.env.TRUST_PROXY;
    try {
      for (let i = 0; i < 10; i++) {
        const ip = clientIpFromHeaders(
          {
            get: (n) =>
              n.toLowerCase() === "x-real-ip"
                ? `198.51.100.${i + 1}`
                : n.toLowerCase() === "x-forwarded-for"
                  ? `203.0.113.${i + 1}`
                  : undefined,
          },
          { remoteAddress: "127.0.0.1" },
        );
        assert.equal(ip, "127.0.0.1");
        await assertLoginRateLimit(`m3-notrust:${ip}`);
      }
      const spoofedAgain = clientIpFromHeaders(
        {
          get: (n) =>
            n.toLowerCase() === "x-real-ip" ? "198.51.100.250" : undefined,
        },
        { remoteAddress: "127.0.0.1" },
      );
      assert.equal(spoofedAgain, "127.0.0.1");
      await assert.rejects(
        () => assertLoginRateLimit(`m3-notrust:${spoofedAgain}`),
        (e: unknown) => e instanceof LoginRateLimitedError,
      );
    } finally {
      if (prev === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = prev;
    }
  });

  it("M3: con TRUST_PROXY=1 usa o último salto de X-Forwarded-For e fallback a X-Real-IP", () => {
    const prev = process.env.TRUST_PROXY;
    process.env.TRUST_PROXY = "1";
    try {
      assert.equal(
        clientIpFromHeaders({
          get: (n) =>
            n.toLowerCase() === "x-real-ip"
              ? "10.0.0.2"
              : n.toLowerCase() === "x-forwarded-for"
                ? "198.51.100.1, 203.0.113.7"
                : undefined,
        }),
        "203.0.113.7",
      );
      assert.equal(
        clientIpFromHeaders({
          get: (n) =>
            n.toLowerCase() === "x-real-ip" ? "10.0.0.2" : undefined,
        }),
        "10.0.0.2",
      );
    } finally {
      if (prev === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = prev;
    }
  });

  it("M3: Caddyfile sobrescribe X-Real-IP en todos os reverse_proxy cara api:3001", () => {
    const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../..");
    const caddy = fs.readFileSync(
      path.join(repoRoot, "deploy/concello/Caddyfile"),
      "utf8",
    );
    const blocks: string[] = [];
    const re = /reverse_proxy\s+api:3001\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(caddy))) {
      let depth = 1;
      let i = m.index + m[0].length;
      while (i < caddy.length && depth > 0) {
        if (caddy[i] === "{") depth += 1;
        else if (caddy[i] === "}") depth -= 1;
        i += 1;
      }
      blocks.push(caddy.slice(m.index + m[0].length, i - 1));
    }
    assert.equal(blocks.length, 4, "esperábanse 4 bloques reverse_proxy api:3001");
    for (const body of blocks) {
      assert.match(body, /header_up\s+X-Real-IP\s+\{remote_host\}/);
    }
  });

  it("P1: nginx-edge.conf e nginx-gateway.conf resolven IP real recursiva e pasan $remote_addr á API", () => {
    const repoRoot = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      "../../../..",
    );
    const extractBlocks = (src: string, headerRe: RegExp): string[] => {
      const out: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = headerRe.exec(src))) {
        let depth = 1;
        let i = m.index + m[0].length;
        while (i < src.length && depth > 0) {
          if (src[i] === "{") depth += 1;
          else if (src[i] === "}") depth -= 1;
          i += 1;
        }
        out.push(src.slice(m.index + m[0].length, i - 1));
      }
      return out;
    };

    for (const rel of [
      "deploy/concello/nginx-edge.conf",
      "deploy/vps/nginx-gateway.conf",
    ]) {
      const conf = fs.readFileSync(path.join(repoRoot, rel), "utf8");
      const servers = extractBlocks(conf, /\bserver\s*\{/g);
      assert.equal(servers.length, 1, `${rel} debe ter un bloque server`);
      const srv = servers[0]!;
      for (const cidr of [
        "10\\.0\\.0\\.0/8",
        "172\\.16\\.0\\.0/12",
        "192\\.168\\.0\\.0/16",
        "127\\.0\\.0\\.1",
      ]) {
        assert.match(
          srv,
          new RegExp(`set_real_ip_from\\s+${cidr};`),
          `${rel}: falta set_real_ip_from ${cidr}`,
        );
      }
      assert.match(srv, /real_ip_header\s+X-Forwarded-For;/);
      assert.match(srv, /real_ip_recursive\s+on;/);

      const locations = extractBlocks(srv, /\blocation\s+[^{]+\{/g);
      const apiLocs = locations.filter((b) =>
        /proxy_pass\s+http:\/\/pa_api\b/.test(b),
      );
      assert.equal(
        apiLocs.length,
        3,
        `${rel}: esperábanse 3 locations cara pa_api (/health, /api/, /auth/)`,
      );
      for (const loc of apiLocs) {
        assert.match(loc, /proxy_set_header\s+X-Forwarded-For\s+\$remote_addr;/);
        assert.doesNotMatch(
          loc,
          /proxy_set_header\s+X-Forwarded-For\s+\$proxy_add_x_forwarded_for;/,
        );
      }
    }

    const domHttp = fs.readFileSync(
      path.join(repoRoot, "deploy/dominio/nginx/app-http.conf.template"),
      "utf8",
    );
    assert.match(domHttp, /set_real_ip_from\s+\$\{PROXY_SUBNET\};/);
    assert.match(domHttp, /real_ip_header\s+X-Forwarded-For;/);
    assert.match(domHttp, /real_ip_recursive\s+on;/);
  });

  it("withLoginParam non rompe query existentes", () => {
    const out = withLoginParam(
      "https://demo.example.org",
      "/c/exemplo/porta/fac-exemplo-padel?code=85B6E5D5&d=2026-10-28",
      "saml",
    );
    const u = new URL(out);
    assert.equal(u.searchParams.get("code"), "85B6E5D5");
    assert.equal(u.searchParams.get("d"), "2026-10-28");
    assert.equal(u.searchParams.get("login"), "saml");
    assert.ok(!u.search.includes("?login=saml"));
  });

  it("otp_ip: límite 20 fóra de demo e 200 en modo demo", async () => {
    const prevDemo = process.env.PA_DEMO;
    const prevEnv = process.env.NODE_ENV;
    try {
      process.env.PA_DEMO = "0";
      process.env.NODE_ENV = "production";
      assert.equal(maxHitsFor("otp_ip"), 20);
      const prodKey = `otp-ip-prod-${Date.now()}`;
      for (let i = 0; i < 20; i++) {
        await assertLoginRateLimit(prodKey, "otp_ip");
      }
      await assert.rejects(
        () => assertLoginRateLimit(prodKey, "otp_ip"),
        (e: unknown) =>
          e instanceof LoginRateLimitedError && e.retryAfterMinutes >= 1,
      );

      process.env.PA_DEMO = "1";
      process.env.NODE_ENV = "development";
      assert.equal(maxHitsFor("otp_ip"), 200);
      const demoKey = `otp-ip-demo-${Date.now()}`;
      for (let i = 0; i < 200; i++) {
        await assertLoginRateLimit(demoKey, "otp_ip");
      }
      await assert.rejects(
        () => assertLoginRateLimit(demoKey, "otp_ip"),
        (e: unknown) =>
          e instanceof LoginRateLimitedError && e.retryAfterMinutes >= 1,
      );
    } finally {
      if (prevDemo === undefined) delete process.env.PA_DEMO;
      else process.env.PA_DEMO = prevDemo;
      if (prevEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevEnv;
    }
  });

  it("M5: POST /auth/login con email_otp devolve 429 ao superar 20 envíos desde a mesma IP con correos distintos (fóra de demo)", async () => {
    await seedDb();

    const app = new Hono();
    registerAuthLoginRoute(app, new CompositeIdentityProvider());

    const prevTrust = process.env.TRUST_PROXY;
    const prevDemo = process.env.PA_DEMO;
    const prevEnv = process.env.NODE_ENV;
    process.env.TRUST_PROXY = "1";
    process.env.PA_DEMO = "0";
    process.env.NODE_ENV = "development";
    try {
      const sameIp = "198.51.100.77";
      for (let i = 1; i <= 20; i++) {
        const res = await app.request("/auth/login", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": sameIp,
          },
          body: JSON.stringify({
            method: "email_otp",
            identifier: `m5-user-${i}@proba.gal`,
            municipalityId: "muni-exemplo",
          }),
        });
        assert.equal(res.status, 200, `envío #${i} debería responder 200`);
      }

      const blocked = await app.request("/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": sameIp,
        },
        body: JSON.stringify({
          method: "email_otp",
          identifier: "m5-user-21@proba.gal",
          municipalityId: "muni-exemplo",
        }),
      });
      assert.equal(blocked.status, 429);
      const body = (await blocked.json()) as { error?: string; retryAfterMinutes?: number };
      assert.equal(body.error, "rate_limited");
      assert.ok((body.retryAfterMinutes ?? 0) >= 1);

      const otherIp = await app.request("/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "198.51.100.88",
        },
        body: JSON.stringify({
          method: "email_otp",
          identifier: "m5-user-other-ip@proba.gal",
          municipalityId: "muni-exemplo",
        }),
      });
      assert.equal(otherIp.status, 200);
    } finally {
      if (prevTrust === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = prevTrust;
      if (prevDemo === undefined) delete process.env.PA_DEMO;
      else process.env.PA_DEMO = prevDemo;
      if (prevEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevEnv;
    }
  });
});
