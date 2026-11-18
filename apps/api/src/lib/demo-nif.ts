/**
 * REVISION-30 Z1 — NIF de demo válido e aleatorio (API).
 */
const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";

const RESERVED = new Set([
  "12345678Z",
  "87654321X",
  "23456789D",
  "88888888Y",
  "X1234567L",
]);

export function randomDemoNif(exclude: Iterable<string> = []): string {
  const ban = new Set(
    [...RESERVED, ...exclude].map((s) => s.replace(/^ES\/ES\//, "").toUpperCase()),
  );
  for (let i = 0; i < 40; i++) {
    const n = Math.floor(Math.random() * 90_000_000) + 10_000_000;
    const letter = DNI_LETTERS[n % 23]!;
    const nif = `${n}${letter}`;
    if (ban.has(nif)) continue;
    return nif;
  }
  return "44556677L";
}
