/**
 * Zona horaria e franxas — compartido API / web (Europe/Madrid por defecto).
 * REVISION-48 Y7: `isSlotInPast` no cliente igual ca no servidor.
 */

export const DEFAULT_TIMEZONE = "Europe/Madrid";

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => {
    const v = parts.find((p) => p.type === type)?.value;
    return Number(v);
  };
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Data civil YYYY-MM-DD na zona `timeZone` (non UTC do dispositivo). */
export function localDateIso(
  now: Date = new Date(),
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  const p = zonedParts(now, timeZone);
  const y = String(p.year).padStart(4, "0");
  const m = String(p.month).padStart(2, "0");
  const d = String(p.day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Instante UTC correspondente a `date` + `hhmm` interpretados na zona `timeZone`.
 * Sen dependencias externas (Intl); converge con 1–2 iteracións (DST).
 */
export function slotInstant(
  date: string,
  hhmm: string,
  timeZone: string = DEFAULT_TIMEZONE,
): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const desiredAsUtc = Date.UTC(y!, mo! - 1, d!, h ?? 0, mi ?? 0, 0);
  let guess = desiredAsUtc;
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(new Date(guess), timeZone);
    const shownAsUtc = Date.UTC(
      p.year,
      p.month - 1,
      p.day,
      p.hour,
      p.minute,
      p.second,
    );
    const diff = shownAsUtc - desiredAsUtc;
    if (diff === 0) break;
    guess -= diff;
  }
  return new Date(guess);
}

/** Franxa con `start <= agora` na zona do concello. */
export function isSlotInPast(
  date: string,
  start: string,
  now: Date = new Date(),
  timeZone: string = DEFAULT_TIMEZONE,
): boolean {
  return slotInstant(date, start, timeZone).getTime() <= now.getTime();
}
