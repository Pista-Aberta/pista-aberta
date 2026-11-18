import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Building2,
  CheckSquare,
  ClipboardList,
  Home,
  MoreHorizontal,
  UserRound,
  Users,
} from "lucide-react";
import { useSession } from "../context/SessionContext";
import { apiX } from "../lib/api-complete";
import { zoneFromPath } from "../lib/roles";

type Tab = {
  to: string;
  label: string;
  Icon: typeof Home;
  match: (p: string) => boolean;
  badge?: number;
  onClick?: () => void;
};

/**
 * REVISION-40 T17 — barra inferior fixa do panel (admin / conserxaría / club)
 * no móbil, sen scroll lateral.
 */
export function PanelMobileTabBar() {
  const { t } = useTranslation();
  const loc = useLocation();
  const { user, logout } = useSession();
  const zone = zoneFromPath(loc.pathname);
  const slug = loc.pathname.match(/^\/c\/([^/]+)/)?.[1];
  const clubId =
    loc.pathname.match(/\/clubs\/([^/]+)/)?.[1] ?? user?.clubId ?? null;
  const [moreOpen, setMoreOpen] = useState(false);
  const [pending, setPending] = useState(0);
  const [incidents, setIncidents] = useState(0);

  useEffect(() => {
    if (!slug || zone !== "admin" || user?.role === "superadmin") {
      setPending(0);
      setIncidents(0);
      return;
    }
    void apiX
      .solicitudes(slug, "pending")
      .then((r) => setPending(r.pending))
      .catch(() => setPending(0));
    void apiX
      .listIncidents(slug, "open")
      .then((r) => setIncidents(r.open))
      .catch(() => setIncidents(0));
  }, [slug, zone, user?.role, loc.pathname]);

  if (!slug || !user) return null;
  if (zone !== "admin" && zone !== "staff" && zone !== "club") return null;

  let tabs: Tab[] = [];

  if (zone === "admin") {
    tabs = [
      {
        to: `/c/${slug}/admin`,
        label: t("admin.navToday"),
        Icon: Home,
        match: (p) =>
          p === `/c/${slug}/admin` ||
          p.endsWith("/admin/") ||
          p.includes("/admin/reservas"),
      },
      {
        to: `/c/${slug}/admin/instalacions`,
        label: t("admin.facilities"),
        Icon: Building2,
        match: (p) =>
          p.includes("/admin/instalacions") ||
          p.includes("/admin/horarios") ||
          p.includes("/admin/normas") ||
          p.includes("/admin/grupos-fixos"),
      },
      {
        to: `/c/${slug}/admin/clubs-pavillon`,
        label: t("admin.navClubsShort", { defaultValue: "Clubs" }),
        Icon: Users,
        badge: pending > 0 ? pending : undefined,
        match: (p) =>
          p.includes("/admin/clubs") ||
          p.includes("/admin/solicitudes") ||
          p.includes("/admin/tempada") ||
          p.includes("/admin/pavillon") ||
          p.includes("/admin/importar"),
      },
      {
        to: `/c/${slug}/admin/incidencias`,
        label: t("admin.incidents"),
        Icon: ClipboardList,
        badge: incidents > 0 ? incidents : undefined,
        match: (p) => p.includes("/admin/incidencias"),
      },
      {
        to: "#more",
        label: t("nav.more", { defaultValue: "Máis" }),
        Icon: MoreHorizontal,
        match: () => moreOpen,
        onClick: () => setMoreOpen(true),
      },
    ];
  } else if (zone === "staff") {
    tabs = [
      {
        to: `/c/${slug}/conserxeria`,
        label: t("staff.checkinShort", { defaultValue: "Entrada" }),
        Icon: CheckSquare,
        match: (p) => p.includes("/conserxeria") && !p.includes("/conta"),
      },
      {
        to: `/c/${slug}/folla-conserxe`,
        label: t("staff.sheetNav"),
        Icon: ClipboardList,
        match: (p) => p.includes("/folla-conserxe"),
      },
      {
        to: `/c/${slug}/conserxeria/conta`,
        label: t("nav.account", { defaultValue: "Conta" }),
        Icon: UserRound,
        match: (p) => p.includes("/conserxeria/conta"),
      },
    ];
  } else if (zone === "club" && clubId) {
    const base = `/c/${slug}/clubs/${clubId}`;
    tabs = [
      {
        to: base,
        label: t("nav.pavillon"),
        Icon: Building2,
        match: (p) => p === base || p === `${base}/`,
      },
      {
        to: `${base}/tempada`,
        label: t("clubs.season"),
        Icon: ClipboardList,
        match: (p) => p.includes("/tempada"),
      },
      {
        to: `${base}/datos`,
        label: t("nav.account", { defaultValue: "Conta" }),
        Icon: UserRound,
        match: (p) => p.includes("/datos"),
      },
    ];
  } else {
    return null;
  }

  const moreItems =
    zone === "admin"
      ? [
          {
            to: `/c/${slug}/admin/actividades`,
            label: t("nav.actividades"),
          },
          {
            to: `/c/${slug}/admin/partidos-abertos`,
            label: t("nav.openMatches"),
          },
          {
            to: `/c/${slug}/admin/concello`,
            label: t("admin.navTown"),
          },
        ]
      : [];

  const doLogout = async () => {
    setMoreOpen(false);
    await logout();
    window.location.href = `/c/${slug}/acceso?aviso=saida`;
  };

  return (
    <>
      <nav
        aria-label={t("tab.label")}
        data-testid="panel-mobile-tabbar"
        data-pa-mobile-tab="1"
        className="fixed inset-x-tab-inset bottom-tab-inset z-40 grid h-tab-h rounded-[22px] bg-surface p-1.5 shadow-pa-tab lg:hidden"
        style={{
          left: "var(--pa-mobile-tab-inset)",
          right: "var(--pa-mobile-tab-inset)",
          bottom: "max(var(--pa-mobile-tab-inset), env(safe-area-inset-bottom, 0px))",
          height: "var(--pa-mobile-tab-h)",
          gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`,
          maxWidth: "calc(100% - 2 * var(--pa-mobile-tab-inset))",
        }}
      >
        {tabs.map((tab) => {
          const active = tab.match(loc.pathname);
          const Icon = tab.Icon;
          const className = [
            "pa-ui-interactive relative flex flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px] font-extrabold no-underline",
            active ? "bg-azul-50 text-azul-700" : "bg-transparent text-graphite",
          ].join(" ");
          const inner = (
            <>
              <span className="relative">
                <Icon size={22} strokeWidth={2.1} aria-hidden />
                {tab.badge != null && tab.badge > 0 ? (
                  <span
                    className="absolute -right-1.5 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-ambar px-1 text-[10px] font-extrabold text-marino"
                    aria-hidden
                  >
                    {tab.badge > 9 ? "9+" : tab.badge}
                  </span>
                ) : null}
              </span>
              <span className="max-w-full truncate px-0.5">{tab.label}</span>
            </>
          );
          if (tab.onClick) {
            return (
              <button
                key={tab.label}
                type="button"
                className={className}
                aria-current={active ? "page" : undefined}
                onClick={tab.onClick}
              >
                {inner}
              </button>
            );
          }
          return (
            <Link
              key={tab.to}
              to={tab.to}
              aria-current={active ? "page" : undefined}
              className={className}
            >
              {inner}
            </Link>
          );
        })}
      </nav>

      {moreOpen ? (
        <div
          className="fixed inset-0 z-50 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label={t("nav.more", { defaultValue: "Máis" })}
        >
          <button
            type="button"
            className="absolute inset-0 border-0 bg-black/40"
            aria-label={t("common.close")}
            onClick={() => setMoreOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-[22px] bg-surface px-4 pb-[calc(var(--pa-mobile-tab-inset)+1rem)] pt-3 shadow-pa-sheet">
            <span
              aria-hidden
              className="mx-auto mb-3 block h-1 w-10 rounded-sm bg-border2"
            />
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {moreItems.map((item) => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    className="flex min-h-12 items-center rounded-2xl px-3 text-base font-extrabold text-marino no-underline hover:bg-azul-25"
                    onClick={() => setMoreOpen(false)}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  className="flex min-h-12 w-full items-center rounded-2xl border-0 bg-transparent px-3 text-left text-base font-extrabold text-erro"
                  onClick={() => void doLogout()}
                >
                  {t("nav.logout")}
                </button>
              </li>
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}
