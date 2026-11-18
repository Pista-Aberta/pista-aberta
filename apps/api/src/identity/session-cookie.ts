import type { Context } from "hono";
import { setCookie } from "hono/cookie";
import { cookieSecure } from "../env.js";

/**
 * Cookie de sesión uniforme (REVISION-2 §8).
 * Sen maxAge: a sesión remata ao pechar o navegador (ordenadores compartidos);
 * a caducidade real está no servidor (SESSION_DAYS).
 */
export function setSessionCookie(c: Context, sessionId: string): void {
  setCookie(c, "pa_sesion", sessionId, {
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
    secure: cookieSecure(),
  });
}
