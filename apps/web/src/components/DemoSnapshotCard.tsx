import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "../context/SessionContext";
import { apiX } from "../lib/api-complete";
import { fetchPublicConfig } from "../lib/public-config";

export function DemoSnapshotCard({ className = "" }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const [demoMode, setDemoMode] = useState(
    () =>
      import.meta.env.VITE_PA_DEMO === "1" ||
      import.meta.env.VITE_PA_DEMO === "true",
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [lastSnapshotAt, setLastSnapshotAt] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [lastRestoreError, setLastRestoreError] = useState<{
    at: string;
    message: string;
  } | null>(null);

  useEffect(() => {
    void fetchPublicConfig()
      .then((c) => setDemoMode(Boolean(c.demo)))
      .catch(() => undefined);
  }, []);

  const canManage = user?.role === "superadmin" && demoMode;

  useEffect(() => {
    if (!canManage) {
      setLastSnapshotAt(null);
      setLocked(false);
      setLastRestoreError(null);
      return;
    }
    void apiX
      .demoSnapshotStatus()
      .then((r) => {
        setLastSnapshotAt(r.data.at);
        setLocked(Boolean(r.data.locked));
        setLastRestoreError(r.data.lastRestoreError ?? null);
      })
      .catch(() => {
        setLastSnapshotAt(null);
        setLocked(false);
        setLastRestoreError(null);
      });
  }, [canManage]);

  if (!canManage) return null;

  const saveSnapshot = async () => {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const r = await apiX.saveDemoSnapshot();
      setLastSnapshotAt(r.data.at);
      setMsg(t("admin.demoSnapshotOk"));
      setConfirmOpen(false);
    } catch (e: unknown) {
      const code =
        e && typeof e === "object" && "error" in e
          ? String((e as { error: string }).error)
          : "";
      if (code === "snapshot_path_unconfigured") {
        setErr(t("admin.demoSnapshotUnconfigured"));
      } else if (code === "snapshot_locked") {
        setErr(t("admin.demoSnapshotLocked"));
        setLocked(true);
      } else {
        setErr(t("common.error"));
      }
      setConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const lastSnapshotLabel = lastSnapshotAt
    ? t("admin.demoSnapshotLast", {
        when: new Date(lastSnapshotAt).toLocaleString(
          i18n.language === "es" ? "es-ES" : "gl-ES",
          { dateStyle: "short", timeStyle: "short" },
        ),
      })
    : t("admin.demoSnapshotNever");

  const restoreErrorLabel = lastRestoreError
    ? t("admin.demoSnapshotRestoreFailed", {
        when: new Date(lastRestoreError.at).toLocaleString(
          i18n.language === "es" ? "es-ES" : "gl-ES",
          { dateStyle: "short", timeStyle: "short" },
        ),
        detail: lastRestoreError.message,
      })
    : null;

  return (
    <>
      <section
        className={`rounded-[18px] border border-line bg-surface p-5 ${className}`.trim()}
        aria-labelledby="demo-snapshot-card-title"
      >
        <h2
          id="demo-snapshot-card-title"
          className="m-0 text-base font-extrabold text-marino"
        >
          {t("admin.demoSnapshot")}
        </h2>
        <p className="mt-2 text-sm text-graphite">{t("admin.demoSnapshotBody")}</p>
        <p
          className="mt-3 text-sm text-graphite"
          data-testid="demo-snapshot-last"
        >
          {lastSnapshotLabel}
        </p>
        {restoreErrorLabel ? (
          <p
            className="mt-3 text-sm font-bold text-erro"
            role="alert"
            data-testid="demo-snapshot-restore-error"
          >
            {restoreErrorLabel}
          </p>
        ) : null}
        {locked ? (
          <p className="mt-3 text-sm text-graphite" data-testid="demo-snapshot-locked">
            {t("admin.demoSnapshotLocked")}
          </p>
        ) : (
          <button
            type="button"
            className="pa-btn-primary mt-4 text-sm"
            disabled={busy}
            onClick={() => setConfirmOpen(true)}
          >
            {t("admin.demoSnapshot")}
          </button>
        )}
        {msg ? (
          <p className="mt-3 text-sm font-bold text-marino" role="status">
            {msg}
          </p>
        ) : null}
        {err ? (
          <p className="mt-3 text-sm font-bold text-erro" role="alert">
            {err}
          </p>
        ) : null}
      </section>

      {confirmOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,43,74,0.5)] p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="demo-snapshot-confirm-title"
        >
          <div className="pa-card w-full max-w-md p-6">
            <h2
              id="demo-snapshot-confirm-title"
              className="m-0 text-xl font-extrabold text-marino"
            >
              {t("admin.demoSnapshot")}
            </h2>
            <p className="mt-3 text-sm text-graphite">
              {t("admin.demoSnapshotConfirm")}
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                className="pa-btn-primary"
                disabled={busy}
                onClick={() => void saveSnapshot()}
              >
                {t("admin.demoSnapshotConfirmYes")}
              </button>
              <button
                type="button"
                className="pa-btn-secondary"
                disabled={busy}
                onClick={() => setConfirmOpen(false)}
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
