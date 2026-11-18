import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiX } from "../lib/api-complete";
import { api } from "../lib/api";
import { useSession } from "../context/SessionContext";
import { homePathForRole } from "../lib/roles";
import { formatDate, formatDayChip } from "../lib/format-date";
import { PavilionWeekendGrid } from "../components/PavilionWeekendGrid";
import { WeekendDateChips } from "../components/WeekendDateChips";
import { TimeField } from "../components/TimeField";
import { Card } from "../components/ui";
import {
  hmToMin as moveHmToMin,
  matchDurationMin,
  matchIsPast,
  minToHm,
  moveUnchanged,
  unitKind,
  unitShortLabel,
  type MoveUnitLike,
} from "../lib/move-match";

type MatchRow = Awaited<ReturnType<typeof api.pavilion>>["data"]["matches"][number];

export function ClubPortalPage({ view }: { view: "home" | "tempada" | "partidos" | "datos" }) {
  const { slug: slugParam, clubId = "club-basquet" } = useParams();
  const slug = slugParam!;
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const [club, setClub] = useState<Awaited<ReturnType<typeof apiX.club>>["data"] | null>(null);
  const [pav, setPav] = useState<Awaited<ReturnType<typeof api.pavilion>>["data"] | null>(null);
  const [units, setUnits] = useState<
    Array<{ id: string; name: string; facilityId: string }>
  >([]);
  const [pavilionUnits, setPavilionUnits] = useState<
    Array<{ id: string; name: string; facilityId: string }>
  >([]);
  const [seasonUnits, setSeasonUnits] = useState<
    Array<{ id: string; name: string; facilityId: string }>
  >([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [proposeFor, setProposeFor] = useState<MatchRow | null>(null);
  const [busyAlt, setBusyAlt] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [showProposeMatch, setShowProposeMatch] = useState(false);

  const [weekday, setWeekday] = useState(2);
  const [seasonStart, setSeasonStart] = useState("18:00");
  const [seasonEnd, setSeasonEnd] = useState("19:30");
  const [unitId, setUnitId] = useState("");
  const [matchUnitId, setMatchUnitId] = useState("");

  const [matchDate, setMatchDate] = useState("");
  const [matchStart, setMatchStart] = useState("10:00");
  const [matchEnd, setMatchEnd] = useState("11:30");
  const [homeTeam, setHomeTeam] = useState("");
  const [awayTeam, setAwayTeam] = useState("");
  const [changeFor, setChangeFor] = useState<MatchRow | null>(null);
  const [changeDate, setChangeDate] = useState("");
  const [changeStart, setChangeStart] = useState("10:00");
  const [changeEnd, setChangeEnd] = useState("11:30");
  const [changeUnitId, setChangeUnitId] = useState("");
  const [changeNote, setChangeNote] = useState("");

  const facilityIdFor = (uid: string) =>
    units.find((u) => u.id === uid)?.facilityId ?? "";

  const matchUnitOptions = pavilionUnits.length > 0 ? pavilionUnits : units;

  const matchStatusLabel = (status: string) => {
    if (status === "scheduled" || status === "resolved" || status === "swapped") {
      return t("clubs.status.approved");
    }
    return t(`clubs.status.${status}`, {
      defaultValue: t(`status.${status}`, { defaultValue: status }),
    });
  };

  const dowFull = [
    t("dow.0"),
    t("dow.1"),
    t("dow.2"),
    t("dow.3"),
    t("dow.4"),
    t("dow.5"),
    t("dow.6"),
  ];

  const load = () => {
    void apiX.club(slug, clubId).then((r) => setClub(r.data)).catch(() => setClub(null));
    void api
      .pavilion(slug, { weekOffset })
      .then((r) => setPav(r.data))
      .catch(() => setPav(null));
    void api.facilities(slug).then(async (r) => {
      const all: Array<{ id: string; name: string; facilityId: string }> = [];
      const pavilion: Array<{ id: string; name: string; facilityId: string }> = [];
      const seasonPool: Array<{ id: string; name: string; facilityId: string }> = [];
      for (const f of r.data) {
        const isPav = /pavill/i.test(f.type);
        const isCampo = f.type === "campo";
        try {
          const detail = await api.facility(slug, f.id);
          for (const u of detail.data.units) {
            const row = {
              id: u.id,
              name: `${f.name} · ${u.name}`,
              facilityId: f.id,
            };
            const shortRow = { id: u.id, name: u.name, facilityId: f.id };
            all.push(row);
            if (isPav) pavilion.push(shortRow);
            if (isPav || isCampo) seasonPool.push(shortRow);
          }
        } catch {
          /* skip */
        }
      }
      setUnits(all);
      setPavilionUnits(pavilion);
      setSeasonUnits(seasonPool);
      const matchPool = pavilion.length > 0 ? pavilion : all;
      const seasonDefault = seasonPool[0]?.id;
      if (seasonDefault) {
        setUnitId((prev) =>
          prev && seasonPool.some((u) => u.id === prev) ? prev : seasonDefault,
        );
      }
      if (matchPool[0]) {
        setMatchUnitId((prev) => prev || matchPool[0]!.id);
      }
    });
  };
  useEffect(load, [slug, clubId, weekOffset]);

  const addMinutesHm = (hm: string, mins: number) => {
    const [h, m] = hm.split(":").map(Number);
    const total = (h ?? 0) * 60 + (m ?? 0) + mins;
    const hh = String(Math.floor(total / 60) % 24).padStart(2, "0");
    const mm = String(total % 60).padStart(2, "0");
    return `${hh}:${mm}`;
  };

  const hmToMin = (hm: string) => {
    const [h, m] = hm.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };

  const firstFreeStart = (date: string, unitLabel: string) => {
    const taken = (pav?.matches ?? []).filter(
      (m) => m.date === date && (m.unit === unitLabel || /completa|full/i.test(m.unit)),
    );
    for (let h = 9; h <= 20; h++) {
      const start = `${String(h).padStart(2, "0")}:00`;
      const end = addMinutesHm(start, 90);
      const s = hmToMin(start);
      const e = hmToMin(end);
      const clash = taken.some((m) => hmToMin(m.start) < e && hmToMin(m.end) > s);
      if (!clash) return start;
    }
    return "10:00";
  };

  const overlapConflicts = (
    date: string,
    start: string,
    end: string,
    unitName: string,
    excludeId?: string,
  ) => {
    const s = hmToMin(start);
    const e = hmToMin(end);
    return (pav?.matches ?? []).filter((m) => {
      if (excludeId && m.id === excludeId) return false;
      if (m.date !== date) return false;
      if (m.status === "proposed" && m.id.startsWith("proposed-")) {
        /* still counts as occupying */
      }
      const sameUnit = m.unit === unitName;
      const fullClash =
        /completa|full/i.test(m.unit) || /completa|full/i.test(unitName);
      if (!sameUnit && !fullClash) return false;
      return hmToMin(m.start) < e && hmToMin(m.end) > s;
    });
  };

  // Defaults lóxicos ao abrir «Propoñer» / cambiar fin de semana (REVISION-18 T4).
  useEffect(() => {
    if (!pav?.weekend) return;
    const sun = pav.weekendEnd ?? pav.weekend;
    const unitName =
      matchUnitOptions.find((u) => u.id === matchUnitId)?.name.split(" · ").pop() ??
      "";
    setMatchDate((prev) => {
      if (prev === pav.weekend || prev === sun) return prev;
      return pav.weekend;
    });
    const start = firstFreeStart(pav.weekend, unitName);
    setMatchStart(start);
    setMatchEnd(addMinutesHm(start, 90));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só ao cambiar fin de semana / pista
  }, [pav?.weekend, pav?.weekendEnd, matchUnitId, showProposeMatch]);

  const requestSeason = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    const facilityId = facilityIdFor(unitId);
    if (!unitId || !facilityId) {
      setErr(t("clubs.requestError"));
      return;
    }
    try {
      await apiX.requestSeason(slug, clubId, {
        weekday,
        start: seasonStart,
        end: seasonEnd,
        unitId,
        facilityId,
      });
      setMsg(t("clubs.seasonRequested"));
      load();
    } catch {
      setErr(t("clubs.requestError"));
    }
  };

  const requestMatch = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    const facilityId = facilityIdFor(matchUnitId);
    if (!matchUnitId || !facilityId || !matchDate) {
      setErr(t("clubs.requestError"));
      return;
    }
    if (hmToMin(matchEnd) <= hmToMin(matchStart)) {
      setErr(t("clubs.endAfterStart"));
      return;
    }
    try {
      await apiX.requestMatch(slug, clubId, {
        date: matchDate,
        start: matchStart,
        end: matchEnd,
        homeTeam,
        awayTeam,
        unitId: matchUnitId,
        facilityId,
      });
      setMsg(t("clubs.matchRequested"));
      setHomeTeam("");
      setAwayTeam("");
      setShowProposeMatch(false);
      load();
    } catch {
      setErr(t("clubs.requestError"));
    }
  };

  const openChangeForm = (m: MatchRow) => {
    if (matchIsPast(m)) return;
    const mine = m.club === String(club?.shortName ?? "");
    if (!mine) return;
    if (m.status === "change_requested" || m.id.startsWith("proposed-")) return;
    setChangeFor(m);
    setChangeDate(m.date);
    setChangeStart(m.start);
    setChangeEnd(m.end);
    const uid =
      m.unitId ??
      matchUnitOptions.find((u) => u.name.endsWith(m.unit) || u.name.includes(m.unit))
        ?.id ??
      matchUnitId;
    setChangeUnitId(uid);
    setChangeNote("");
  };

  const moveUnits: MoveUnitLike[] = useMemo(() => {
    if (pav?.units?.length) {
      return pav.units.map((u) => ({
        id: u.id,
        name: u.name,
        incompatibleWith: u.incompatibleWith ?? [],
      }));
    }
    return matchUnitOptions.map((u) => ({
      id: u.id,
      name: u.name,
      incompatibleWith: [],
    }));
  }, [pav?.units, matchUnitOptions]);

  const changeUnitIdForKind = (kind: "full" | "a" | "b") => {
    const hit = moveUnits.find((u) => unitKind(u.id, moveUnits) === kind);
    return hit?.id ?? matchUnitOptions[0]?.id ?? "";
  };

  /* REVISION-51 B1: suxestións desde a API (mesma validación que mover). */
  const [changeFreeSuggestions, setChangeFreeSuggestions] = useState<
    Array<{ date: string; start: string; end: string }>
  >([]);
  useEffect(() => {
    if (!changeFor?.id || !changeUnitId) {
      setChangeFreeSuggestions([]);
      return;
    }
    let cancelled = false;
    const facilityId = facilityIdFor(changeUnitId);
    void apiX
      .matchFreeHours(slug, changeFor.id, {
        unitId: changeUnitId,
        facilityId: facilityId || undefined,
      })
      .then((r) => {
        if (!cancelled) setChangeFreeSuggestions(r.data);
      })
      .catch(() => {
        if (!cancelled) setChangeFreeSuggestions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [changeFor?.id, changeUnitId, slug, units, pavilionUnits, pav?.units]);

  const changeUnchanged =
    !!changeFor &&
    moveUnchanged({
      from: {
        date: changeFor.date,
        start: changeFor.start,
        end: changeFor.end,
        unitId: changeFor.unitId ?? changeUnitId,
      },
      to: {
        date: changeDate,
        start: changeStart,
        end: changeEnd,
        unitId: changeUnitId,
      },
    });

  /* REVISION-48 Y4: folla móbil como reservar. */
  useEffect(() => {
    if (!changeFor) {
      document.documentElement.classList.remove("pa-reserve-sheet-open");
      return;
    }
    document.documentElement.classList.add("pa-reserve-sheet-open");
    return () => {
      document.documentElement.classList.remove("pa-reserve-sheet-open");
    };
  }, [changeFor]);

  const submitMatchChange = async (e: FormEvent) => {
    e.preventDefault();
    if (!changeFor) return;
    setErr(null);
    setMsg(null);
    if (hmToMin(changeEnd) <= hmToMin(changeStart)) {
      setErr(t("clubs.endAfterStart"));
      return;
    }
    const facilityId = facilityIdFor(changeUnitId);
    const note =
      changeNote.trim() ||
      t("clubs.changeNoteDefault", { defaultValue: "Proposta de cambio de franxa" });
    if (!changeUnitId || !facilityId || !changeDate) {
      setErr(t("clubs.requestError"));
      return;
    }
    try {
      await apiX.requestMatchChange(slug, clubId, {
        matchId: changeFor.id,
        date: changeDate,
        start: changeStart,
        end: changeEnd,
        unitId: changeUnitId,
        facilityId,
        note,
      });
      setMsg(t("clubs.changeRequested"));
      setChangeFor(null);
      load();
    } catch {
      setErr(t("clubs.requestError"));
    }
  };

  const proposeSwap = async (fromId: string, toId: string) => {
    setErr(null);
    setMsg(null);
    setBusyAlt(true);
    try {
      await api.proposeSwap(slug, fromId, toId);
      setMsg(t("clubs.swapProposed"));
      setProposeFor(null);
      load();
    } catch {
      setErr(t("clubs.requestError"));
    } finally {
      setBusyAlt(false);
    }
  };

  const moveMedia = async (matchId: string) => {
    setErr(null);
    setMsg(null);
    setBusyAlt(true);
    try {
      await api.resolveConflict(slug, { matchId, action: "move_media" });
      setMsg(t("clubs.movedMedia"));
      setProposeFor(null);
      load();
    } catch {
      setErr(t("clubs.requestError"));
    } finally {
      setBusyAlt(false);
    }
  };

  const proposeAlternatives = useMemo(() => {
    if (!proposeFor || !pav) return [] as MatchRow[];
    const conflictIds = new Set(proposeFor.conflictWith ?? []);
    return pav.matches.filter(
      (m) =>
        m.id !== proposeFor.id &&
        m.date === proposeFor.date &&
        (conflictIds.has(m.id) ||
          (m.status !== "conflict" &&
            (m.start !== proposeFor.start || m.unit !== proposeFor.unit))),
    );
  }, [proposeFor, pav]);

  // Conta de club: só o seu club
  if (user?.role === "club_manager" && user.clubId && user.clubId !== clubId) {
    return <Navigate to={homePathForRole("club_manager", slug, user.clubId)} replace />;
  }

  if (!club) {
    return (
      <main className="pa-page">
        <p>{t("common.loading")}</p>
      </main>
    );
  }

  const name = String(club.name);
  const account = club.account as
    | { displayName: string; email?: string; active: boolean }
    | null
    | undefined;
  const season =
    (club.seasonSlots as Array<{
      id: string;
      weekday: number;
      start: string;
      end: string;
      unitId?: string;
    }>) ?? [];
  const shortName = String(club.shortName ?? "");
  const myMatches = pav?.matches.filter((m) => m.club === shortName) ?? [];

  const unitLabel = (id?: string) =>
    units.find((u) => u.id === id)?.name ?? id ?? "—";

  const conflictExplain = (m: (typeof myMatches)[number]) => {
    if (m.status !== "conflict" || !m.conflictWith?.length || !pav) return null;
    const other = pav.matches.find((x) => x.id === m.conflictWith![0]);
    if (!other) return m.notes ?? null;
    return t("clubs.conflictWith", {
      team: other.homeTeam,
      unit: other.unit,
    });
  };

  const weekendLabel = pav
    ? `${formatDate(pav.weekend, i18n.language)} – ${formatDate(
        pav.weekendEnd ?? pav.weekend,
        i18n.language,
      )}`
    : undefined;

  const unitNameOf = (uid: string) =>
    matchUnitOptions.find((u) => u.id === uid)?.name.split(" · ").pop() ?? uid;

  const proposeConflicts = matchDate
    ? overlapConflicts(matchDate, matchStart, matchEnd, unitNameOf(matchUnitId))
    : [];

  const matchForm = (
    <form onSubmit={(e) => void requestMatch(e)} className="pa-card flex max-w-md flex-col gap-3 p-5">
      <h2 className="font-bold">{t("clubs.requestMatch")}</h2>
      <p className="text-sm text-graphite">{t("clubs.requestMatchHint")}</p>
      {pav?.weekend ? (
        <WeekendDateChips
          label={t("clubs.matchDate")}
          saturday={pav.weekend}
          sunday={pav.weekendEnd ?? pav.weekend}
          value={matchDate}
          onChange={(iso) => {
            setMatchDate(iso);
            const start = firstFreeStart(iso, unitNameOf(matchUnitId));
            setMatchStart(start);
            setMatchEnd(addMinutesHm(start, 90));
          }}
        />
      ) : null}
      <label className="flex flex-col gap-1 text-sm font-bold">
        {t("clubs.start")}
        <input
          className="pa-input"
          required
          type="time"
          value={matchStart}
          onChange={(e) => {
            const v = e.target.value;
            setMatchStart(v);
            if (hmToMin(matchEnd) <= hmToMin(v)) {
              setMatchEnd(addMinutesHm(v, 90));
            }
          }}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-bold">
        {t("clubs.end")}
        <input
          className="pa-input"
          required
          type="time"
          value={matchEnd}
          onChange={(e) => setMatchEnd(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-bold">
        {t("clubs.unit")}
        <select
          className="pa-input"
          required
          value={matchUnitId}
          onChange={(e) => setMatchUnitId(e.target.value)}
        >
          {matchUnitOptions.length === 0 && (
            <option value="">{t("common.loading")}</option>
          )}
          {matchUnitOptions.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-bold">
        {t("clubs.homeTeam")}
        <input
          className="pa-input"
          required
          value={homeTeam}
          onChange={(e) => setHomeTeam(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-bold">
        {t("clubs.awayTeam")}
        <input
          className="pa-input"
          required
          value={awayTeam}
          onChange={(e) => setAwayTeam(e.target.value)}
        />
      </label>
      {proposeConflicts.length > 0 ? (
        <div className="pa-warn-banner text-sm" role="status">
          <span aria-hidden>⚠</span>
          <span>
            {proposeConflicts.map((m) =>
              t("clubs.conflictWith", { team: m.homeTeam, unit: m.unit }),
            ).join(" · ")}
          </span>
        </div>
      ) : null}
      <button type="submit" className="pa-btn-primary self-start" disabled={!matchUnitId || !matchDate}>
        {t("clubs.submitRequest")}
      </button>
    </form>
  );

  /* REVISION-47 W3 / 48 Y4: panel de cambio (PC lateral / móbil folla + fondo). */
  const changePanelForm =
    changeFor && pav ? (
      <>
      <button
        type="button"
        className="fixed inset-0 z-[35] bg-[rgba(0,43,74,0.45)] xl:hidden"
        aria-label={t("common.close")}
        onClick={() => setChangeFor(null)}
      />
      <form
        className="fixed inset-x-0 bottom-0 z-40 max-h-[85vh] overflow-y-auto rounded-t-2xl border border-line bg-surface p-5 shadow-pa-tab xl:static xl:z-auto xl:max-h-none xl:flex-[1_1_340px] xl:rounded-card xl:shadow-none"
        aria-label={t("admin.moveMatchPanel")}
        onSubmit={(e) => {
          if (!changeNote.trim()) {
            setChangeNote(
              t("clubs.changeNoteDefault", {
                defaultValue: "Proposta de cambio de franxa",
              }),
            );
          }
          void submitMatchChange(e);
        }}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <p className="m-0 text-xs font-extrabold uppercase tracking-wide text-azul-700">
              {t("admin.moveMatchPanel")}
            </p>
            <h2 id="change-title" className="m-0 mt-1 text-lg font-extrabold text-marino">
              {changeFor.homeTeam} – {changeFor.awayTeam}
            </h2>
            <p className="mt-1 m-0 text-sm text-graphite">
              {formatDayChip(changeFor.date, i18n.language)} · {changeFor.start}–
              {changeFor.end} ·{" "}
              {unitShortLabel(changeFor.unitId ?? changeFor.unit, t, moveUnits)}
            </p>
          </div>
          <button
            type="button"
            className="pa-btn-secondary h-9 w-9 shrink-0 px-0 text-sm"
            aria-label={t("common.close")}
            onClick={() => setChangeFor(null)}
          >
            ✕
          </button>
        </div>
        <p className="m-0 text-sm font-bold text-marino">
          {t("admin.movePickTime", { defaultValue: "Escolle a nova hora" })}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {changeFreeSuggestions.length === 0 ? (
            <p className="m-0 text-sm text-graphite">{t("admin.moveNoFreeSlot")}</p>
          ) : null}
          {changeFreeSuggestions.map((s) => {
            const on = changeDate === s.date && changeStart === s.start;
            return (
              <button
                key={`${s.date}-${s.start}`}
                type="button"
                className={`min-h-10 rounded-btn border px-3 text-sm font-extrabold ${
                  on
                    ? "border-marino bg-marino text-on-dark"
                    : "border-line bg-surface text-marino"
                }`}
                onClick={() => {
                  setChangeDate(s.date);
                  setChangeStart(s.start);
                  setChangeEnd(s.end);
                }}
              >
                {formatDayChip(s.date, i18n.language)} · {s.start}
              </button>
            );
          })}
        </div>
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-bold text-azul-700">
            {t("admin.moveFreeTime", { defaultValue: "Hora libre" })}
          </summary>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm font-bold">
              {t("clubs.start")}
              <TimeField
                value={changeStart}
                onChange={(v) => {
                  const dur = matchDurationMin(changeFor);
                  setChangeStart(v);
                  setChangeEnd(minToHm(moveHmToMin(v) + Math.max(15, dur)));
                }}
                aria-label={t("clubs.start")}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-bold">
              {t("clubs.end")}
              <TimeField
                value={changeEnd}
                onChange={setChangeEnd}
                aria-label={t("clubs.end")}
              />
            </label>
          </div>
        </details>
        <fieldset className="mt-3 border-0 p-0">
          <legend className="mb-1 text-sm font-bold">{t("clubs.unit")}</legend>
          <div className="flex gap-1 rounded-[10px] bg-bruma p-1">
            {(
              [
                ["full", t("admin.unitCompleta", { defaultValue: "Completa" })],
                ["a", t("admin.unitMediaA", { defaultValue: "Media A" })],
                ["b", t("admin.unitMediaB", { defaultValue: "Media B" })],
              ] as const
            ).map(([kind, label]) => {
              const uid = changeUnitIdForKind(kind);
              const on = changeUnitId === uid;
              return (
                <button
                  key={kind}
                  type="button"
                  disabled={!uid}
                  className={`min-h-10 flex-1 rounded-lg px-2 text-sm font-extrabold ${
                    on
                      ? "border-2 border-marino bg-surface text-marino"
                      : "border border-transparent text-graphite"
                  }`}
                  onClick={() => setChangeUnitId(uid)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </fieldset>
        <label className="mt-3 flex flex-col gap-1 text-sm font-bold">
          {t("clubs.changeReason")}
          <textarea
            className="pa-input min-h-16"
            value={changeNote}
            onChange={(e) => setChangeNote(e.target.value)}
            placeholder={t("clubs.changeNoteDefault", {
              defaultValue: "Proposta de cambio de franxa",
            })}
          />
        </label>
        <div className="mt-4 rounded-[12px] bg-paper p-3 text-sm">
          <strong>{t("admin.moveMatchSummary")}</strong>
          <p className="m-0 mt-1">
            {formatDayChip(changeFor.date, i18n.language)} · {changeFor.start} →{" "}
            {formatDayChip(changeDate, i18n.language)} · {changeStart} ·{" "}
            {unitShortLabel(changeUnitId || changeFor.unit, t, moveUnits)}
          </p>
        </div>
        {overlapConflicts(
          changeDate,
          changeStart,
          changeEnd,
          unitNameOf(changeUnitId),
          changeFor.id,
        ).length > 0 ? (
          <div className="pa-warn-banner mt-3 text-sm" role="status">
            <span aria-hidden>⚠</span>
            <span>
              {overlapConflicts(
                changeDate,
                changeStart,
                changeEnd,
                unitNameOf(changeUnitId),
                changeFor.id,
              )
                .map((m) =>
                  t("clubs.conflictWith", { team: m.homeTeam, unit: m.unit }),
                )
                .join(" · ")}
            </span>
          </div>
        ) : null}
        <div className="mt-4 flex flex-col gap-2">
          <button
            type="submit"
            className="pa-btn-primary w-full text-sm"
            disabled={changeUnchanged}
            title={changeUnchanged ? t("admin.moveSameSlot") : undefined}
          >
            {t("clubs.sendChangeProposal", {
              defaultValue: "Enviar proposta de cambio",
            })}
          </button>
          <button
            type="button"
            className="pa-btn-secondary w-full text-sm"
            onClick={() => setChangeFor(null)}
          >
            {t("common.close")}
          </button>
        </div>
      </form>
      </>
    ) : null;

  return (
    <main className="pa-page">
      <p className="text-sm font-bold uppercase tracking-wide text-graphite">{t("clubs.portal")}</p>
      <h1 className="pa-h1">{name}</h1>
      {/* REVISION-40 T17: no móbil a barra inferior substitúe estas pestanas. */}
      <nav className="mt-4 hidden flex-wrap gap-2 lg:flex">
        {(
          [
            ["home", t("clubs.home")],
            ["tempada", t("clubs.season")],
            ["datos", t("clubs.data")],
          ] as const
        ).map(([k, label]) => (
          <Link
            key={k}
            to={`/c/${slug}/clubs/${clubId}/${k === "home" ? "" : k}`.replace(/\/$/, "")}
            className={`pa-btn-secondary min-h-10 text-sm ${view === k ? "!bg-ink !text-white" : ""}`}
          >
            {label}
          </Link>
        ))}
      </nav>

      {msg && <p className="pa-ok-banner mt-4">✓ {msg}</p>}
      {err && (
        <p className="pa-warn-banner mt-4" role="alert">
          {err}
        </p>
      )}

      {view === "home" && (
        <section className="mt-8 space-y-6">
          {(() => {
            const conflicts = myMatches.filter((m) => m.status === "conflict");
            return (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="pa-btn-primary min-h-11 text-sm"
                    onClick={() => setShowProposeMatch((v) => !v)}
                    aria-expanded={showProposeMatch}
                  >
                    {t("clubs.proposeMatch")}
                  </button>
                </div>
                {showProposeMatch ? matchForm : null}
                {/* REVISION-47 W3: grella + panel (PC lateral / móbil folla). */}
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
                  <div className="min-w-0 flex-[999_1_620px]">
                    {pav ? (
                      <PavilionWeekendGrid
                        matches={pav.matches}
                        weekendStartIso={pav.weekend}
                        weekendLabel={weekendLabel}
                        weekOffset={weekOffset}
                        onPrevWeek={() => setWeekOffset((w) => w - 1)}
                        onNextWeek={() => setWeekOffset((w) => w + 1)}
                        selectedMatchId={changeFor?.id}
                        onSelectMatch={(m) => openChangeForm(m)}
                        units={moveUnits}
                      />
                    ) : null}
                  </div>
                  {changeFor && pav ? changePanelForm : null}
                </div>

                <Card lift={false} className="p-5">
                  <h2 className="m-0 text-lg font-extrabold text-marino">
                    {t("clubs.conflictsAffectYou", {
                      defaultValue: "Choques que che afectan",
                    })}
                  </h2>
                  {conflicts.length === 0 ? (
                    <p className="mt-2 m-0 text-sm text-graphite">{t("clubs.conflictsNone")}</p>
                  ) : (
                    <ul className="mt-3 m-0 flex list-none flex-col gap-2 p-0">
                      {conflicts.slice(0, 4).map((m) => (
                        <li key={m.id} className="text-sm">
                          <strong>
                            {m.homeTeam}–{m.awayTeam}
                          </strong>
                          <span className="text-graphite">
                            {" "}
                            · {formatDate(m.date, i18n.language)} · {m.start}–{m.end} · {m.unit}
                          </span>
                          {conflictExplain(m) ? (
                            <span className="mt-0.5 block text-aviso">{conflictExplain(m)}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </>
            );
          })()}
        </section>
      )}

      {view === "tempada" && (
        <div className="mt-8 space-y-8">
          <ul className="space-y-2">
            {season.map((s) => (
              <li key={s.id} className="pa-card px-4 py-3 text-sm">
                <strong>{dowFull[s.weekday]}</strong> · {s.start}–{s.end}
                {s.unitId ? ` · ${unitLabel(s.unitId)}` : ""}
              </li>
            ))}
            {season.length === 0 && (
              <li className="text-sm text-graphite">{t("clubs.noSeasonSlots")}</li>
            )}
          </ul>
          <form onSubmit={(e) => void requestSeason(e)} className="pa-card flex max-w-md flex-col gap-3 p-5">
            <h2 className="font-bold">{t("clubs.requestSeason")}</h2>
            <p className="text-sm text-graphite">{t("clubs.requestSeasonHint")}</p>
            <label className="flex flex-col gap-1 text-sm font-bold">
              {t("clubs.weekday")}
              <select
                className="pa-input"
                value={weekday}
                onChange={(e) => setWeekday(Number(e.target.value))}
              >
                {dowFull.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-bold">
              {t("clubs.start")}
              <input
                className="pa-input"
                type="time"
                required
                value={seasonStart}
                onChange={(e) => setSeasonStart(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-bold">
              {t("clubs.end")}
              <input
                className="pa-input"
                type="time"
                required
                value={seasonEnd}
                onChange={(e) => setSeasonEnd(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-bold">
              {t("clubs.unit")}
              <select
                className="pa-input"
                required
                value={unitId}
                onChange={(e) => setUnitId(e.target.value)}
              >
                {seasonUnits.length === 0 && (
                  <option value="">{t("common.loading")}</option>
                )}
                {seasonUnits.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="pa-btn-primary self-start" disabled={!unitId}>
              {t("clubs.submitRequest")}
            </button>
          </form>
        </div>
      )}

      {view === "partidos" && (
        <div className="mt-8 space-y-8">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
            <div className="min-w-0 flex-[999_1_620px]">
              {pav ? (
                <PavilionWeekendGrid
                  matches={pav.matches}
                  weekendStartIso={pav.weekend}
                  weekendLabel={weekendLabel}
                  weekOffset={weekOffset}
                  onPrevWeek={() => setWeekOffset((w) => w - 1)}
                  onNextWeek={() => setWeekOffset((w) => w + 1)}
                  selectedMatchId={changeFor?.id}
                  onSelectMatch={(m) => openChangeForm(m)}
                  units={moveUnits}
                />
              ) : null}
            </div>
            {changeFor && pav ? changePanelForm : null}
          </div>
          {pav && (
            <ul className="space-y-3">
              {pav.matches.map((m) => {
                const mine = m.club === shortName;
                const past = matchIsPast(m);
                const explain = mine ? conflictExplain(m) : null;
                const statusLabel = matchStatusLabel(m.status);
                return (
                  <li
                    key={m.id}
                    className={`pa-card p-4 ${m.status === "conflict" ? "border-[3px] border-warnBorder bg-warnBg" : ""} ${past ? "opacity-70" : ""}`}
                  >
                    <p className="font-bold">
                      {m.homeTeam} — {m.awayTeam}
                    </p>
                    <p className="text-sm text-graphite">
                      {formatDate(m.date, i18n.language)} · {m.start}–{m.end} ·{" "}
                      {unitShortLabel(m.unit, t)} · {statusLabel}
                    </p>
                    {explain && (
                      <p className="mt-1 text-sm font-bold text-warnText">{explain}</p>
                    )}
                    {!past && mine && m.status === "conflict" && (
                      <button
                        type="button"
                        className="pa-btn-primary mt-3 text-sm"
                        onClick={() => setProposeFor(m)}
                      >
                        {t("clubs.proposeSwap")}
                      </button>
                    )}
                    {!past &&
                      mine &&
                      m.status !== "change_requested" &&
                      !m.id.startsWith("proposed-") && (
                        <button
                          type="button"
                          className="pa-btn-secondary mt-3 text-sm"
                          onClick={() => openChangeForm(m)}
                        >
                          {t("clubs.requestChange")}
                        </button>
                      )}
                    {(() => {
                      /* REVISION-58 W11: só o troco deste partido, non swaps[0] global. */
                      const swap = pav.swaps.find(
                        (s) =>
                          s.status === "proposed" &&
                          (s.fromMatchId === m.id || s.toMatchId === m.id),
                      );
                      if (!user || !swap || !mine) return null;
                      return (
                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            className="pa-btn-primary text-sm"
                            onClick={() =>
                              void apiX
                                .swapAccept(slug, swap.id)
                                .then(() => {
                                  setMsg(t("clubs.accepted"));
                                  load();
                                })
                                .catch((ex) => {
                                  /* REVISION-59 L4: error.* ou texto xenérico. */
                                  const code =
                                    ex instanceof Error ? ex.message : "";
                                  const key = code ? `error.${code}` : "";
                                  const translated = key ? t(key) : "";
                                  setErr(
                                    translated && translated !== key
                                      ? translated
                                      : t("clubs.requestError"),
                                  );
                                })
                            }
                          >
                            {t("clubs.acceptSwap")}
                          </button>
                          <button
                            type="button"
                            className="pa-btn-danger text-sm"
                            onClick={() =>
                              void apiX
                                .swapReject(slug, swap.id)
                                .then(() => {
                                  setMsg(t("clubs.rejected"));
                                  load();
                                })
                                .catch((ex) => {
                                  const code =
                                    ex instanceof Error ? ex.message : "";
                                  const key = code ? `error.${code}` : "";
                                  const translated = key ? t(key) : "";
                                  setErr(
                                    translated && translated !== key
                                      ? translated
                                      : t("clubs.requestError"),
                                  );
                                })
                            }
                          >
                            {t("clubs.rejectSwap")}
                          </button>
                        </div>
                      );
                    })()}
                  </li>
                );
              })}
            </ul>
          )}
          {matchForm}
        </div>
      )}

      {view === "datos" && (
        <section className="mt-8 max-w-md">
          <h2 className="pa-h2">{t("clubs.account")}</h2>
          <p className="mt-2 text-sm text-graphite">{t("clubs.accountHint")}</p>
          <div className="pa-card mt-4 space-y-2 p-5 text-sm">
            <p>
              <strong>{t("clubs.clubName")}:</strong> {name}
            </p>
            <p>
              <strong>{t("clubs.accountName")}:</strong>{" "}
              {account?.displayName ?? user?.displayName ?? "—"}
            </p>
            <p>
              <strong>{t("clubs.accountEmail")}:</strong>{" "}
              {account?.email ?? user?.email ?? "—"}
            </p>
          </div>
        </section>
      )}

      {proposeFor && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(0,43,74,0.4)] p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="propose-title"
        >
          <div className="pa-card max-h-[85vh] w-full max-w-md overflow-auto p-6">
            <h2 id="propose-title" className="pa-h2">
              {t("clubs.proposeSwap")}
            </h2>
            <p className="mt-2 text-sm text-graphite">
              {proposeFor.homeTeam} — {proposeFor.awayTeam} ·{" "}
              {formatDate(proposeFor.date, i18n.language)} · {proposeFor.start}–
              {proposeFor.end}
            </p>
            <p className="mt-3 text-sm font-bold">{t("clubs.alternativesTitle")}</p>
            <ul className="mt-3 space-y-2">
              <li>
                <button
                  type="button"
                  className="pa-btn-secondary w-full justify-start text-left text-sm"
                  disabled={busyAlt}
                  onClick={() => void moveMedia(proposeFor.id)}
                >
                  {t("clubs.altHalfCourt")}
                </button>
              </li>
              {proposeAlternatives.map((alt) => (
                <li key={alt.id}>
                  <button
                    type="button"
                    className="pa-btn-secondary w-full justify-start text-left text-sm"
                    disabled={busyAlt}
                    onClick={() => void proposeSwap(proposeFor.id, alt.id)}
                  >
                    {t("clubs.altOtherSlot", {
                      team: alt.homeTeam,
                      start: alt.start,
                      end: alt.end,
                      unit: alt.unit,
                    })}
                  </button>
                </li>
              ))}
              {proposeAlternatives.length === 0 && (
                <li className="text-sm text-graphite">{t("clubs.altOnlyHalf")}</li>
              )}
            </ul>
            <button
              type="button"
              className="pa-btn-secondary mt-4"
              onClick={() => setProposeFor(null)}
            >
              {t("common.close")}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
