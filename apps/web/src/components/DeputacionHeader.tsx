import { useEffect, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BrandMark } from "./BrandMark";
import { PrefsBar } from "./PrefsBar";
import { UserMenu } from "./UserMenu";
import { useReadingPrefs } from "../hooks/useReadingPrefs";
import { useSession } from "../context/SessionContext";
import { apiX } from "../lib/api-complete";
import {
  DEPUTACION_TABS,
  deputacionTabHref,
  parseDeputacionTab,
  type DeputacionTab,
} from "../lib/deputacion-tabs";

const TAB_LABEL: Record<DeputacionTab, string> = {
  resumo: "deputacion.tabResumo",
  concellos: "deputacion.tabConcellos",
  persoas: "deputacion.tabPersoas",
  config: "deputacion.tabConfig",
};

/** Cabeceira Deputación — barra mariño + lapelas (REVISION-46 D1). */
export function DeputacionHeader() {
  const { t } = useTranslation();
  const prefs = useReadingPrefs();
  const { user } = useSession();
  const [searchParams] = useSearchParams();
  const loc = useLocation();
  const activeTab = parseDeputacionTab(searchParams.get("tab"));
  const [orgName, setOrgName] = useState<string | null>(null);

  useEffect(() => {
    if (user?.role !== "superadmin") return;
    void apiX
      .deputacionOrg()
      .then((r) => setOrgName(r.data?.name?.trim() || null))
      .catch(() => undefined);
  }, [user?.role]);

  const showTabs = user?.role === "superadmin" && loc.pathname.startsWith("/deputacion");

  return (
    <header className="bg-marino text-white" data-pa-on-brand="">
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-3 px-6 py-3 md:px-8">
        <Link to="/deputacion" className="flex min-w-0 items-center gap-2.5 no-underline text-white">
          <BrandMark size={36} />
          <span className="flex min-w-0 flex-col leading-tight">
            <strong className="truncate text-base font-extrabold md:text-[17px]">
              {orgName || t("deputacion.headerTitle")}
            </strong>
            <span className="text-[13px] text-[#B5CCE0]">{t("deputacion.headerSubtitleLong")}</span>
          </span>
        </Link>

        {showTabs ? (
          <nav
            role="tablist"
            aria-label={t("deputacion.navTabs")}
            className="order-3 flex w-full flex-wrap gap-5 text-[15px] font-bold md:order-none md:ml-auto md:w-auto"
          >
            {DEPUTACION_TABS.map((tab) => {
              const selected = activeTab === tab;
              return (
                <Link
                  key={tab}
                  role="tab"
                  aria-selected={selected}
                  to={deputacionTabHref(tab)}
                  className={
                    selected
                      ? "border-b-2 border-[#F2B33D] px-0 py-1.5 text-white"
                      : "px-0 py-1.5 text-[#C9D9E8] no-underline hover:text-white"
                  }
                >
                  {t(TAB_LABEL[tab])}
                </Link>
              );
            })}
          </nav>
        ) : null}

        <div className="ml-auto flex items-center gap-2 md:ml-0">
          {user ? <UserMenu tone="brand" /> : null}
          <button
            type="button"
            className="flex h-11 min-w-11 items-center justify-center rounded-[10px] border-[1.5px] border-white/60 font-bold text-white"
            aria-expanded={prefs.aaOpen}
            aria-label={t("a11y.prefs")}
            onClick={() => prefs.setAaOpen((v) => !v)}
          >
            Aa
          </button>
        </div>
      </div>
      {prefs.aaOpen ? (
        <div className="border-t border-white/20 px-4 py-3">
          <PrefsBar
            variant="onBrand"
            contrast={prefs.contrast}
            textStep={prefs.textStep}
            onContrast={() => prefs.setContrast((v) => !v)}
            onTextCycle={prefs.cycleText}
          />
        </div>
      ) : null}
    </header>
  );
}
