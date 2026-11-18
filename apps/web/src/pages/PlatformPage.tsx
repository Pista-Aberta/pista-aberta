import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

export function PlatformPage() {
  const { t } = useTranslation();
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="pa-h1">{t("platform.title")}</h1>
      <p className="mt-3 text-lg text-graphite">{t("platform.body")}</p>
      <pre className="pa-card mt-6 overflow-x-auto p-4 text-sm">{`cp .env.example .env
npm install
docker compose up --build
# ou: npm run dev:api & npm run dev:web`}</pre>
      <p className="mt-4 text-sm text-graphite">{t("platform.license")}</p>
      <Link to="/" className="pa-btn-primary mt-6 inline-flex">
        {t("nav.home")}
      </Link>
    </main>
  );
}
