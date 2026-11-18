import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <main className="pa-page">
      <h1 className="pa-h1">404</h1>
      <p className="mt-2 text-graphite">{t("common.notFound")}</p>
      <Link to="/" className="pa-btn-primary mt-6 inline-flex">
        {t("nav.home")}
      </Link>
    </main>
  );
}
