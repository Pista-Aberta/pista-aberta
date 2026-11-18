import type { Role } from "./index.js";

/** Destino tras login segundo o rol. */
export function homePathForRole(
  role: Role,
  slug: string,
  clubId?: string | null,
): string {
  switch (role) {
    case "superadmin":
      return "/deputacion";
    case "admin":
      return `/c/${slug}/admin`;
    case "staff":
    case "monitor":
      return `/c/${slug}/conserxeria`;
    case "club_manager":
      return clubId ? `/c/${slug}/clubs/${clubId}` : `/c/${slug}/clubs`;
    case "citizen":
    default:
      return `/c/${slug}`;
  }
}

export type AppZone = "bare" | "citizen" | "admin" | "staff" | "club";

/** Zona de chrome/navegación segundo a URL. */
export function zoneFromPath(pathname: string): AppZone {
  if (
    pathname === "/" ||
    pathname === "/acceso" ||
    pathname.startsWith("/acceso/") ||
    /^\/c\/[^/]+\/acceso\/?$/.test(pathname) ||
    /^\/c\/[^/]+\/widget(\/|$)/.test(pathname) ||
    pathname.startsWith("/plataforma") ||
    pathname.startsWith("/alta-concello") ||
    pathname === "/deputacion" ||
    pathname === "/admin/deputacion"
  ) {
    return "bare";
  }
  if (/\/c\/[^/]+\/admin(\/|$)/.test(pathname)) return "admin";
  if (/\/c\/[^/]+\/(conserxeria|folla-conserxe)(\/|$)/.test(pathname)) {
    return "staff";
  }
  if (/\/c\/[^/]+\/clubs(\/|$)/.test(pathname)) return "club";
  if (pathname.startsWith("/c/")) return "citizen";
  return "bare";
}

/** Roles autorizados nunha zona (null = pública / sen gate). */
export function rolesForZone(zone: AppZone): Role[] | null {
  switch (zone) {
    case "admin":
      return ["admin", "superadmin"];
    case "staff":
      return ["staff", "monitor", "admin", "superadmin"];
    case "club":
      return ["club_manager", "admin", "superadmin"];
    default:
      return null;
  }
}

export function roleAllowedInZone(role: Role, zone: AppZone): boolean {
  const allowed = rolesForZone(zone);
  if (!allowed) return true;
  return allowed.includes(role);
}

/** Admin / staff / club van ligados a un só concello. */
export function isElevatedRole(role: Role): boolean {
  return (
    role === "admin" ||
    role === "superadmin" ||
    role === "staff" ||
    role === "monitor" ||
    role === "club_manager"
  );
}

/**
 * Cidadán con identidade forte (Cl@ve / personIdentifier) pode
 * reservar noutro concello sen cambiar o municipalityId «de casa».
 * Os datos seguen illados por municipalityId da ruta.
 */
export function citizenMayCrossMunicipality(
  role: Role,
  personIdentifier?: string | null,
): boolean {
  return role === "citizen" && !!personIdentifier;
}

export function slugFromPath(pathname: string): string | null {
  return pathname.match(/^\/c\/([^/]+)/)?.[1] ?? null;
}

/**
 * returnTo seguro: path relativo da app.
 * Rexeita open-redirect (`//evil`, `/\evil`, esquemas, control chars).
 */
export function isSafeReturnPath(returnTo: string): boolean {
  if (!returnTo.startsWith("/")) return false;
  if (returnTo.startsWith("//")) return false;
  if (returnTo.includes("\\")) return false;
  if (/[\u0000-\u001f\u007f]/.test(returnTo)) return false;
  return true;
}

/**
 * Destino tras login.
 * - Roles elevados: **sempre** o slug do seu municipalityId; returnTo só se é do mesmo concello.
 * - Cidadán: pode volver a outro concello (fluxo público).
 */
export function resolvePostLoginPath(
  role: Role,
  userMunicipalitySlug: string,
  returnTo?: string | null,
  clubId?: string | null,
): string {
  const home = homePathForRole(role, userMunicipalitySlug, clubId);
  if (!returnTo || !isSafeReturnPath(returnTo)) return home;

  const returnSlug = slugFromPath(returnTo);
  const zone = zoneFromPath(returnTo);

  if (role === "superadmin") {
    // REVISION-17 R7: sempre /deputacion salvo returnTo explícito a /deputacion.
    // O returnTo por defecto da pestana entidade (/c/…/admin) non conta.
    if (/^\/deputacion(\/|$|\?)/.test(returnTo)) return returnTo;
    return home;
  }

  if (isElevatedRole(role)) {
    if (returnSlug && returnSlug !== userMunicipalitySlug) return home;
    if (!roleAllowedInZone(role, zone)) return home;
    // Conta de club: só o seu clubId (non listado doutros clubs)
    if (role === "club_manager" && clubId) {
      const m = returnTo.match(/\/clubs\/([^/]+)/);
      if (m && m[1] !== clubId) return home;
    }
    return returnTo;
  }

  if (zone === "admin" || zone === "staff" || zone === "club") return home;
  return returnTo;
}

/** Pode un usuario elevado operar neste slug de URL? */
export function elevatedBelongsToSlug(
  userMunicipalitySlug: string | undefined | null,
  urlSlug: string,
  role?: Role,
): boolean {
  if (role === "superadmin") return true;
  if (!userMunicipalitySlug) return false;
  return userMunicipalitySlug === urlSlug;
}
