import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ShieldMark } from "./ShieldMark";
import { PrefsBar } from "./PrefsBar";
import { UserMenu } from "./UserMenu";
import { useSession } from "../context/SessionContext";
import { useReadingPrefs } from "../hooks/useReadingPrefs";

export type BrandNavItem = {
  to: string;
  label: string;
  active?: boolean;
  /** REVISION-42 Q4: agochar por debaixo de ~1360 px (menú conta / rodapé). */
  hideBelowWide?: boolean;
};

/**
 * Cabeceira institucional compartida.
 * `tone="light"`: portada cidadá (fondo branco, cor do concello no texto/escudo).
 * `tone="brand"`: panel / legado (fondo --brand, texto branco).
 *
 * REVISION-16 N5: unha fila a 1280/1440 — escudo | nav centro | campá+UserMenu+Saír.
 * GL/ES/Aa/contraste van no botón «Aa» (como no móbil).
 */
export function BrandShellHeader({
  homeTo,
  eyebrow,
  nav,
  navAriaLabel,
  tone = "brand",
  noticesCount = 0,
  noticesTo,
  identifyTo,
  hideLanguage = false,
  mobileNav = false,
  /** REVISION-31 B1: forzar título («Pista Aberta» / concello do convite). */
  brandTitle,
}: {
  homeTo: string;
  eyebrow: string;
  nav?: BrandNavItem[];
  navAriaLabel?: string;
  tone?: "brand" | "light";
  noticesCount?: number;
  noticesTo?: string;
  identifyTo?: string;
  /** REVISION-18 T6: evita GL/ES duplicado na Conta. */
  hideLanguage?: boolean;
  /** Rev25: nav staff visible tamén en móbil (check-in dende a folla). */
  mobileNav?: boolean;
  brandTitle?: string;
}) {
  const { t } = useTranslation();
  const { user, municipality } = useSession();
  const prefs = useReadingPrefs();
  const hasMuni = !!municipality?.name && !brandTitle;
  const name = brandTitle ?? municipality?.name ?? t("brand");
  const shortName = name.replace(/^Concello de\s+/i, "") || name;
  const initial = shortName.charAt(0) || "P";
  const logo = brandTitle
    ? undefined
    : (municipality?.settings?.logoUrl ?? municipality?.settings?.logoDataUrl);
  const light = tone === "light";
  /* REVISION-31 B1: sen concello / brandTitle → non «Concello de Pista Aberta». */
  const titleLabel = brandTitle
    ? brandTitle
    : !hasMuni
      ? t("brand")
      : light
        ? t("chrome.muniTitle", { name: shortName })
        : name;

  return (
    <header
      data-pa-on-brand={light ? undefined : ""}
      className={
        light
          ? "border-b border-line bg-white text-ink"
          : "bg-marino text-white"
      }
    >
      <div className="mx-auto flex max-w-[1200px] flex-nowrap items-center gap-1 overflow-x-clip px-3 py-3 sm:gap-1.5 md:gap-2 md:px-6">
        <Link
          to={homeTo}
          className={`flex min-w-0 shrink-0 items-center gap-2 no-underline md:gap-2.5 ${light ? "text-ink" : "text-white"}`}
        >
          <ShieldMark
            initial={initial}
            size={40}
            src={logo}
            variant={light ? "onLight" : "onBrand"}
            brandColor={municipality?.accentColor}
          />
          <span className="flex min-w-0 flex-col leading-tight">
            <span
              className={`max-w-[7.5rem] truncate text-base font-bold sm:max-w-[12rem] md:max-w-none md:text-lg ${
                light ? "text-marino" : ""
              }`}
            >
              {/* REVISION-19 B6 + Rev24 D6: móbil = nome curto tamén na cabeceira escura. */}
              <>
                <span className="sm:hidden">{hasMuni ? shortName : t("brand")}</span>
                <span className="hidden sm:inline">{titleLabel}</span>
              </>
            </span>
            {eyebrow ? (
              <span
                className={`hidden text-[13px] sm:inline ${light ? "text-graphite" : "opacity-90"}`}
              >
                {eyebrow}
              </span>
            ) : null}
          </span>
        </Link>

        {nav && nav.length > 0 ? (
          <nav
            aria-label={navAriaLabel ?? eyebrow}
            className={`mx-auto min-w-0 flex-1 flex-nowrap items-center justify-center gap-0 ${
              mobileNav ? "hidden lg:flex" : "hidden lg:flex"
            }`}
          >
            {nav.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                aria-current={item.active ? "page" : undefined}
                className={`flex h-11 shrink-0 items-center rounded-chip px-2 text-sm font-bold no-underline xl:px-2.5 ${
                  item.hideBelowWide ? "max-[1359px]:hidden" : ""
                } ${
                  light
                    ? item.active
                      ? "bg-azul-50 text-azul-700"
                      : "text-muted-2 hover:bg-azul-25"
                    : item.active
                      ? "border-b-[3px] border-white text-white underline decoration-2 underline-offset-8"
                      : "border-b-[3px] border-transparent text-white/85 hover:text-white"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        ) : (
          <div className="min-w-0 flex-1" aria-hidden />
        )}

        <div className="flex shrink-0 items-center gap-1.5 md:gap-2">
          {noticesTo ? (
            <Link
              to={noticesTo}
              className={`relative flex h-11 min-w-11 items-center justify-center rounded-[10px] font-bold ${
                light
                  ? "border-[1.5px] border-border2 text-ink"
                  : "border-[1.5px] border-white/60 text-white"
              }`}
              aria-label={
                noticesCount > 0
                  ? `${t("nav.notices")} (${noticesCount > 9 ? "9+" : noticesCount})`
                  : t("nav.notices")
              }
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {noticesCount > 0 ? (
                /* Punto sen cifra visible: a cifra vai só no aria-label (WCAG 2.5.3). */
                <span
                  className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-azul"
                  aria-hidden
                />
              ) : null}
            </Link>
          ) : null}

          {user ? (
            <UserMenu tone={light ? "light" : "brand"} />
          ) : identifyTo ? (
            <Link
              to={identifyTo}
              className={`flex min-h-11 items-center rounded-[10px] px-2.5 font-bold sm:px-3.5 ${
                light
                  ? "bg-azul text-white"
                  : "border-[1.5px] border-white/60 text-white"
              }`}
              aria-label={t("nav.identify")}
            >
              <span className="sm:hidden" aria-hidden>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </span>
              <span className="hidden sm:inline">{t("nav.identify")}</span>
            </Link>
          ) : null}

          <button
            type="button"
            className={`flex h-11 min-w-11 items-center justify-center rounded-[10px] font-bold ${
              light
                ? "border-[1.5px] border-border2"
                : "border-[1.5px] border-white/60 text-white"
            }`}
            aria-expanded={prefs.aaOpen}
            aria-label={t("a11y.prefs")}
            onClick={() => prefs.setAaOpen((v) => !v)}
          >
            Aa
          </button>
        </div>
      </div>

      {prefs.aaOpen ? (
        <div
          className={`border-t px-4 py-3 ${
            light ? "border-line" : "border-white/20"
          }`}
        >
          <PrefsBar
            variant={light ? "onLight" : "onBrand"}
            hideLanguage={hideLanguage}
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
