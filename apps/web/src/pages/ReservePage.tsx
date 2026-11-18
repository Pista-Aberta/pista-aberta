import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MapPinned, Phone } from "lucide-react";
import { api } from "../lib/api";
import { apiX } from "../lib/api-complete";
import { useSession } from "../context/SessionContext";
import { BackLink } from "../components/BackLink";
import { DeputacionReadOnlyBanner } from "../components/DeputacionReadOnlyBanner";
import {
  BottomSheet,
  Button,
  CourtLinesBg,
  DayTile,
  Dialog,
  Segmented,
  SkeletonBlock,
  SlotButton,
  type SlotState,
  Toast,
} from "../components/ui";
import {
  buildUsageRulesLines,
  isEmailLocalPartName,
  mobileMapUrl,
  shortPublicName,
  trimComoChegar,
} from "@pista-aberta/shared";
import { slotsForUnit } from "../lib/free-hours";
import { formatDateLong, formatDayTimeChip } from "../lib/format-date";
import { closureNoticeText } from "../lib/closure-notice";
import { servicesLine } from "../lib/service-labels";
import {
  clearReserveDraft,
  loadReserveDraft,
  saveReserveDraft,
} from "../lib/form-drafts";
import { MeteoRainNotice } from "../components/MeteoRainNotice";

type Slot = Awaited<ReturnType<typeof api.availability>>["data"][number];
type Facility = Awaited<ReturnType<typeof api.facility>>["data"];

/** REVISION-21 Q2 — suxestión cando o día/unidade está cheo. */
type AltSuggestion = {
  key: string;
  facilityId: string;
  facilityName: string;
  date: string;
  start: string;
  slotId: string;
  /** Menor = menos ocupación habitual. */
  score: number;
};

function addDaysIso(n: number) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
}

function dayOffsetFromIso(iso: string | null, maxOffset = 6): number {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return 0;
  const target = new Date(`${iso}T12:00:00`);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const diff = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (diff < 0 || diff > maxOffset) return 0;
  return diff;
}

function slotInFranxa(start: string, franxa: string | null): boolean {
  if (!franxa || franxa === "calquera") return true;
  const h = Number(start.slice(0, 2));
  if (franxa === "manha" || franxa === "mañá" || franxa === "manana") return h < 14;
  if (franxa === "tarde") return h >= 14 && h < 20;
  if (franxa === "noite" || franxa === "seran" || franxa === "serán" || franxa === "noche") {
    return h >= 20;
  }
  return true;
}

function isoFromDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function slotState(
  s: Slot,
  selected: string | null,
  modifyFrom: { date: string; start: string } | null,
  viewingDate: string,
): SlotState {
  /* Escollida ten prioridade (aria-pressed + texto «Escollida»). */
  if (selected === s.id) return "escollida";
  if (s.status === "mine" || s.mine) return "tua";
  if (
    modifyFrom &&
    modifyFrom.date === viewingDate &&
    modifyFrom.start === s.start
  ) {
    return "tua";
  }
  if (s.status === "closed" || s.closed) return "pechada";
  if (s.status === "occupied") return "ocupada";
  return "libre";
}

export function ReservePage() {
  const { slug: slugParam, facilityId = "" } = useParams();
  const slug = slugParam!;
  const [params, setSearchParams] = useSearchParams();
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const { user, refreshUser } = useSession();
  /* REVISION-20 H4: Deputación ve franxas sen poder reservar. */
  const readOnly = user?.role === "superadmin";
  const [facility, setFacility] = useState<Facility | null>(null);
  const [unitId, setUnitId] = useState("");
  const [dayOffset, setDayOffset] = useState(() =>
    dayOffsetFromIso(params.get("data"), 30),
  );
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selected, setSelected] = useState<string | null>(() => params.get("slot"));
  const [accepted, setAccepted] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [waitMsg, setWaitMsg] = useState<string | null>(null);
  const [freeDays, setFreeDays] = useState<Record<string, boolean>>({});
  const [quietHours, setQuietHours] = useState<string[]>([]);
  const [alts, setAlts] = useState<AltSuggestion[]>([]);
  const [forceAlts, setForceAlts] = useState(false);
  /* REVISION-40 P2 — montar partido aberto ao reservar (?partido=1 ou checkbox). */
  const [mountOpenMatch, setMountOpenMatch] = useState(
    () => params.get("partido") === "1",
  );
  const [omTitle, setOmTitle] = useState("");
  const [omSport, setOmSport] = useState("padel");
  const [omSpots, setOmSpots] = useState(4);
  const [omLevel, setOmLevel] = useState("");
  const [omNotes, setOmNotes] = useState("");
  const [nameConsent, setNameConsent] = useState(false);
  /** REVISION-42 Q6 — nome real se o actual é o local-part do correo. */
  const [displayNameInput, setDisplayNameInput] = useState("");
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const draftRestoredRef = useRef(false);

  /* Dependencias estábeis: non reaccionar a `?slot=` (só deep-link / F5). */
  const franxa = params.get("franxa");
  const modifyId = params.get("modificar");
  const unitParam = params.get("unit");
  const dataParam = params.get("data");
  const slotParam = params.get("slot");
  const partidoParam = params.get("partido");
  const slotParamRef = useRef(slotParam);
  slotParamRef.current = slotParam;

  useEffect(() => {
    if (partidoParam === "1") setMountOpenMatch(true);
  }, [partidoParam]);

  /* Restaurar borrador tras identificarse (sen reservar automaticamente). */
  useEffect(() => {
    if (draftRestoredRef.current || !facilityId || !slotParam || modifyId) return;
    const draft = loadReserveDraft(slug, facilityId, slotParam);
    if (!draft) return;
    draftRestoredRef.current = true;
    if (draft.unitId) setUnitId(draft.unitId);
    if (draft.mountOpenMatch) {
      setMountOpenMatch(true);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("partido", "1");
          return next;
        },
        { replace: true, preventScrollReset: true },
      );
    }
    if (draft.omTitle != null) setOmTitle(draft.omTitle);
    if (draft.omSport) setOmSport(draft.omSport);
    if (draft.omSpots) setOmSpots(draft.omSpots);
    if (draft.omLevel != null) setOmLevel(draft.omLevel);
    if (draft.omNotes != null) setOmNotes(draft.omNotes);
    setSelected(draft.slotId ?? slotParam);
    setDraftNotice(t("reserve.draftRecovered"));
  }, [slug, facilityId, slotParam, modifyId, setSearchParams, t]);
  /* REVISION-57 W1: antelación da norma (non 7 días fixos). */
  const antelationDays = Math.max(
    1,
    Number(facility?.rulesApplied?.bookingAntelationDays ?? 7) || 7,
  );
  /* REVISION-58 K4: ?data= respecto antelationDays - 1 (non tope 6). */
  useEffect(() => {
    if (!dataParam) return;
    setDayOffset(dayOffsetFromIso(dataParam, antelationDays - 1));
  }, [antelationDays, dataParam]);
  const days = useMemo(
    () => Array.from({ length: antelationDays }, (_, i) => addDaysIso(i)),
    [antelationDays],
  );
  const date = isoFromDate(days[Math.min(dayOffset, days.length - 1)]!);
  const lang = i18n.language?.startsWith("es") ? "es" : "gl";
  const [modifyFrom, setModifyFrom] = useState<{
    date: string;
    start: string;
  } | null>(null);
  /* REVISION-29 Y1: a franxa orixinal non pode vir de `?slot=` — pickSlot actualízaa. */
  const [originalSlotId, setOriginalSlotId] = useState<string | null>(() =>
    params.get("modificar") ? params.get("slot") : null,
  );

  useEffect(() => {
    if (!modifyId) {
      setModifyFrom(null);
      setOriginalSlotId(null);
      return;
    }
    void api
      .booking(slug, modifyId)
      .then((r) => {
        setModifyFrom({ date: r.data.date, start: r.data.start });
        if (r.data.slotId) {
          setOriginalSlotId((prev) => prev ?? r.data.slotId ?? null);
        }
      })
      .catch(() => setModifyFrom(null));
  }, [slug, modifyId]);

  useEffect(() => {
    if (!facilityId) return;
    void api
      .horasTranquilas(slug, facilityId, date)
      .then((r) => setQuietHours(r.data.hours))
      .catch(() => setQuietHours([]));
  }, [slug, facilityId, date]);

  useEffect(() => {
    if (!facilityId) return;
    setLoading(true);
    void api
      .facility(slug, facilityId)
      .then((r) => {
        setFacility(r.data);
        const fromParam = unitParam
          ? r.data.units.find((u) => u.id === unitParam)
          : undefined;
        if (fromParam) setUnitId(fromParam.id);
        else if (r.data.units[0]) setUnitId(r.data.units[0].id);
      })
      .catch(() => setError(t("common.error")))
      .finally(() => setLoading(false));
  }, [slug, facilityId, t, unitParam]);

  useEffect(() => {
    if (!facilityId || !date || !unitId) return;
    void api
      .availability(slug, { facilityId, unitId, date })
      .then((r) => {
        // Filtrar + ordenar pola unidade (evita grella mesturada se a API devolve máis).
        setSlots(slotsForUnit(r.data, unitId));
        const unitSlots = slotsForUnit(r.data, unitId);
        /* Ler slot da URL vía ref: cambiar `?slot=` non debe refetch availability. */
        const fromUrl = slotParamRef.current;
        if (fromUrl && unitSlots.some((s) => s.id === fromUrl && s.status === "free")) {
          setSelected(fromUrl);
        } else if (fromUrl) {
          /* Franxa da URL/borrador xa non libre: conservar resto do formulario. */
          const stillThere = unitSlots.find((s) => s.id === fromUrl);
          if (!stillThere || stillThere.status !== "free") {
            setSelected(null);
            if (draftRestoredRef.current) {
              setDraftNotice(t("reserve.draftSlotGone"));
            }
          }
        } else if (!fromUrl) {
          setSelected(null);
        }
      })
      /* REVISION-58 W2 */
      .catch(() => setError(t("common.error")));
  }, [slug, facilityId, unitId, date, t]);

  /* REVISION-58 W2: unha soa pasada para puntos verdes + primeiro día libre. */
  useEffect(() => {
    if (!facilityId) return;
    let cancelled = false;
    void (async () => {
      const map: Record<string, boolean> = {};
      await Promise.all(
        days.map(async (d) => {
          const iso = isoFromDate(d);
          try {
            const r = await api.availability(slug, {
              facilityId,
              unitId: unitId || undefined,
              date: iso,
            });
            map[iso] = r.data.some(
              (s) => s.status === "free" && slotInFranxa(s.start, franxa),
            );
          } catch {
            map[iso] = false;
          }
        }),
      );
      if (cancelled) return;
      setFreeDays(map);
      if (!dataParam && !slotParam) {
        setDayOffset((cur) => {
          if (cur !== 0) return cur;
          const firstFree = days.findIndex((d) => map[isoFromDate(d)]);
          return firstFree > 0 ? firstFree : cur;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, facilityId, unitId, days, franxa, dataParam, slotParam]);

  const visibleSlots = useMemo(() => {
    const forUnit = slotsForUnit(slots, unitId);
    return forUnit.filter((s) => s.status !== "free" || slotInFranxa(s.start, franxa));
  }, [slots, franxa, unitId]);

  const dayHasFree = useMemo(
    () =>
      visibleSlots.some((s) => slotState(s, null, null, date) === "libre"),
    [visibleSlots, date],
  );
  const dayFull = !loading && !!facility && !dayHasFree;

  const selectedSlot =
    visibleSlots.find((s) => s.id === selected) ?? slots.find((s) => s.id === selected);
  const unitName = facility?.units.find((u) => u.id === unitId)?.name ?? "";
  const rules = facility?.rulesApplied;
  const rulesText = facility?.rulesText ?? [];

  /* REVISION-43 R7: class no <html> (antes de returns temperáns — Rules of Hooks). */
  const sheetOpenPreview = useMemo(() => {
    if (readOnly || !selectedSlot) return false;
    if (!modifyId) return true;
    const same =
      (!!originalSlotId && selectedSlot.id === originalSlotId) ||
      (!!modifyFrom &&
        modifyFrom.date === date &&
        modifyFrom.start === selectedSlot.start);
    return !same;
  }, [
    readOnly,
    selectedSlot,
    modifyId,
    originalSlotId,
    modifyFrom,
    date,
  ]);

  useEffect(() => {
    if (!sheetOpenPreview) {
      document.documentElement.classList.remove("pa-reserve-sheet-open");
      return;
    }
    document.documentElement.classList.add("pa-reserve-sheet-open");
    return () => {
      document.documentElement.classList.remove("pa-reserve-sheet-open");
    };
  }, [sheetOpenPreview]);

  const generatedRules = useMemo(() => {
    if (!rules) return [] as string[];
    const extra = rules as typeof rules & {
      noShowPenaltyCount?: number;
      noShowPenaltyDays?: number;
      noShowPenaltyWindowDays?: number;
      informativePrice?: string;
      checkInRequired?: boolean;
    };
    const full = {
      bookingAntelationDays: extra.bookingAntelationDays,
      maxActiveBookings: extra.maxActiveBookings,
      maxHoursPerWeek: extra.maxHoursPerWeek,
      cancelMinHours: extra.cancelMinHours,
      checkInMarginMinutes: extra.checkInMarginMinutes,
      noShowReleaseMinutes: extra.noShowReleaseMinutes,
      anonymizeAfterDays: extra.anonymizeAfterDays,
      noShowPenaltyCount: extra.noShowPenaltyCount ?? 0,
      noShowPenaltyDays: extra.noShowPenaltyDays ?? 0,
      noShowPenaltyWindowDays: extra.noShowPenaltyWindowDays ?? 30,
      whoCanBook: extra.whoCanBook ?? ("ambas" as const),
      approvalRequired: extra.approvalRequired ?? false,
      informativePrice: extra.informativePrice ?? "",
      /* REVISION-35 G2 — liñas de check-in só se a instalación o esixe. */
      checkInRequired:
        extra.checkInRequired ??
        !!(facility as { checkInRequired?: boolean } | undefined)?.checkInRequired,
    };
    return buildUsageRulesLines(full, lang === "es" ? "es" : "gl").map((l) => l.text);
  }, [rules, lang, facility]);

  /** REVISION-17 R6: returnTo coa URL completa (?data=&slot=) para non perder a hora. */
  const reservePath = (slotId?: string | null) => {
    const qs = new URLSearchParams();
    qs.set("data", date);
    if (slotId) qs.set("slot", slotId);
    if (franxa) qs.set("franxa", franxa);
    if (modifyId) qs.set("modificar", modifyId);
    if (mountOpenMatch || partidoParam === "1") qs.set("partido", "1");
    const q = qs.toString();
    return `/c/${slug}/reservar/${facilityId}${q ? `?${q}` : ""}`;
  };

  const persistDraft = (slotId: string) => {
    const slot =
      visibleSlots.find((s) => s.id === slotId) ??
      slots.find((s) => s.id === slotId);
    saveReserveDraft(slug, facilityId, slotId, {
      unitId,
      date,
      start: slot?.start,
      mountOpenMatch,
      omTitle,
      omSport,
      omSpots,
      omLevel,
      omNotes,
    });
  };

  const goAcceso = (slotId?: string | null) => {
    if (slotId) persistDraft(slotId);
    nav(`/c/${slug}/acceso?returnTo=${encodeURIComponent(reservePath(slotId))}`);
  };

  const cancelDialog = () => {
    if (selected) clearReserveDraft(slug, facilityId, selected);
    setSelected(null);
    setAccepted(false);
    setNameConsent(false);
    setDraftNotice(null);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("slot");
        return next;
      },
      { replace: true, preventScrollReset: true },
    );
  };

  const setMountFlag = (on: boolean) => {
    setMountOpenMatch(on);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (on) next.set("partido", "1");
        else next.delete("partido");
        return next;
      },
      { replace: true, preventScrollReset: true },
    );
  };

  const pickSlot = (slotId: string) => {
    if (readOnly) return;
    setSelected(slotId);
    // Mantén data/slot na URL (cabeceira «Identificarme» e F5) sen scroll-top nin remount.
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("data", date);
        next.set("slot", slotId);
        if (mountOpenMatch || partidoParam === "1") next.set("partido", "1");
        return next;
      },
      { replace: true, preventScrollReset: true },
    );
  };

  const needsDisplayName =
    !!user && isEmailLocalPartName(user.displayName, user.email);
  const publicNamePreview = needsDisplayName
    ? displayNameInput.trim()
      ? shortPublicName(displayNameInput)
      : "…"
    : user?.displayName
      ? shortPublicName(user.displayName)
      : "Ana R.";

  const confirm = async () => {
    if (readOnly) return;
    /* Sen sesión: ir a Cl@ve sen esixir a caixa de normas (REVISION-19 detalle). */
    if (!selected || (user && !accepted && !modifyId)) return;
    if (!modifyId && mountOpenMatch && !omTitle.trim()) {
      setError(t("openMatch.titleRequired"));
      return;
    }
    if (!modifyId && mountOpenMatch && user && !nameConsent) {
      setError(t("error.consent_required"));
      return;
    }
    if (!modifyId && mountOpenMatch && user && needsDisplayName) {
      if (displayNameInput.trim().length < 2) {
        setError(t("error.display_name_required"));
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      if (!user) {
        goAcceso(selected);
        return;
      }
      if (modifyId) {
        const { data } = await api.modifyBooking(slug, modifyId, selected);
        clearReserveDraft(slug, facilityId, selected);
        nav(`/c/${slug}/reserva/${data.id}?cambiada=1`);
        return;
      }
      const openMatch =
        mountOpenMatch && omTitle.trim()
          ? {
              title: omTitle.trim(),
              sport: omSport || undefined,
              spotsTotal: omSpots,
              level: omLevel || undefined,
              notes: omNotes.trim() || undefined,
              nameDisplayConsent: nameConsent,
              ...(needsDisplayName
                ? { displayName: displayNameInput.trim() }
                : {}),
            }
          : undefined;
      const res = await api.createBooking(slug, selected, {
        rulesAccepted: true,
        rulesVersion: facility?.rulesVersion,
        openMatch,
      });
      if (needsDisplayName && openMatch?.displayName) {
        await refreshUser();
      }
      clearReserveDraft(slug, facilityId, selected);
      setDraftNotice(null);
      if (res.openMatch?.id) {
        nav(`/c/${slug}/partidos-abertos/${res.openMatch.id}`);
        return;
      }
      nav(`/c/${slug}/reserva/${res.data.id}`);
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      if (code === "overlapping_booking") {
        const fac =
          e && typeof e === "object" && "facilityName" in e
            ? String((e as { facilityName?: string }).facilityName ?? "")
            : "";
        const time =
          e && typeof e === "object" && "start" in e
            ? String((e as { start?: string }).start ?? "")
            : "";
        setError(
          t("error.overlapping_booking", {
            facility: fac || "—",
            time: time || "—",
          }),
        );
      } else if (code === "slot_occupied") {
        setError(t("error.slot_occupied"));
      } else {
        const key = code ? `error.${code}` : "";
        const translated = key ? t(key) : "";
        setError(
          translated && translated !== key ? translated : t("common.error"),
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const nameConsentFields =
    !modifyId && mountOpenMatch && user ? (
      <div className="flex flex-col gap-1.5">
        {needsDisplayName ? (
          <label className="flex flex-col gap-1 text-sm font-bold">
            {t("openMatch.displayNameLabel")}
            <input
              className="pa-input"
              required
              minLength={2}
              maxLength={80}
              autoComplete="name"
              placeholder={t("openMatch.displayNamePh")}
              value={displayNameInput}
              onChange={(e) => setDisplayNameInput(e.target.value)}
              data-testid="open-match-display-name"
            />
          </label>
        ) : null}
        <label className="flex min-h-11 items-start gap-2.5 text-[15px]">
          <input
            type="checkbox"
            className="mt-1 h-[22px] w-[22px] shrink-0 accent-azul"
            checked={nameConsent}
            onChange={(e) => setNameConsent(e.target.checked)}
            disabled={needsDisplayName && displayNameInput.trim().length < 2}
          />
          <span>
            {t("openMatch.nameConsent", { name: publicNamePreview })}
          </span>
        </label>
        <p className="m-0 pl-[34px] text-[13px] leading-snug text-graphite">
          {t("openMatch.nameConsentHint")}{" "}
          <Link
            to={`/c/${slug}/legal/privacidade`}
            className="font-bold text-azul-700 underline"
          >
            {t("legal.privacy")}
          </Link>
        </p>
      </div>
    ) : null;

  const openMatchFields = !modifyId ? (
    <div className="flex flex-col gap-2.5">
      <label className="flex min-h-11 items-center gap-2.5 text-[15px]">
        <input
          type="checkbox"
          className="h-[22px] w-[22px] accent-azul"
          checked={mountOpenMatch}
          onChange={(e) => {
            setMountFlag(e.target.checked);
            if (!e.target.checked) setNameConsent(false);
          }}
        />
        <span className="font-bold">{t("openMatch.mountOption")}</span>
      </label>
      {mountOpenMatch ? (
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-paper/60 p-3">
          <label className="flex flex-col gap-1 text-sm font-bold">
            {t("openMatch.formTitle")}
            <input
              className="pa-input"
              required
              minLength={2}
              maxLength={120}
              value={omTitle}
              onChange={(e) => setOmTitle(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-bold">
            {t("openMatch.sport")}
            <select
              className="pa-input"
              value={omSport}
              onChange={(e) => setOmSport(e.target.value)}
            >
              <option value="padel">{t("openMatch.sport.padel")}</option>
              <option value="tenis">{t("openMatch.sport.tenis")}</option>
              <option value="futbol_sala">{t("openMatch.sport.futbol_sala")}</option>
              <option value="baloncesto">{t("openMatch.sport.baloncesto")}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-bold">
            {t("openMatch.spots")}
            <input
              type="number"
              min={2}
              max={20}
              className="pa-input w-24"
              value={omSpots}
              onChange={(e) =>
                setOmSpots(Math.min(20, Math.max(2, Number(e.target.value) || 4)))
              }
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-bold">
            {t("openMatch.levelLabel")}
            <select
              className="pa-input"
              value={omLevel}
              onChange={(e) => setOmLevel(e.target.value)}
            >
              <option value="">{t("openMatch.levelAny")}</option>
              <option value="principiante">{t("openMatch.level.principiante")}</option>
              <option value="medio">{t("openMatch.level.medio")}</option>
              <option value="avanzado">{t("openMatch.level.avanzado")}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-bold">
            {t("openMatch.notes")}
            <textarea
              className="pa-input min-h-[64px]"
              maxLength={500}
              value={omNotes}
              onChange={(e) => setOmNotes(e.target.value)}
            />
          </label>
          {nameConsentFields}
        </div>
      ) : null}
    </div>
  ) : null;

  const sheetChrome = (
    <>
      {!user && !modifyId ? (
        <p
          className="m-0 rounded-xl bg-bruma px-3 py-2 text-[13px] leading-snug text-marino"
          role="status"
        >
          {t("reserve.identifySavesDraft")}
        </p>
      ) : null}
      {draftNotice ? (
        <p className="m-0 text-[13px] font-bold text-azul-700" role="status">
          {draftNotice}
        </p>
      ) : null}
    </>
  );

  const sheetActions = (
    <div className="flex flex-col gap-2">
      <Button
        className="h-14 w-full text-[17px]"
        disabled={
          (!!user && !accepted && !modifyId) ||
          busy ||
          (!!user && mountOpenMatch && !omTitle.trim() && !modifyId) ||
          (!!user && mountOpenMatch && !nameConsent && !modifyId) ||
          (!!user &&
            mountOpenMatch &&
            needsDisplayName &&
            displayNameInput.trim().length < 2 &&
            !modifyId)
        }
        onClick={() => void confirm()}
      >
        {modifyId
          ? t("bookings.modifyConfirm")
          : user
            ? mountOpenMatch
              ? t("openMatch.publish")
              : t("reserve.confirm")
            : t("reserve.identifyToBook")}
      </Button>
      <Button
        type="button"
        variant="secondary"
        className="h-11 w-full"
        disabled={busy}
        onClick={cancelDialog}
      >
        {t("common.cancel")}
      </Button>
    </div>
  );

  const onOccupied = (s: Slot) => {
    if (readOnly) return;
    /* Modo cambio: horas ocupadas non se tocan (sen lista de espera). */
    if (modifyId) {
      setWaitMsg(
        t("bookings.modifyOccupied", {
          defaultValue: "Esta hora está ocupada; escolle outra.",
        }),
      );
      return;
    }
    setForceAlts(true);
    if (!user) {
      goAcceso(s.id);
      return;
    }
    setWaitMsg(null);
    void apiX
      .joinWaitlist(slug, s.id)
      .then(() => setWaitMsg(t("waitlist.joined")))
      .catch(() => setWaitMsg(t("waitlist.error")));
  };

  /* REVISION-21 Q2: alternativas cando o día está cheo ou se toca unha ocupada. */
  useEffect(() => {
    if (!facility || readOnly) {
      setAlts([]);
      return;
    }
    if (!dayFull && !forceAlts) {
      setAlts([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const candidates: AltSuggestion[] = [];
      const quietCache = new Map<string, string[]>();

      const quietRank = async (fid: string, iso: string): Promise<Map<string, number>> => {
        const key = `${fid}|${iso}`;
        let hours = quietCache.get(key);
        if (!hours) {
          try {
            const r = await api.horasTranquilas(slug, fid, iso);
            hours = r.data.hours;
          } catch {
            hours = [];
          }
          quietCache.set(key, hours);
        }
        return new Map(hours.map((h, i) => [h, i]));
      };

      const pushFree = async (
        fid: string,
        fname: string,
        iso: string,
        list: Slot[],
        preferUnit?: string,
      ) => {
        const rank = await quietRank(fid, iso);
        const free = list.filter(
          (s) =>
            s.status === "free" &&
            slotInFranxa(s.start, franxa) &&
            (!preferUnit || s.unitId === preferUnit),
        );
        for (const s of free) {
          const quietScore = rank.get(s.start);
          candidates.push({
            key: s.id,
            facilityId: fid,
            facilityName: fname,
            date: iso,
            start: s.start,
            slotId: s.id,
            score:
              quietScore !== undefined
                ? quietScore
                : 40 + Number(s.start.slice(0, 2) || 12),
          });
        }
      };

      /* Mesma instalación, outro día. */
      for (let i = 0; i < days.length; i++) {
        if (cancelled) return;
        if (i === dayOffset) continue;
        const iso = isoFromDate(days[i]!);
        if (freeDays[iso] === false) continue;
        try {
          const r = await api.availability(slug, {
            facilityId,
            unitId: unitId || undefined,
            date: iso,
          });
          await pushFree(facilityId, facility.name, iso, r.data, unitId || undefined);
        } catch {
          /* ignore */
        }
      }

      /* Outra instalación do mesmo deporte (tipo), mesmo día e seguintes. */
      try {
        const all = await api.facilities(slug);
        const peers = all.data.filter(
          (f) => f.id !== facilityId && f.type === facility.type,
        );
        const dayIsos = days.map((d) => isoFromDate(d));
        /* REVISION-58 W2: limitar peers/días nas alternativas. */
        for (const peer of peers.slice(0, 2)) {
          if (cancelled) return;
          for (const iso of dayIsos.slice(0, 2)) {
            try {
              const r = await api.availability(slug, {
                facilityId: peer.id,
                date: iso,
              });
              await pushFree(peer.id, peer.name, iso, r.data);
              if (candidates.length >= 12) break;
            } catch {
              /* ignore */
            }
          }
          if (candidates.length >= 12) break;
        }
      } catch {
        /* ignore */
      }

      if (cancelled) return;
      const seen = new Set<string>();
      const sorted = candidates
        .sort(
          (a, b) =>
            a.score - b.score ||
            a.date.localeCompare(b.date) ||
            a.start.localeCompare(b.start),
        )
        .filter((c) => {
          const k = `${c.facilityId}|${c.date}|${c.start}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .slice(0, 3);
      setAlts(sorted);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    facility,
    facilityId,
    unitId,
    dayFull,
    forceAlts,
    readOnly,
    slug,
    days,
    dayOffset,
    freeDays,
    franxa,
  ]);

  if (user?.role === "citizen" && !user.consentAt) {
    const returnTo = encodeURIComponent(reservePath(selected));
    return <Navigate to={`/c/${slug}/antes-de-comezar?returnTo=${returnTo}`} replace />;
  }

  if (loading) {
    return (
      <main className="pa-page">
        <SkeletonBlock rows={6} />
      </main>
    );
  }

  if (!facility) {
    return (
      <main className="pa-page">
        <div className="pa-warn-banner" role="alert">
          <span aria-hidden>⚠</span>
          <span>{t("common.notFound")}</span>
        </div>
      </main>
    );
  }

  /* REVISION-20 H2: «Só clubs» — sen horas para a veciñanza (Deputación pode ver en só lectura). */
  if (
    facility.rulesApplied?.whoCanBook === "clubs" &&
    user?.role !== "club_manager" &&
    !readOnly
  ) {
    return (
      <main className="pa-page max-w-xl">
        <BackLink to={`/c/${slug}/reservar`}>{t("nav.reserve")}</BackLink>
        <h1 className="pa-h1 mt-4">{facility.name}</h1>
        <p className="mt-4 text-base text-graphite">
          {t("reserve.clubsOnly", {
            defaultValue:
              "Esta instalación resérvana os clubs. Para outro uso, contacta co concello.",
          })}
        </p>
      </main>
    );
  }

  const dayDate = days[dayOffset]!;
  const dayLabel = `${t(`weekdayShort.${dayDate.getDay()}`)} ${String(dayDate.getDate()).padStart(2, "0")}`;
  /* REVISION-46 V11: completa+medias non se suman como 3 pistas. */
  const unitNames = facility.units.map((u) => u.name.toLowerCase());
  const hasFull = unitNames.some(
    (n) => n.includes("completa") || n.includes("full"),
  );
  const hasHalfA = unitNames.some(
    (n) => /\ba\b/.test(n) || n.includes("media a") || n.endsWith(" a"),
  );
  const hasHalfB = unitNames.some(
    (n) => /\bb\b/.test(n) || n.includes("media b") || n.endsWith(" b"),
  );
  const chip =
    hasFull && hasHalfA && hasHalfB
      ? t("reserve.fullOrTwoHalves")
      : `${facility.units.length} ${
          facility.units.length === 1
            ? t("reserve.courtOne")
            : t("reserve.courtMany")
        }`;

  const sameAsOriginal =
    !!modifyId &&
    !!selectedSlot &&
    ((!!originalSlotId && selectedSlot.id === originalSlotId) ||
      (!!modifyFrom &&
        modifyFrom.date === date &&
        modifyFrom.start === selectedSlot.start));
  const changedPick =
    !!selectedSlot && !readOnly && (!modifyId || !sameAsOriginal);
  const hasPick = changedPick;

  const facPhone = (facility.contactPhone ?? "").trim();
  const facEmail = (facility.contactEmail ?? "").trim();
  const facPerson = (facility.contactPerson ?? "").trim();
  const facAddress = (facility.address ?? "").trim();
  const facLat = facility.lat;
  const facLng = facility.lng;
  const mapHref =
    facLat != null &&
    facLng != null &&
    Number.isFinite(facLat) &&
    Number.isFinite(facLng) &&
    !(facLat === 0 && facLng === 0)
      ? mobileMapUrl(
          facLat,
          facLng,
          facility.name,
          typeof navigator !== "undefined" ? navigator.userAgent : "",
        )
      : null;
  const parking = trimComoChegar(facility.parkingInfo);
  const transport = trimComoChegar(facility.publicTransport);
  const entrance = trimComoChegar(facility.entranceInfo);
  const accessHint = trimComoChegar(facility.accessibility);
  const hasMoreHints = !!(parking || transport || entrance || accessHint);
  const outdoorLabel = facility.outdoor
    ? t("reserve.outdoor")
    : t("reserve.indoor");
  const svc = servicesLine(facility.services, t, 3);
  const telHref = facPhone
    ? `tel:${facPhone.replace(/[^\d+]/g, "")}`
    : null;
  const rulesInlineSummary = rules
    ? t("reserve.rulesSummaryShort", {
        days: rules.bookingAntelationDays,
        max: rules.maxActiveBookings,
        hours: rules.cancelMinHours,
        defaultValue: `Ata ${rules.bookingAntelationDays} días · Máx. ${rules.maxActiveBookings} activas · Cancela ata ${rules.cancelMinHours} h`,
      })
    : "";

  /* REVISION-43 R6: unha liña «Lin e acepto… (resumo) · ver normas». */
  const acceptRulesRow =
    user && !modifyId ? (
      <label className="flex min-h-11 items-start gap-2.5 text-[14px] leading-snug">
        <input
          type="checkbox"
          className="mt-0.5 h-[22px] w-[22px] shrink-0 accent-azul"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
        />
        <span>
          {t("reserve.acceptRules")}
          {rulesInlineSummary ? (
            <>
              {" "}
              <span className="text-graphite">({rulesInlineSummary})</span>
            </>
          ) : null}{" "}
          ·{" "}
          <button
            type="button"
            className="font-bold text-azul-700 underline"
            onClick={() => setShowRules(true)}
          >
            {t("reserve.rulesLink")}
          </button>
        </span>
      </label>
    ) : null;

  /* PC sen hora: normas en pequeno debaixo do pickHint. */
  const rulesHintAside =
    rulesInlineSummary ? (
      <p className="m-0 text-center text-[12px] leading-snug text-graphite">
        {rulesInlineSummary} ·{" "}
        <button
          type="button"
          className="font-bold text-azul-700 underline"
          onClick={() => setShowRules(true)}
        >
          {t("reserve.rulesLink")}
        </button>
      </p>
    ) : null;

  const infoCard = (
    <section
      className="rounded-2xl border border-line bg-surface p-4"
      aria-labelledby="pa-facility-info-heading"
      data-testid="facility-info-card"
    >
      <h2
        id="pa-facility-info-heading"
        className="m-0 text-base font-extrabold text-marino"
        style={{ fontSize: 16 }}
      >
        {t("reserve.infoTitle")}
      </h2>
      <dl className="mt-3 m-0 grid gap-2 text-sm">
        {facPhone ? (
          <div>
            <dt className="sr-only">{t("contact.phone")}</dt>
            <dd className="m-0">
              <a className="font-bold text-azul-700 underline" href={telHref!}>
                {facPhone}
              </a>
              {facPerson ? (
                <span className="text-graphite">
                  {" "}
                  · {facPerson}
                </span>
              ) : null}
            </dd>
          </div>
        ) : facPerson ? (
          <div>
            <dt className="sr-only">{t("contact.person")}</dt>
            <dd className="m-0 font-bold text-marino">{facPerson}</dd>
          </div>
        ) : null}
        {facEmail ? (
          <div>
            <dt className="sr-only">{t("contact.email")}</dt>
            <dd className="m-0">
              <a
                className="font-bold text-azul-700 underline"
                href={`mailto:${facEmail}`}
              >
                {facEmail}
              </a>
            </dd>
          </div>
        ) : null}
        {facAddress ? (
          <div>
            <dt className="sr-only">{t("contact.address")}</dt>
            <dd className="m-0 text-marino">{facAddress}</dd>
          </div>
        ) : null}
      </dl>
      {mapHref ? (
        <a
          href={mapHref}
          className="pa-btn-secondary mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 no-underline sm:w-auto"
          data-testid="como-chegar-open-map"
        >
          <MapPinned size={18} strokeWidth={2.4} aria-hidden />
          {t("comoChegar.title")}
        </a>
      ) : null}
      {hasMoreHints ? (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-extrabold text-marino">
            {t("comoChegar.moreHints")}
          </summary>
          <ul className="mt-2 m-0 list-none space-y-2 p-0 text-graphite">
            {parking ? (
              <li>
                <strong className="text-marino">{t("comoChegar.parking")}: </strong>
                {parking}
              </li>
            ) : null}
            {transport ? (
              <li>
                <strong className="text-marino">
                  {t("comoChegar.publicTransport")}:{" "}
                </strong>
                {transport}
              </li>
            ) : null}
            {entrance ? (
              <li>
                <strong className="text-marino">{t("comoChegar.entrance")}: </strong>
                {entrance}
              </li>
            ) : null}
            {accessHint ? (
              <li>
                <strong className="text-marino">
                  {t("comoChegar.accessibility")}:{" "}
                </strong>
                {accessHint}
              </li>
            ) : null}
          </ul>
        </details>
      ) : null}
      <div className="mt-4 flex flex-col gap-2 border-t border-line pt-3 text-sm">
        <Link
          to={`/c/${slug}/contacto`}
          className="font-bold text-azul-700 no-underline hover:underline"
        >
          {t("reserve.otherContact")}
        </Link>
        <Link
          to={`/c/${slug}/incidencia?facility=${encodeURIComponent(facilityId)}`}
          className="font-bold text-azul-700 no-underline hover:underline"
        >
          {t("muni.reportIncident")}
        </Link>
      </div>
    </section>
  );

  return (
    <main
      className="relative min-h-0 overflow-x-hidden bg-paper pb-4 text-ink lg:pb-10"
      data-testid="reserve-form"
    >
      {readOnly ? <DeputacionReadOnlyBanner className="px-4 py-3 md:px-8" /> : null}
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-2 px-4 py-3 md:px-8">
          <span className="hidden text-sm font-bold text-graphite md:inline">
            <Link to={`/c/${slug}/reservar`} className="text-azul-700 underline">
              {t("nav.reserve")}
            </Link>
            <span className="mx-1.5 text-line" aria-hidden>
              ›
            </span>
            <span className="text-marino">{facility.name}</span>
          </span>
          <span className="md:hidden">
            <BackLink to={`/c/${slug}/reservar`}>{t("nav.reserve")}</BackLink>
          </span>
          {/* REVISION-46 D3: banda foto 120 móbil / 150 PC sen empurrar as horas. */}
          {facility.imageUrl ? (
            <div
              className="relative -mx-4 h-[120px] overflow-hidden bg-marino md:mx-0 md:h-[150px] md:rounded-card"
              aria-hidden={false}
            >
              <img
                src={facility.imageUrl}
                alt={facility.imageAlt?.trim() || facility.name}
                className="absolute inset-0 h-full w-full object-cover"
              />
              {/* REVISION-47 W6: degradado escuro baixo o título para ler sobre foto clara. */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/35 to-black/5" />
              <h1 className="pa-h1 relative m-0 px-4 pb-3 pt-10 text-[1.55rem] text-white md:px-5 md:text-[1.85rem]">
                {facility.name}
              </h1>
            </div>
          ) : (
            <div className="relative overflow-hidden">
              <CourtLinesBg
                className="pointer-events-none absolute -right-4 bottom-[-28px] hidden h-[100px] w-[180px] opacity-30 md:block"
                stroke="#9CC6E4"
              />
              <h1 className="pa-h1 relative m-0 text-[1.55rem] md:text-[1.85rem]">
                {facility.name}
              </h1>
            </div>
          )}
          <div className="relative">
            <div className="relative mt-2 flex flex-wrap gap-1.5">
              <span className="rounded-full border border-line bg-paper px-2.5 py-0.5 text-xs font-extrabold text-marino">
                {chip}
              </span>
              <span className="rounded-full border border-line bg-paper px-2.5 py-0.5 text-xs font-extrabold text-marino">
                {outdoorLabel}
              </span>
              {svc
                ? svc.split(" · ").map((s) => (
                    <span
                      key={s}
                      className="rounded-full border border-line bg-paper px-2.5 py-0.5 text-xs font-bold text-graphite"
                    >
                      {s}
                    </span>
                  ))
                : null}
            </div>
            <div className="relative mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              {facAddress || mapHref ? (
                mapHref ? (
                  <a
                    href={mapHref}
                    className="inline-flex items-center gap-1.5 font-bold text-azul-700 no-underline hover:underline"
                  >
                    <MapPinned size={14} strokeWidth={2.4} aria-hidden />
                    {facAddress
                      ? `${facAddress} · ${t("comoChegar.title")}`
                      : t("comoChegar.title")}
                  </a>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-graphite">
                    <MapPinned size={14} strokeWidth={2.4} aria-hidden />
                    {facAddress}
                  </span>
                )
              ) : null}
              {telHref ? (
                <a
                  href={telHref}
                  className="inline-flex items-center gap-1.5 font-bold text-azul-700 no-underline hover:underline"
                >
                  <Phone size={14} strokeWidth={2.4} aria-hidden />
                  {facPhone}
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      {facility?.publishedSeasons && facility.publishedSeasons.length > 0 ? (
        <p
          className="mx-auto max-w-[1200px] px-4 pt-3 text-sm font-bold text-marino md:px-8"
          role="status"
          data-testid="facility-season-notice"
        >
          {t("reserve.seasonNotice", {
            from: formatDateLong(
              facility.publishedSeasons[0]!.startsAt.slice(0, 10),
              i18n.language,
            ),
            to: formatDateLong(
              facility.publishedSeasons[0]!.endsAt.slice(0, 10),
              i18n.language,
            ),
          })}
        </p>
      ) : null}

      {facility?.upcomingClosures && facility.upcomingClosures.length > 0 ? (
        <p
          className="mx-auto max-w-[1200px] px-4 pt-3 text-sm font-bold text-aviso md:px-8"
          role="status"
          data-testid="facility-closure-notice"
        >
          {(() => {
            const c = facility.upcomingClosures[0]!;
            const unitName = c.unitId
              ? facility.units.find((u) => u.id === c.unitId)?.name ?? null
              : null;
            return closureNoticeText(
              { ...c, unitName },
              i18n.language,
              t,
              formatDateLong,
            );
          })()}
        </p>
      ) : null}

      <div className="mx-auto max-w-[1200px] px-4 pt-3 md:px-8">
        <MeteoRainNotice
          slug={slug}
          facilityId={facilityId}
          date={date}
          start={selectedSlot?.start ?? "10:00"}
        />
      </div>

      {modifyId && modifyFrom ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 border-b border-ambar bg-ambar-bg px-4 py-3 text-[15px] font-bold text-marino md:px-8"
        >
          <span>
            {t("bookings.modifyBanner", {
              when: formatDayTimeChip(modifyFrom.date, modifyFrom.start, i18n.language),
            })}
          </span>
          <Link
            to={`/c/${slug}/reservar/${facilityId}`}
            className="font-extrabold text-azul-700 underline"
          >
            {t("bookings.modifyCancel")}
          </Link>
        </div>
      ) : null}

      <div className="mx-auto flex max-w-[1200px] flex-col gap-[22px] px-4 py-[18px] lg:flex-row lg:items-start lg:gap-8 lg:px-8 lg:py-7">
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-[22px]">
          {facility.units.length > 1 ? (
            <fieldset className="border-0 p-0">
              <legend className="mb-2.5 text-[13px] font-extrabold tracking-[0.08em] text-graphite">
                {t("reserve.unitLabel")}
              </legend>
              <Segmented
                tone="pill"
                aria-label={t("reserve.unit")}
                value={unitId}
                onChange={setUnitId}
                options={facility.units.map((u) => ({ value: u.id, label: u.name }))}
              />
            </fieldset>
          ) : null}

          <fieldset className="min-w-0 border-0 p-0">
            <legend className="mb-2.5 text-[13px] font-extrabold tracking-[0.08em] text-graphite">
              {t("portada.dayLabel")}
            </legend>
            <div className="flex min-w-0 gap-2 overflow-x-auto scroll-smooth pb-1 snap-x snap-mandatory [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {days.map((d, i) => {
                const iso = isoFromDate(d);
                return (
                  <DayTile
                    key={iso}
                    weekday={t(`weekdayShort.${d.getDay()}`)}
                    day={d.getDate()}
                    pressed={i === dayOffset}
                    hasFree={!!freeDays[iso]}
                    past={false}
                    onClick={() => setDayOffset(i)}
                    className="snap-start"
                  />
                );
              })}
            </div>
            <span className="mt-2 block text-[13px] text-graphite">
              {t("reserve.greenDotHint")}
            </span>
          </fieldset>

          <fieldset className="border-0 p-0">
            <legend className="mb-2.5 text-[13px] font-extrabold tracking-[0.08em] text-graphite">
              {t("reserve.hourLegend", { day: dayLabel.toUpperCase() })}
            </legend>
            {/* REVISION-43 R5: no móbil a indicación vai debaixo de HORA · día. */}
            {!readOnly && !hasPick ? (
              <p
                className="mb-2.5 text-sm font-bold text-marino lg:hidden"
                role="status"
              >
                {t("reserve.pickHint")}
              </p>
            ) : null}
            {(() => {
              /* REVISION-18 T6: só horas libres (non «A túa» / ocupadas). */
              const freeQuiet = quietHours.filter((h) =>
                visibleSlots.some((s) => {
                  if (s.start !== h) return false;
                  return slotState(s, selected, modifyFrom, date) === "libre";
                }),
              );
              return freeQuiet.length > 0 ? (
                <p className="mb-2.5 text-sm font-bold text-marino">
                  {t("reserve.quietHours", { hours: freeQuiet.join(", ") })}
                </p>
              ) : null;
            })()}
            {visibleSlots.length === 0 ? (
              <p className="text-sm text-graphite">{t("reserve.noSlots")}</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {visibleSlots.map((s) => {
                  let st = slotState(
                    s,
                    readOnly ? null : selected,
                    readOnly ? null : modifyFrom,
                    date,
                  );
                  if (readOnly && st === "tua") st = "ocupada";
                  return (
                    <SlotButton
                      key={s.id}
                      hour={s.start}
                      state={st}
                      disabled={readOnly}
                      onClick={
                        readOnly
                          ? undefined
                          : () => {
                              if (st === "ocupada") {
                                if (modifyId) {
                                  setWaitMsg(
                                    t("bookings.modifyOccupied", {
                                      defaultValue:
                                        "Esta hora está ocupada; escolle outra.",
                                    }),
                                  );
                                  return;
                                }
                                onOccupied(s);
                              } else if (st === "libre" || st === "escollida") {
                                pickSlot(s.id);
                              }
                            }
                      }
                      onOpenQr={
                        !readOnly && st === "tua" && s.bookingId
                          ? () => nav(`/c/${slug}/reserva/${s.bookingId}`)
                          : undefined
                      }
                    />
                  );
                })}
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-3.5 text-[13px] text-graphite">
              <span className="flex items-center gap-1.5">
                <span className="h-3.5 w-3.5 rounded border-[1.5px] border-libre-bd bg-libre-bg" />
                {t("ui.slot.libre")}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3.5 w-3.5 rounded bg-ocupada-bg" />
                {t("reserve.occupied")}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3.5 w-3.5 rounded border border-ambar bg-ambar-bg" />
                {t("reserve.yoursLegend")}
              </span>
            </div>
          </fieldset>

          {!readOnly && alts.length > 0 && (dayFull || forceAlts) ? (
            <div
              className="rounded-2xl border border-ambar bg-ambar-bg px-4 py-3.5"
              role="status"
            >
              <p className="m-0 text-[15px] font-extrabold text-marino">
                {t("reserve.fullAlternatives")}
              </p>
              <ul className="mt-2.5 space-y-2">
                {alts.map((a) => (
                  <li key={a.key}>
                    <Link
                      to={`/c/${slug}/reservar/${a.facilityId}?data=${encodeURIComponent(a.date)}&slot=${encodeURIComponent(a.slotId)}${modifyId ? `&modificar=${encodeURIComponent(modifyId)}` : ""}`}
                      className="flex min-h-11 items-center rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[15px] font-bold text-azul-700 no-underline hover:underline"
                    >
                      {t("reserve.altSlot", {
                        facility: a.facilityName,
                        when: formatDayTimeChip(a.date, a.start, i18n.language),
                      })}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {!readOnly ? (
            <a
              href="#wait-hint"
              className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5 text-ink no-underline"
            >
              <span className="flex flex-col">
                <strong className="text-[15px]">{t("reserve.waitHintTitle")}</strong>
                <span className="text-[13px] text-graphite">{t("reserve.waitHintBody")}</span>
              </span>
            </a>
          ) : null}

          {/* Móbil: Información ao final da columna (REVISION-42 Q2). */}
          <div className="lg:hidden">{infoCard}</div>
        </div>

        {/* PC ≥1024: panel sticky + Información fóra (REVISION-42 Q2 / 43 R6). */}
        {/* REVISION-46 V10: sen flex-basis 320 px no móbil (oco baleiro). */}
        <aside className="hidden min-w-0 flex-col gap-4 lg:flex lg:flex-[1_1_320px]">
          {!readOnly ? (
            <BottomSheet layout="aside">
              {hasPick ? (
                <>
                  <div className="flex items-center gap-3">
                    <span className="flex h-[52px] w-12 flex-none flex-col items-center justify-center rounded-xl bg-marino text-[11px] font-extrabold text-on-dark">
                      {t(`weekdayShort.${dayDate.getDay()}`)}
                      <span className="text-xl leading-none">{dayDate.getDate()}</span>
                    </span>
                    <span className="flex flex-col">
                      <strong className="text-[17px]">
                        {unitName} · {selectedSlot!.start}
                      </strong>
                      <span className="text-[13px] text-graphite">
                        {t("reserve.freeNote", {
                          hours: rules?.cancelMinHours ?? 2,
                        })}
                      </span>
                    </span>
                  </div>
                  {modifyId && modifyFrom ? (
                    <p className="text-[15px] font-bold text-marino">
                      {t("bookings.modifySummary", {
                        from: formatDayTimeChip(
                          modifyFrom.date,
                          modifyFrom.start,
                          i18n.language,
                        ),
                        to: formatDayTimeChip(
                          date,
                          selectedSlot!.start,
                          i18n.language,
                        ),
                      })}
                    </p>
                  ) : (
                    acceptRulesRow
                  )}
                  {sheetChrome}
                  {openMatchFields}
                  <MeteoRainNotice
                    slug={slug}
                    facilityId={facilityId}
                    date={date}
                    start={selectedSlot!.start}
                  />
                  {sheetActions}
                </>
              ) : (
                <div className="flex flex-col gap-2 py-1">
                  <p className="m-0 py-1 text-center text-[15px] text-graphite">
                    {t("reserve.pickHint")}
                  </p>
                  {rulesHintAside}
                </div>
              )}
            </BottomSheet>
          ) : null}
          {infoCard}
        </aside>
      </div>

      {/* Móbil: folla só con hora escollida (R5/R6/R7). */}
      {!readOnly && hasPick ? (
        <div className="lg:hidden">
          {/* REVISION-43 R7: fondo escuro detrás da folla (agocha a barra). */}
          <button
            type="button"
            aria-label={t("common.close")}
            className="fixed inset-0 z-30 bg-[rgba(0,43,74,0.45)] lg:hidden"
            onClick={cancelDialog}
          />
          <BottomSheet
            layout="sheet"
            className="z-40"
            data-testid="reserve-sheet"
            data-pa-reserve-sheet="1"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-[52px] w-12 flex-none flex-col items-center justify-center rounded-xl bg-marino text-[11px] font-extrabold text-on-dark">
                {t(`weekdayShort.${dayDate.getDay()}`)}
                <span className="text-xl leading-none">{dayDate.getDate()}</span>
              </span>
              <span className="flex flex-col">
                <strong className="text-[17px]">
                  {unitName} · {selectedSlot!.start}
                </strong>
                <span className="text-[13px] text-graphite">
                  {t("reserve.freeNote", {
                    hours: rules?.cancelMinHours ?? 2,
                  })}
                </span>
              </span>
            </div>
            {modifyId && modifyFrom ? (
              <p className="text-[15px] font-bold text-marino">
                {t("bookings.modifySummary", {
                  from: formatDayTimeChip(
                    modifyFrom.date,
                    modifyFrom.start,
                    i18n.language,
                  ),
                  to: formatDayTimeChip(
                    date,
                    selectedSlot!.start,
                    i18n.language,
                  ),
                })}
              </p>
            ) : (
              acceptRulesRow
            )}
            {sheetChrome}
            {openMatchFields}
            <MeteoRainNotice
              slug={slug}
              facilityId={facilityId}
              date={date}
              start={selectedSlot!.start}
            />
            {sheetActions}
          </BottomSheet>
        </div>
      ) : null}

      <Dialog
        open={showRules}
        onClose={() => setShowRules(false)}
        title={t("reserve.rules")}
      >
        <ul className="mt-4 list-disc space-y-2 pl-5">
          {generatedRules.map((line) => (
            <li key={line}>{line}</li>
          ))}
          {rulesText.map((item) => (
            <li key={item.id}>
              {lang === "es" ? item.es || item.gl : item.gl || item.es}
            </li>
          ))}
        </ul>
        <Button className="mt-6" onClick={() => setShowRules(false)}>
          {t("common.close")}
        </Button>
      </Dialog>

      {error ? (
        <div className="pa-warn-banner fixed bottom-32 left-4 right-4 z-50 md:bottom-6 md:left-auto md:right-6 md:max-w-md">
          <span aria-hidden>⚠</span>
          <span>{error}</span>
        </div>
      ) : null}

      {waitMsg ? (
        <Toast message={waitMsg} onDismiss={() => setWaitMsg(null)} durationMs={5000} />
      ) : null}
    </main>
  );
}
