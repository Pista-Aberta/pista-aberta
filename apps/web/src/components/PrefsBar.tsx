import { useTranslation } from "react-i18next";
import { ensureLocale } from "../i18n";

type Variant = "onBrand" | "onLight";

export function PrefsBar({
  variant = "onBrand",
  contrast,
  textStep,
  onContrast,
  onTextCycle,
  hideLanguage,
  compact,
}: {
  variant?: Variant;
  contrast: boolean;
  textStep: string;
  onContrast: () => void;
  onTextCycle: () => void;
  hideLanguage?: boolean;
  compact?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const onBrand = variant === "onBrand";
  /* REVISION-31 B2: non mesturar text-white + text-ink (Tailwind non garante a orde). */
  const borderOnly = onBrand ? "border-white/60" : "border-border2";
  const textIdle = onBrand ? "text-white" : "text-ink";
  const activeBg = onBrand ? "bg-white text-ink" : "bg-ink text-white";
  const idle = `bg-transparent ${textIdle}`;

  const setLocale = (lng: "gl" | "es") => {
    void ensureLocale(lng).then(() => {
      document.documentElement.lang = lng;
    });
  };

  const textLabel = textStep === "100" ? "A" : textStep === "125" ? "A+" : "A++";

  return (
    <div
      className={`flex items-center gap-1.5 ${compact ? "" : ""}`}
      role="group"
      aria-label={t("a11y.prefs")}
    >
      {hideLanguage ? null : (
      <div
        role="group"
        aria-label={t("lang.label")}
        className={`flex overflow-hidden rounded-[10px] border-[1.5px] ${borderOnly} ${textIdle}`}
      >
        <button
          type="button"
          aria-pressed={i18n.language === "gl"}
          onClick={() => setLocale("gl")}
          className={`min-h-[44px] min-w-[42px] px-2 text-sm font-bold ${
            i18n.language === "gl" ? activeBg : idle
          }`}
        >
          {t("lang.gl")}
        </button>
        <button
          type="button"
          aria-pressed={i18n.language.startsWith("es")}
          onClick={() => setLocale("es")}
          className={`min-h-[44px] min-w-[42px] px-2 text-sm font-bold ${
            i18n.language.startsWith("es") ? activeBg : idle
          }`}
        >
          {t("lang.es")}
        </button>
      </div>
      )}
      <button
        type="button"
        onClick={onTextCycle}
        aria-label={`${t("a11y.text")}: ${textStep}%`}
        className={`flex h-11 min-w-11 items-center justify-center rounded-[10px] border-[1.5px] font-bold ${borderOnly} ${textIdle}`}
      >
        <span className="text-[13px] leading-none">A</span>
        <span className="text-lg leading-none">{textLabel === "A" ? "A" : textLabel.slice(1)}</span>
      </button>
      <button
        type="button"
        aria-pressed={contrast}
        aria-label={t("a11y.contrast")}
        onClick={onContrast}
        className={`flex h-11 min-w-11 items-center justify-center rounded-[10px] border-[1.5px] ${borderOnly} ${
          contrast ? activeBg : textIdle
        }`}
      >
        {/* REVISION-30 Z7 / REVISION-31 B2 — icona currentColor visible en onBrand + HC. */}
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <circle cx="12" cy="12" r="9" stroke="currentColor" />
          <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />
        </svg>
      </button>
    </div>
  );
}
