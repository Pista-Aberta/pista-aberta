import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useSession } from "../context/SessionContext";
import { resolveSingleMuni, singleMuniSyncHint } from "../lib/single-muni";
import { BrandShellHeader } from "./BrandShellHeader";
import { demoSamlLoginAs } from "../lib/demo-saml-login";
import { fetchPublicConfig } from "../lib/public-config";

/** Asistente de alta: só superadmin Deputación (REVISION-29 Y14). */
export function AltaConcelloGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { user, loading } = useSession();
  const [singleMuni, setSingleMuni] = useState<string | null>(singleMuniSyncHint());
  const [demoMode, setDemoMode] = useState(false);

  useEffect(() => {
    void resolveSingleMuni().then(setSingleMuni);
  }, []);

  useEffect(() => {
    void fetchPublicConfig().then((c) => setDemoMode(!!c.demo));
  }, []);

  if (singleMuni) {
    return <Navigate to={`/c/${singleMuni}`} replace />;
  }

  if (loading) {
    return (
      <main className="pa-page">
        <p className="text-graphite">…</p>
      </main>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-paper">
        <BrandShellHeader
          homeTo="/"
          eyebrow={t("chrome.municipalSports")}
          brandTitle={t("brand")}
          tone="light"
        />
        <main className="pa-page max-w-lg">
          <h1 className="pa-h1">Alta dun concello</h1>
          <p className="mt-2 text-graphite">
            O asistente de alta está reservado á Deputación. Precisas entrar co perfil
            «Deputación» para crear un concello novo.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            {demoMode ? (
              <button
                type="button"
                className="pa-btn-primary"
                onClick={() => demoSamlLoginAs("deputacion", "/alta-concello")}
              >
                {t("alta.enterAsDeputacion")}
              </button>
            ) : (
              <Link
                to={`/acceso?returnTo=${encodeURIComponent("/alta-concello")}&perfil=entidade`}
                className="pa-btn-primary inline-flex"
              >
                {t("alta.enterAsDeputacion")}
              </Link>
            )}
            <Link to="/" className="pa-btn-secondary inline-flex">
              Inicio
            </Link>
          </div>
        </main>
      </div>
    );
  }

  if (user.role !== "superadmin") {
    return (
      <div className="min-h-screen bg-paper">
        <BrandShellHeader
          homeTo="/"
          eyebrow={t("chrome.municipalSports")}
          brandTitle={t("brand")}
          tone="light"
        />
        <main className="pa-page max-w-lg">
          <h1 className="pa-h1">Alta dun concello</h1>
          <p className="mt-2 text-graphite">
            O teu perfil non ten acceso ao asistente de alta. En demo, escolle
            «Deputación» na barra amarela.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link to="/deputacion" className="pa-btn-primary inline-flex">
              Vista Deputación
            </Link>
            <Link to="/" className="pa-btn-secondary inline-flex">
              Inicio
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return <>{children}</>;
}
