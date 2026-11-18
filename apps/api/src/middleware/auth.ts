import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import {
  citizenMayCrossMunicipality,
  type AuthUser,
  type Role,
} from "@pista-aberta/shared";
import { getSession } from "../identity/sessions.js";
import { anonymizeDeputacionPayload } from "../store/deputacion-anonymize.js";
import { effectiveRoleInMunicipality } from "../lib/effective-role.js";

export { effectiveRoleInMunicipality } from "../lib/effective-role.js";

export type RequireMuniRolesOptions = { personalData?: true };

function parseRequireMuniRolesArgs(
  args: (Role | RequireMuniRolesOptions)[],
): { roles: Role[]; options?: RequireMuniRolesOptions } {
  const last = args[args.length - 1];
  if (
    last &&
    typeof last === "object" &&
    "personalData" in last
  ) {
    return {
      roles: args.slice(0, -1) as Role[],
      options: last as RequireMuniRolesOptions,
    };
  }
  return { roles: args as Role[] };
}

/** REVISION-25 N3: superadmin sen opt-in do concello non accede a PII. */
export async function assertDeputacionPersonalDataAllowed(
  c: Context,
): Promise<Response | null> {
  const user = c.get("user");
  if (!user || user.role !== "superadmin") return null;
  const mid = c.get("municipalityId");
  if (!mid) {
    return c.json({ error: "forbidden", reason: "deputacion_privacy" }, 403);
  }
  const { getMunicipalityById } = await import("../store/db.js");
  const muni = await getMunicipalityById(mid);
  if (muni?.settings.deputacionCanViewPersonalData === true) return null;
  return c.json({ error: "forbidden", reason: "deputacion_privacy" }, 403);
}

declare module "hono" {
  interface ContextVariableMap {
    user: AuthUser | null;
    /** Rol resolto para o concello da ruta, nunca o rol principal doutro tenant. */
    effectiveRole: Role;
  }
}

export async function optionalAuth(c: Context, next: Next) {
  const sessionId = getCookie(c, "pa_sesion");
  c.set("user", sessionId ? await getSession(sessionId) : null);
  await next();
}

/**
 * REVISION-26 G2 — tras a resposta, se o rol é Deputación e o concello
 * non deu permiso, anonimiza o JSON (sen nome/correo/teléfono/DNI).
 */
export async function deputacionAnonymizeMiddleware(c: Context, next: Next) {
  await next();
  const user = c.get("user");
  if (!user || user.role !== "superadmin") return;
  if (c.req.method.toUpperCase() !== "GET") return;
  const mid = c.get("municipalityId");
  if (!mid) return;
  const { getMunicipalityById } = await import("../store/db.js");
  const muni = await getMunicipalityById(mid);
  if (muni?.settings.deputacionCanViewPersonalData === true) return;

  const ct = c.res.headers.get("content-type") ?? "";
  try {
    if (ct.includes("application/json")) {
      const raw = await c.res.clone().json();
      const scrubbed = anonymizeDeputacionPayload(raw);
      c.res = new Response(JSON.stringify(scrubbed), {
        status: c.res.status,
        headers: c.res.headers,
      });
      return;
    }
    if (ct.includes("text/csv") || ct.includes("text/plain")) {
      /* CSV de exportación: substituír nomes coñecidos por iniciais é difícil;
         baleiramos a columna «user» / nomes entre comiñas longas → «·». */
      let text = await c.res.clone().text();
      text = text.replace(
        /("[^"]*@[^"]*")|(\b[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,3}\b)/g,
        (m) => (m.includes("@") ? '""' : '"·"'),
      );
      c.res = new Response(text, {
        status: c.res.status,
        headers: c.res.headers,
      });
    }
  } catch {
    /* corpo baleiro */
  }
}

export async function requireAuth(c: Context, next: Next) {
  const sessionId = getCookie(c, "pa_sesion");
  const user = sessionId ? await getSession(sessionId) : null;
  if (!user) return c.json({ error: "unauthorized" }, 401);
  c.set("user", user);
  await next();
}

/**
 * Pertenza ao municipalityId da ruta.
 * - Superadmin: sempre.
 * - Cidadán con personIdentifier: pode actuar noutro concello
 *   (reservas/datos illados polo municipalityId da URL).
 * - Admin/staff/club e cidadán sen Cl@ve: só o seu concello.
 */
export function userBelongsToMunicipality(
  user: AuthUser,
  municipalityId: string,
): boolean {
  if (user.role === "superadmin") return true;
  if (citizenMayCrossMunicipality(user.role, user.personIdentifier)) {
    return true;
  }
  if (user.municipalityId === municipalityId) return true;
  /* REVISION-30 Z1: admin/staff vía user_roles noutro concello. */
  return !!user.linkedMuniRoles?.some((r) => r.municipalityId === municipalityId);
}

function wrongMuniBody(user: AuthUser) {
  return {
    error: "forbidden",
    reason: "wrong_municipality",
    userMunicipalityId: user.municipalityId,
    municipalitySlug: user.municipalitySlug,
  };
}

/**
 * Auth + o usuario debe pertencer ao municipalityId da ruta
 * (calquera rol, incl. cidadán). Usar en escritura e datos persoais.
 */
export function requireSameMunicipality() {
  return async (c: Context, next: Next) => {
    const sessionId = getCookie(c, "pa_sesion");
    const user = sessionId ? await getSession(sessionId) : null;
    if (!user) return c.json({ error: "unauthorized" }, 401);
    const mid = c.get("municipalityId");
    if (mid && !userBelongsToMunicipality(user, mid)) {
      return c.json(wrongMuniBody(user), 403);
    }
    const effective = mid
      ? effectiveRoleInMunicipality(user, mid)
      : user.role;
    if (!effective) {
      return c.json(wrongMuniBody(user), 403);
    }
    c.set("user", user);
    c.set("effectiveRole", effective);
    await next();
  };
}

/** Auth + rol permitido + mesmo municipalityId da ruta. */
export function requireMuniRoles(
  ...args: (Role | RequireMuniRolesOptions)[]
) {
  const { roles, options } = parseRequireMuniRolesArgs(args);
  return async (c: Context, next: Next) => {
    const sessionId = getCookie(c, "pa_sesion");
    const user = sessionId ? await getSession(sessionId) : null;
    if (!user) return c.json({ error: "unauthorized" }, 401);
    // Deputación: ve todos os paneis; escritura bloqueada (só lectura).
    if (user.role === "superadmin") {
      const method = c.req.method.toUpperCase();
      if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
        return c.json({ error: "forbidden", reason: "read_only" }, 403);
      }
      c.set("user", user);
      c.set("effectiveRole", "superadmin");
      if (options?.personalData) {
        const blocked = await assertDeputacionPersonalDataAllowed(c);
        if (blocked) return blocked;
      }
      await next();
      return;
    }
    const mid = c.get("municipalityId");
    if (mid && !userBelongsToMunicipality(user, mid)) {
      return c.json(wrongMuniBody(user), 403);
    }
    const effective = mid
      ? effectiveRoleInMunicipality(user, mid)
      : user.role;
    if (!effective || (!roles.includes(effective) && effective !== "superadmin")) {
      return c.json({ error: "forbidden", reason: "role" }, 403);
    }
    c.set("user", user);
    c.set("effectiveRole", effective);
    await next();
  };
}
