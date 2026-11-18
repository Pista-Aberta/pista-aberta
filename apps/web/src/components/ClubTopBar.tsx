import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BrandShellHeader } from "./BrandShellHeader";
import { useSession } from "../context/SessionContext";
import { apiX } from "../lib/api-complete";

/** SIMPLIFICACION §3 — 3 pestanas: Pavillón · Tempada · Conta. REVISION-17 R1/R3: barra de marca + campá. */
export function ClubTopBar() {
  const { t } = useTranslation();
  const loc = useLocation();
  const { user } = useSession();
  const [unread, setUnread] = useState(0);
  const slug = loc.pathname.match(/^\/c\/([^/]+)/)?.[1];
  const clubMatch = loc.pathname.match(/\/clubs\/([^/]+)/);
  const clubId = clubMatch?.[1];
  const base = clubId && slug ? `/c/${slug}/clubs/${clubId}` : slug ? `/c/${slug}/clubs` : "/";

  useEffect(() => {
    if (!user || !slug) {
      setUnread(0);
      return;
    }
    void apiX
      .notices(slug)
      .then((r) => setUnread(r.data.filter((n) => !n.read).length))
      .catch(() => setUnread(0));
  }, [user, slug, loc.pathname]);

  if (!slug) return null;

  const nav = clubId
    ? [
        {
          to: base,
          label: t("nav.pavillon"),
          active: loc.pathname === base,
        },
        {
          to: `${base}/tempada`,
          label: t("clubs.season"),
          active: loc.pathname.includes("/tempada"),
        },
        {
          to: `${base}/datos`,
          label: t("clubs.data"),
          active: loc.pathname.includes("/datos"),
        },
      ]
    : [
        {
          to: `/c/${slug}/clubs`,
          label: t("clubs.portal"),
          active: true,
        },
      ];

  return (
    <BrandShellHeader
      homeTo={`/c/${slug}/clubs`}
      eyebrow={t("clubs.portal")}
      nav={nav}
      navAriaLabel={t("clubs.portal")}
      tone="brand"
      noticesCount={unread}
      noticesTo={user ? `/c/${slug}/avisos` : undefined}
    />
  );
}
