/** Rutas `/entrar/:slug/:perfil` da demo (landing → login SAML nun clic). */

import { homePathForRole } from "@pista-aberta/shared";

export const DEMO_ENTRAR_PERFIS = [
  "vecina",
  "concello",
  "club",
  "conserxaria",
  "deputacion",
] as const;

export type DemoEntrarPerfil = (typeof DEMO_ENTRAR_PERFIS)[number];

export type DemoEntrarAlias =
  | "cidada"
  | "admin"
  | "club"
  | "staff"
  | "deputacion";

/** Alias curtos / EN / SAML que a landing ou docs poden usar. */
const PERFIL_ALIASES: Record<string, DemoEntrarPerfil> = {
  vecina: "vecina",
  vecino: "vecina",
  cidada: "vecina",
  citizen: "vecina",
  concello: "concello",
  admin: "concello",
  club: "club",
  conserxaria: "conserxaria",
  conserxe: "conserxaria",
  staff: "conserxaria",
  deputacion: "deputacion",
};

export function isDemoEntrarPerfil(value: string): value is DemoEntrarPerfil {
  return (DEMO_ENTRAR_PERFIS as readonly string[]).includes(value);
}

/** Normaliza `cidada`/`admin`/… ao perfil canónico da ruta. */
export function normalizeDemoEntrarPerfil(
  value: string,
): DemoEntrarPerfil | null {
  const key = value.trim().toLowerCase();
  return PERFIL_ALIASES[key] ?? null;
}

export function demoEntrarAlias(perfil: DemoEntrarPerfil): DemoEntrarAlias {
  switch (perfil) {
    case "vecina":
      return "cidada";
    case "concello":
      return "admin";
    case "club":
      return "club";
    case "conserxaria":
      return "staff";
    case "deputacion":
      return "deputacion";
    default: {
      const _exhaustive: never = perfil;
      return _exhaustive;
    }
  }
}

/**
 * Chave SAML exacta como DemoProfileBar (`demoPersonaKey` + slug).
 * Con DEMO_USERS_FILE, `cidada` + RelayState `/c/secundario` → Luis.
 */
export function demoEntrarUserKey(
  slug: string,
  perfil: DemoEntrarPerfil,
): string | null {
  const alias = demoEntrarAlias(perfil);
  if (alias === "deputacion") return "deputacion";
  /* Mesma táboa que demoPersonaKey en demo-defaults.ts (sen importar api). */
  if (slug === "proba") {
    if (alias === "cidada") return "cidada-proba";
    if (alias === "admin") return "admin-proba";
    return null;
  }
  return alias;
}

export function demoEntrarRelay(
  slug: string,
  perfil: DemoEntrarPerfil,
): string {
  if (perfil === "deputacion") return "/deputacion";
  const alias = demoEntrarAlias(perfil);
  if (alias === "cidada") return `/c/${slug}`;
  if (alias === "admin") return homePathForRole("admin", slug);
  if (alias === "staff") return homePathForRole("staff", slug);
  if (alias === "club") return homePathForRole("club_manager", slug);
  return `/c/${slug}`;
}
