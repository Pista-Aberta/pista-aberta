import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Role } from "@pista-aberta/shared";
import { api } from "../lib/api";
import { accesoPath } from "../lib/acceso";
import { demoSamlLoginAs } from "../lib/demo-saml-login";
import { fetchPublicConfig } from "../lib/public-config";
import { homePathForRole } from "../lib/roles";
import { useSession } from "../context/SessionContext";
import { BrandShellHeader } from "../components/BrandShellHeader";
import { ReadingPrefsAaControl } from "../components/ReadingPrefsAaControl";

const API = import.meta.env.VITE_API_URL ?? "";

type InviteInfo = {
  token: string;
  municipalityName: string;
  municipalitySlug: string;
  role: Role;
  expiresAt: string;
  used: boolean;
  expired: boolean;
};

function muniLabel(name: string): string {
  return name.replace(/^Concello de\s+/i, "").trim() || name;
}

export function ConvitePage() {
  const { t } = useTranslation();
  const { token } = useParams();
  const nav = useNavigate();
  const { user, refreshUser } = useSession();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [demoMode, setDemoMode] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    void api
      .conviteInfo(token)
      .then((r) => setInfo(r.data))
      .catch(() => setErr(t("convite.notFound")))
      .finally(() => setLoading(false));
  }, [token, t]);

  useEffect(() => {
    void fetchPublicConfig()
      .then((c) => setDemoMode(!!c.demo))
      .catch(() => setDemoMode(false));
  }, []);

  const returnToConvite = token ? `/convite/${token}` : "/";

  const certHref = info
    ? accesoPath(info.municipalitySlug, {
        returnTo: returnToConvite,
        perfil: "entidade",
      })
    : "/acceso/certificado";

  const startClave = async () => {
    if (!token) return;
    setErr(null);
    if (demoMode) {
      demoSamlLoginAs("cidada", returnToConvite);
      return;
    }
    const res = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ method: "saml", returnTo: returnToConvite }),
    });
    const data = (await res.json()) as { redirectUrl?: string };
    if (data.redirectUrl) {
      window.location.href = data.redirectUrl;
      return;
    }
    setErr(t("convite.acceptError"));
  };

  const demoEnterAsInvitee = async () => {
    if (!token || !info) return;
    setErr(null);
    setBusy(true);
    try {
      await api.conviteDemoAccept(token);
      await refreshUser();
      /* REVISION-32 C1: panel do concello do convite (non o rol «casa»). */
      nav(homePathForRole(info.role, info.municipalitySlug));
    } catch (e) {
      const code = e instanceof Error ? e.message : "error";
      if (code === "invite_used") setErr(t("convite.used"));
      else if (code === "invite_expired") setErr(t("convite.expired"));
      else if (code === "nif_required") setErr(t("convite.nifRequired"));
      else setErr(t("convite.acceptError"));
    } finally {
      setBusy(false);
    }
  };

  const accept = async () => {
    if (!token || !info) return;
    setErr(null);
    try {
      await api.conviteAccept(token);
      await refreshUser();
      /* REVISION-32 C1: panel do concello do convite (non o rol «casa»). */
      nav(homePathForRole(info.role, info.municipalitySlug));
    } catch (e) {
      const code = e instanceof Error ? e.message : "error";
      if (code === "invite_wrong_person") {
        setErr(t("convite.wrongPerson"));
      } else if (code === "invite_used") {
        setErr(t("convite.used"));
      } else if (code === "invite_expired") {
        setErr(t("convite.expired"));
      } else if (code === "nif_required") {
        setErr(t("convite.nifRequired"));
      } else {
        setErr(t("convite.acceptError"));
      }
    }
  };

  if (loading) {
    return (
      <main className="mx-auto max-w-lg px-4 py-12">
        <p className="text-sm text-graphite">{t("common.loading")}</p>
      </main>
    );
  }

  if (!info || err === t("convite.notFound")) {
    return (
      <main className="mx-auto max-w-lg px-4 py-12">
        <h1 className="text-xl font-extrabold text-marino">{t("convite.title")}</h1>
        <p className="mt-4 text-sm font-bold text-erro" role="alert">
          {err ?? t("convite.notFound")}
        </p>
      </main>
    );
  }

  const blocked = info.used || info.expired;

  return (
    <div className="min-h-screen bg-paper text-ink">
      <BrandShellHeader
        homeTo="/"
        eyebrow={t("chrome.municipalSports")}
        brandTitle={
          info.municipalityName ? muniLabel(info.municipalityName) : t("brand")
        }
        tone="light"
      />
      <main className="mx-auto max-w-lg px-4 py-12">
      <div className="mb-4 flex justify-end sm:hidden">
        <ReadingPrefsAaControl variant="onLight" />
      </div>
      <h1 className="text-xl font-extrabold text-marino">{t("convite.title")}</h1>
      <p className="mt-4 text-sm text-ink">
        {t("convite.body", {
          muni: muniLabel(info.municipalityName),
          role: t(`convite.role.${info.role}`, { defaultValue: info.role }),
        })}
      </p>
      {blocked ? (
        <p className="mt-4 text-sm font-bold text-erro" role="alert">
          {info.used ? t("convite.used") : t("convite.expired")}
        </p>
      ) : null}
      {!blocked && !user ? (
        <div className="mt-6 flex flex-col gap-3">
          {demoMode ? (
            <>
              <button
                type="button"
                className="pa-btn-primary"
                disabled={busy}
                data-testid="convite-demo-enter"
                onClick={() => void demoEnterAsInvitee()}
              >
                {t("convite.enterAsPerson")}
              </button>
              <p className="text-sm text-graphite">{t("convite.demoOnlyHint")}</p>
            </>
          ) : null}
          <Link className="pa-btn-secondary text-center no-underline" to={certHref}>
            {t("convite.loginCert")}
          </Link>
          <button
            type="button"
            className="pa-btn-secondary"
            data-testid="convite-clave"
            onClick={() => void startClave()}
          >
            {t("convite.loginClave")}
          </button>
        </div>
      ) : null}
      {!blocked && user ? (
        <div className="mt-6">
          <p className="text-sm text-graphite">
            {t("convite.loggedAs", { name: user.displayName })}
          </p>
          <button type="button" className="pa-btn-primary mt-4" onClick={() => void accept()}>
            {t("convite.acceptBtn")}
          </button>
        </div>
      ) : null}
      {err && err !== t("convite.notFound") ? (
        <p className="mt-4 text-sm font-bold text-erro" role="alert">
          {err}
        </p>
      ) : null}
    </main>
    </div>
  );
}
