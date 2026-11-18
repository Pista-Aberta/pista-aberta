import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, Share } from "lucide-react";
import { useInstallApp } from "../hooks/useInstallApp";

/**
 * CTA «Engadir á pantalla de inicio» / instalar PWA.
 * Estados: prompt (Chrome), ios (Safari), inapp (copiar ligazón).
 */
export function InstallAppButton({
  className = "",
  compact = false,
}: {
  className?: string;
  /** Versión máis curta para cards densas. */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const {
    state,
    visible,
    iosOpen,
    setIosOpen,
    dismiss,
    promptInstall,
    copyLink,
  } = useInstallApp();
  const [copied, setCopied] = useState(false);

  if (!visible) return null;

  const label =
    state === "inapp"
      ? t("install.copyLink")
      : t("install.cta");

  return (
    <div className={`min-w-0 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="pa-btn-secondary inline-flex min-h-11 items-center gap-2 px-4 text-sm font-extrabold"
          onClick={() => {
            if (state === "inapp") {
              void copyLink().then((ok) => {
                setCopied(ok);
                if (ok) window.setTimeout(() => setCopied(false), 2500);
              });
              return;
            }
            if (state === "ios") {
              setIosOpen(true);
              return;
            }
            void promptInstall();
          }}
        >
          {state === "ios" ? (
            <Share size={18} strokeWidth={2.2} aria-hidden />
          ) : (
            <Download size={18} strokeWidth={2.2} aria-hidden />
          )}
          {copied ? t("install.copied") : label}
        </button>
        <button
          type="button"
          className="pa-ui-interactive min-h-11 border-0 bg-transparent px-2 text-sm font-bold text-graphite underline"
          onClick={dismiss}
        >
          {t("install.notNow")}
        </button>
      </div>
      {!compact && state === "inapp" ? (
        <p className="mt-2 m-0 text-sm text-graphite">{t("install.inappHint")}</p>
      ) : null}

      {iosOpen ? (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label={t("install.iosTitle")}
        >
          <button
            type="button"
            className="absolute inset-0 border-0 bg-transparent"
            aria-label={t("common.close")}
            onClick={() => setIosOpen(false)}
          />
          <div className="relative z-[1] w-full max-w-md rounded-[22px] bg-surface p-5 shadow-pa-sheet">
            <h2 className="m-0 text-lg font-extrabold text-marino">
              {t("install.iosTitle")}
            </h2>
            <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm text-ink">
              <li className="leading-relaxed">
                <span className="inline-flex items-center gap-2">
                  {t("install.iosStep1")}
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden
                    className="text-azul-700"
                  >
                    <path d="M12 4v10" />
                    <path d="M8 8l4-4 4 4" />
                    <path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
                  </svg>
                </span>
              </li>
              <li className="leading-relaxed">{t("install.iosStep2")}</li>
              <li className="leading-relaxed">{t("install.iosStep3")}</li>
            </ol>
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                className="pa-btn-primary min-h-11"
                onClick={() => setIosOpen(false)}
              >
                {t("common.close")}
              </button>
              <button
                type="button"
                className="pa-btn-secondary min-h-11"
                onClick={dismiss}
              >
                {t("install.notNow")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
