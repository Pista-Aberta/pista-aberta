/**
 * REVISION-37 I5 / REVISION-38 K5 — privacidade da plataforma / Deputación / concello único.
 * Sen correo fixo (contacto@pistaaberta.com).
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

const TABS = ["privacidade", "accesibilidade", "aviso", "cookies"] as const;

type PlatformLegal = {
  titular: string | null;
  email: string | null;
  mode: "deputacion" | "concello" | "none";
};

export function PlatformLegalPage({ tab }: { tab: (typeof TABS)[number] }) {
  const { t } = useTranslation();
  const [legal, setLegal] = useState<PlatformLegal>({
    titular: null,
    email: null,
    mode: "none",
  });

  useEffect(() => {
    void fetch("/api/legal/platform")
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (j: {
          data?: {
            titular?: string | null;
            email?: string | null;
            mode?: PlatformLegal["mode"];
          };
        } | null) => {
          setLegal({
            titular: j?.data?.titular?.trim() || null,
            email: j?.data?.email?.trim() || null,
            mode: j?.data?.mode ?? "none",
          });
        },
      )
      .catch(() => undefined);
  }, []);

  const titular =
    legal.titular ||
    (legal.mode === "none" ? "Pista Aberta" : t("legal.fallbackMuni"));
  const email = legal.email;

  /* REVISION-39 L14: plataforma / Deputación → «organización», non «concello». */
  /* Alineado co defecto de LegalPage (anonymizeAfterDays = 90). */
  const days = 90;
  const privacy: string[] = [
    t("legal.privacyP1", { titular }),
    legal.mode === "deputacion" || legal.mode === "none"
      ? t("legal.privacyP2Org", { days })
      : t("legal.privacyP2", { days }),
  ];
  if (email) {
    privacy.push(t("legal.platformPrivacyContact", { email }));
  } else {
    privacy.push(t("legal.platformPrivacyNoEmail"));
  }

  const a11y: string[] = [
    t("legal.a11yP1"),
    t("legal.a11yP2"),
    t("legal.a11yP3"),
  ];
  if (email) {
    a11y.push(t("legal.a11yP4", { email }));
  }
  a11y.push(t("legal.a11yP5"));

  const bodies: Record<(typeof TABS)[number], string[]> = {
    privacidade: privacy,
    accesibilidade: a11y,
    aviso: [
      t("legal.noticeP1TitularOnly", {
        titular,
        defaultValue: `Titular: ${titular}. Software: EUPL-1.2.`,
      }),
      t("legal.noticeP2"),
    ],
    cookies: [t("legal.cookiesP1"), t("legal.cookiesP2")],
  };

  return (
    <main className="pa-page mx-auto max-w-3xl px-4 py-8">
      <p className="m-0 text-sm font-bold text-graphite">Pista Aberta</p>
      <h1 className="pa-h1 mt-2">
        {t(
          `legal.${tab === "privacidade" ? "privacy" : tab === "accesibilidade" ? "a11y" : tab === "aviso" ? "notice" : "cookies"}`,
        )}
      </h1>
      <p className="mt-2 text-sm text-graphite">
        {t("legal.platformResponsible", {
          titular,
          defaultValue: `Responsable: ${titular}`,
        })}
      </p>
      <nav
        aria-label={t("legal.navLabel", { defaultValue: "Legal" })}
        className="mt-6 flex flex-wrap gap-2 border-b border-line pb-2"
      >
        {TABS.map((k) => (
          <Link
            key={k}
            to={`/legal/${k}`}
            aria-current={tab === k ? "page" : undefined}
            className={`min-h-11 px-3 py-2 text-sm font-bold ${
              tab === k ? "border-b-[3px] border-ink" : "text-graphite"
            }`}
          >
            {t(
              k === "privacidade"
                ? "legal.privacy"
                : k === "accesibilidade"
                  ? "legal.a11y"
                  : k === "aviso"
                    ? "legal.notice"
                    : "legal.cookies",
            )}
          </Link>
        ))}
      </nav>
      <div className="mt-6 space-y-4 text-[15px] leading-relaxed">
        {bodies[tab].map((p) => (
          <p key={p.slice(0, 48)}>{p}</p>
        ))}
      </div>
    </main>
  );
}
