/** Format closure notice for facility card / ficha (REVISION-52 C2b). */

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
] as const;
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
] as const;

function parseIso(iso: string): { y: number; mo: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) };
}

function monthName(mo: number, es: boolean): string {
  return (es ? MONTHS_ES : MONTHS_GL)[mo - 1] ?? "";
}

/** «12 de novembro» ou «12 de novembro de 2027» (ano só se non é o actual). */
export function formatClosureDay(
  iso: string,
  locale: string,
  nowYear: number = new Date().getFullYear(),
): string {
  const p = parseIso(iso);
  if (!p) return iso;
  const es = locale.toLowerCase().startsWith("es");
  const month = monthName(p.mo, es);
  if (p.y === nowYear) return `${p.d} de ${month}`;
  return `${p.d} de ${month} de ${p.y}`;
}

/**
 * Rango peiche: «12 ao 13 de novembro», «12 de novembro ao 3 de decembro»,
 * ou con ano se non é o actual.
 */
export function formatClosureRange(
  fromIso: string,
  toIso: string,
  locale: string,
  nowYear: number = new Date().getFullYear(),
): string {
  const a = parseIso(fromIso);
  const b = parseIso(toIso);
  if (!a || !b) return `${fromIso} – ${toIso}`;
  const es = locale.toLowerCase().startsWith("es");
  const join = es ? "al" : "ao";
  const monthA = monthName(a.mo, es);
  const monthB = monthName(b.mo, es);

  if (fromIso === toIso) {
    return formatClosureDay(fromIso, locale, nowYear);
  }
  if (a.y === b.y && a.mo === b.mo) {
    const yearSuffix = a.y === nowYear ? "" : ` de ${a.y}`;
    return `${a.d} ${join} ${b.d} de ${monthA}${yearSuffix}`;
  }
  const left =
    a.y === nowYear
      ? `${a.d} de ${monthA}`
      : `${a.d} de ${monthA} de ${a.y}`;
  const right =
    b.y === nowYear
      ? `${b.d} de ${monthB}`
      : `${b.d} de ${monthB} de ${b.y}`;
  return `${left} ${join} ${right}`;
}

export function closureNoticeText(
  c: {
    startsAt: string;
    endsAt: string;
    reason: string;
    unitId?: string | null;
    unitName?: string | null;
  },
  lang: string,
  t: (k: string, opts?: Record<string, unknown>) => string,
  _formatDateLong?: (iso: string, lang: string) => string,
): string {
  const from = c.startsAt.slice(0, 10);
  const to = c.endsAt.slice(0, 10);
  const reason = c.reason?.trim() || "—";
  const unit = c.unitName?.trim() || "";
  const range = formatClosureRange(from, to, lang);
  const sameDay = from === to;

  if (unit) {
    return sameDay
      ? t("facility.closureNoticeUnitSameDay", {
          unit,
          day: range,
          reason,
          defaultValue: `Peche en ${unit} o ${range}: ${reason}`,
        })
      : t("facility.closureNoticeUnit", {
          unit,
          range,
          reason,
          defaultValue: `Peche en ${unit} do ${range}: ${reason}`,
        });
  }
  return sameDay
    ? t("facility.closureNoticeSameDay", {
        day: range,
        reason,
      })
    : t("facility.closureNotice", {
        from: range,
        to: "",
        range,
        reason,
      });
}
