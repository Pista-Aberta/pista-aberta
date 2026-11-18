import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BackLink } from "../components/BackLink";
import { accesoPath, slugFromReturnTo } from "../lib/acceso";

/** Axuda: como obter certificado FNMT / DNIe (CERTIFICADO-DIXITAL.md). */
export function CertificadoInfoPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const returnTo = params.get("returnTo") ?? "/";
  const slug = slugFromReturnTo(returnTo);
  const accesoTo = slug
    ? accesoPath(slug, { returnTo })
    : `/acceso?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <main className="pa-page max-w-3xl">
      <BackLink to={accesoTo}>{t("login.titleNew")}</BackLink>

      <h1 className="pa-h1 mt-4">{t("login.cert.helpLink")}</h1>
      <div className="mt-6 space-y-4 text-base leading-relaxed text-graphite">
        <p>{t("login.certInfo.p1")}</p>
        <p>{t("login.certInfo.p2")}</p>
        <p>{t("login.certInfo.p3")}</p>
      </div>

      <ul className="mt-8 space-y-2 text-sm">
        <li>
          <a
            href="https://www.sede.fnmt.gob.es/certificados"
            target="_blank"
            rel="noreferrer"
            className="font-bold underline"
          >
            {t("login.cert.help.fnmt")}
          </a>
        </li>
        <li>
          <a
            href="https://www.dnielectronico.es"
            target="_blank"
            rel="noreferrer"
            className="font-bold underline"
          >
            {t("login.cert.help.dnie")}
          </a>
        </li>
      </ul>

      <p className="mt-10">
        <Link to={accesoTo} className="pa-btn-primary">
          {t("login.certInfo.back")}
        </Link>
      </p>
    </main>
  );
}
