import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

type DayBooking = {
  id?: unknown;
  start?: unknown;
  end?: unknown;
  status?: unknown;
  unitId?: unknown;
  unitName?: unknown;
  facilityName?: unknown;
  userDisplayName?: unknown;
};

const FALLBACK_START = 8;
const FALLBACK_END = 22;
const MIN_BLOCK_PX = 24;
/** Ancho mínimo por hora para que o scroll mostre a tarde cando hai moitas. */
const PX_PER_HOUR = 72;

function toMinutes(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function statusTone(status: string): string {
  if (status === "checked_in") return "bg-libre text-on-dark";
  if (status === "no_show") return "bg-aviso text-on-dark";
  if (status === "cancelled") return "bg-ocupada-bg text-ocupada line-through";
  return "bg-azul text-on-dark";
}

/**
 * Liña do día por unidade (Gantt) — DESENO-V2 §4 / REVISION-8 B6.
 * REVISION-46 V4: rango = primeira apertura → último peche das reservas
 * (fallback 08–22), con scroll horizontal visible.
 */
export function DayLineGantt({
  bookings,
  className = "",
}: {
  bookings: DayBooking[];
  className?: string;
}) {
  const { t } = useTranslation();
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = useMemo(() => {
    const byUnit = new Map<
      string,
      {
        label: string;
        items: Array<{
          id: string;
          start: string;
          end: string;
          status: string;
          who: string;
          initials: string;
        }>;
      }
    >();
    for (const b of bookings) {
      const status = String(b.status ?? "");
      if (status === "cancelled") continue;
      const unitKey = String(b.unitId ?? b.unitName ?? "—");
      const unitName = String(b.unitName ?? "").trim();
      const label =
        unitName ||
        [b.facilityName, b.unitName].filter(Boolean).map(String).join(" · ") ||
        unitKey;
      const start = String(b.start ?? "");
      const end = String(b.end ?? "");
      if (!start) continue;
      const who = String(b.userDisplayName ?? "").trim();
      const initials = who
        ? who
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((p) => p[0]?.toUpperCase() ?? "")
            .join("")
        : "";
      const bucket = byUnit.get(unitKey) ?? { label, items: [] };
      bucket.items.push({
        id: String(b.id ?? `${unitKey}-${start}`),
        start,
        end: end || start,
        status,
        who,
        initials,
      });
      byUnit.set(unitKey, bucket);
    }
    for (const row of byUnit.values()) {
      row.items.sort((a, b) => a.start.localeCompare(b.start));
    }
    return [...byUnit.values()].sort((a, b) => a.label.localeCompare(b.label, "gl"));
  }, [bookings]);

  const { dayStartHour, dayEndHour } = useMemo(() => {
    let minH = Number.POSITIVE_INFINITY;
    let maxH = Number.NEGATIVE_INFINITY;
    for (const row of rows) {
      for (const item of row.items) {
        const s = toMinutes(item.start);
        const e = toMinutes(item.end);
        if (s == null) continue;
        minH = Math.min(minH, Math.floor(s / 60));
        maxH = Math.max(maxH, Math.ceil((e ?? s + 60) / 60));
      }
    }
    if (!Number.isFinite(minH) || !Number.isFinite(maxH)) {
      return { dayStartHour: FALLBACK_START, dayEndHour: FALLBACK_END };
    }
    /* Apertura→peche real das reservas (sen forzar 08 se a tarde é o único). */
    const start = Math.max(0, minH);
    const end = Math.min(24, Math.max(maxH, start + 1));
    return { dayStartHour: start, dayEndHour: end };
  }, [rows]);

  const hours = Array.from(
    { length: Math.max(1, dayEndHour - dayStartHour) },
    (_, i) => dayStartHour + i,
  );
  const dayStartMin = dayStartHour * 60;
  const dayEndMin = dayEndHour * 60;
  const trackMinWidth = Math.max(hours.length * PX_PER_HOUR, 320);

  if (rows.length === 0) {
    return <p className="text-sm text-graphite">{t("admin.dayLineEmpty")}</p>;
  }

  const detailFor = (id: string | null) => {
    if (!id) return null;
    for (const row of rows) {
      const hit = row.items.find((i) => i.id === id);
      if (hit) {
        return `${row.label}: ${hit.start}–${hit.end}${hit.who ? ` · ${hit.who}` : ""} · ${t(`status.${hit.status}`, { defaultValue: hit.status })}`;
      }
    }
    return null;
  };

  return (
    <section className={className} aria-label={t("admin.dayLineTitle")}>
      <h2 className="m-0 text-lg font-extrabold text-marino">{t("admin.dayLineTitle")}</h2>
      <p className="mt-1 text-sm text-graphite">{t("admin.dayLineHint")}</p>

      {/* Móbil: lista (Rev24 D4 — target-size ≥24px). */}
      <ul className="mt-3 list-none space-y-3 p-0 md:hidden">
        {rows.map((row) => (
          <li key={row.label} className="rounded-card border border-line bg-surface p-3">
            <p className="m-0 text-xs font-extrabold text-marino">{row.label}</p>
            <ul className="mt-2 list-none space-y-2 p-0">
              {row.items.map((item) => {
                const open = openId === item.id;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-[10px] px-3 py-2 text-left text-sm font-extrabold ${statusTone(item.status)}`}
                      aria-expanded={open}
                      onClick={() => setOpenId(open ? null : item.id)}
                    >
                      <span>
                        {item.start}–{item.end}
                        {item.who ? ` · ${item.who}` : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>

      <div
        className="mt-3 hidden overflow-x-auto rounded-card border border-line bg-surface md:block"
        role="region"
        aria-label={t("admin.dayLineTitle")}
        tabIndex={0}
      >
        <div className="w-full" style={{ minWidth: trackMinWidth }}>
          <div className="flex border-b border-line">
            <div className="w-28 shrink-0 px-1.5 py-2" />
            <div className="flex min-w-0 flex-1">
              {hours.map((h) => (
                <div
                  key={`h-${h}`}
                  className="min-w-0 flex-1 py-2 text-center text-[11px] font-bold text-graphite"
                >
                  {String(h).padStart(2, "0")}
                </div>
              ))}
            </div>
          </div>
          {rows.map((row) => (
            <div key={row.label} className="flex border-b border-line last:border-b-0">
              <div className="flex w-28 shrink-0 items-center truncate px-1.5 py-2 text-xs font-extrabold text-marino">
                {row.label}
              </div>
              <div className="relative h-[52px] min-w-0 flex-1">
                <div className="pointer-events-none absolute inset-0 flex">
                  {hours.map((h) => (
                    <div
                      key={`${row.label}-g-${h}`}
                      className="h-full flex-1 border-r border-line/50 last:border-r-0"
                    />
                  ))}
                </div>
                {row.items.map((item) => {
                  const s = toMinutes(item.start);
                  const e = toMinutes(item.end);
                  if (s == null || e == null) return null;
                  const spanMin = Math.min(e, dayEndMin) - Math.max(s, dayStartMin);
                  const leftPct = Math.max(0, ((s - dayStartMin) / (dayEndMin - dayStartMin)) * 100);
                  const widthPct = Math.max(
                    (MIN_BLOCK_PX / Math.max(trackMinWidth - 112, 1)) * 100,
                    (spanMin / (dayEndMin - dayStartMin)) * 100,
                  );
                  const open = openId === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      title={`${item.start}–${item.end}${item.who ? ` · ${item.who}` : ""}`}
                      aria-label={`${item.start}–${item.end}${item.who ? ` · ${item.who}` : ""}${item.initials ? ` ${item.initials}` : ""}`}
                      aria-expanded={open}
                      onClick={() => setOpenId(open ? null : item.id)}
                      className={`absolute top-1.5 flex h-9 min-h-[24px] min-w-[24px] items-center justify-center overflow-hidden rounded-[10px] px-2 text-left text-[11px] font-extrabold ${statusTone(item.status)}`}
                      style={{
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        minWidth: MIN_BLOCK_PX,
                      }}
                    >
                      <span className="truncate">{item.initials || ""}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      {openId ? (
        <p className="mt-2 text-sm text-graphite" role="status">
          {detailFor(openId)}
        </p>
      ) : null}
    </section>
  );
}
