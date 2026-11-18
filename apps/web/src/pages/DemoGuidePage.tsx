import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { demoSamlLoginAs } from "../lib/demo-saml-login";
import { resolveDemoPrimarySlug } from "../lib/demo-defaults";
import { accesoPath } from "../lib/acceso";
import { fetchPublicConfig } from "../lib/public-config";
import { api } from "../lib/api";

type StepKey =
  | "cert"
  | "vecina"
  | "vecino2"
  | "partidos"
  | "espera"
  | "concello"
  | "club"
  | "conserxe"
  | "deputacion";

type Step = {
  key: StepKey;
  /** SAML demo user key; null = certificado real */
  persona: string | null;
  /** Concello do RelayState: primary | secundario | null (deputación) */
  slugMode: "primary" | "secundario" | null;
  enterLabelKey: string;
  titleKey: string;
  bodyKey: string;
};

const STEPS: Step[] = [
  {
    key: "cert",
    persona: null,
    slugMode: "primary",
    enterLabelKey: "demo.step1Enter",
    titleKey: "demo.step1Title",
    bodyKey: "demo.step1Body",
  },
  {
    key: "vecina",
    persona: "cidada",
    slugMode: "primary",
    enterLabelKey: "demo.step2Enter",
    titleKey: "demo.step2Title",
    bodyKey: "demo.step2Body",
  },
  {
    key: "vecino2",
    persona: "cidada",
    slugMode: "secundario",
    enterLabelKey: "demo.step2SecondaryEnter",
    titleKey: "demo.step2SecondaryTitle",
    bodyKey: "demo.step2SecondaryBody",
  },
  {
    key: "partidos",
    persona: "cidada",
    slugMode: "primary",
    enterLabelKey: "demo.step2bEnter",
    titleKey: "demo.step2bTitle",
    bodyKey: "demo.step2bBody",
  },
  {
    key: "espera",
    persona: "cidada",
    slugMode: "primary",
    enterLabelKey: "demo.step2cEnter",
    titleKey: "demo.step2cTitle",
    bodyKey: "demo.step2cBody",
  },
  {
    key: "concello",
    persona: "admin",
    slugMode: "primary",
    enterLabelKey: "demo.step3Enter",
    titleKey: "demo.step3Title",
    bodyKey: "demo.step3Body",
  },
  {
    key: "club",
    persona: "club",
    slugMode: "primary",
    enterLabelKey: "demo.step4Enter",
    titleKey: "demo.step4Title",
    bodyKey: "demo.step4Body",
  },
  {
    key: "conserxe",
    persona: "staff",
    slugMode: "primary",
    enterLabelKey: "demo.step5Enter",
    titleKey: "demo.step5Title",
    bodyKey: "demo.step5Body",
  },
  {
    key: "deputacion",
    persona: "deputacion",
    slugMode: null,
    enterLabelKey: "demo.step6Enter",
    titleKey: "demo.step6Title",
    bodyKey: "demo.step6Body",
  },
];

function stepReturn(key: StepKey, slug: string | null): string {
  if (!slug) {
    return "/deputacion";
  }
  switch (key) {
    case "cert":
    case "vecina":
    case "vecino2":
      return `/c/${slug}`;
    case "partidos":
      return `/c/${slug}/partidos-abertos`;
    case "espera":
      return `/c/${slug}/reservar`;
    case "concello":
      return `/c/${slug}/admin`;
    case "club":
      return `/c/${slug}/clubs`;
    case "conserxe":
      return `/c/${slug}/conserxeria`;
    case "deputacion":
      return "/deputacion";
    default: {
      const _exhaustive: never = key;
      return _exhaustive;
    }
  }
}

/** Guía do xurado — 9 pasos · demo baleira (Exemplo + Concello Secundario). */
export function DemoGuidePage() {
  const { t } = useTranslation();
  const [demoMode, setDemoMode] = useState(
    () => import.meta.env.VITE_PA_DEMO === "1",
  );
  const [primarySlug, setPrimarySlug] = useState<string | null>(null);
  const [portoSlug, setPortoSlug] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [cfg, slug, munis] = await Promise.all([
        fetchPublicConfig(),
        resolveDemoPrimarySlug(),
        api.municipalities().catch(() => ({ data: [] as { slug: string }[] })),
      ]);
      if (cancelled) return;
      setDemoMode(!!cfg.demo || import.meta.env.VITE_PA_DEMO === "1");
      /* Orde da API: 1º = principal, 2º = secundario (demo-setup ou semente). */
      const slugs = (munis.data ?? []).map((m) => m.slug).filter(Boolean);
      setPrimarySlug(slugs[0] ?? slug);
      setPortoSlug(slugs[1] ?? null);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const noMunis = ready && !primarySlug;

  function slugForStep(step: Step): string | null {
    if (step.slugMode === null) return null;
    if (step.slugMode === "secundario") {
      return portoSlug ?? primarySlug;
    }
    return primarySlug;
  }

  return (
    <main className="pa-page max-w-3xl">
      <p className="text-sm font-bold text-graphite">Pista Aberta · GOBTEC</p>
      <h1 className="pa-h1 mt-1">{t("demo.guideTitle")}</h1>
      <p className="mt-3 text-graphite">{t("demo.guideIntro")}</p>

      {noMunis ? (
        <section className="mt-8 pa-card p-4" role="status">
          <p className="font-bold text-lg">{t("demo.noMunicipalities")}</p>
          <p className="mt-2 text-sm text-graphite">
            {t("demo.noMunicipalitiesHint")}
          </p>
          <div className="mt-3">
            <button
              type="button"
              className="pa-btn-secondary"
              onClick={() => demoSamlLoginAs("deputacion", "/deputacion")}
            >
              {t("demo.step6Enter")}
            </button>
          </div>
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className="pa-h2">{t("demo.peopleTitle")}</h2>
        <ol className="mt-4 space-y-4">
          {STEPS.map((s, i) => {
            const slug = slugForStep(s);
            const returnTo = stepReturn(s.key, slug);

            return (
              <li key={s.key} className="pa-card p-4">
                <p className="font-bold text-lg">
                  {i + 1}. {t(s.titleKey)}
                </p>
                <p className="mt-2 text-sm text-graphite">{t(s.bodyKey)}</p>
                {s.key === "vecina" ? (
                  <p className="mt-2 text-sm text-graphite">
                    {t("demo.stepInstallHint")}
                  </p>
                ) : null}
                <div className="mt-3">
                  {noMunis && s.key !== "deputacion" ? (
                    <p className="text-sm text-graphite">
                      {t("demo.noMunicipalities")}
                    </p>
                  ) : s.persona ? (
                    <button
                      type="button"
                      className="pa-btn-secondary"
                      onClick={() => demoSamlLoginAs(s.persona!, returnTo)}
                    >
                      {t(s.enterLabelKey)}
                    </button>
                  ) : primarySlug ? (
                    <Link
                      className="pa-btn-secondary inline-flex"
                      to={accesoPath(primarySlug, { returnTo })}
                    >
                      {t(s.enterLabelKey)}
                    </Link>
                  ) : (
                    <p className="text-sm text-graphite">
                      {t("demo.stepNeedCert")}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="mt-8">
        <h2 className="pa-h2">{t("demo.linksTitle")}</h2>
        <ul className="mt-3 list-inside list-disc space-y-1 text-sm">
          <li>
            <Link className="font-bold underline" to="/acceso">
              {t("nav.login")}
            </Link>
          </li>
          <li>
            <Link className="font-bold underline" to="/acceso/certificado">
              {t("demo.certHelp")}
            </Link>
          </li>
          {primarySlug ? (
            <li>
              <Link className="font-bold underline" to={`/c/${primarySlug}`}>
                {t("demo.primaryPortalLink")}
              </Link>
            </li>
          ) : null}
          {portoSlug ? (
            <li>
              <Link className="font-bold underline" to={`/c/${portoSlug}`}>
                {t("demo.portoPortalLink")}
              </Link>
            </li>
          ) : null}
          <li>
            <Link className="font-bold underline" to="/deputacion">
              {t("demo.deputacionLink")}
            </Link>
          </li>
          <li>
            <a className="font-bold underline" href="/api/docs">
              API docs
            </a>
            {" · "}
            <a className="font-bold underline" href="/api/openapi.json">
              OpenAPI 3.1
            </a>
          </li>
          {primarySlug ? (
            <li>
              <Link
                className="font-bold underline"
                to={`/c/${primarySlug}/legal/privacidade`}
              >
                RXPD / privacidade
              </Link>
            </li>
          ) : null}
          {demoMode ? (
            <li>
              <a
                className="font-bold underline"
                href="/correo/"
                target="_blank"
                rel="noreferrer"
              >
                {t("demo.mailLink")}
              </a>
            </li>
          ) : null}
        </ul>
      </section>
    </main>
  );
}
