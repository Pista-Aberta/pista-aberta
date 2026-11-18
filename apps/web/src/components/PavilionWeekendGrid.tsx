import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatDate, formatWeekendRangeShort } from "../lib/format-date";
import {
  matchIsPast,
  unitKind,
  type MoveUnitLike,
} from "../lib/move-match";

export type PavilionMatch = {
  id: string;
  date: string;
  start: string;
  end: string;
  homeTeam: string;
  awayTeam: string;
  club: string;
  unit: string;
  unitId?: string;
  status: string;
};

/** REVISION-51 B1 — reserva da veciñanza (sen nome). */
export type PavilionNeighborBooking = {
  id: string;
  date: string;
  start: string;
  end: string;
  unitId: string;
  unit: string;
};

/** REVISION-48 Y3 — ≈1 px = 1 min. */
const PX_PER_MIN = 1;
const HOUR_LABEL_W = "4.5rem";
const GAP_ROW_PX = 28;

function toMin(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function statusClass(status: string, past: boolean): string {
  /* REVISION-49 Z5 — gris só partidos pasados. */
  if (past) return "bg-ocupada-bg text-ocupada border-line";
  if (status === "conflict") return "bg-aviso-bg text-aviso border-aviso-bd";
  if (status === "change_requested") return "bg-warnBg text-warnText border-warnBorder";
  /* Movido mesma cor ca Aprobado. */
  if (
    status === "confirmed" ||
    status === "ok" ||
    status === "scheduled" ||
    status === "moved" ||
    status === "resolved" ||
    status === "swapped"
  ) {
    return "bg-azul-50 text-azul-700 border-azul";
  }
  return "bg-ocupada-bg text-ocupada border-line";
}

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function matchLabel(m: PavilionMatch): string {
  return `${m.homeTeam}–${m.awayTeam}`;
}

function statusLabelKey(status: string): string {
  if (status === "scheduled" || status === "resolved" || status === "swapped") {
    return "clubs.status.approved";
  }
  /* REVISION-49 Z5 — etiqueta «Movido» (non «Aprobado»). */
  if (
    status === "proposed" ||
    status === "change_requested" ||
    status === "moved" ||
    status === "conflict"
  ) {
    return `clubs.status.${status}`;
  }
  return `clubs.status.${status}`;
}

type LaneLayout = { leftPct: number; widthPct: number };

/**
 * REVISION-49 Z2 — bloques que solapan van lado a lado (columnas),
 * respectando a banda Media A (0–50 %) / Media B (50–100 %) / Completa.
 */
function layoutOverlapping(
  dayMatches: PavilionMatch[],
  kindOf: (m: PavilionMatch) => "full" | "a" | "b" | "other",
): Map<string, LaneLayout> {
  const out = new Map<string, LaneLayout>();
  type Band = "full" | "a" | "b";
  const bandOf = (m: PavilionMatch): Band => {
    const k = kindOf(m);
    if (k === "a") return "a";
    if (k === "b") return "b";
    return "full";
  };
  const bandRange: Record<Band, { left: number; width: number }> = {
    full: { left: 0, width: 100 },
    a: { left: 0, width: 50 },
    b: { left: 50, width: 50 },
  };

  for (const band of ["full", "a", "b"] as Band[]) {
    const items = dayMatches
      .filter((m) => bandOf(m) === band)
      .map((m) => ({
        id: m.id,
        start: toMin(m.start),
        end: toMin(m.end),
      }))
      .sort((a, b) => a.start - b.start || a.end - b.end);

    /* Asignar carrís (interval graph coloring guloso). */
    const laneEnds: number[] = [];
    const laneOf = new Map<string, number>();
    for (const it of items) {
      let lane = laneEnds.findIndex((end) => end <= it.start);
      if (lane < 0) {
        lane = laneEnds.length;
        laneEnds.push(it.end);
      } else {
        laneEnds[lane] = it.end;
      }
      laneOf.set(it.id, lane);
    }

    /* Por cada compoñente conexa no tempo, o nº de carrís = max+1 nesa zona. */
    const clusters: string[][] = [];
    let cur: typeof items = [];
    let curEnd = -1;
    for (const it of items) {
      if (cur.length === 0 || it.start < curEnd) {
        cur.push(it);
        curEnd = Math.max(curEnd, it.end);
      } else {
        clusters.push(cur.map((x) => x.id));
        cur = [it];
        curEnd = it.end;
      }
    }
    if (cur.length) clusters.push(cur.map((x) => x.id));

    const range = bandRange[band];
    for (const ids of clusters) {
      let maxLane = 0;
      for (const id of ids) {
        maxLane = Math.max(maxLane, laneOf.get(id) ?? 0);
      }
      const cols = maxLane + 1;
      for (const id of ids) {
        const lane = laneOf.get(id) ?? 0;
        const widthPct = range.width / cols;
        out.set(id, {
          leftPct: range.left + lane * widthPct,
          widthPct,
        });
      }
    }
  }
  return out;
}

type TimelineSeg =
  | { kind: "hour"; hour: number; startMin: number; endMin: number }
  | { kind: "gap"; afterHour: number };

/** Horas con actividade + ocos «· · ·» entre bloques. */
function buildTimeline(
  matches: PavilionMatch[],
  bookings: PavilionNeighborBooking[] = [],
): {
  segs: TimelineSeg[];
  totalPx: number;
  /** Minuto civil → offset Y en px (agochando ocos). */
  yAt: (minute: number) => number;
} {
  const hours = new Set<number>();
  for (const m of matches) {
    const s = Math.floor(toMin(m.start) / 60);
    const e = Math.ceil(toMin(m.end) / 60);
    for (let h = s; h < Math.max(s + 1, e); h++) hours.add(h);
  }
  for (const b of bookings) {
    const s = Math.floor(toMin(b.start) / 60);
    const e = Math.ceil(toMin(b.end) / 60);
    for (let h = s; h < Math.max(s + 1, e); h++) hours.add(h);
  }
  const list = [...hours].sort((a, b) => a - b);
  const filled = list.length > 0 ? list : [9, 10, 11, 12, 16, 17, 18, 19, 20];

  const segs: TimelineSeg[] = [];
  for (let i = 0; i < filled.length; i++) {
    const h = filled[i]!;
    if (i > 0 && h > filled[i - 1]! + 1) {
      segs.push({ kind: "gap", afterHour: filled[i - 1]! });
    }
    segs.push({
      kind: "hour",
      hour: h,
      startMin: h * 60,
      endMin: (h + 1) * 60,
    });
  }

  let totalPx = 0;
  const hourOffsets = new Map<number, number>();
  for (const seg of segs) {
    if (seg.kind === "hour") {
      hourOffsets.set(seg.hour, totalPx);
      totalPx += 60 * PX_PER_MIN;
    } else {
      totalPx += GAP_ROW_PX;
    }
  }

  const yAt = (minute: number) => {
    const hour = Math.floor(minute / 60);
    const within = minute - hour * 60;
    if (hourOffsets.has(hour)) {
      return hourOffsets.get(hour)! + within * PX_PER_MIN;
    }
    /* Fora do rango amosado: axustar ao borde. */
    const first = filled[0]!;
    const last = filled[filled.length - 1]!;
    if (minute < first * 60) return 0;
    if (minute >= (last + 1) * 60) return totalPx;
    /* Dentro dun oco agochado: principio do gap seguinte. */
    let y = 0;
    for (const seg of segs) {
      if (seg.kind === "gap") {
        const nextHour = segs.find(
          (s) => s.kind === "hour" && s.hour > seg.afterHour,
        );
        if (
          nextHour &&
          nextHour.kind === "hour" &&
          minute < nextHour.startMin &&
          minute >= (seg.afterHour + 1) * 60
        ) {
          return y;
        }
        y += GAP_ROW_PX;
      } else {
        y += 60 * PX_PER_MIN;
      }
    }
    return y;
  };

  return { segs, totalPx, yAt };
}

function MatchBlock({
  m,
  compact,
  renderActions,
  hideStatus,
  t,
  style,
  selected,
  onSelect,
}: {
  m: PavilionMatch;
  compact?: boolean;
  renderActions?: (match: PavilionMatch) => ReactNode;
  hideStatus?: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
  style: CSSProperties;
  selected?: boolean;
  onSelect?: (match: PavilionMatch) => void;
}) {
  const past = matchIsPast(m);
  const statusKey = statusLabelKey(m.status);
  const statusText = hideStatus
    ? t("pavilion.match", { defaultValue: "Partido" })
    : t(statusKey, { defaultValue: t(`status.${m.status}`, { defaultValue: m.status }) });
  const tone = hideStatus ? "scheduled" : m.status;
  const cls = `absolute box-border flex flex-col gap-0.5 overflow-hidden rounded-[10px] border px-2 py-1 text-left ${statusClass(tone, past)} ${
    compact ? "text-[11px]" : "text-[12px]"
  } ${selected ? "ring-2 ring-marino ring-offset-1 border-marino shadow-pa-tab z-[2]" : "z-[1]"}`;
  const body = (
    <>
      {selected ? (
        <span className="text-[9px] font-extrabold uppercase tracking-wide text-marino">
          {t("admin.matchSelected", { defaultValue: "Escollido" })}
        </span>
      ) : null}
      <span className={`truncate font-extrabold ${compact ? "text-[11px]" : "text-[12px]"}`}>
        {matchLabel(m)}
      </span>
      <span className={`truncate font-semibold opacity-90 ${compact ? "text-[10px]" : "text-[11px]"}`}>
        {m.start}–{m.end}
        {!hideStatus ? ` · ${statusText}` : ""}
      </span>
      {renderActions ? <div className="mt-0.5">{renderActions(m)}</div> : null}
    </>
  );
  if (onSelect) {
    return (
      <button
        type="button"
        className={cls}
        style={style}
        title={`${matchLabel(m)} · ${m.start}–${m.end} · ${m.unit}`}
        aria-pressed={selected}
        onClick={() => onSelect(m)}
      >
        {body}
      </button>
    );
  }
  return (
    <div
      className={cls}
      style={style}
      title={`${matchLabel(m)} · ${m.start}–${m.end} · ${m.unit}`}
    >
      {body}
    </div>
  );
}

function DayColumn({
  date,
  matches,
  bookings,
  yAt,
  totalPx,
  units,
  hideStatus,
  renderMatchActions,
  selectedMatchId,
  onSelectMatch,
  t,
}: {
  date: string;
  matches: PavilionMatch[];
  bookings?: PavilionNeighborBooking[];
  yAt: (minute: number) => number;
  totalPx: number;
  units?: MoveUnitLike[];
  hideStatus?: boolean;
  renderMatchActions?: (match: PavilionMatch) => ReactNode;
  selectedMatchId?: string | null;
  onSelectMatch?: (match: PavilionMatch) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const dayMatches = matches.filter((m) => m.date === date);
  const dayBookings = (bookings ?? []).filter((b) => b.date === date);
  const kindOf = (m: PavilionMatch) =>
    unitKind(m.unitId ?? m.unit, units);
  const lanes = layoutOverlapping(dayMatches, kindOf);

  return (
    <div className="relative border-l border-line" style={{ height: totalPx }}>
      {/* Fondo de medias cando non hai completa. */}
      <div className="pointer-events-none absolute inset-0 grid grid-cols-2">
        <div className="border-r border-dashed border-line/50" />
        <div />
      </div>
      {/* REVISION-51 B1: reservas veciñanza — bloques grises finos sen nome. */}
      {dayBookings.map((b) => {
        const top = yAt(toMin(b.start));
        const bottom = yAt(toMin(b.end));
        const height = Math.max(14, bottom - top - 2);
        const k = unitKind(b.unitId ?? b.unit, units);
        const isHalf = k === "a" || k === "b";
        const leftPct = isHalf ? (k === "b" ? 50 : 0) : 0;
        const widthPct = isHalf ? 50 : 100;
        return (
          <div
            key={`nb-${b.id}`}
            className="pointer-events-none absolute z-0 box-border overflow-hidden rounded-[6px] border border-line/70 bg-[#E8EEF3] px-1.5 py-0.5 text-[10px] font-semibold text-graphite"
            style={{
              top: top + 1,
              height,
              left: `${leftPct}%`,
              width: `${widthPct}%`,
            }}
            title={`${t("pavilion.neighborBooking", { defaultValue: "Reserva" })} · ${b.start}`}
          >
            <span className="truncate">
              {t("pavilion.neighborBooking", { defaultValue: "Reserva" })} · {b.start}
            </span>
          </div>
        );
      })}
      {dayMatches.map((m) => {
        const top = yAt(toMin(m.start));
        const bottom = yAt(toMin(m.end));
        const height = Math.max(18, bottom - top - 2);
        const k = kindOf(m);
        const isHalf = k === "a" || k === "b";
        const lane = lanes.get(m.id) ?? {
          leftPct: isHalf ? (k === "b" ? 50 : 0) : 0,
          widthPct: isHalf ? 50 : 100,
        };
        const style: CSSProperties = {
          top: top + 1,
          height,
          left: `${lane.leftPct}%`,
          width: `${lane.widthPct}%`,
          paddingLeft: 4,
          paddingRight: 4,
        };
        return (
          <MatchBlock
            key={m.id}
            m={m}
            compact={isHalf || lane.widthPct <= 50}
            t={t}
            hideStatus={hideStatus}
            style={style}
            renderActions={renderMatchActions}
            selected={selectedMatchId === m.id}
            onSelect={onSelectMatch}
          />
        );
      })}
    </div>
  );
}

/** Grella sábado/domingo proporcional ao tempo (REVISION-48 Y3). */
export function PavilionWeekendGrid({
  matches,
  neighborBookings,
  weekendLabel,
  weekendStartIso,
  weekOffset: _weekOffset = 0,
  onPrevWeek,
  onNextWeek,
  hideHeading = false,
  hideStatus = false,
  className = "",
  renderMatchActions,
  selectedMatchId,
  onSelectMatch,
  units,
}: {
  matches: PavilionMatch[];
  /** REVISION-51 B1 — só no calendario do concello (sen nome). */
  neighborBookings?: PavilionNeighborBooking[];
  weekendLabel?: string;
  weekendStartIso?: string;
  weekOffset?: number;
  onPrevWeek?: () => void;
  onNextWeek?: () => void;
  hideHeading?: boolean;
  hideStatus?: boolean;
  className?: string;
  renderMatchActions?: (match: PavilionMatch) => ReactNode;
  selectedMatchId?: string | null;
  onSelectMatch?: (match: PavilionMatch) => void;
  /** REVISION-48 Y7 — para Media A/B via incompatibleWith. */
  units?: MoveUnitLike[];
}) {
  void _weekOffset;
  const { t, i18n } = useTranslation();
  const [mobileDay, setMobileDay] = useState(0);
  const bookings = neighborBookings ?? [];

  const days = useMemo(() => {
    if (weekendStartIso) {
      return [weekendStartIso, addDaysIso(weekendStartIso, 1)];
    }
    const dates = [
      ...new Set([
        ...matches.map((m) => m.date),
        ...bookings.map((b) => b.date),
      ]),
    ].sort();
    const sat = dates.find((d) => new Date(`${d}T12:00:00`).getDay() === 6);
    const sunFromSat = sat ? addDaysIso(sat, 1) : undefined;
    const sun =
      dates.find((d) => new Date(`${d}T12:00:00`).getDay() === 0) ?? sunFromSat;
    if (sat && sun) return [sat, sun];
    if (sat) return [sat, addDaysIso(sat, 1)];
    if (sun) return [addDaysIso(sun, -1), sun];
    if (dates.length >= 2) return dates.slice(0, 2);
    if (dates[0]) return [dates[0], addDaysIso(dates[0], 1)];
    return [] as string[];
  }, [matches, bookings, weekendStartIso]);

  const timeline = useMemo(
    () => buildTimeline(matches, bookings),
    [matches, bookings],
  );

  const shortRange =
    days[0] && days[1]
      ? formatWeekendRangeShort(days[0], days[1], i18n.language)
      : null;
  const navLabel =
    shortRange ??
    weekendLabel ??
    (days[0] ? formatDate(days[0], i18n.language) : t("clubs.weekendGrid"));

  if (days.length === 0) {
    return <p className="text-sm text-graphite">{t("clubs.gridEmpty")}</p>;
  }

  const hourGutter = (
    <div className="relative border-b border-line" style={{ height: timeline.totalPx }}>
      {timeline.segs.map((seg, i) => {
        if (seg.kind === "gap") {
          return (
            <div
              key={`gap-${seg.afterHour}-${i}`}
              className="flex items-center justify-center text-[11px] tracking-[0.35em] text-graphite/70"
              style={{ height: GAP_ROW_PX }}
              aria-hidden
            >
              · · ·
            </div>
          );
        }
        return (
          <div
            key={`h-${seg.hour}`}
            className="flex items-start border-b border-line/60 px-2 pt-1 text-xs font-bold text-graphite"
            style={{ height: 60 * PX_PER_MIN }}
          >
            {String(seg.hour).padStart(2, "0")}:00
          </div>
        );
      })}
    </div>
  );

  const weekNav =
    onPrevWeek || onNextWeek ? (
      <div className="flex flex-nowrap items-center gap-1.5 whitespace-nowrap">
        {onPrevWeek ? (
          <button
            type="button"
            className="pa-btn-secondary min-h-11 shrink-0 px-2.5 text-sm"
            aria-label={t("clubs.prevWeek")}
            onClick={onPrevWeek}
          >
            ‹
          </button>
        ) : null}
        <span className="min-w-0 truncate text-sm font-bold text-marino">{navLabel}</span>
        {onNextWeek ? (
          <button
            type="button"
            className="pa-btn-secondary min-h-11 shrink-0 px-2.5 text-sm"
            aria-label={t("clubs.nextWeek")}
            onClick={onNextWeek}
          >
            ›
          </button>
        ) : null}
      </div>
    ) : weekendLabel ? (
      <span className="text-sm text-graphite">{weekendLabel}</span>
    ) : null;

  return (
    <section className={className} aria-label={t("clubs.weekendGrid")}>
      {!hideHeading ? (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="m-0 text-lg font-extrabold text-marino">{t("clubs.weekendGrid")}</h2>
            {weekNav}
          </div>
          <p className="mt-1 text-sm text-graphite">{t("clubs.weekendGridHint")}</p>
        </>
      ) : (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">{weekNav}</div>
      )}

      {/* Móbil: pestanas sábado / domingo */}
      <div className="mt-3 flex gap-2 md:hidden" role="tablist">
        {days.map((d, i) => (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={mobileDay === i}
            className={`min-h-11 flex-1 rounded-btn border px-3 text-sm font-extrabold ${
              mobileDay === i
                ? "border-marino bg-marino text-on-dark"
                : "border-line bg-surface text-marino"
            }`}
            onClick={() => setMobileDay(i)}
          >
            {formatDate(d, i18n.language)}
          </button>
        ))}
      </div>
      <div
        className="mt-3 overflow-x-auto rounded-card border border-line bg-surface md:hidden"
        tabIndex={0}
      >
        <div className="grid" style={{ gridTemplateColumns: `${HOUR_LABEL_W} minmax(0, 1fr)` }}>
          <div className="border-b border-line p-2" />
          <div className="border-b border-l border-line px-3 py-2 text-sm font-extrabold text-marino">
            {formatDate(days[mobileDay]!, i18n.language)}
          </div>
          {hourGutter}
          <DayColumn
            date={days[mobileDay]!}
            matches={matches}
            bookings={bookings}
            yAt={timeline.yAt}
            totalPx={timeline.totalPx}
            units={units}
            hideStatus={hideStatus}
            renderMatchActions={renderMatchActions}
            selectedMatchId={selectedMatchId}
            onSelectMatch={onSelectMatch}
            t={t}
          />
        </div>
      </div>

      {/* PC: sábado e domingo lado a lado */}
      <div
        className="mt-4 hidden overflow-x-auto rounded-card border border-line bg-surface md:block"
        tabIndex={0}
      >
        <div
          className="min-w-[640px] grid"
          style={{
            gridTemplateColumns: `${HOUR_LABEL_W} repeat(${days.length}, minmax(0, 1fr))`,
          }}
        >
          <div className="border-b border-line p-2" />
          {days.map((d) => (
            <div
              key={d}
              className="border-b border-l border-line px-3 py-2 text-sm font-extrabold text-marino"
            >
              {formatDate(d, i18n.language)}
            </div>
          ))}
          {hourGutter}
          {days.map((d) => (
            <DayColumn
              key={d}
              date={d}
              matches={matches}
              bookings={bookings}
              yAt={timeline.yAt}
              totalPx={timeline.totalPx}
              units={units}
              hideStatus={hideStatus}
              renderMatchActions={renderMatchActions}
              selectedMatchId={selectedMatchId}
              onSelectMatch={onSelectMatch}
              t={t}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
