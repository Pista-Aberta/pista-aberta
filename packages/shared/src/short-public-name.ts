/**
 * Nome público en partidos abertos: «Ana R.» (pila + inicial do primeiro apelido).
 */
export function shortPublicName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  return `${parts[0]} ${parts[1]!.charAt(0).toUpperCase()}.`;
}

/**
 * REVISION-42 Q6 — o nome aínda é o local-part do correo (OTP sen nome real).
 */
export function isEmailLocalPartName(
  displayName: string | null | undefined,
  email: string | null | undefined,
): boolean {
  const name = (displayName ?? "").trim().toLowerCase();
  const mail = (email ?? "").trim().toLowerCase();
  if (!name || !mail || !mail.includes("@")) return false;
  const local = mail.split("@")[0] ?? "";
  return name === local || name === mail;
}

/**
 * REVISION-43 R2 — letras (Unicode, tildes, ñ), espazos, punto, guión, apóstrofo.
 * Sen `< > = @` nin `http`; non comeza por `= + - @`. Lonxitude 2–40.
 * REVISION-44 S3 — sen nomes institucionais (Concello, Admin, Pista Aberta…).
 */
const DISPLAY_NAME_OK = /^[\p{L}][\p{L}\s.'’-]*$/u;

const DISPLAY_NAME_BANNED =
  /\b(concello|ayuntamiento|deputaci[oó]n|diputaci[oó]n|admin|pista\s+aberta)\b/i;

export function isValidDisplayName(raw: string | null | undefined): boolean {
  const name = (raw ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 40) return false;
  if (/^[=+\-@]/.test(name)) return false;
  if (/[<>=@]|https?:\/\//i.test(name)) return false;
  if (DISPLAY_NAME_BANNED.test(name)) return false;
  return DISPLAY_NAME_OK.test(name);
}

/**
 * Nome amosable ao crear/apuntarse: «Ana R.» ou «Ana Demo».
 * - sen nome / local-part OTP → `display_name_required`
 * - formato inválido → `invalid_display_name`
 */
export function assertDisplayNameForMatch(
  raw: string | null | undefined,
  email?: string | null,
): string {
  const name = (raw ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 2) throw new Error("display_name_required");
  if (isEmailLocalPartName(name, email)) {
    throw new Error("display_name_required");
  }
  if (!isValidDisplayName(name)) {
    throw new Error("invalid_display_name");
  }
  return name;
}

/**
 * REVISION-43 R2 — CSV: comiñas + prefixo `'` se a cela comeza por fórmula Excel.
 */
export function csvEscapeCell(value: string): string {
  let v = String(value ?? "").replace(/"/g, '""');
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return `"${v}"`;
}
