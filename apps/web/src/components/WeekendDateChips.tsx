import { useTranslation } from "react-i18next";
import { formatDayChip } from "../lib/format-date";

/** Chips sáb/dom da fin de semana (REVISION-18 T4 — sen input date americano). */
export function WeekendDateChips({
  saturday,
  sunday,
  value,
  onChange,
  label,
}: {
  saturday: string;
  sunday: string;
  value: string;
  onChange: (iso: string) => void;
  label?: string;
}) {
  const { t, i18n } = useTranslation();
  const days = [
    { iso: saturday, key: "sat" as const },
    { iso: sunday, key: "sun" as const },
  ].filter((d) => Boolean(d.iso));

  return (
    <fieldset className="m-0 border-0 p-0">
      {label ? (
        <legend className="mb-1.5 text-sm font-bold text-marino">{label}</legend>
      ) : null}
      <div className="flex flex-wrap gap-2" role="group" aria-label={label ?? t("clubs.matchDate")}>
        {days.map((d) => {
          const on = value === d.iso;
          return (
            <button
              key={d.iso}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(d.iso)}
              className={`pa-ui-interactive min-h-11 rounded-btn border-[1.5px] px-3.5 text-sm font-extrabold ${
                on
                  ? "border-azul bg-azul text-on-dark pa-ui-interactive-on-dark"
                  : "border-line bg-surface text-marino hover:border-marino"
              }`}
            >
              {formatDayChip(d.iso, i18n.language)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
