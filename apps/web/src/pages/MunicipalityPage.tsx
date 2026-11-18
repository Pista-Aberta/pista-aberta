import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Municipality } from "@pista-aberta/shared";
import {
  Activity,
  Building2,
  CircleDot,
  LayoutGrid,
} from "lucide-react";
import { api } from "../lib/api";
import { apiX } from "../lib/api-complete";
import {
  formatDate,
  formatDateLong,
  formatDayChip,
  formatTimeHm,
  formatWeekdayShort,
} from "../lib/format-date";
import { useSession } from "../context/SessionContext";
import { homePathForRole, isElevatedRole } from "../lib/roles";
import { downloadBookingIcs } from "../lib/booking-ics";
import { groupFreeHoursByStart } from "../lib/free-hours";
import { servicesLine } from "../lib/service-labels";
import { closureNoticeText } from "../lib/closure-notice";
import { DeputacionReadOnlyBanner } from "../components/DeputacionReadOnlyBanner";
import { FacilityFreeCard } from "../components/FacilityFreeCard";
import { InstallAppButton } from "../components/InstallAppButton";
import {
  Badge,
  Card,
  CourtLinesBg,
  type CourtArtType,
  SkeletonBlock,
  Ticket,
} from "../components/ui";

type PavilionMatch = {
  id: string;
  date: string;
  start: string;
  end: string;
  homeTeam: string;
  awayTeam: string;
  club: string;
  unit: string;
  status: string;
};

type PortadaOpenMatch = {
  id: string;
  title: string;
  date: string;
  start: string;
  end: string;
  spotsTotal: number;
  spotsTaken: number;
  facilityName?: string;
  status: string;
  iAmJoined?: boolean;
  iAmOrganizer?: boolean;
};

function waitlistOfferLive(
  n: { type: string; payload?: Record<string, unknown> | null },
  now: Date,
): boolean {
  if (n.type !== "waitlist") return false;
  const hold = n.payload?.holdUntil;
  if (typeof hold !== "string" || !hold.trim()) return false;
  const until = new Date(hold);
  if (Number.isNaN(until.getTime())) return false;
  return until.getTime() > now.getTime();
}

type NextBooking = {
  id: string;
  date: string;
  start: string;
  end: string;
  facilityName?: string;
  facilityId: string;
  shortCode: string;
};

type Facility = Awaited<ReturnType<typeof api.facilities>>["data"][number];
type Slot = Awaited<ReturnType<typeof api.availability>>["data"][number];
type Act = Awaited<ReturnType<typeof api.activities>>["data"][number];
type Notice = Awaited<ReturnType<typeof apiX.notices>>["data"][number];

const SPORT_TYPES = ["pista", "pavillon", "campo", "sala"] as const;

function isoToday() {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function isoTomorrow() {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function dayNum(iso: string) {
  return Number(iso.slice(8, 10));
}

function courtTypeFor(facilityType: string): CourtArtType {
  if (facilityType === "pavillon") return "pavillon";
  if (facilityType === "campo") return "futbol";
  if (facilityType === "sala") return "sala";
  return "padel";
}

/** Franxas de tarde (≥14:00). Se `forToday`, ignora as xa pasadas. */
function afternoonSlots(slots: Slot[], forToday: boolean) {
  let floor = "14:00";
  if (forToday) {
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(
      now.getMinutes(),
    ).padStart(2, "0")}`;
    if (hhmm > floor) floor = hhmm;
  }
  return slots
    .filter((s) => s.status === "free" && s.start >= floor)
    .sort((a, b) => a.start.localeCompare(b.start));
}

/** Todas as franxas libres (para «Libre mañá» se a tarde está baleira). */
function freeSlotsAll(slots: Slot[]) {
  return slots
    .filter((s) => s.status === "free")
    .sort((a, b) => a.start.localeCompare(b.start));
}

const SPORT_ICON: Record<string, typeof CircleDot> = {
  "": LayoutGrid,
  pista: CircleDot,
  pavillon: Building2,
  campo: Activity,
  sala: Building2,
};

export function MunicipalityPage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user, loading, municipalityMissing, municipality } = useSession();
  const tz = municipality?.settings?.timezone ?? "Europe/Madrid";
  const [muni, setMuni] = useState<Municipality | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [next, setNext] = useState<NextBooking | null>(null);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [freeToday, setFreeToday] = useState(0);
  const [activities, setActivities] = useState<Act[]>([]);
  const [freeTomorrow, setFreeTomorrow] = useState(0);
  const [autoTomorrow, setAutoTomorrow] = useState(false);
  const [quietHours, setQuietHours] = useState<string[]>([]);
  const [quietForTomorrow, setQuietForTomorrow] = useState(false);
  const [, setQuietMeta] = useState({ weeks: 4, maxOccupancyPct: 30 });
  const [actionNotice, setActionNotice] = useState<Notice | null>(null);
  const [weekendMatches, setWeekendMatches] = useState<PavilionMatch[]>([]);
  const [openMatches, setOpenMatches] = useState<PortadaOpenMatch[]>([]);

  const today = isoToday();
  const tomorrow = isoTomorrow();

  const availableTypes = useMemo(() => {
    const present = new Set(facilities.map((f) => f.type));
    return SPORT_TYPES.filter((ty) => present.has(ty));
  }, [facilities]);

  const libreTarde = useMemo(() => {
    const forToday = !autoTomorrow;
    const afternoon = afternoonSlots(slots, forToday);
    /* REVISION-33 D5: se a tarde está baleira (p.ex. mañá só ten mañá), amosar esas horas. */
    const useAllDay = autoTomorrow && afternoon.length === 0;
    const source = useAllDay ? freeSlotsAll(slots) : afternoon;
    const byFac = new Map<string, Slot[]>();
    for (const s of source) {
      const fid = s.facilityId;
      if (!fid) continue;
      const list = byFac.get(fid) ?? [];
      list.push(s);
      byFac.set(fid, list);
    }
    const courtOne = t("reserve.courtOne");
    const courtMany = t("reserve.courtMany");
    return facilities
      .map((f) => {
        /* REVISION-32 C3: total real; na tarxeta só as 3 primeiras como atallos. */
        const groupedAll = groupFreeHoursByStart(byFac.get(f.id) ?? []);
        const shown = groupedAll.slice(0, 3);
        /* REVISION-46 V11: no pavillón contar horas, non unidades incompatíbeis. */
        const pavilionLike = f.type === "pavillon";
        return {
          facility: f,
          totalFree: groupedAll.length,
          hours: shown.map((g) => ({
            primary: g.primary,
            label: g.start,
            sublabel:
              !pavilionLike && g.count > 1
                ? `${g.count} ${g.count === 1 ? courtOne : courtMany}`
                : undefined,
            count: pavilionLike ? 1 : g.count,
          })),
          allDayFallback: useAllDay,
        };
      })
      .filter((row) => row.totalFree > 0)
      .slice(0, 6);
  }, [slots, facilities, autoTomorrow, t]);

  const libreAllDayFallback =
    autoTomorrow && libreTarde.length > 0 && libreTarde.every((r) => r.allDayFallback);

  /* REVISION-47 W8: contar horas (franxas horarias), non pistas. */
  const freeAfternoonTotal = useMemo(
    () =>
      libreTarde.reduce((n, row) => n + row.hours.length, 0),
    [libreTarde],
  );

  /* REVISION-43 R9: «Hoxe quedan horas libres ás 20:00 e 21:00» (horas únicas). */
  const freeHourLabels = useMemo(() => {
    const forToday = !autoTomorrow;
    const afternoon = afternoonSlots(slots, forToday);
    const useAllDay = autoTomorrow && afternoon.length === 0;
    const source = useAllDay ? freeSlotsAll(slots) : afternoon;
    return [...new Set(source.map((s) => s.start))].sort();
  }, [slots, autoTomorrow]);

  const freeHoursPhrase = useMemo(() => {
    if (freeHourLabels.length === 0) return "";
    if (freeHourLabels.length === 1) return freeHourLabels[0]!;
    if (freeHourLabels.length === 2) {
      return `${freeHourLabels[0]} e ${freeHourLabels[1]}`;
    }
    const head = freeHourLabels.slice(0, -1).join(", ");
    const last = freeHourLabels[freeHourLabels.length - 1]!;
    return `${head} e ${last}`;
  }, [freeHourLabels]);

  /* REVISION-21 L4.1: comprobar info primeiro; non disparar APIs secundarias se falta o concello. */
  useEffect(() => {
    if (municipalityMissing) {
      setMuni(null);
      setError("muni_not_found");
      return;
    }
    let cancelled = false;
    void api
      .info(slug)
      .then((r) => {
        if (cancelled) return;
        setMuni(r.data);
        setError(null);
      })
      .catch(() => {
        if (cancelled) return;
        setMuni(null);
        setError("muni_not_found");
      });
    return () => {
      cancelled = true;
    };
  }, [slug, municipalityMissing]);

  const muniReady = Boolean(muni) && error !== "muni_not_found" && !municipalityMissing;
  const portalPreparing = muni?.settings.portalPublished === false;

  useEffect(() => {
    if (!muniReady || portalPreparing) return;
    let cancelled = false;
    void api
      .horasTranquilas(slug)
      .then((r) => {
        if (cancelled) return;
        setQuietHours(r.data.hours);
        setQuietForTomorrow(!!r.data.date && r.data.date > today);
        setQuietMeta({ weeks: r.data.weeks, maxOccupancyPct: r.data.maxOccupancyPct });
      })
      .catch(() => {
        if (cancelled) return;
        setQuietHours([]);
        setQuietForTomorrow(false);
      });
    void api
      .facilities(slug)
      .then((r) => {
        if (!cancelled) setFacilities(r.data);
      })
      .catch(() => {
        if (!cancelled) setFacilities([]);
      });
    void Promise.all([
      api.availability(slug, { date: today }),
      api.availability(slug, { date: tomorrow }),
    ])
      .then(([todayRes, tomorrowRes]) => {
        if (cancelled) return;
        const freeT =
          todayRes.meta?.freeToday ??
          todayRes.data.filter((s) => s.status === "free").length;
        const freeM = tomorrowRes.data.filter((s) => s.status === "free").length;
        setFreeToday(freeT);
        setFreeTomorrow(freeM);
        if (freeT === 0 && freeM > 0) {
          setSlots(tomorrowRes.data);
          setAutoTomorrow(true);
        } else {
          setSlots(todayRes.data);
          setAutoTomorrow(false);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setSlots([]);
        setFreeToday(0);
        setFreeTomorrow(0);
      });
    void api
      .activities(slug)
      .then((r) => {
        if (cancelled) return;
        setActivities(r.data.filter((a) => a.lotteryStatus === "open" || !a.lotteryStatus));
      })
      .catch(() => {
        if (!cancelled) setActivities([]);
      });
    /* REVISION-46 V1: partidos abertos na portada (con e sen sesión). */
    void fetch(`/api/c/${slug}/partidos-abertos`, { credentials: "include" })
      .then((r) => r.json())
      .then((j: { data?: PortadaOpenMatch[] }) => {
        if (cancelled) return;
        const now = new Date();
        const todayIso = isoToday();
        const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(
          now.getMinutes(),
        ).padStart(2, "0")}`;
        /* REVISION-48 Y7: completos só a quen xoga (API publicList + filtro UI). */
        const next = (j.data ?? [])
          .filter((m) => {
            if (m.status === "open") return m.spotsTaken < m.spotsTotal;
            if (m.status === "full") return !!(m.iAmJoined || m.iAmOrganizer);
            return false;
          })
          .filter((m) => m.date > todayIso || (m.date === todayIso && m.start > hhmm))
          .sort((a, b) =>
            a.date === b.date
              ? a.start.localeCompare(b.start)
              : a.date.localeCompare(b.date),
          )
          .slice(0, 3);
        setOpenMatches(next);
      })
      .catch(() => {
        if (!cancelled) setOpenMatches([]);
      });
    /* REVISION-40 T16: próximos partidos do pavillón na portada. */
    void api
      .pavilion(slug)
      .then((r) => {
        if (cancelled) return;
        const publicStatuses = new Set(["scheduled", "resolved", "swapped", "moved"]);
        /* REVISION-41 O8: só os que aínda non empezaron (hoxe: hora > agora). */
        const now = new Date();
        const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(
          now.getMinutes(),
        ).padStart(2, "0")}`;
        const next = r.data.matches
          .filter((m) => {
            if (!publicStatuses.has(m.status) || m.id.startsWith("proposed-")) {
              return false;
            }
            if (m.date > today) return true;
            if (m.date < today) return false;
            return m.start > hhmm;
          })
          .sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));
        setWeekendMatches(next);
      })
      .catch(() => {
        if (!cancelled) setWeekendMatches([]);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, today, tomorrow, muniReady, portalPreparing]);

  useEffect(() => {
    if (!muniReady || !user || user.role !== "citizen") {
      setNext(null);
      setActionNotice(null);
      return;
    }
    let cancelled = false;
    void api
      .myBookings(slug)
      .then((r) => {
        if (cancelled) return;
        const upcoming = r.data
          .filter((b) => b.status === "confirmed" && b.date >= today)
          .sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));
        setNext(upcoming[0] ?? null);
      })
      .catch(() => {
        if (!cancelled) setNext(null);
      });
    void apiX
      .notices(slug)
      .then((r) => {
        if (cancelled) return;
        const now = new Date();
        /* REVISION-40 T1: só ofertas de praza vivas (waitlist + holdUntil futuro). */
        const actionable =
          r.data.find((n) => !n.read && waitlistOfferLive(n, now)) ?? null;
        setActionNotice(actionable);
      })
      .catch(() => {
        if (!cancelled) setActionNotice(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user, slug, today, muniReady]);

  /* REVISION-20 H4: Deputación (superadmin) ve o portal da veciñanza en só lectura. */
  if (!loading && user && isElevatedRole(user.role) && user.role !== "superadmin") {
    const userSlug = user.municipalitySlug ?? slug;
    if (slug !== userSlug) {
      return (
        <Navigate to={homePathForRole(user.role, userSlug, user.clubId)} replace />
      );
    }
    const dest = homePathForRole(user.role, userSlug, user.clubId);
    if (dest !== `/c/${slug}`) return <Navigate to={dest} replace />;
  }

  const deputacionReadOnly = !loading && user?.role === "superadmin";

  if (!loading && user?.role === "citizen" && !user.consentAt) {
    const returnTo = encodeURIComponent(`/c/${slug}`);
    return <Navigate to={`/c/${slug}/antes-de-comezar?returnTo=${returnTo}`} replace />;
  }

  if (error === "muni_not_found" || municipalityMissing) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-ink">
        <h1 className="m-0 text-2xl font-extrabold text-marino">
          {t("login.muniNotFound")}
        </h1>
        <p className="mt-3 text-graphite">{t("login.muniNotFoundBody")}</p>
        <Link to="/" className="mt-6 inline-block font-bold text-azul-700 underline">
          {t("nav.home")}
        </Link>
      </main>
    );
  }

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

  if (!muni) {
    return (
      <main className="pa-page">
        <SkeletonBlock rows={5} />
      </main>
    );
  }

  if (portalPreparing) {
    const legal = muni.settings.legal;
    const shortName = muni.name.replace(/^Concello de\s+/i, "");
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-ink">
        {deputacionReadOnly ? (
          <DeputacionReadOnlyBanner className="mb-6" />
        ) : null}
        <h1 className="m-0 text-2xl font-extrabold text-marino">{muni.name}</h1>
        <p className="mt-4 text-graphite">
          {t("portada.preparing", { name: shortName })}
        </p>
        {/* REVISION-30 Z12: só contacto de Personalización (con escudo), non o correo do admin. */}
        {(muni.settings.logoUrl || muni.settings.logoDataUrl) && (legal?.titular || legal?.email) ? (
          <div className="mt-6 rounded-card border border-line bg-surface p-4 text-sm">
            <p className="m-0 font-extrabold text-marino">{t("portada.preparingContact")}</p>
            {legal.titular ? <p className="mt-2 m-0">{legal.titular}</p> : null}
            {legal.email ? (
              <p className="mt-1 m-0">
                <a className="font-bold text-azul-700 underline" href={`mailto:${legal.email}`}>
                  {legal.email}
                </a>
              </p>
            ) : null}
          </div>
        ) : null}
        <Link to="/" className="mt-8 inline-block font-bold text-azul-700 underline">
          {t("nav.home")}
        </Link>
      </main>
    );
  }

  const firstName = user?.displayName?.split(/\s+/)[0] ?? "";
  const openActs = activities.slice(0, 2);

  const ticketWeekday = next
    ? formatWeekdayShort(next.date, i18n.language)
    : formatWeekdayShort(tomorrow, i18n.language);
  const ticketDay = next ? dayNum(next.date) : dayNum(tomorrow);

  const resultsTitle = autoTomorrow
    ? libreAllDayFallback
      ? t("portada.freeTomorrow")
      : t("portada.freeAfternoon")
    : t("portada.freeTodayAfternoon");

  return (
    <main className="min-w-0 overflow-x-clip bg-paper pb-8 text-ink">
      {deputacionReadOnly ? (
        <DeputacionReadOnlyBanner className="mx-auto max-w-[1200px] px-4 py-3 md:px-8" />
      ) : null}
      {/* Hero claro v3 + liñas de pista */}
      <section className="pa-hero-v3 relative overflow-hidden">
        <CourtLinesBg className="pointer-events-none absolute -right-16 top-6 h-[200px] w-[320px] opacity-90 md:right-8 md:top-4 md:h-[240px] md:w-[400px]" />
        <div className="relative mx-auto max-w-[1200px] px-4 pb-24 pt-6 md:px-8 md:pb-[120px] md:pt-11">
          {user?.role === "citizen" && firstName ? (
            <p className="text-[15px] font-bold text-hero-ink">
              {t("portada.greeting", { name: firstName })}
            </p>
          ) : null}
          <h1 className="mt-1.5 max-w-xl font-display text-[32px] font-extrabold leading-tight tracking-[-0.02em] text-marino md:text-[46px]">
            {t("portada.heroAsk")}
          </h1>
          <p className="mt-2 max-w-lg text-[15px] text-hero-ink md:text-[17px]">
            {portalPreparing ? (
              <>
                {t("portada.preparing", {
                  name: muni.name.replace(/^Concello de\s+/i, ""),
                })}{" "}
                {muni.settings.legal?.email ? (
                  <span className="mt-2 block text-graphite">{muni.settings.legal.email}</span>
                ) : null}
              </>
            ) : autoTomorrow ? (
              <>
                {t("portada.freeCountTomorrowPrefix", {
                  defaultValue: "Hoxe xa non quedan horas.",
                })}{" "}
                <strong className="text-libre">
                  {/* REVISION-32 C3: total real de horas libres. */}
                  {t("portada.freeCountTomorrowPill", {
                    count: freeAfternoonTotal || freeTomorrow,
                    n: freeAfternoonTotal || freeTomorrow,
                    defaultValue: `Mañá: ${freeAfternoonTotal || freeTomorrow} libres.`,
                  })}
                </strong>
              </>
            ) : freeHoursPhrase ? (
              t("portada.freeHoursAt", {
                hours: freeHoursPhrase,
                defaultValue: `Hoxe quedan horas libres ás ${freeHoursPhrase}`,
              })
            ) : (
              t("portada.freeCount", {
                count: freeAfternoonTotal || freeToday,
                n: freeAfternoonTotal || freeToday,
              })
            )}
          </p>
        </div>
      </section>

      {/* Chips de deporte → mesma fila que en Reservar (REVISION-12 V2) */}
      <div className="relative z-10 mx-auto -mt-[72px] w-full min-w-0 max-w-[1200px] px-4 md:-mt-[88px] md:px-8">
        <div className="min-w-0 overflow-hidden rounded-[22px] bg-surface p-4 shadow-pa-alta md:rounded-[24px] md:p-[26px]">
          <fieldset className="m-0 min-w-0 max-w-full border-0 p-0">
            <legend className="mb-2.5 text-[13px] font-extrabold tracking-[0.08em] text-graphite">
              {t("portada.sportLabel")}
            </legend>
            {/* min-w-0 + overflow-x-auto: en móbil os chips fan scroll dentro da card, non estouran o viewport */}
            <div className="-mx-1 flex min-w-0 max-w-full flex-nowrap gap-2 overflow-x-auto overscroll-x-contain px-1 pb-1 touch-pan-x [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {(() => {
                const chip = (on: boolean) =>
                  `inline-flex h-10 max-w-[11rem] shrink-0 items-center gap-1.5 rounded-full border-[1.5px] px-3.5 text-sm font-extrabold ${
                    on
                      ? "border-marino bg-marino text-on-dark"
                      : "border-line bg-surface text-marino hover:border-marino"
                  }`;
                return (
                  <>
                    <button
                      type="button"
                      className={chip(false)}
                      onClick={() => navigate(`/c/${slug}/reservar`)}
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
                          className={chip(false)}
                          onClick={() =>
                            navigate(`/c/${slug}/reservar?deporte=${ty}`)
                          }
                        >
                          <Icon size={16} strokeWidth={1.9} aria-hidden className="shrink-0" />
                          <span className="truncate">{t(`facilities.type.${ty}`)}</span>
                        </button>
                      );
                    })}
                  </>
                );
              })()}
            </div>
          </fieldset>
          {/* Web instalable — só móbil (non panel admin). */}
          <div className="mt-4 border-t border-line pt-4 lg:hidden">
            <p className="m-0 mb-2 text-sm text-graphite">
              {t("install.homeHint")}
            </p>
            <InstallAppButton compact />
          </div>
        </div>
      </div>

      {actionNotice
        ? (() => {
            const p = actionNotice.payload ?? {};
            const day =
              typeof p.date === "string"
                ? formatDayChip(p.date, i18n.language)
                : "";
            const start = typeof p.start === "string" ? p.start : "";
            const unit =
              typeof p.unitName === "string" && p.unitName.trim()
                ? p.unitName.trim()
                : "";
            const fac =
              typeof p.facilityName === "string" && p.facilityName.trim()
                ? p.facilityName.trim()
                : "";
            const hold =
              typeof p.holdUntil === "string"
                ? formatTimeHm(p.holdUntil, tz)
                : "";
            /* REVISION-43 R3: unidade (pista) · día · hora. */
            const parts = [
              unit || fac || null,
              day || null,
              start || null,
              hold ? `ata as ${hold}` : null,
            ].filter(Boolean);
            const banner = `${t("portada.waitlistBannerLead", {
              defaultValue: "Liberouse unha praza",
            })}: ${parts.join(" · ")}`;
            return (
              <div className="mx-auto mt-4 max-w-[1200px] px-4 md:px-8">
                <Link
                  to={`/c/${slug}/avisos`}
                  className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-ambar bg-ambar-bg px-4 py-3 font-bold text-marino no-underline"
                >
                  <span>{banner}</span>
                  <span className="shrink-0 text-azul-700">{t("notices.accept")}</span>
                </Link>
              </div>
            );
          })()
        : null}

      {/* Billete móbil */}
      {next ? (
        <div className="mx-auto mt-5 max-w-[1200px] px-4 md:hidden">
          <Ticket
            compact
            weekday={ticketWeekday}
            day={ticketDay}
            title={`${next.facilityName ?? next.facilityId} · ${next.start}`}
            onQr={() => navigate(`/c/${slug}/reserva/${next.id}`)}
          />
        </div>
      ) : null}

      <div className="mx-auto mt-6 flex max-w-[1200px] flex-col gap-8 px-4 md:mt-9 md:flex-row md:flex-wrap md:gap-8 md:px-8">
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="m-0 text-[21px] font-extrabold text-marino md:text-[26px]">
              {resultsTitle}
            </h2>
            <Link to={`/c/${slug}/reservar`} className="font-bold text-azul-700 no-underline">
              {t("portada.allHours")}
            </Link>
          </div>

          {quietHours.length > 0 ? (
            <p className="text-sm text-graphite">
              <strong className="text-marino">
                {t(
                  quietForTomorrow
                    ? "portada.quietHoursTomorrow"
                    : "portada.quietHours",
                  { hours: quietHours.join(", ") },
                )}
              </strong>
              {/* REVISION-40 T12 */}
              <span className="mt-1 block text-xs">{t("portada.quietHoursHint")}</span>
            </p>
          ) : null}

          {libreTarde.length === 0 ? (
            <p className="text-sm text-graphite">
              {autoTomorrow
                ? t("portada.noFreeTomorrow")
                : t("portada.noAfternoon")}
            </p>
          ) : (
            <ul className="flex list-none flex-col gap-4 p-0">
              {libreTarde.map(({ facility: f, hours }) => (
                <li key={f.id}>
                  <FacilityFreeCard
                    facility={f}
                    courtType={courtTypeFor(f.type)}
                    hours={hours}
                    freeBadge={t("portada.freeBadge", {
                      count: hours.length,
                      n: hours.length,
                    })}
                    servicesLine={servicesLine(f.services, t)}
                    closureNotice={(() => {
                      const c = f.upcomingClosures?.[0];
                      if (!c) return undefined;
                      const unitName = c.unitId
                        ? f.units.find((u) => u.id === c.unitId)?.name ?? null
                        : null;
                      return closureNoticeText(
                        { ...c, unitName },
                        i18n.language,
                        t,
                        formatDateLong,
                      );
                    })()}
                    seeAllLabel={t("reserve.seeAllHours", {
                      defaultValue: "Ver todas →",
                    })}
                    seeAllHref={`/c/${slug}/reservar/${f.id}?data=${hours[0]?.primary.date ?? ""}`}
                    nameHref={`/c/${slug}/reservar/${f.id}`}
                    onHourClick={(primary) =>
                      navigate(
                        `/c/${slug}/reservar/${f.id}?data=${primary.date}&slot=${primary.id}`,
                      )
                    }
                  />
                </li>
              ))}
            </ul>
          )}

          {/* REVISION-46 V1: partidos abertos (3 próximos con prazas + Ver todos). */}
          <div className="mt-4 flex items-baseline justify-between gap-3">
            <h2 className="m-0 text-[21px] font-extrabold text-marino md:text-[26px]">
              {t("portada.openMatches")}
            </h2>
            <Link
              to={`/c/${slug}/partidos-abertos`}
              className="font-bold text-azul-700 no-underline"
            >
              {t("portada.openMatchesSeeAll")}
            </Link>
          </div>
          {openMatches.length === 0 ? (
            <p className="text-sm text-graphite">
              <Link
                to={`/c/${slug}/partidos-abertos`}
                className="font-bold underline"
              >
                {t("openMatch.empty")}
              </Link>
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {openMatches.map((m) => (
                <Card key={m.id} className="flex flex-col gap-1.5 p-5">
                  <strong className="text-base font-extrabold text-marino">
                    {m.title}
                  </strong>
                  <span className="text-sm text-graphite">
                    {formatDayChip(m.date, i18n.language)} · {m.start}–{m.end}
                    {m.facilityName ? ` · ${m.facilityName}` : ""}
                  </span>
                  <span className="flex justify-between text-[13px] text-graphite">
                    <span>
                      {m.spotsTaken >= m.spotsTotal || m.status === "full"
                        ? t("openMatch.statusFull")
                        : t("portada.openMatchesSpots", {
                            taken: m.spotsTaken,
                            total: m.spotsTotal,
                          })}
                    </span>
                    <Link
                      to={`/c/${slug}/partidos-abertos/${m.id}`}
                      className="font-extrabold text-azul-700 no-underline"
                    >
                      {t("openMatch.viewFromBooking")}
                    </Link>
                  </span>
                </Card>
              ))}
            </div>
          )}

          <div className="mt-4 flex items-baseline justify-between gap-3">
            <h2 className="m-0 text-[21px] font-extrabold text-marino md:text-[26px]">
              {t("portada.openActivities")}
            </h2>
            <Link
              to={`/c/${slug}/actividades`}
              className="font-bold text-azul-700 no-underline"
            >
              {t("portada.seeAll")}
            </Link>
          </div>
          {openActs.length === 0 ? (
            <p className="text-sm text-graphite">
              <Link to={`/c/${slug}/actividades`} className="font-bold underline">
                {t("portada.noActivities")}
              </Link>
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {openActs.map((a) => {
                const lottery = a.method === "lottery";
                return (
                  <Card key={a.id} className="flex flex-col gap-2.5 p-5">
                    <Badge tone={lottery ? "aviso" : "libre"}>
                      {lottery
                        ? t("portada.methodLottery")
                        : t("portada.methodFirstCome")}
                    </Badge>
                    <strong className="text-lg font-extrabold text-marino">{a.name}</strong>
                    <span className="text-sm text-graphite">
                      {a.days} · {a.hours}
                    </span>
                    <span className="flex justify-between text-[13px] text-graphite">
                      <span>{t("portada.placesTotal", { count: a.places, n: a.places })}</span>
                      <Link
                        to={`/c/${slug}/actividades/${a.id}`}
                        className="font-extrabold text-azul-700 no-underline"
                      >
                        {t("portada.enroll")}
                      </Link>
                    </span>
                  </Card>
                );
              })}
            </div>
          )}

          {/* REVISION-40 T16: sección pavillón como inscricións. */}
          {weekendMatches.length > 0 ? (
            <>
              <div className="mt-4 flex items-baseline justify-between gap-3">
                <h2 className="m-0 text-[21px] font-extrabold text-marino md:text-[26px]">
                  {t("weekend.title")}
                </h2>
                <Link
                  to={`/c/${slug}/pavillon`}
                  className="font-bold text-azul-700 no-underline"
                >
                  {t("portada.seeAll")}
                </Link>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {weekendMatches.slice(0, 3).map((m) => (
                  <Card key={m.id} className="flex flex-col gap-1.5 p-5">
                    <strong className="text-base font-extrabold text-marino">
                      {m.homeTeam} – {m.awayTeam}
                    </strong>
                    <span className="text-sm text-graphite">
                      {formatDayChip(m.date, i18n.language)} · {m.start}–{m.end}
                    </span>
                    <span className="text-xs text-graphite">
                      {m.club}
                      {m.unit ? ` · ${m.unit}` : ""}
                    </span>
                  </Card>
                ))}
              </div>
            </>
          ) : null}
        </div>

        {/* REVISION-44 S2: sen flex-basis 320px no móbil (queda oco baleiro). */}
        {next ? (
          <aside className="hidden min-w-0 flex-col gap-4 lg:flex lg:flex-[1_1_320px]">
            <Ticket
              weekday={ticketWeekday}
              day={ticketDay}
              title={`${next.facilityName ?? next.facilityId}`}
              subtitle={`${next.start}–${next.end} · ${formatDate(next.date, i18n.language)}`}
              onQr={() => navigate(`/c/${slug}/reserva/${next.id}`)}
              onCalendar={() =>
                downloadBookingIcs({
                  id: next.id,
                  facilityName: next.facilityName ?? next.facilityId,
                  date: next.date,
                  start: next.start,
                  end: next.end,
                  shortCode: next.shortCode,
                  slug,
                })
              }
            />
          </aside>
        ) : null}
      </div>
    </main>
  );
}
