import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BrandShellHeader } from "./BrandShellHeader";

/** SIMPLIFICACION §4 — unha soa pantalla de conserxaría. */
export function StaffHeader() {
  const { t } = useTranslation();
  const loc = useLocation();
  const slug = loc.pathname.match(/^\/c\/([^/]+)/)?.[1];
  if (!slug) return null;

  const nav = [
    {
      to: `/c/${slug}/conserxeria`,
      label: t("staff.checkin"),
      active: loc.pathname.includes("/conserxeria"),
    },
    {
      to: `/c/${slug}/folla-conserxe`,
      label: t("staff.sheetNav"),
      active: loc.pathname.includes("/folla-conserxe"),
    },
  ];

  return (
    <BrandShellHeader
      homeTo={`/c/${slug}/conserxeria`}
      eyebrow={t("staff.title")}
      nav={nav}
      navAriaLabel={t("staff.title")}
      tone="brand"
      /* REVISION-40 T17: nav no móbil vai na barra inferior fixa. */
      mobileNav={false}
    />
  );
}
