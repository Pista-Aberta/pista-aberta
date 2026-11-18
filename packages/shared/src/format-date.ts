/** Datas lexibles GL/ES — compartido web + API. */
const MONTHS_GL = [
  "xaneiro",
  "febreiro",
  "marzo",
  "abril",
  "maio",
  "xuño",
  "xullo",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "decembro",
];
const MONTHS_ES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
const DOW_GL = [
  "domingo",
  "luns",
  "martes",
  "mércores",
  "xoves",
  "venres",
  "sábado",
];
const DOW_ES = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
];

export const DEFAULT_DISPLAY_TIMEZONE = "Europe/Madrid";

/**
 * `iso` = YYYY-MM-DD → «sábado 24 de outubro» (gl) / «sábado 24 de octubre» (es).
 */
export function formatDate(iso: string, locale: string = "gl"): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return iso;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d, 12, 0, 0);
  if (Number.isNaN(dt.getTime())) return iso;
  const es = locale.toLowerCase().startsWith("es");
  const dow = (es ? DOW_ES : DOW_GL)[dt.getDay()]!;
  const month = (es ? MONTHS_ES : MONTHS_GL)[mo - 1]!;
  return `${dow} ${d} de ${month}`;
}

/**
 * REVISION-47 W5 — «1 de setembro de 2026» / «1 de septiembre de 2026».
 */
export function formatDateLong(iso: string, locale: string = "gl"): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return iso;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || !mo || !d) return iso;
  const es = locale.toLowerCase().startsWith("es");
  const month = (es ? MONTHS_ES : MONTHS_GL)[mo - 1]!;
  return `${d} de ${month} de ${y}`;
}

/** Etiqueta curta ao lado dun input type=date. */
export function formatDateShort(iso: string, locale: string = "gl"): string {
  return formatDate(iso, locale);
}

const DOW_SHORT_GL = ["Dom", "Lun", "Mar", "Mér", "Xov", "Ven", "Sáb"] as const;
const DOW_SHORT_ES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"] as const;

/**
 * Día da semana curto (Dom/Lun/…) a partir de YYYY-MM-DD.
 * Nunca usa `toLocaleDateString` (pode devolver inglés se faltan locales).
 */
export function formatWeekdayShort(iso: string, locale: string = "gl"): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return "";
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  if (Number.isNaN(dt.getTime())) return "";
  const es = locale.toLowerCase().startsWith("es");
  return (es ? DOW_SHORT_ES : DOW_SHORT_GL)[dt.getDay()]!;
}

/** «mér 28» / «mié 28» — lista do calendario e resumos curtos. */
export function formatDayChip(iso: string, locale: string = "gl"): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return iso;
  const day = Number(m[3]);
  const wd = formatWeekdayShort(iso, locale);
  if (!wd) return iso;
  return `${wd.toLowerCase()} ${day}`;
}

/** «outubro de 2026» / «octubre de 2026» — cabeceira do calendario mensual. */
export function formatMonthYear(year: number, month: number, locale: string = "gl"): string {
  if (month < 1 || month > 12 || !Number.isFinite(year)) return `${year}-${month}`;
  const es = locale.toLowerCase().startsWith("es");
  const name = (es ? MONTHS_ES : MONTHS_GL)[month - 1]!;
  return `${name} de ${year}`;
}

/** «mér 28, 18:00» para resumos de cambio de reserva. */
export function formatDayTimeChip(iso: string, time: string, locale: string = "gl"): string {
  return `${formatDayChip(iso, locale)}, ${time}`;
}

/**
 * Instant ISO → «23/10/2026, 18:27» na zona do concello (nunca UTC cru).
 * REVISION-24 T19: formatar dd/mm/aaaa a man — `Intl` con `gl-ES` en Chromium
 * pode devolver MM/DD (p.ex. 11/02/2026 para o 2 de novembro).
 */
export function formatDateTime(
  iso: string,
  locale: string = "gl",
  timeZone: string = DEFAULT_DISPLAY_TIMEZONE,
): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const tz = timeZone || DEFAULT_DISPLAY_TIMEZONE;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      hourCycle: "h23",
    }).formatToParts(d);
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === type)?.value ?? "";
    const day = get("day");
    const month = get("month");
    const year = get("year");
    const hour = get("hour");
    const minute = get("minute");
    if (!day || !month || !year) return iso;
    void locale;
    return `${day}/${month}/${year}, ${hour}:${minute}`;
  } catch {
    return iso;
  }
}

/** HH:MM nunha zona (para check-in / avisos). */
export function formatTimeHm(
  isoOrDate: string | Date,
  timeZone: string = DEFAULT_DISPLAY_TIMEZONE,
): string {
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("gl-ES", {
      timeZone: timeZone || DEFAULT_DISPLAY_TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  } catch {
    return "";
  }
}

const MONTHS_SHORT_GL = [
  "xan",
  "feb",
  "mar",
  "abr",
  "mai",
  "xuñ",
  "xul",
  "ago",
  "set",
  "out",
  "nov",
  "dec",
] as const;
const MONTHS_SHORT_ES = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
] as const;

/** «31 out – 1 nov» — navegación curta da fin de semana (REVISION-18 T6). */
export function formatWeekendRangeShort(
  satIso: string,
  sunIso: string,
  locale: string = "gl",
): string {
  const parse = (iso: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
    if (!m) return null;
    return { d: Number(m[3]), mo: Number(m[2]) };
  };
  const a = parse(satIso);
  const b = parse(sunIso);
  if (!a || !b) return `${satIso} – ${sunIso}`;
  const es = locale.toLowerCase().startsWith("es");
  const months = es ? MONTHS_SHORT_ES : MONTHS_SHORT_GL;
  const left = `${a.d} ${months[a.mo - 1]}`;
  const right = `${b.d} ${months[b.mo - 1]}`;
  return `${left} – ${right}`;
}

/**
 * Instant → «enviada hoxe ás 17:24» / «enviada o 29/10 ás 17:24» (Europe/Madrid).
 * REVISION-18 T4.
 */
export function formatSentAt(
  iso: string,
  locale: string = "gl",
  timeZone: string = DEFAULT_DISPLAY_TIMEZONE,
  now: Date = new Date(),
): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const tz = timeZone || DEFAULT_DISPLAY_TIMEZONE;
  const es = locale.toLowerCase().startsWith("es");
  const hm = formatTimeHm(d, tz);
  const dayFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dayIso = dayFmt.format(d);
  const todayIso = dayFmt.format(now);
  if (dayIso === todayIso) {
    return es ? `enviada hoy a las ${hm}` : `enviada hoxe ás ${hm}`;
  }
  const [y, mo, day] = dayIso.split("-");
  const short = `${day}/${mo}${y === todayIso.slice(0, 4) ? "" : `/${y}`}`;
  return es ? `enviada el ${short} a las ${hm}` : `enviada o ${short} ás ${hm}`;
}
