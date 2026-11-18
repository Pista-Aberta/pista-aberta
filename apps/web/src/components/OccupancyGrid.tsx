import { useMemo } from "react";
import { useTranslation } from "react-i18next";

type BookingLike = {
  start?: string | unknown;
  end?: string | unknown;
  date?: string | unknown;
};

function hourFromHm(value: string): number | null {
  const m = /^(\d{1,2})(?::(\d{2}))?/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  if (!Number.isFinite(h) || h < 0 || h > 23) return null;
  return h;
}

const PX_PER_HOUR = 36;
const FALLBACK_HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];

/**
 * Grella día×hora da ocupación semanal.
 * REVISION-46 V5: só horas con datos (apertura→peche) + scroll horizontal visible.
 */
export function OccupancyGrid({
  bookings,
  title,
}: {
  bookings: BookingLike[];
  title?: string;
}) {
  const { t } = useTranslation();
  const dows = [1, 2, 3, 4, 5, 6, 0]; /* Mon→Sun */

  const { occupied, hours } = useMemo(() => {
    const occ = new Set<string>();
    let minH = Number.POSITIVE_INFINITY;
    let maxH = Number.NEGATIVE_INFINITY;
    for (const b of bookings) {
      const start = String(b.start ?? "");
      const end = String(b.end ?? "");
      const date = String(b.date ?? "");
      if (!start || !date) continue;
      const d = new Date(`${date}T12:00:00`);
      if (Number.isNaN(d.getTime())) continue;
      const wd = d.getDay();
      const sh = hourFromHm(start);
      if (sh == null) continue;
      const ehRaw = hourFromHm(end || start);
      const eh = ehRaw == null ? sh + 1 : Math.max(sh + 1, ehRaw);
      minH = Math.min(minH, sh);
      maxH = Math.max(maxH, eh - 1);
      for (let h = sh; h < eh; h++) {
        if (h >= 0 && h <= 23) occ.add(`${wd}-${h}`);
      }
    }
    const hrs = Number.isFinite(minH)
      ? Array.from({ length: Math.max(1, maxH - minH + 1) }, (_, i) => minH + i)
      : FALLBACK_HOURS;
    return { occupied: occ, hours: hrs };
  }, [bookings]);

  if (occupied.size === 0) return null;

  const minWidth = Math.max(hours.length * PX_PER_HOUR + 56, 280);

  return (
    <section className="mt-6" aria-label={title ?? t("admin.occupancyTitle")}>
      <h2 className="pa-h2 text-lg">{title ?? t("admin.occupancyTitle")}</h2>
      <p className="mt-1 text-sm text-graphite">{t("admin.occupancyHint")}</p>
      <div
        className="mt-3 overflow-x-auto [-webkit-overflow-scrolling:touch]"
        role="region"
        aria-label={title ?? t("admin.occupancyTitle")}
        tabIndex={0}
      >
        <div
          className="inline-grid gap-0.5"
          style={{
            minWidth,
            gridTemplateColumns: `3.5rem repeat(${hours.length}, ${PX_PER_HOUR}px)`,
          }}
        >
          <div />
          {hours.map((h) => (
            <div
              key={`h-${h}`}
              className="pb-1 text-center text-[11px] font-bold text-graphite"
            >
              {String(h).padStart(2, "0")}
            </div>
          ))}
          {dows.map((wd) => (
            <div key={`row-${wd}`} className="contents">
              <div className="flex items-center text-xs font-bold text-graphite">
                {t(`weekdayShort.${wd}`)}
              </div>
              {hours.map((h) => {
                const on = occupied.has(`${wd}-${h}`);
                return (
                  <div
                    key={`${wd}-${h}`}
                    className={`h-7 rounded-sm border ${
                      on
                        ? "border-marino bg-marino"
                        : "border-line bg-area"
                    }`}
                    title={`${t(`dow.${wd}`)} ${String(h).padStart(2, "0")}:00`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-sm text-graphite">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-marino" />
          {t("admin.occupancyBusy")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm border border-line bg-area" />
          {t("admin.occupancyFree")}
        </span>
      </div>
    </section>
  );
}
