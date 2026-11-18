import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  NOTIFY_TYPES,
  defaultNotifyPrefs,
  type NotifyPrefs,
  type NotifyType,
} from "@pista-aberta/shared";
import { api } from "../lib/api";
import { apiX } from "../lib/api-complete";
import { useSession } from "../context/SessionContext";
import { InstallAppButton } from "../components/InstallAppButton";
import { Button, Card, EmptyState } from "../components/ui";
import { ensureLocale } from "../i18n";
import {
  FAMILY_RELATIONS,
  formatFamilyRelation,
  isFamilyRelation,
  renderFamilyRelationLabel,
  type FamilyRelation,
} from "../lib/family-relation";
import { formatDate } from "../lib/format-date";

export function AccountPage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user, refreshUser, logout } = useSession();
  const [family, setFamily] = useState<
    Array<{ id: string; displayName: string; relation: string; birthYear?: number }>
  >([]);
  const [consent, setConsent] = useState<{ at: string; version: string } | null>(null);
  const [name, setName] = useState("");
  const [relation, setRelation] = useState<FamilyRelation>("fillo");
  const [birthYear, setBirthYear] = useState("");
  /* REVISION-58 K7 — ano para familiar sen data. */
  const [editBirthYear, setEditBirthYear] = useState<Record<string, string>>({});
  const [email, setEmail] = useState("");
  const [locale, setLocale] = useState<"gl" | "es">("gl");
  const [notifyPrefs, setNotifyPrefs] = useState<NotifyPrefs>(() => defaultNotifyPrefs());
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [emailChallengeId, setEmailChallengeId] = useState<string | null>(null);
  const [emailCode, setEmailCode] = useState("");
  const [emailDemoCode, setEmailDemoCode] = useState<string | null>(null);

  const load = () => {
    void apiX.family().then((r) => {
      setFamily(r.data);
      setConsent(r.consent);
    });
  };

  useEffect(() => {
    if (user) {
      load();
      setEmail(user.email ?? "");
      setLocale(user.locale === "es" ? "es" : "gl");
      setNotifyPrefs(user.notifyPrefs ?? defaultNotifyPrefs());
    }
  }, [user]);

  /* REVISION-54 E3: /conta#familia → scroll e foco na sección Familia. */
  useEffect(() => {
    if (!user) return;
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return;
    const id = window.setTimeout(() => {
      const el = document.getElementById(hash);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      const heading = el.querySelector("h2, h3, [tabindex]");
      if (heading instanceof HTMLElement) {
        if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      } else {
        el.tabIndex = -1;
        el.focus({ preventScroll: true });
      }
    }, 50);
    return () => window.clearTimeout(id);
  }, [user, family.length]);

  if (!user) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <EmptyState
          title={t("account.title")}
          description={t("common.needLogin")}
          actionLabel={t("nav.login")}
          onAction={() => {
            window.location.href = `/c/${slug}/acceso?returnTo=/c/${slug}/conta`;
          }}
        />
      </main>
    );
  }

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    const year = Number(birthYear);
    if (!Number.isInteger(year) || year < 1900 || year > new Date().getFullYear()) {
      setErr(t("account.familyBirthYearInvalid"));
      return;
    }
    try {
      await apiX.addFamily({
        displayName: name,
        relation,
        birthYear: year,
      });
      setName("");
      setRelation("fillo");
      setBirthYear("");
      load();
    } catch {
      setErr(t("common.error"));
    }
  };

  const removeMember = async (id: string) => {
    setErr(null);
    try {
      await apiX.removeFamily(id);
      load();
      setMsg(t("account.familyRemoved"));
    } catch {
      setErr(t("account.familyRemoveError"));
    }
  };

  const saveBirthYear = async (id: string) => {
    setErr(null);
    setMsg(null);
    const year = Number(editBirthYear[id] ?? "");
    if (!Number.isInteger(year) || year < 1900 || year > new Date().getFullYear()) {
      setErr(t("account.familyBirthYearInvalid"));
      return;
    }
    try {
      await apiX.updateFamily(id, { birthYear: year });
      setEditBirthYear((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      load();
      setMsg(t("account.familyBirthYearSaved"));
    } catch {
      setErr(t("common.error"));
    }
  };

  const togglePref = (
    type: NotifyType,
    channel: "email" | "inApp",
    value: boolean,
  ) => {
    setNotifyPrefs((prev) => ({
      ...prev,
      [type]: { ...prev[type], [channel]: value },
    }));
  };

  const savePrefs = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    try {
      const r = await apiX.patchMe({
        email: email.trim() || undefined,
        locale,
        notifyPrefs,
      });
      await ensureLocale(locale);
      await refreshUser();
      if (r.emailChange?.challengeId) {
        setEmailChallengeId(r.emailChange.challengeId);
        setEmailDemoCode(r.emailChange.demoCode ?? null);
        setEmailCode("");
        setMsg(r.emailChange.message);
      } else {
        setEmailChallengeId(null);
        setMsg(t("account.prefsSaved"));
      }
    } catch (ex) {
      const code = ex instanceof Error ? ex.message : "";
      setErr(code === "email_taken" ? t("account.emailTaken") : t("account.prefsError"));
    }
  };

  const confirmEmailChange = async (e: FormEvent) => {
    e.preventDefault();
    if (!emailChallengeId) return;
    setErr(null);
    setMsg(null);
    try {
      await apiX.confirmEmailChange({
        challengeId: emailChallengeId,
        code: emailCode.trim(),
      });
      setEmailChallengeId(null);
      setEmailDemoCode(null);
      setEmailCode("");
      await refreshUser();
      setMsg(t("account.emailConfirmed"));
    } catch (ex) {
      const code = ex instanceof Error ? ex.message : "";
      setErr(
        code === "email_taken"
          ? t("account.emailTaken")
          : t("account.emailConfirmError"),
      );
    }
  };

  const exportData = async () => {
    setErr(null);
    try {
      const r = await apiX.exportMyData();
      const blob = new Blob([JSON.stringify(r.data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pista-aberta-datos-${slug}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg(t("account.exportOk"));
    } catch {
      setErr(t("account.exportError"));
    }
  };

  const closeAccount = async () => {
    if (!window.confirm(t("account.closeConfirm"))) return;
    setErr(null);
    try {
      await apiX.closeAccount();
      await logout();
      navigate(`/c/${slug}`);
    } catch {
      setErr(t("account.closeError"));
    }
  };

  const acceptConsent = async () => {
    const returnTo = new URLSearchParams(window.location.search).get("returnTo");
    await apiX.consent();
    setMsg(t("account.consentOk"));
    load();
    await refreshUser();
    if (returnTo?.startsWith("/")) {
      navigate(returnTo, { replace: true });
    }
  };

  return (
    <main className="pa-page-read pb-28 md:pb-12">
      <h1 className="pa-h1 m-0">{t("account.title")}</h1>
      <p className="mt-2 text-graphite">{user.displayName}</p>
      {typeof document !== "undefined" &&
      /(?:^|;\s*)pa_auth_via=certificate(?:;|$)/.test(document.cookie) ? (
        <p className="mt-2 text-sm font-bold text-azul-700">
          {(() => {
            const m = /(?:^|;\s*)pa_cert_issuer=([^;]+)/.exec(document.cookie);
            const issuer = m?.[1] ? decodeURIComponent(m[1]) : "";
            if (issuer === "DNIe") return t("account.authCertDnie");
            if (issuer) return t("account.authCertIssuer", { issuer });
            return t("account.authCert");
          })()}
        </p>
      ) : null}

      {!consent ? (
        <Card lift={false} className="mt-6 border-aviso-bd bg-aviso-bg p-5">
          <p className="m-0 font-extrabold text-aviso-ink">{t("account.consentTitle")}</p>
          <p className="mt-2 m-0 text-sm text-aviso-ink">{t("account.consentBody")}</p>
          <Button type="button" className="mt-4" onClick={() => void acceptConsent()}>
            {t("account.consentAccept")}
          </Button>
        </Card>
      ) : (
        <p className="pa-ok-banner mt-6 text-sm">
          ✓{" "}
          {t("account.consentReadable", {
            date: formatDate(
              (consent.at ?? "").slice(0, 10) || new Date().toISOString().slice(0, 10),
              i18n.language,
            ),
          })}{" "}
          <Link to={`/c/${slug}/legal/privacidade`} className="underline">
            {t("common.view", { defaultValue: "Ver" })}
          </Link>
        </p>
      )}
      {msg ? (
        <p className="mt-2 text-sm font-bold" role="status">
          {msg}
        </p>
      ) : null}
      {err ? (
        <p className="mt-2 text-sm text-erro" role="alert">
          {err}
        </p>
      ) : null}

      <Card lift={false} className="mt-8 p-5">
        <h2 className="m-0 text-lg font-extrabold text-marino">{t("account.prefs")}</h2>
        <form onSubmit={(e) => void savePrefs(e)} className="mt-4 flex max-w-md flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm font-bold">
            {t("account.email")}
            <input
              type="email"
              className="pa-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="avisos@proba.gal"
            />
          </label>
          {emailChallengeId ? (
            <div className="rounded-card border border-aviso-bd bg-aviso-bg p-3">
              <p className="m-0 text-sm text-aviso-ink">{t("account.emailCodeHint")}</p>
              {emailDemoCode ? (
                <p className="mt-1 m-0 text-xs text-aviso-ink">
                  {t("account.emailDemoCode", { code: emailDemoCode })}
                </p>
              ) : null}
              <label className="mt-2 flex flex-col gap-1 text-sm font-bold">
                {t("account.emailCode")}
                <input
                  className="pa-input"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={emailCode}
                  onChange={(e) => setEmailCode(e.target.value)}
                />
              </label>
              <Button
                type="button"
                className="mt-2"
                onClick={(e) => void confirmEmailChange(e as unknown as FormEvent)}
              >
                {t("account.emailConfirm")}
              </Button>
            </div>
          ) : null}
          <label className="flex flex-col gap-1 text-sm font-bold">
            {t("account.locale")}
            <select
              className="pa-input"
              value={locale}
              onChange={(e) => setLocale(e.target.value === "es" ? "es" : "gl")}
            >
              <option value="gl">Galego</option>
              <option value="es">Castellano</option>
            </select>
          </label>
          <Button type="submit" variant={consent ? "primary" : "secondary"} className="self-start">
            {t("admin.save")}
          </Button>
        </form>
      </Card>

      <Card lift={false} className="mt-6 p-5">
        <h2 className="m-0 text-lg font-extrabold text-marino">{t("account.avisos")}</h2>
        <p className="mt-1 text-sm text-graphite">{t("account.avisosHint")}</p>
        <form onSubmit={(e) => void savePrefs(e)} className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[20rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="py-2 pr-3 font-extrabold text-marino">{t("account.avisosType")}</th>
                <th className="py-2 px-2 font-extrabold text-marino">{t("account.avisosEmail")}</th>
                <th className="py-2 px-2 font-extrabold text-marino">{t("account.avisosInApp")}</th>
              </tr>
            </thead>
            <tbody>
              {NOTIFY_TYPES.map((type) => (
                <tr key={type} className="border-b border-line/60">
                  <td className="py-2.5 pr-3 font-bold">{t(`account.notifyType.${type}`)}</td>
                  <td className="py-2.5 px-2">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={notifyPrefs[type].email}
                        onChange={(e) => togglePref(type, "email", e.target.checked)}
                        aria-label={`${t(`account.notifyType.${type}`)} · ${t("account.avisosEmail")}`}
                      />
                    </label>
                  </td>
                  <td className="py-2.5 px-2">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={notifyPrefs[type].inApp}
                        onChange={(e) => togglePref(type, "inApp", e.target.checked)}
                        aria-label={`${t(`account.notifyType.${type}`)} · ${t("account.avisosInApp")}`}
                      />
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button type="submit" className="mt-4 self-start">
            {t("admin.save")}
          </Button>
        </form>
      </Card>

      {/* REVISION-22 B3 — Entrar como club / a miña conta */}
      {user.linkedClubs && user.linkedClubs.length > 0 ? (
        <Card lift={false} className="mt-6 p-5" data-testid="account-club-switcher">
          <h2 className="m-0 text-lg font-extrabold text-marino">
            {t("account.switchAs")}
          </h2>
          <ul className="mt-3 space-y-2">
            <li>
              <button
                type="button"
                className={`min-h-11 w-full rounded-xl border px-4 text-left text-sm font-bold ${
                  !user.activeClubId
                    ? "border-marino bg-marino text-on-dark"
                    : "border-line bg-surface text-marino"
                }`}
                onClick={() => {
                  void api
                    .setActiveClub(null)
                    .then(() => refreshUser())
                    .then(() => setMsg(t("account.switchPersonal")));
                }}
              >
                {t("account.switchPersonal")}
              </button>
            </li>
            {user.linkedClubs.map((cl) => (
              <li key={cl.id}>
                <button
                  type="button"
                  className={`min-h-11 w-full rounded-xl border px-4 text-left text-sm font-bold ${
                    user.activeClubId === cl.id
                      ? "border-marino bg-marino text-on-dark"
                      : "border-line bg-surface text-marino"
                  }`}
                  onClick={() => {
                    void api
                      .setActiveClub(cl.id)
                      .then(() => refreshUser())
                      .then(() => {
                        setMsg(`${t("account.switchAs")}: ${cl.name}`);
                        navigate(`/c/${slug}/clubs/${cl.id}`);
                      });
                  }}
                >
                  {cl.name}
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* Web instalable — substitúe o texto fixo iOS/Android. */}
      <Card lift={false} className="mt-6 p-5" data-testid="account-ios-install">
        <h2 className="m-0 text-lg font-extrabold text-marino">
          {t("install.cta")}
        </h2>
        <p className="mt-2 m-0 text-sm text-graphite">{t("install.homeHint")}</p>
        <div className="mt-3">
          <InstallAppButton />
        </div>
      </Card>

      <Card lift={false} className="mt-6 p-5" id="familia">
        <h2 className="m-0 text-lg font-extrabold text-marino">{t("account.family")}</h2>
        <p className="mt-1 text-sm text-graphite">{t("account.familyHint")}</p>
        <ul className="mt-4 space-y-2">
          {family.map((f) => (
            <li
              key={f.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-4 py-3 text-sm"
            >
              <span>
                <span className="font-bold">{f.displayName}</span>
                <span className="ml-2 text-graphite">
                  {renderFamilyRelationLabel(t, f.relation)}
                </span>
                {f.birthYear != null ? (
                  <span className="ml-2 text-graphite">({f.birthYear})</span>
                ) : null}
              </span>
              <span className="flex flex-wrap items-center gap-2">
                {f.birthYear == null ? (
                  <>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1900}
                      max={new Date().getFullYear()}
                      value={editBirthYear[f.id] ?? ""}
                      onChange={(e) =>
                        setEditBirthYear((prev) => ({
                          ...prev,
                          [f.id]: e.target.value,
                        }))
                      }
                      placeholder={t("account.familyBirthYear")}
                      aria-label={t("account.familyBirthYear")}
                      className="pa-input min-h-11 w-28"
                    />
                    <button
                      type="button"
                      className="pa-btn-secondary text-sm"
                      onClick={() => void saveBirthYear(f.id)}
                    >
                      {t("account.familyBirthYearSave")}
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  className="pa-ui-interactive min-h-11 border-0 bg-transparent p-0 text-sm font-bold text-erro underline"
                  onClick={() => void removeMember(f.id)}
                >
                  {t("account.familyRemove")}
                </button>
              </span>
            </li>
          ))}
        </ul>
        <form onSubmit={(e) => void add(e)} className="mt-4 flex flex-wrap gap-2">
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("account.familyName")}
            aria-label={t("account.familyName")}
            className="pa-input min-h-12 max-w-xs"
          />
          <select
            value={relation}
            onChange={(e) => {
              if (isFamilyRelation(e.target.value)) {
                setRelation(e.target.value);
              }
            }}
            aria-label={t("account.familyRelationLabel")}
            className="pa-input min-h-12"
          >
            {FAMILY_RELATIONS.map((rel) => (
              <option key={rel} value={rel}>
                {formatFamilyRelation(t, rel)}
              </option>
            ))}
          </select>
          <input
            required
            type="number"
            inputMode="numeric"
            min={1900}
            max={new Date().getFullYear()}
            value={birthYear}
            onChange={(e) => setBirthYear(e.target.value)}
            placeholder={t("account.familyBirthYear")}
            aria-label={t("account.familyBirthYear")}
            className="pa-input min-h-12 w-28"
          />
          <Button type="submit" variant="secondary">
            {t("account.familyAdd")}
          </Button>
        </form>
      </Card>

      <section className="mt-8 flex flex-wrap gap-3">
        <Button type="button" variant="secondary" onClick={() => void exportData()}>
          {t("account.export")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          data-testid="account-logout"
          onClick={() => {
            void logout().then(() => {
              window.location.href = `/c/${slug}/acceso?aviso=saida`;
            });
          }}
        >
          {t("account.logout")}
        </Button>
        {user.role === "citizen" ? (
          <Button type="button" variant="danger" onClick={() => void closeAccount()}>
            {t("account.close")}
          </Button>
        ) : null}
      </section>

      <p className="mt-8 text-sm">
        <Link to={`/c/${slug}/avisos`} className="font-bold text-azul-700 no-underline hover:underline">
          {t("nav.notices")}
        </Link>
      </p>
    </main>
  );
}
