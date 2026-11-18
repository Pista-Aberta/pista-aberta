import { useEffect } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useSession } from "../context/SessionContext";
import { formatDemoLoginNotice } from "../lib/demo-login-notice";
import { isElevatedRole, zoneFromPath } from "../lib/roles";
import { themeFromMunicipality } from "../lib/theme";
import { CitizenHeader } from "./CitizenHeader";
import { CrossMuniBanner } from "./CrossMuniBanner";
import { MobileTabBar } from "./MobileTabBar";
import { PanelMobileTabBar } from "./PanelMobileTabBar";
import { PlatformFooter } from "./PlatformFooter";
import { SiteFooter } from "./SiteFooter";
import { StaffHeader } from "./StaffHeader";
import { AdminTopBar } from "./AdminTopBar";
import { ClubTopBar } from "./ClubTopBar";
import { DemoProfileBar } from "./DemoProfileBar";
import { DeputacionHeader } from "./DeputacionHeader";
import { SessionExpiryDialog } from "./SessionExpiryDialog";

const DEFAULT_MANIFEST = "/manifest.webmanifest";
const DEFAULT_THEME_COLOR = "#007BC4";

/** REVISION-21 Q6 — manifest, theme-color e apple-touch por concello. */
function applyMunicipalityManifest(slug: string | null, brand: string | null) {
  let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "manifest";
    document.head.appendChild(link);
  }
  link.href = slug ? `/api/c/${slug}/manifest.webmanifest` : DEFAULT_MANIFEST;

  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = brand || DEFAULT_THEME_COLOR;

  let touch = document.querySelector<HTMLLinkElement>(
    'link[rel="apple-touch-icon"]',
  );
  if (slug) {
    if (!touch) {
      touch = document.createElement("link");
      touch.rel = "apple-touch-icon";
      document.head.appendChild(touch);
    }
    touch.href = `/api/c/${slug}/icon-180.png`;
    let appTitle = document.querySelector<HTMLMetaElement>(
      'meta[name="apple-mobile-web-app-title"]',
    );
    if (!appTitle) {
      appTitle = document.createElement("meta");
      appTitle.name = "apple-mobile-web-app-title";
      document.head.appendChild(appTitle);
    }
    const pretty = slug
      .split("-")
      .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
      .join(" ");
    appTitle.content = pretty;
  } else if (touch) {
    touch.remove();
  }

  if (slug) {
    document.title = document.title.includes("Pista Aberta")
      ? document.title
      : "Pista Aberta";
  }
}

function SkipLink() {
  const { t } = useTranslation();
  return (
    <a
      href="#contido-principal"
      className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-btn focus:bg-ink focus:px-4 focus:py-3 focus:text-white focus:outline-none"
    >
      {t("a11y.skip")}
    </a>
  );
}

/**
 * Páxinas «cidadás» que o persoal/club/admin abre desde a súa barra (campá).
 * Sen isto, /avisos cambia a cabeceira clara e parece outro tema.
 */
function elevatedChromeOverride(
  pathname: string,
  role: string | undefined,
): "admin" | "staff" | "club" | null {
  if (!role || !isElevatedRole(role as never)) return null;
  if (!/^\/c\/[^/]+\/avisos\/?$/.test(pathname)) return null;
  if (role === "admin" || role === "superadmin") return "admin";
  if (role === "staff" || role === "monitor") return "staff";
  if (role === "club_manager") return "club";
  return null;
}

export function AppChrome({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();
  const clubMissingNotice = searchParams.get("aviso") === "club_non_creado";
  const pathZone = zoneFromPath(loc.pathname);
  const { setMunicipalitySlug, user, municipality, municipalityMissing } = useSession();
  const slug = loc.pathname.match(/^\/c\/([^/]+)/)?.[1] ?? null;
  const override = elevatedChromeOverride(loc.pathname, user?.role);
  const zone = override ?? pathZone;
  /** REVISION-40 N4 — widget embebible sen demo/cabeceira/nav/rodapé. */
  const isWidget = /^\/c\/[^/]+\/widget(\/|$)/.test(loc.pathname);

  useEffect(() => {
    setMunicipalitySlug(slug);
  }, [slug, setMunicipalitySlug]);

  useEffect(() => {
    if (municipalityMissing || !slug || !municipality) {
      applyMunicipalityManifest(null, null);
      return;
    }
    const theme = themeFromMunicipality(municipality);
    applyMunicipalityManifest(slug, theme.brand);
    document.title = `${municipality.name} · Pista Aberta`;
  }, [slug, municipality, municipalityMissing]);

  if (isWidget) {
    return <>{children}</>;
  }

  if (zone === "bare") {
    const isDeputacion =
      loc.pathname === "/deputacion" || loc.pathname === "/admin/deputacion";
    return (
      <div className="flex min-h-screen min-w-0 max-w-full flex-col overflow-x-clip">
        <SkipLink />
        <DemoProfileBar />
        {isDeputacion ? <DeputacionHeader /> : null}
        <div id="contido-principal" className="min-w-0 flex-1">
          {children}
        </div>
        {isDeputacion ? <PlatformFooter /> : null}
        <SessionExpiryDialog />
      </div>
    );
  }

  if (zone === "admin" || zone === "staff" || zone === "club") {
    return (
      <div className="flex min-h-screen min-w-0 max-w-full flex-col overflow-x-clip bg-[var(--pa-bg)] pb-[calc(var(--pa-mobile-tab-inset)+var(--pa-mobile-tab-h)+12px+env(safe-area-inset-bottom,0px))] lg:pb-0">
        <SkipLink />
        <DemoProfileBar />
        {zone === "admin" && <AdminTopBar />}
        {zone === "staff" && <StaffHeader />}
        {zone === "club" && <ClubTopBar />}
        <div id="contido-principal" className="min-w-0 flex-1">
          {children}
        </div>
        <SiteFooter />
        <PanelMobileTabBar />
        <SessionExpiryDialog />
      </div>
    );
  }

  /* REVISION-33 D9: concello inexistente → cabeceira pública (Pista Aberta). */
  if (municipalityMissing) {
    return (
      <div className="flex min-h-screen min-w-0 max-w-full flex-col overflow-x-clip">
        <SkipLink />
        <DemoProfileBar />
        <CitizenHeader />
        <div id="contido-principal" className="min-w-0 flex-1">
          {children}
        </div>
        <SessionExpiryDialog />
      </div>
    );
  }

  return (
    <div className="pa-citizen-shell flex min-h-screen min-w-0 max-w-full flex-col overflow-x-clip">
      <SkipLink />
      <DemoProfileBar />
      <CitizenHeader />
      <CrossMuniBanner />
      {clubMissingNotice ? (
        <div className="mx-auto mt-4 w-full max-w-[1120px] px-4 md:px-6">
          <div
            className="pa-warn-banner"
            role="status"
            data-testid="demo-aviso-club"
          >
            <span aria-hidden>⚠</span>
            <span>{formatDemoLoginNotice(t, "club_non_creado")}</span>
          </div>
        </div>
      ) : null}
      <div id="contido-principal" className="min-w-0 flex-1">
        {children}
      </div>
      <SiteFooter />
      <MobileTabBar />
      <SessionExpiryDialog />
    </div>
  );
}
