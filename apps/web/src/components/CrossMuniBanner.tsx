import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { citizenMayCrossMunicipality, slugFromPath } from "@pista-aberta/shared";
import { useSession } from "../context/SessionContext";
import { api } from "../lib/api";

/**
 * Cando a veciña navega noutro concello coa súa identidade de casa,
 * avisa claramente (REVISION-16 N7 / P1).
 * O nome sae sempre do municipalitySlug real da sesión (nunca dun
 * slug primario de demo / primeiro concello da lista).
 */
export function CrossMuniBanner() {
  const { t } = useTranslation();
  const loc = useLocation();
  const { user, municipality } = useSession();
  const routeSlug = slugFromPath(loc.pathname);
  const [homeName, setHomeName] = useState<string | null>(null);
  const [homeResolved, setHomeResolved] = useState(false);

  const homeSlug = user?.municipalitySlug?.trim() || null;
  const cross =
    Boolean(user) &&
    Boolean(routeSlug) &&
    Boolean(homeSlug) &&
    homeSlug !== routeSlug &&
    citizenMayCrossMunicipality(user!.role, user!.personIdentifier);

  useEffect(() => {
    if (!cross || !homeSlug) {
      setHomeName(null);
      setHomeResolved(false);
      return;
    }
    let cancelled = false;
    setHomeResolved(false);
    void api
      .info(homeSlug)
      .then((r) => {
        if (!cancelled) {
          setHomeName(
            r.data.name.replace(/^Concello de\s+/i, "") || r.data.name,
          );
          setHomeResolved(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          /* Sen info do concello de casa non inventamos un nome (p.ex. «Exemplo»). */
          setHomeName(null);
          setHomeResolved(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [cross, homeSlug]);

  if (!cross || !routeSlug || !homeSlug || !homeResolved || !homeName) {
    return null;
  }

  const here = municipality?.name ?? routeSlug;

  return (
    <div
      className="pa-ok-banner mx-auto mt-3 w-full max-w-5xl px-4 text-sm md:px-6"
      data-testid="cross-muni-banner"
      role="status"
    >
      <span>
        {t("chrome.crossMuniBanner", {
          home: homeName,
          here,
        })}
      </span>
    </div>
  );
}
