import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Municipality } from "@pista-aberta/shared";
import { api } from "../lib/api";
import { apiX } from "../lib/api-complete";
import { useSession } from "../context/SessionContext";
import {
  deputacionTabHref,
  parseDeputacionTab,
  type DeputacionTab,
} from "../lib/deputacion-tabs";
import { formatDate } from "../lib/format-date";
import { DemoSnapshotCard } from "../components/DemoSnapshotCard";

type RowKpi = {
  slug: string;
  name: string;
  bookingsToday: number | null;
  weekOccupancy: number | null;
  openIncidents: number | null;
  facilities: number | null;
  weekSpark: number[];
  occupancyWeeks: number[];
  sandbox: boolean;
};

type DepRow = Awaited<ReturnType<typeof apiX.deputacionConcellos>>["data"][number];

const ROW_BADGE_COLORS = ["#5A4636", "#2E4A5C", "#0069A8", "#0B5D3B"] as const;

function badgeColorForSlug(slug: string): string {
  let h = 0;
  for (let i = 0; i < slug.length; i += 1) h = (h + slug.charCodeAt(i)) % ROW_BADGE_COLORS.length;
  return ROW_BADGE_COLORS[h] ?? ROW_BADGE_COLORS[0];
}

function shortConcelloName(name: string): string {
  return name.replace(/^Concello de\s+/i, "");
}

function concelloInitial(name: string): string {
  const s = shortConcelloName(name).trim();
  return (s[0] ?? "?").toUpperCase();
}

function formatInstalacions(
  dep: DepRow | undefined,
  fallback: number | null,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (dep) {
    if (dep.facilitiesDraft > 0 && dep.facilitiesActive === 0) {
      return t("deputacion.facilitiesDraft", { n: dep.facilitiesDraft });
    }
    if (dep.facilitiesDraft > 0) {
      return `${dep.facilitiesActive} (${dep.facilitiesDraft} borrador)`;
    }
    return String(dep.facilitiesActive);
  }
  return fallback != null ? String(fallback) : "…";
}

function DepConcelloActions({
  dep,
  onChanged,
  t,
  compact,
}: {
  dep: DepRow;
  onChanged: () => void;
  t: ReturnType<typeof useTranslation>["t"];
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [revokeReason, setRevokeReason] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteNif, setInviteNif] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteErr, setInviteErr] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const openInvite = (emailPrefill?: string) => {
    setInviteEmail(emailPrefill ?? "");
    setInviteNif("");
    setInviteName("");
    setInviteErr(null);
    setInviteOpen(true);
  };

  const submitInvite = () => {
    const email = inviteEmail.trim();
    const nif = inviteNif.trim();
    if (!email.includes("@")) {
      setInviteErr(t("deputacion.emailRequired"));
      return;
    }
    if (!nif) {
      setInviteErr(t("deputacion.nifRequired"));
      return;
    }
    setInviteErr(null);
    void run(async () => {
      try {
        await apiX.deputacionInvite(dep.slug, {
          email,
          nif,
          name: inviteName.trim() || undefined,
        });
        setInviteOpen(false);
      } catch (e: unknown) {
        const msg =
          e && typeof e === "object" && "error" in e
            ? String((e as { error: string }).error)
            : e instanceof Error
              ? e.message
              : "";
        if (msg === "nif_invalid") setInviteErr(t("deputacion.nifInvalid"));
        else if (msg === "nif_required") setInviteErr(t("deputacion.nifRequired"));
        else setInviteErr(msg || t("common.error"));
        throw e;
      }
    }).catch(() => undefined);
  };

  const inviteAdmin = () => openInvite();
  const resendInvite = () => openInvite(dep.pendingInvite?.email ?? "");
  const revokeInvite = () => {
    if (!window.confirm(t("deputacion.actionRevokeInvite") + "?")) return;
    void run(() => apiX.deputacionRevokeInvite(dep.slug));
  };
  const revokeAccess = () => {
    setRevokeReason("");
    setRevokeOpen(true);
  };
  const confirmRevoke = () => {
    const reason = revokeReason.trim();
    if (reason.length < 3) return;
    setRevokeOpen(false);
    void run(() => apiX.deputacionRetirarAdmin(dep.slug, reason));
  };
  const copyInvite = () => {
    if (dep.pendingInvite?.url) void navigator.clipboard?.writeText(dep.pendingInvite.url);
  };

  const hasActiveAdmin =
    dep.adminUserId &&
    !dep.adminLabel.includes("Convite pendente") &&
    !dep.adminLabel.startsWith("⚠");

  const menuItem =
    "block w-full rounded-btn px-3 py-2 text-left font-bold text-marino hover:bg-paper disabled:opacity-50";

  return (
  <>
      <div className={`flex items-center gap-2 ${compact ? "" : "flex-col items-stretch"}`}>
        <Link
          to={`/c/${dep.slug}/admin`}
          className="inline-flex items-center justify-center rounded-btn border border-line bg-surface px-3.5 py-2 text-sm font-bold text-marino no-underline hover:bg-paper"
        >
          {t("deputacion.openPanel")}
        </Link>
        <details className="relative shrink-0">
          <summary
            className="flex h-[38px] w-[38px] cursor-pointer list-none items-center justify-center rounded-btn border border-line bg-surface text-lg font-extrabold text-marino hover:bg-paper [&::-webkit-details-marker]:hidden"
            aria-label={t("deputacion.moreActions")}
          >
            ⋯
          </summary>
          <div className="absolute right-0 z-20 mt-1 min-w-[12.5rem] rounded-card border border-line bg-white p-1 shadow-lg">
            <Link to={`/c/${dep.slug}`} className={menuItem}>
              {t("deputacion.actionPortada")}
            </Link>
            {dep.contact?.phone || dep.contact?.email ? (
              <p className="m-0 border-t border-line px-3 py-2 text-xs text-graphite">
                <span className="font-bold text-marino">{t("deputacion.colContact")}: </span>
                {[dep.contact.phone, dep.contact.email].filter(Boolean).join(" · ")}
              </p>
            ) : null}
            {dep.pendingInvite ? (
              <>
                <button type="button" className={menuItem} disabled={busy} onClick={copyInvite}>
                  {t("onboard.copyInvite")}
                </button>
                <button type="button" className={menuItem} disabled={busy} onClick={resendInvite}>
                  {t("deputacion.actionResendInvite")}
                </button>
                <button type="button" className={menuItem} disabled={busy} onClick={revokeInvite}>
                  {t("deputacion.actionRevokeInvite")}
                </button>
              </>
            ) : null}
            {!hasActiveAdmin && !dep.pendingInvite ? (
              <button type="button" className={menuItem} disabled={busy} onClick={inviteAdmin}>
                {t("deputacion.actionInvite")}
              </button>
            ) : null}
            {hasActiveAdmin ? (
              <button type="button" className={menuItem} disabled={busy} onClick={revokeAccess}>
                {t("deputacion.actionRevokeAccess")}
              </button>
            ) : null}
          </div>
        </details>
      </div>
      {inviteOpen ? (
        <DepDialog
          titleId="invite-admin-title"
          title={t("deputacion.inviteAdminTitle")}
          onClose={() => setInviteOpen(false)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitInvite();
            }}
          >
            <label className="mt-4 block text-sm font-bold">
              {t("deputacion.inviteEmail")}
              <input
                type="email"
                className="pa-input mt-1 w-full"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                autoFocus
              />
            </label>
            <label className="mt-3 block text-sm font-bold">
              {t("deputacion.inviteNif")}
              <input
                className="pa-input mt-1 w-full uppercase"
                required
                value={inviteNif}
                onChange={(e) => setInviteNif(e.target.value.toUpperCase())}
                placeholder="12345678Z"
                autoComplete="off"
              />
            </label>
            <label className="mt-3 block text-sm font-bold">
              {t("deputacion.inviteName")}
              <input
                className="pa-input mt-1 w-full"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
              />
            </label>
            {inviteErr ? (
              <p className="mt-3 text-sm font-bold text-erro" role="alert">
                {inviteErr}
              </p>
            ) : null}
            <div className="mt-6 flex flex-wrap gap-3">
              <button type="submit" className="pa-btn-primary" disabled={busy}>
                {t("deputacion.inviteSubmit")}
              </button>
              <button type="button" className="pa-btn-secondary" onClick={() => setInviteOpen(false)}>
                {t("deputacion.inviteCancel")}
              </button>
            </div>
          </form>
        </DepDialog>
      ) : null}
      {revokeOpen ? (
        <DepDialog
          titleId="revoke-admin-title"
          title={t("deputacion.revokeReasonTitle")}
          onClose={() => setRevokeOpen(false)}
        >
          <p className="mt-2 text-sm text-graphite">{t("deputacion.revokeReasonBody")}</p>
          <label className="mt-4 block text-sm font-bold">
            {t("deputacion.revokeReasonLabel")}
            <textarea
              className="pa-input mt-1 min-h-24 w-full"
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              autoFocus
            />
          </label>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              className="pa-btn-danger"
              disabled={busy || revokeReason.trim().length < 3}
              onClick={confirmRevoke}
            >
              {t("deputacion.revokeReasonConfirm")}
            </button>
            <button type="button" className="pa-btn-secondary" onClick={() => setRevokeOpen(false)}>
              {t("common.cancel")}
            </button>
          </div>
        </DepDialog>
      ) : null}
  </>
  );
}

function DepDialog({
  titleId,
  title,
  children,
  onClose,
}: {
  titleId: string;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(0,43,74,0.4)] p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="pa-card w-full max-w-md p-6">
        <h2 id={titleId} className="pa-h2">
          {title}
        </h2>
        {children}
        <button type="button" className="sr-only" onClick={onClose}>
          close
        </button>
      </div>
    </div>
  );
}

function tabTitleKey(tab: DeputacionTab): string {
  switch (tab) {
    case "resumo":
      return "deputacion.tabResumo";
    case "concellos":
      return "deputacion.tabConcellos";
    case "persoas":
      return "deputacion.tabPersoas";
    case "config":
      return "deputacion.tabConfig";
    default: {
      const _never: never = tab;
      return _never;
    }
  }
}

export function DeputacionPage() {
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const [searchParams] = useSearchParams();
  const tab = parseDeputacionTab(searchParams.get("tab"));
  const [munis, setMunis] = useState<Municipality[]>([]);
  const [depRows, setDepRows] = useState<DepRow[]>([]);
  const [managers, setManagers] = useState<
    Awaited<ReturnType<typeof apiX.deputacionPersoas>>["data"]
  >([]);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [orgEmail, setOrgEmail] = useState("");
  const [orgEmailDraft, setOrgEmailDraft] = useState("");
  const [orgEmailMsg, setOrgEmailMsg] = useState<string | null>(null);
  const [orgEmailBusy, setOrgEmailBusy] = useState(false);
  const [mgrInviteOpen, setMgrInviteOpen] = useState(false);
  const [mgrEmail, setMgrEmail] = useState("");
  const [mgrNif, setMgrNif] = useState("");
  const [mgrName, setMgrName] = useState("");
  const [mgrErr, setMgrErr] = useState<string | null>(null);
  const [mgrBusy, setMgrBusy] = useState(false);
  const [concelloSearch, setConcelloSearch] = useState("");
  const activeManagers = managers.filter((m) => m.active);

  const reloadDep = () => {
    void apiX
      .deputacionConcellos()
      .then((r) => setDepRows(r.data))
      .catch(() => undefined);
    void apiX
      .deputacionPersoas()
      .then((r) => setManagers(r.data))
      .catch(() => undefined);
  };

  useEffect(() => {
    reloadDep();
    void apiX
      .deputacionOrg()
      .then((r) => {
        setOrgName(r.data?.name ?? null);
        const em = r.data?.email?.trim() ?? "";
        setOrgEmail(em);
        setOrgEmailDraft(em);
      })
      .catch(() => undefined);
  }, []);

  const [rows, setRows] = useState<RowKpi[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .municipalities()
      .then((r) => setMunis(r.data))
      .catch(() => setError(t("common.error")));
  }, [t]);

  const adherent = useMemo(() => {
    if (depRows.length > 0) {
      return depRows.map((d) => ({
        slug: d.slug,
        name: d.name,
        settings: { sandbox: false as const },
      }));
    }
    return munis.filter((m) => !m.settings?.sandbox);
  }, [depRows, munis]);

  useEffect(() => {
    if (adherent.length === 0) return;
    let cancelled = false;
    void Promise.all(
      adherent.map(async (m) => {
        const base: RowKpi = {
          slug: m.slug,
          name: m.name,
          bookingsToday: null,
          weekOccupancy: null,
          openIncidents: null,
          facilities: null,
          weekSpark: [],
          occupancyWeeks: [],
          sandbox: !!m.settings?.sandbox,
        };
        try {
          const [dash, fac] = await Promise.all([
            apiX.dashboard(m.slug),
            api.facilities(m.slug).catch(() => null),
          ]);
          const k = dash.data.kpis;
          return {
            ...base,
            bookingsToday: k?.bookingsToday.value ?? dash.data.todayCount ?? 0,
            weekOccupancy: k?.weekOccupancy.value ?? dash.data.weekOccupancy ?? 0,
            openIncidents: k?.openIncidents.value ?? dash.data.openIncidents ?? 0,
            facilities: fac?.data.length ?? null,
            weekSpark: k?.weekOccupancy.spark ?? k?.bookingsToday.spark ?? [],
            occupancyWeeks:
              k?.weekOccupancy.weeks ?? dash.data.occupancyWeeks ?? [],
          };
        } catch {
          return base;
        }
      }),
    ).then((list) => {
      if (!cancelled) setRows(list);
    });
    return () => {
      cancelled = true;
    };
  }, [adherent]);

  const depBySlug = useMemo(
    () => new Map(depRows.map((d) => [d.slug, d])),
    [depRows],
  );

  const displayRows =
    rows.length > 0
      ? rows
      : adherent.map((m) => ({
          slug: m.slug,
          name: m.name,
          bookingsToday: null as number | null,
          weekOccupancy: null as number | null,
          openIncidents: null as number | null,
          facilities: null as number | null,
          weekSpark: [] as number[],
          occupancyWeeks: [] as number[],
          sandbox: !!m.settings?.sandbox,
        }));

  const filteredRows = useMemo(() => {
    const q = concelloSearch.trim().toLowerCase();
    if (!q) return displayRows;
    return displayRows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.slug.includes(q) ||
        shortConcelloName(r.name).toLowerCase().includes(q),
    );
  }, [displayRows, concelloSearch]);

  const kpis = useMemo(() => {
    const preparing = depRows.filter((d) => !d.portalPublished).length;
    const bookingsToday = displayRows.reduce(
      (acc, r) => acc + (r.bookingsToday ?? 0),
      0,
    );
    const occVals = displayRows
      .map((r) => r.weekOccupancy)
      .filter((v): v is number => v != null);
    const avgOccupancy =
      occVals.length > 0
        ? Math.round(occVals.reduce((a, b) => a + b, 0) / occVals.length)
        : null;
    const openIncidents = displayRows.reduce(
      (acc, r) => acc + (r.openIncidents ?? 0),
      0,
    );
    return {
      count: adherent.length,
      preparing,
      bookingsToday,
      avgOccupancy,
      openIncidents,
    };
  }, [adherent.length, depRows, displayRows]);

  /* REVISION-47 W4: mesmo formateador ca no resto (sen Intl gl-ES). */
  const resumoDate = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const mo = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return formatDate(`${y}-${mo}-${d}`, i18n.language);
  }, [i18n.language]);

  const occupancySidebar = useMemo(() => {
    return [...displayRows]
      .filter((r) => r.weekOccupancy != null)
      .sort((a, b) => (b.weekOccupancy ?? 0) - (a.weekOccupancy ?? 0));
  }, [displayRows]);

  const contactEmailForm = (
    <section className="pa-card max-w-3xl p-5" aria-labelledby="dep-contact-title">
      <h2 id="dep-contact-title" className="m-0 text-lg font-extrabold text-marino">
        {t("deputacion.configContactTitle")}
      </h2>
      <p className="mt-2 text-sm text-graphite">{t("deputacion.configContactHint")}</p>
      <form
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const next = orgEmailDraft.trim();
          if (!next.includes("@")) {
            setOrgEmailMsg(t("deputacion.emailRequired"));
            return;
          }
          setOrgEmailBusy(true);
          setOrgEmailMsg(null);
          void apiX
            .patchDeputacionOrg({ email: next })
            .then((r) => {
              const em = r.data.email?.trim() ?? next;
              setOrgEmail(em);
              setOrgEmailDraft(em);
              setOrgEmailMsg(t("deputacion.contactEmailSaved"));
            })
            .catch(() => setOrgEmailMsg(t("common.error")))
            .finally(() => setOrgEmailBusy(false));
        }}
      >
        <label className="min-w-[14rem] flex-1 text-sm font-bold">
          <span className="sr-only">{t("deputacion.contactEmail")}</span>
          <input
            type="email"
            className="pa-input mt-1 w-full"
            required
            value={orgEmailDraft}
            onChange={(e) => setOrgEmailDraft(e.target.value)}
          />
        </label>
        <button type="submit" className="pa-btn-secondary" disabled={orgEmailBusy}>
          {t("deputacion.contactEmailSave")}
        </button>
      </form>
      {orgEmailMsg ? (
        <p className="mt-2 text-sm font-bold text-marino" role="status">
          {orgEmailMsg}
          {orgEmail ? ` · ${orgEmail}` : ""}
        </p>
      ) : null}
    </section>
  );

  const managersSection = (
    <section className="pa-card p-5" aria-labelledby="dep-persoas-title">
      <h2 id="dep-persoas-title" className="m-0 text-lg font-extrabold text-marino">
        {t("deputacion.persoasTitle")}
      </h2>
      <p className="mt-2 text-sm text-graphite">{t("deputacion.persoasHint")}</p>
      {activeManagers.length === 1 ? (
        <div className="pa-warn-banner mt-3" role="status">
          <span aria-hidden>⚠</span>
          <span>{t("deputacion.singleManagerWarning")}</span>
        </div>
      ) : null}
      <ul className="mt-4 space-y-2 text-sm">
        {managers.map((m) => (
          <li
            key={m.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-btn border border-line px-3 py-2"
          >
            <span>
              <strong>{m.displayName}</strong>
              {m.email ? <span className="text-graphite"> · {m.email}</span> : null}
              {!m.active ? (
                <span className="text-graphite"> · {t("deputacion.managerInactive")}</span>
              ) : null}
            </span>
            {m.active && m.id !== user?.id ? (
              <button
                type="button"
                className="font-bold text-azul-700 underline"
                onClick={() => {
                  if (!window.confirm(t("deputacion.revokeManager") + "?")) return;
                  void apiX.deputacionManagerRevoke(m.id).then(reloadDep);
                }}
              >
                {t("deputacion.revokeManager")}
              </button>
            ) : null}
          </li>
        ))}
        {managers.length === 0 ? (
          <li className="text-graphite">{t("common.loading")}</li>
        ) : null}
      </ul>
      <button
        type="button"
        className="pa-btn-secondary mt-4 text-sm"
        onClick={() => {
          setMgrEmail("");
          setMgrNif("");
          setMgrName("");
          setMgrErr(null);
          setMgrInviteOpen(true);
        }}
      >
        {t("deputacion.inviteManager")}
      </button>
      {mgrInviteOpen ? (
        <DepDialog
          titleId="invite-mgr-title"
          title={t("deputacion.inviteManagerTitle")}
          onClose={() => setMgrInviteOpen(false)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const email = mgrEmail.trim();
              const nif = mgrNif.trim();
              if (!email.includes("@")) {
                setMgrErr(t("deputacion.emailRequired"));
                return;
              }
              if (!nif) {
                setMgrErr(t("deputacion.nifRequired"));
                return;
              }
              setMgrBusy(true);
              setMgrErr(null);
              void apiX
                .deputacionManagerInvite({
                  email,
                  nif,
                  name: mgrName.trim() || undefined,
                })
                .then(() => {
                  setMgrInviteOpen(false);
                  reloadDep();
                })
                .catch((err: unknown) => {
                  const msg =
                    err && typeof err === "object" && "error" in err
                      ? String((err as { error: string }).error)
                      : err instanceof Error
                        ? err.message
                        : "";
                  if (msg === "nif_invalid" || msg === "nif_required") {
                    setMgrErr(
                      msg === "nif_required"
                        ? t("deputacion.nifRequired")
                        : t("deputacion.nifInvalid"),
                    );
                  } else {
                    setMgrErr(msg || t("common.error"));
                  }
                })
                .finally(() => setMgrBusy(false));
            }}
          >
            <label className="mt-4 block text-sm font-bold">
              {t("deputacion.inviteEmail")}
              <input
                type="email"
                className="pa-input mt-1 w-full"
                required
                value={mgrEmail}
                onChange={(e) => setMgrEmail(e.target.value)}
                autoFocus
              />
            </label>
            <label className="mt-3 block text-sm font-bold">
              {t("deputacion.inviteNif")}
              <input
                className="pa-input mt-1 w-full uppercase"
                required
                value={mgrNif}
                onChange={(e) => setMgrNif(e.target.value.toUpperCase())}
                placeholder="12345678Z"
                autoComplete="off"
              />
            </label>
            <label className="mt-3 block text-sm font-bold">
              {t("deputacion.inviteName")}
              <input
                className="pa-input mt-1 w-full"
                value={mgrName}
                onChange={(e) => setMgrName(e.target.value)}
              />
            </label>
            {mgrErr ? (
              <p className="mt-3 text-sm font-bold text-erro" role="alert">
                {mgrErr}
              </p>
            ) : null}
            <div className="mt-6 flex flex-wrap gap-3">
              <button type="submit" className="pa-btn-primary" disabled={mgrBusy}>
                {t("deputacion.inviteSubmit")}
              </button>
              <button
                type="button"
                className="pa-btn-secondary"
                onClick={() => setMgrInviteOpen(false)}
              >
                {t("deputacion.inviteCancel")}
              </button>
            </div>
          </form>
        </DepDialog>
      ) : null}
    </section>
  );

  return (
    <main className="pa-page mx-auto max-w-[1180px] px-6 py-7 md:px-8">
      <DepPageHeader tab={tab} t={t} resumoDate={resumoDate} orgName={orgName} />

      {error ? (
        <div className="pa-warn-banner mt-6" role="alert">
          <span aria-hidden>⚠</span>
          <span>{error}</span>
        </div>
      ) : null}

      {tab === "resumo" ? (
        <div className="mt-6 flex flex-col gap-6">
          <section
            aria-label={t("deputacion.kpiSection")}
            className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4"
          >
            <KpiCard
              label={t("deputacion.kpiAdherent")}
              value={String(kpis.count)}
              sub={
                kpis.preparing > 0
                  ? t("deputacion.kpiAdherentPreparing", { n: kpis.preparing })
                  : undefined
              }
            />
            <KpiCard label={t("deputacion.colBookingsToday")} value={String(kpis.bookingsToday)} />
            <KpiCard
              label={t("deputacion.kpiAvgOccupancy")}
              value={kpis.avgOccupancy != null ? `${kpis.avgOccupancy} %` : "…"}
            />
            <KpiCard
              label={t("deputacion.kpiOpenIncidents")}
              value={String(kpis.openIncidents)}
              sub={
                kpis.openIncidents === 0 ? t("deputacion.kpiAllClear") : undefined
              }
            />
          </section>

          <div className="flex flex-wrap items-start gap-6">
            <section className="min-w-0 flex-[999_1_640px] overflow-hidden rounded-[18px] border border-line bg-surface">
              <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
                <h2 className="m-0 flex-1 text-lg font-extrabold text-marino">
                  {t("deputacion.adherentTitle", { count: adherent.length })}
                </h2>
                <label className="sr-only" htmlFor="dep-resumo-search">
                  {t("deputacion.searchConcello")}
                </label>
                <input
                  id="dep-resumo-search"
                  type="search"
                  className="pa-input min-w-[12rem] flex-1 text-sm md:max-w-xs"
                  placeholder={t("deputacion.searchConcello")}
                  value={concelloSearch}
                  onChange={(e) => setConcelloSearch(e.target.value)}
                />
              </div>
              <ul className="m-0 list-none p-0">
                {filteredRows.map((r) => {
                  const dep = depBySlug.get(r.slug);
                  const facilities = formatInstalacions(dep, r.facilities, t);
                  return (
                    <li
                      key={r.slug}
                      className="flex flex-wrap items-center gap-4 border-b border-line px-5 py-4 last:border-b-0"
                    >
                      <div className="flex min-w-[11rem] flex-1 items-center gap-3">
                        <span
                          className="flex h-10 w-[34px] shrink-0 items-center justify-center rounded-t-md rounded-b-2xl text-sm font-extrabold text-white"
                          style={{ background: badgeColorForSlug(r.slug) }}
                          aria-hidden
                        >
                          {concelloInitial(r.name)}
                        </span>
                        <div className="min-w-0">
                          <p className="m-0 truncate font-bold text-marino">{r.name}</p>
                          <p className="m-0 text-[13px] text-graphite">
                            {dep
                              ? t("deputacion.rowFacilitiesAdmin", {
                                  facilities,
                                  admin: dep.adminLabel,
                                })
                              : facilities}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-5 text-sm">
                        <StatMini
                          label={t("deputacion.colBookingsToday")}
                          value={r.bookingsToday != null ? String(r.bookingsToday) : "…"}
                        />
                        <StatMini
                          label={t("deputacion.colOccupancy")}
                          value={r.weekOccupancy != null ? `${r.weekOccupancy} %` : "…"}
                        />
                        <div>
                          <p className="m-0 text-xs text-graphite">{t("deputacion.trendWeeks")}</p>
                          {r.occupancyWeeks.length > 0 || r.weekSpark.length > 0 ? (
                            <Spark
                              values={
                                r.occupancyWeeks.length > 0 ? r.occupancyWeeks : r.weekSpark
                              }
                              className="text-azul"
                              wide
                            />
                          ) : (
                            <span className="font-extrabold">…</span>
                          )}
                        </div>
                        <StatMini
                          label={t("deputacion.colIncidents")}
                          value={r.openIncidents != null ? String(r.openIncidents) : "…"}
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {dep ? (
                          <>
                            <EstadoPill dep={dep} t={t} />
                            <DepConcelloActions
                              dep={dep}
                              onChanged={reloadDep}
                              t={t}
                              compact
                            />
                          </>
                        ) : (
                          <Link
                            to={`/c/${r.slug}/admin`}
                            className="inline-flex rounded-btn border border-line px-3.5 py-2 text-sm font-bold text-marino no-underline"
                          >
                            {t("deputacion.openPanel")}
                          </Link>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>

            <aside className="flex min-w-[17rem] flex-1 flex-col gap-4">
              <section className="rounded-[18px] border border-line bg-surface p-5">
                <h2 className="m-0 text-base font-extrabold text-marino">
                  {t("deputacion.occupancyCompare")}
                </h2>
                <ul className="mt-3 space-y-3 p-0">
                  {occupancySidebar.map((r) => (
                    <li key={r.slug} className="list-none">
                      <div className="flex justify-between text-sm">
                        <span>{shortConcelloName(r.name)}</span>
                        <strong className="tabular-nums">{r.weekOccupancy}%</strong>
                      </div>
                      <div
                        className="mt-1 h-2.5 rounded-md bg-paper"
                        role="presentation"
                      >
                        <div
                          className="h-2.5 rounded-md bg-azul"
                          style={{ width: `${Math.min(100, r.weekOccupancy ?? 0)}%` }}
                        />
                      </div>
                    </li>
                  ))}
                  {occupancySidebar.length === 0 ? (
                    <li className="list-none text-sm text-graphite">{t("common.loading")}</li>
                  ) : null}
                </ul>
              </section>

              <section className="rounded-[18px] border border-line bg-surface p-5">
                <h2 className="m-0 text-base font-extrabold text-marino">
                  {t("deputacion.persoasTitle")}
                </h2>
                {managers.filter((m) => m.active)[0] ? (
                  <div className="mt-3 flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-azul text-xs font-bold text-white">
                      {(managers.find((m) => m.active)?.displayName ?? "?")
                        .split(/\s+/)
                        .map((p) => p[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase()}
                    </span>
                    <div className="min-w-0 text-sm">
                      <p className="m-0 font-bold">
                        {managers.find((m) => m.active)?.displayName}
                      </p>
                      <p className="m-0 truncate text-graphite">
                        {managers.find((m) => m.active)?.email}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-graphite">{t("common.loading")}</p>
                )}
                {activeManagers.length === 1 ? (
                  <p className="mt-3 rounded-xl border border-[#F2D49A] bg-[#FFF6E3] px-3 py-2 text-sm text-[#6B4600]">
                    {t("deputacion.singleManagerWarning")}
                  </p>
                ) : null}
                <Link
                  to={deputacionTabHref("persoas")}
                  className="pa-btn-secondary mt-3 inline-flex text-sm"
                >
                  {t("deputacion.inviteManager")}
                </Link>
              </section>

              <DemoSnapshotCard />
            </aside>
          </div>
        </div>
      ) : null}

      {tab === "concellos" ? (
        <div className="mt-6">
          <label className="sr-only" htmlFor="dep-concellos-search">
            {t("deputacion.searchConcello")}
          </label>
          <input
            id="dep-concellos-search"
            type="search"
            className="pa-input mb-4 max-w-md"
            placeholder={t("deputacion.searchConcello")}
            value={concelloSearch}
            onChange={(e) => setConcelloSearch(e.target.value)}
          />
          <ConcellosTable
            rows={filteredRows}
            depBySlug={depBySlug}
            reloadDep={reloadDep}
            t={t}
            formatInstalacions={formatInstalacions}
          />
        </div>
      ) : null}

      {tab === "persoas" ? <div className="mt-6">{managersSection}</div> : null}

      {tab === "config" ? (
        <div className="mt-6 flex flex-col gap-6">
          {contactEmailForm}
          <DemoSnapshotCard className="max-w-3xl" />
        </div>
      ) : null}
    </main>
  );
}

function DepPageHeader({
  tab,
  t,
  resumoDate,
  orgName,
}: {
  tab: DeputacionTab;
  t: ReturnType<typeof useTranslation>["t"];
  resumoDate: string;
  orgName: string | null;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="pa-h1 m-0">
          {tab === "resumo" ? t("deputacion.tabResumo") : t(tabTitleKey(tab))}
        </h1>
        {tab === "resumo" ? (
          <p className="mt-1.5 text-[15px] text-graphite">
            {t("deputacion.resumoLead", { date: resumoDate })}
          </p>
        ) : tab === "concellos" ? (
          <p className="mt-1.5 text-sm text-graphite">{t("deputacion.adherentLead")}</p>
        ) : null}
        {orgName && tab !== "resumo" ? (
          <p className="mt-1 text-sm text-graphite">{orgName}</p>
        ) : null}
      </div>
      {tab === "resumo" ? (
        <Link to="/alta-concello" className="pa-btn-primary inline-flex gap-2">
          <span aria-hidden>+</span>
          {t("deputacion.addConcelloCta")}
        </Link>
      ) : null}
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-card border border-line bg-surface px-5 py-[18px]">
      <span className="text-sm font-bold text-graphite">{label}</span>
      <span className="pa-h1 m-0 text-[34px] leading-none">{value}</span>
      {sub ? <span className="text-[13px] font-bold text-graphite">{sub}</span> : null}
    </div>
  );
}

function StatMini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="m-0 text-xs text-graphite">{label}</p>
      <p className="m-0 text-lg font-extrabold tabular-nums">{value}</p>
    </div>
  );
}

function EstadoPill({ dep, t }: { dep: DepRow; t: ReturnType<typeof useTranslation>["t"] }) {
  const published = dep.portalPublished;
  return (
    <span
      className={
        published
          ? "rounded-full bg-[#E3F4EA] px-2.5 py-1 text-xs font-bold text-[#0B5D3B]"
          : "rounded-full bg-paper px-2.5 py-1 text-xs font-bold text-graphite"
      }
    >
      {published
        ? t("deputacion.estadoPublished")
        : t("deputacion.estadoPreparing", {
            done: dep.checklistDone,
            total: dep.checklistTotal,
          })}
    </span>
  );
}

function ConcellosTable({
  rows,
  depBySlug,
  reloadDep,
  t,
  formatInstalacions,
}: {
  rows: RowKpi[];
  depBySlug: Map<string, DepRow>;
  reloadDep: () => void;
  t: ReturnType<typeof useTranslation>["t"];
  formatInstalacions: (
    dep: DepRow | undefined,
    fallback: number | null,
    t: ReturnType<typeof useTranslation>["t"],
  ) => string;
}) {
  return (
    <>
      <ul className="mt-0 flex list-none flex-col gap-3 p-0 md:hidden">
        {rows.map((r) => {
          const dep = depBySlug.get(r.slug);
          return (
            <li key={r.slug} className="rounded-card border border-line bg-surface p-4">
              <p className="m-0 text-lg font-extrabold text-marino">{r.name}</p>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-graphite">{t("deputacion.colBookingsToday")}</dt>
                  <dd className="m-0 font-bold tabular-nums">
                    {r.bookingsToday != null ? r.bookingsToday : "…"}
                  </dd>
                </div>
                <div>
                  <dt className="text-graphite">{t("deputacion.colOccupancy")}</dt>
                  <dd className="m-0 font-bold tabular-nums">
                    {r.weekOccupancy != null ? `${r.weekOccupancy}%` : "…"}
                  </dd>
                </div>
                <div>
                  <dt className="text-graphite">{t("deputacion.colFacilities")}</dt>
                  <dd className="m-0 font-bold tabular-nums">
                    {formatInstalacions(dep, r.facilities, t)}
                  </dd>
                </div>
                <div>
                  <dt className="text-graphite">{t("deputacion.colIncidents")}</dt>
                  <dd className="m-0 font-bold tabular-nums">
                    {r.openIncidents != null ? r.openIncidents : "…"}
                  </dd>
                </div>
              </dl>
              {dep ? (
                <ConcelloMobileExtras dep={dep} reloadDep={reloadDep} t={t} />
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="hidden overflow-x-auto rounded-card border border-line bg-surface md:block">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-line bg-paper text-graphite">
              <th className="px-4 py-3 font-extrabold">{t("deputacion.colConcello")}</th>
              <th className="px-4 py-3 font-extrabold">{t("deputacion.colEstado")}</th>
              <th className="px-4 py-3 font-extrabold">{t("deputacion.colAdmin")}</th>
              <th className="px-4 py-3 font-extrabold">{t("deputacion.colContact")}</th>
              <th className="px-4 py-3 font-extrabold">{t("deputacion.colFacilities")}</th>
              <th className="px-4 py-3 font-extrabold">{t("deputacion.colBookingsToday")}</th>
              <th className="px-4 py-3 font-extrabold">{t("deputacion.colOccupancyWeek")}</th>
              <th className="px-4 py-3 font-extrabold">{t("deputacion.colTrend")}</th>
              <th className="px-4 py-3 font-extrabold">{t("deputacion.colIncidents")}</th>
              <th className="px-4 py-3 font-extrabold">{t("deputacion.colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const dep = depBySlug.get(r.slug);
              return (
                <tr key={r.slug} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-bold text-marino">{r.name}</td>
                  <td className="px-4 py-3 text-sm">
                    {dep
                      ? dep.portalPublished
                        ? t("deputacion.estadoPublished")
                        : t("deputacion.estadoPreparing", {
                            done: dep.checklistDone,
                            total: dep.checklistTotal,
                          })
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-sm">{dep?.adminLabel ?? "…"}</td>
                  <td className="px-4 py-3 text-sm">
                    {dep?.contact?.phone || dep?.contact?.email
                      ? [dep.contact.phone, dep.contact.email].filter(Boolean).join(" · ")
                      : "—"}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {formatInstalacions(dep, r.facilities, t)}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {r.bookingsToday != null ? r.bookingsToday : "…"}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {r.weekOccupancy != null ? `${r.weekOccupancy}%` : "…"}
                  </td>
                  <td className="px-4 py-3">
                    {r.weekSpark.length > 0 ? (
                      <Spark values={r.weekSpark} className="text-azul" />
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {r.openIncidents != null ? r.openIncidents : "…"}
                  </td>
                  <td className="px-4 py-3">
                    {dep ? (
                      <DepConcelloActions dep={dep} onChanged={reloadDep} t={t} />
                    ) : (
                      <Link
                        to={`/c/${r.slug}/admin`}
                        className="font-bold text-azul-700 underline"
                      >
                        {t("deputacion.openPanel")}
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ConcelloMobileExtras({
  dep,
  reloadDep,
  t,
}: {
  dep: DepRow;
  reloadDep: () => void;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  return (
    <div className="mt-3 space-y-2 text-sm">
      <p className="m-0 text-graphite">
        <span className="font-bold text-marino">{t("deputacion.colEstado")}: </span>
        {dep.portalPublished
          ? t("deputacion.estadoPublished")
          : t("deputacion.estadoPreparing", {
              done: dep.checklistDone,
              total: dep.checklistTotal,
            })}
      </p>
      <p className="m-0 text-graphite">
        <span className="font-bold text-marino">{t("deputacion.colAdmin")}: </span>
        {dep.adminLabel}
      </p>
      <DepConcelloActions dep={dep} onChanged={reloadDep} t={t} />
    </div>
  );
}

function Spark({
  values,
  className = "",
  wide = false,
}: {
  values: number[];
  className?: string;
  wide?: boolean;
}) {
  const w = wide ? 90 : 64;
  const max = Math.max(1, ...values);
  const pts = values
    .map((v, i) => {
      const x = values.length <= 1 ? 0 : (i / (values.length - 1)) * w;
      const y = 22 - (v / max) * 18;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} 24`} width={w} height={24} className={className} aria-hidden>
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={pts}
      />
    </svg>
  );
}
