/**
 * Rol efectivo nun concello (casa ou user_roles), sen o rol principal doutro tenant.
 * Extraído para que helpers de club/auth compartan a mesma regra sen ciclos.
 */
import {
  citizenMayCrossMunicipality,
  type AuthUser,
  type Role,
} from "@pista-aberta/shared";

export function effectiveRoleInMunicipality(
  user: AuthUser,
  municipalityId: string,
): Role | null {
  if (user.role === "superadmin") return "superadmin";
  if (user.municipalityId === municipalityId) {
    return user.role;
  }
  if (citizenMayCrossMunicipality(user.role, user.personIdentifier)) {
    return "citizen";
  }
  const linked = user.linkedMuniRoles?.filter(
    (r) => r.municipalityId === municipalityId,
  );
  if (!linked?.length) return null;
  if (user.activeMuniRole) {
    const hit = linked.find((r) => r.role === user.activeMuniRole);
    if (hit) return hit.role;
  }
  return linked[0]!.role as Role;
}
