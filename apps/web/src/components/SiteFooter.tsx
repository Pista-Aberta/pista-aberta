import { Link, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { REPO_URL, repoBlobUrl } from "../lib/repo-url";

export function SiteFooter() {
  const { t } = useTranslation();
  const { slug } = useParams();
  const loc = useLocation();
  const m = slug ?? loc.pathname.match(/^\/c\/([^/]+)/)?.[1];
  if (
    !m ||
    loc.pathname === "/acceso" ||
    /^\/c\/[^/]+\/acceso\/?$/.test(loc.pathname)
  ) {
    return null;
  }
  const installHref = repoBlobUrl("docs/INSTALACION.md");
  const opsHref = repoBlobUrl("docs/OPERACION.md");
  const licenseHref = repoBlobUrl("LICENSE");
  return (
    <footer className="mt-auto border-t border-line bg-white">
      <div className="mx-auto flex max-w-[1200px] flex-wrap gap-x-6 gap-y-2 px-4 py-6 text-sm text-graphite md:px-8">
        <Link to={`/c/${m}/contacto`} className="underline">
          {t("nav.contact")}
        </Link>
        <Link to={`/c/${m}/legal/privacidade`} className="underline">
          {t("legal.privacy")}
        </Link>
        <Link to={`/c/${m}/legal/accesibilidade`} className="underline">
          {t("legal.a11y")}
        </Link>
        <Link to={`/c/${m}/legal/aviso`} className="underline">
          {t("legal.notice")}
        </Link>
        <Link to={`/c/${m}/legal/cookies`} className="underline">
          {t("legal.cookies")}
        </Link>
        <Link to={`/c/${m}/datos-abertos`} className="underline">
          {t("nav.openData")}
        </Link>
        <Link to={`/c/${m}/incidencia`} className="underline">
          {t("muni.reportIncident")}
        </Link>
        {REPO_URL ? (
          <a
            href={REPO_URL}
            className="underline"
            rel="noopener noreferrer"
            target="_blank"
          >
            {t("nav.sourceCode")}
          </a>
        ) : null}
        {installHref ? (
          <a
            href={installHref}
            className="underline"
            rel="noopener noreferrer"
            target="_blank"
          >
            {t("nav.installDocs")}
          </a>
        ) : null}
        {opsHref ? (
          <a
            href={opsHref}
            className="underline"
            rel="noopener noreferrer"
            target="_blank"
          >
            {t("nav.opsDocs")}
          </a>
        ) : null}
        {licenseHref ? (
          <a
            href={licenseHref}
            className="underline"
            rel="noopener noreferrer"
            target="_blank"
          >
            {t("nav.license")}
          </a>
        ) : null}
        <a href="/api/docs" className="underline">
          API
        </a>
        <span className="ml-auto">EUPL-1.2 · Pista Aberta</span>
      </div>
    </footer>
  );
}
