/**
 * Preferencias de avisos · REVISION-22 A4.
 * Matriz tipo × canle; notifyEmail / notifyReminders derívanse.
 */
import {
  NOTIFY_TYPES,
  defaultNotifyPrefs,
  type NotifyChannelPrefs,
  type NotifyPrefs,
  type NotifyType,
} from "@pista-aberta/shared";

export type { NotifyPrefs, NotifyType };
export { NOTIFY_TYPES, defaultNotifyPrefs };

export function normalizeNotifyPrefs(raw: unknown): NotifyPrefs {
  const base = defaultNotifyPrefs();
  if (!raw || typeof raw !== "object") return base;
  const obj = raw as Record<string, unknown>;
  for (const type of NOTIFY_TYPES) {
    const row = obj[type];
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    base[type] = {
      email: r.email !== false,
      inApp: r.inApp !== false,
    };
  }
  return base;
}

/** Deriva flags legado desde a matriz. */
export function derivedNotifyFlags(prefs: NotifyPrefs): {
  notifyEmail: boolean;
  notifyReminders: boolean;
} {
  const notifyEmail = NOTIFY_TYPES.some((t) => prefs[t].email);
  const notifyReminders = prefs.recordatorio.email || prefs.recordatorio.inApp;
  return { notifyEmail, notifyReminders };
}

/**
 * Actualiza a matriz a partir dos toggles legado (migración / PATCH antigo).
 */
export function applyLegacyToggles(
  prefs: NotifyPrefs,
  legacy: { notifyEmail?: boolean; notifyReminders?: boolean },
): NotifyPrefs {
  const next = normalizeNotifyPrefs(prefs);
  if (legacy.notifyEmail === false) {
    for (const type of NOTIFY_TYPES) next[type].email = false;
  } else if (legacy.notifyEmail === true) {
    for (const type of NOTIFY_TYPES) next[type].email = true;
  }
  if (legacy.notifyReminders === false) {
    next.recordatorio = { email: false, inApp: false };
  } else if (legacy.notifyReminders === true) {
    next.recordatorio = { email: true, inApp: true };
  }
  return next;
}

/** Desactiva todas as canles de correo (baixa nun clic). */
export function disableAllEmail(prefs: NotifyPrefs): NotifyPrefs {
  const next = normalizeNotifyPrefs(prefs);
  for (const type of NOTIFY_TYPES) next[type].email = false;
  return next;
}

export function shouldNotify(
  prefsRaw: unknown,
  type: NotifyType,
  channel: keyof NotifyChannelPrefs,
): boolean {
  const prefs = normalizeNotifyPrefs(prefsRaw);
  return prefs[type][channel] !== false;
}

/** Mapea tipo de notice BD → tipo da matriz A4. */
export function noticeTypeToNotifyType(
  noticeType: string,
): NotifyType | null {
  switch (noticeType) {
    case "reminder":
      return "recordatorio";
    case "closure":
      return "cancelacion";
    case "waitlist":
      return "praza_liberada";
    case "change":
      return "cambio";
    case "info":
      return null;
    case "open_match":
      return "partido_aberto";
    default:
      return null;
  }
}
