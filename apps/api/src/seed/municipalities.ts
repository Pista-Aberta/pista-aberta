import { listMunicipalities } from "../store/db.js";

/** Compat: seed multi-concello desde o store. */
export function getMunicipalitySeed() {
  return listMunicipalities();
}
