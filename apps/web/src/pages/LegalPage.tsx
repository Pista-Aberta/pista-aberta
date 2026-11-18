import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Municipality } from "@pista-aberta/shared";
import { api } from "../lib/api";

const TABS = ["privacidade", "accesibilidade", "aviso", "cookies"] as const;

export function LegalPage({ tab }: { tab: (typeof TABS)[number] }) {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const { t } = useTranslation();
  const [muni, setMuni] = useState<Municipality | null>(null);

  useEffect(() => {
    void api.info(slug).then((r) => setMuni(r.data)).catch(() => setMuni(null));
  }, [slug]);

  const legal = muni?.settings.legal;
  const titular = legal?.titular?.trim() || muni?.name || t("legal.fallbackMuni");
  const nif = legal?.nif?.trim() || "";
  const address = legal?.address?.trim() || "";
  const email = legal?.email?.trim() || "";
  const dpd = legal?.dpd?.trim() || "";

  /* REVISION-19 B2: se falta un dato, non amosar a frase (nunca «—»). */
  /* REVISION-46 X6: prazo concreto = Días para anonimizar. */
  const days =
    typeof muni?.settings?.anonymizeAfterDays === "number"
      ? muni.settings.anonymizeAfterDays
      : 90;
  const privacy: string[] = [
    t("legal.privacyP1", { titular }),
    t("legal.privacyP2", { days }),
    t("legal.privacyOpenMatchP1"),
    t("legal.privacyOpenMatchP2"),
  ];
  if (dpd && email) {
    privacy.push(t("legal.privacyP3", { dpd, email }));
  } else if (dpd) {
    privacy.push(t("legal.privacyP3DpdOnly", { dpd, defaultValue: `DPD: ${dpd}.` }));
  } else if (email) {
    privacy.push(t("legal.privacyP3EmailOnly", { email, defaultValue: `Contacto: ${email}.` }));
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

  const notice: string[] = [];
  if (nif && address) {
    notice.push(t("legal.noticeP1", { titular, nif, address }));
  } else if (nif) {
    notice.push(
      t("legal.noticeP1NifOnly", {
        titular,
        nif,
        defaultValue: `Titular: ${titular} (NIF ${nif}). Software: EUPL-1.2. Datos abertos: CC BY 4.0.`,
      }),
    );
  } else if (address) {
    notice.push(
      t("legal.noticeP1AddressOnly", {
        titular,
        address,
        defaultValue: `Titular: ${titular} (enderezo ${address}). Software: EUPL-1.2. Datos abertos: CC BY 4.0.`,
      }),
    );
  } else {
    notice.push(
      t("legal.noticeP1TitularOnly", {
        titular,
        defaultValue: `Titular: ${titular}. Software: EUPL-1.2. Datos abertos: CC BY 4.0.`,
      }),
    );
  }
  notice.push(t("legal.noticeP2"));

  const bodies: Record<(typeof TABS)[number], string[]> = {
    privacidade: privacy,
    accesibilidade: a11y,
    aviso: notice,
    cookies: [t("legal.cookiesP1"), t("legal.cookiesP2")],
  };

  return (
    <main className="pa-page max-w-3xl">
      <h1 className="pa-h1">{t(`legal.${tab === "privacidade" ? "privacy" : tab === "accesibilidade" ? "a11y" : tab === "aviso" ? "notice" : "cookies"}`)}</h1>
      <nav
        aria-label={t("legal.navLabel", { defaultValue: "Legal" })}
        className="mt-6 flex flex-wrap gap-2 border-b border-line pb-2"
      >
        {TABS.map((k) => (
          <Link
            key={k}
            to={`/c/${slug}/legal/${k}`}
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
      {(legal?.titular || legal?.nif || legal?.email) && (
        <dl className="mt-4 grid gap-1 text-sm text-graphite sm:grid-cols-2">
          <div>
            <dt className="inline font-bold text-ink">{t("admin.brandingLegal.titular")}: </dt>
            <dd className="inline">{titular}</dd>
          </div>
          {nif ? (
            <div>
              <dt className="inline font-bold text-ink">{t("admin.brandingLegal.nif")}: </dt>
              <dd className="inline">{nif}</dd>
            </div>
          ) : null}
          {address ? (
            <div className="sm:col-span-2">
              <dt className="inline font-bold text-ink">{t("admin.brandingLegal.address")}: </dt>
              <dd className="inline">{address}</dd>
            </div>
          ) : null}
          {email ? (
            <div>
              <dt className="inline font-bold text-ink">{t("admin.brandingLegal.email")}: </dt>
              <dd className="inline">{email}</dd>
            </div>
          ) : null}
          {dpd ? (
            <div>
              <dt className="inline font-bold text-ink">{t("admin.brandingLegal.dpd")}: </dt>
              <dd className="inline">{dpd}</dd>
            </div>
          ) : null}
        </dl>
      )}
      <div className="pa-card mt-6 space-y-4 p-6 text-[15px] leading-relaxed">
        {bodies[tab].map((p) => (
          <p key={p.slice(0, 40)}>{p}</p>
        ))}
      </div>
    </main>
  );
}
