import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { formatDayChip, formatMonthYear } from "../lib/format-date";

export type CalendarBooking = {
  id: string;
  date: string;
  start: string;
  facilityName?: string;
  /** Ligazón a ficha de partido aberto en lugar da reserva. */
  openMatchId?: string;
  title?: string;
};

type Props = {
  slug: string;
  month: { year: number; month: number };
  onMonthChange: (next: { year: number; month: number }) => void;
  bookings: CalendarBooking[];
};

/** Iniciais GL: luns, martes, mércores, xoves, venres, sábado, domingo. */
const WEEKDAYS_GL = ["L", "M", "M", "X", "V", "S", "D"] as const;
const WEEKDAYS_ES = ["L", "M", "X", "J", "V", "S", "D"] as const;

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

/** Luns = 0 … domingo = 6 */
function mondayBasedWeekday(year: number, month: number, day: number) {
  const d = new Date(year, month - 1, day).getDay();
  return d === 0 ? 6 : d - 1;
}

export function PersonalMonthCalendar({ slug, month, onMonthChange, bookings }: Props) {
  const { t, i18n } = useTranslation();
  const { year, month: mo } = month;
  const es = i18n.language?.toLowerCase().startsWith("es");
  const weekdays = es ? WEEKDAYS_ES : WEEKDAYS_GL;

  const byDate = useMemo(() => {
    const m = new Map<string, CalendarBooking[]>();
    for (const b of bookings) {
      const list = m.get(b.date) ?? [];
      list.push(b);
      m.set(b.date, list);
    }
    return m;
  }, [bookings]);

  const totalDays = daysInMonth(year, mo);
  const lead = mondayBasedWeekday(year, mo, 1);
  const cells: Array<{ day: number | null; iso?: string }> = [];
  for (let i = 0; i < lead; i++) cells.push({ day: null });
  for (let d = 1; d <= totalDays; d++) {
    const iso = `${year}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ day: d, iso });
  }
  while (cells.length % 7 !== 0) cells.push({ day: null });

  const label = formatMonthYear(year, mo, i18n.language);

  const shift = (delta: number) => {
    const d = new Date(year, mo - 1 + delta, 1);
    onMonthChange({ year: d.getFullYear(), month: d.getMonth() + 1 });
  };

  const monthPrefix = `${year}-${String(mo).padStart(2, "0")}`;

  return (
    <section className="pa-card p-4" aria-label={t("bookings.calendarTitle")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-lg font-extrabold text-marino">{t("bookings.calendarTitle")}</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="pa-btn-secondary min-h-11 px-3 text-sm"
            onClick={() => shift(-1)}
            aria-label={t("bookings.calendarPrev")}
          >
            ‹
          </button>
          <span className="min-w-[10rem] text-center text-sm font-bold">{label}</span>
          <button
            type="button"
            className="pa-btn-secondary min-h-11 px-3 text-sm"
            onClick={() => shift(1)}
            aria-label={t("bookings.calendarNext")}
          >
            ›
          </button>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-7 gap-1 text-center text-xs font-extrabold text-graphite">
        {weekdays.map((w, i) => (
          <span key={`${w}-${i}`}>{w}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((c, i) => {
          if (c.day === null) {
            return <div key={`e-${i}`} className="min-h-11" />;
          }
          const dayBookings = c.iso ? byDate.get(c.iso) ?? [] : [];
          const has = dayBookings.length > 0;
          return (
            <div
              key={c.iso}
              className={`flex min-h-11 flex-col items-center justify-center rounded-lg border text-sm ${
                has ? "border-libre-bd bg-libre-bg font-bold text-marino" : "border-line bg-paper text-graphite"
              }`}
            >
              <span>{c.day}</span>
              {has ? (
                <span className="mt-0.5 flex gap-0.5" aria-hidden>
                  {dayBookings.slice(0, 3).map((b) => (
                    <span key={b.id} className="h-1.5 w-1.5 rounded-full bg-libre" />
                  ))}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      {bookings.some((b) => b.date.startsWith(monthPrefix)) ? (
        <ul className="mt-4 space-y-2 text-sm">
          {bookings
            .filter((b) => b.date.startsWith(monthPrefix))
            .sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`))
            .map((b) => (
              <li key={b.id}>
                <Link
                  to={
                    b.openMatchId
                      ? `/c/${slug}/partidos-abertos/${b.openMatchId}`
                      : `/c/${slug}/reserva/${b.id}`
                  }
                  className="font-bold text-azul-700 no-underline"
                >
                  {formatDayChip(b.date, i18n.language)} · {b.start}
                  {b.title
                    ? ` — ${b.title}`
                    : b.facilityName
                      ? ` — ${b.facilityName}`
                      : ""}
                </Link>
              </li>
            ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-graphite">{t("bookings.calendarEmpty")}</p>
      )}
    </section>
  );
}
