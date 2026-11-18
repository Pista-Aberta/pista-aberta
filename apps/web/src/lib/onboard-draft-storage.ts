export const ONBOARD_DRAFT_KEY = "pa_onboard_wizard_draft_v1";

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function removeLegacyDraft(legacyStorage: DraftStorage): void {
  try {
    legacyStorage.removeItem(ONBOARD_DRAFT_KEY);
  } catch {
    // Storage can be unavailable in hardened/private browser contexts.
  }
}

export function loadOnboardDraft<T>(
  fallback: () => T,
  sessionStorage: DraftStorage = window.sessionStorage,
  legacyStorage: DraftStorage = window.localStorage,
): T {
  removeLegacyDraft(legacyStorage);
  try {
    const raw = sessionStorage.getItem(ONBOARD_DRAFT_KEY);
    return raw ? { ...fallback(), ...(JSON.parse(raw) as Partial<T>) } : fallback();
  } catch {
    return fallback();
  }
}

export function saveOnboardDraft(
  draft: unknown,
  storage: DraftStorage = window.sessionStorage,
): void {
  storage.setItem(ONBOARD_DRAFT_KEY, JSON.stringify(draft));
}

export function removeOnboardDraft(
  storage: DraftStorage = window.sessionStorage,
  legacyStorage: DraftStorage = window.localStorage,
): void {
  try {
    storage.removeItem(ONBOARD_DRAFT_KEY);
  } finally {
    removeLegacyDraft(legacyStorage);
  }
}
