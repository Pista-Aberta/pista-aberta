/** Agrupa franxas libres por hora (hub / portada): «20:00 · 2 pistas». */

export type FreeHourSlot = {
  id: string;
  start: string;
  date: string;
  facilityId?: string;
  unitId?: string;
  status?: string;
};

export type GroupedFreeHour<T extends FreeHourSlot = FreeHourSlot> = {
  start: string;
  count: number;
  /** Primeira franxa (para navegar á reserva concreta). */
  primary: T;
  slots: T[];
};

/** Filtra pola unidade, ordena por hora e elimina duplicados de `start` na grella dunha unidade. */
export function slotsForUnit<T extends FreeHourSlot>(
  slots: T[],
  unitId: string | undefined,
): T[] {
  const filtered = unitId ? slots.filter((s) => !s.unitId || s.unitId === unitId) : slots;
  return [...filtered].sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
}

/** Comproba que non hai horas repetidas na grella dunha unidade. */
export function hasDuplicateHours<T extends { start: string }>(slots: T[]): boolean {
  const seen = new Set<string>();
  for (const s of slots) {
    if (seen.has(s.start)) return true;
    seen.add(s.start);
  }
  return false;
}

/** Agrupa por `start` (orde cronolóxica). */
export function groupFreeHoursByStart<T extends FreeHourSlot>(slots: T[]): GroupedFreeHour<T>[] {
  const byStart = new Map<string, T[]>();
  for (const s of slots) {
    const list = byStart.get(s.start) ?? [];
    list.push(s);
    byStart.set(s.start, list);
  }
  return [...byStart.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([start, group]) => ({
      start,
      count: group.length,
      primary: group[0]!,
      slots: group,
    }));
}

/** Etiqueta unificada Rev24 C7 / REVISION-40 T5: «20:00» ou «20:00 · 2 pistas». */
export function freeHourLabel(
  group: { start: string; count: number },
  courtOne = "pista",
  courtMany = "pistas",
  _opts?: { compact?: boolean },
): string {
  if (group.count <= 1) return group.start;
  const noun = group.count === 1 ? courtOne : courtMany;
  return `${group.start} · ${group.count} ${noun}`;
}

/** aria-label cando a etiqueta visible é só a hora. */
export function freeHourAriaLabel(
  group: { start: string; count: number },
  courtOne = "pista",
  courtMany = "pistas",
): string {
  if (group.count <= 1) return `${group.start} · 1 ${courtOne}`;
  return freeHourLabel(group, courtOne, courtMany);
}
