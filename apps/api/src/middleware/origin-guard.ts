/**
 * REVISION-46 — rexeitar mutacións con orixe allea (CSRF same-site en subdominios).
 * 403 `forbidden_origin` se Origin ≠ APP_BASE_URL ou Sec-Fetch-Site: cross-site.
 * Excepcións: widget embebido e retorno Cl@ve/SAML/ACS.
 * REVISION-50 S5: as excepcións miran o comezo da ruta (startsWith), non `includes`.
 */
import type { MiddlewareHandler } from "hono";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function appOrigins(): string[] {
  const base = (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const extras = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
  ];
  return [base, ...extras.filter((o) => o !== base)];
}

function isExemptPath(path: string): boolean {
  if (path.startsWith("/widget")) return true;
  if (path.startsWith("/auth/")) return true;
  if (path.startsWith("/saml/")) return true;
  if (path.startsWith("/acs")) return true;
  if (path.startsWith("/certificate")) return true;
  if (path.startsWith("/cert/")) return true;
  /* Prefixo tenancy: /api/c/:slug/widget… */
  if (/^\/api\/c\/[^/]+\/widget/.test(path)) return true;
  if (/^\/api\/c\/[^/]+\/saml\//.test(path)) return true;
  if (/^\/api\/c\/[^/]+\/acs/.test(path)) return true;
  if (/^\/api\/c\/[^/]+\/certificate/.test(path)) return true;
  if (/^\/api\/c\/[^/]+\/cert\//.test(path)) return true;
  return false;
}

export const originGuard: MiddlewareHandler = async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (!MUTATING.has(method)) {
    await next();
    return;
  }
  const path = c.req.path;
  if (isExemptPath(path)) {
    await next();
    return;
  }

  const secFetchSite = (c.req.header("sec-fetch-site") ?? "").toLowerCase();
  if (secFetchSite === "cross-site") {
    return c.json({ error: "forbidden_origin" }, 403);
  }

  const origin = c.req.header("origin");
  if (!origin) {
    /* Sen Origin (navegación same-origin clásica / curl): permitir. */
    await next();
    return;
  }

  const allowed = appOrigins();
  const originNorm = origin.replace(/\/$/, "");
  if (!allowed.some((a) => a === originNorm)) {
    return c.json({ error: "forbidden_origin" }, 403);
  }

  await next();
};
