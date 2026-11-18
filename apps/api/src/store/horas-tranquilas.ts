/**
 * Horas tranquilas — ocupación media das últimas semanas (regra estatística, sen IA).
 * Alinhado co KPI do panel: franxas con &lt;30% de ocupación.
 * Só amosa horas **futuras** do día que se está a ver (máx. 3).
 */
import { addDaysIso, DEFAULT_TIMEZONE } from "./business-rules.js";
import { getMunicipalityById, listSlots } from "./db.js";

const WEEKS = 4;
const MAX_OCCUPANCY_PCT = 30;
const MIN_SAMPLES_PER_HOUR = 3;
const MAX_HOURS = 3;

export function quietHoursDateTo(today: string, viewDate?: string): string {
  const tomorrow = addDaysIso(today, 1);
  return viewDate && viewDate > tomorrow ? viewDate : tomorrow;
}

export type HorasTranquilasResult = {
  hours: string[];
  /** Día ao que se refiren as horas (viewDate, ou mañá se hoxe xa pechou na portada). */
  date: string;
  weeks: number;
  maxOccupancyPct: number;
};

function localNowParts(tz: string): { date: string; hm: string } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const hm = `${parts.hour}:${parts.minute}`;
  return { date, hm };
}

function rankQuietStarts(
  slots: { date: string; start: string; closed?: boolean; occupied?: boolean }[],
  from: string,
  before: string,
): string[] {
  const inRange = slots.filter((s) => s.date >= from && s.date < before && !s.closed);
  const byStart = new Map<string, { total: number; busy: number }>();
  for (const s of inRange) {
    const agg = byStart.get(s.start) ?? { total: 0, busy: 0 };
    agg.total += 1;
    if (s.occupied) agg.busy += 1;
    byStart.set(s.start, agg);
  }

  const ranked = [...byStart.entries()]
    .map(([start, { total, busy }]) => ({
      start,
      occupancyPct: total ? Math.round((busy / total) * 100) : 0,
      total,
    }))
    .filter((x) => x.total >= MIN_SAMPLES_PER_HOUR)
    .sort((a, b) => a.occupancyPct - b.occupancyPct || a.start.localeCompare(b.start));

  const underThreshold = ranked.filter((x) => x.occupancyPct <= MAX_OCCUPANCY_PCT);
  return (underThreshold.length ? underThreshold : ranked).map((x) => x.start);
}

/** REVISION-17 R8: só horas libres (e futuras) do día que se amosa. */
function freeStartsOnDate(
  slots: { date: string; start: string; closed?: boolean; occupied?: boolean }[],
  viewDate: string,
): Set<string> {
  return new Set(
    slots
      .filter((s) => s.date === viewDate && !s.closed && !s.occupied)
      .map((s) => s.start),
  );
}

function forViewDate(
  ranked: string[],
  viewDate: string,
  today: string,
  nowHm: string,
  freeStarts: Set<string>,
): string[] {
  const freeQuiet = ranked.filter((h) => freeStarts.has(h));
  if (viewDate > today) return freeQuiet.slice(0, MAX_HOURS);
  if (viewDate < today) return [];
  return freeQuiet.filter((h) => h > nowHm).slice(0, MAX_HOURS);
}

export async function horasTranquilas(
  municipalityId: string,
  facilityId?: string,
  /** Día que se está a ver (Reservar). Se omitido: hoxe, ou mañá se xa pechou. */
  viewDate?: string,
): Promise<HorasTranquilasResult> {
  const muni = await getMunicipalityById(municipalityId);
  const tz = muni?.settings.timezone ?? DEFAULT_TIMEZONE;
  const { date: today, hm: nowHm } = localNowParts(tz);
  const from = addDaysIso(today, -7 * WEEKS);
  /* O rango inclúe sempre o día consultado, tamén se está máis alá de mañá. */
  const to = quietHoursDateTo(today, viewDate);
  const slots = await listSlots({
    municipalityId,
    facilityId,
    dateFrom: from,
    dateTo: to,
  });
  const ranked = rankQuietStarts(slots, from, today);

  if (viewDate) {
    const hours = forViewDate(
      ranked,
      viewDate,
      today,
      nowHm,
      freeStartsOnDate(slots, viewDate),
    );
    return {
      hours,
      date: viewDate,
      weeks: WEEKS,
      maxOccupancyPct: MAX_OCCUPANCY_PCT,
    };
  }

  const todayFuture = forViewDate(
    ranked,
    today,
    today,
    nowHm,
    freeStartsOnDate(slots, today),
  );
  if (todayFuture.length > 0) {
    return {
      hours: todayFuture,
      date: today,
      weeks: WEEKS,
      maxOccupancyPct: MAX_OCCUPANCY_PCT,
    };
  }

  const tomorrow = addDaysIso(today, 1);
  const tomorrowHours = forViewDate(
    ranked,
    tomorrow,
    today,
    nowHm,
    freeStartsOnDate(slots, tomorrow),
  );
  return {
    hours: tomorrowHours,
    date: tomorrowHours.length > 0 ? tomorrow : today,
    weeks: WEEKS,
    maxOccupancyPct: MAX_OCCUPANCY_PCT,
  };
}
