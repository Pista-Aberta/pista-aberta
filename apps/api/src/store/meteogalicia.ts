/**
 * TANDA-1 / REVISION-40 N3 — previsión MeteoGalicia por INE (sen clave).
 * GET jsonPredConcellos.action?idConc=&request_locale=
 * Caché 1 h / INE; timeout 3 s → null.
 * Liña sempre en outdoor («Tarde: chuvascos, 14 °C») + avisos en palabras
 * (vento / treboada / calor / xeada). Códigos ceo/vento oficiais MeteoGalicia.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CACHE_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3_000;
const BASE =
  "https://servizos.meteogalicia.gal/mgrss/predicion/jsonPredConcellos.action";

/** Limiar vento forte (códigos 317–324) / moi forte (325–332). */
const WIND_STRONG_MIN = 317;
/** Calor (°C) no período ou tMax. */
const HEAT_C = 35;
/** Xeada (°C) no período ou tMin. */
const FROST_C = 0;

export type MeteoPeriod = "manha" | "tarde" | "noite";

export type MeteoDayForecast = {
  date: string;
  rainChance: Record<MeteoPeriod, number>;
  skyCode: Record<MeteoPeriod, number>;
  windCode: Record<MeteoPeriod, number>;
  tMaxPeriod: Record<MeteoPeriod, number | null>;
  tMinPeriod: Record<MeteoPeriod, number | null>;
  tMax: number | null;
  tMin: number | null;
};

export type MeteoForecast = {
  ine: string;
  locale: "gl" | "es";
  fetchedAt: string;
  days: MeteoDayForecast[];
};

export type MeteoHazardKind = "vento" | "treboada" | "calor" | "xeada";

export type MeteoHazard = {
  kind: MeteoHazardKind;
  text: string;
};

export type MeteoPeriodSummary = {
  period: MeteoPeriod;
  line: string;
  skyCode: number;
  skyLabel: string;
  tempC: number | null;
  windCode: number;
  hazards: MeteoHazard[];
  /** Compat: choiva ≥ limiar (aínda útil para correos). */
  rainWarning: { period: MeteoPeriod; chance: number } | null;
};

type CacheEntry = { expires: number; value: MeteoForecast | null };

const cache = new Map<string, CacheEntry>();

function cacheKey(ine: string, locale: string): string {
  return `${ine}:${locale}`;
}

function asPeriodMap(
  raw: Record<string, unknown> | null | undefined,
): Record<MeteoPeriod, number> {
  const src = raw ?? {};
  return {
    manha: Number(src.manha ?? 0) || 0,
    tarde: Number(src.tarde ?? 0) || 0,
    noite: Number(src.noite ?? 0) || 0,
  };
}

function asPeriodTempMap(
  raw: Record<string, unknown> | null | undefined,
): Record<MeteoPeriod, number | null> {
  const src = raw ?? {};
  const one = (v: unknown): number | null => {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n) || n <= -9000) return null;
    return n;
  };
  return {
    manha: one(src.manha),
    tarde: one(src.tarde),
    noite: one(src.noite),
  };
}

/** Parsea a resposta oficial (ou fixture). */
export function parseMeteoGaliciaJson(
  raw: unknown,
  ine: string,
  locale: "gl" | "es",
): MeteoForecast | null {
  if (!raw || typeof raw !== "object") return null;
  const pred = (raw as { predConcello?: unknown }).predConcello;
  if (!pred || typeof pred !== "object") return null;
  const lista = (pred as { listaPredDiaConcello?: unknown })
    .listaPredDiaConcello;
  if (!Array.isArray(lista) || lista.length === 0) return null;

  const days: MeteoDayForecast[] = [];
  for (const row of lista) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const dataPred = String(r.dataPredicion ?? "");
    const date = dataPred.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const pchoiva = asPeriodMap(
      r.pchoiva as Record<string, unknown> | undefined,
    );
    const ceo = asPeriodMap(r.ceo as Record<string, unknown> | undefined);
    const vento = asPeriodMap(r.vento as Record<string, unknown> | undefined);
    days.push({
      date,
      rainChance: pchoiva,
      skyCode: ceo,
      windCode: vento,
      tMaxPeriod: asPeriodTempMap(
        r.tmaxFranxa as Record<string, unknown> | undefined,
      ),
      tMinPeriod: asPeriodTempMap(
        r.tminFranxa as Record<string, unknown> | undefined,
      ),
      tMax: typeof r.tMax === "number" ? r.tMax : null,
      tMin: typeof r.tMin === "number" ? r.tMin : null,
    });
  }
  if (!days.length) return null;
  return {
    ine,
    locale,
    fetchedAt: new Date().toISOString(),
    days,
  };
}

export function clearMeteoCache(): void {
  cache.clear();
}

/** Carga fixture local (tests). */
export function loadMeteoFixture(_ine = "32078"): unknown {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, "fixtures", `meteogalicia-exemplo.json`);
  return JSON.parse(readFileSync(path, "utf8"));
}

/** INE desde settings.ineCode (gardado na alta / setup / migración). */
export function resolveMunicipalityIne(muni: {
  slug?: string;
  settings?: { ineCode?: string; ine?: string };
}): string | null {
  const fromSettings =
    muni.settings?.ineCode?.trim() || muni.settings?.ine?.trim() || "";
  if (/^\d{5}$/.test(fromSettings)) return fromSettings;
  return null;
}

/**
 * Previsión por código INE. Timeout 3 s → null. Caché 1 h.
 */
export async function fetchMeteoGalicia(
  ine: string,
  locale: "gl" | "es" = "gl",
  opts?: { force?: boolean; fetcher?: typeof fetch },
): Promise<MeteoForecast | null> {
  const code = String(ine).replace(/\D/g, "");
  if (!code) return null;
  const key = cacheKey(code, locale);
  const hit = cache.get(key);
  if (!opts?.force && hit && hit.expires > Date.now()) {
    return hit.value;
  }

  const url = `${BASE}?idConc=${encodeURIComponent(code)}&request_locale=${locale}`;
  const doFetch = opts?.fetcher ?? fetch;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await doFetch(url, {
      signal: ac.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      cache.set(key, { expires: Date.now() + 60_000, value: null });
      return null;
    }
    const json = await res.json();
    const parsed = parseMeteoGaliciaJson(json, code, locale);
    cache.set(key, {
      expires: Date.now() + CACHE_TTL_MS,
      value: parsed,
    });
    return parsed;
  } catch {
    cache.set(key, { expires: Date.now() + 60_000, value: null });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** True se a instalación é ao aire libre (outdoor). */
export function facilityIsOutdoor(facility: {
  outdoor?: boolean | null;
  type?: string;
}): boolean {
  if (facility.outdoor === true) return true;
  if (facility.outdoor === false) return false;
  /* Heurística: pista/campo ao aire; pavillon/sala cubertos. */
  return facility.type === "pista" || facility.type === "campo";
}

export function periodForStart(startHm: string): MeteoPeriod {
  const hour = Number(String(startHm).slice(0, 2));
  if (hour < 14) return "manha";
  if (hour < 20) return "tarde";
  return "noite";
}

/** Etiqueta do ceo (códigos día 101–125 / noite 201–225). */
export function skyLabelForCode(
  code: number,
  locale: "gl" | "es" = "gl",
): string {
  const day = code >= 200 && code < 300 ? code - 100 : code;
  const gl: Record<number, string> = {
    101: "despexado",
    102: "nubes altas",
    103: "nubes e claros",
    104: "nubrado",
    105: "moi nubrado",
    106: "néboas",
    107: "chuvascos",
    108: "chuvascos",
    109: "chuvascos con neve",
    110: "orballo",
    111: "choiva",
    112: "neve",
    113: "treboada",
    114: "brétema",
    115: "bancos de néboa",
    116: "nubes medias",
    117: "choiva feble",
    118: "choiva",
    119: "choiva",
    120: "choiva intensa",
    121: "saraiba",
    122: "chuvascos febles",
    123: "nubrado con neve",
    124: "calima",
    125: "nubrado",
  };
  const es: Record<number, string> = {
    101: "despejado",
    102: "nubes altas",
    103: "nubes y claros",
    104: "nublado",
    105: "muy nublado",
    106: "nieblas",
    107: "chubascos",
    108: "chubascos",
    109: "chubascos con nieve",
    110: "llovizna",
    111: "lluvia",
    112: "nieve",
    113: "tormenta",
    114: "bruma",
    115: "bancos de niebla",
    116: "nubes medias",
    117: "lluvia débil",
    118: "lluvia",
    119: "lluvia",
    120: "lluvia intensa",
    121: "granizo",
    122: "chubascos débiles",
    123: "nublado con nieve",
    124: "calima",
    125: "nublado",
  };
  const map = locale === "es" ? es : gl;
  return map[day] ?? (locale === "es" ? "variable" : "variable");
}

function periodWord(period: MeteoPeriod, locale: "gl" | "es"): string {
  if (locale === "es") {
    return period === "manha" ? "Mañana" : period === "tarde" ? "Tarde" : "Noche";
  }
  return period === "manha" ? "Mañá" : period === "tarde" ? "Tarde" : "Noite";
}

function hazardText(kind: MeteoHazardKind, locale: "gl" | "es"): string {
  const gl: Record<MeteoHazardKind, string> = {
    vento: "Vento forte",
    treboada: "Treboada",
    calor: "Calor intensa",
    xeada: "Risco de xeada",
  };
  const es: Record<MeteoHazardKind, string> = {
    vento: "Viento fuerte",
    treboada: "Tormenta",
    calor: "Calor intensa",
    xeada: "Riesgo de helada",
  };
  return (locale === "es" ? es : gl)[kind];
}

/** Aviso se a probabilidade de choiva no período ≥ limiar. */
export function rainWarningForSlot(
  forecast: MeteoForecast | null,
  date: string,
  startHm: string,
  threshold = 40,
): { period: MeteoPeriod; chance: number } | null {
  if (!forecast) return null;
  const day = forecast.days.find((d) => d.date === date);
  if (!day) return null;
  const period = periodForStart(startHm);
  const chance = day.rainChance[period] ?? 0;
  if (chance < threshold) return null;
  return { period, chance };
}

/**
 * Resumo do período para UI outdoor: liña sempre + avisos en palabras.
 */
export function periodSummaryForSlot(
  forecast: MeteoForecast | null,
  date: string,
  startHm: string,
  locale: "gl" | "es" = "gl",
): MeteoPeriodSummary | null {
  if (!forecast) return null;
  const day = forecast.days.find((d) => d.date === date);
  if (!day) return null;
  const period = periodForStart(startHm);
  const skyCode = day.skyCode[period] ?? 0;
  const skyLabel = skyLabelForCode(skyCode, locale);
  const tempC =
    day.tMaxPeriod[period] ??
    (period === "noite" ? day.tMinPeriod[period] : null) ??
    day.tMax;
  const windCode = day.windCode[period] ?? 0;
  const periodLabel = periodWord(period, locale);
  const tempPart =
    tempC != null && Number.isFinite(tempC) ? `, ${Math.round(tempC)} °C` : "";
  const line = `${periodLabel}: ${skyLabel}${tempPart}`;

  const hazards: MeteoHazard[] = [];
  const skyDay = skyCode >= 200 && skyCode < 300 ? skyCode - 100 : skyCode;
  if (skyDay === 113 || skyDay === 121) {
    hazards.push({
      kind: "treboada",
      text: hazardText("treboada", locale),
    });
  }
  if (windCode >= WIND_STRONG_MIN) {
    hazards.push({ kind: "vento", text: hazardText("vento", locale) });
  }
  const heatRef = day.tMaxPeriod[period] ?? day.tMax;
  if (heatRef != null && heatRef >= HEAT_C) {
    hazards.push({ kind: "calor", text: hazardText("calor", locale) });
  }
  const frostRef = day.tMinPeriod[period] ?? day.tMin;
  if (frostRef != null && frostRef <= FROST_C) {
    hazards.push({ kind: "xeada", text: hazardText("xeada", locale) });
  }

  return {
    period,
    line,
    skyCode,
    skyLabel,
    tempC: tempC ?? null,
    windCode,
    hazards,
    rainWarning: rainWarningForSlot(forecast, date, startHm),
  };
}
