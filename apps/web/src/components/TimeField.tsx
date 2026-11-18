import { useId } from "react";
import { useTranslation } from "react-i18next";

/* REVISION-47 W3: 00–23 en pasos de 15 min (sen AM/PM). */
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = ["00", "15", "30", "45"] as const;

function parseHm(value: string): { h: string; m: string } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return { h: "09", m: "00" };
  const h = String(Math.min(23, Math.max(0, Number(m[1])))).padStart(2, "0");
  const rawM = Number(m[2]);
  const snapped =
    rawM < 8 ? "00" : rawM < 23 ? "15" : rawM < 38 ? "30" : rawM < 53 ? "45" : "00";
  const hourAdj = rawM >= 53 ? String((Number(h) + 1) % 24).padStart(2, "0") : h;
  const clampedH = HOURS.includes(hourAdj) ? hourAdj : HOURS.includes(h) ? h : "09";
  return { h: clampedH, m: snapped };
}

/** Selector HH:MM en 24 h (sen AM/PM do navegador). */
export function TimeField({
  value,
  onChange,
  className = "",
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  className?: string;
  "aria-label"?: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  const { h, m } = parseHm(value || "09:00");

  return (
    <div
      className={`inline-flex items-center gap-1 ${className}`}
      role="group"
      aria-label={ariaLabel ?? t("ui.timeField.label")}
    >
      <label className="sr-only" htmlFor={`${id}-h`}>
        {t("ui.timeField.hour")}
      </label>
      <select
        id={`${id}-h`}
        className="pa-input min-h-11 w-[4.25rem] max-w-[4.25rem] shrink-0 px-1.5 text-base tabular-nums sm:w-[4.5rem] sm:max-w-[4.5rem] sm:px-2"
        value={h}
        onChange={(e) => onChange(`${e.target.value}:${m}`)}
      >
        {HOURS.map((hh) => (
          <option key={hh} value={hh}>
            {hh}
          </option>
        ))}
      </select>
      <span className="font-extrabold text-marino" aria-hidden>
        :
      </span>
      <label className="sr-only" htmlFor={`${id}-m`}>
        {t("ui.timeField.minute")}
      </label>
      <select
        id={`${id}-m`}
        className="pa-input min-h-11 w-[4.25rem] max-w-[4.25rem] shrink-0 px-1.5 text-base tabular-nums sm:w-[4.5rem] sm:max-w-[4.5rem] sm:px-2"
        value={m}
        onChange={(e) => onChange(`${h}:${e.target.value}`)}
      >
        {MINUTES.map((mm) => (
          <option key={mm} value={mm}>
            {mm}
          </option>
        ))}
      </select>
    </div>
  );
}
