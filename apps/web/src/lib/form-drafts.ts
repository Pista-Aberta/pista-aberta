/**
 * Borradores de formulario en sessionStorage (REVISION-22 A6).
 * Restaúranse tras re-login vía returnTo.
 */

const PREFIX = "pa_draft_";
/** TTL borrador reserva/partido (2 h). */
export const RESERVE_DRAFT_TTL_MS = 2 * 60 * 60 * 1000;

export function saveFormDraft(key: string, data: unknown): void {
  try {
    sessionStorage.setItem(`${PREFIX}${key}`, JSON.stringify(data));
  } catch {
    /* quota / private mode */
  }
}

export function loadFormDraft<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(`${PREFIX}${key}`);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function clearFormDraft(key: string): void {
  try {
    sessionStorage.removeItem(`${PREFIX}${key}`);
  } catch {
    /* ignore */
  }
}

export function bookForDraftKey(slug: string): string {
  return `book_for_${slug}`;
}

export function normasDraftKey(slug: string, facilityId?: string): string {
  return facilityId ? `normas_${slug}_${facilityId}` : `normas_${slug}`;
}

/** Clave por concello + instalación + franxa (slot). */
export function reserveDraftKey(
  slug: string,
  facilityId: string,
  slotId: string,
): string {
  return `reserve_${slug}_${facilityId}_${slotId}`;
}

export type ReserveDialogDraft = {
  savedAt: number;
  unitId?: string;
  date?: string;
  slotId?: string;
  start?: string;
  mountOpenMatch?: boolean;
  omTitle?: string;
  omSport?: string;
  omSpots?: number;
  omLevel?: string;
  omNotes?: string;
};

export function saveReserveDraft(
  slug: string,
  facilityId: string,
  slotId: string,
  data: Omit<ReserveDialogDraft, "savedAt" | "slotId"> & { slotId?: string },
): void {
  saveFormDraft(reserveDraftKey(slug, facilityId, slotId), {
    ...data,
    slotId,
    savedAt: Date.now(),
  } satisfies ReserveDialogDraft);
}

/** Carga borrador; null se expirado (>2 h) ou inexistente (e borra se caducou). */
export function loadReserveDraft(
  slug: string,
  facilityId: string,
  slotId: string,
  now = Date.now(),
): ReserveDialogDraft | null {
  const key = reserveDraftKey(slug, facilityId, slotId);
  const draft = loadFormDraft<ReserveDialogDraft>(key);
  if (!draft) return null;
  if (
    typeof draft.savedAt !== "number" ||
    now - draft.savedAt > RESERVE_DRAFT_TTL_MS
  ) {
    clearFormDraft(key);
    return null;
  }
  return draft;
}

export function clearReserveDraft(
  slug: string,
  facilityId: string,
  slotId: string,
): void {
  clearFormDraft(reserveDraftKey(slug, facilityId, slotId));
}

/** Comproba TTL dun borrador xa cargado (útil en tests sen sessionStorage). */
export function isReserveDraftFresh(
  draft: { savedAt?: number } | null | undefined,
  now = Date.now(),
): boolean {
  if (!draft || typeof draft.savedAt !== "number") return false;
  return now - draft.savedAt <= RESERVE_DRAFT_TTL_MS;
}
