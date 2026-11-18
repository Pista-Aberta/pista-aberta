/** Nome curto do concello (sen «Concello de»). */
export function shortMunicipalityName(name: string): string {
  return name.replace(/^Concello de\s+/i, "").trim() || name;
}

/** REVISION-30 Z4 / REVISION-31 B3 — nome limpo proposto no asistente de alta. */
export function friendlyFacilityLabel(
  rawName: string,
  type: string,
  muniName: string,
): string {
  const short = shortMunicipalityName(muniName);
  const base = rawName.replace(/\s*\(\d+\)\s*$/, "").trim();
  const ty = type.toLowerCase();
  if (ty.includes("pavill") || /pavill/i.test(base)) {
    return `Pavillón municipal de ${short}`;
  }
  if (ty.includes("campo") || ty.includes("futbol") || /campo|fútbol|futbol/i.test(base)) {
    return `Campos municipais de ${short}`;
  }
  if (ty.includes("sala") || /sala/i.test(base)) {
    return `Salas municipais de ${short}`;
  }
  if (base) return `${base.replace(/\s*\/.*$/, "").trim()} municipais de ${short}`;
  return `Pistas municipais de ${short}`;
}

/** Extrae o número do censo «Campos de fútbol (14)». */
export function censusCountFromName(rawName: string): number {
  const m = rawName.match(/\((\d+)\)\s*$/);
  return m ? Math.max(1, Number(m[1])) : 1;
}

export function censusKindLabel(type: string, n: number, gl = true): string {
  const ty = type.toLowerCase();
  if (ty.includes("campo") || ty.includes("futbol")) {
    return gl ? (n === 1 ? "campo" : "campos") : n === 1 ? "campo" : "campos";
  }
  if (ty.includes("pavill")) {
    return gl ? (n === 1 ? "pista" : "pistas") : n === 1 ? "pista" : "pistas";
  }
  if (ty.includes("sala")) {
    return gl ? (n === 1 ? "sala" : "salas") : n === 1 ? "sala" : "salas";
  }
  return gl ? (n === 1 ? "pista" : "pistas") : n === 1 ? "pista" : "pistas";
}
