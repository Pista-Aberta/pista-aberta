import { useCallback, useEffect, useState } from "react";
import {
  detectInstallAppState,
  INSTALL_DISMISS_DAYS,
  INSTALL_DISMISS_KEY,
  INSTALL_MARK_KEY,
  isInstallDismissed,
  type InstallAppState,
} from "../lib/install-app-detect";

export type BeforeInstallPromptEventLike = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

declare global {
  interface Window {
    __paInstallPrompt?: BeforeInstallPromptEventLike | null;
  }
}

function readDismissUntil(): number | null {
  try {
    const raw = localStorage.getItem(INSTALL_DISMISS_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function readMarkedInstalled(): boolean {
  try {
    return localStorage.getItem(INSTALL_MARK_KEY) === "1";
  } catch {
    return false;
  }
}

function matchDisplayMode(): string | undefined {
  if (typeof window === "undefined" || !window.matchMedia) return undefined;
  if (window.matchMedia("(display-mode: standalone)").matches) {
    return "standalone";
  }
  if (window.matchMedia("(display-mode: fullscreen)").matches) {
    return "fullscreen";
  }
  if (window.matchMedia("(display-mode: minimal-ui)").matches) {
    return "minimal-ui";
  }
  return "browser";
}

function computeState(): InstallAppState {
  const nav = typeof navigator !== "undefined" ? navigator : null;
  return detectInstallAppState({
    userAgent: nav?.userAgent ?? "",
    displayMode: matchDisplayMode(),
    iosStandalone: Boolean(
      (nav as Navigator & { standalone?: boolean } | null)?.standalone,
    ),
    hasInstallPrompt: Boolean(
      typeof window !== "undefined" && window.__paInstallPrompt,
    ),
    markedInstalled: readMarkedInstalled(),
  });
}

export function useInstallApp() {
  const [state, setState] = useState<InstallAppState>(() =>
    typeof window === "undefined" ? "none" : computeState(),
  );
  const [dismissed, setDismissed] = useState(() =>
    typeof window === "undefined"
      ? false
      : isInstallDismissed(Date.now(), readDismissUntil()),
  );
  const [iosOpen, setIosOpen] = useState(false);

  const refresh = useCallback(() => {
    setState(computeState());
    setDismissed(isInstallDismissed(Date.now(), readDismissUntil()));
  }, []);

  useEffect(() => {
    refresh();
    const onInstallable = () => refresh();
    const onInstalled = () => {
      try {
        localStorage.setItem(INSTALL_MARK_KEY, "1");
      } catch {
        /* ignore */
      }
      refresh();
    };
    window.addEventListener("pa:installable", onInstallable);
    window.addEventListener("pa:installed", onInstalled);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("pa:installable", onInstallable);
      window.removeEventListener("pa:installed", onInstalled);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [refresh]);

  const dismiss = useCallback(() => {
    const until =
      Date.now() + INSTALL_DISMISS_DAYS * 24 * 60 * 60 * 1000;
    try {
      localStorage.setItem(INSTALL_DISMISS_KEY, String(until));
    } catch {
      /* ignore */
    }
    setDismissed(true);
    setIosOpen(false);
  }, []);

  const promptInstall = useCallback(async () => {
    const ev = window.__paInstallPrompt;
    if (!ev) {
      setIosOpen(true);
      return;
    }
    try {
      await ev.prompt();
      await ev.userChoice;
    } catch {
      /* ignore */
    } finally {
      window.__paInstallPrompt = null;
      refresh();
    }
  }, [refresh]);

  const copyLink = useCallback(async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      return true;
    } catch {
      return false;
    }
  }, []);

  const visible =
    !dismissed &&
    state !== "installed" &&
    state !== "none";

  return {
    state,
    visible,
    dismissed,
    iosOpen,
    setIosOpen,
    dismiss,
    promptInstall,
    copyLink,
    refresh,
  };
}
