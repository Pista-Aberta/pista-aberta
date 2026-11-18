import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Activity, Building2, CircleDot, LayoutGrid } from "lucide-react";
import { api } from "../lib/api";
import { useSession } from "../context/SessionContext";
import { EmptyState } from "../components/EmptyState";
import { FacilityFreeCard } from "../components/FacilityFreeCard";
import { groupFreeHoursByStart } from "../lib/free-hours";
import { servicesLine } from "../lib/service-labels";
import { formatDate } from "../lib/format-date";
import {
  DayTile,
  type CourtArtType,
} from "../components/ui";

type Slot = Awaited<ReturnType<typeof api.availability>>["data"][number];
type Facility = Awaited<ReturnType<typeof api.facilities>>["data"][number];

const SPORT_TYPES = ["pista", "pavillon", "campo", "sala"] as const;

function todayIso() {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function tomorrowIso() {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function isNightLocal() {
  return new Date().getHours() >= 20;
}

function courtTypeFor(facilityType: string): CourtArtType {
  if (facilityType === "pavillon") return "pavillon";
  if (facilityType === "campo") return "futbol";
  if (facilityType === "sala") return "sala";
  return "padel";
}

function isoFromDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function nextDays(count: number): Date[] {
  const out: Date[] = [];
  const base = new Date();
  base.setHours(12, 0, 0, 0);
  for (let i = 0; i < count; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    out.push(d);
  }
  return out;
}

const SPORT_ICON: Record<string, typeof CircleDot> = {
  pista: CircleDot,
  pavillon: Building2,
  campo: Activity,
  sala: Building2,
};

/**
 * Lista unificada Instalacións + Horas libres (SIMPLIFICACION 1.1 / REVISION-11 S3).
 * Entrada: /reservar?deporte=&data=
 */
export function ReservarHubPage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const [params, setParams] = useSearchParams();
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const navigate = useNavigate();
  const deporte = params.get("deporte") ?? "";
  const partido = params.get("partido");
  const night = isNightLocal();
  const explicitDate = params.get("data");
  const showingTomorrow = !explicitDate && night;
  const data = explicitDate || (night ? tomorrowIso() : todayIso());
  const [list, setList] = useState<Facility[] | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const days = useMemo(() => nextDays(7), []);

  const dayLabel = useMemo(() => {
    const isToday = data === todayIso();
    const isTomorrow = data === tomorrowIso();
    const formatted = formatDate(data, i18n.language);
    if (isTomorrow) return t("reserve.hubDayTomorrow", { day: formatted });
    if (isToday) return t("reserve.hubDayToday", { day: formatted });
    return formatted;
  }, [data, i18n.language, t]);

  useEffect(() => {
    void Promise.all([
      api.facilities(slug),
      api.availability(slug, { date: data, deporte: deporte || undefined }),
    ])
      .then(([fac, av]) => {
        setList(fac.data);
        setSlots(av.data.filter((s) => s.status === "free"));
      })
      .catch(() => setError(t("common.error")));
  }, [slug, data, deporte, t]);

  const availableTypes = useMemo(() => {
    if (!list) return [] as (typeof SPORT_TYPES)[number][];
    const present = new Set(list.map((f) => f.type));
    return SPORT_TYPES.filter((ty) => present.has(ty));
  }, [list]);

  const rows = useMemo(() => {
    if (!list) return [];
    const byFac = new Map<string, Slot[]>();
    for (const s of slots) {
      const fid = s.facilityId;
      if (!fid) continue;
      const arr = byFac.get(fid) ?? [];
      arr.push(s);
      byFac.set(fid, arr);
    }
    const courtOne = t("reserve.courtOne");
    const courtMany = t("reserve.courtMany");
    return list
      .filter((f) => !deporte || f.type === deporte)
      .map((f) => {
        const grouped = groupFreeHoursByStart(byFac.get(f.id) ?? []);
        const preview = grouped.slice(0, 3).map((g) => ({
          /* REVISION-41 O1: hora + «N pistas» en dúas liñas. */
          label: g.start,
          sublabel:
            g.count > 1
              ? `${g.count} ${g.count === 1 ? courtOne : courtMany}`
              : undefined,
          primary: g.primary,
        }));
        return {
          facility: f,
          hours: preview,
        };
      });
  }, [list, slots, deporte, t]);

  const setDeporte = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set("deporte", value);
    else next.delete("deporte");
    setParams(next, { replace: true });
  };

  const setDay = (iso: string) => {
    const next = new URLSearchParams(params);
    next.set("data", iso);
    setParams(next, { replace: true });
  };

  const goHour = (facilityId: string, date: string, slotId: string) => {
    const qs = new URLSearchParams({ data: date, slot: slotId });
    if (partido === "1") qs.set("partido", "1");
    const target = `/c/${slug}/reservar/${facilityId}?${qs.toString()}`;
    if (!user) {
      navigate(`/c/${slug}/acceso?returnTo=${encodeURIComponent(target)}`);
      return;
    }
    navigate(target);
  };

  if (error) {
    return (
      <main className="pa-page">
        <div className="pa-warn-banner" role="alert">
          <span aria-hidden>⚠</span>
          <span>{error}</span>
        </div>
      </main>
    );
  }

  if (!list) {
    return (
      <main className="pa-page">
        <p className="text-graphite">{t("common.loading")}</p>
      </main>
    );
  }

  const chipClass = (on: boolean) =>
    `inline-flex h-10 max-w-[11rem] shrink-0 items-center gap-1.5 rounded-full border-[1.5px] px-3.5 text-sm font-extrabold ${
      on
        ? "border-marino bg-marino text-on-dark"
        : "border-line bg-surface text-marino hover:border-marino"
    }`;

  return (
    <main className="pa-page min-w-0">
      <h1 className="pa-h1">
        {partido === "1"
          ? t("openMatch.createPickHour", {
              defaultValue: "Crear partido aberto · Escolle unha hora libre",
            })
          : t("nav.reserve")}
      </h1>
      <p className="mt-2 text-lg font-extrabold text-marino" role="status">
        {dayLabel}
      </p>
      {showingTomorrow ? (
        <p className="mt-2 text-sm font-bold text-aviso" role="status">
          {t("reserve.hubShowingTomorrow", {
            defaultValue: "Hoxe xa non quedan horas; mostramos mañá.",
          })}
        </p>
      ) : null}

      {/* REVISION-46 V1: acceso a partidos abertos desde Reservar. */}
      {partido !== "1" ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-line bg-surface px-4 py-3">
          <p className="m-0 text-sm font-bold text-marino">
            {t("reserve.hubOpenMatchesCta")}
          </p>
          <Link
            to={`/c/${slug}/partidos-abertos`}
            className="pa-btn-secondary inline-flex shrink-0 no-underline"
          >
            {t("nav.openMatches")}
          </Link>
        </div>
      ) : null}

      <fieldset className="mt-5 m-0 min-w-0 max-w-full border-0 p-0">
        <legend className="mb-2.5 text-[13px] font-extrabold tracking-[0.08em] text-graphite">
          {t("portada.sportLabel")}
        </legend>
        <div className="-mx-1 flex min-w-0 max-w-full flex-nowrap gap-2 overflow-x-auto overscroll-x-contain px-1 pb-1 touch-pan-x [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            aria-pressed={!deporte}
            className={chipClass(!deporte)}
            onClick={() => setDeporte("")}
          >
            <LayoutGrid size={16} strokeWidth={1.9} aria-hidden className="shrink-0" />
            <span className="truncate">{t("portada.sportAll")}</span>
          </button>
          {availableTypes.map((ty) => {
            const Icon = SPORT_ICON[ty] ?? CircleDot;
            return (
              <button
                key={ty}
                type="button"
                aria-pressed={deporte === ty}
                className={chipClass(deporte === ty)}
                onClick={() => setDeporte(ty)}
              >
                <Icon size={16} strokeWidth={1.9} aria-hidden className="shrink-0" />
                <span className="truncate">{t(`facilities.type.${ty}`)}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="mt-4 min-w-0 border-0 p-0">
        <legend className="mb-2.5 text-[13px] font-extrabold tracking-[0.08em] text-graphite">
          {t("portada.dayLabel")}
        </legend>
        <div className="flex min-w-0 gap-2 overflow-x-auto scroll-smooth pb-1 snap-x snap-mandatory [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {days.map((d) => {
            const iso = isoFromDate(d);
            return (
              <DayTile
                key={iso}
                weekday={t(`weekdayShort.${d.getDay()}`)}
                day={d.getDate()}
                pressed={data === iso}
                hasFree
                past={false}
                onClick={() => setDay(iso)}
                className="snap-start"
              />
            );
          })}
        </div>
      </fieldset>

      {list.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title={t("facilities.empty")}
            body={t("facilities.emptyHint")}
            actionLabel={t("nav.home")}
            actionTo={`/c/${slug}`}
          />
        </div>
      ) : (
        <ul className="mt-6 flex list-none flex-col gap-4 p-0">
          {rows.map(({ facility: f, hours }) => {
            const facilityHref =
              partido === "1"
                ? `/c/${slug}/reservar/${f.id}?data=${data}&partido=1`
                : `/c/${slug}/reservar/${f.id}?data=${data}`;
            return (
              <li key={f.id} className="overflow-hidden rounded-[20px] border border-line bg-surface">
                <FacilityFreeCard
                  facility={f}
                  courtType={courtTypeFor(f.type)}
                  hours={hours}
                  emptyHours={t("reserve.noSlots")}
                  servicesLine={servicesLine(f.services, t)}
                  seeAllLabel={t("reserve.seeAllHours", {
                    defaultValue: "Ver todas →",
                  })}
                  seeAllHref={facilityHref}
                  nameHref={facilityHref}
                  onHourClick={(primary) => goHour(f.id, primary.date, primary.id)}
                  className="rounded-none border-0 shadow-none"
                />
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
