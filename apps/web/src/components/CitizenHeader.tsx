import { useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "../context/SessionContext";
import { BrandShellHeader } from "./BrandShellHeader";
import { apiX } from "../lib/api-complete";

function slugFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/c\/([^/]+)/);
  return m?.[1] ?? null;
}

export function CitizenHeader() {
  const { t } = useTranslation();
  const loc = useLocation();
  const { setMunicipalitySlug, user, municipalityMissing } = useSession();
  const slug = slugFromPath(loc.pathname);
  const muni = slug;
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    setMunicipalitySlug(slug ?? null);
  }, [slug, setMunicipalitySlug]);

  useEffect(() => {
    if (!user || user.role !== "citizen" || !muni || municipalityMissing) {
      setUnread(0);
      return;
    }
    void apiX
      .notices(muni)
      .then((r) => setUnread(r.data.filter((n) => !n.read).length))
      .catch(() => setUnread(0));
  }, [user, muni, loc.pathname, municipalityMissing]);

  const hideChrome =
    loc.pathname === "/acceso" ||
    loc.pathname === "/" ||
    /^\/c\/[^/]+\/acceso\/?$/.test(loc.pathname);
  if (hideChrome || !muni) return null;

  /* REVISION-34 F7: concello inexistente → só marca + Inicio. */
  if (municipalityMissing) {
    return (
      <BrandShellHeader
        homeTo="/"
        eyebrow={t("chrome.sportsFacilities")}
        nav={[{ to: "/", label: t("nav.home"), active: true }]}
        navAriaLabel={t("nav.home")}
        tone="light"
      />
    );
  }

  const nav = [
    {
      to: `/c/${muni}`,
      label: t("nav.home"),
      active: loc.pathname === `/c/${muni}`,
    },
    {
      to: `/c/${muni}/reservar`,
      label: t("nav.reserve"),
      active: loc.pathname.includes("/reservar") || loc.pathname.includes("/instalacions"),
    },
    {
      to: `/c/${muni}/actividades`,
      label: t("nav.actividades"),
      active: loc.pathname.includes("/actividades"),
    },
    {
      to: `/c/${muni}/partidos-abertos`,
      label: t("nav.openMatches"),
      active: loc.pathname.includes("/partidos-abertos"),
    },
    {
      to: `/c/${muni}/reservas`,
      label: t("nav.myBookings"),
      active: loc.pathname.includes("/reservas") || loc.pathname.includes("/reserva/"),
    },
    {
      to: `/`,
      label: t("nav.changeMuni"),
      active: false,
      hideBelowWide: true,
    },
    {
      to: `/c/${muni}/contacto`,
      label: t("nav.contact"),
      active: loc.pathname.includes("/contacto"),
      /* REVISION-42 Q4: a 1280 con sesión non cabe; vai ao menú / rodapé. */
      hideBelowWide: true,
    },
  ];

  const onAccount = loc.pathname.includes("/conta");

  return (
    <BrandShellHeader
      homeTo={`/c/${muni}`}
      eyebrow={t("chrome.sportsFacilities")}
      nav={nav}
      navAriaLabel={t("nav.home")}
      tone="light"
      noticesCount={unread}
      noticesTo={user ? `/c/${muni}/avisos` : undefined}
      hideLanguage={onAccount}
      identifyTo={
        user
          ? undefined
          : `/c/${muni}/acceso?returnTo=${encodeURIComponent(`${loc.pathname}${loc.search}`)}`
      }
    />
  );
}
