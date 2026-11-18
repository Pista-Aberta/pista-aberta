/**
 * TANDA-1 — widget embebible de horas libres (hoxe / mañá).
 * REVISION-40 N4 — sen Layout; agrupado por instalación; sen datas ISO.
 * ?tema=claro|oscuro|marca  ?lang=gl|es
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

type FreeSlot = {
  id: string;
  facilityId: string;
  unitId: string;
  unitName?: string;
  start: string;
  end: string;
};

type WidgetData = {
  slug: string;
  name: string;
  accentColor: string;
  facilities: Array<{ id: string; name: string; type: string }>;
  days: Array<{
    date: string;
    label: string;
    free: FreeSlot[];
  }>;
};

type SlotGroup = {
  start: string;
  end: string;
  units: Array<{ unitId: string; unitName: string; slotId: string }>;
};

const MAX_GROUPS_PER_FACILITY = 6;

function groupFreeByFacility(
  free: FreeSlot[],
  facilities: WidgetData["facilities"],
): Array<{ facilityId: string; facilityName: string; groups: SlotGroup[] }> {
  const byFac = new Map<string, FreeSlot[]>();
  for (const s of free) {
    if (!s.facilityId) continue;
    const list = byFac.get(s.facilityId) ?? [];
    list.push(s);
    byFac.set(s.facilityId, list);
  }
  const out: Array<{
    facilityId: string;
    facilityName: string;
    groups: SlotGroup[];
  }> = [];
  for (const fac of facilities) {
    const slots = byFac.get(fac.id);
    if (!slots?.length) continue;
    const byStart = new Map<string, SlotGroup>();
    for (const s of slots) {
      const key = `${s.start}|${s.end}`;
      const g = byStart.get(key) ?? {
        start: s.start,
        end: s.end,
        units: [],
      };
      g.units.push({
        unitId: s.unitId,
        unitName: (s.unitName ?? "").trim(),
        slotId: s.id,
      });
      byStart.set(key, g);
    }
    const groups = [...byStart.values()].sort((a, b) =>
      a.start.localeCompare(b.start),
    );
    out.push({ facilityId: fac.id, facilityName: fac.name, groups });
  }
  return out;
}

function unitLabel(
  units: SlotGroup["units"],
  freeCountLabel: (n: number) => string,
): string {
  const names = units.map((u) => u.unitName).filter(Boolean);
  if (names.length >= 1 && names.length <= 2) return names.join(" / ");
  if (units.length > 1) return freeCountLabel(units.length);
  return names[0] ?? "";
}

export function WidgetPage() {
  const { slug: slugParam, facilityId } = useParams();
  const slug = slugParam!;
  const [search] = useSearchParams();
  const { t, i18n } = useTranslation();
  const tema = search.get("tema") ?? "claro";
  const lang = search.get("lang");
  const [data, setData] = useState<WidgetData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (lang === "es" || lang === "gl") {
      void i18n.changeLanguage(lang);
    }
  }, [lang, i18n]);

  useEffect(() => {
    const q = facilityId ? `?facilityId=${encodeURIComponent(facilityId)}` : "";
    let cancelled = false;
    void fetch(`/api/c/${slug}/widget-data${q}`, { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<{ data: WidgetData }>;
      })
      .then((j) => {
        if (!cancelled) setData(j.data);
      })
      .catch(() => {
        if (!cancelled) setErr(t("widget.loadError"));
      });
    return () => {
      cancelled = true;
    };
  }, [slug, facilityId, t]);

  const theme = useMemo(() => {
    const accent = data?.accentColor ?? "#5A4636";
    if (tema === "oscuro") {
      return {
        bg: "#1a1f24",
        fg: "#f4f6f8",
        muted: "#a8b0b8",
        border: "#2c343c",
        accent,
      };
    }
    if (tema === "marca") {
      return {
        bg: accent,
        fg: "#ffffff",
        muted: "rgba(255,255,255,0.85)",
        border: "rgba(255,255,255,0.25)",
        accent: "#ffffff",
      };
    }
    return {
      bg: "#ffffff",
      fg: "#1a2b3c",
      muted: "#5a6a7a",
      border: "#e2e8ee",
      accent,
    };
  }, [tema, data?.accentColor]);

  useEffect(() => {
    document.documentElement.style.background = theme.bg;
    return () => {
      document.documentElement.style.background = "";
    };
  }, [theme.bg]);

  if (err) {
    return (
      <main
        className="p-4 text-sm"
        style={{ background: theme.bg, color: theme.fg }}
      >
        {err}
      </main>
    );
  }

  if (!data) {
    return (
      <main
        className="p-4 text-sm"
        style={{ background: theme.bg, color: theme.muted }}
      >
        {t("common.loading")}
      </main>
    );
  }

  const linkColor = tema === "marca" ? "#fff" : theme.accent;

  return (
    <main
      className="min-h-screen p-4 font-sans text-sm"
      style={{ background: theme.bg, color: theme.fg }}
      data-pa-widget="1"
    >
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <h1 className="m-0 text-base font-extrabold" style={{ color: theme.accent }}>
          {data.name}
        </h1>
        <span className="text-xs" style={{ color: theme.muted }}>
          {t("widget.title")}
        </span>
      </header>
      {data.days.map((day) => {
        const grouped = groupFreeByFacility(day.free, data.facilities);
        return (
          <section key={day.date} className="mb-4">
            <h2 className="m-0 mb-2 text-sm font-bold">
              {day.label === "hoxe" ? t("widget.today") : t("widget.tomorrow")}
            </h2>
            {grouped.length === 0 ? (
              <p className="m-0" style={{ color: theme.muted }}>
                {t("widget.noFree")}
              </p>
            ) : (
              <div className="space-y-3">
                {grouped.map((fac) => {
                  const shown = fac.groups.slice(0, MAX_GROUPS_PER_FACILITY);
                  const hasMore = fac.groups.length > MAX_GROUPS_PER_FACILITY;
                  return (
                    <div key={fac.facilityId}>
                      <h3 className="m-0 mb-1.5 text-xs font-bold uppercase tracking-wide"
                        style={{ color: theme.muted }}
                      >
                        {fac.facilityName}
                      </h3>
                      <ul className="m-0 list-none space-y-1 p-0">
                        {shown.map((g) => {
                          const first = g.units[0]!;
                          const label = unitLabel(g.units, (n) =>
                            t("widget.freeCount", { n }),
                          );
                          return (
                            <li
                              key={`${fac.facilityId}-${g.start}-${g.end}`}
                              className="flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
                              style={{ borderColor: theme.border }}
                            >
                              <span>
                                <strong>{g.start}</strong>
                                {label ? (
                                  <span style={{ color: theme.muted }}>
                                    {" "}
                                    · {label}
                                  </span>
                                ) : null}
                              </span>
                              <Link
                                to={`/c/${slug}/reservar/${fac.facilityId}?data=${encodeURIComponent(day.date)}&slot=${encodeURIComponent(first.slotId)}&unit=${encodeURIComponent(first.unitId)}`}
                                className="font-bold no-underline"
                                style={{ color: linkColor }}
                                target="_top"
                              >
                                {t("widget.book")}
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                      {hasMore ? (
                        <p className="mt-1.5 m-0">
                          <Link
                            to={`/c/${slug}/reservar/${fac.facilityId}?data=${encodeURIComponent(day.date)}`}
                            className="text-xs font-bold no-underline"
                            style={{ color: linkColor }}
                            target="_top"
                          >
                            {t("widget.seeAll")}
                          </Link>
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
      <p className="mt-4 text-xs" style={{ color: theme.muted }}>
        <a
          href={`/c/${slug}`}
          target="_top"
          className="font-bold no-underline"
          style={{ color: theme.accent }}
        >
          {t("widget.openPortal")}
        </a>
        <span aria-hidden> · </span>
        <a
          href={`/c/${slug}/contacto`}
          target="_top"
          className="font-bold no-underline"
          style={{ color: theme.accent }}
        >
          {t("nav.contact")}
        </a>
      </p>
    </main>
  );
}
