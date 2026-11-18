import { useCallback, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { useSession } from "../context/SessionContext";
import { Button } from "./ui";

const WARN_MS = 2 * 60 * 1000;

/**
 * WCAG 2.2.1 — aviso 2 min antes de caducar a sesión.
 * Seguir → POST /auth/renovar; Saír → logout + acceso con returnTo.
 */
export function SessionExpiryDialog() {
  const { t } = useTranslation();
  const loc = useLocation();
  const { user, sessionExpiresAt, renewSession, logout } = useSession();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const titleId = useId();

  useEffect(() => {
    if (!user || !sessionExpiresAt) {
      setOpen(false);
      return;
    }
    const expiresMs = new Date(sessionExpiresAt).getTime();
    const delay = expiresMs - Date.now() - WARN_MS;
    if (delay <= 0) {
      setOpen(true);
      return;
    }
    setOpen(false);
    const timer = window.setTimeout(() => setOpen(true), delay);
    return () => window.clearTimeout(timer);
  }, [user, sessionExpiresAt]);

  const onStay = useCallback(async () => {
    setBusy(true);
    try {
      const ok = await renewSession();
      if (ok) setOpen(false);
    } finally {
      setBusy(false);
    }
  }, [renewSession]);

  const onLeave = useCallback(async () => {
    setBusy(true);
    try {
      await logout();
      const returnTo = `${loc.pathname}${loc.search}`;
      window.location.href = `/acceso?returnTo=${encodeURIComponent(returnTo)}&aviso=sesion`;
    } finally {
      setBusy(false);
    }
  }, [logout, loc.pathname, loc.search]);

  if (!open || !user) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-[rgba(0,43,74,0.45)] p-4 sm:items-center"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="pa-card w-full max-w-md p-6 shadow-lg">
        <h2 id={titleId} className="m-0 text-xl font-extrabold text-marino">
          {t("session.expiryTitle")}
        </h2>
        <p className="mt-2 m-0 text-graphite">{t("session.expiryBody")}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button
            type="button"
            disabled={busy}
            autoFocus
            onClick={() => void onStay()}
          >
            {t("session.stay")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => void onLeave()}
          >
            {t("session.leave")}
          </Button>
        </div>
      </div>
    </div>
  );
}
