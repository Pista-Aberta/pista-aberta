import { Link, useParams, useSearchParams } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatOfferCountdown } from "@pista-aberta/shared";
import { api } from "../lib/api";
import { apiX } from "../lib/api-complete";
import { EmptyState } from "../components/EmptyState";
import { CancelDialog } from "../components/CancelDialog";
import { PersonalMonthCalendar } from "../components/PersonalMonthCalendar";
import { useSession } from "../context/SessionContext";
import { madridTodayAndHm } from "../lib/madrid-date";

type Row = Awaited<ReturnType<typeof api.myBookings>>["data"][number] & {
  municipalitySlug?: string;
  municipalityName?: string;
  municipalityLogoDataUrl?: string | null;
  checkInRequired?: boolean;
};
type WaitRow = Awaited<ReturnType<typeof apiX.myWaitlist>>["data"][number];
type PartidoRow = Awaited<ReturnType<typeof apiX.myPartidos>>["data"][number];

type UpcomingItem =
  | { kind: "booking"; sortKey: string; booking: Row; match?: PartidoRow }
  | { kind: "match"; sortKey: string; match: PartidoRow };

function bookingSortKey(b: { date: string; start: string }) {
  return `${b.date}T${b.start}`;
}

function muniSlugFor(row: Row, pageSlug: string) {
  return row.municipalitySlug ?? pageSlug;
}

const DOW = ["DOM", "LUN", "MAR", "MÉR", "XOV", "VEN", "SÁB"];

/** «Estou aquí» activo desde 10 min antes ata o final da franxa. */
function imHereActive(date: string, start: string, end: string, nowMs: number): boolean {
  const open = new Date(`${date}T${start}:00`);
  const close = new Date(`${date}T${end}:00`);
  if (Number.isNaN(open.getTime()) || Number.isNaN(close.getTime())) return false;
  return nowMs >= open.getTime() - 10 * 60_000 && nowMs <= close.getTime();
}

export function MyBookingsPage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useTranslation();
  const { user, municipality } = useSession();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [waitRows, setWaitRows] = useState<WaitRow[]>([]);
  const [partidos, setPartidos] = useState<PartidoRow[]>([]);
  const [tab, setTab] = useState<
    "upcoming" | "partidos" | "past" | "waiting" | "calendar"
  >("upcoming");
  const [scope, setScope] = useState<"this" | "all">("this");
  const [cancelTarget, setCancelTarget] = useState<{ id: string; muniSlug: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const declineHandled = useRef(false);
  const [maxActive, setMaxActive] = useState(3);
  const [cancelMinHours, setCancelMinHours] = useState(2);
  const [checkInMarginMinutes, setCheckInMarginMinutes] = useState(30);
  const [toast, setToast] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });
  const [calFeed, setCalFeed] = useState<{
    webcalUrl: string;
    httpsUrl: string;
  } | null>(null);
  const [calBusy, setCalBusy] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const load = useCallback(() => {
    if (!user) {
      setRows(null);
      setWaitRows([]);
      setPartidos([]);
      return;
    }
    void (scope === "all"
      ? api
          .myBookingsAll()
          .then((r) => setRows(r.data))
          .catch(() => setError(t("common.error")))
      : api
          .myBookings(slug)
          .then((r) => setRows(r.data))
          .catch(() => setError(t("common.error"))));
    void apiX
      .myWaitlist(slug)
      .then((r) => setWaitRows(r.data))
      .catch(() => setWaitRows([]));
    void apiX
      .myPartidos(slug)
      .then((r) => setPartidos(r.data))
      .catch(() => setPartidos([]));
    void api.info(slug).then((r) => {
      setMaxActive(r.data.settings.maxActiveBookings ?? 3);
      setCancelMinHours(r.data.settings.cancelMinHours ?? 2);
      setCheckInMarginMinutes(r.data.settings.checkInMarginMinutes ?? 30);
    });
  }, [slug, user, t, scope]);

  useEffect(load, [load]);

  useEffect(() => {
    if (!user) {
      setCalFeed(null);
      return;
    }
    void apiX
      .calendarFeed(slug)
      .then((r) => setCalFeed({ webcalUrl: r.data.webcalUrl, httpsUrl: r.data.httpsUrl }))
      .catch(() => setCalFeed(null));
  }, [user, slug]);

  const tz = municipality?.settings?.timezone ?? "Europe/Madrid";
  const { today, hm: nowHm } = madridTodayAndHm(new Date(nowTick), tz);
  const isLiveStatus = (status: string) =>
    status === "confirmed" || status === "pending";
  /* REVISION-58 W3 + REVISION-60 N11: rematadas de hoxe (en Europe/Madrid) e no_show van a pasadas. */
  const bookingIsPast = useCallback(
    (b: { date: string; end: string; status: string }) => {
      if (
        b.status === "cancelled" ||
        b.status === "checked_in" ||
        b.status === "no_show"
      ) {
        return true;
      }
      if (b.date < today) return true;
      if (b.date > today) return false;
      return b.end <= nowHm;
    },
    [today, nowHm],
  );

  const activeCount = useMemo(() => {
    if (!rows) return 0;
    return rows.filter((b) => {
      if (!isLiveStatus(b.status) || muniSlugFor(b, slug) !== slug) return false;
      return !bookingIsPast(b);
    }).length;
  }, [rows, slug, bookingIsPast]);
  const filtered = useMemo(() => {
    if (!rows) return [];
    const list = rows.filter((b) => {
      const past = bookingIsPast(b);
      return tab === "past" ? past : !past && isLiveStatus(b.status);
    });
    list.sort((a, b) => bookingSortKey(a).localeCompare(bookingSortKey(b)));
    return list;
  }, [rows, tab, bookingIsPast]);

  const groupedByMuni = useMemo(() => {
    if (scope !== "all" || filtered.length === 0) return null;
    const map = new Map<
      string,
      { name: string; logo?: string | null; rows: Row[] }
    >();
    for (const b of filtered) {
      const key = muniSlugFor(b, slug);
      const entry = map.get(key) ?? {
        name: b.municipalityName ?? key,
        logo: b.municipalityLogoDataUrl,
        rows: [],
      };
      entry.rows.push(b);
      map.set(key, entry);
    }
    return [...map.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [scope, filtered, slug]);

  const partidoNotEnded = useCallback(
    (p: PartidoRow) => {
      if (p.date > today) return true;
      if (p.date < today) return false;
      const now = new Date(nowTick);
      const hh = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      return p.end > hh;
    },
    [today, nowTick],
  );

  const upcomingPartidos = useMemo(
    () => partidos.filter((p) => partidoNotEnded(p)),
    [partidos, partidoNotEnded],
  );

  const organizerMatchByBooking = useMemo(() => {
    const m = new Map<string, PartidoRow>();
    for (const p of partidos) {
      if (p.role === "organizer" && p.bookingId) m.set(p.bookingId, p);
    }
    return m;
  }, [partidos]);

  /* REVISION-47 W8: lista mesclada (reservas + partidos nos que xogas). */
  const upcomingMergedList = useMemo((): UpcomingItem[] => {
    if (!rows) return [];
    const list: UpcomingItem[] = [];
    const liveBookings = rows.filter((b) => {
      const inScope = scope === "all" || muniSlugFor(b, slug) === slug;
      return !bookingIsPast(b) && isLiveStatus(b.status) && inScope;
    });
    for (const b of liveBookings) {
      list.push({
        kind: "booking",
        sortKey: bookingSortKey(b),
        booking: b,
        match: organizerMatchByBooking.get(b.id),
      });
    }
    for (const p of upcomingPartidos) {
      if (p.role !== "player") continue;
      list.push({ kind: "match", sortKey: bookingSortKey(p), match: p });
    }
    list.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    return list;
  }, [scope, rows, upcomingPartidos, organizerMatchByBooking, slug, bookingIsPast]);

  const upcomingMerged =
    scope === "this" && tab === "upcoming" ? upcomingMergedList : null;

  const calendarBookings = useMemo(() => {
    if (!rows) return [];
    const fromBookings = rows
      .filter((b) => isLiveStatus(b.status))
      .map((b) => ({
        id: b.id,
        date: b.date,
        start: b.start,
        facilityName: (b as Row & { facilityName?: string }).facilityName,
      }));
    const playerOnly = upcomingPartidos.filter((p) => p.role === "player");
    const fromMatches = playerOnly.map((p) => ({
      id: `om-${p.id}`,
      date: p.date,
      start: p.start,
      title: p.title,
      openMatchId: p.id,
    }));
    return [...fromBookings, ...fromMatches];
  }, [rows, upcomingPartidos]);

  const doCancel = async () => {
    if (!cancelTarget) return;
    setBusy(true);
    try {
      const res = await api.cancelBooking(
        cancelTarget.muniSlug,
        cancelTarget.id,
      );
      setCancelTarget(null);
      const offered = res.offeredTo ?? 0;
      setToast(
        offered > 0
          ? t("bookings.cancelToast")
          : t("bookings.cancelToastFree", {
              defaultValue:
                "Cancelada. A hora queda libre para outra persoa",
            }),
      );
      window.setTimeout(() => setToast(null), 5000);
      load();
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      const key = code ? `error.${code}` : "";
      const translated = key ? t(key) : "";
      setError(
        translated && translated !== key ? translated : t("common.error"),
      );
    } finally {
      setBusy(false);
    }
  };

  const doLeaveMatch = async (matchId: string) => {
    setBusy(true);
    try {
      await fetch(`/api/c/${slug}/partidos-abertos/${matchId}/sair`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }).then(async (r) => {
        if (!r.ok) {
          const j = (await r.json()) as { error?: string };
          throw new Error(j.error ?? "error");
        }
      });
      setToast(t("openMatch.left"));
      window.setTimeout(() => setToast(null), 4000);
      load();
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      const key = code ? `error.${code}` : "";
      const translated = key ? t(key) : "";
      setError(
        translated && translated !== key ? translated : t("common.error"),
      );
    } finally {
      setBusy(false);
    }
  };

  const doCancelMatch = async (matchId: string) => {
    setBusy(true);
    try {
      await fetch(`/api/c/${slug}/partidos-abertos/${matchId}/cancelar`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }).then(async (r) => {
        if (!r.ok) {
          const j = (await r.json()) as { error?: string };
          throw new Error(j.error ?? "error");
        }
      });
      setToast(t("openMatch.cancelled"));
      window.setTimeout(() => setToast(null), 4000);
      load();
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      const key = code ? `error.${code}` : "";
      const translated = key ? t(key) : "";
      setError(
        translated && translated !== key ? translated : t("common.error"),
      );
    } finally {
      setBusy(false);
    }
  };

  const leaveWait = async (slotId: string) => {
    setBusy(true);
    try {
      await apiX.leaveWaitlist(slug, slotId);
      load();
    } catch {
      setError(t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  /* CORREOS §7 — «Xa non a quero» desde o correo (require sesión). */
  useEffect(() => {
    const slotId = searchParams.get("deixar");
    if (!user || !slotId || declineHandled.current) return;
    declineHandled.current = true;
    setTab("waiting");
    void (async () => {
      try {
        await apiX.leaveWaitlist(slug, slotId);
        setToast(
          t("bookings.declineOfferToast", {
            defaultValue: "Xa non queres esa praza. Sacámosche da lista.",
          }),
        );
        window.setTimeout(() => setToast(null), 5000);
        load();
      } catch {
        setError(t("common.error"));
      } finally {
        const next = new URLSearchParams(searchParams);
        next.delete("deixar");
        setSearchParams(next, { replace: true });
      }
    })();
  }, [user, searchParams, slug, t, setSearchParams, load]);

  if (!user) {
    return (
      <main className="pa-page">
        <EmptyState
          title={t("nav.myBookings")}
          body={t("common.needLogin")}
          actionLabel={t("nav.identify")}
          actionTo={`/c/${slug}/acceso?returnTo=/c/${slug}/reservas`}
        />
      </main>
    );
  }

  if (!rows && !error) {
    return (
      <main className="pa-page">
        <p className="text-graphite">{t("common.loading")}</p>
      </main>
    );
  }

  /* REVISION-47 W8: «Próximas · N» conta todo o mostrado (reservas + partidos). */
  const upcomingCount = upcomingMergedList.length;

  const statusLabel = (status: string) => {
    if (status === "confirmed") return t("bookings.statusConfirmed");
    if (status === "pending") return t("bookings.statusPending");
    if (status === "cancelled") return t("bookings.statusCancelled");
    return t("bookings.statusCheckedIn");
  };

  const matchSpotsLine = (p: PartidoRow) => {
    const need = Math.max(0, p.spotsTotal - p.spotsTaken);
    if (p.status === "full") {
      return t("bookings.matchStatusFull");
    }
    return need > 0
      ? `${t("bookings.matchSpots", { taken: p.spotsTaken, total: p.spotsTotal })} · ${t("bookings.matchSpotsNeed", { need })}`
      : t("bookings.matchSpots", { taken: p.spotsTaken, total: p.spotsTotal });
  };

  const renderMatchCard = (p: PartidoRow, onPartidosTab: boolean) => {
    const d = new Date(p.date + "T12:00:00");
    const org = p.role === "organizer";
  return (
      <li key={p.id} className="pa-card flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <div className="flex h-16 w-16 flex-none flex-col items-center justify-center rounded-btn bg-ink text-white">
            <span className="text-[13px] font-bold">{DOW[d.getDay()]}</span>
            <span className="text-2xl font-bold leading-none">{d.getDate()}</span>
          </div>
          <div className="min-w-0 flex-1">
            <MatchTitleRow p={p} org={org} t={t} />
            <p className="text-sm text-graphite">
              {p.start} — {p.end}
              {p.facilityName ? ` · ${p.facilityName}` : ""}
            </p>
            <p className="text-sm text-graphite">
              {org
                ? matchSpotsLine(p)
                : p.organizerName
                  ? `${t("bookings.matchOrganizer", { name: p.organizerName })} · ${matchSpotsLine(p)}`
                  : matchSpotsLine(p)}
            </p>
          </div>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
          <Link
            to={`/c/${slug}/partidos-abertos/${p.id}`}
            className="pa-btn-primary min-h-11 w-full px-4 text-center text-sm sm:w-auto"
          >
            {t("bookings.viewMatch")}
          </Link>
          {onPartidosTab ? (
            org ? (
              <button
                type="button"
                className="pa-btn-danger min-h-11 w-full px-4 text-sm sm:w-auto"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(t("openMatch.cancelConfirm"))) return;
                  void doCancelMatch(p.id);
                }}
              >
                {t("openMatch.cancel")}
              </button>
            ) : (
              <button
                type="button"
                className="pa-btn-secondary min-h-11 w-full px-4 text-sm sm:w-auto"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(t("openMatch.leaveConfirm"))) return;
                  void doLeaveMatch(p.id);
                }}
              >
                {t("openMatch.leave")}
              </button>
            )
          ) : null}
        </div>
      </li>
    );
  };

  function MatchTitleRow({
    p,
    org,
    t: tr,
  }: {
    p: PartidoRow;
    org: boolean;
    t: typeof t;
  }) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="m-0 text-lg font-bold break-words">{p.title}</p>
        <span
          className={
            org
              ? "rounded-full bg-azul-50 px-2 py-0.5 text-xs font-bold text-azul-700"
              : "rounded-full bg-libre-bg px-2 py-0.5 text-xs font-bold text-okText"
          }
        >
          {org ? tr("bookings.organizas") : tr("bookings.xogas")}
        </span>
      </div>
    );
  }

  const renderBookingCard = (b: Row, linkedMatch?: PartidoRow) => {
    const d = new Date(b.date + "T12:00:00");
    const muni = muniSlugFor(b, slug);
    const confirmed = b.status === "confirmed";
    const pending = b.status === "pending";
    const showOrg = linkedMatch?.role === "organizer";
    return (
      <li key={b.id} className="pa-card flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <div className="flex h-16 w-16 flex-none flex-col items-center justify-center rounded-btn bg-ink text-white">
            <span className="text-[13px] font-bold">{DOW[d.getDay()]}</span>
            <span className="text-2xl font-bold leading-none">{d.getDate()}</span>
          </div>
          <div className="min-w-0 flex-1">
            {showOrg && linkedMatch ? (
              <MatchTitleRow p={linkedMatch} org t={t} />
            ) : (
              <p className="text-lg font-bold break-words">
                {b.facilityName ?? b.facilityId}
              </p>
            )}
            <p className="text-sm text-graphite">
              {b.start} — {b.end}
              {showOrg && b.facilityName ? ` · ${b.facilityName}` : ""} · {b.shortCode}
            </p>
            <span
              className={
                confirmed
                  ? "pa-chip-ok mt-2"
                  : pending
                    ? "pa-chip-warn mt-2"
                    : b.status === "cancelled"
                      ? "pa-chip-off mt-2"
                      : "pa-chip-ink mt-2"
              }
            >
              {statusLabel(b.status)}
            </span>
            {pending ? (
              <p className="mt-2 text-sm text-graphite">{t("bookings.pendingHint")}</p>
            ) : null}
          </div>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
          {linkedMatch ? (
            <Link
              to={`/c/${slug}/partidos-abertos/${linkedMatch.id}`}
              className="pa-btn-primary min-h-11 w-full px-4 text-center text-sm sm:w-auto"
            >
              {t("bookings.viewMatch")}
            </Link>
          ) : (
            <Link
              to={`/c/${muni}/reserva/${b.id}`}
              className="pa-btn-primary min-h-11 w-full px-4 text-center text-sm sm:w-auto"
            >
              {t("bookings.viewQr")}
            </Link>
          )}
          {confirmed && tab === "upcoming" && (
            <Link
              to={`/c/${muni}/reservar/${b.facilityId}?data=${b.date}&slot=${b.slotId}&modificar=${b.id}`}
              className="pa-btn-secondary min-h-11 w-full px-4 text-center text-sm sm:w-auto"
            >
              {t("bookings.modify", { defaultValue: "Cambiar" })}
            </Link>
          )}
          {confirmed &&
            tab === "upcoming" &&
            !b.checkInRequired &&
            imHereActive(b.date, b.start, b.end, nowTick) && (
              <button
                type="button"
                className="pa-btn-secondary min-h-11 w-full px-4 text-sm sm:w-auto"
                disabled={busy}
                onClick={() =>
                  void apiX
                    .selfCheckIn(muni, b.id)
                    .then(() => load())
                    .catch((e) => {
                      const code = e instanceof Error ? e.message : "error";
                      const key = `error.${code}`;
                      const msg = t(key, { min: checkInMarginMinutes });
                      setError(msg === key ? t("common.error") : msg);
                    })
                }
              >
                {t("bookings.imHere")}
              </button>
            )}
          {(confirmed || pending) && (
            <button
              type="button"
              className="pa-btn-danger min-h-11 w-full px-4 text-sm sm:w-auto"
              onClick={() => setCancelTarget({ id: b.id, muniSlug: muni })}
            >
              {t("bookings.cancel")}
            </button>
          )}
        </div>
      </li>
    );
  };

  return (
    <main className="pa-page">
      <div className="flex items-start justify-between gap-3">
        <h1 className="pa-h1 m-0">{t("nav.myBookings")}</h1>
        <button
          type="button"
          className={`mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border-[1.5px] ${
            tab === "calendar"
              ? "border-marino bg-marino text-on-dark"
              : "border-line bg-surface text-marino"
          }`}
          aria-pressed={tab === "calendar"}
          aria-label={t("bookings.calendarTab")}
          onClick={() => setTab("calendar")}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M3 10h18M8 3v4M16 3v4" />
          </svg>
        </button>
      </div>
      <p className="mt-2 text-sm text-graphite">
        {t("bookings.quotaWithMatches", {
          count: Math.max(0, maxActive - activeCount),
          remaining: Math.max(0, maxActive - activeCount),
          max: maxActive,
          matchesNote: t("bookings.quotaOpenMatchesNote"),
        })}
        {" · "}
        {t("bookings.cancelDeadline", { hours: cancelMinHours })}
      </p>
      <div
        className="mt-4 flex flex-wrap gap-2"
        role="group"
        aria-label={t("bookings.scopeThis")}
      >
        {(
          [
            ["this", t("bookings.scopeThis")],
            ["all", t("bookings.scopeAll")],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={scope === id}
            className={`min-h-11 rounded-full border-[1.5px] px-4 text-sm font-extrabold ${
              scope === id
                ? "border-marino bg-marino text-on-dark"
                : "border-line bg-surface text-marino"
            }`}
            onClick={() => setScope(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {toast && (
        <p className="pa-ok-banner mt-4" role="status">
          ✓ {toast}
        </p>
      )}

      {tab !== "calendar" ? (
      <div
        role="tablist"
        className="mt-6 flex flex-nowrap gap-4 overflow-x-auto border-b border-line [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {(
          [
            ["upcoming", t("bookings.upcoming"), upcomingCount],
            ["partidos", t("bookings.partidos"), upcomingPartidos.length],
            ["waiting", t("bookings.waiting"), waitRows.length],
            ["past", t("bookings.past"), null],
          ] as const
        ).map(([id, label, count]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`min-h-11 shrink-0 border-b-[3px] px-1 pb-2 text-base font-bold ${
              tab === id ? "border-ink text-ink" : "border-transparent text-graphite"
            }`}
          >
            {label}
            {count !== null ? ` · ${count}` : ""}
          </button>
        ))}
      </div>
      ) : (
        <div className="mt-4">
          <button
            type="button"
            className="text-sm font-bold text-azul-700 underline"
            onClick={() => setTab("upcoming")}
          >
            ← {t("bookings.upcoming")}
          </button>
        </div>
      )}

      {error && (
        <div className="pa-warn-banner mt-4" role="alert">
          <span aria-hidden>⚠</span>
          <span>{error}</span>
        </div>
      )}

      {tab === "calendar" ? (
        <div className="mt-6 flex flex-col gap-4">
          <PersonalMonthCalendar
            slug={slug}
            month={calMonth}
            onMonthChange={setCalMonth}
            bookings={calendarBookings}
          />
          {calFeed ? (
            <div className="pa-card flex flex-col gap-3 p-4">
              <p className="m-0 text-sm text-graphite">{t("bookings.calendarHint")}</p>
              <div className="flex flex-wrap gap-2">
                <a href={calFeed.webcalUrl} className="pa-btn-primary min-h-11 px-4 text-sm">
                  {t("bookings.calendarSubscribe")}
                </a>
                <button
                  type="button"
                  className="pa-btn-secondary min-h-11 px-4 text-sm"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(calFeed.webcalUrl)
                      .then(() => {
                        setToast(t("bookings.calendarCopyWebcal"));
                        window.setTimeout(() => setToast(null), 4000);
                      })
                      .catch(() => setError(t("common.error")))
                  }
                >
                  {t("bookings.calendarCopyWebcal")}
                </button>
                <button
                  type="button"
                  className="pa-btn-secondary min-h-11 px-4 text-sm"
                  disabled={calBusy}
                  onClick={() => {
                    setCalBusy(true);
                    void apiX
                      .rotateCalendarFeed(slug)
                      .then((r) => {
                        setCalFeed({ webcalUrl: r.data.webcalUrl, httpsUrl: r.data.httpsUrl });
                        setToast(t("bookings.calendarRotate"));
                        window.setTimeout(() => setToast(null), 4000);
                      })
                      .catch(() => setError(t("common.error")))
                      .finally(() => setCalBusy(false));
                  }}
                >
                  {t("bookings.calendarRotate")}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : tab === "partidos" ? (
        upcomingPartidos.length === 0 ? (
          <div className="mt-6 flex flex-col gap-4">
            <EmptyState
              title={t("bookings.partidosEmpty")}
              body={t("bookings.partidosEmptyHint")}
              actionLabel={t("bookings.partidosCta")}
              actionTo={`/c/${slug}/partidos-abertos`}
            />
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-4">
            <ul className="space-y-3">
              {upcomingPartidos.map((p) => renderMatchCard(p, true))}
            </ul>
            <div className="pa-card flex flex-wrap items-center justify-between gap-3 border-dashed p-4">
              <p className="m-0 text-sm text-graphite">{t("bookings.partidosEmptyHint")}</p>
              <Link
                to={`/c/${slug}/partidos-abertos`}
                className="pa-btn-primary min-h-11 shrink-0 px-4 text-sm"
              >
                {t("bookings.partidosCta")}
              </Link>
            </div>
            <p className="m-0 rounded-2xl border border-line bg-paper p-4 text-sm text-graphite">
              <strong className="text-ink">{t("bookings.upcoming")}</strong>
              <br />
              {t("bookings.partidosUpcomingHint")}
            </p>
          </div>
        )
      ) : tab === "waiting" ? (
        waitRows.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              title={t("bookings.waitingEmpty")}
              body={t("bookings.waitingEmptyHint")}
              actionLabel={t("facilities.book")}
              actionTo={`/c/${slug}/reservar`}
            />
          </div>
        ) : (
          <ul className="mt-6 space-y-3">
            {waitRows.map((w) => (
              <li key={w.id} className="pa-card flex flex-wrap items-center gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-bold">{t("bookings.waitingItem")}</p>
                  <p className="text-sm text-graphite">
                    {w.status === "offered"
                      ? t("bookings.waitingOffered")
                      : t("bookings.waitingQueued")}
                  </p>
                  {w.status === "offered" &&
                    (() => {
                      void nowTick;
                      const label = formatOfferCountdown(w.offeredUntil);
                      return label ? (
                        <p className="mt-1 text-sm font-bold text-warnText">{label}</p>
                      ) : null;
                    })()}
                </div>
                <div className="flex flex-wrap gap-2">
                  {w.status === "offered" && (
                    <Link to={`/c/${slug}/avisos`} className="pa-btn-primary min-h-11 px-4 text-sm">
                      {t("notices.accept")}
                    </Link>
                  )}
                  <button
                    type="button"
                    className="pa-btn-secondary min-h-11 px-4 text-sm"
                    disabled={busy}
                    onClick={() => void leaveWait(w.slotId)}
                  >
                    {t("bookings.leaveWait")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : tab === "upcoming" && upcomingMerged ? (
        upcomingMerged.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              title={t("bookings.empty")}
              body={t("bookings.emptyHint")}
              actionLabel={t("facilities.book")}
              actionTo={`/c/${slug}/reservar`}
            />
          </div>
        ) : (
          <ul className="mt-6 space-y-3">
            {upcomingMerged.map((item) =>
              item.kind === "booking" ? (
                renderBookingCard(item.booking, item.match)
              ) : (
                renderMatchCard(item.match, false)
              ),
            )}
          </ul>
        )
      ) : filtered.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title={t("bookings.empty")}
            body={t("bookings.emptyHint")}
            actionLabel={t("facilities.book")}
            actionTo={`/c/${slug}/reservar`}
          />
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {groupedByMuni
            ? groupedByMuni.map(([muniKey, group]) => (
                <li key={muniKey} className="list-none space-y-3">
                  <div className="flex items-center gap-2 px-1">
                    {group.logo ? (
                      <img
                        src={group.logo}
                        alt=""
                        className="h-8 w-8 rounded-full border border-line object-contain"
                      />
                    ) : (
                      <span
                        className="flex h-8 w-8 items-center justify-center rounded-full bg-marino text-xs font-bold text-on-dark"
                        aria-hidden
                      >
                        {(group.name.replace(/^Concello de\s+/i, "").charAt(0) || "N")}
                      </span>
                    )}
                    <h2 className="m-0 text-base font-extrabold text-marino">{group.name}</h2>
                  </div>
                  <ul className="space-y-3">
                    {group.rows.map((b) =>
                      renderBookingCard(
                        b,
                        scope === "this" ? organizerMatchByBooking.get(b.id) : undefined,
                      ),
                    )}
                  </ul>
                </li>
              ))
            : filtered.map((b) =>
                renderBookingCard(
                  b,
                  scope === "this" ? organizerMatchByBooking.get(b.id) : undefined,
                ),
              )}
        </ul>
      )}

      <p className="mt-6 text-sm text-graphite">{t("bookings.waitlistNote")}</p>

      <CancelDialog
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirm={() => void doCancel()}
        busy={busy}
      />
    </main>
  );
}
