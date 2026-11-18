import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ShieldMark } from "./ShieldMark";
import { PrefsBar } from "./PrefsBar";
import { UserMenu } from "./UserMenu";
import { useSession } from "../context/SessionContext";
import { useReadingPrefs } from "../hooks/useReadingPrefs";
import { apiX } from "../lib/api-complete";

/**
 * REVISION-17 R1: barra coa cor do concello, nome completo, «+ Reservar en nome»,
 * campá e usuario. Sen escudo duplicado no menú lateral.
 */
export function AdminTopBar() {
  const { t } = useTranslation();
  const loc = useLocation();
  const { user, municipality } = useSession();
  const prefs = useReadingPrefs();
  const slug = loc.pathname.match(/^\/c\/([^/]+)/)?.[1];
  const [unread, setUnread] = useState(0);
  const name = municipality?.name ?? t("brand");
  const shortName = name.replace(/^Concello de\s+/i, "") || name;
  const initial = shortName.charAt(0) || "P";
  const logo =
    municipality?.settings?.logoUrl ?? municipality?.settings?.logoDataUrl;
  const readOnly = user?.role === "superadmin";
  const onBookFor = loc.pathname.includes("/reservar-nome");

  useEffect(() => {
    if (!user || readOnly || !slug) {
      setUnread(0);
      return;
    }
    void apiX
      .notices(slug)
      .then((r) => setUnread(r.data.filter((n) => !n.read).length))
      .catch(() => setUnread(0));
  }, [user, slug, readOnly, loc.pathname]);

  if (!slug) return null;

  return (
    <header
      className="bg-marino text-white"
      data-pa-on-brand=""
      data-testid="admin-topbar"
    >
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-8">
        <Link
          to={`/c/${slug}/admin`}
          className="flex min-w-0 items-center gap-3 text-white no-underline"
        >
          <ShieldMark
            initial={initial}
            size={40}
            src={logo}
            variant="onBrand"
            brandColor={municipality?.accentColor}
          />
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-base font-bold md:text-lg">{name}</span>
            <span className="truncate text-[13px] opacity-90">{t("admin.title")}</span>
          </span>
        </Link>

        {/* REVISION-33 D11: mesma cabeceira (UserMenu + Saír) tamén en Reservar en nome. */}
        <div className="flex shrink-0 flex-nowrap items-center gap-2">
          {!readOnly && !onBookFor ? (
            <Link
              to={`/c/${slug}/admin/reservar-nome`}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] border-[1.5px] border-white/70 bg-white/10 px-3.5 text-sm font-extrabold text-white no-underline hover:bg-white/20"
              data-testid="admin-book-for-bar"
            >
              <span aria-hidden>+</span>
              <span className="hidden sm:inline">{t("admin.bookFor")}</span>
              <span className="sm:hidden">{t("admin.bookForShort")}</span>
            </Link>
          ) : null}

          {user && !readOnly ? (
            <Link
              to={`/c/${slug}/avisos`}
              className="relative flex h-11 min-w-11 items-center justify-center rounded-[10px] border-[1.5px] border-white/60 font-bold text-white"
              aria-label={
                unread > 0
                  ? `${t("nav.notices")} (${unread > 9 ? "9+" : unread})`
                  : t("nav.notices")
              }
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {unread > 0 ? (
                <span
                  className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-azul"
                  aria-hidden
                />
              ) : null}
            </Link>
          ) : null}

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
