/**
 * Constantes e helpers de regras de negocio (revisión Pablo).
 * REVISION-48 Y7: timezone / isSlotInPast viven en `@pista-aberta/shared`.
 */

import {
  DEFAULT_TIMEZONE,
  localDateIso,
  slotInstant,
  isSlotInPast,
} from "@pista-aberta/shared";

export { DEFAULT_TIMEZONE, localDateIso, slotInstant, isSlotInPast };

/** Ventá de check-in QR: ±30 min respecto ao inicio/fin da franxa. */
export const QR_CHECKIN_MARGIN_MINUTES = 30;

/** Máximo de reservas activas (confirmadas, data ≥ hoxe) por persoa. */
export const DEFAULT_MAX_ACTIVE_BOOKINGS = 3;

/** Anonimizar PII de reservas cuxa data sexa anterior a hoxe − N días. */
export const DEFAULT_ANONYMIZE_AFTER_DAYS = 90;

/** Alias: «hoxe» civil na zona do concello (por defecto Europe/Madrid). */
export function todayIso(
  now: Date = new Date(),
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  return localDateIso(now, timeZone);
}

export function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Interpreta data+hora local do concello como instante (UTC). */
export function slotDateTime(
  date: string,
  hhmm: string,
  timeZone: string = DEFAULT_TIMEZONE,
): Date {
  return slotInstant(date, hhmm, timeZone);
}

/**
 * REVISION-56 H2 — interpreta `YYYY-MM-DDTHH:mm[:ss]` como hora local do concello.
 * Sen zona no string (como gardan os peches).
 */
export function parseLocalDateTime(
  isoLocal: string,
  timeZone: string = DEFAULT_TIMEZONE,
): Date {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2})?/.exec(
    isoLocal.trim(),
  );
  if (!m) return new Date(isoLocal);
  return slotInstant(m[1]!, m[2]!, timeZone);
}

const CLOSURE_DATE_ONLY = /^(\d{4}-\d{2}-\d{2})$/;
const CLOSURE_DATE_TIME =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2})?$/;

function isValidClosureDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === mo - 1 &&
    dt.getUTCDate() === d
  );
}

function isValidClosureTime(value: string, allow24End: boolean): boolean {
  if (allow24End && value === "24:00") return true;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/**
 * REVISION-57 J2 + REVISION-60 N11 — só data → T00:00 / T23:59; data+hora OK;
 * datas/horas inválidas ou inicio >= fin → invalid_closure_datetime.
 */
export function normalizeClosureBound(
  startsAt: string,
  endsAt: string,
): { startsAt: string; endsAt: string } {
  const one = (raw: string, endOfDay: boolean): string => {
    const s = raw.trim();
    const dateOnly = CLOSURE_DATE_ONLY.exec(s);
    if (dateOnly) {
      if (!isValidClosureDate(dateOnly[1]!)) {
        throw new Error("invalid_closure_datetime");
      }
      return `${dateOnly[1]}T${endOfDay ? "23:59" : "00:00"}`;
    }
    const dt = CLOSURE_DATE_TIME.exec(s);
    if (dt) {
      if (
        !isValidClosureDate(dt[1]!) ||
        !isValidClosureTime(dt[2]!, endOfDay)
      ) {
        throw new Error("invalid_closure_datetime");
      }
      return `${dt[1]}T${dt[2]}`;
    }
    throw new Error("invalid_closure_datetime");
  };
  const normStart = one(startsAt, false);
  const normEnd = one(endsAt, true);
  if (normStart >= normEnd) {
    throw new Error("invalid_closure_datetime");
  }
  return {
    startsAt: normStart,
    endsAt: normEnd,
  };
}

/**
 * REVISION-56 H2 — a franxa solapa co peche no intervalo semiaberto [startsAt, endsAt).
 */
export function slotOverlapsClosureRange(
  date: string,
  start: string,
  end: string,
  startsAt: string,
  endsAt: string,
  timeZone: string = DEFAULT_TIMEZONE,
): boolean {
  const slotStart = slotInstant(date, start, timeZone).getTime();
  const slotEnd = slotInstant(date, end, timeZone).getTime();
  const cStart = parseLocalDateTime(startsAt, timeZone).getTime();
  const cEnd = parseLocalDateTime(endsAt, timeZone).getTime();
  return slotStart < cEnd && cStart < slotEnd;
}

/** Duración en horas entre dúas HH:mm do mesmo día (sen TZ). */
export function slotDurationHours(start: string, end: string): number {
  const parse = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  return Math.max(0, (parse(end) - parse(start)) / 60);
}

export function weekStartIso(dateIso: string): string {
  const d = new Date(`${dateIso}T12:00:00Z`);
  const day = d.getUTCDay(); // 0=dom
  const diff = day === 0 ? -6 : 1 - day; // luns
  return addDaysIso(dateIso, diff);
}

/** Día da semana local (0=dom … 6=sáb) para YYYY-MM-DD na zona `timeZone`. */
export function localWeekday(
  isoDate: string,
  timeZone: string = DEFAULT_TIMEZONE,
): number {
  const d = slotInstant(isoDate, "12:00", timeZone);
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(d);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[wd] ?? 0;
}

/** Sábado da fin de semana civil actual + 7×`weekOffset` (REVISION-17 R3). */
export function weekendSaturdayIso(
  now: Date = new Date(),
  timeZone: string = DEFAULT_TIMEZONE,
  weekOffset = 0,
): string {
  const today = localDateIso(now, timeZone);
  const day = localWeekday(today, timeZone);
  let sat: string;
  if (day === 6) sat = today;
  else if (day === 0) sat = addDaysIso(today, -1);
  else sat = addDaysIso(today, 6 - day);
  if (weekOffset !== 0) sat = addDaysIso(sat, weekOffset * 7);
  return sat;
}

/**
 * Sábado estritamente futuro (salta a fin de semana civil se xa é hoxe/pasado).
 * Evita `in_past` / `slot_in_past` nos tests cando o reló cai en sábado/domingo.
 */
export function futureWeekendSaturdayIso(
  now: Date = new Date(),
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  const today = localDateIso(now, timeZone);
  let sat = weekendSaturdayIso(now, timeZone);
  if (sat <= today) sat = weekendSaturdayIso(now, timeZone, 1);
  return sat;
}

/** O cliente non pode enviar priorityGroup no body de inscrición. */
export function clientSentPriorityGroup(body: unknown): boolean {
  return (
    !!body &&
    typeof body === "object" &&
    Object.prototype.hasOwnProperty.call(body, "priorityGroup")
  );
}
