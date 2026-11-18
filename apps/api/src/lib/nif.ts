/**
 * Normalización e validación DNI/NIE para admin / persoal / club.
 */
import { normalizeNif, validateNifLetter } from "../identity/certificate.js";

export { normalizeNif, validateNifLetter };

/** «12345678Z» ou «ES/ES/12345678Z» → personIdentifier canónico. */
export function toPersonIdentifier(raw: string): string {
  let s = raw.trim().toUpperCase();
  if (s.startsWith("ES/ES/")) s = s.slice(6);
  const nif = normalizeNif(s);
  if (!validateNifLetter(nif)) {
    throw new Error("nif_invalid");
  }
  return `ES/ES/${nif}`;
}
