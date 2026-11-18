import { useEffect } from "react";
import { useTranslation } from "react-i18next";

/** Confirmacións e «… · Desfacer» (8 s). Por riba da MobileTabBar no móbil. */
export function Toast({
  message,
  actionLabel,
  onAction,
  onDismiss,
  durationMs = 8000,
  className = "",
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
  durationMs?: number;
  className?: string;
}) {
  const { t } = useTranslation();
  const undo = actionLabel ?? (onAction ? t("ui.toast.undo") : undefined);

  useEffect(() => {
    if (!onDismiss || durationMs <= 0) return;
    const id = window.setTimeout(onDismiss, durationMs);
    return () => window.clearTimeout(id);
  }, [onDismiss, durationMs]);

  return (
    <div
      role="status"
      className={[
        "pa-ui-toast-mobile fixed left-4 right-4 z-[60] mx-auto flex min-h-[52px] w-auto max-w-[420px]",
        "items-center gap-3.5 rounded-btn bg-marino px-[18px] py-3 text-[15px] font-bold text-on-dark shadow-pa",
        "md:bottom-6 md:left-1/2 md:right-auto md:w-max md:max-w-[min(420px,calc(100%-2rem))] md:-translate-x-1/2",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="flex-1">{message}</span>
      {undo && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="pa-ui-interactive pa-ui-interactive-on-dark border-0 bg-transparent p-0 font-extrabold text-[15px] text-celeste"
        >
          {undo}
        </button>
      ) : null}
    </div>
  );
}
