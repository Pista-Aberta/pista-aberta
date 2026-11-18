/**
 * TANDA-1 — comprobacións de illamento por municipalityId.
 */
import { getFacility, listUnits } from "./db.js";

export async function assertFacilityInMuni(
  municipalityId: string,
  facilityId: string,
): Promise<NonNullable<Awaited<ReturnType<typeof getFacility>>>> {
  const f = await getFacility(facilityId);
  if (!f || f.municipalityId !== municipalityId) {
    throw new Error("not_found");
  }
  return f;
}

export async function assertFacilityUnitInMuni(
  municipalityId: string,
  facilityId: string,
  unitId?: string,
): Promise<void> {
  await assertFacilityInMuni(municipalityId, facilityId);
  if (!unitId) return;
  const units = await listUnits(facilityId);
  if (
    !units.some(
      (u) => u.id === unitId && u.municipalityId === municipalityId,
    )
  ) {
    throw new Error("not_found");
  }
}
