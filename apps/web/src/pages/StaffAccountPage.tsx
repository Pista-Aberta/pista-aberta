import { FormEvent, useEffect, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Role } from "@pista-aberta/shared";
import { apiX } from "../lib/api-complete";
import { useSession } from "../context/SessionContext";
import { Button, Card, EmptyState } from "../components/ui";
import { PrefsBar } from "../components/PrefsBar";
import { useReadingPrefs } from "../hooks/useReadingPrefs";
import { ensureLocale } from "../i18n";
import { accesoPath } from "../lib/acceso";
import { AdminShell } from "./AdminPages";

function roleLabelKey(role: Role): string {
  switch (role) {
    case "citizen":
      return "userMenu.role.citizen";
    case "admin":
      return "userMenu.role.admin";
    case "staff":
    case "monitor":
      return "userMenu.role.staff";
    case "club_manager":
      return "userMenu.role.club";
    case "superadmin":
      return "userMenu.role.deputacion";
    default: {
      const _exhaustive: never = role;
      return _exhaustive;
    }
  }
}

function authViaLabel(
  t: (k: string, opts?: Record<string, string>) => string,
  user: { personIdentifier?: string; email?: string },
): string {
  if (typeof document !== "undefined") {
    const cookie = document.cookie;
    if (/(?:^|;\s*)pa_auth_via=certificate(?:;|$)/.test(cookie)) {
      const m = /(?:^|;\s*)pa_cert_issuer=([^;]+)/.exec(cookie);
      const issuer = m?.[1] ? decodeURIComponent(m[1]) : "";
      if (issuer === "DNIe") return t("account.authCertDnie");
      if (issuer) return t("account.authCertIssuer", { issuer });
      return t("account.authCert");
    }
    if (/(?:^|;\s*)pa_auth_via=saml(?:;|$)/.test(cookie)) {
      return t("account.authClave");
    }
    if (/(?:^|;\s*)pa_auth_via=email_otp(?:;|$)/.test(cookie)) {
      return t("account.authEmail");
    }
  }
  if (user.personIdentifier) return t("account.authClave");
  if (user.email) return t("account.authEmail");
  return t("account.authUnknown");
}

/**
 * Conta de persoal / conserxaría (REVISION-16 N4).
 * Sen familia nin consentimento de veciñanza.
 */
export function StaffAccountPage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const loc = useLocation();
  const { t } = useTranslation();
  const { user, refreshUser, logout, municipality } = useSession();
  const prefs = useReadingPrefs();
  const inAdmin = /\/admin(\/|$)/.test(loc.pathname);

  const [email, setEmail] = useState("");
  const [locale, setLocale] = useState<"gl" | "es">("gl");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setEmail(user.email ?? "");
    setLocale(user.locale === "es" ? "es" : "gl");
  }, [user]);

  const loginReturn = inAdmin
    ? `/c/${slug}/admin/conta`
    : `/c/${slug}/conserxeria/conta`;

  if (!user) {
    const body = (
      <EmptyState
        title={t("staffAccount.title")}
        description={t("common.needLogin")}
        actionLabel={t("nav.login")}
        onAction={() => {
          window.location.href = accesoPath(slug, {
            perfil: "persoal",
            returnTo: loginReturn,
          });
        }}
      />
    );
    return inAdmin ? (
      <AdminShell active="conta" pageTitle={t("staffAccount.title")}>
        {body}
      </AdminShell>
    ) : (
      <main className="mx-auto max-w-2xl px-4 py-8">{body}</main>
    );
  }

  const savePrefs = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    try {
      await apiX.patchMe({
        email: email.trim() || undefined,
        locale,
      });
      await ensureLocale(locale);
      await refreshUser();
      setMsg(t("account.prefsSaved"));
    } catch {
      setErr(t("account.prefsError"));
    }
  };

  const doLogout = () => {
    void logout().then(() => {
      window.location.href = accesoPath(slug, { aviso: "saida" });
    });
  };

  const muniName = municipality?.name ?? t("brand");
  const roleLine = `${t(roleLabelKey(user.role))} · ${muniName}`;

  const content = (
    <>
      <p className="mt-1 text-base font-bold text-ink">{user.displayName}</p>
      <p className="m-0 text-sm text-graphite">{roleLine}</p>
      <p className="mt-3 text-sm font-bold text-azul-700">
        {authViaLabel(t, user)}
      </p>

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

      <Card lift={false} className="mt-6 p-5">
        <h2 className="m-0 text-lg font-extrabold text-marino">
          {t("account.prefs")}
        </h2>
        <form
          onSubmit={(e) => void savePrefs(e)}
          className="mt-4 flex max-w-md flex-col gap-3"
        >
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
          <div>
            <p className="m-0 mb-2 text-sm font-bold">{t("a11y.prefs")}</p>
            <PrefsBar
              variant="onLight"
              hideLanguage
              contrast={prefs.contrast}
              textStep={prefs.textStep}
              onContrast={() => prefs.setContrast((v) => !v)}
              onTextCycle={prefs.cycleText}
            />
          </div>
          <Button type="submit" className="self-start">
            {t("admin.save")}
          </Button>
        </form>
      </Card>

      <div className="mt-8">
        <Button
          type="button"
          variant="secondary"
          data-testid="staff-account-logout"
          onClick={doLogout}
        >
          {t("account.logout")}
        </Button>
      </div>
    </>
  );

  if (inAdmin) {
    return (
      <AdminShell active="conta" pageTitle={t("staffAccount.title")}>
        {content}
      </AdminShell>
    );
  }

  return (
    <main className="pa-page-read pb-28 md:pb-12">
      <h1 className="pa-h1 m-0">{t("staffAccount.title")}</h1>
      {content}
    </main>
  );
}
