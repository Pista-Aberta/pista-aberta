import type { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { cookieSecure, isDemoMode, isSamlLoginConfigured } from "../env.js";
import { StrongAuthRequiredError } from "./email-otp.js";
import type { IdentityProvider } from "./types.js";
import {
  assertLoginRateLimit,
  clientIpFromContext,
  LoginRateLimitedError,
} from "./login-rate-limit.js";

/** REVISION-26 M2: mock/SAML só con Cl@ve configurada ou modo demo. */
export function samlRoutesExposed(): boolean {
  return isSamlLoginConfigured() || isDemoMode();
}

export function registerAuthLoginRoute<E extends object>(
  app: Hono<E>,
  identity: IdentityProvider,
): void {
  app.post("/auth/login", async (c) => {
    const body = await c.req.json<{
      method: "saml" | "email_otp" | "certificate";
      identifier?: string;
      municipalityId?: string;
      returnTo?: string;
    }>();
    try {
      if (body.method === "saml" && !samlRoutesExposed()) {
        return c.json({ error: "not_found" }, 404);
      }
      const ip = clientIpFromContext(c);
      const id = body.identifier?.trim();
      const isSamlStart = body.method === "saml" && !id;
      /* REVISION-60 M5: limitar envíos OTP tamén por IP (20 / 10 min) ademais do correo. */
      if (body.method === "email_otp") {
        await assertLoginRateLimit(`otp-ip:${ip.toLowerCase()}`, "otp_ip");
      }
      const rateKey = (id || ip).toLowerCase();
      await assertLoginRateLimit(rateKey, isSamlStart ? "saml_start" : "default");
      const result = await identity.login({
        method: body.method,
        identifier: body.identifier,
        municipalityId: body.municipalityId,
        returnTo: body.returnTo,
      });
      /* REVISION-50 S5: ligar state do certificado ao navegador. */
      if (body.method === "certificate" && result.state) {
        setCookie(c, "pa_cert_state", result.state, {
          httpOnly: true,
          path: "/",
          sameSite: "Lax",
          secure: cookieSecure(),
          maxAge: 5 * 60,
        });
      }
      return c.json(result);
    } catch (e) {
      if (e instanceof StrongAuthRequiredError) {
        return c.json({ error: e.code }, 403);
      }
      if (e instanceof LoginRateLimitedError) {
        return c.json(
          { error: "rate_limited", retryAfterMinutes: e.retryAfterMinutes },
          429,
        );
      }
      const msg = e instanceof Error ? e.message : "error";
      if (msg === "rate_limited") return c.json({ error: "rate_limited" }, 429);
      return c.json({ error: msg }, 400);
    }
  });
}
