import { FormEvent, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiX } from "../lib/api-complete";
import { AdminEmbed, AdminShell } from "./AdminPages";
import { BackLink } from "../components/BackLink";
import { EmptyState } from "../components/EmptyState";
import { ListSearch, filterByQuery } from "../components/ListSearch";
import { FacilityTypeIcon } from "../components/icons";
import { formatDate, formatSentAt } from "../lib/format-date";
import { useSession } from "../context/SessionContext";
import { FilePickButton } from "../components/FilePickButton";
import { TimeField } from "../components/TimeField";
import { DateField } from "../components/DateField";
import { QrPlaceholder } from "../components/QrPlaceholder";
import { displayHost, fetchPublicConfig } from "../lib/public-config";
import { AdminFixedGroupsPage } from "./AdminFixedGroupsPage";
import { api } from "../lib/api";
import { AdminNewFacilityWizard } from "../components/AdminNewFacilityWizard";
import { FacilityMapPicker } from "../components/FacilityMapPicker";
import {
  clearFormDraft,
  loadFormDraft,
  normasDraftKey,
  saveFormDraft,
} from "../lib/form-drafts";
import { GALICIA_HOLIDAYS_2026_2027 } from "../lib/galicia-holidays";
import {
  formatClosureImpactBody,
  formatDrawConfirmBody,
  formatFacilityDeactivateImpactBody,
} from "../lib/impact-copy";
import { renderMatchCsvErrorLabel } from "../lib/match-csv-error";

type Rules = {
  bookingAntelationDays: number;
  maxActiveBookings: number;
  maxHoursPerWeek: number;
  cancelMinHours: number;
  checkInMarginMinutes: number;
  noShowReleaseMinutes: number;
  anonymizeAfterDays: number;
  noShowPenaltyCount: number;
  noShowPenaltyDays: number;
};

type WhoCanBook = "vecinhaza" | "clubs" | "ambas";
type BookingKind = WhoCanBook;

type TextItem = { id: string; order: number; gl: string; es: string };

type FacilityOverride = {
  whoCanBook: WhoCanBook;
  approvalRequired: boolean;
  informativePrice: string;
};

type FacilityNumericKey =
  | "bookingAntelationDays"
  | "maxActiveBookings"
  | "maxHoursPerWeek"
  | "cancelMinHours"
  | "checkInMarginMinutes"
  | "noShowReleaseMinutes"
  | "slotMinutes";

const FACILITY_NUMERIC_KEYS: FacilityNumericKey[] = [
  "bookingAntelationDays",
  "maxActiveBookings",
  "maxHoursPerWeek",
  "cancelMinHours",
  "checkInMarginMinutes",
  "noShowReleaseMinutes",
  "slotMinutes",
];

type NumericOverrideRow = { own: boolean; value: number };

function initNumericOverrides(
  general: Rules,
  raw: Record<string, unknown>,
): Record<FacilityNumericKey, NumericOverrideRow> {
  const out = {} as Record<FacilityNumericKey, NumericOverrideRow>;
  for (const key of FACILITY_NUMERIC_KEYS) {
    const generalVal =
      key === "slotMinutes" ? 60 : general[key as keyof Rules];
    if (raw[key] !== undefined && raw[key] !== null) {
      out[key] = { own: true, value: Number(raw[key]) };
    } else {
      out[key] = { own: false, value: Number(generalVal) };
    }
  }
  return out;
}

function Toast({ children }: { children: ReactNode }) {
  return (
    <p className="pa-ok-banner mt-4" role="status" aria-live="polite">
      ✓ {children}
    </p>
  );
}

function FieldError({ msg }: { msg?: string | null }) {
  if (!msg) return null;
  return (
    <p className="mt-1 flex items-center gap-1 text-sm font-bold text-[var(--pa-warn-text,#8a5a00)]" role="alert">
      <span aria-hidden>⚠</span> {msg}
    </p>
  );
}

export function AdminRulesEditorPage({
  sections = "all",
  facilityId,
}: {
  /** system = Concello › Normas xerais; text = ficha instalación; all = páxina completa. */
  sections?: "all" | "system" | "text";
  /** Se indicado, garda sobrescrita da instalación (non normas do concello). */
  facilityId?: string;
} = {}) {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const { t } = useTranslation();
  const [rules, setRules] = useState<Rules | null>(null);
  const [rulesGeneral, setRulesGeneral] = useState<Rules | null>(null);
  const [text, setText] = useState<TextItem[]>([]);
  const [override, setOverride] = useState<FacilityOverride>({
    whoCanBook: "ambas",
    approvalRequired: false,
    informativePrice: "",
  });
  const [existingOverride, setExistingOverride] = useState<Record<string, unknown>>({});
  const [numericOverrides, setNumericOverrides] = useState<
    Record<FacilityNumericKey, NumericOverrideRow> | null
  >(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const facilityMode = Boolean(facilityId);
  const showSystem = !facilityMode && (sections === "all" || sections === "system");
  const showText = sections === "all" || sections === "text";
  const showFacilityPolicy = facilityMode;
  const draftKey = normasDraftKey(slug, facilityId);

  const load = useCallback(() => {
    if (facilityId) {
      void apiX.facilityNormas(slug, facilityId).then((r) => {
        const draft = loadFormDraft<{
          rules?: Rules;
          text?: TextItem[];
          override?: FacilityOverride;
        }>(draftKey);
        setRules(draft?.rules ?? r.data.rules);
        setRulesGeneral(r.data.rulesGeneral ?? r.data.rules);
        setText(
          draft?.text ??
            [...r.data.rulesText].sort((a, b) => a.order - b.order),
        );
        const raw = (r.data.rulesOverride ?? {}) as Record<string, unknown>;
        setExistingOverride(raw);
        setNumericOverrides(
          initNumericOverrides(r.data.rulesGeneral ?? r.data.rules, raw),
        );
        const who = raw.whoCanBook;
        setOverride(
          draft?.override ?? {
            whoCanBook:
              who === "vecinhaza" || who === "clubs" || who === "ambas"
                ? who
                : (r.data.rules.whoCanBook ?? "ambas"),
            approvalRequired: Boolean(
              raw.approvalRequired ?? r.data.rules.approvalRequired ?? false,
            ),
            informativePrice: String(
              raw.informativePrice ?? r.data.rules.informativePrice ?? "",
            ),
          },
        );
        setDraftHydrated(true);
      });
      return;
    }
    void apiX.normas(slug).then((r) => {
      const draft = loadFormDraft<{ rules?: Rules; text?: TextItem[] }>(draftKey);
      setRules(draft?.rules ?? r.data.rules);
      setRulesGeneral(r.data.rules);
      setText(
        draft?.text ?? [...r.data.rulesText].sort((a, b) => a.order - b.order),
      );
      setDraftHydrated(true);
    });
  }, [slug, facilityId, draftKey]);

  useEffect(() => {
    setDraftHydrated(false);
    load();
  }, [load]);

  useEffect(() => {
    if (!draftHydrated || !rules) return;
    saveFormDraft(draftKey, { rules, text, override });
  }, [draftHydrated, draftKey, rules, text, override]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!rules) return;
    setSaving(true);
    setErr(null);
    setSaved(false);
    try {
      const rulesText = text.map((item, i) => ({ ...item, order: i }));
      if (facilityId) {
        const rulesOverride: Record<string, unknown> = {
          ...existingOverride,
          whoCanBook: override.whoCanBook,
          approvalRequired: override.approvalRequired,
          informativePrice: override.informativePrice.trim(),
        };
        if (numericOverrides) {
          for (const key of FACILITY_NUMERIC_KEYS) {
            const row = numericOverrides[key];
            if (row.own) rulesOverride[key] = row.value;
            else delete rulesOverride[key];
          }
        }
        await apiX.putFacilityNormas(slug, facilityId, {
          rulesOverride,
          rulesText,
        });
      } else {
        await apiX.putNormas(slug, {
          rules,
          rulesText,
        });
      }
      clearFormDraft(draftKey);
      setSaved(true);
      load();
    } catch {
      setErr(t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  const addPoint = () => {
    setText((prev) => [
      ...prev,
      {
        id: `rt-${Date.now()}`,
        order: prev.length,
        gl: "",
        es: "",
      },
    ]);
  };

  const move = (idx: number, dir: -1 | 1) => {
    setText((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      const tmp = next[idx]!;
      next[idx] = next[j]!;
      next[j] = tmp;
      return next;
    });
  };

  if (!rules) {
    return (
      <AdminShell active="normas">
        <p className="text-graphite">{t("common.loading")}</p>
      </AdminShell>
    );
  }

  const fields: Array<{ key: keyof Rules; label: string }> = [
    { key: "bookingAntelationDays", label: t("admin.ruleAntelation") },
    { key: "maxActiveBookings", label: t("admin.ruleMaxActive") },
    { key: "maxHoursPerWeek", label: t("admin.ruleMaxHours") },
    { key: "cancelMinHours", label: t("admin.ruleCancel") },
    { key: "checkInMarginMinutes", label: t("admin.ruleCheckinMargin") },
    { key: "noShowReleaseMinutes", label: t("admin.ruleNoShow") },
    { key: "anonymizeAfterDays", label: t("admin.ruleAnonymize") },
    { key: "noShowPenaltyCount", label: t("admin.ruleNoShowPenaltyCount") },
    { key: "noShowPenaltyDays", label: t("admin.ruleNoShowPenaltyDays") },
  ];

  const pageTitle = facilityMode
    ? t("admin.tabNormas")
    : sections === "system"
      ? t("admin.rulesGeneral")
      : sections === "text"
        ? t("admin.rulesText")
        : t("admin.rules");

  return (
    <AdminShell active="normas" pageTitle={pageTitle}>
      {sections === "all" && !facilityMode ? (
        <p className="text-graphite">{t("admin.rulesHintEdit")}</p>
      ) : null}
      <form onSubmit={(e) => void save(e)} className="mt-6 flex flex-col gap-6">
        {showSystem ? (
          <section className="pa-card space-y-3 p-5">
            <h2 className="font-bold">{t("admin.rulesSystem")}</h2>
            <div className="grid gap-3 lg:grid-cols-2">
              {fields.map((f) => (
                <label key={f.key} className="flex flex-col gap-1 text-sm font-bold">
                  {f.label}
                  <input
                    type="number"
                    className="pa-input"
                    value={rules[f.key]}
                    onChange={(e) =>
                      setRules({ ...rules, [f.key]: Number(e.target.value) })
                    }
                  />
                </label>
              ))}
            </div>
          </section>
        ) : null}

        {showFacilityPolicy ? (
          <section className="pa-card space-y-3 p-5">
            <h2 className="font-bold">{t("admin.facilityNormasPolicy")}</h2>
            <p className="text-sm font-normal text-graphite">
              {t("admin.facilityNormasPolicyHint")}
            </p>
            <label className="flex flex-col gap-1 text-sm font-bold">
              {t("admin.whoCanBook")}
              <select
                className="pa-input"
                value={override.whoCanBook}
                onChange={(e) =>
                  setOverride({
                    ...override,
                    whoCanBook: e.target.value as WhoCanBook,
                  })
                }
              >
                <option value="ambas">{t("admin.bookingKind.ambas")}</option>
                <option value="vecinhaza">{t("admin.bookingKind.vecinhaza")}</option>
                <option value="clubs">{t("admin.bookingKind.clubs")}</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm font-bold">
              <input
                type="checkbox"
                checked={override.approvalRequired}
                onChange={(e) =>
                  setOverride({
                    ...override,
                    approvalRequired: e.target.checked,
                  })
                }
              />
              {t("admin.approvalRequired")}
            </label>
            <label className="flex flex-col gap-1 text-sm font-bold">
              {t("admin.informativePrice")}
              <input
                className="pa-input"
                value={override.informativePrice}
                onChange={(e) =>
                  setOverride({
                    ...override,
                    informativePrice: e.target.value,
                  })
                }
                placeholder={t("admin.informativePricePlaceholder")}
              />
            </label>
          </section>
        ) : null}

        {showFacilityPolicy && rulesGeneral && numericOverrides ? (
          <section className="pa-card space-y-3 p-5">
            <h2 className="font-bold">{t("admin.facilityNormasNumeric")}</h2>
            <p className="text-sm font-normal text-graphite">
              {t("admin.facilityNormasNumericHint")}
            </p>
            {(
              [
                { key: "bookingAntelationDays" as const, label: t("admin.ruleAntelation") },
                { key: "maxActiveBookings" as const, label: t("admin.ruleMaxActive") },
                { key: "maxHoursPerWeek" as const, label: t("admin.ruleMaxHours") },
                { key: "cancelMinHours" as const, label: t("admin.ruleCancel") },
                {
                  key: "checkInMarginMinutes" as const,
                  label: t("admin.ruleCheckinMargin"),
                },
                { key: "noShowReleaseMinutes" as const, label: t("admin.ruleNoShow") },
                { key: "slotMinutes" as const, label: t("admin.slotMinutes") },
              ] as const
            ).map(({ key, label }) => {
              const row = numericOverrides[key];
              const generalVal =
                key === "slotMinutes" ? 60 : rulesGeneral[key as keyof Rules];
              return (
                <div key={key} className="rounded-btn border border-line p-3">
                  <p className="text-sm font-bold">{label}</p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                    <label className="flex min-h-11 items-center gap-2 text-sm font-bold">
                      <input
                        type="radio"
                        name={`rule-${key}`}
                        checked={!row.own}
                        onChange={() =>
                          setNumericOverrides((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  [key]: { own: false, value: Number(generalVal) },
                                }
                              : prev,
                          )
                        }
                      />
                      {t("admin.ruleUseGeneral", { value: generalVal })}
                    </label>
                    <label className="flex min-h-11 items-center gap-2 text-sm font-bold">
                      <input
                        type="radio"
                        name={`rule-${key}`}
                        checked={row.own}
                        onChange={() =>
                          setNumericOverrides((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  [key]: {
                                    own: true,
                                    value: row.own ? row.value : Number(generalVal),
                                  },
                                }
                              : prev,
                          )
                        }
                      />
                      {t("admin.ruleUseOwn")}
                    </label>
                  </div>
                  {row.own ? (
                    key === "slotMinutes" ? (
                      <select
                        className="pa-input mt-2 max-w-[8rem]"
                        value={row.value}
                        onChange={(e) =>
                          setNumericOverrides((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  slotMinutes: {
                                    own: true,
                                    value: Number(e.target.value),
                                  },
                                }
                              : prev,
                          )
                        }
                      >
                        {[30, 60, 90].map((m) => (
                          <option key={m} value={m}>
                            {m} min
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="number"
                        className="pa-input mt-2 max-w-[8rem]"
                        value={row.value}
                        onChange={(e) =>
                          setNumericOverrides((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  [key]: { own: true, value: Number(e.target.value) },
                                }
                              : prev,
                          )
                        }
                      />
                    )
                  ) : null}
                </div>
              );
            })}
          </section>
        ) : null}

        {showText ? (
          <section className="pa-card space-y-3 p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-bold">{t("admin.rulesText")}</h2>
              <button type="button" className="pa-btn-secondary text-sm" onClick={addPoint}>
                {t("admin.add")}
              </button>
            </div>
            {text.map((item, idx) => (
              <div key={item.id} className="rounded-btn border border-line p-3">
                <div className="mb-2 flex gap-2">
                  <button type="button" className="text-sm font-bold underline" onClick={() => move(idx, -1)}>
                    ↑
                  </button>
                  <button type="button" className="text-sm font-bold underline" onClick={() => move(idx, 1)}>
                    ↓
                  </button>
                  <button
                    type="button"
                    className="ml-auto text-sm font-bold underline"
                    onClick={() => setText((p) => p.filter((_, i) => i !== idx))}
                  >
                    {t("admin.delete")}
                  </button>
                </div>
                <label className="flex flex-col gap-1 text-sm font-bold">
                  GL
                  <input
                    className="pa-input"
                    value={item.gl}
                    onChange={(e) =>
                      setText((p) =>
                        p.map((x, i) => (i === idx ? { ...x, gl: e.target.value } : x)),
                      )
                    }
                  />
                </label>
                <label className="mt-2 flex flex-col gap-1 text-sm font-bold">
                  ES
                  <input
                    className="pa-input"
                    value={item.es}
                    onChange={(e) =>
                      setText((p) =>
                        p.map((x, i) => (i === idx ? { ...x, es: e.target.value } : x)),
                      )
                    }
                  />
                </label>
              </div>
            ))}
          </section>
        ) : null}

        <button type="submit" className="pa-btn-primary self-start" disabled={saving}>
          {t("admin.save")}
        </button>
        {saved && <Toast>{t("admin.saved")}</Toast>}
        <FieldError msg={err} />
      </form>
    </AdminShell>
  );
}

const FACILITY_TYPES = ["pista", "pavillon", "campo", "sala"] as const;
type FacilityType = (typeof FACILITY_TYPES)[number];

type FacilityTab = "datos" | "horarios-peches" | "normas" | "acceso";

function normalizeFacilityTab(tab: string | null): FacilityTab {
  if (tab === "unidades") return "datos";
  if (tab === "horarios" || tab === "peches") return "horarios-peches";
  if (tab === "grupos") return "horarios-peches";
  if (tab === "cartel-qr") return "acceso";
  if (
    tab === "datos" ||
    tab === "horarios-peches" ||
    tab === "normas" ||
    tab === "acceso"
  ) {
    return tab;
  }
  return "datos";
}

function legacyTabFocusPeches(tab: string | null): boolean {
  return tab === "peches";
}

type FacilityImpact = {
  cancelledCount: number;
  peopleCount: number;
  matchCount: number;
};

function FacilityImpactDialog({
  title,
  body,
  busy,
  onCancel,
  onConfirm,
  confirmLabel,
}: {
  title: string;
  body: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(0,43,74,0.4)] p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="facility-impact-title"
    >
      <div className="pa-card w-full max-w-lg space-y-4 p-6">
        <h2 id="facility-impact-title" className="m-0 text-xl font-extrabold text-marino">
          {title}
        </h2>
        <p className="m-0 text-graphite">{body}</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button type="button" className="pa-btn-primary" disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button type="button" className="pa-btn-secondary" disabled={busy} onClick={onCancel}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AdminFacilitiesEditorPage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const { t } = useTranslation();
  const [list, setList] = useState<
    Array<{
      id: string;
      name: string;
      type: string;
      address: string;
      active: boolean;
      rules?: string;
      units: Array<{ id: string; name: string }>;
    }>
  >([]);
  const [listLoading, setListLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showCensus, setShowCensus] = useState(false);
  const [censusRows, setCensusRows] = useState<
    Array<{ key: string; name: string; type: string; alreadyCreated: boolean }>
  >([]);
  const [censusMarked, setCensusMarked] = useState<Set<string>>(new Set());
  const [censusBusy, setCensusBusy] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [deactivateImpact, setDeactivateImpact] = useState<FacilityImpact | null>(
    null,
  );
  const [deactivateBusy, setDeactivateBusy] = useState(false);
  const [q, setQ] = useState("");

  const load = useCallback(() => {
    setListLoading(true);
    void apiX
      .adminFacilities(slug)
      .then((r) =>
        setList(
          r.data.map((f) => ({
            id: f.id,
            name: f.name,
            type: String(f.type ?? ""),
            address: String(f.address ?? ""),
            active: !!f.active,
            rules: String((f as { rules?: string }).rules ?? ""),
            units: f.units,
          })),
        ),
      )
      .catch(() => {
        setErr(t("common.error"));
        setList([]);
      })
      .finally(() => setListLoading(false));
  }, [slug, t]);

  useEffect(() => {
    load();
  }, [load]);

  const isDraftFacility = (f: { active: boolean; rules?: string }) =>
    !f.active && /borrador/i.test(f.rules ?? "");

  const loadCensus = useCallback(() => {
    void apiX.censusFacilitySuggestions(slug).then((r) => {
      setCensusRows(r.data);
      setCensusMarked(
        new Set(r.data.filter((x) => !x.alreadyCreated).map((x) => x.key)),
      );
    });
  }, [slug]);

  const requestDeactivate = async (f: { id: string; name: string }) => {
    setDeactivateBusy(true);
    try {
      const r = await apiX.updateFacility(slug, f.id, { active: false });
      const data = r.data;
      if (data.needsConfirm) {
        setDeactivateImpact({
          cancelledCount: data.cancelledCount ?? 0,
          peopleCount: data.peopleCount ?? 0,
          matchCount: data.matchCount ?? 0,
        });
        setDeactivateTarget(f);
        return;
      }
      load();
    } catch {
      setErr(t("common.error"));
    } finally {
      setDeactivateBusy(false);
    }
  };

  const confirmDeactivate = async () => {
    if (!deactivateTarget) return;
    setDeactivateBusy(true);
    try {
      await apiX.updateFacility(slug, deactivateTarget.id, {
        active: false,
        confirm: true,
      });
      setDeactivateTarget(null);
      setDeactivateImpact(null);
      load();
    } catch {
      setErr(t("common.error"));
    } finally {
      setDeactivateBusy(false);
    }
  };

  const createFromCensus = async () => {
    const keys = [...censusMarked];
    if (keys.length === 0) return;
    setCensusBusy(true);
    setErr(null);
    try {
      const r = await apiX.createFacilitiesFromCensus(slug, keys);
      setSaved(true);
      setShowCensus(false);
      load();
      setMsg(t("admin.censusCreated", { count: r.data.count, n: r.data.count }));
    } catch {
      setErr(t("common.error"));
    } finally {
      setCensusBusy(false);
    }
  };

  const typeLabel = (ty: string) =>
    t(`facilities.type.${ty}`, { defaultValue: ty });

  const filtered = useMemo(
    () =>
      filterByQuery(list, q, (f) => [f.name, f.address, f.type, ...f.units.map((u) => u.name)]),
    [list, q],
  );

  return (
    <AdminShell active="instalacions" pageTitle={t("admin.facilities")}>
      <p className="text-sm text-graphite">{t("admin.facilitiesHint")}</p>

      <ListSearch
        value={q}
        onChange={setQ}
        placeholder={t("admin.search")}
        count={list.length}
      />

      {listLoading ? (
        <p className="mt-6 text-graphite" role="status">
          {t("common.loading")}
        </p>
      ) : list.length === 0 ? (
        <div className="mt-6">
          <EmptyState title={t("admin.facilitiesEmpty")} body={t("admin.facilitiesEmptyHint")} />
          <button
            type="button"
            className="pa-btn-primary mt-3"
            onClick={() => setShowCreate(true)}
          >
            {t("admin.addFacility")}
          </button>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {filtered.map((f) => (
            <li key={f.id} className="pa-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex gap-3">
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-btn bg-area text-ink">
                    <FacilityTypeIcon type={f.type} size={36} />
                  </span>
                  <div>
                    <p className="font-bold">
                      {f.name}{" "}
                      <span className="text-sm font-normal text-graphite">
                        ({typeLabel(f.type)})
                      </span>{" "}
                      {!f.active && isDraftFacility(f) && (
                        <span className="pa-chip-off ml-1">{t("admin.facilityDraft")}</span>
                      )}
                      {!f.active && !isDraftFacility(f) && (
                        <span className="pa-chip-off ml-1">{t("admin.inactive")}</span>
                      )}
                    </p>
                    <p className="text-sm text-graphite">
                      {f.address} · {f.units.map((u) => u.name).join(" · ")}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    to={`/c/${slug}/admin/instalacions/${f.id}`}
                    className="pa-btn-secondary text-sm"
                  >
                    {t("admin.openFacility")}
                  </Link>
                  {f.active && (
                    <button
                      type="button"
                      className="pa-btn-secondary text-sm"
                      disabled={deactivateBusy}
                      onClick={() => void requestDeactivate({ id: f.id, name: f.name })}
                    >
                      {t("admin.deactivate")}
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-8 flex flex-wrap gap-2">
        <button
          type="button"
          className="pa-btn-secondary"
          aria-expanded={showCreate}
          onClick={() => setShowCreate((v) => !v)}
        >
          {showCreate ? "×" : "+"} {t("admin.addFacility")}
        </button>
        <button
          type="button"
          className="pa-btn-secondary"
          aria-expanded={showCensus}
          onClick={() => {
            setShowCensus((v) => !v);
            if (!showCensus) loadCensus();
          }}
        >
          {showCensus ? "×" : "+"} {t("admin.censusAssistantTitle")}
        </button>
      </div>
        {showCreate && (
          <AdminNewFacilityWizard
            slug={slug}
            onCreated={() => {
              setSaved(true);
              setShowCreate(false);
              load();
            }}
            onCancel={() => setShowCreate(false)}
          />
        )}
        {showCensus && (
          <div className="pa-card mt-4 space-y-3 p-5">
            <h2 className="font-bold">{t("admin.censusAssistantTitle")}</h2>
            <p className="text-sm text-graphite">{t("admin.censusAssistantHint")}</p>
            {censusRows.filter((r) => !r.alreadyCreated).length === 0 ? (
              <p className="text-sm text-graphite">{t("admin.censusEmpty")}</p>
            ) : (
              <ul className="space-y-2">
                {censusRows
                  .filter((r) => !r.alreadyCreated)
                  .map((r) => (
                    <li key={r.key}>
                      <label className="flex items-center gap-2 text-sm font-bold">
                        <input
                          type="checkbox"
                          checked={censusMarked.has(r.key)}
                          onChange={() => {
                            setCensusMarked((prev) => {
                              const next = new Set(prev);
                              if (next.has(r.key)) next.delete(r.key);
                              else next.add(r.key);
                              return next;
                            });
                          }}
                        />
                        {r.name}{" "}
                        <span className="font-normal text-graphite">({typeLabel(r.type)})</span>
                      </label>
                    </li>
                  ))}
              </ul>
            )}
            <button
              type="button"
              className="pa-btn-primary"
              disabled={censusBusy || censusMarked.size === 0}
              onClick={() => void createFromCensus()}
            >
              {t("admin.add")}
            </button>
          </div>
        )}
      {deactivateImpact && deactivateTarget ? (
        <FacilityImpactDialog
          title={t("admin.facilityDeactivateImpactTitle")}
          body={formatFacilityDeactivateImpactBody(t, {
            bookings: deactivateImpact.cancelledCount,
            people: deactivateImpact.peopleCount,
            matches: deactivateImpact.matchCount,
          })}
          busy={deactivateBusy}
          confirmLabel={t("admin.deactivate")}
          onCancel={() => {
            setDeactivateTarget(null);
            setDeactivateImpact(null);
          }}
          onConfirm={() => void confirmDeactivate()}
        />
      ) : null}
      {saved && <Toast>{t("admin.saved")}</Toast>}
      {msg && <Toast>{msg}</Toast>}
      <FieldError msg={err} />
    </AdminShell>
  );
}

export function AdminFacilityDetailPage() {
  const { slug: slugParam, id = "" } = useParams();
  const slug = slugParam!;
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [tab, setTab] = useState<FacilityTab>(() => normalizeFacilityTab(tabParam));
  const pechesFocus = legacyTabFocusPeches(tabParam);

  const selectTab = (idTab: FacilityTab) => {
    setTab(idTab);
    const next = new URLSearchParams(searchParams);
    next.set("tab", idTab);
    next.delete("focus");
    setSearchParams(next, { replace: true });
  };
  /* REVISION-19 B3: claves fixas sen tiles (gl) + i18n. */
  const SERVICE_KEYS = [
    "vestiarios",
    "duchas",
    "aparcadoiro",
    "iluminacion",
    "auga",
    "cafeteria",
    "marcador",
    "son",
    "espellos",
  ] as const;
  const normalizeServiceKey = (raw: string): string => {
    const k = raw
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .trim();
    if (k === "aparcamiento" || k === "parking") return "aparcadoiro";
    return k;
  };
  const [fac, setFac] = useState<{
    id: string;
    name: string;
    type: string;
    address: string;
    lat: number;
    lng: number;
    rules: string;
    active: boolean;
    accessibility: string;
    parkingInfo?: string | null;
    publicTransport?: string | null;
    entranceInfo?: string | null;
    services: string[];
    imageDataUrl: string | null;
    checkInRequired?: boolean;
    contactPhone?: string | null;
    contactEmail?: string | null;
    contactPerson?: string | null;
    units: Array<{
      id: string;
      name: string;
      active?: boolean;
      slotMinutes?: number;
      bookingKind?: BookingKind;
      incompatibleWith?: string[];
    }>;
  } | null>(null);
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState<FacilityType>("pista");
  const [editAddress, setEditAddress] = useState("");
  const [editLat, setEditLat] = useState(42.75);
  const [editLng, setEditLng] = useState(-7.65);
  const [editAccess, setEditAccess] = useState("");
  const [editParking, setEditParking] = useState("");
  const [editTransport, setEditTransport] = useState("");
  const [editEntrance, setEditEntrance] = useState("");
  const [editServices, setEditServices] = useState<string[]>([]);
  const [editPhoto, setEditPhoto] = useState<string | null>(null);
  const [editPhotoAlt, setEditPhotoAlt] = useState("");
  const [editCheckInRequired, setEditCheckInRequired] = useState(false);
  const [editContactPhone, setEditContactPhone] = useState("");
  const [editContactEmail, setEditContactEmail] = useState("");
  const [editContactPerson, setEditContactPerson] = useState("");
  const [newUnit, setNewUnit] = useState("");
  const [unitDrafts, setUnitDrafts] = useState<
    Record<
      string,
      { name: string; active: boolean; incompatibleWith: string[] }
    >
  >({});
  const [publishBusy, setPublishBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    void apiX.adminFacilities(slug).then((r) => {
      const f = r.data.find((x) => x.id === id);
      if (!f) {
        setFac(null);
        return;
      }
      const mapped = {
        id: f.id,
        name: f.name,
        type: String(f.type ?? ""),
        address: String(f.address ?? ""),
        lat: Number(f.lat ?? 0),
        lng: Number(f.lng ?? 0),
        rules: String((f as { rules?: string }).rules ?? ""),
        active: !!f.active,
        accessibility: String(f.accessibility ?? ""),
        parkingInfo: (f as { parkingInfo?: string | null }).parkingInfo ?? null,
        publicTransport:
          (f as { publicTransport?: string | null }).publicTransport ?? null,
        entranceInfo: (f as { entranceInfo?: string | null }).entranceInfo ?? null,
        services: Array.isArray(f.services) ? (f.services as string[]) : [],
        imageDataUrl: (f.imageDataUrl as string | null) ?? null,
        checkInRequired: !!(f as { checkInRequired?: boolean }).checkInRequired,
        contactPhone: (f as { contactPhone?: string | null }).contactPhone ?? null,
        contactEmail: (f as { contactEmail?: string | null }).contactEmail ?? null,
        contactPerson:
          (f as { contactPerson?: string | null }).contactPerson ?? null,
        units: f.units.map((u) => ({
          id: u.id,
          name: u.name,
          active: u.active !== false,
          slotMinutes: u.slotMinutes ?? 60,
          bookingKind: (u.bookingKind ?? "ambas") as BookingKind,
          incompatibleWith: (u as { incompatibleWith?: string[] }).incompatibleWith ?? [],
        })),
      };
      setFac(mapped);
      setUnitDrafts(
        Object.fromEntries(
          mapped.units.map((u) => [
            u.id,
            {
              name: u.name,
              active: u.active !== false,
              incompatibleWith: u.incompatibleWith ?? [],
            },
          ]),
        ),
      );
      setEditName(mapped.name);
      setEditType(
        FACILITY_TYPES.includes(mapped.type as FacilityType)
          ? (mapped.type as FacilityType)
          : "pista",
      );
      setEditAddress(mapped.address);
      setEditLat(mapped.lat);
      setEditLng(mapped.lng);
      setEditAccess(mapped.accessibility);
      setEditParking(mapped.parkingInfo ?? "");
      setEditTransport(mapped.publicTransport ?? "");
      setEditEntrance(mapped.entranceInfo ?? "");
      setEditServices(
        [...new Set(mapped.services.map((s) => normalizeServiceKey(String(s))))],
      );
      setEditPhoto(mapped.imageDataUrl);
      setEditPhotoAlt(
        typeof (mapped as { imageAlt?: string | null }).imageAlt === "string"
          ? ((mapped as { imageAlt?: string | null }).imageAlt ?? "")
          : "",
      );
      setEditCheckInRequired(!!mapped.checkInRequired);
      setEditContactPhone(mapped.contactPhone ?? "");
      setEditContactEmail(mapped.contactEmail ?? "");
      setEditContactPerson(mapped.contactPerson ?? "");
    });
  }, [slug, id]);

  useEffect(() => {
    load();
  }, [load]);

  const typeLabel = (ty: string) => t(`facilities.type.${ty}`, { defaultValue: ty });

  const saveDatos = async (e: FormEvent) => {
    e.preventDefault();
    if (!fac) return;
    setSaving(true);
    setErr(null);
    setSaved(false);
    try {
      await apiX.updateFacility(slug, fac.id, {
        name: editName,
        type: editType,
        address: editAddress,
        lat: editLat,
        lng: editLng,
        accessibility: editAccess.trim().slice(0, 200),
        parkingInfo: editParking.trim().slice(0, 200) || null,
        publicTransport: editTransport.trim().slice(0, 200) || null,
        entranceInfo: editEntrance.trim().slice(0, 200) || null,
        services: editServices,
        imageDataUrl: editPhoto,
        imageAlt: editPhotoAlt.trim() || null,
        checkInRequired: editCheckInRequired,
        contactPhone: editContactPhone.trim() || null,
        contactEmail: editContactEmail.trim() || null,
        contactPerson: editContactPerson.trim() || null,
      });
      setSaved(true);
      load();
    } catch {
      setErr(t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  const onPhoto = (file: File | null) => {
    if (!file) {
      setEditPhoto(null);
      return;
    }
    if (file.size > 500_000) {
      setErr(t("common.error"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : null;
      setEditPhoto(result);
    };
    reader.readAsDataURL(file);
  };

  const toggleService = (key: string) => {
    setEditServices((prev) =>
      prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key],
    );
  };

  const addUnit = async (e: FormEvent) => {
    e.preventDefault();
    if (!fac || !newUnit.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      await apiX.createUnit(slug, fac.id, {
        name: newUnit.trim(),
      });
      setNewUnit("");
      setSaved(true);
      load();
    } catch {
      setErr(t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  const saveUnitDraft = async (unitId: string) => {
    if (!fac) return;
    const draft = unitDrafts[unitId];
    if (!draft) return;
    setSaving(true);
    setErr(null);
    setSaved(false);
    try {
      await apiX.updateUnit(slug, fac.id, unitId, {
        name: draft.name.trim(),
        active: draft.active,
      });
      await apiX.setUnitIncompatibles(slug, fac.id, unitId, draft.incompatibleWith);
      setSaved(true);
      load();
    } catch {
      setErr(t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  const publishFacility = async () => {
    if (!fac) return;
    setPublishBusy(true);
    setErr(null);
    try {
      await apiX.publishFacility(slug, fac.id);
      setSaved(true);
      load();
    } catch (ex) {
      const code = ex instanceof Error ? ex.message : "";
      setErr(code === "coords_required" ? t("admin.facilityCoordsRequired") : t("common.error"));
    } finally {
      setPublishBusy(false);
    }
  };

  if (!fac) {
    return (
      <AdminShell active="instalacions" pageTitle={t("admin.facilities")}>
        <p className="text-graphite">{t("common.loading")}</p>
      </AdminShell>
    );
  }

  const isDraft = !fac.active && /borrador/i.test(fac.rules ?? "");

  const tabs: Array<{ id: FacilityTab; label: string }> = [
    { id: "datos", label: t("admin.tabDatos") },
    { id: "horarios-peches", label: t("admin.tabHorariosPeches") },
    { id: "normas", label: t("admin.tabNormas") },
    { id: "acceso", label: t("admin.tabAcceso") },
  ];

  const firstUnit = fac.units[0]?.id ?? "";

  return (
    <AdminShell active="instalacions" pageTitle={fac.name}>
      <p className="mb-2">
        <BackLink to={`/c/${slug}/admin/instalacions`}>{t("admin.facilities")}</BackLink>
      </p>
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-btn bg-area">
          <FacilityTypeIcon type={fac.type} size={32} />
        </span>
        <p className="text-sm text-graphite">{typeLabel(fac.type)}</p>
        {isDraft ? (
          <span className="pa-chip-off">{t("admin.facilityDraft")}</span>
        ) : null}
      </div>
      {isDraft ? (
        <div className="mb-4 space-y-3">
          {/censo detectou/i.test(fac.rules ?? "") ? (
            <p className="pa-warn-banner text-sm" role="status">
              {fac.rules}
            </p>
          ) : (
            <p className="text-sm text-graphite">{t("admin.facilityDraftHint")}</p>
          )}
          <button
            type="button"
            className="pa-btn-primary"
            disabled={publishBusy}
            onClick={() => void publishFacility()}
          >
            {t("admin.facilityPublish")}
          </button>
        </div>
      ) : null}

      <div
        role="tablist"
        className="flex flex-wrap gap-2 pb-1"
        aria-label={t("admin.facilityTabs")}
      >
        {tabs.map((tb) => (
          <button
            key={tb.id}
            type="button"
            role="tab"
            aria-selected={tab === tb.id}
            className={`shrink-0 rounded-btn border px-3 py-2 text-sm font-bold ${
              tab === tb.id ? "border-ink bg-ink text-white" : "border-line bg-white"
            }`}
            onClick={() => selectTab(tb.id)}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {tab === "datos" && (
        <form onSubmit={(e) => void saveDatos(e)} className="pa-card mt-6 flex flex-col gap-3 p-5">
          <div className="grid gap-3 lg:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-bold">
            {t("admin.facilityName")}
            <input
              className="pa-input"
              required
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-bold">
            {t("admin.facilityType")}
            <select
              className="pa-input"
              value={editType}
              onChange={(e) => setEditType(e.target.value as FacilityType)}
            >
              {FACILITY_TYPES.map((ty) => (
                <option key={ty} value={ty}>
                  {typeLabel(ty)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-bold lg:col-span-2">
            {t("admin.facilityAddress")}
            <input
              className="pa-input"
              required
              value={editAddress}
              onChange={(e) => setEditAddress(e.target.value)}
            />
          </label>
          </div>
          <FacilityMapPicker
            lat={editLat}
            lng={editLng}
            onChange={({ lat, lng }) => {
              setEditLat(lat);
              setEditLng(lng);
            }}
            addressHint={editAddress}
          />
          <fieldset className="space-y-3 rounded-xl border border-line p-4">
            <legend className="px-1 text-sm font-bold">
              {t("comoChegar.title")}
            </legend>
            <p className="m-0 text-xs font-normal text-graphite">
              {t("admin.comoChegarHint")}
            </p>
            <div className="grid gap-3 lg:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-bold">
                {t("comoChegar.parking")}
                <textarea
                  className="pa-input min-h-[4rem]"
                  value={editParking}
                  maxLength={200}
                  onChange={(e) => setEditParking(e.target.value)}
                  placeholder={t("admin.comoChegarParkingPh")}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-bold">
                {t("comoChegar.publicTransport")}
                <textarea
                  className="pa-input min-h-[4rem]"
                  value={editTransport}
                  maxLength={200}
                  onChange={(e) => setEditTransport(e.target.value)}
                  placeholder={t("admin.comoChegarTransportPh")}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-bold">
                {t("comoChegar.entrance")}
                <textarea
                  className="pa-input min-h-[4rem]"
                  value={editEntrance}
                  maxLength={200}
                  onChange={(e) => setEditEntrance(e.target.value)}
                  placeholder={t("admin.comoChegarEntrancePh")}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-bold">
                {t("admin.facilityAccessibility")}
                <textarea
                  className="pa-input min-h-[4rem]"
                  value={editAccess}
                  maxLength={200}
                  onChange={(e) => setEditAccess(e.target.value)}
                  placeholder={t("admin.comoChegarAccessPh")}
                />
              </label>
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-sm font-bold">{t("admin.facilityServices")}</legend>
            <div className="mt-2 flex flex-wrap gap-3">
              {[
                ...SERVICE_KEYS,
                ...editServices.filter(
                  (k) => !(SERVICE_KEYS as readonly string[]).includes(k),
                ),
              ].map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm font-bold">
                  <input
                    type="checkbox"
                    checked={editServices.includes(k)}
                    onChange={() => toggleService(k)}
                  />
                  {t(`admin.svc.${k}`, { defaultValue: k })}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex flex-col gap-1 text-sm font-bold">
            <span className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={editCheckInRequired}
                onChange={(e) => setEditCheckInRequired(e.target.checked)}
              />
              {t("admin.checkInRequired")}
            </span>
            <span className="text-xs font-normal text-muted">
              {t("admin.checkInRequiredHint")}
            </span>
          </label>
          <fieldset className="space-y-3 rounded-xl border border-line p-4">
            <legend className="px-1 text-sm font-bold">
              {t("admin.facilityContact")}
            </legend>
            <p className="m-0 text-xs font-normal text-graphite">
              {t("admin.facilityContactHint")}
            </p>
            <div className="grid gap-3 lg:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-bold">
                {t("contact.phone")}
                <input
                  className="pa-input"
                  value={editContactPhone}
                  onChange={(e) => setEditContactPhone(e.target.value)}
                  maxLength={40}
                  type="tel"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-bold">
                {t("contact.email")}
                <input
                  className="pa-input"
                  value={editContactEmail}
                  onChange={(e) => setEditContactEmail(e.target.value)}
                  maxLength={120}
                  type="email"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-bold lg:col-span-2">
                {t("contact.person")}
                <input
                  className="pa-input"
                  value={editContactPerson}
                  onChange={(e) => setEditContactPerson(e.target.value)}
                  maxLength={120}
                  placeholder={t("admin.facilityContactPersonPh")}
                />
              </label>
            </div>
          </fieldset>
          {/* REVISION-46 D3: preview + Cambiar/Quitar + alt. */}
          <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 sm:flex-row">
            <div className="h-[130px] w-[200px] shrink-0 overflow-hidden rounded-[10px] border border-line bg-paper">
              {editPhoto ? (
                <img
                  src={editPhoto}
                  alt={editPhotoAlt || t("admin.facilityPhoto")}
                  className="h-full w-full object-cover"
                />
              ) : (
                <p className="m-0 flex h-full items-center justify-center px-2 text-center text-xs text-graphite">
                  {t("admin.facilityPhoto")}
                </p>
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <p className="m-0 text-sm font-bold">{t("admin.facilityPhoto")}</p>
              <p className="m-0 text-xs text-graphite">{t("admin.facilityPhotoHint")}</p>
              <label className="flex flex-col gap-1 text-sm font-bold">
                {t("admin.facilityPhotoAlt")}
                <input
                  className="pa-input"
                  maxLength={200}
                  value={editPhotoAlt}
                  onChange={(e) => setEditPhotoAlt(e.target.value)}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <FilePickButton
                  accept="image/*"
                  labelKey="admin.facilityPhotoChange"
                  onFile={(f) => void onPhoto(f)}
                />
                {editPhoto ? (
                  <button
                    type="button"
                    className="pa-btn-secondary text-sm"
                    onClick={() => setEditPhoto(null)}
                  >
                    {t("admin.facilityPhotoRemove")}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
          <button type="submit" className="pa-btn-primary self-start" disabled={saving}>
            {t("admin.save")}
          </button>
          {saved && <Toast>{t("admin.saved")}</Toast>}
          <FieldError msg={err} />
        </form>
      )}

      {tab === "datos" && (
        <section className="mt-6 max-w-2xl space-y-4">
          <h2 className="text-sm font-bold">{t("admin.unitsSection")}</h2>
          <ul className="space-y-3">
            {fac.units.map((u) => {
              const draft = unitDrafts[u.id] ?? {
                name: u.name,
                active: u.active !== false,
                incompatibleWith: u.incompatibleWith ?? [],
              };
              const others = fac.units.filter((x) => x.id !== u.id);
              return (
              <li key={u.id} className="pa-card space-y-3 p-4">
                <label className="flex flex-col gap-1 text-sm font-bold">
                  {t("admin.unit")}
                  <input
                    className="pa-input"
                    value={draft.name}
                    onChange={(e) =>
                      setUnitDrafts((prev) => ({
                        ...prev,
                        [u.id]: { ...draft, name: e.target.value },
                      }))
                    }
                  />
                </label>
                <label className="flex items-center gap-2 text-sm font-bold">
                  <input
                    type="checkbox"
                    checked={draft.active}
                    onChange={(e) =>
                      setUnitDrafts((prev) => ({
                        ...prev,
                        [u.id]: { ...draft, active: e.target.checked },
                      }))
                    }
                  />
                  {draft.active ? t("admin.unitActive") : t("admin.unitInactive")}
                </label>
                {others.length > 0 ? (
                  <fieldset>
                    <legend className="text-sm font-bold">{t("admin.unitIncompat")}</legend>
                    <div className="mt-2 space-y-1">
                      {others.map((o) => (
                        <label key={o.id} className="flex items-center gap-2 text-sm font-bold">
                          <input
                            type="checkbox"
                            checked={draft.incompatibleWith.includes(o.id)}
                            onChange={() => {
                              setUnitDrafts((prev) => {
                                const cur = prev[u.id] ?? draft;
                                const has = cur.incompatibleWith.includes(o.id);
                                const incompatibleWith = has
                                  ? cur.incompatibleWith.filter((id) => id !== o.id)
                                  : [...cur.incompatibleWith, o.id];
                                return {
                                  ...prev,
                                  [u.id]: { ...cur, incompatibleWith },
                                };
                              });
                            }}
                          />
                          {o.name}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ) : null}
                <button
                  type="button"
                  className="pa-btn-secondary text-sm"
                  disabled={saving}
                  onClick={() => void saveUnitDraft(u.id)}
                >
                  {t("admin.save")}
                </button>
              </li>
            );
            })}
            {fac.units.length === 0 && (
              <li className="text-sm text-graphite">{t("admin.unitsEmpty")}</li>
            )}
          </ul>
          <form onSubmit={(e) => void addUnit(e)} className="pa-card space-y-3 p-4">
            <h3 className="m-0 text-sm font-bold">{t("admin.addUnit")}</h3>
            <div className="flex flex-wrap gap-2">
              <input
                className="pa-input max-w-xs"
                value={newUnit}
                onChange={(e) => setNewUnit(e.target.value)}
                placeholder={t("admin.unit")}
                required
              />
              <button type="submit" className="pa-btn-primary" disabled={saving}>
                {t("admin.add")}
              </button>
            </div>
          </form>
          {saved && <Toast>{t("admin.saved")}</Toast>}
          <FieldError msg={err} />
        </section>
      )}

      {tab === "horarios-peches" && (
        <div className="mt-6 space-y-8">
          <p className="mb-2 text-sm text-graphite">
            {t("admin.tabHorariosHint")} {t("admin.tabPechesHint")}
          </p>
          <AdminEmbed>
            <AdminSchedulesEditorPage
              lockFacilityId={fac.id}
              lockUnitId={firstUnit}
              focusSection={pechesFocus ? "peches" : undefined}
            />
          </AdminEmbed>
          {/* REVISION-30 Z13: grupos fixos fóra de Acceso/QR. */}
          <AdminEmbed>
            <AdminFixedGroupsPage lockFacilityId={fac.id} />
          </AdminEmbed>
        </div>
      )}

      {tab === "normas" && (
        <div className="mt-6 space-y-4">
          <p className="text-sm text-graphite">{t("admin.tabNormasHint")}</p>
          <Link
            to={`/c/${slug}/admin/concello?tab=normas`}
            className="inline-flex text-sm font-extrabold text-azul-700 underline"
          >
            {t("admin.tabNormasSystemLink")}
          </Link>
          <AdminEmbed>
            <AdminRulesEditorPage sections="text" facilityId={fac.id} />
          </AdminEmbed>
        </div>
      )}

      {tab === "acceso" && (
        <div className="mt-6 space-y-8">
          <FacilityCartelQrTab slug={slug} facility={fac} />
        </div>
      )}
    </AdminShell>
  );
}

function FacilityCartelQrTab({
  slug,
  facility,
}: {
  slug: string;
  facility: { id: string; name: string; type: string };
}) {
  const { t } = useTranslation();
  const [host, setHost] = useState("demo.pistaaberta.com");
  useEffect(() => {
    void fetchPublicConfig().then((cfg) => setHost(displayHost(cfg)));
  }, []);
  const typeTag =
    facility.type === "pista"
      ? "PADEL"
      : facility.type === "pavillon"
        ? "PAV"
        : facility.type === "campo"
          ? "CAMPO"
          : facility.type === "sala"
            ? "SALA"
            : "PISTA";
  const code = `${slug}-${typeTag}`
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return (
    <section className="pa-card mt-6 flex flex-col items-center gap-4 p-8 text-center">
      <h2 className="m-0 text-xl font-extrabold text-marino">{facility.name}</h2>
      <p className="max-w-md text-base font-bold text-ink">{t("poster.scanCheckIn")}</p>
      <QrPlaceholder shortCode={code || "PISTA"} payload={`facility|${facility.id}|${slug}`} />
      <p className="text-sm text-graphite">
        {host}/c/{slug}
      </p>
      <button type="button" className="pa-btn-primary print:hidden" onClick={() => window.print()}>
        {t("staff.print")} A4
      </button>
    </section>
  );
}

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];

type HourSlot = {
  weekday: number;
  open: string;
  close: string;
  validFrom?: string | null;
  validTo?: string | null;
};

type SpecialPeriod = {
  key: string;
  validFrom: string;
  validTo: string;
  hours: HourSlot[];
};

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Client-side: open < close e sen solapes no mesmo día (por período). */
function findHoursOverlapError(hours: HourSlot[]): "invalid_range" | "hours_overlap" | null {
  for (const h of hours) {
    if (h.validFrom && h.validTo && h.validFrom > h.validTo) return "invalid_range";
  }
  const byGroup = new Map<string, HourSlot[]>();
  for (const h of hours) {
    if (timeToMinutes(h.open) >= timeToMinutes(h.close)) return "invalid_range";
    const key = `${h.validFrom ?? ""}|${h.validTo ?? ""}|${h.weekday}`;
    const list = byGroup.get(key) ?? [];
    list.push(h);
    byGroup.set(key, list);
  }
  for (const [, list] of byGroup) {
    const sorted = [...list].sort((a, b) => a.open.localeCompare(b.open));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const cur = sorted[i]!;
      if (timeToMinutes(cur.open) < timeToMinutes(prev.close)) return "hours_overlap";
    }
  }
  return null;
}

export function AdminSchedulesEditorPage({
  lockFacilityId,
  lockUnitId,
  focusSection,
}: {
  lockFacilityId?: string;
  lockUnitId?: string;
  focusSection?: "horarios" | "peches";
} = {}) {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const { t, i18n } = useTranslation();
  const [searchParams] = useSearchParams();
  const prefFacility = lockFacilityId || searchParams.get("facility") || "";
  const prefUnit = lockUnitId || searchParams.get("unit") || "";
  const focusPeches =
    focusSection === "peches" || searchParams.get("focus") === "peches";
  const [facilities, setFacilities] = useState<
    Array<{ id: string; name: string; units: Array<{ id: string; name: string }> }>
  >([]);
  const [unitId, setUnitId] = useState(prefUnit);
  const [facilityId, setFacilityId] = useState(prefFacility);
  const [hours, setHours] = useState<HourSlot[]>([]);
  const [closedDays, setClosedDays] = useState<Set<number>>(new Set([0, 6]));
  const [specialPeriods, setSpecialPeriods] = useState<SpecialPeriod[]>([]);
  const [specialFrom, setSpecialFrom] = useState("");
  const [specialTo, setSpecialTo] = useState("");
  const [peches, setPeches] = useState<
    Array<{
      id: string;
      facilityId?: string | null;
      startsAt: string;
      endsAt: string;
      reason: string;
    }>
  >([]);
  const [closeFrom, setCloseFrom] = useState("");
  const [closeTo, setCloseTo] = useState("");
  const [closeTimeFrom, setCloseTimeFrom] = useState("00:00");
  const [closeTimeTo, setCloseTimeTo] = useState("23:59");
  const [closeReason, setCloseReason] = useState("");
  const [editPecheId, setEditPecheId] = useState<string | null>(null);
  const [editPecheFrom, setEditPecheFrom] = useState("");
  const [editPecheTo, setEditPecheTo] = useState("");
  const [editPecheTimeFrom, setEditPecheTimeFrom] = useState("00:00");
  const [editPecheTimeTo, setEditPecheTimeTo] = useState("23:59");
  const [editPecheReason, setEditPecheReason] = useState("");
  const [closureImpact, setClosureImpact] = useState<{
    cancelledCount: number;
    peopleCount: number;
    matchCount: number;
  } | null>(null);
  /** create | edit | holidays — REVISION-57 J1 / H8 */
  const [closureImpactKind, setClosureImpactKind] = useState<
    "create" | "edit" | "holidays" | null
  >(null);
  const [holidayPending, setHolidayPending] = useState<
    Array<{ date: string; reason: string; startsAt: string; endsAt: string }>
  >([]);
  const [closureNotifyReason, setClosureNotifyReason] = useState("");
  /* REVISION-51 C3 */
  const [holidaysOpen, setHolidaysOpen] = useState(false);
  const [holidayPicked, setHolidayPicked] = useState<Set<string>>(() => new Set());
  const [closureBusy, setClosureBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadFacilities = useCallback(() => {
    void apiX.adminFacilities(slug).then((r) => {
      const active = r.data.filter((f) => f.active || f.id === lockFacilityId);
      setFacilities(
        active.map((f) => ({
          id: f.id,
          name: f.name,
          units: f.units,
        })),
      );
      if (prefUnit) {
        const fac = active.find((f) => f.units.some((u) => u.id === prefUnit));
        if (fac) {
          setFacilityId(fac.id);
          setUnitId(prefUnit);
          return;
        }
      }
      if (prefFacility) {
        const fac = active.find((f) => f.id === prefFacility);
        if (fac?.units[0]) {
          setFacilityId(fac.id);
          setUnitId(fac.units[0].id);
          return;
        }
      }
      const first = active[0];
      if (first?.units[0] && !unitId) {
        setFacilityId(first.id);
        setUnitId(first.units[0].id);
      }
    });
  }, [slug, unitId, prefFacility, prefUnit, lockFacilityId]);

  const applyHoursToAll = async () => {
    if (!facilityId || !unitId) return;
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await apiX.applyHorariosToAll(slug, { facilityId, sourceUnitId: unitId });
      setMsg(t("admin.applyHoursAllDone", { count: r.data.applied, n: r.data.applied }));
    } catch {
      setErr(t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  const reloadPeches = useCallback(() => {
    void apiX.peches(slug).then((r) => setPeches(r.data));
  }, [slug]);

  useEffect(() => {
    loadFacilities();
    reloadPeches();
  }, [loadFacilities, reloadPeches]);

  useEffect(() => {
    if (!unitId) return;
    void apiX.horarios(slug, unitId).then((r) => {
      if (r.data.length) {
        const weekly = r.data
          .filter((h) => !h.validFrom && !h.validTo)
          .map((h) => ({
            weekday: h.weekday,
            open: h.open,
            close: h.close,
          }));
        const byRange = new Map<string, SpecialPeriod>();
        for (const h of r.data) {
          if (!h.validFrom || !h.validTo) continue;
          const key = `${h.validFrom}|${h.validTo}`;
          const existing = byRange.get(key);
          const row: HourSlot = {
            weekday: h.weekday,
            open: h.open,
            close: h.close,
            validFrom: h.validFrom,
            validTo: h.validTo,
          };
          if (existing) existing.hours.push(row);
          else {
            byRange.set(key, {
              key,
              validFrom: h.validFrom,
              validTo: h.validTo,
              hours: [row],
            });
          }
        }
        setSpecialPeriods([...byRange.values()]);
        if (weekly.length) {
          setHours(weekly);
          const openDays = new Set(weekly.map((h) => h.weekday));
          setClosedDays(new Set(WEEKDAYS.filter((d) => !openDays.has(d))));
        } else {
          setHours(
            [1, 2, 3, 4, 5].flatMap((d) => [
              { weekday: d, open: "09:00", close: "13:00" },
              { weekday: d, open: "16:00", close: "21:00" },
            ]),
          );
          setClosedDays(new Set([0, 6]));
        }
      } else {
        setHours(
          [1, 2, 3, 4, 5].flatMap((d) => [
            { weekday: d, open: "09:00", close: "13:00" },
            { weekday: d, open: "16:00", close: "21:00" },
          ]),
        );
        setClosedDays(new Set([0, 6]));
        setSpecialPeriods([]);
      }
    });
  }, [slug, unitId]);

  const persistAllHours = async (weekly: HourSlot[], special: SpecialPeriod[]) => {
    if (!unitId) return;
    const weeklyRows = weekly
      .filter((h) => !closedDays.has(h.weekday))
      .map((h) => ({
        weekday: h.weekday,
        open: h.open,
        close: h.close,
        validFrom: null,
        validTo: null,
      }));
    const specialRows = special.flatMap((p) =>
      p.hours.map((h) => ({
        weekday: h.weekday,
        open: h.open,
        close: h.close,
        validFrom: p.validFrom,
        validTo: p.validTo,
      })),
    );
    const toSave = [...weeklyRows, ...specialRows];
    const overlap = findHoursOverlapError(toSave);
    if (overlap) {
      setErr(t("admin.hoursOverlap"));
      return;
    }
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      await apiX.putHorarios(slug, { unitId, facilityId, hours: toSave });
      setMsg(t("admin.saved"));
    } catch (ex) {
      const code = ex instanceof Error ? ex.message : "";
      setErr(
        code === "hours_overlap" || code === "invalid_range"
          ? t("admin.hoursOverlap")
          : t("common.error"),
      );
    } finally {
      setSaving(false);
    }
  };

  const saveHours = async (e: FormEvent) => {
    e.preventDefault();
    await persistAllHours(hours, specialPeriods);
  };

  const addSpecialPeriod = async () => {
    if (!specialFrom || !specialTo) return;
    if (specialFrom > specialTo) {
      setErr(t("admin.hoursOverlap"));
      return;
    }
    const key = `${specialFrom}|${specialTo}`;
    if (specialPeriods.some((p) => p.key === key)) {
      setErr(t("admin.specialHoursDuplicate"));
      return;
    }
    const template = hours.filter((h) => !closedDays.has(h.weekday));
    const seed =
      template.length > 0
        ? template.map((h) => ({
            weekday: h.weekday,
            open: h.open,
            close: h.close,
            validFrom: specialFrom,
            validTo: specialTo,
          }))
        : [{ weekday: 1, open: "09:00", close: "21:00", validFrom: specialFrom, validTo: specialTo }];
    const next = [
      ...specialPeriods,
      { key, validFrom: specialFrom, validTo: specialTo, hours: seed },
    ];
    setSpecialPeriods(next);
    setSpecialFrom("");
    setSpecialTo("");
    await persistAllHours(hours, next);
  };

  const removeSpecialPeriod = async (key: string) => {
    /* REVISION-58 W6: confirmación ao borrar período especial. */
    if (!window.confirm(t("admin.specialPeriodDeleteConfirm"))) return;
    const next = specialPeriods.filter((p) => p.key !== key);
    setSpecialPeriods(next);
    try {
      await persistAllHours(hours, next);
    } catch {
      setErr(t("common.error"));
    }
  };

  const updateSpecialTramo = (
    periodKey: string,
    weekday: number,
    indexInDay: number,
    patch: Partial<HourSlot>,
  ) => {
    setSpecialPeriods((prev) =>
      prev.map((p) => {
        if (p.key !== periodKey) return p;
        const dayRows = p.hours.filter((h) => h.weekday === weekday);
        const others = p.hours.filter((h) => h.weekday !== weekday);
        const nextDay = dayRows.map((h, i) =>
          i === indexInDay ? { ...h, ...patch } : h,
        );
        return { ...p, hours: [...others, ...nextDay] };
      }),
    );
  };

  const createClosure = async (
    opts: {
      confirm?: boolean;
      mode?: "cancel_notify" | "skip_booked_days";
      notifyReason?: string;
    } = {},
  ) => {
    if (!facilityId || !closeFrom) return;
    const endDay = closeTo && closeTo >= closeFrom ? closeTo : closeFrom;
    const startsAt = `${closeFrom}T${closeTimeFrom}`;
    const endsAt = `${endDay}T${closeTimeTo}`;
    setErr(null);
    setMsg(null);
    setClosureBusy(true);
    try {
      const r = await apiX.createPeche(slug, {
        facilityId,
        startsAt,
        endsAt,
        reason: closeReason || t("admin.closureDefault"),
        confirm: opts.confirm,
        mode: opts.mode,
        notifyReason: opts.notifyReason,
      });
      if (r.data.needsConfirm) {
        setClosureImpactKind("create");
        setClosureImpact({
          cancelledCount: r.data.cancelledCount ?? 0,
          peopleCount: r.data.peopleCount ?? 0,
          matchCount: r.data.matchCount ?? 0,
        });
        setClosureNotifyReason(closeReason || t("admin.closureDefault"));
        return;
      }
      setClosureImpact(null);
      setClosureImpactKind(null);
      setMsg(t("admin.saved"));
      setCloseFrom("");
      setCloseTo("");
      setCloseReason("");
      reloadPeches();
    } catch {
      setErr(t("common.error"));
    } finally {
      setClosureBusy(false);
    }
  };

  const deletePeche = async (id: string) => {
    /* REVISION-57 J1: confirmación antes de borrar. */
    if (!window.confirm(t("admin.closureDeleteConfirm"))) return;
    setErr(null);
    setMsg(null);
    try {
      await apiX.deletePeche(slug, id);
      setMsg(t("admin.saved"));
      if (editPecheId === id) setEditPecheId(null);
      reloadPeches();
    } catch {
      setErr(t("common.error"));
    }
  };

  const startEditPeche = (p: {
    id: string;
    startsAt: string;
    endsAt: string;
    reason: string;
  }) => {
    setEditPecheId(p.id);
    setEditPecheFrom(p.startsAt.slice(0, 10));
    setEditPecheTo(p.endsAt.slice(0, 10));
    setEditPecheTimeFrom(p.startsAt.length > 11 ? p.startsAt.slice(11, 16) : "00:00");
    setEditPecheTimeTo(p.endsAt.length > 11 ? p.endsAt.slice(11, 16) : "23:59");
    setEditPecheReason(p.reason);
  };

  const saveEditPeche = async (
    opts: {
      confirm?: boolean;
      mode?: "cancel_notify" | "skip_booked_days";
      notifyReason?: string;
    } = {},
  ) => {
    if (!editPecheId || !editPecheFrom) return;
    const endDay =
      editPecheTo && editPecheTo >= editPecheFrom ? editPecheTo : editPecheFrom;
    setErr(null);
    setMsg(null);
    setClosureBusy(true);
    try {
      const r = await apiX.updatePeche(slug, editPecheId, {
        startsAt: `${editPecheFrom}T${editPecheTimeFrom}`,
        endsAt: `${endDay}T${editPecheTimeTo}`,
        reason: editPecheReason || t("admin.closureDefault"),
        confirm: opts.confirm,
        mode: opts.mode,
        notifyReason: opts.notifyReason,
      });
      if (r.data.needsConfirm) {
        setClosureImpactKind("edit");
        setClosureImpact({
          cancelledCount: r.data.cancelledCount ?? 0,
          peopleCount: r.data.peopleCount ?? 0,
          matchCount: r.data.matchCount ?? 0,
        });
        setClosureNotifyReason(editPecheReason || t("admin.closureDefault"));
        return;
      }
      setClosureImpact(null);
      setClosureImpactKind(null);
      setEditPecheId(null);
      setMsg(t("admin.saved"));
      reloadPeches();
    } catch {
      setErr(t("common.error"));
    } finally {
      setClosureBusy(false);
    }
  };

  const createHolidaysConfirmed = async (opts: {
    confirm?: boolean;
    mode?: "cancel_notify" | "skip_booked_days";
    notifyReason?: string;
  }) => {
    const fid = facilityId || lockFacilityId || undefined;
    setClosureBusy(true);
    setErr(null);
    setMsg(null);
    let created = 0;
    try {
      for (const body of holidayPending) {
        const r = await apiX.createPeche(slug, {
          facilityId: fid,
          startsAt: body.startsAt,
          endsAt: body.endsAt,
          reason: body.reason,
          confirm: opts.confirm,
          mode: opts.mode,
          notifyReason: opts.notifyReason ?? body.reason,
        });
        if (r.data.id || r.data.ids?.length) created += 1;
      }
      setHolidayPending([]);
      setHolidayPicked(new Set());
      setHolidaysOpen(false);
      setClosureImpact(null);
      setClosureImpactKind(null);
      setMsg(t("admin.saved") + (created ? ` · ${created}` : ""));
      reloadPeches();
    } catch {
      setErr(t("common.error"));
    } finally {
      setClosureBusy(false);
    }
  };

  const confirmClosureImpact = (opts: {
    mode: "cancel_notify" | "skip_booked_days";
    notifyReason?: string;
  }) => {
    if (closureImpactKind === "edit") {
      void saveEditPeche({
        confirm: true,
        mode: opts.mode,
        notifyReason: opts.notifyReason,
      });
      return;
    }
    if (closureImpactKind === "holidays") {
      void createHolidaysConfirmed({
        confirm: true,
        mode: opts.mode,
        notifyReason: opts.notifyReason,
      });
      return;
    }
    void createClosure({
      confirm: true,
      mode: opts.mode,
      notifyReason: opts.notifyReason,
    });
  };

  const formatPecheLabel = (startsAt: string, endsAt: string) => {
    const d1 = startsAt.slice(0, 10);
    const d2 = endsAt.slice(0, 10);
    const t1 = startsAt.length > 11 ? startsAt.slice(11, 16) : "00:00";
    const t2 = endsAt.length > 11 ? endsAt.slice(11, 16) : "23:59";
    if (d1 === d2) return `${formatDate(d1, i18n.language)} · ${t1}–${t2}`;
    return `${formatDate(d1, i18n.language)} ${t1} → ${formatDate(d2, i18n.language)} ${t2}`;
  };

  const toggleClosed = (d: number, closed: boolean) => {
    setClosedDays((prev) => {
      const next = new Set(prev);
      if (closed) next.add(d);
      else next.delete(d);
      return next;
    });
    if (closed) {
      setHours((prev) => prev.filter((h) => h.weekday !== d));
    } else {
      setHours((prev) => {
        if (prev.some((h) => h.weekday === d)) return prev;
        return [...prev, { weekday: d, open: "09:00", close: "21:00" }];
      });
    }
  };

  const addTramo = (d: number) => {
    setHours((prev) => [...prev, { weekday: d, open: "16:00", close: "21:00" }]);
    setClosedDays((prev) => {
      const next = new Set(prev);
      next.delete(d);
      return next;
    });
  };

  const removeTramo = (d: number, indexInDay: number) => {
    setHours((prev) => {
      const dayRows = prev.filter((h) => h.weekday === d);
      const others = prev.filter((h) => h.weekday !== d);
      const nextDay = dayRows.filter((_, i) => i !== indexInDay);
      return [...others, ...nextDay];
    });
  };

  const updateTramo = (d: number, indexInDay: number, patch: Partial<HourSlot>) => {
    setHours((prev) => {
      const dayRows = prev.filter((h) => h.weekday === d);
      const others = prev.filter((h) => h.weekday !== d);
      const nextDay = dayRows.map((h, i) => (i === indexInDay ? { ...h, ...patch } : h));
      return [...others, ...nextDay];
    });
  };

  const unitChoices = lockFacilityId
    ? facilities.filter((f) => f.id === lockFacilityId)
    : facilities;
  const pechosFiltered = lockFacilityId
    ? peches.filter((p) => !p.facilityId || p.facilityId === lockFacilityId)
    : peches;

  return (
    <AdminShell active="horarios" pageTitle={t("admin.schedules")}>
      {!lockFacilityId ? (
        <p className="text-graphite">{t("admin.schedulesHintEdit")}</p>
      ) : null}

      <label className="mt-4 flex max-w-md flex-col gap-1 text-sm font-bold">
        {t("admin.unit")}
        <select
          className="pa-input"
          value={unitId}
          onChange={(e) => {
            const uid = e.target.value;
            setUnitId(uid);
            const fac = facilities.find((f) => f.units.some((u) => u.id === uid));
            if (fac) setFacilityId(fac.id);
          }}
        >
          {unitChoices.flatMap((f) =>
            f.units.map((u) => (
              <option key={u.id} value={u.id}>
                {lockFacilityId ? u.name : `${f.name} · ${u.name}`}
              </option>
            )),
          )}
        </select>
      </label>

      <form
        onSubmit={(e) => void saveHours(e)}
        className={`pa-card mt-6 max-w-2xl space-y-4 p-5 ${focusPeches ? "hidden" : ""}`}
      >
        <h2 className="font-bold">{t("admin.weeklyHours")}</h2>
        {WEEKDAYS.map((d) => {
          const closed = closedDays.has(d);
          const dayRows = hours
            .filter((h) => h.weekday === d)
            .sort((a, b) => a.open.localeCompare(b.open));
          return (
            <div key={d} className="border-b border-line pb-3 last:border-0">
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <span className="w-28 font-bold capitalize">{t(`dow.${d}`)}</span>
                <label className="flex items-center gap-2 text-sm font-bold">
                  <input
                    type="checkbox"
                    checked={closed}
                    onChange={(e) => toggleClosed(d, e.target.checked)}
                  />
                  {t("admin.closedDay")}
                </label>
              </div>
              {!closed && (
                <div className="space-y-2 pl-1">
                  {dayRows.map((row, i) => (
                    <div key={`${d}-${i}`} className="flex flex-wrap items-center gap-2 text-sm">
                      <TimeField
                        value={row.open}
                        onChange={(v) => updateTramo(d, i, { open: v })}
                        aria-label={t("onboard.open")}
                      />
                      <span>–</span>
                      <TimeField
                        value={row.close}
                        onChange={(v) => updateTramo(d, i, { close: v })}
                        aria-label={t("onboard.close")}
                      />
                      <button
                        type="button"
                        className="pa-btn-secondary px-2 text-sm"
                        aria-label={t("admin.delete")}
                        onClick={() => removeTramo(d, i)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="text-sm font-bold underline"
                    onClick={() => addTramo(d)}
                  >
                    + {t("admin.addSlot")}
                  </button>
                </div>
              )}
            </div>
          );
        })}
        <button type="submit" className="pa-btn-primary" disabled={saving}>
          {t("admin.save")}
        </button>
        {facilityId && unitId ? (
          <button
            type="button"
            className="pa-btn-secondary"
            disabled={saving}
            onClick={() => void applyHoursToAll()}
          >
            {t("admin.applyHoursAll")}
          </button>
        ) : null}
        <FieldError msg={err} />
      </form>

      <section
        className={`pa-card mt-8 max-w-2xl space-y-4 p-5 ${focusPeches ? "hidden" : ""}`}
      >
        <h2 className="font-bold">{t("admin.specialHours")}</h2>
        <p className="text-sm text-graphite">{t("admin.specialHoursHint")}</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm font-bold">
            {t("admin.validFrom")}
            <input
              type="date"
              className="pa-input"
              value={specialFrom}
              onChange={(e) => setSpecialFrom(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-bold">
            {t("admin.validTo")}
            <input
              type="date"
              className="pa-input"
              value={specialTo}
              onChange={(e) => setSpecialTo(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="pa-btn-secondary"
            disabled={saving || !specialFrom || !specialTo}
            onClick={() => void addSpecialPeriod()}
          >
            {t("admin.addSpecialHours")}
          </button>
        </div>
        {specialPeriods.length === 0 ? (
          <p className="text-sm text-graphite">{t("admin.specialHoursEmpty")}</p>
        ) : (
          <ul className="space-y-4">
            {specialPeriods.map((p) => (
              <li key={p.key} className="rounded-btn border border-line p-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold">
                    {formatDate(p.validFrom, i18n.language)} →{" "}
                    {formatDate(p.validTo, i18n.language)}
                  </span>
                  <button
                    type="button"
                    className="text-sm font-bold underline"
                    onClick={() => void removeSpecialPeriod(p.key)}
                  >
                    {t("admin.delete")}
                  </button>
                </div>
                <div className="space-y-2">
                  {WEEKDAYS.map((d) => {
                    const dayRows = p.hours
                      .filter((h) => h.weekday === d)
                      .sort((a, b) => a.open.localeCompare(b.open));
                    if (dayRows.length === 0) return null;
                    return (
                      <div key={`${p.key}-${d}`} className="text-sm">
                        <span className="mb-1 block w-28 font-bold capitalize">
                          {t(`dow.${d}`)}
                        </span>
                        {dayRows.map((row, i) => (
                          <div
                            key={`${p.key}-${d}-${i}`}
                            className="mb-1 flex flex-wrap items-center gap-2"
                          >
                            <TimeField
                              value={row.open}
                              onChange={(v) =>
                                updateSpecialTramo(p.key, d, i, { open: v })
                              }
                              aria-label={t("onboard.open")}
                            />
                            <span>–</span>
                            <TimeField
                              value={row.close}
                              onChange={(v) =>
                                updateSpecialTramo(p.key, d, i, { close: v })
                              }
                              aria-label={t("onboard.close")}
                            />
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className="pa-btn-secondary mt-3 text-sm"
                  disabled={saving}
                  onClick={() => void persistAllHours(hours, specialPeriods)}
                >
                  {t("admin.save")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        id="peches"
        className={`pa-card mt-8 max-w-xl space-y-3 p-5 ${!focusPeches && lockFacilityId ? "" : ""}`}
      >
        <h2 className="font-bold">{t("admin.newClosure")}</h2>
        <p className="text-sm text-graphite">{t("admin.closureDateRangeHint")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-bold">
            {t("admin.closureDateFrom")}
            <input
              type="date"
              className="pa-input"
              value={closeFrom}
              onChange={(e) => setCloseFrom(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-bold">
            {t("admin.closureDateTo")}
            <input
              type="date"
              className="pa-input"
              value={closeTo}
              min={closeFrom || undefined}
              onChange={(e) => setCloseTo(e.target.value)}
            />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-bold">
            {t("admin.closureTimeFrom")}
            <TimeField value={closeTimeFrom} onChange={setCloseTimeFrom} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-bold">
            {t("admin.closureTimeTo")}
            <TimeField value={closeTimeTo} onChange={setCloseTimeTo} />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm font-bold">
          {t("admin.closureReason")}
          <input
            className="pa-input"
            value={closeReason}
            onChange={(e) => setCloseReason(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="pa-btn-secondary self-start"
          disabled={closureBusy}
          onClick={() => void createClosure({})}
        >
          {t("admin.add")}
        </button>
        <button
          type="button"
          className="pa-btn-secondary self-start"
          disabled={closureBusy}
          aria-expanded={holidaysOpen}
          onClick={() => setHolidaysOpen((v) => !v)}
        >
          {t("admin.addHolidays")}
        </button>
        {holidaysOpen ? (
          <div className="rounded-[12px] border border-line bg-paper p-3">
            <p className="m-0 text-sm text-graphite">{t("admin.addHolidaysHint")}</p>
            <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto p-0">
              {GALICIA_HOLIDAYS_2026_2027.map((h) => {
                const label = i18n.language.startsWith("es") ? h.nameEs : h.nameGl;
                const on = holidayPicked.has(h.date);
                return (
                  <li key={h.date} className="list-none">
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => {
                          setHolidayPicked((prev) => {
                            const next = new Set(prev);
                            if (next.has(h.date)) next.delete(h.date);
                            else next.add(h.date);
                            return next;
                          });
                        }}
                      />
                      <span className="font-mono text-xs text-graphite">{h.date}</span>
                      <span className="font-bold text-marino">{label}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <button
              type="button"
              className="pa-btn-primary mt-3"
              disabled={closureBusy || holidayPicked.size === 0}
              onClick={() => {
                void (async () => {
                  /* REVISION-56 H8 / REVISION-57: impacto total unha soa vez, sen auto-confirm. */
                  const fid = facilityId || lockFacilityId || undefined;
                  setClosureBusy(true);
                  setErr(null);
                  setMsg(null);
                  let created = 0;
                  let totalBookings = 0;
                  let totalPeople = 0;
                  let totalMatches = 0;
                  const pending: Array<{
                    date: string;
                    reason: string;
                    startsAt: string;
                    endsAt: string;
                  }> = [];
                  try {
                    for (const h of GALICIA_HOLIDAYS_2026_2027) {
                      if (!holidayPicked.has(h.date)) continue;
                      const reason = i18n.language.startsWith("es")
                        ? h.nameEs
                        : h.nameGl;
                      const startsAt = `${h.date}T00:00`;
                      const endsAt = `${h.date}T23:59`;
                      const body = {
                        facilityId: fid,
                        startsAt,
                        endsAt,
                        reason,
                      };
                      const r = await apiX.createPeche(slug, body);
                      if (r.data.needsConfirm) {
                        pending.push({
                          date: h.date,
                          reason,
                          startsAt,
                          endsAt,
                        });
                        totalBookings += r.data.cancelledCount ?? 0;
                        totalPeople += r.data.peopleCount ?? 0;
                        totalMatches += r.data.matchCount ?? 0;
                      } else if (r.data.id || r.data.ids?.length) {
                        created += 1;
                      }
                    }
                    if (pending.length > 0) {
                      setHolidayPending(pending);
                      setClosureImpactKind("holidays");
                      setClosureImpact({
                        cancelledCount: totalBookings,
                        peopleCount: totalPeople,
                        matchCount: totalMatches,
                      });
                      setClosureNotifyReason(
                        pending.map((p) => p.reason).join("; "),
                      );
                      if (created > 0) reloadPeches();
                      return;
                    }
                    setHolidayPicked(new Set());
                    setHolidaysOpen(false);
                    setMsg(
                      t("admin.saved") +
                        (created ? ` · ${created}` : ""),
                    );
                    reloadPeches();
                  } catch {
                    setErr(t("common.error"));
                  } finally {
                    setClosureBusy(false);
                  }
                })();
              }}
            >
              {t("admin.holidaysCreate")}
            </button>
          </div>
        ) : null}
      </section>

      {closureImpact ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(0,43,74,0.4)] p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="closure-impact-title"
        >
          <div className="pa-card w-full max-w-lg space-y-4 p-6">
            <h2 id="closure-impact-title" className="m-0 text-xl font-extrabold text-marino">
              {t("admin.closureImpactTitle")}
            </h2>
            <p className="m-0 text-graphite">
              {formatClosureImpactBody(t, {
                bookings: closureImpact.cancelledCount,
                people: closureImpact.peopleCount,
                matches: closureImpact.matchCount,
              })}
            </p>
            <label className="flex flex-col gap-1 text-sm font-bold">
              {t("admin.closureNotifyReason")}
              <input
                className="pa-input"
                value={closureNotifyReason}
                onChange={(e) => setClosureNotifyReason(e.target.value)}
              />
            </label>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                className="pa-btn-primary"
                disabled={closureBusy}
                onClick={() =>
                  confirmClosureImpact({
                    mode: "cancel_notify",
                    notifyReason: closureNotifyReason,
                  })
                }
              >
                {t("admin.closureCancelNotify")}
              </button>
              <button
                type="button"
                className="pa-btn-secondary"
                disabled={closureBusy}
                onClick={() =>
                  confirmClosureImpact({
                    mode: "skip_booked_days",
                  })
                }
              >
                {t("admin.closureSkipBooked")}
              </button>
              <button
                type="button"
                className="pa-btn-secondary"
                disabled={closureBusy}
                onClick={() => {
                  setClosureImpact(null);
                  setClosureImpactKind(null);
                  setHolidayPending([]);
                }}
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <h2 className="mt-8 font-bold">{t("admin.closureList")}</h2>
      {pechosFiltered.length === 0 ? (
        <p className="mt-3 text-sm text-graphite">{t("admin.closureEmpty")}</p>
      ) : null}
      <ul className="mt-3 space-y-2">
        {pechosFiltered.map((p) => (
          <li key={p.id} className="pa-card space-y-3 px-4 py-3 text-sm">
            {editPecheId === p.id ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 font-bold">
                    {t("admin.closureDateFrom")}
                    <input
                      type="date"
                      className="pa-input"
                      value={editPecheFrom}
                      onChange={(e) => setEditPecheFrom(e.target.value)}
                    />
                  </label>
                  <label className="flex flex-col gap-1 font-bold">
                    {t("admin.closureDateTo")}
                    <input
                      type="date"
                      className="pa-input"
                      value={editPecheTo}
                      min={editPecheFrom || undefined}
                      onChange={(e) => setEditPecheTo(e.target.value)}
                    />
                  </label>
                  <label className="flex flex-col gap-1 font-bold">
                    {t("admin.closureTimeFrom")}
                    <TimeField value={editPecheTimeFrom} onChange={setEditPecheTimeFrom} />
                  </label>
                  <label className="flex flex-col gap-1 font-bold">
                    {t("admin.closureTimeTo")}
                    <TimeField value={editPecheTimeTo} onChange={setEditPecheTimeTo} />
                  </label>
                </div>
                <label className="flex flex-col gap-1 font-bold">
                  {t("admin.closureReason")}
                  <input
                    className="pa-input"
                    value={editPecheReason}
                    onChange={(e) => setEditPecheReason(e.target.value)}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="pa-btn-primary text-sm"
                    onClick={() => void saveEditPeche()}
                  >
                    {t("admin.save")}
                  </button>
                  <button
                    type="button"
                    className="pa-btn-secondary text-sm"
                    onClick={() => setEditPecheId(null)}
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              </>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {formatPecheLabel(p.startsAt, p.endsAt)} · {p.reason}
                </span>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="pa-btn-secondary text-sm"
                    onClick={() => startEditPeche(p)}
                  >
                    {t("admin.edit")}
                  </button>
                  <button
                    type="button"
                    className="pa-btn-secondary text-sm"
                    onClick={() => void deletePeche(p.id)}
                  >
                    {t("admin.delete")}
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {msg && <Toast>{msg}</Toast>}
    </AdminShell>
  );
}

function formatSolicitudePayload(
  type: string,
  payload: Record<string, unknown>,
  t: (key: string, opts?: Record<string, unknown>) => string,
  locale: string,
  unitName: (id: string) => string,
): string {
  if (type === "season") {
    const weekday = Number(payload.weekday ?? 0);
    const start = String(payload.start ?? "");
    const end = String(payload.end ?? "");
    const unitId = String(payload.unitId ?? payload.unit ?? "");
    const unit = unitId ? unitName(unitId) : "—";
    return `${t(`dow.${weekday}`)} · ${start}–${end} · ${unit}`;
  }
  if (type === "match" || type === "match_change") {
    const dateRaw = String(payload.date ?? "");
    const date = dateRaw ? formatDate(dateRaw, locale) : "—";
    const home = String(payload.homeTeam ?? "");
    const away = String(payload.awayTeam ?? "");
    const start = String(payload.start ?? "");
    const end = String(payload.end ?? "");
    const unitId = String(payload.unitId ?? "");
    const unit = unitId ? unitName(unitId) : "";
    const teams =
      home || away ? `${home} — ${away}` : type === "match_change" ? t("admin.reqMatchChange") : "";
    return [date, teams, `${start}–${end}`, unit].filter(Boolean).join(" · ");
  }
  return Object.entries(payload)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(" · ");
}

export function AdminSolicitudesPage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const { t, i18n } = useTranslation();
  const { municipality } = useSession();
  const tz = municipality?.settings?.timezone ?? "Europe/Madrid";
  const [rows, setRows] = useState<
    Array<{
      id: string;
      type: string;
      status: string;
      clubName: string;
      payload: Record<string, unknown>;
      note?: string | null;
      createdAt: string;
    }>
  >([]);
  const [pending, setPending] = useState(0);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [moveId, setMoveId] = useState<string | null>(null);
  const [moveWeekday, setMoveWeekday] = useState(2);
  const [moveDate, setMoveDate] = useState("");
  const [moveStart, setMoveStart] = useState("18:00");
  const [moveEnd, setMoveEnd] = useState("19:30");
  const [moveUnitId, setMoveUnitId] = useState("");
  const [units, setUnits] = useState<
    Array<{ id: string; name: string; facilityId: string }>
  >([]);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [listFilter, setListFilter] = useState<"pending" | "all">("pending");
  const [conflictsById, setConflictsById] = useState<
    Record<string, Array<{ kind: string; detail: string }>>
  >({});

  const load = useCallback(() => {
    /* REVISION-38 J4: incluir counter_proposed na vista «pendentes». */
    void apiX.solicitudes(slug, undefined).then(async (r) => {
      const visible =
        listFilter === "all"
          ? r.data
          : r.data.filter(
              (row) =>
                row.status === "pending" || row.status === "counter_proposed",
            );
      setRows(visible);
      setPending(r.pending);
      const next: Record<string, Array<{ kind: string; detail: string }>> = {};
      await Promise.all(
        visible
          .filter((row) => row.status === "pending")
          .map(async (row) => {
            try {
              const c = await apiX.solicitudeConflicts(slug, row.id);
              next[row.id] = c.data;
            } catch {
              next[row.id] = [];
            }
          }),
      );
      setConflictsById(next);
    });
  }, [slug, listFilter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    void api.facilities(slug).then(async (r) => {
      const all: Array<{ id: string; name: string; facilityId: string }> = [];
      for (const f of r.data) {
        try {
          const detail = await api.facility(slug, f.id);
          for (const u of detail.data.units) {
            all.push({
              id: u.id,
              name: `${f.name} · ${u.name}`,
              facilityId: f.id,
            });
          }
        } catch {
          /* skip */
        }
      }
      setUnits(all);
    });
  }, [slug]);

  const openMove = (r: (typeof rows)[number]) => {
    setRejectId(null);
    setMoveId(r.id);
    setMoveWeekday(Number(r.payload.weekday ?? 2));
    setMoveDate(String(r.payload.date ?? ""));
    setMoveStart(String(r.payload.start ?? "18:00"));
    setMoveEnd(String(r.payload.end ?? "19:30"));
    setMoveUnitId(String(r.payload.unitId ?? units[0]?.id ?? ""));
    setErr(null);
  };

  const facilityIdFor = (uid: string) =>
    units.find((u) => u.id === uid)?.facilityId ?? "";

  const submitMove = async (r: (typeof rows)[number]) => {
    setErr(null);
    setMsg(null);
    const facilityId =
      facilityIdFor(moveUnitId) || String(r.payload.facilityId ?? "");
    if (!moveUnitId || !facilityId) {
      setErr(t("common.error"));
      return;
    }
    try {
      await apiX.moveSolicitude(slug, r.id, {
        facilityId,
        unitId: moveUnitId,
        start: moveStart,
        end: moveEnd,
        ...(r.type === "season"
          ? { weekday: moveWeekday }
          : { date: moveDate }),
      });
      setMoveId(null);
      setMsg(t("admin.counterMoved"));
      load();
    } catch (ex) {
      const code = ex instanceof Error ? ex.message : "";
      const payload = (
        ex as Error & {
          payload?: { conflicts?: Array<{ detail?: string }> };
        }
      )?.payload;
      if (code === "conflict") {
        const details = (payload?.conflicts ?? [])
          .map((c) => c.detail)
          .filter(Boolean);
        setErr(
          details.length
            ? `${t("admin.approveConflict").replace(/\.\s*$/, "")}: ${details.join("; ")}`
            : t("admin.approveConflict"),
        );
      } else {
        setErr(t("common.error"));
      }
    }
  };

  const approve = async (id: string) => {
    setErr(null);
    setMsg(null);
    try {
      await apiX.approveSolicitude(slug, id);
      setMsg(t("admin.approved"));
      load();
    } catch (ex) {
      const code = ex instanceof Error ? ex.message : "";
      const payload = (
        ex as Error & {
          payload?: { conflicts?: Array<{ detail?: string }> };
        }
      )?.payload;
      if (code === "conflict" || code === "duplicate") {
        const details = (payload?.conflicts ?? [])
          .map((c) => c.detail)
          .filter(Boolean);
        setErr(
          details.length
            ? `${t("admin.approveConflict").replace(/\.\s*$/, "")}: ${details.join("; ")}`
            : t("admin.approveConflict"),
        );
        try {
          const c = await apiX.solicitudeConflicts(slug, id);
          setConflictsById((prev) => ({ ...prev, [id]: c.data }));
        } catch {
          /* ignore */
        }
      } else {
        setErr(t("common.error"));
      }
    }
  };

  const unitName = (id: string) => units.find((u) => u.id === id)?.name ?? id;

  const filteredReqs = useMemo(
    () =>
      filterByQuery(rows, q, (r) => [
        r.clubName,
        r.type,
        r.status,
        r.createdAt,
        formatSolicitudePayload(r.type, r.payload, t, i18n.language, unitName),
      ]),
    [rows, q, t, i18n.language, units],
  );

  const dowFull = [
    t("dow.0"),
    t("dow.1"),
    t("dow.2"),
    t("dow.3"),
    t("dow.4"),
    t("dow.5"),
    t("dow.6"),
  ];

  return (
    <AdminShell active="solicitudes" pageTitle={t("admin.requests")}>
      <p className="text-sm text-graphite">
        {t("admin.requestsHint")}{" "}
        {(() => {
          /* REVISION-39 L7: contar pendentes + agardando ao club. */
          const waiting = rows.filter((r) => r.status === "counter_proposed").length;
          const openPending = rows.filter((r) => r.status === "pending").length;
          if (listFilter === "pending") {
            if (openPending === 0 && waiting === 0) {
              return <span className="font-bold">{t("clubs.pendingNone")}</span>;
            }
            if (openPending === 0 && waiting > 0) {
              return (
                <span className="font-bold">
                  {waiting === 1
                    ? t("admin.waitingClubCountOne")
                    : t("admin.waitingClubCount", { count: waiting })}
                </span>
              );
            }
            if (waiting > 0) {
              return (
                <span className="font-bold">
                  {openPending === 1
                    ? t("admin.pendingCountOne")
                    : t("admin.pendingCount", { count: openPending })}
                  {" · "}
                  {waiting === 1
                    ? t("admin.waitingClubCountOne")
                    : t("admin.waitingClubCount", { count: waiting })}
                </span>
              );
            }
          }
          if (pending > 0) {
            return (
              <span className="font-bold">
                {pending === 1
                  ? t("admin.pendingCountOne")
                  : t("admin.pendingCount", { count: pending })}
              </span>
            );
          }
          return <span className="font-bold">{t("clubs.pendingNone")}</span>;
        })()}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className={`min-h-10 rounded-full px-4 text-sm font-extrabold ${
            listFilter === "pending"
              ? "bg-marino text-on-dark"
              : "border border-line bg-surface text-marino"
          }`}
          onClick={() => setListFilter("pending")}
        >
          {t("admin.filterPending")}
        </button>
        <button
          type="button"
          className={`min-h-10 rounded-full px-4 text-sm font-extrabold ${
            listFilter === "all"
              ? "bg-marino text-on-dark"
              : "border border-line bg-surface text-marino"
          }`}
          onClick={() => setListFilter("all")}
        >
          {t("admin.filterAll")}
        </button>
      </div>
      <ListSearch
        value={q}
        onChange={setQ}
        placeholder={t("admin.search")}
        count={rows.length}
      />
      {rows.length === 0 && (
        <div className="mt-6">
          <EmptyState
            title={t("admin.requestsEmpty")}
            body={t("admin.requestsEmptyHint")}
          />
        </div>
      )}
      <ul className="mt-6 space-y-3">
        {filteredReqs.map((r) => {
          const conflicts = conflictsById[r.id] ?? [];
          const isPending = r.status === "pending";
          const waitingClub = r.status === "counter_proposed";
          return (
            <li key={r.id} className="pa-card p-4">
              <p className="font-bold">
                {r.clubName} ·{" "}
                {r.type === "season"
                  ? t("admin.reqSeason")
                  : r.type === "match_change"
                    ? t("admin.reqMatchChange")
                    : t("admin.reqMatch")}
                {waitingClub ? (
                  <span className="ml-2 inline-flex items-center rounded-full bg-aviso-bg px-2.5 py-0.5 text-[13px] font-extrabold text-aviso-ink">
                    {t("admin.waitingClub")}
                  </span>
                ) : !isPending ? (
                  <span className="ml-2 text-sm font-semibold text-graphite">
                    {" "}
                    ({t("admin.statusApproved")})
                  </span>
                ) : null}
              </p>
              <p className="mt-1 text-sm text-graphite">
                {waitingClub &&
                r.payload.original &&
                typeof r.payload.original === "object"
                  ? t("admin.counterCompare", {
                      asked: formatSolicitudePayload(
                        r.type,
                        r.payload.original as Record<string, unknown>,
                        t,
                        i18n.language,
                        unitName,
                      ),
                      proposed: formatSolicitudePayload(
                        r.type,
                        r.payload,
                        t,
                        i18n.language,
                        unitName,
                      ),
                    })
                  : formatSolicitudePayload(
                      r.type,
                      r.payload,
                      t,
                      i18n.language,
                      unitName,
                    )}
                {r.note ? ` — ${r.note}` : ""}
              </p>
              <p className="text-xs text-graphite">
                {formatSentAt(r.createdAt, i18n.language, tz)}
              </p>
              {conflicts.length > 0 && (
                <div className="pa-warn-banner mt-3 text-sm" role="alert">
                  <span aria-hidden>⚠</span>
                  <span>
                    {t("admin.reqConflict")}:{" "}
                    {conflicts.map((c) => c.detail).join("; ")}
                  </span>
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {isPending && (
                  <>
                    <button
                      type="button"
                      className="pa-btn-primary text-sm"
                      onClick={() => void approve(r.id)}
                    >
                      {t("admin.approve")}
                    </button>
                    <button
                      type="button"
                      className="pa-btn-secondary text-sm"
                      onClick={() => {
                        setMoveId(null);
                        setRejectId(r.id);
                      }}
                    >
                      {t("admin.reject")}
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="pa-btn-secondary text-sm"
                  onClick={() => openMove(r)}
                >
                  {t("admin.move")}
                </button>
              </div>
              {rejectId === r.id && (
                <div className="mt-3 flex flex-col gap-2">
                  <input
                    className="pa-input"
                    placeholder={t("admin.rejectReason")}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <button
                    type="button"
                    className="pa-btn-primary self-start text-sm"
                    disabled={reason.trim().length < 2}
                    onClick={() =>
                      void apiX
                        .rejectSolicitude(slug, r.id, reason)
                        .then(() => {
                          setRejectId(null);
                          setReason("");
                          setMsg(t("admin.rejected"));
                          load();
                        })
                        .catch(() => setMsg(t("common.error")))
                    }
                  >
                    {t("admin.confirmReject")}
                  </button>
                </div>
              )}
              {moveId === r.id && (
                <form
                  className="mt-3 flex max-w-md flex-col gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submitMove(r);
                  }}
                >
                  <p className="text-sm font-bold">{t("admin.moveHint")}</p>
                  {r.type === "season" ? (
                    <label className="flex flex-col gap-1 text-sm font-bold">
                      {t("clubs.weekday")}
                      <select
                        className="pa-input"
                        value={moveWeekday}
                        onChange={(e) => setMoveWeekday(Number(e.target.value))}
                      >
                        {dowFull.map((d, i) => (
                          <option key={d} value={i}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <DateField
                      label={t("clubs.matchDate")}
                      value={moveDate}
                      onChange={setMoveDate}
                      required
                      locale={i18n.language}
                    />
                  )}
                  <label className="flex flex-col gap-1 text-sm font-bold">
                    {t("clubs.start")}
                    <input
                      className="pa-input"
                      required
                      value={moveStart}
                      onChange={(e) => setMoveStart(e.target.value)}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm font-bold">
                    {t("clubs.end")}
                    <input
                      className="pa-input"
                      required
                      value={moveEnd}
                      onChange={(e) => setMoveEnd(e.target.value)}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm font-bold">
                    {t("clubs.unit")}
                    <select
                      className="pa-input"
                      required
                      value={moveUnitId}
                      onChange={(e) => setMoveUnitId(e.target.value)}
                    >
                      {units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button type="submit" className="pa-btn-primary text-sm">
                      {t("admin.confirmMove")}
                    </button>
                    <button
                      type="button"
                      className="pa-btn-secondary text-sm"
                      onClick={() => setMoveId(null)}
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                </form>
              )}
            </li>
          );
        })}
      </ul>
      {msg && <Toast>{msg}</Toast>}
      <FieldError msg={err} />
    </AdminShell>
  );
}

export function AdminActivitiesEditorPage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const { t, i18n } = useTranslation();
  const [list, setList] = useState<
    Array<{
      id: string;
      name: string;
      method: string;
      lotteryStatus: string;
      places: number;
      deadline: string;
      days: string;
      hours: string;
    }>
  >([]);
  const [facilities, setFacilities] = useState<Array<{ id: string; name: string }>>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [facilityId, setFacilityId] = useState("");
  const [days, setDays] = useState("Luns e mércores");
  const [hours, setHours] = useState("17:00–18:00");
  const [places, setPlaces] = useState(12);
  const [ageMin, setAgeMin] = useState(6);
  const [ageMax, setAgeMax] = useState(12);
  const [method, setMethod] = useState<"first_come" | "lottery">("lottery");
  const [deadline, setDeadline] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [q, setQ] = useState("");

  const load = useCallback(() => {
    void apiX.adminActivities(slug).then((r) => setList(r.data));
    void apiX.adminFacilities(slug).then((r) => {
      const active = r.data.filter((f) => f.active);
      setFacilities(active.map((f) => ({ id: f.id, name: f.name })));
      if (!facilityId && active[0]) setFacilityId(active[0].id);
    });
  }, [slug, facilityId]);

  useEffect(() => {
    load();
    if (!deadline) {
      const d = new Date();
      d.setDate(d.getDate() + 14);
      setDeadline(d.toISOString().slice(0, 10));
    }
  }, [load, deadline]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSaved(false);
    if (!name.trim() || !facilityId || !deadline) {
      setErr(t("admin.fieldRequired"));
      return;
    }
    setSaving(true);
    try {
      await apiX.createActivity(slug, {
        name: name.trim(),
        description: description.trim() || undefined,
        facilityId,
        days,
        hours,
        places,
        ageMin,
        ageMax,
        method,
        deadline,
      });
      setName("");
      setDescription("");
      setSaved(true);
      setShowCreate(false);
      load();
    } catch {
      setErr(t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  const filteredActs = useMemo(
    () => filterByQuery(list, q, (a) => [a.name, a.method, a.lotteryStatus, a.deadline]),
    [list, q],
  );

  return (
    <AdminShell active="actividades" pageTitle={t("nav.actividades")}>
      <p className="text-sm text-graphite">{t("admin.activitiesHint")}</p>
      <p className="mt-2 text-sm">
        <Link
          to={`/c/${slug}/admin/partidos-abertos`}
          className="font-bold text-azul-700 underline"
        >
          {t("openMatch.adminTitle")} →
        </Link>
      </p>

      <ListSearch
        value={q}
        onChange={setQ}
        placeholder={t("admin.search")}
        count={list.length}
      />

      {list.length === 0 ? (
        <div className="mt-6">
          <EmptyState title={t("admin.activitiesEmpty")} body={t("admin.activitiesEmptyHint")} />
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {filteredActs.map((a) => (
            <li key={a.id} className="pa-card flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="m-0 flex flex-wrap items-center gap-2 font-bold">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-extrabold ${
                      a.lotteryStatus === "open"
                        ? "bg-libre-bg text-libre"
                        : "bg-ocupada-bg text-ocupada"
                    }`}
                  >
                    {t(`status.${a.lotteryStatus}`, { defaultValue: a.lotteryStatus })}
                  </span>
                  <span>{a.name}</span>
                </p>
                <p className="mt-1 text-sm text-graphite">
                  {t(`status.${a.method}`, { defaultValue: a.method })} · {a.places}{" "}
                  {t("activities.places")} · {formatDate(a.deadline, i18n.language)}
                </p>
              </div>
              <Link
                to={`/c/${slug}/admin/actividades/${a.id}`}
                className="pa-btn-primary text-sm"
              >
                {t("admin.manageActivity")}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-8">
        <button
          type="button"
          className="pa-btn-secondary"
          aria-expanded={showCreate}
          onClick={() => setShowCreate((v) => !v)}
        >
          {showCreate ? "×" : "+"} {t("admin.addActivity")}
        </button>
      </div>

      {showCreate && (
      <form onSubmit={(e) => void create(e)} className="pa-card mt-4 flex max-w-xl flex-col gap-3 p-5" noValidate>
        <h2 className="font-bold">{t("admin.addActivity")}</h2>
        <label className="flex flex-col gap-1 text-sm font-bold">
          {t("admin.activityName")} *
          <input className="pa-input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-bold">
          {t("admin.activityDesc")}{" "}
          <span className="font-normal text-graphite">({t("admin.activityDescOptional")})</span>
          <textarea
            className="pa-input min-h-20"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-bold">
          {t("admin.facilities")} *
          <select
            className="pa-input"
            value={facilityId}
            onChange={(e) => setFacilityId(e.target.value)}
          >
            <option value="">{t("admin.pickFacility")}</option>
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-bold">
            {t("admin.activityDays")}
            <input className="pa-input" value={days} onChange={(e) => setDays(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-bold">
            {t("admin.activityHours")}
            <input className="pa-input" value={hours} onChange={(e) => setHours(e.target.value)} />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm font-bold">
            {t("activities.places")}
            <input
              type="number"
              className="pa-input"
              min={1}
              value={places}
              onChange={(e) => setPlaces(Number(e.target.value))}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-bold">
            {t("admin.ageMin")}
            <input
              type="number"
              className="pa-input"
              value={ageMin}
              onChange={(e) => setAgeMin(Number(e.target.value))}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-bold">
            {t("admin.ageMax")}
            <input
              type="number"
              className="pa-input"
              value={ageMax}
              onChange={(e) => setAgeMax(Number(e.target.value))}
            />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm font-bold">
          {t("admin.activityMethod")}
          <select
            className="pa-input"
            value={method}
            onChange={(e) => setMethod(e.target.value as "first_come" | "lottery")}
          >
            <option value="lottery">{t("admin.lottery")}</option>
            <option value="first_come">{t("admin.firstCome")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-bold">
          {t("admin.activityDeadline")} *
          <input
            type="date"
            className="pa-input"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
          />
        </label>
        <button type="submit" className="pa-btn-primary self-start" disabled={saving}>
          {t("admin.add")}
        </button>
        {saved && <Toast>{t("admin.saved")}</Toast>}
        <FieldError msg={err} />
      </form>
      )}
    </AdminShell>
  );
}

export function AdminActivityDetailPage() {
  const { slug: slugParam, id = "" } = useParams();
  const slug = slugParam!;
  const { t } = useTranslation();
  const [act, setAct] = useState<Awaited<ReturnType<typeof apiX.adminActivity>>["data"] | null>(
    null,
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void apiX
      .adminActivity(slug, id)
      .then((r) => setAct(r.data))
      .catch(() => setErr(t("common.error")));
  }, [slug, id, t]);

  useEffect(() => {
    load();
  }, [load]);

  const draw = async () => {
    /* REVISION-57 W15: confirmación irreversible. */
    const apps = act?.applications?.length ?? 0;
    const places = act?.places ?? 0;
    if (
      !window.confirm(
        formatDrawConfirmBody(t, { applications: apps, places }),
      )
    ) {
      return;
    }
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await apiX.adminDrawLottery(slug, id);
      setMsg(
        t("activities.drawn", {
          count: r.data.accepted.length,
          accepted: r.data.accepted.length,
          waitlist: r.data.waitlist.length,
        }),
      );
      load();
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      const key = code ? `error.${code}` : "";
      const translated = key ? t(key) : "";
      setErr(translated && translated !== key ? translated : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  if (!act && !err) {
    return (
      <AdminShell active="actividades" pageTitle={t("nav.actividades")}>
        <p className="text-graphite">{t("common.loading")}</p>
      </AdminShell>
    );
  }

  if (!act) {
    return (
      <AdminShell active="actividades" pageTitle={t("nav.actividades")}>
        <FieldError msg={err} />
      </AdminShell>
    );
  }

  return (
    <AdminShell active="actividades" pageTitle={act.name}>
      <p className="mb-4">
        <BackLink to={`/c/${slug}/admin/actividades`}>{t("nav.actividades")}</BackLink>
      </p>
      <p className="text-graphite">{act.description}</p>
      <p className="mt-2 text-sm text-graphite">
        {act.days} · {act.hours} · {act.ageMin}–{act.ageMax} ·{" "}
        {t(`status.${act.method}`, { defaultValue: act.method })} ·{" "}
        {t(`status.${act.lotteryStatus}`, { defaultValue: act.lotteryStatus })}
      </p>
      {act.lotterySeedHash && (
        <p className="mt-2 font-mono text-xs text-graphite">
          SHA-256: {act.lotterySeedHash.slice(0, 12)}…{act.lotterySeedHash.slice(-8)}
        </p>
      )}

      {act.method === "lottery" && act.lotteryStatus !== "drawn" && (
        <button
          type="button"
          className="pa-btn-primary mt-6"
          disabled={busy}
          onClick={() => void draw()}
        >
          {t("activities.runDraw")}
        </button>
      )}

      {act.lotteryStatus === "drawn" && act.lotterySecret && (
        <div className="pa-ok-banner mt-6" role="status">
          <span aria-hidden>✓</span>
          <span>
            {t("activities.step2")}: <code className="break-all">{act.lotterySecret}</code>
          </span>
        </div>
      )}

      {msg && <Toast>{msg}</Toast>}
      <FieldError msg={err} />

      <h2 className="pa-h2 mt-8">{t("admin.applicants")}</h2>
      <ul className="mt-3 space-y-2">
        {act.applications.map((a) => {
          const raw = (a.displayName ?? "").trim();
          const looksId = !raw || /^(u-|otp-|user-)/i.test(raw) || !/\s/.test(raw);
          const name = looksId ? t("admin.personNoName") : raw;
          return (
            <li key={a.id} className="pa-card px-4 py-3 text-sm">
              <strong>{a.applicationNumber}</strong> · {name}
              {a.email && !looksId ? ` · ${a.email}` : ""} ·{" "}
              {t(`status.${a.status}`, { defaultValue: a.status })} ·{" "}
              {t(`status.${a.priorityGroup}`, { defaultValue: a.priorityGroup })}
            </li>
          );
        })}
        {act.applications.length === 0 && (
          <li className="text-sm text-graphite">{t("admin.applicantsEmpty")}</li>
        )}
      </ul>
      <p className="mt-4">
        <Link to={`/c/${slug}/actividades/${act.id}`} className="text-sm font-bold underline">
          {t("admin.viewPublic")}
        </Link>
      </p>
    </AdminShell>
  );
}

type CsvPreviewRow = {
  line: number;
  date: string;
  start: string;
  end: string;
  home: string;
  away: string;
  club: string;
  category: string;
  unit: string;
  errors: string[];
  conflicts: string[];
  ok: boolean;
};

type CsvPreview = {
  rows: CsvPreviewRow[];
  okCount: number;
  errorCount: number;
  conflictCount: number;
  categoryMinutes: Record<string, number>;
  sampleHeaders: string[];
};

const SAMPLE_CSV = `date,start,home,away,club,category,unit
2026-11-08,18:00,CD Exemplo Senior,Visitante Demo,Club Deportivo Exemplo,senior,Pista completa
2026-11-08,19:30,CV Senior A,Rival,CV Ría de Exemplo,senior,Media pista A`;

export function AdminMatchImportPage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const { t, i18n } = useTranslation();
  const [csv, setCsv] = useState(SAMPLE_CSV);
  const [seniorMin, setSeniorMin] = useState(90);
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const categoryMinutes = { senior: seniorMin };

  const runPreview = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await apiX.previewMatchCsv(slug, { csv, categoryMinutes });
      setPreview(r.data);
    } catch {
      setErr(t("admin.csvPreviewError"));
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const runConfirm = async () => {
    if (!preview || preview.okCount === 0) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await apiX.confirmMatchCsv(slug, { csv, categoryMinutes });
      setMsg(
        t("admin.csvImported", {
          count: r.data.inserted,
          conflicts: r.data.conflicts,
        }),
      );
      setPreview(null);
    } catch {
      setErr(t("admin.csvImportError"));
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    setCsv(text);
    setPreview(null);
  };

  const errLabel = (code: string) => renderMatchCsvErrorLabel(t, code);

  return (
    <AdminShell active="importar-partidos" pageTitle={t("admin.csvImport")}>
      <p className="text-sm text-graphite">{t("admin.csvImportHint")}</p>

      <div className="mt-6 flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1 text-sm font-bold">
          {t("admin.csvFile")}
          <FilePickButton
            accept=".csv,text/csv"
            labelKey="file.chooseCsv"
            onFile={(f) => void onFile(f)}
          />
        </div>
        <label className="flex flex-col gap-1 text-sm font-bold">
          {t("admin.csvSeniorMinutes")}
          <input
            type="number"
            min={30}
            max={180}
            step={15}
            className="pa-input w-28"
            value={seniorMin}
            onChange={(e) => setSeniorMin(Number(e.target.value) || 90)}
          />
        </label>
      </div>

      <label className="mt-4 flex flex-col gap-1 text-sm font-bold">
        {t("admin.csvContent")}
        <textarea
          className="pa-input min-h-40 font-mono text-xs"
          value={csv}
          onChange={(e) => {
            setCsv(e.target.value);
            setPreview(null);
          }}
          spellCheck={false}
        />
      </label>
      <p className="mt-1 text-xs text-graphite">
        {t("admin.csvHeaders")}: date, start, home, away, club, category, unit
      </p>

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          className="pa-btn-secondary"
          disabled={busy || !csv.trim()}
          onClick={() => void runPreview()}
        >
          {t("admin.csvPreview")}
        </button>
        <button
          type="button"
          className="pa-btn-primary"
          disabled={busy || !preview || preview.okCount === 0}
          onClick={() => void runConfirm()}
        >
          {t("admin.csvConfirm")}
        </button>
        <Link to={`/c/${slug}/admin/pavillon`} className="pa-btn-secondary">
          {t("nav.pavillon")}
        </Link>
      </div>

      {msg && <Toast>{msg}</Toast>}
      <FieldError msg={err} />

      {preview && (
        <section className="mt-8">
          <p className="text-sm text-graphite">
            {t("admin.csvSummary", {
              count: preview.okCount,
              ok: preview.okCount,
              errors: preview.errorCount,
              conflicts: preview.conflictCount,
            })}
          </p>
          <ul className="mt-3 max-h-96 space-y-2 overflow-auto">
            {preview.rows.map((r) => (
              <li
                key={r.line}
                className={`pa-card px-4 py-3 text-sm ${
                  !r.ok ? "border-[var(--pa-warn,#c4a35a)]" : r.conflicts.length ? "border-marino" : ""
                }`}
              >
                <strong>L{r.line}</strong> · {formatDate(r.date, i18n.language)} {r.start}–
                {r.end} · {r.home} vs {r.away} · {r.club}
                {r.errors.length > 0 && (
                  <span className="mt-1 block text-[var(--pa-warn-text,#8a5a00)]">
                    {r.errors.map(errLabel).join(" · ")}
                  </span>
                )}
                {r.conflicts.length > 0 && (
                  <span className="mt-1 block text-graphite">
                    {t("admin.csvConflict")}: {r.conflicts.join(", ")}
                  </span>
                )}
                {r.ok && r.conflicts.length === 0 && (
                  <span className="mt-1 block font-bold text-ink">OK</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </AdminShell>
  );
}
