import { useTranslation } from "react-i18next";

export function CancelDialog({
  open,
  onClose,
  onConfirm,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(0,43,74,0.4)] p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-title"
    >
      <div className="pa-card w-full max-w-md p-6">
        <h2 id="cancel-title" className="pa-h2">
          {t("bookings.cancelTitle")}
        </h2>
        <p className="mt-2 text-graphite">{t("bookings.cancelBody")}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" className="pa-btn-danger" disabled={busy} onClick={onConfirm}>
            {t("bookings.cancelConfirm")}
          </button>
          <button type="button" className="pa-btn-secondary" onClick={onClose}>
            {t("bookings.cancelKeep")}
          </button>
        </div>
      </div>
    </div>
  );
}
