import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { REPO_URL, repoBlobUrl } from "../lib/repo-url";

/** Rodapé plataforma (páxinas sen concello: deputación, inicio). */
export function PlatformFooter() {
  const { t } = useTranslation();
  const installHref = repoBlobUrl("docs/INSTALACION.md");
  const opsHref = repoBlobUrl("docs/OPERACION.md");
  const licenseHref = repoBlobUrl("LICENSE");
  return (
    <footer className="mt-auto border-t border-line bg-white">
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-5 gap-y-2 px-6 py-[18px] text-sm text-azul-700 md:px-8">
        <nav aria-label={t("home.footerNav")} className="flex flex-wrap gap-x-5 gap-y-2">
          <Link to="/legal/privacidade" className="no-underline hover:underline">
            {t("legal.privacy")}
          </Link>
          <Link to="/legal/accesibilidade" className="no-underline hover:underline">
            {t("legal.a11y")}
          </Link>
          <Link to="/legal/aviso" className="no-underline hover:underline">
            {t("legal.notice")}
          </Link>
          {REPO_URL ? (
            <a
              href={REPO_URL}
              className="no-underline hover:underline"
              rel="noopener noreferrer"
              target="_blank"
            >
              {t("nav.sourceCode")}
            </a>
          ) : null}
          {installHref ? (
            <a
              href={installHref}
              className="no-underline hover:underline"
              rel="noopener noreferrer"
              target="_blank"
            >
              {t("nav.installDocs")}
            </a>
          ) : null}
          {opsHref ? (
            <a
              href={opsHref}
              className="no-underline hover:underline"
              rel="noopener noreferrer"
              target="_blank"
            >
              {t("nav.opsDocs")}
            </a>
          ) : null}
          {licenseHref ? (
            <a
              href={licenseHref}
              className="no-underline hover:underline"
              rel="noopener noreferrer"
              target="_blank"
            >
              {t("nav.license")}
            </a>
          ) : null}
          <a href="/api/docs" className="no-underline hover:underline">
            API
          </a>
        </nav>
        <span className="ml-auto text-graphite">EUPL-1.2 · Pista Aberta</span>
      </div>
    </footer>
  );
}
