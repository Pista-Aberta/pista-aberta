/**
 * REVISION-26 G2 — anonimiza respostas JSON para Deputación sen opt-in do concello.
 * Sen nome completo, correo, teléfono nin DNI; iniciais tipo «AR» si.
 */
const PII_KEY_EXACT = new Set([
  "userdisplayname",
  "displayname",
  "email",
  "phone",
  "telephone",
  "tel",
  "personidentifier",
  "nif",
  "dni",
  "nie",
  "citizenname",
  "applicantname",
  "applicantemail",
  "solicitante",
  "correo",
  "telefone",
  "teléfono",
]);

const PII_KEY_HINT =
  /(email|phone|telefono|teléfono|personidentifier|\bnif\b|\bdni\b|\bnie\b|displayname|citizenname|applicant)/i;

function initialsFromName(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "·";
  if (parts.length === 1) return (parts[0]![0] ?? "·").toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

function scrubDetail(value: string): string {
  /* REVISION-34 F1: se o detalle leva un nome («Ana Demo:…»), deixa iniciais. */
  const m = /^([^:]+?)(:.*)?$/s.exec(value.trim());
  if (!m) return value;
  const head = m[1]!.trim();
  const rest = m[2] ?? "";
  if (/^[a-z0-9._-]+$/i.test(head) && !/\s/.test(head)) {
    /* Id técnico (user-cidada, booking id, …) — sen cambio. */
    return value;
  }
  if (/\s/.test(head) && /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(head)) {
    return `${initialsFromName(head)}${rest}`;
  }
  return value;
}

function scrubStringKey(key: string, value: string): string {
  const k = key.toLowerCase().replace(/[^a-z0-9áéíóúñ]/gi, "");
  if (k === "actor") {
    /* Deputación non debe ver o nome completo da veciñanza na auditoría. */
    if (/^[a-z0-9._-]+$/i.test(value.trim()) && !/\s/.test(value)) return value;
    return initialsFromName(value);
  }
  if (k === "detail") {
    return scrubDetail(value);
  }
  if (
    k === "userdisplayname" ||
    k === "displayname" ||
    k === "citizenname" ||
    k === "applicantname" ||
    k === "solicitante" ||
    /name$/i.test(key) && /user|citizen|applicant|person|display/i.test(key)
  ) {
    return initialsFromName(value);
  }
  if (
    PII_KEY_EXACT.has(k) ||
    PII_KEY_HINT.test(key)
  ) {
    return "";
  }
  return value;
}

export function anonymizeDeputacionPayload(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) {
    return value.map((v) => anonymizeDeputacionPayload(v));
  }
  if (typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string") {
      out[key] = scrubStringKey(key, raw);
    } else {
      out[key] = anonymizeDeputacionPayload(raw);
    }
  }
  return out;
}
