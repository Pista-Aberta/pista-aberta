import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BackLink } from "../components/BackLink";

/**
 * Lectura fácil — páxina estática curta (REDESENO D).
 */
export function EasyReadPage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const { t } = useTranslation();

  const steps = [
    { icon: "1", title: t("easy.step1Title"), body: t("easy.step1Body") },
    { icon: "2", title: t("easy.step2Title"), body: t("easy.step2Body") },
    { icon: "3", title: t("easy.step3Title"), body: t("easy.step3Body") },
    { icon: "4", title: t("easy.step4Title"), body: t("easy.step4Body") },
  ];

  return (
    <main className="pa-page-read">
      <BackLink to={`/c/${slug}`}>{t("nav.home")}</BackLink>

      <h1 className="pa-h1 mt-4">{t("easy.title")}</h1>
      <p className="mt-3 text-lg text-graphite">{t("easy.lead")}</p>

      <ol className="mt-8 space-y-5">
        {steps.map((s) => (
          <li
            key={s.icon}
            className="flex gap-4 rounded-card border border-line bg-white p-5"
          >
            <span
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-btn bg-azul text-xl font-bold text-white"
              aria-hidden
            >
              {s.icon}
            </span>
            <span>
              <strong className="block text-xl">{s.title}</strong>
              <span className="mt-1 block text-base text-graphite">{s.body}</span>
            </span>
          </li>
        ))}
      </ol>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link to={`/c/${slug}/acceso?returnTo=/c/${slug}`} className="pa-btn-primary">
          {t("nav.identify")}
        </Link>
        <Link to={`/c/${slug}`} className="pa-btn-secondary">
          {t("nav.home")}
        </Link>
      </div>
    </main>
  );
}
