import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CalendarDays, ClipboardCheck, Home, Trophy, Users } from "lucide-react";

export function MobileTabBar() {
  const { t } = useTranslation();
  const loc = useLocation();
  const slug = loc.pathname.match(/^\/c\/([^/]+)/)?.[1];
  if (!slug) return null;
  if (
    loc.pathname === "/acceso" ||
    loc.pathname === "/" ||
    /^\/c\/[^/]+\/acceso\/?$/.test(loc.pathname)
  ) {
    return null;
  }

  /* REVISION-46 V1: 5.ª lapela «Partidos» (curta, sen cortar textos). */
  const tabs = [
    {
      to: `/c/${slug}`,
      label: t("nav.home"),
      Icon: Home,
      match: (p: string) => p === `/c/${slug}`,
    },
    {
      to: `/c/${slug}/reservar`,
      label: t("nav.reserve"),
      Icon: CalendarDays,
      match: (p: string) =>
        p.includes("/reservar") || p.includes("/instalacions") || p.includes("/reserva/"),
    },
    {
      to: `/c/${slug}/partidos-abertos`,
      label: t("nav.openMatchesShort"),
      Icon: Users,
      match: (p: string) => p.includes("/partidos-abertos"),
    },
    {
      to: `/c/${slug}/actividades`,
      label: t("nav.actividades"),
      Icon: Trophy,
      match: (p: string) => p.includes("/actividades"),
    },
    {
      to: `/c/${slug}/reservas`,
      label: t("tab.reservas"),
      Icon: ClipboardCheck,
      match: (p: string) => p.includes("/reservas"),
    },
  ];

  return (
    <nav
      aria-label={t("tab.label")}
      data-pa-mobile-tab="1"
      className="fixed inset-x-tab-inset bottom-tab-inset z-40 grid h-tab-h max-w-[calc(100%-2*var(--pa-mobile-tab-inset))] overflow-hidden rounded-[22px] bg-surface p-1.5 shadow-pa-tab lg:hidden"
      style={{
        /* fallback se Tailwind spacing custom non resolve */
        left: "var(--pa-mobile-tab-inset)",
        right: "var(--pa-mobile-tab-inset)",
        bottom: "max(var(--pa-mobile-tab-inset), env(safe-area-inset-bottom, 0px))",
        height: "var(--pa-mobile-tab-h)",
        gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`,
      }}
    >
      {tabs.map((tab) => {
        const active = tab.match(loc.pathname);
        const Icon = tab.Icon;
        return (
          <Link
            key={tab.to}
            to={tab.to}
            aria-current={active ? "page" : undefined}
            className={[
              "pa-ui-interactive flex min-w-0 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-2xl text-[10px] font-extrabold leading-tight no-underline sm:text-xs",
              active ? "bg-azul-50 text-azul-700" : "bg-transparent text-graphite",
            ].join(" ")}
          >
            <Icon size={20} strokeWidth={2.1} aria-hidden />
            <span className="max-w-full truncate px-0.5">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
