/**
 * Detector de estado para «Engadir á pantalla de inicio» / instalar PWA.
 * Pure + inxectable (tests sen DOM real).
 */

export type InstallAppState =
  | "installed"
  | "prompt"
  | "ios"
  | "inapp"
  | "none";

export type InstallDetectInput = {
  userAgent: string;
  /** display-mode: standalone | fullscreen | minimal-ui | browser */
  displayMode?: string;
  /** iOS Safari: navigator.standalone */
  iosStandalone?: boolean;
  /** Hai BeforeInstallPromptEvent gardado */
  hasInstallPrompt?: boolean;
  /** Marcado tras appinstalled (session/local) */
  markedInstalled?: boolean;
};

const INAPP_RE =
  /\b(FBAN|FBAV|Instagram|Line\/|Twitter|LinkedInApp|MicroMessenger|Snapchat|Pinterest|TikTok|BytedanceWebview|GSA\/)\b/i;

const IOS_RE = /iPad|iPhone|iPod/i;

export function detectInstallAppState(
  input: InstallDetectInput,
): InstallAppState {
  if (
    input.markedInstalled ||
    input.iosStandalone === true ||
    input.displayMode === "standalone" ||
    input.displayMode === "fullscreen" ||
    input.displayMode === "minimal-ui"
  ) {
    return "installed";
  }

  const ua = input.userAgent || "";
  if (INAPP_RE.test(ua)) return "inapp";
  if (input.hasInstallPrompt) return "prompt";
  if (IOS_RE.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua)) return "ios";
  return "none";
}

export function isInstallDismissed(
  nowMs: number,
  dismissedUntilMs: number | null,
): boolean {
  if (dismissedUntilMs == null || !Number.isFinite(dismissedUntilMs)) {
    return false;
  }
  return nowMs < dismissedUntilMs;
}

export const INSTALL_DISMISS_DAYS = 30;
export const INSTALL_DISMISS_KEY = "pa-install-dismiss-until";
export const INSTALL_MARK_KEY = "pa-install-marked";
