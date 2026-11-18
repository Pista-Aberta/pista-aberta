/** REVISION-47 W3 / REVISION-48 Y2·Y7 — helpers do panel de mover partido. */

import {
  DEFAULT_TIMEZONE,
  isSlotInPast,
} from "@pista-aberta/shared";

export type MoveMatchLike = {
  id: string;
  date: string;
  start: string;
  end: string;
  unit: string;
  unitId?: string;
  homeTeam: string;
  awayTeam: string;
  status?: string;
};

export type MoveUnitLike = {
  id: string;
  name: string;
  incompatibleWith?: string[];
};

export type HourWindow = { open: string; close: string };

export function hmToMin(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function minToHm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function matchDurationMin(m: { start: string; end: string }): number {
  return Math.max(15, hmToMin(m.end) - hmToMin(m.start));
}

/**
 * REVISION-48 Y7 — Completa / Media A / B a partir de `incompatibleWith`,
 * non polo nome («Pista B1» / «Sala A» fallarían).
 */
export function unitKind(
  unitIdOrName: string,
  units?: MoveUnitLike[],
): "full" | "a" | "b" | "other" {
  if (units && units.length > 0) {
    const byId = new Map(units.map((u) => [u.id, u]));
    let u = byId.get(unitIdOrName);
    if (!u) {
      u = units.find(
        (x) =>
          x.name === unitIdOrName ||
          x.name.endsWith(unitIdOrName) ||
          x.name.includes(unitIdOrName),
      );
    }
    if (!u) return "other";
    const inc = u.incompatibleWith ?? [];
    if (inc.length >= 2) return "full";
    const parent = inc
      .map((id) => byId.get(id))
      .find((p) => (p?.incompatibleWith?.length ?? 0) >= 2);
    if (parent) {
      const halves = [...(parent.incompatibleWith ?? [])]
        .filter((id) => byId.has(id))
        .sort();
      const idx = halves.indexOf(u.id);
      if (idx === 0) return "a";
      if (idx === 1) return "b";
    }
    return "other";
  }
  /* Fallback legado (sen lista de unidades). */
  const name = unitIdOrName.toLowerCase();
  if (name.includes("completa") || name.includes("full")) return "full";
  if (/\ba\b/.test(name) || name.includes("media pista a") || name.endsWith(" a") || name.includes("media a")) {
    return "a";
  }
  if (/\bb\b/.test(name) || name.includes("media pista b") || name.endsWith(" b") || name.includes("media b")) {
    return "b";
  }
  return "other";
}

/** Etiqueta curta Completa / Media A / Media B. */
export function unitShortLabel(
  unit: string,
  t?: (k: string) => string,
  units?: MoveUnitLike[],
): string {
  const k = unitKind(unit, units);
  if (k === "full") return t?.("admin.unitCompleta") ?? "Completa";
  if (k === "a") return t?.("admin.unitMediaA") ?? "Media A";
  if (k === "b") return t?.("admin.unitMediaB") ?? "Media B";
  return unit;
}

function unitsConflict(
  aId: string,
  bId: string,
  units: MoveUnitLike[],
): boolean {
  if (aId === bId) return true;
  const a = units.find((u) => u.id === aId);
  const b = units.find((u) => u.id === bId);
  if (!a || !b) {
    /* Sen mapa: non asumir choque. */
    return aId === bId;
  }
  const aInc = a.incompatibleWith ?? [];
  const bInc = b.incompatibleWith ?? [];
  return aInc.includes(bId) || bInc.includes(aId);
}

function resolveUnitId(
  m: MoveMatchLike,
  units: MoveUnitLike[],
): string | undefined {
  if (m.unitId && units.some((u) => u.id === m.unitId)) return m.unitId;
  const hit = units.find(
    (u) =>
      u.name === m.unit ||
      u.name.endsWith(m.unit) ||
      u.name.includes(m.unit),
  );
  return hit?.id;
}

/** REVISION-48 Y7 — pasado segundo Europe/Madrid (shared). */
export function matchIsPast(
  m: { date: string; end: string },
  now: Date | number = new Date(),
  timeZone: string = DEFAULT_TIMEZONE,
): boolean {
  const when = typeof now === "number" ? new Date(now) : now;
  return isSlotInPast(m.date, m.end, when, timeZone);
}

/**
 * Franxas libres onde cabe o partido enteiro dentro dos tramos
 * reais de apertura desa data, sen solapar unidades incompatíbeis.
 * REVISION-49 Z7 — ata 3 por día, só en punto ou e media (:00 / :30),
 * repartidas entre os días (incl. domingo).
 */
export function freeSlotStarts(opts: {
  matches: MoveMatchLike[];
  selected: MoveMatchLike;
  days: string[];
  unitLabel?: string;
  unitId?: string;
  units?: MoveUnitLike[];
  /** Tramos de apertura por data (horario real). */
  windowsByDate?: Record<string, HourWindow[]>;
  /** Fallback dun só tramo (legado). */
  openHm?: string;
  closeHm?: string;
  limit?: number;
  /** Máximo por día (defecto 3). */
  perDay?: number;
}): Array<{ date: string; start: string; end: string }> {
  const units = opts.units ?? [];
  const wantId =
    opts.unitId ??
    resolveUnitId(
      { ...opts.selected, unit: opts.unitLabel ?? opts.selected.unit },
      units,
    );
  const dur = matchDurationMin(opts.selected);
  const out: Array<{ date: string; start: string; end: string }> = [];
  const limit = opts.limit ?? 8;
  const perDay = opts.perDay ?? 3;

  const selectedId = resolveUnitId(opts.selected, units);

  for (const date of opts.days) {
    if (out.length >= limit) break;
    const windows =
      opts.windowsByDate?.[date] ??
      (opts.openHm && opts.closeHm
        ? [{ open: opts.openHm, close: opts.closeHm }]
        : [{ open: "09:00", close: "14:00" }]);

    const daySlots: Array<{ date: string; start: string; end: string }> = [];
    for (const win of windows) {
      const open = hmToMin(win.open);
      const close = hmToMin(win.close);
      /* Só :00 e :30 (REVISION-49 Z7). */
      const first = open % 30 === 0 ? open : open + (30 - (open % 30));
      for (let start = first; start + dur <= close; start += 30) {
        const end = start + dur;
        const startHm = minToHm(start);
        const endHm = minToHm(end);
        /* Non suxerir a franxa actual exacta na mesma unidade. */
        if (
          date === opts.selected.date &&
          startHm === opts.selected.start &&
          (!wantId || !selectedId || wantId === selectedId)
        ) {
          continue;
        }
        const clash = opts.matches.some((m) => {
          if (m.id === opts.selected.id) return false;
          if (m.date !== date) return false;
          if (m.status === "cancelled") return false;
          if (!(hmToMin(m.start) < end && start < hmToMin(m.end))) return false;
          if (wantId && units.length > 0) {
            const otherId = resolveUnitId(m, units);
            if (!otherId) return false;
            return unitsConflict(wantId, otherId, units);
          }
          const wantKind = unitKind(opts.unitLabel ?? opts.selected.unit, units);
          const otherKind = unitKind(m.unit, units);
          if (wantKind === "other" || otherKind === "other") {
            return wantKind === otherKind;
          }
          if (wantKind === "full" || otherKind === "full") return true;
          return wantKind === otherKind;
        });
        if (clash) continue;
        daySlots.push({ date, start: startHm, end: endHm });
      }
    }
    /* Repartir: espazar as suxestións do día (principio / medio / final). */
    const picked: typeof daySlots = [];
    if (daySlots.length <= perDay) {
      picked.push(...daySlots);
    } else {
      for (let i = 0; i < perDay; i++) {
        const idx = Math.round((i * (daySlots.length - 1)) / (perDay - 1));
        const slot = daySlots[idx]!;
        if (!picked.some((p) => p.start === slot.start)) picked.push(slot);
      }
    }
    for (const slot of picked) {
      out.push(slot);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** Hora+pista iguais → botón de mover desactivado. */
export function moveUnchanged(opts: {
  from: { date: string; start: string; end: string; unitId?: string; unit?: string };
  to: { date: string; start: string; end: string; unitId?: string; unit?: string };
}): boolean {
  const sameUnit =
    (opts.from.unitId && opts.to.unitId && opts.from.unitId === opts.to.unitId) ||
    (!!opts.from.unit && !!opts.to.unit && opts.from.unit === opts.to.unit) ||
    (opts.from.unitId && opts.to.unitId === opts.from.unitId);
  return (
    opts.from.date === opts.to.date &&
    opts.from.start === opts.to.start &&
    opts.from.end === opts.to.end &&
    !!sameUnit
  );
}
