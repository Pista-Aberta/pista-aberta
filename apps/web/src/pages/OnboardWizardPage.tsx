import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ReadingPrefsAaControl } from "../components/ReadingPrefsAaControl";
import { TimeField } from "../components/TimeField";
import { apiX } from "../lib/api-complete";
import { ListSearch, filterByQuery } from "../components/ListSearch";
import { FacilityTypeIcon } from "../components/icons";
import { detectShieldBrandColor } from "../lib/shield-color";
import { fetchPublicConfig } from "../lib/public-config";
import { singleMuniSyncHint } from "../lib/single-muni";
import { randomDemoNif } from "../lib/demo-nif";
import { mapApiError } from "../lib/api-error";
import {
  loadOnboardDraft,
  removeOnboardDraft,
  saveOnboardDraft,
} from "../lib/onboard-draft-storage";
import {
  censusCountFromName,
  censusKindLabel,
  friendlyFacilityLabel,
  shortMunicipalityName,
} from "../lib/facility-label";

const STEPS = 4;

type OsmFacility = { name: string; type: string };
type ConcelloRow = {
  ine: string;
  name: string;
  province: string;
  slug: string;
  email?: string | null;
  web?: string | null;
  facilityCount: number;
  facilities: OsmFacility[];
  proposedAddress: string;
  shieldInitial: string;
};

type ScheduleDefaults = Record<string, { open: string; close: string }>;

const DEFAULT_SCHEDULE: ScheduleDefaults = {
  pista: { open: "09:00", close: "22:00" },
  pavillon: { open: "08:00", close: "23:00" },
  campo: { open: "09:00", close: "21:00" },
  sala: { open: "10:00", close: "21:00" },
  piscina: { open: "07:00", close: "22:00" },
  futbol: { open: "09:00", close: "21:00" },
  atletismo: { open: "08:00", close: "21:00" },
  default: { open: "09:00", close: "22:00" },
};

type Draft = {
  step: number;
  selectedIne: string | null;
  marked: string[];
  /** REVISION-30 Z4 — nomes editables (clave = nome censo). */
  facilityNames: Record<string, string>;
  schedule: ScheduleDefaults;
  norms: string[];
  adminName: string;
  adminEmail: string;
  adminNif: string;
  /** REVISION-32 C2 — correo xeral do concello → settings.legal.email */
  legalEmail: string;
  brandColor: string;
};

function emptyDraft(): Draft {
  return {
    step: 1,
    selectedIne: null,
    marked: [],
    facilityNames: {},
    schedule: { ...DEFAULT_SCHEDULE },
    norms: ["rule1", "rule2", "rule3"],
    adminName: "",
    adminEmail: "",
    adminNif: "",
    legalEmail: "",
    brandColor: "#5A4636",
  };
}

function loadDraft(): Draft {
  return loadOnboardDraft(emptyDraft);
}

function mapOsmType(t: string): string {
  const k = t.toLowerCase();
  if (k.includes("pavill") || k.includes("pabell")) return "pavillon";
  if (k.includes("pisc")) return "piscina";
  if (k.includes("futbol") || k.includes("fútbol") || k.includes("campo")) return "campo";
  if (k.includes("sala")) return "sala";
  if (k.includes("atlet")) return "atletismo";
  return "pista";
}

/** REVISION-29 Y8 — sen piscinas no alcance. */
function isOutOfScopeFacility(f: OsmFacility): boolean {
  return f.type === "piscina" || /piscina/i.test(f.name);
}

export function OnboardWizardPage() {
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const [lista, setLista] = useState<ConcelloRow[]>([]);
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<Draft>(() => loadDraft());
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [created, setCreated] = useState<{
    slug: string;
    name: string;
    invite?: { token: string; url: string };
    brandColor?: string;
  } | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [slugConflict, setSlugConflict] = useState<{ slug: string; name: string } | null>(
    null,
  );

  const [nifExists, setNifExists] = useState(false);

  useEffect(() => {
    void fetchPublicConfig().then((c) => {
      setDemoMode(!!c.demo);
      if (c.demo) {
        setDraft((d) => {
          if (d.adminNif.trim()) return d;
          const next = { ...d, adminNif: randomDemoNif() };
          try {
            saveOnboardDraft(next);
          } catch {
            /* ignore */
          }
          return next;
        });
      }
    });
  }, []);

  useEffect(() => {
    void fetch("/data/concellos-lista.json")
      .then((r) => r.json())
      .then((rows: ConcelloRow[]) => setLista(rows))
      .catch(() => setError(t("common.error")));
  }, [t]);

  const selected = useMemo(
    () => lista.find((c) => c.ine === draft.selectedIne) ?? null,
    [lista, draft.selectedIne],
  );

  const filtered = useMemo(
    () =>
      filterByQuery(lista, q, (c) => [c.name, c.province, c.slug, c.ine]),
    [lista, q],
  );

  const step = draft.step;
  const setStep = (n: number) => setDraft((d) => ({ ...d, step: n }));
  const next = () => setStep(Math.min(STEPS, step + 1));
  const back = () => setStep(Math.max(1, step - 1));

  const saveDraft = () => {
    try {
      saveOnboardDraft(draft);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2000);
    } catch {
      setError(t("common.error"));
    }
  };

  const persist = (patch: Partial<Draft>) => {
    setDraft((d) => {
      const nextDraft = { ...d, ...patch };
      try {
        saveOnboardDraft(nextDraft);
      } catch {
        /* ignore */
      }
      return nextDraft;
    });
  };

  const pickConcello = (c: ConcelloRow) => {
    const brand = detectShieldBrandColor(c.slug);
    const marked = c.facilities
      .filter((f) => !isOutOfScopeFacility(f))
      .map((f) => f.name);
    const facilityNames: Record<string, string> = {};
    for (const f of c.facilities.filter((x) => !isOutOfScopeFacility(x))) {
      facilityNames[f.name] = friendlyFacilityLabel(f.name, f.type, c.name);
    }
    persist({
      selectedIne: c.ine,
      marked,
      facilityNames,
      adminEmail: c.email?.includes("@") ? `admin@${c.slug}.demo.pistaaberta.com` : "",
      adminName: `Admin ${c.name}`,
      adminNif: draft.adminNif.trim() || (demoMode ? randomDemoNif() : ""),
      legalEmail: c.email?.includes("@") ? c.email : `concello@${c.slug}.gal`,
      brandColor: brand,
    });
    setStep(2);
  };

  const toggleMark = (name: string) => {
    const set = new Set(draft.marked);
    if (set.has(name)) set.delete(name);
    else set.add(name);
    persist({ marked: [...set] });
  };

  const publish = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setError(null);
    setSlugConflict(null);
    /* REVISION-38 K3: NIF obrigatorio (demo enche un aleatorio válido se falta). */
    const nif = (
      draft.adminNif.trim() || (demoMode ? randomDemoNif() : "")
    ).trim();
    if (!nif) {
      setError(t("onboard.adminNifRequired"));
      return;
    }
    if (demoMode && !draft.adminNif.trim()) {
      persist({ adminNif: nif });
    }
    setSubmitting(true);
    try {
      const brand = draft.brandColor || detectShieldBrandColor(selected.slug);
      const { data } = await apiX.wizard({
        name: `Concello de ${selected.name}`,
        slug: selected.slug,
        ine: selected.ine,
        accentColor: brand,
        accent: brand,
        theme: { brand, accent: brand },
        markedFacilities: draft.marked,
        schedule: draft.schedule,
        norms: {
          rule1: draft.norms.includes("rule1"),
          rule2: draft.norms.includes("rule2"),
          rule3: draft.norms.includes("rule3"),
        },
        adminEmail: draft.adminEmail || undefined,
        adminDisplayName: draft.adminName || undefined,
        adminNif: nif,
        legalEmail: draft.legalEmail.trim() || undefined,
        facilityNames: draft.facilityNames,
      });
      setCreated({
        slug: data.slug,
        name: data.name,
        invite: data.invite,
        brandColor: brand,
      });
      try {
        removeOnboardDraft();
      } catch {
        /* ignore */
      }
      setStep(4);
    } catch (err) {
      const e = err as Error & {
        payload?: { error?: string; slug?: string; name?: string };
      };
      if (e.message === "slug_exists") {
        setSlugConflict({
          slug: e.payload?.slug ?? selected.slug,
          name: e.payload?.name ?? `Concello de ${selected.name}`,
        });
        setError(null);
      } else if (e.message === "nif_required") {
        setError(t("onboard.adminNifRequired"));
      } else if (e.message === "nif_invalid") {
        setError(t("deputacion.nifInvalid"));
      } else {
        setError(mapApiError(t, err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const scheduleTypes = useMemo(() => {
    if (!selected) return [] as string[];
    const types = new Set(
      selected.facilities
        .filter((f) => draft.marked.includes(f.name))
        .map((f) => mapOsmType(f.type)),
    );
    if (types.size === 0) types.add("pista");
    return [...types];
  }, [selected, draft.marked]);

  if (singleMuniSyncHint()) {
    return (
      <main className="mx-auto max-w-lg px-4 py-12">
        <p className="text-sm text-graphite">{t("onboard.singleMuniOnly")}</p>
        <Link to="/" className="mt-4 inline-block font-bold text-azul-700 underline">
          {t("onboard.backHome")}
        </Link>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-4">
          <Link to="/" className="font-bold">
            {t("brand")}
          </Link>
          <ReadingPrefsAaControl variant="onLight" />
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-sm font-bold uppercase tracking-wide text-graphite">
          {t("onboard.wizard")} · {step}/{STEPS}
        </p>
        <h1 className="pa-h1 mt-1">{t("onboard.title")}</h1>

        <div
          className="mt-4 flex gap-1"
          role="progressbar"
          aria-valuenow={step}
          aria-valuemin={1}
          aria-valuemax={STEPS}
          aria-label={t("onboard.progress")}
        >
          {Array.from({ length: STEPS }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full ${i < step ? "bg-ink" : "bg-area"}`}
            />
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" className="pa-btn-secondary text-sm" onClick={saveDraft}>
            {t("onboard.saveLater")}
          </button>
          {savedFlash && (
            <span className="text-sm font-bold text-graphite" role="status">
              ✓ {t("onboard.draftSaved")}
            </span>
          )}
        </div>

        {step === 1 && (
          <section className="pa-card mt-8 space-y-4 p-6">
            <h2 className="pa-h2">{t("onboard.stepPick")}</h2>
            <p className="text-sm text-graphite">{t("onboard.stepPickHint")}</p>
            <ListSearch
              value={q}
              onChange={setQ}
              placeholder={t("onboard.searchConcello")}
              count={lista.length}
              minRows={0}
              label={t("onboard.searchConcello")}
            />
            {!lista.length && !error && (
              <p className="text-sm text-graphite">{t("common.loading")}</p>
            )}
            <ul className="max-h-96 space-y-1 overflow-y-auto">
              {filtered.slice(0, 80).map((c) => (
                <li key={c.ine}>
                  <button
                    type="button"
                    className={`flex w-full items-center gap-3 rounded-btn border px-3 py-2.5 text-left ${
                      draft.selectedIne === c.ine
                        ? "border-ink bg-ink text-white"
                        : "border-line bg-white hover:bg-area"
                    }`}
                    onClick={() => pickConcello(c)}
                  >
                    <span
                      className={`flex h-10 w-8 shrink-0 items-center justify-center rounded text-sm font-bold ${
                        draft.selectedIne === c.ine ? "bg-white/20" : "bg-area text-ink"
                      }`}
                      aria-hidden
                    >
                      {c.shieldInitial}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold">{c.name}</span>
                      <span
                        className={`block text-xs ${
                          draft.selectedIne === c.ine ? "text-white/80" : "text-graphite"
                        }`}
                      >
                        {c.province} · {t("onboard.facilitiesDetected", { count: c.facilityCount, n: c.facilityCount })}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {filtered.length > 80 && (
              <p className="text-sm text-graphite">
                {t("onboard.refineSearch", { n: filtered.length })}
              </p>
            )}
          </section>
        )}

        {step === 2 && selected && (
          <section className="pa-card mt-8 space-y-4 p-6">
            <h2 className="pa-h2">{t("onboard.stepFacilities")}</h2>
            <p className="text-sm text-graphite">
              {t("onboard.stepFacilitiesHint", { name: selected.name })}
            </p>
            <div className="rounded-btn border border-line bg-area p-3 text-sm">
              <p className="font-bold">
                {t("onboard.proposedName")}: Concello de {selected.name}
              </p>
              <p className="text-graphite">
                {t("onboard.proposedAddress")}: {selected.proposedAddress}
              </p>
              <p className="text-graphite">
                {t("onboard.proposedSlug")}: /c/{selected.slug}
              </p>
              <p className="mt-2 flex items-center gap-2 text-graphite">
                {t("onboard.color")}:
                <span
                  className="inline-block h-6 w-6 rounded border border-line"
                  style={{ background: draft.brandColor }}
                  aria-hidden
                />
                <code>{draft.brandColor}</code>
              </p>
            </div>
            <ul className="space-y-2">
              {selected.facilities.filter((f) => !isOutOfScopeFacility(f)).map((f) => {
                const on = draft.marked.includes(f.name);
                const label =
                  draft.facilityNames[f.name] ??
                  friendlyFacilityLabel(f.name, f.type, selected.name);
                const censusN = censusCountFromName(f.name);
                return (
                  <li key={f.name} className="rounded-btn border border-line px-3 py-2.5">
                    <label className="flex cursor-pointer items-center gap-3">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleMark(f.name)}
                      />
                      <FacilityTypeIcon type={mapOsmType(f.type)} size={28} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs text-graphite">
                          {f.name} · {f.type}
                        </span>
                        <input
                          className="pa-input mt-1 w-full font-bold"
                          value={label}
                          disabled={!on}
                          onChange={(e) =>
                            persist({
                              facilityNames: {
                                ...draft.facilityNames,
                                [f.name]: e.target.value,
                              },
                            })
                          }
                          aria-label={t("onboard.proposedName")}
                        />
                        {/* REVISION-31 A4: número do censo só no aviso, coherente co paso 2. */}
                        {on && censusN > 1 ? (
                          <p className="mt-1 text-xs text-graphite" role="note">
                            {t("onboard.censusNotice", {
                              n: censusN,
                              kind: censusKindLabel(
                                f.type,
                                censusN,
                                !i18n.language.startsWith("es"),
                              ),
                              name: shortMunicipalityName(selected.name),
                            })}
                          </p>
                        ) : null}
                      </span>
                    </label>
                  </li>
                );
              })}
              {selected.facilities.length === 0 && (
                <li className="text-sm text-graphite">{t("onboard.noOsmFacilities")}</li>
              )}
            </ul>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="pa-btn-secondary" onClick={back}>
                {t("common.back")}
              </button>
              <button
                type="button"
                className="pa-btn-primary"
                disabled={draft.marked.length === 0 && selected.facilities.length > 0}
                onClick={next}
              >
                {t("onboard.next")}
              </button>
            </div>
          </section>
        )}

        {step === 3 && selected && (
          <section className="pa-card mt-8 space-y-4 p-6">
            <h2 className="pa-h2">{t("onboard.stepSchedule")}</h2>
            <p className="text-sm text-graphite">{t("onboard.stepScheduleHint")}</p>
            {scheduleTypes.map((ty) => {
              const row = draft.schedule[ty] ?? DEFAULT_SCHEDULE.default!;
              return (
                <div key={ty} className="flex flex-wrap items-end gap-3">
                  <p className="w-28 text-sm font-bold capitalize">{ty}</p>
                  <label className="text-sm font-bold">
                    {t("onboard.open")}
                    <div className="mt-1">
                      <TimeField
                        value={row.open}
                        onChange={(open) =>
                          persist({
                            schedule: {
                              ...draft.schedule,
                              [ty]: { ...row, open },
                            },
                          })
                        }
                      />
                    </div>
                  </label>
                  <label className="text-sm font-bold">
                    {t("onboard.close")}
                    <div className="mt-1">
                      <TimeField
                        value={row.close}
                        onChange={(close) =>
                          persist({
                            schedule: {
                              ...draft.schedule,
                              [ty]: { ...row, close },
                            },
                          })
                        }
                      />
                    </div>
                  </label>
                </div>
              );
            })}
            <h3 className="pt-2 text-sm font-extrabold text-marino">{t("onboard.stepNorms")}</h3>
            <ul className="space-y-2">
              {(
                [
                  ["rule1", t("onboard.rule1")],
                  ["rule2", t("onboard.rule2", { n: 7 })],
                  ["rule3", t("onboard.rule3", { n: 2 })],
                ] as const
              ).map(([id, label]) => (
                <li key={id}>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={draft.norms.includes(id)}
                      onChange={() => {
                        const set = new Set(draft.norms);
                        if (set.has(id)) set.delete(id);
                        else set.add(id);
                        persist({ norms: [...set] });
                      }}
                    />
                    <span>{label}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="pa-btn-secondary" onClick={back}>
                {t("common.back")}
              </button>
              <button type="button" className="pa-btn-primary" onClick={next}>
                {t("onboard.next")}
              </button>
            </div>
          </section>
        )}

        {step === 4 && !created && selected && (
          <form onSubmit={(e) => void publish(e)} className="pa-card mt-8 space-y-4 p-6">
            <h2 className="pa-h2">{t("onboard.stepAdmin")}</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-graphite">{t("onboard.name")}</dt>
                <dd className="font-bold">Concello de {selected.name}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-graphite">{t("onboard.proposedSlug")}</dt>
                <dd className="font-bold">/c/{selected.slug}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-graphite">{t("onboard.stepFacilities")}</dt>
                <dd className="font-bold">{draft.marked.length}</dd>
              </div>
            </dl>
            <p className="text-sm text-graphite">{t("onboard.adminHint")}</p>
            {slugConflict ? (
              <div className="rounded-btn border border-line bg-area p-3 text-sm" role="alert">
                <p className="m-0 font-bold text-marino">
                  {t("onboard.slugExists", { name: slugConflict.name })}
                </p>
                <Link
                  to={`/c/${slugConflict.slug}/admin`}
                  className="mt-2 inline-block font-bold text-azul-700 underline"
                >
                  {t("onboard.slugExistsPanel")}
                </Link>
              </div>
            ) : null}
            <label className="block text-sm font-bold">
              {t("onboard.adminName")}
              <input
                className="pa-input mt-1 min-h-12"
                value={draft.adminName}
                onChange={(e) => persist({ adminName: e.target.value })}
                placeholder={t("onboard.adminNamePh")}
              />
            </label>
            <label className="block text-sm font-bold">
              {t("onboard.adminEmail")}
              <input
                type="email"
                className="pa-input mt-1 min-h-12"
                value={draft.adminEmail}
                onChange={(e) => persist({ adminEmail: e.target.value })}
                placeholder={`admin@${selected.slug}.demo.pistaaberta.com`}
              />
            </label>
            <label className="block text-sm font-bold">
              {t("onboard.legalEmail")}
              <input
                type="email"
                className="pa-input mt-1 min-h-12"
                required
                value={draft.legalEmail}
                onChange={(e) => persist({ legalEmail: e.target.value })}
                placeholder={t("onboard.legalEmailPh")}
              />
            </label>
            <label className="block text-sm font-bold">
              {t("onboard.adminNif")}
              <input
                className="pa-input mt-1 min-h-12 uppercase"
                required={!demoMode}
                value={draft.adminNif}
                onChange={(e) => {
                  const v = e.target.value.toUpperCase();
                  persist({ adminNif: v });
                  setNifExists(false);
                  if (v.replace(/\s/g, "").length >= 9) {
                    void apiX.lookupNif(v).then((r) => {
                      setNifExists(!!r.data?.exists);
                    });
                  }
                }}
                placeholder={demoMode ? t("onboard.adminNifDemoPh") : "12345678Z"}
                autoComplete="off"
              />
            </label>
            {nifExists ? (
              <p className="text-sm text-graphite" role="status">
                {t("onboard.nifExisting")}
              </p>
            ) : null}
            {error && (
              <div className="pa-warn-banner">
                <span aria-hidden>⚠</span>
                <span>{error}</span>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="pa-btn-secondary" onClick={back}>
                {t("common.back")}
              </button>
              <button type="submit" className="pa-btn-primary" disabled={submitting}>
                {submitting ? t("common.loading") : t("onboard.createMuni")}
              </button>
            </div>
          </form>
        )}

        {step === 4 && created && (
          <section className="pa-card mt-8 space-y-4 p-6">
            <h2 className="pa-h2">{t("onboard.stepDone")}</h2>
            <p className="pa-ok-banner">
              ✓ {t("onboard.createdPreparing", { name: created.name })}
            </p>
            {created.invite ? (
              <div className="rounded-btn border border-line bg-area px-4 py-3 text-sm">
                <p className="font-bold">{t("onboard.invitePending")}</p>
                <p className="text-graphite">{draft.adminEmail || t("onboard.inviteEmailFallback")}</p>
                <button
                  type="button"
                  className="pa-btn-secondary mt-3"
                  onClick={() => {
                    void navigator.clipboard?.writeText(created.invite!.url);
                    setInviteCopied(true);
                    window.setTimeout(() => setInviteCopied(false), 2000);
                  }}
                >
                  {inviteCopied ? t("onboard.inviteCopied") : t("onboard.copyInvite")}
                </button>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <Link
                to={`/c/${created.slug}/admin`}
                className="pa-btn-secondary"
              >
                {t("onboard.readOnlyPanel")}
              </Link>
              {demoMode && created.invite ? (
                <Link
                  to={`/convite/${created.invite.token}`}
                  className="pa-btn-primary"
                >
                  {t("onboard.enterAsInvitee")}
                </Link>
              ) : null}
              <button type="button" className="pa-btn-secondary" onClick={() => nav("/deputacion")}>
                {t("onboard.backDeputacion")}
              </button>
            </div>
          </section>
        )}

        {error && step === 1 && (
          <div className="pa-warn-banner mt-4" role="alert">
            <span aria-hidden>⚠</span>
            <span>{error}</span>
          </div>
        )}
      </main>
    </div>
  );
}
