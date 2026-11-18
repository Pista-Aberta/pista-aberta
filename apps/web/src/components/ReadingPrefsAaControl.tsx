import { useTranslation } from "react-i18next";
import { PrefsBar } from "./PrefsBar";
import { useReadingPrefs } from "../hooks/useReadingPrefs";

/** Botón «Aa» + panel (Rev25 C9 — portada/acceso/alta como a app). */
export function ReadingPrefsAaControl({
  variant = "onLight",
  className = "",
}: {
  variant?: "onLight" | "onBrand";
  className?: string;
}) {
  const { t } = useTranslation();
  const prefs = useReadingPrefs();

  return (
    <div className={className}>
      <button
        type="button"
        className={`flex h-11 min-w-11 items-center justify-center rounded-[10px] font-bold ${
          variant === "onLight"
            ? "border-[1.5px] border-border2 text-ink"
            : "border-[1.5px] border-white/60 text-white"
        }`}
        aria-expanded={prefs.aaOpen}
        aria-label={t("a11y.prefs")}
        onClick={() => prefs.setAaOpen((v) => !v)}
      >
        Aa
      </button>
      {prefs.aaOpen ? (
        <div
          className={`mt-2 rounded-card border px-3 py-3 ${
            variant === "onLight" ? "border-line bg-surface" : "border-white/20 bg-marino"
          }`}
        >
          <PrefsBar
            variant={variant}
            contrast={prefs.contrast}
            textStep={prefs.textStep}
            onContrast={() => prefs.setContrast((v) => !v)}
            onTextCycle={prefs.cycleText}
          />
        </div>
      ) : null}
    </div>
  );
}
