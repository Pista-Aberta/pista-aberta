/**
 * REVISION-30 Z1 — NIF de demo válido, aleatorio e distinto dos da Cl@ve de proba.
 */
const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";

/** NIF demos da Cl@ve de proba — non proponelos. */
const RESERVED = new Set([
  "12345678Z",
  "87654321X",
  "23456789D",
  "88888888Y",
  "X1234567L",
]);

export function randomDemoNif(exclude: Set<string> = new Set()): string {
  for (let i = 0; i < 40; i++) {
    const n = Math.floor(Math.random() * 90_000_000) + 10_000_000;
    const letter = DNI_LETTERS[n % 23]!;
    const nif = `${n}${letter}`;
    if (RESERVED.has(nif) || exclude.has(nif)) continue;
    return nif;
  }
  return "44556677L";
}
