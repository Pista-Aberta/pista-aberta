import {
  FormEvent,
  Suspense,
  createContext,
  lazy,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiX, exportCsvUrl } from "../lib/api-complete";
import { api } from "../lib/api";
import { formatDate, formatDateTime, formatDayChip } from "../lib/format-date";
import { ShieldMark } from "../components/ShieldMark";
import { FilePickButton } from "../components/FilePickButton";
import { EmptyState } from "../components/EmptyState";
import { OccupancyGrid } from "../components/OccupancyGrid";
import { DayLineGantt } from "../components/DayLineGantt";
import { ListSearch, filterByQuery } from "../components/ListSearch";
import {
  IconActivity,
  IconBuilding,
  IconClipboard,
  IconHome,
  IconUsers,
} from "../components/icons";
import { useSession } from "../context/SessionContext";
import { fetchPublicConfig } from "../lib/public-config";
import { DemoSnapshotCard } from "../components/DemoSnapshotCard";
import { Button, Card, DayTile, Segmented, SlotButton, Ticket } from "../components/ui";
import { DateField } from "../components/DateField";
import { TimeField } from "../components/TimeField";
import { formatWeekdayShort } from "../lib/format-date";
import { PavilionWeekendGrid } from "../components/PavilionWeekendGrid";
import { csvEscapeCell } from "@pista-aberta/shared";
import {
  hmToMin,
  matchDurationMin,
  matchIsPast,
  minToHm,
  moveUnchanged,
  unitKind,
  unitShortLabel,
  type MoveUnitLike,
} from "../lib/move-match";
import {
  bookForDraftKey,
  clearFormDraft,
  loadFormDraft,
  saveFormDraft,
} from "../lib/form-drafts";

/** When true, nested AdminShell skips nav/title (hub tabs embed page bodies). */
const AdminEmbedCtx = createContext(false);

export function AdminEmbed({ children }: { children: ReactNode }) {
  return <AdminEmbedCtx.Provider value={true}>{children}</AdminEmbedCtx.Provider>;
}

const LazySolicitudesPage = lazy(() =>
  import("./AdminMellorasPages").then((m) => ({ default: m.AdminSolicitudesPage })),
);
const LazyMatchImportPage = lazy(() =>
  import("./AdminMellorasPages").then((m) => ({ default: m.AdminMatchImportPage })),
);
const LazyRulesPage = lazy(() =>
  import("./AdminMellorasPages").then((m) => ({ default: m.AdminRulesEditorPage })),
);
const LazyPeoplePage = lazy(() =>
  import("./AdminPeoplePage").then((m) => ({ default: m.AdminPeoplePage })),
);

type NavItem = { path: string; label: string; badge?: number; icon?: ReactNode };

type NavGroup = {
  id: string;
  title: string;
  icon?: ReactNode;
  /** Ruta principal do grupo (folha ou primeira). */
  hubPath: string;
  items: NavItem[];
  badge?: number;
};

function adminPathTo(slug: string, path: string): string {
  if (path === "conserxeria") return `/c/${slug}/conserxeria`;
  if (path === "pavillon") return `/c/${slug}/pavillon`;
  if (path === "actividades") return `/c/${slug}/admin/actividades`;
  if (!path) return `/c/${slug}/admin`;
  return `/c/${slug}/admin/${path}`;
}

/** SIMPLIFICACION §2 — 6 entradas planas, sen submenús. */
function buildAdminNavGroups(
  t: (key: string) => string,
  pendingRequests?: number,
  openIncidents?: number,
): NavGroup[] {
  return [
    {
      id: "hoxe",
      title: t("admin.navToday"),
      icon: <IconHome size={16} />,
      hubPath: "",
      items: [{ path: "", label: t("admin.navToday"), icon: <IconHome size={16} /> }],
    },
    {
      id: "instalacions",
      title: t("admin.facilities"),
      icon: <IconBuilding size={16} />,
      hubPath: "instalacions",
      items: [
        { path: "instalacions", label: t("admin.facilities"), icon: <IconBuilding size={16} /> },
      ],
    },
    {
      id: "actividades",
      title: t("nav.actividades"),
      icon: <IconActivity size={16} />,
      hubPath: "actividades",
      items: [
        { path: "actividades", label: t("nav.actividades"), icon: <IconActivity size={16} /> },
        {
          path: "partidos-abertos",
          label: t("nav.openMatches"),
          icon: <IconActivity size={16} />,
        },
      ],
    },
    {
      id: "clubs",
      title: t("admin.navClubsPavilion"),
      icon: <IconUsers size={16} />,
      hubPath: "clubs-pavillon",
      badge: pendingRequests,
      items: [
        {
          path: "clubs-pavillon",
          label: t("admin.navClubsPavilion"),
          badge: pendingRequests,
          icon: <IconUsers size={16} />,
        },
      ],
    },
    {
      id: "incidencias",
      title: t("admin.incidents"),
      icon: <IconClipboard size={16} />,
      hubPath: "incidencias",
      badge: openIncidents,
      items: [
        {
          path: "incidencias",
          label: t("admin.incidents"),
          badge: openIncidents,
          icon: <IconClipboard size={16} />,
        },
      ],
    },
    {
      id: "concello",
      title: t("admin.navTown"),
      icon: <IconBuilding size={16} />,
      hubPath: "concello",
      items: [
        { path: "concello", label: t("admin.navTown"), icon: <IconBuilding size={16} /> },
      ],
    },
  ];
}

function groupContainsActive(g: NavGroup, active: string): boolean {
  return g.items.some((i) => i.path === active);
}

/** Mapea rutas vellas á entrada plana do menú de 6. */
function normalizeAdminActive(active: string): string {
  /* D5: Conta e Reservar en nome non marcan «Hoxe». */
  if (active === "conta" || active === "reservar-nome") {
    return active;
  }
  if (active === "" || active === "reservas" || active === "conserxeria") {
    return "";
  }
  if (
    active === "instalacions" ||
    active === "horarios" ||
    active === "normas" ||
    active === "grupos-fixos"
  ) {
    return "instalacions";
  }
  if (
    active === "actividades" ||
    active === "monitoraxe" ||
    active === "partidos-abertos"
  ) {
    return "actividades";
  }
  if (
    active === "clubs-pavillon" ||
    active === "solicitudes" ||
    active === "tempada" ||
    active === "pavillon" ||
    active === "importar-partidos" ||
    active === "clubs"
  ) {
    return "clubs-pavillon";
  }
  if (active === "incidencias") return "incidencias";
  if (
    active === "concello" ||
    active === "persoal" ||
    active === "personalizacion" ||
    active === "datos" ||
    active === "indicadores" ||
    active === "exportar" ||
    active === "persoas" ||
    active === "auditoria"
  ) {
    return "concello";
  }
  return active;
}

/** Sidebar: 6 entradas planas (SIMPLIFICACION §2). */
function AdminNav({
  slug,
  active,
  pendingRequests,
  openIncidents,
}: {
  slug: string;
  active: string;
  pendingRequests?: number;
  openIncidents?: number;
}) {
  const { t } = useTranslation();
  const groups = buildAdminNavGroups(t, pendingRequests, openIncidents);

  return (
    <aside className="hidden w-[248px] shrink-0 lg:block">
      {/* REVISION-17 R1: sen escudo duplicado — a marca vai na barra superior */}
      <div
        className="sticky top-4 overflow-hidden rounded-[20px] bg-marino text-on-dark shadow-pa"
        data-pa-on-brand=""
      >
        <nav className="flex flex-col gap-1 p-2" aria-label={t("admin.title")}>
          {groups.map((g) => {
            const item = g.items[0]!;
            const to = adminPathTo(slug, item.path);
            const on = groupContainsActive(g, active) || active === item.path;
            return (
              <Link
                key={g.id}
                to={to}
                aria-current={on ? "page" : undefined}
                className={`flex items-center justify-between rounded-full px-3 py-2.5 text-sm font-extrabold ${
                  on
                    ? "bg-azul text-white"
                    : "text-white/85 hover:bg-on-dark/10 hover:text-white"
                }`}
              >
                <span className="inline-flex items-center gap-2">
                  {g.icon}
                  {g.title}
                </span>
                {g.badge != null && g.badge > 0 ? (
                  <span className="rounded-full bg-ambar px-1.5 text-[11px] text-marino">
                    {g.badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}

/** REVISION-40 T17: a fila de pílulas desaparece no móbil (barra inferior fixa). */
function AdminMobileNav(_props: {
  slug: string;
  active: string;
  pendingRequests?: number;
  openIncidents?: number;
}) {
  return null;
}

export function AdminShell({
  active,
  pageTitle,
  children,
}: {
  active: string;
  pageTitle?: string;
  children: ReactNode;
}) {
  const embedded = useContext(AdminEmbedCtx);
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const { t } = useTranslation();
  const { user } = useSession();
  const readOnly = user?.role === "superadmin";
  const [pending, setPending] = useState(0);
  useEffect(() => {
    if (embedded) return;
    void apiX
      .solicitudes(slug, "pending")
      .then((r) => setPending(r.pending))
      .catch(() => undefined);
  }, [slug, embedded]);
  if (embedded) {
    return <div className="min-w-0">{children}</div>;
  }
  const title = pageTitle ?? t("admin.home");
  const navActive = normalizeAdminActive(active);
  return (
    <main className="mx-auto max-w-[1200px] px-4 py-6 md:px-8 md:py-8">
      <AdminMobileNav
        slug={slug}
        active={navActive}
        pendingRequests={pending}
      />
      <div className="flex flex-col gap-8 lg:flex-row">
        <AdminNav
          slug={slug}
          active={navActive}
          pendingRequests={pending}
        />
        <div className="min-w-0 flex-1">
          <h1 className="pa-h1 mb-4 m-0">
            {title}
          </h1>
          {readOnly ? (
            <div className="pa-warn-banner mb-4 flex flex-wrap items-center gap-x-3 gap-y-1" role="status">
              <span className="inline-flex items-center gap-2">
                <span aria-hidden>ℹ</span>
                <span>{t("admin.deputacionReadOnly")}</span>
              </span>
              <Link
                to="/deputacion"
                className="font-extrabold text-azul-700 underline underline-offset-2"
                data-testid="admin-back-deputacion"
              >
                {t("admin.backToDeputacion")}
              </Link>
            </div>
          ) : null}
          {children}
        </div>
      </div>
    </main>
  );
}

function Sparkline({ values, className = "" }: { values: number[]; className?: string }) {
  const max = Math.max(1, ...values);
  const pts = values
    .map((v, i) => {
      const x = values.length <= 1 ? 0 : (i / (values.length - 1)) * 64;
      const y = 22 - (v / max) * 18;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg
      viewBox="0 0 64 24"
      width={64}
      height={24}
      className={className}
      aria-hidden
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={pts}
      />
    </svg>
  );
}

function deltaLabel(delta: number, t: (k: string, o?: Record<string, unknown>) => string) {
  if (delta === 0) return t("admin.kpiFlat");
  if (delta > 0) return t("admin.kpiUp", { n: delta });
  return t("admin.kpiDown", { n: Math.abs(delta) });
}

/** Local calendar YYYY-MM-DD (Europe/Madrid-ish; never toISOString UTC). */
function localDateIso(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** REVISION-59 L2: mesmo rango ca a API de exportación (1 ano atrás → 60 días). */
function bookingExportRange(base: Date = new Date()): {
  from: string;
  to: string;
  fileTag: string;
} {
  const mid = new Date(base);
  mid.setHours(12, 0, 0, 0);
  const fromD = new Date(mid);
  fromD.setDate(mid.getDate() - 365);
  const toD = new Date(mid);
  toD.setDate(mid.getDate() + 60);
  const from = localDateIso(fromD);
  const to = localDateIso(toD);
  return { from, to, fileTag: `${from}_${to}` };
}

function nextLocalDays(count: number): string[] {
  const out: string[] = [];
  const base = new Date();
  base.setHours(12, 0, 0, 0);
  for (let i = 0; i < count; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    out.push(localDateIso(d));
  }
  return out;
}

export function AdminHomePage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const { t, i18n } = useTranslation();
  const [dash, setDash] = useState<Awaited<ReturnType<typeof apiX.dashboard>>["data"] | null>(null);
  const [dayRows, setDayRows] = useState<Array<Record<string, unknown>>>([]);
  const [dayDate, setDayDate] = useState(() => localDateIso());
  const [publishErr, setPublishErr] = useState<string | null>(null);
  const [publishErrLink, setPublishErrLink] = useState<"instalacions" | "personalizacion">(
    "instalacions",
  );
  const [publishPendingNote, setPublishPendingNote] = useState(false);
  useEffect(() => {
    void apiX.dashboard(slug).then((r) => setDash(r.data)).catch(() => undefined);
  }, [slug]);
  useEffect(() => {
    void apiX
      .adminDay(slug, dayDate)
      .then((r) => {
        setDayRows(r.data);
        if (r.date) setDayDate(r.date);
      })
      .catch(() => undefined);
  }, [slug, dayDate]);
  const todos = dash?.todos;
  const kpis = dash?.kpis;
  const hasTodos =
    todos &&
    (todos.pendingRequests > 0 ||
      (todos.pendingBookings ?? 0) > 0 ||
      todos.pavilionConflicts > 0 ||
      (todos.openIncidents ?? 0) > 0 ||
      todos.overdueLotteries.length > 0 ||
      todos.activeClosures.length > 0);
  // Grella desde weekHeat do dashboard (mesma fonte que o 19 %).
  const weekHeat = dash?.weekHeat ?? [];
  const weekHasData = weekHeat.length > 0;

  const kpiCards = kpis
    ? [
        {
          key: "bookings",
          label: t("admin.kpiBookingsToday"),
          value: String(kpis.bookingsToday.value),
          delta: kpis.bookingsToday.delta,
          spark: kpis.bookingsToday.spark,
          suffix: "",
        },
        {
          key: "occ",
          label: t("admin.kpiWeekOccupancy"),
          value: `${kpis.weekOccupancy.value}%`,
          delta: kpis.weekOccupancy.delta,
          spark: kpis.weekOccupancy.spark,
          suffix: " pp",
        },
        {
          key: "noshow",
          label: t("admin.kpiNoShowsToday"),
          value: String(kpis.noShowsToday.value),
          delta: kpis.noShowsToday.delta,
          spark: kpis.noShowsToday.spark,
          suffix: "",
        },
        {
          key: "inc",
          label: t("admin.kpiOpenIncidents"),
          value: String(kpis.openIncidents.value),
          delta: kpis.openIncidents.delta,
          spark: kpis.openIncidents.spark,
          suffix: "",
        },
      ]
    : [];

  const dayTitle = formatDate(dayDate, i18n.language);
  return (
    <AdminShell active="" pageTitle={t("admin.navToday")}>
      <p className="m-0 -mt-2 mb-1 text-base font-bold text-graphite">{dayTitle}</p>
      <p className="text-sm text-graphite">{t("admin.homeHintToday")}</p>
      {/* REVISION-40 T13: subtítulo curto; a liña do día ten scroll visible. */}

      {dash?.launch && !dash.launch.published ? (
        <section className="mt-6 pa-card p-5" aria-labelledby="launch-title">
          <h2 id="launch-title" className="m-0 text-lg font-extrabold text-marino">
            {t("admin.launchTitle")}{" "}
            <span className="text-graphite">
              ({dash.launch.done}/{dash.launch.total})
            </span>
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            {dash.launch.items.map((item) => (
              <li key={item.id}>
                <Link
                  to={item.href}
                  className={`font-bold underline ${item.done ? "text-libre" : "text-azul-700"}`}
                >
                  {item.done ? "✔ " : "☐ "}
                  {t(`admin.launch.${item.id}`)}
                </Link>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="pa-btn-primary mt-4"
            onClick={() => {
              setPublishErr(null);
              setPublishErrLink("instalacions");
              void apiX
                .publishPortal(slug)
                .then(() => {
                  setPublishPendingNote(true);
                  void apiX.dashboard(slug).then((r) => setDash(r.data));
                })
                .catch((ex: unknown) => {
                  const err = ex as Error & {
                    payload?: { missing?: string[] };
                  };
                  const missing = err.payload?.missing ?? [];
                  if (missing.includes("active_facility") || missing.includes("schedule")) {
                    setPublishErr(t("admin.launchNeedPublishFacility"));
                    setPublishErrLink("instalacions");
                  } else if (missing.includes("legal")) {
                    setPublishErr(t("admin.launchNeedLegal"));
                    setPublishErrLink("personalizacion");
                  } else {
                    setPublishErr(t("common.error"));
                    setPublishErrLink("instalacions");
                  }
                });
            }}
          >
            {t("admin.launchPublish")}
          </button>
          {publishErr ? (
            <p className="mt-3 text-sm font-bold text-coral" role="alert">
              {publishErr}{" "}
              <Link
                to={
                  publishErrLink === "personalizacion"
                    ? `/c/${slug}/admin/personalizacion`
                    : `/c/${slug}/admin/instalacions`
                }
                className="underline text-azul-700"
              >
                {publishErrLink === "personalizacion"
                  ? t("admin.launchGoPersonalizacion")
                  : t("admin.launchGoFacilities")}
              </Link>
            </p>
          ) : null}
        </section>
      ) : null}

      {publishPendingNote || (dash?.launch?.published && dash.launch.done < dash.launch.total) ? (
        <p className="mt-3 text-sm text-graphite">
          {t("admin.launchStillPending")}
        </p>
      ) : null}

      {kpiCards.length > 0 ? (
        <div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
          {kpiCards.map((k) => (
            <Card key={k.key} lift={false} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="m-0 text-sm font-bold text-graphite">{k.label}</p>
                <Sparkline values={k.spark} className="text-azul" />
              </div>
              <p className="mt-2 m-0 text-3xl font-extrabold text-marino">{k.value}</p>
              <p
                className={`mt-1 m-0 text-sm font-bold ${
                  k.delta > 0 ? "text-libre" : k.delta < 0 ? "text-erro" : "text-graphite"
                }`}
              >
                {deltaLabel(k.delta, t)}
                {k.delta !== 0 ? k.suffix : ""}
                <span className="font-normal text-graphite"> · {t("admin.kpiVsPrevWeek")}</span>
              </p>
            </Card>
          ))}
        </div>
      ) : null}

      <div className="mt-8 flex flex-col gap-8 xl:flex-row">
        <div className="min-w-0 flex-[999_1_560px]">
          <DayLineGantt bookings={dayRows} />
          {weekHasData ? <OccupancyGrid bookings={weekHeat} /> : null}
        </div>

        <aside className="flex min-w-0 flex-col gap-3 lg:flex-[1_1_300px]">
          <h2 className="m-0 text-lg font-extrabold text-marino">{t("admin.todosTitle")}</h2>
          {!todos || !hasTodos ? (
            <Card lift={false} className="p-4 text-sm text-graphite">
              {t("admin.todosEmpty")}
            </Card>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {todos.pendingRequests > 0 ? (
                <li>
                  <Card lift={false} className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <span className="text-sm font-bold">
                      {t("admin.todoRequests", { count: todos.pendingRequests })}
                    </span>
                    <Link to={`/c/${slug}/admin/clubs-pavillon?tab=solicitudes`}>
                      <Button variant="secondary" className="h-11 min-h-11 text-sm">
                        {t("admin.requests")}
                      </Button>
                    </Link>
                  </Card>
                </li>
              ) : null}
              {(todos.pendingBookings ?? 0) > 0
                ? (todos.pendingBookingRows ?? []).map((pb) => (
                    <li key={pb.id}>
                      <Card lift={false} className="flex flex-col gap-2 p-4">
                        <span className="text-sm font-bold">
                          {t("admin.todoPendingBooking", {
                            defaultValue: "Reserva pendente · {{name}} · {{when}}",
                            name: pb.userDisplayName,
                            when: `${pb.date} ${pb.start}`,
                          })}
                        </span>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="primary"
                            className="h-11 min-h-11 text-sm"
                            onClick={() =>
                              void apiX
                                .approveBooking(slug, pb.id)
                                .then(() =>
                                  apiX.dashboard(slug).then((r) => setDash(r.data)),
                                )
                                .catch(() =>
                                  window.alert(t("common.error")),
                                )
                            }
                          >
                            {t("admin.approve", { defaultValue: "Aprobar" })}
                          </Button>
                          <Button
                            variant="secondary"
                            className="h-11 min-h-11 text-sm"
                            onClick={() =>
                              void apiX
                                .rejectBooking(slug, pb.id)
                                .then(() =>
                                  apiX.dashboard(slug).then((r) => setDash(r.data)),
                                )
                                .catch(() =>
                                  window.alert(t("common.error")),
                                )
                            }
                          >
                            {t("admin.reject", { defaultValue: "Rexeitar" })}
                          </Button>
                        </div>
                      </Card>
                    </li>
                  ))
                : null}
              {todos.pavilionConflicts > 0 ? (
                <li>
                  <Card lift={false} className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <span className="text-sm font-bold">
                      {t("admin.todoConflicts", { count: todos.pavilionConflicts })}
                    </span>
                    <Link to={`/c/${slug}/admin/clubs-pavillon?tab=pavillon`}>
                      <Button variant="secondary" className="h-11 min-h-11 text-sm">
                        {t("nav.pavillon")}
                      </Button>
                    </Link>
                  </Card>
                </li>
              ) : null}
              {(todos.openIncidents ?? 0) > 0 ? (
                <li>
                  <Card lift={false} className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <span className="text-sm font-bold">
                      {t("admin.openIncidents", { count: todos.openIncidents })}
                    </span>
                    <Link to={`/c/${slug}/admin/incidencias`}>
                      <Button variant="secondary" className="h-11 min-h-11 text-sm">
                        {t("admin.incidents")}
                      </Button>
                    </Link>
                  </Card>
                </li>
              ) : null}
              {todos.overdueLotteries.map((a) => (
                <li key={a.id}>
                  <Card lift={false} className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <span className="text-sm font-bold">
                      {t("admin.todoLottery", { name: a.name, date: a.deadline })}
                    </span>
                    <Link to={`/c/${slug}/admin/actividades/${a.id}`}>
                      <Button variant="secondary" className="h-11 min-h-11 text-sm">
                        {t("activities.runDraw")}
                      </Button>
                    </Link>
                  </Card>
                </li>
              ))}
              {todos.activeClosures.map((c) => (
                <li key={c.id}>
                  <Card lift={false} className="p-4 text-sm">
                    {t("admin.todoClosure", { reason: c.reason })} ·{" "}
                    {formatDate(c.startsAt.slice(0, 10), i18n.language)}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      <section className="mt-10" aria-label={t("admin.dayBookings")}>
        <h2 className="m-0 text-lg font-extrabold text-marino">{t("admin.dayBookings")}</h2>
        <AdminDayBookingsPanel date={dayDate} onDateChange={setDayDate} rows={dayRows} onReload={() => {
          void apiX.adminDay(slug, dayDate).then((r) => setDayRows(r.data));
        }} />
      </section>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link to={`/c/${slug}/admin/reservar-nome`} className="inline-flex">
          <Button variant="secondary" className="text-sm">
            <IconClipboard size={16} />
            {t("admin.bookFor")}
          </Button>
        </Link>
        <Link to={`/c/${slug}/admin/peches`} className="inline-flex">
          <Button variant="secondary" className="text-sm">
            <IconBuilding size={16} />
            {t("admin.newClosure")}
          </Button>
        </Link>
      </div>
    </AdminShell>
  );
}

/** Lista de reservas do día (Hoxe + ruta legado). */
function AdminDayBookingsPanel({
  date,
  onDateChange,
  rows,
  onReload,
}: {
  date: string;
  onDateChange: (iso: string) => void;
  rows: Array<Record<string, unknown>>;
  onReload: () => void;
}) {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const { t, i18n } = useTranslation();
  const [q, setQ] = useState("");
  const [facilityFilter, setFacilityFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  /* REVISION-39 L13: diálogo con motivo (sen window.prompt). */
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const facilities = useMemo(() => {
    const names = new Set<string>();
    for (const b of rows) {
      const n = String(b.facilityName ?? "");
      if (n) names.add(n);
    }
    return [...names].sort();
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows;
    if (facilityFilter) {
      list = list.filter((b) => String(b.facilityName ?? "") === facilityFilter);
    }
    if (statusFilter) {
      list = list.filter((b) => String(b.status ?? "") === statusFilter);
    }
    return filterByQuery(list, q, (b) => [
      String(b.userDisplayName ?? ""),
      String(b.start ?? ""),
      String(b.status ?? ""),
      String(b.facilityName ?? ""),
    ]);
  }, [rows, q, facilityFilter, statusFilter]);

  const openCancel = (id: string) => {
    setCancelId(id);
    setCancelReason("");
    setMsg(null);
  };

  const confirmCancel = async () => {
    if (!cancelId) return;
    const reason = cancelReason.trim();
    setBusyId(cancelId);
    setMsg(null);
    try {
      await apiX.adminCancelBooking(slug, cancelId, reason);
      setMsg(t("admin.bookingCancelled"));
      setCancelId(null);
      setCancelReason("");
      onReload();
    } catch {
      setMsg(t("common.error"));
    } finally {
      setBusyId(null);
    }
  };

  const noShow = async (id: string) => {
    setBusyId(id);
    setMsg(null);
    try {
      await apiX.adminNoShow(slug, id);
      setMsg(t("admin.markedNoShow"));
      onReload();
    } catch {
      setMsg(t("common.error"));
    } finally {
      setBusyId(null);
    }
  };

  const [pickOther, setPickOther] = useState(false);

  const shiftDate = (delta: number) => {
    const d = new Date(`${date || localDateIso()}T12:00:00`);
    d.setDate(d.getDate() + delta);
    onDateChange(localDateIso(d));
    setPickOther(false);
  };

  const slotEnded = (end: string) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(end.trim());
    if (!m) return false;
    const [, h, min] = m;
    const slotEnd = new Date(`${date}T${h!.padStart(2, "0")}:${min}:00`);
    return Date.now() > slotEnd.getTime();
  };

  const actions = (id: string, status: string, end: string, compact = false) =>
    status === "confirmed" ? (
      <div className={`flex flex-wrap gap-2 ${compact ? "" : ""}`}>
        {!slotEnded(end) ? (
          <button
            type="button"
            className="pa-ui-interactive min-h-11 border-0 bg-transparent p-0 text-sm font-bold text-erro underline"
            disabled={busyId === id}
            onClick={() => openCancel(id)}
          >
            {t("bookings.cancel")}
          </button>
        ) : null}
        <button
          type="button"
          className="pa-ui-interactive min-h-11 border-0 bg-transparent p-0 text-sm font-bold underline"
          disabled={busyId === id}
          onClick={() => void noShow(id)}
        >
          {t("admin.noShow")}
        </button>
      </div>
    ) : null;

  return (
    <>
      <p className="mt-1 text-sm text-graphite">{t("admin.dayHint")}</p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <button
          type="button"
          className="pa-btn-secondary min-h-11 px-3"
          aria-label={t("common.prev")}
          onClick={() => shiftDate(-1)}
        >
          ‹
        </button>
        <button
          type="button"
          className="pa-btn-secondary min-h-11 px-3"
          aria-label={t("common.next")}
          onClick={() => shiftDate(1)}
        >
          ›
        </button>
        <button
          type="button"
          className="pa-btn-secondary min-h-11 px-3 text-sm"
          onClick={() => {
            onDateChange(localDateIso());
            setPickOther(false);
          }}
        >
          {t("admin.today")}
        </button>
        <p className="m-0 min-h-11 px-1 text-base font-extrabold leading-[44px] text-marino">
          {formatDate(date, i18n.language)}
        </p>
        <button
          type="button"
          className="min-h-11 border-0 bg-transparent p-0 text-sm font-bold text-azul-700 underline"
          onClick={() => setPickOther((v) => !v)}
        >
          {t("admin.otherDate")}
        </button>
      </div>
      {pickOther ? (
        <div className="mt-2 max-w-xs">
          <DateField
            label={t("admin.date")}
            value={date}
            onChange={(iso) => {
              onDateChange(iso);
              setPickOther(false);
            }}
            locale={i18n.language}
          />
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t("admin.facilities")}>
        <button
          type="button"
          className={`pa-ui-interactive min-h-11 rounded-full border-[1.5px] px-3 text-sm font-extrabold ${
            !facilityFilter ? "border-marino bg-marino text-on-dark" : "border-line bg-surface text-marino"
          }`}
          onClick={() => setFacilityFilter("")}
        >
          {t("admin.filterAll")}
        </button>
        {facilities.map((f) => (
          <button
            key={f}
            type="button"
            className={`pa-ui-interactive min-h-11 rounded-full border-[1.5px] px-3 text-sm font-extrabold ${
              facilityFilter === f
                ? "border-marino bg-marino text-on-dark"
                : "border-line bg-surface text-marino"
            }`}
            onClick={() => setFacilityFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={t("admin.status")}>
        {["", "confirmed", "checked_in", "no_show", "cancelled"].map((s) => (
          <button
            key={s || "all"}
            type="button"
            className={`pa-ui-interactive min-h-11 rounded-full border-[1.5px] px-3 text-sm font-extrabold ${
              statusFilter === s
                ? "border-azul bg-azul text-on-dark"
                : "border-line bg-surface text-marino"
            }`}
            onClick={() => setStatusFilter(s)}
          >
            {s ? t(`status.${s}`, { defaultValue: s }) : t("admin.filterAll")}
          </button>
        ))}
      </div>
      <ListSearch
        value={q}
        onChange={setQ}
        placeholder={t("admin.search")}
        count={filtered.length}
      />
      {msg ? (
        <p className="pa-ok-banner mt-3 text-sm" role="status">
          ✓ {msg}
        </p>
      ) : null}
      {filtered.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title={t("admin.dayEmpty")}
            body={t("admin.dayEmptyHint")}
            actionLabel={t("admin.bookFor")}
            actionTo={`/c/${slug}/admin/reservar-nome`}
          />
        </div>
      ) : (
        <>
          {/* Móbil &lt;768: tarxetas */}
          <ul className="mt-4 flex list-none flex-col gap-3 p-0 md:hidden">
            {filtered.map((b) => {
              const id = String(b.id);
              const status = String(b.status);
              return (
                <li key={id} className="rounded-card border border-line bg-surface p-4">
                  <p className="m-0 text-base font-extrabold text-marino">
                    {String(b.start)}–{String(b.end)}
                  </p>
                  <p className="mt-1 m-0 text-sm text-graphite">{String(b.facilityName ?? "")}</p>
                  <p className="mt-1 m-0 text-sm font-bold">{String(b.userDisplayName)}</p>
                  <p className="mt-2 m-0">
                    <span className="rounded-full bg-azul-25 px-2.5 py-1 text-[12px] font-extrabold text-azul-700">
                      {t(`status.${status}`, { defaultValue: status })}
                    </span>
                  </p>
                  <div className="mt-3">{actions(id, status, String(b.end ?? ""), true)}</div>
                </li>
              );
            })}
          </ul>
          <div className="mt-4 hidden max-h-[70vh] overflow-auto rounded-card border border-line md:block">
            <table className="w-full min-w-[560px] border-collapse text-left text-sm">
              <thead className="sticky top-0 z-[1] bg-surface">
                <tr className="border-b border-line text-graphite">
                  <th className="h-[52px] px-3 font-extrabold">{t("reserve.time")}</th>
                  <th className="h-[52px] px-3 font-extrabold">{t("admin.facilities")}</th>
                  <th className="h-[52px] px-3 font-extrabold">{t("admin.person")}</th>
                  <th className="h-[52px] px-3 font-extrabold">{t("admin.status")}</th>
                  <th className="h-[52px] px-3 font-extrabold">{t("admin.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((b) => {
                  const id = String(b.id);
                  const status = String(b.status);
                  return (
                    <tr key={id} className="border-b border-line/60">
                      <td className="h-[52px] px-3 font-extrabold">
                        {String(b.start)}–{String(b.end)}
                      </td>
                      <td className="h-[52px] px-3 text-graphite">
                        {String(b.facilityName ?? "")}
                      </td>
                      <td className="h-[52px] px-3">{String(b.userDisplayName)}</td>
                      <td className="h-[52px] px-3">
                        <span className="rounded-full bg-azul-25 px-2.5 py-1 text-[12px] font-extrabold text-azul-700">
                          {t(`status.${status}`, { defaultValue: status })}
                        </span>
                      </td>
                      <td className="h-[52px] px-3">
                        {actions(id, status, String(b.end ?? ""))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      {cancelId ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(0,43,74,0.4)] p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-cancel-title"
        >
          <form
            className="pa-card w-full max-w-md p-6"
            onSubmit={(e) => {
              e.preventDefault();
              void confirmCancel();
            }}
          >
            <h2 id="admin-cancel-title" className="pa-h2">
              {t("admin.cancelBookingTitle")}
            </h2>
            <p className="mt-2 text-sm text-graphite">
              {t("admin.cancelBookingBody")}
            </p>
            <label className="mt-4 block text-sm font-bold">
              {t("admin.cancelReason")}
              <input
                className="pa-input mt-1 w-full"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                autoFocus
              />
            </label>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="submit"
                className="pa-btn-danger"
                disabled={busyId === cancelId}
              >
                {t("admin.cancelBookingConfirm")}
              </button>
              <button
                type="button"
                className="pa-btn-secondary"
                onClick={() => {
                  setCancelId(null);
                  setCancelReason("");
                }}
              >
                {t("common.cancel")}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}

/** Ruta legado: o contido vive en Hoxe; mantemos a páxina por compat. */
export function AdminDayPage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const { t } = useTranslation();
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [date, setDate] = useState(() => localDateIso());

  const load = useCallback(() => {
    void apiX.adminDay(slug, date || undefined).then((r) => {
      setRows(r.data);
      setDate(r.date);
    });
  }, [slug, date]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AdminShell active="reservas" pageTitle={t("admin.dayBookings")}>
      <AdminDayBookingsPanel date={date} onDateChange={setDate} rows={rows} onReload={load} />
    </AdminShell>
  );
}

function weekdayIndexFromIso(iso: string): number {
  return new Date(`${iso}T12:00:00`).getDay();
}

function dayNumberFromIso(iso: string): number {
  return Number(iso.slice(8, 10));
}

export function AdminBookForPage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const { t, i18n } = useTranslation();
  const [facilities, setFacilities] = useState<
    Array<{ id: string; name: string; units: Array<{ id: string; name: string }> }>
  >([]);
  const [facilityId, setFacilityId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [date, setDate] = useState(() => localDateIso());
  const [days, setDays] = useState(() => nextLocalDays(7));
  const [slots, setSlots] = useState<Array<{ id: string; start: string; end: string; status: string }>>([]);
  const [slotId, setSlotId] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [citizenId, setCitizenId] = useState<string | undefined>();
  const [searchQ, setSearchQ] = useState("");
  const [people, setPeople] = useState<
    Array<{
      id: string;
      displayName: string;
      email: string | null;
      phone: string | null;
      bookings?: Array<{ id: string; date: string; status: string }>;
    }>
  >([]);
  const [selectedActiveCount, setSelectedActiveCount] = useState(0);
  const [maxActiveBookings, setMaxActiveBookings] = useState(3);
  const [noAccount, setNoAccount] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{
    id: string;
    shortCode: string;
    date: string;
    start: string;
    end: string;
    userDisplayName: string;
  } | null>(null);
  const [mailMsg, setMailMsg] = useState<string | null>(null);
  const [mailBusy, setMailBusy] = useState(false);
  const [slotsTick, setSlotsTick] = useState(0);
  const [draftReady, setDraftReady] = useState(false);

  useEffect(() => {
    const draft = loadFormDraft<{
      facilityId?: string;
      unitId?: string;
      date?: string;
      slotId?: string;
      name?: string;
      phone?: string;
      email?: string;
      citizenId?: string;
      searchQ?: string;
      noAccount?: boolean;
    }>(bookForDraftKey(slug));
    if (draft) {
      if (draft.facilityId) setFacilityId(draft.facilityId);
      if (draft.unitId) setUnitId(draft.unitId);
      if (draft.date) setDate(draft.date);
      if (draft.slotId) setSlotId(draft.slotId);
      if (draft.name) setName(draft.name);
      if (draft.phone) setPhone(draft.phone);
      if (draft.email) setEmail(draft.email);
      if (draft.citizenId) setCitizenId(draft.citizenId);
      if (draft.searchQ) setSearchQ(draft.searchQ);
      if (draft.noAccount) setNoAccount(draft.noAccount);
    }
    setDraftReady(true);
  }, [slug]);

  useEffect(() => {
    if (!draftReady || done) return;
    saveFormDraft(bookForDraftKey(slug), {
      facilityId,
      unitId,
      date,
      slotId,
      name,
      phone,
      email,
      citizenId,
      searchQ,
      noAccount,
    });
  }, [
    draftReady,
    done,
    slug,
    facilityId,
    unitId,
    date,
    slotId,
    name,
    phone,
    email,
    citizenId,
    searchQ,
    noAccount,
  ]);

  useEffect(() => {
    void apiX.adminFacilities(slug).then((r) => {
      const active = r.data.filter((f) => f.active);
      setFacilities(
        active.map((f) => ({
          id: f.id,
          name: f.name,
          units: f.units,
        })),
      );
      const first = active[0];
      if (first) {
        setFacilityId((prev) => prev || first.id);
        setUnitId((prev) => {
          if (prev) return prev;
          return first.units[0]?.id ?? "";
        });
      }
    });
    void apiX
      .normas(slug)
      .then((r) => {
        setMaxActiveBookings(r.data.rules?.maxActiveBookings ?? 3);
        /* REVISION-57 W1 */
        const antelation = Math.max(
          1,
          Number(r.data.rules?.bookingAntelationDays ?? 7) || 7,
        );
        setDays(nextLocalDays(antelation));
      })
      .catch(() => undefined);
  }, [slug]);

  useEffect(() => {
    if (!facilityId || !date) return;
    void api
      .availability(slug, {
        facilityId,
        unitId: unitId || undefined,
        date,
      })
      .then((r) => {
        const free = r.data.filter(
          (s) => s.status === "free" && (!unitId || s.unitId === unitId),
        );
        setSlots(free);
        setSlotId((prev) => (prev && free.some((s) => s.id === prev) ? prev : ""));
      })
      .catch(() => setSlots([]));
  }, [slug, facilityId, unitId, date, slotsTick]);

  useEffect(() => {
    if (noAccount || searchQ.trim().length < 2) {
      setPeople([]);
      return;
    }
    const handle = window.setTimeout(() => {
      void apiX
        .searchPeople(slug, searchQ.trim())
        .then((r) => setPeople(r.data))
        .catch(() => setPeople([]));
    }, 250);
    return () => window.clearTimeout(handle);
  }, [slug, searchQ, noAccount]);

  const units = facilities.find((f) => f.id === facilityId)?.units ?? [];
  const personReady = noAccount
    ? name.trim().length > 0 && phone.trim().length >= 6
    : !!citizenId && name.trim().length > 0;
  const showSchedule = personReady;

  /* REVISION-18 T6: se hoxe non hai franxas, saltar ao primeiro día con libres. */
  useEffect(() => {
    if (!facilityId || !unitId || !personReady) return;
    let cancelled = false;
    void (async () => {
      for (const iso of days) {
        const r = await api.availability(slug, {
          facilityId,
          unitId,
          date: iso,
        });
        if (cancelled) return;
        const free = r.data.filter(
          (s) => s.status === "free" && s.unitId === unitId,
        );
        if (free.length > 0) {
          setDate((prev) => (prev === iso ? prev : iso));
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, facilityId, unitId, personReady, days]);
  const showUnit = showSchedule && !!facilityId && units.length > 0;
  const showDay = showSchedule && !!facilityId && (!!unitId || units.length === 0);
  const showSlot = showDay && !!date && !!unitId;

  const selectFacility = (id: string) => {
    setFacilityId(id);
    const fac = facilities.find((f) => f.id === id);
    setUnitId(fac?.units[0]?.id ?? "");
    setSlotId("");
  };

  const resetForSamePerson = () => {
    setDone(null);
    setMailMsg(null);
    setSlotId("");
    setErr(null);
    setSlotsTick((n) => n + 1);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMailMsg(null);
    if (!facilityId || !unitId || !date || !slotId || !name.trim()) {
      setErr(t("admin.fieldRequired"));
      return;
    }
    if (noAccount && phone.trim().length < 6) {
      setErr(t("admin.fieldRequired"));
      return;
    }
    if (
      !noAccount &&
      maxActiveBookings > 0 &&
      selectedActiveCount >= maxActiveBookings
    ) {
      const ok = window.confirm(
        t("admin.bookForMaxWarn", {
          name: name.trim() || "A persoa",
          count: selectedActiveCount,
          max: maxActiveBookings,
        }),
      );
      if (!ok) return;
    }
    setSubmitting(true);
    try {
      const { data } = await apiX.bookFor(slug, {
        slotId,
        citizenName: name.trim(),
        citizenId: noAccount ? undefined : citizenId,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
      });
      clearFormDraft(bookForDraftKey(slug));
      setDone(data);
      setSlotId("");
      setSlotsTick((n) => n + 1);
    } catch (ex) {
      const code = ex instanceof Error ? ex.message : "";
      const key = code ? `error.${code}` : "";
      const translated = key ? t(key) : "";
      setErr(translated && translated !== key ? translated : t("common.error"));
    } finally {
      setSubmitting(false);
    }
  };

  const sendMail = async () => {
    if (!done) return;
    setMailBusy(true);
    setMailMsg(null);
    try {
      const to = email.trim() || undefined;
      if (!to && noAccount) {
        setMailMsg(t("admin.bookForSendMailNeed"));
        return;
      }
      const r = await apiX.bookForSendMail(slug, done.id, to);
      setMailMsg(t("admin.bookForSendMailOk", { email: r.data.to }));
    } catch (ex) {
      const msg = ex instanceof Error ? ex.message : t("common.error");
      setMailMsg(msg === "no_email" ? t("admin.bookForSendMailNeed") : msg);
    } finally {
      setMailBusy(false);
    }
  };

  const selectedSlot = slots.find((s) => s.id === slotId);
  const facilityName = facilities.find((f) => f.id === facilityId)?.name ?? "";
  const unitName = units.find((u) => u.id === unitId)?.name ?? "";
  const dayNum = date ? dayNumberFromIso(date) : "";
  const weekday = date ? formatWeekdayShort(date, i18n.language) : "";
  const dayLabel = date
    ? t(`weekdayShort.${weekdayIndexFromIso(date)}`)
    : "";
  const canConfirm = !!(
    personReady &&
    facilityId &&
    unitId &&
    date &&
    slotId &&
    name.trim()
  );
  const ticketSubtitle = selectedSlot
    ? `${facilityName}${unitName ? ` · ${unitName}` : ""} · ${selectedSlot.start}`
    : facilityName || t("admin.bookForHint");

  const ticket = (
    <Ticket
      weekday={weekday || "—"}
      day={dayNum || "—"}
      title={name.trim() || t("admin.citizenName")}
      subtitle={ticketSubtitle}
      eyebrow={t("admin.bookForSummary")}
      compact
    />
  );

  if (done) {
    return (
      <AdminShell active="reservar-nome" pageTitle={t("admin.bookFor")}>
        <div
          className="mt-2 flex max-w-lg flex-col gap-4 rounded-2xl border border-line bg-surface p-5"
          data-testid="book-for-done"
        >
          <p className="pa-ok-banner m-0">✓ {t("admin.bookForDone")}</p>
          <p className="m-0 text-sm text-graphite">
            {done.userDisplayName} · {formatDate(done.date)} · {done.start}
          </p>
          <p className="m-0 font-display text-3xl font-extrabold tracking-wide text-marino">
            <span className="sr-only">{t("admin.bookForCode")}: </span>
            {done.shortCode}
          </p>
          {noAccount || !email ? (
            <label className="flex flex-col gap-1.5 text-sm font-bold">
              {t("admin.bookForSendMailNeed")}
              <input
                className="pa-input min-h-12 text-base"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </label>
          ) : null}
          {mailMsg ? <p className="m-0 text-sm font-bold text-marino">{mailMsg}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={mailBusy}
              onClick={() => void sendMail()}
            >
              {t("admin.bookForSendMail")}
            </Button>
            <Button type="button" onClick={resetForSamePerson}>
              {t("admin.bookForAnother")}
            </Button>
          </div>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell active="reservar-nome" pageTitle={t("admin.bookFor")}>
      <p className="text-sm text-graphite">{t("admin.bookForHint")}</p>
      <form
        onSubmit={(e) => void submit(e)}
        className={`mt-4 ${
          canConfirm ? "pb-[calc(7.5rem+env(safe-area-inset-bottom))] lg:pb-0" : "pb-4"
        }`}
        noValidate
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-6">
            <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
              <legend className="mb-0 text-[13px] font-extrabold tracking-[0.08em] text-graphite">
                {t("admin.pickPersonFirst")}
              </legend>

              <label className="flex min-h-12 items-center gap-3 text-base font-bold text-marino">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-[var(--pa-azul,#2563eb)]"
                  checked={noAccount}
                  onChange={(e) => {
                    setNoAccount(e.target.checked);
                    if (e.target.checked) {
                      setCitizenId(undefined);
                      setPeople([]);
                      setSearchQ("");
                    }
                  }}
                />
                {t("admin.noAccount")}
              </label>

              {!noAccount ? (
                <label className="flex flex-col gap-1.5 text-sm font-bold">
                  {t("admin.citizenSearch")}
                  <input
                    className="pa-input min-h-14 text-base"
                    value={searchQ}
                    onChange={(e) => {
                      setSearchQ(e.target.value);
                      setCitizenId(undefined);
                    }}
                    placeholder={t("admin.citizenSearch")}
                    autoComplete="off"
                    data-testid="book-for-search"
                  />
                </label>
              ) : null}

              {!noAccount && people.length > 0 ? (
                <ul className="m-0 max-h-48 list-none overflow-auto rounded-btn border border-line p-0">
                  {people.map((p) => (
                    <li key={p.id} className="border-b border-line last:border-0">
                      <button
                        type="button"
                        className={`block min-h-14 w-full px-4 py-3 text-left text-base hover:bg-area ${
                          citizenId === p.id ? "bg-area font-extrabold" : "font-bold"
                        }`}
                        onClick={() => {
                          setCitizenId(p.id);
                          setName(p.displayName);
                          setSearchQ(p.displayName);
                          setPhone(p.phone ?? "");
                          setEmail(p.email ?? "");
                          setSelectedActiveCount(p.bookings?.length ?? 0);
                          setPeople([]);
                        }}
                      >
                        {p.displayName}
                        {p.email || p.phone ? (
                          <span className="mt-0.5 block text-sm font-medium text-graphite">
                            {[p.email, p.phone].filter(Boolean).join(" · ")}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              {noAccount ? (
                <>
                  <label className="flex flex-col gap-1.5 text-sm font-bold">
                    {t("admin.citizenName")}
                    <input
                      className="pa-input min-h-14 text-base"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={t("admin.citizenName")}
                      autoComplete="name"
                      required
                    />
                  </label>

                  <label className="flex flex-col gap-1.5 text-sm font-bold">
                    {t("admin.citizenPhone")}
                    <input
                      className="pa-input min-h-14 text-base"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder={t("admin.citizenPhonePh")}
                      autoComplete="tel"
                      inputMode="tel"
                      required
                    />
                  </label>
                  <p className="m-0 text-sm text-graphite">{t("admin.noAccountHint")}</p>
                </>
              ) : null}
            </fieldset>

            {showSchedule ? (
              <fieldset className="m-0 min-w-0 border-0 p-0">
                <legend className="mb-2.5 text-[13px] font-extrabold tracking-[0.08em] text-graphite">
                  {t("admin.pickFacility")}
                </legend>
                <div className="flex flex-col gap-2" role="group" aria-label={t("admin.pickFacility")}>
                  {facilities.map((f) => {
                    const on = facilityId === f.id;
                    return (
                      <button
                        key={f.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => selectFacility(f.id)}
                        className={`pa-ui-interactive flex min-h-14 items-center rounded-btn border-[1.5px] px-4 text-left text-base font-extrabold ${
                          on
                            ? "border-azul bg-azul text-on-dark pa-ui-interactive-on-dark"
                            : "border-line bg-surface text-marino hover:border-marino"
                        }`}
                      >
                        {f.name}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ) : null}

            {showUnit ? (
              <fieldset className="m-0 min-w-0 border-0 p-0">
                <legend className="mb-2.5 text-[13px] font-extrabold tracking-[0.08em] text-graphite">
                  {t("admin.pickUnit")}
                </legend>
                {units.length <= 3 ? (
                  <Segmented
                    tone="pill"
                    aria-label={t("admin.pickUnit")}
                    value={unitId}
                    onChange={(id) => {
                      setUnitId(id);
                      setSlotId("");
                    }}
                    options={units.map((u) => ({ value: u.id, label: u.name }))}
                  />
                ) : (
                  <div className="flex flex-col gap-2" role="group" aria-label={t("admin.pickUnit")}>
                    {units.map((u) => {
                      const on = unitId === u.id;
                      return (
                        <button
                          key={u.id}
                          type="button"
                          aria-pressed={on}
                          onClick={() => {
                            setUnitId(u.id);
                            setSlotId("");
                          }}
                          className={`pa-ui-interactive flex min-h-14 items-center rounded-btn border-[1.5px] px-4 text-left text-base font-extrabold ${
                            on
                              ? "border-azul bg-azul text-on-dark pa-ui-interactive-on-dark"
                              : "border-line bg-surface text-marino hover:border-marino"
                          }`}
                        >
                          {u.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </fieldset>
            ) : null}

            {showDay ? (
              <fieldset className="m-0 min-w-0 border-0 p-0">
                <legend className="mb-2.5 text-[13px] font-extrabold tracking-[0.08em] text-graphite">
                  {t("admin.pickDay")}
                </legend>
                <div className="flex min-w-0 gap-2 overflow-x-auto scroll-smooth pb-1 snap-x snap-mandatory [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {days.map((iso) => (
                    <DayTile
                      key={iso}
                      weekday={t(`weekdayShort.${weekdayIndexFromIso(iso)}`)}
                      day={dayNumberFromIso(iso)}
                      pressed={iso === date}
                      hasFree={iso === date ? slots.length > 0 : true}
                      onClick={() => setDate(iso)}
                      className="snap-start"
                    />
                  ))}
                </div>
              </fieldset>
            ) : null}

            {showSlot ? (
              <fieldset className="m-0 border-0 p-0">
                <legend className="mb-2.5 text-[13px] font-extrabold tracking-[0.08em] text-graphite">
                  {t("reserve.hourLegend", { day: dayLabel.toUpperCase() })}
                </legend>
                {slots.length === 0 ? (
                  <p className="m-0 text-sm text-graphite">{t("reserve.noSlots")}</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {slots.map((s) => (
                      <SlotButton
                        key={s.id}
                        hour={s.start}
                        state={slotId === s.id ? "escollida" : "libre"}
                        title={`${s.start}–${s.end}`}
                        onClick={() => setSlotId(s.id)}
                      />
                    ))}
                  </div>
                )}
              </fieldset>
            ) : null}

            {err ? (
              <p className="m-0 text-sm font-bold text-[var(--pa-warn-text,#8a5a00)]" role="alert">
                {err}
              </p>
            ) : null}

            <div className="hidden lg:block">
              <Button type="submit" disabled={!canConfirm || submitting} className="min-h-12 w-full max-w-sm">
                {t("reserve.confirm")}
              </Button>
            </div>
          </div>

          {canConfirm ? (
            <aside className="hidden lg:sticky lg:top-6 lg:block lg:self-start">{ticket}</aside>
          ) : null}
        </div>

        {canConfirm ? (
          <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
            <div className="mx-auto flex max-w-[1280px] flex-col gap-2.5">
              <div className="max-h-[5.5rem] overflow-hidden">{ticket}</div>
              <Button type="submit" disabled={submitting} className="min-h-12 w-full">
                {t("reserve.confirm")}
              </Button>
            </div>
          </div>
        ) : null}
      </form>
    </AdminShell>
  );
}

export {
  AdminFacilitiesEditorPage as AdminFacilitiesPage,
  AdminFacilityDetailPage,
} from "./AdminMellorasPages";

export {
  AdminActivitiesEditorPage as AdminActivitiesPage,
  AdminActivityDetailPage,
} from "./AdminMellorasPages";

export function AdminPavilionPage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const [data, setData] = useState<Awaited<ReturnType<typeof api.pavilion>>["data"] | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [units, setUnits] = useState<
    Array<{ id: string; name: string; facilityId: string }>
  >([]);
  const [editMatchId, setEditMatchId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editStart, setEditStart] = useState("10:00");
  const [editEnd, setEditEnd] = useState("12:00");
  const [editUnitId, setEditUnitId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void api
      .pavilion(slug, { weekOffset })
      .then((r) => setData(r.data))
      .catch(() => setError(t("common.error")));
  }, [slug, t, weekOffset]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    void api.facilities(slug).then(async (r) => {
      const all: Array<{ id: string; name: string; facilityId: string }> = [];
      for (const f of r.data) {
        if (!/pavill/i.test(f.type)) continue;
        try {
          const detail = await api.facility(slug, f.id);
          for (const u of detail.data.units) {
            all.push({
              id: u.id,
              name: `${f.name} · ${u.name}`,
              facilityId: f.id,
            });
          }
        } catch {
          /* skip */
        }
      }
      setUnits(all);
    });
  }, [slug]);

  /* REVISION-48 Y4: folla móbil como reservar (barra inferior + fondo escuro). */
  useEffect(() => {
    if (!editMatchId) {
      document.documentElement.classList.remove("pa-reserve-sheet-open");
      return;
    }
    document.documentElement.classList.add("pa-reserve-sheet-open");
    return () => {
      document.documentElement.classList.remove("pa-reserve-sheet-open");
    };
  }, [editMatchId]);

  const isAdmin = user?.role === "admin";

  const facilityIdFor = (uid: string) =>
    units.find((u) => u.id === uid)?.facilityId ??
    data?.units?.find((u) => u.id === uid)?.facilityId ??
    "";

  const moveUnits: MoveUnitLike[] = useMemo(() => {
    if (data?.units?.length) {
      return data.units.map((u) => ({
        id: u.id,
        name: u.name,
        incompatibleWith: u.incompatibleWith ?? [],
      }));
    }
    return units.map((u) => ({ id: u.id, name: u.name, incompatibleWith: [] }));
  }, [data?.units, units]);

  const unitIdForKind = (kind: "full" | "a" | "b") => {
    const hit = moveUnits.find((u) => unitKind(u.id, moveUnits) === kind);
    return hit?.id ?? moveUnits[0]?.id ?? units[0]?.id ?? "";
  };

  const openEditMatch = (
    m: Awaited<ReturnType<typeof api.pavilion>>["data"]["matches"][number],
  ) => {
    if (matchIsPast(m)) return;
    setEditMatchId(m.id);
    setEditDate(m.date);
    setEditStart(m.start);
    setEditEnd(m.end);
    setEditUnitId(
      m.unitId ??
        moveUnits.find((u) => u.name === m.unit || u.name.endsWith(m.unit))?.id ??
        units.find((u) => u.name.endsWith(m.unit) || u.name.includes(m.unit))?.id ??
        "",
    );
    setError(null);
  };

  const editMatch = data?.matches.find((m) => m.id === editMatchId) ?? null;

  /* REVISION-51 B1: suxestións desde a API (mesma validación que mover). */
  const [freeSuggestions, setFreeSuggestions] = useState<
    Array<{ date: string; start: string; end: string }>
  >([]);
  useEffect(() => {
    if (!editMatchId || !editUnitId) {
      setFreeSuggestions([]);
      return;
    }
    let cancelled = false;
    const facilityId = facilityIdFor(editUnitId);
    void apiX
      .matchFreeHours(slug, editMatchId, {
        unitId: editUnitId,
        facilityId: facilityId || undefined,
        weekOffset,
      })
      .then((r) => {
        if (!cancelled) setFreeSuggestions(r.data);
      })
      .catch(() => {
        if (!cancelled) setFreeSuggestions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [editMatchId, editUnitId, slug, weekOffset, units, data?.units]);

  const editUnchanged =
    !!editMatch &&
    moveUnchanged({
      from: {
        date: editMatch.date,
        start: editMatch.start,
        end: editMatch.end,
        unitId: editMatch.unitId ?? editUnitId,
      },
      to: { date: editDate, start: editStart, end: editEnd, unitId: editUnitId },
    });

  const setStartKeepDuration = (start: string) => {
    const dur = editMatch ? matchDurationMin(editMatch) : hmToMin(editEnd) - hmToMin(editStart);
    setEditStart(start);
    setEditEnd(minToHm(hmToMin(start) + Math.max(15, dur)));
  };

  const submitMoveMatch = async () => {
    if (!editMatchId) return;
    const facilityId = facilityIdFor(editUnitId);
    if (!editUnitId || !facilityId || !editDate) {
      setError(t("common.error"));
      return;
    }
    if (hmToMin(editEnd) <= hmToMin(editStart)) {
      setError(t("clubs.endAfterStart"));
      return;
    }
    setError(null);
    setMsg(null);
    try {
      const moved = await apiX.moveMatch(slug, editMatchId, {
        facilityId,
        unitId: editUnitId,
        date: editDate,
        start: editStart,
        end: editEnd,
      });
      const names = (
        moved as { data?: { notifiedClubNames?: string[] } }
      )?.data?.notifiedClubNames;
      setMsg(
        names?.length
          ? t("admin.movedNotified", { clubs: names.join(", ") })
          : t("admin.moved"),
      );
      setEditMatchId(null);
      load();
    } catch (ex) {
      const code = ex instanceof Error ? ex.message : "";
      const payload = (
        ex as Error & {
          payload?: { conflicts?: Array<{ detail?: string }> };
        }
      )?.payload;
      if (code === "conflict") {
        const details = (payload?.conflicts ?? [])
          .map((c) => c.detail)
          .filter(Boolean);
        setError(
          details.length
            ? t("admin.moveConflict", { list: details.join("; ") })
            : t("admin.moveConflictEmpty"),
        );
      } else if (code === "invalid_time") setError(t("clubs.endAfterStart"));
      else if (code === "outside_hours") setError(t("admin.moveOutsideHours"));
      else if (code === "in_past") setError(t("admin.moveInPast"));
      else if (code === "no_change") setError(t("admin.moveNoChange"));
      else setError(t("common.error"));
    }
  };

  /* REVISION-50 A3: intercambiar / media pista quitados — só «Mover». */

  const conflicts = data?.matches.filter((m) => m.status === "conflict") ?? [];

  const weekendLabel = data
    ? `${formatDate(data.weekend, i18n.language)} – ${formatDate(
        data.weekendEnd ?? data.weekend,
        i18n.language,
      )}`
    : undefined;

  return (
    <AdminShell active="pavillon" pageTitle={t("admin.pavilion")}>
      <p className="mb-2 text-sm text-graphite">{t("admin.pavilionHint")}</p>

      {!data && !error && <p className="text-graphite">{t("common.loading")}</p>}
      {error && (
        <div className="pa-warn-banner" role="alert">
          <span aria-hidden>⚠</span>
          <span>{error}</span>
        </div>
      )}
      {msg && (
        <div className="pa-ok-banner mt-2" role="status">
          <span aria-hidden>✓</span>
          <span>{msg}</span>
        </div>
      )}

      {data && (
        <>
          {/* REVISION-46 V9: o chip coincide coas tarxetas de choque. */}
          {conflicts.length > 0 && (
            <p className="mt-2 text-graphite">
              <span className="pa-chip-warn">
                <span aria-hidden>⚠</span>{" "}
                {t("pavilion.conflicts", { count: conflicts.length })}
              </span>
            </p>
          )}
          {/* REVISION-47 W3 / 48 Y4: grella + panel (móbil = folla con fondo escuro). */}
          <div className="mt-4 flex flex-col gap-4 xl:flex-row xl:items-start">
            <div className="min-w-0 flex-[999_1_620px]">
              <PavilionWeekendGrid
                matches={data.matches}
                neighborBookings={data.neighborBookings}
                weekendStartIso={data.weekend}
                weekendLabel={weekendLabel}
                weekOffset={weekOffset}
                onPrevWeek={() => setWeekOffset((w) => w - 1)}
                onNextWeek={() => setWeekOffset((w) => w + 1)}
                selectedMatchId={editMatchId}
                onSelectMatch={isAdmin ? (m) => openEditMatch(m) : undefined}
                units={moveUnits}
              />
            </div>
            {editMatch && isAdmin ? (
              <>
              <button
                type="button"
                className="fixed inset-0 z-[35] bg-[rgba(0,43,74,0.45)] xl:hidden"
                aria-label={t("common.cancel")}
                onClick={() => setEditMatchId(null)}
              />
              <form
                className="fixed inset-x-0 bottom-0 z-40 max-h-[85vh] overflow-y-auto rounded-t-2xl border border-line bg-surface p-5 shadow-pa-tab xl:static xl:z-auto xl:max-h-none xl:flex-[1_1_340px] xl:rounded-card xl:shadow-none"
                aria-label={t("admin.moveMatchPanel")}
                tabIndex={0}
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitMoveMatch();
                }}
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div>
                    <p className="m-0 text-xs font-extrabold uppercase tracking-wide text-azul-700">
                      {t("admin.moveMatchPanel")}
                    </p>
                    <h3 className="m-0 mt-1 text-lg font-extrabold text-marino">
                      {editMatch.homeTeam} – {editMatch.awayTeam}
                    </h3>
                    <p className="mt-1 m-0 text-sm text-graphite">
                      {formatDayChip(editMatch.date, i18n.language)} · {editMatch.start}–
                      {editMatch.end} ·{" "}
                      {unitShortLabel(editMatch.unitId ?? editMatch.unit, t, moveUnits)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="pa-btn-secondary h-9 w-9 shrink-0 px-0 text-sm"
                    aria-label={t("common.cancel")}
                    onClick={() => setEditMatchId(null)}
                  >
                    ✕
                  </button>
                </div>

                <p className="m-0 text-sm font-bold text-marino">
                  {t("admin.movePickTime", { defaultValue: "Escolle a nova hora" })}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {freeSuggestions.length === 0 ? (
                    <p className="m-0 text-sm text-graphite">
                      {t("admin.moveNoFreeSlot")}
                    </p>
                  ) : null}
                  {freeSuggestions.map((s) => {
                    const on = editDate === s.date && editStart === s.start;
                    return (
                      <button
                        key={`${s.date}-${s.start}`}
                        type="button"
                        className={`min-h-10 rounded-btn border px-3 text-sm font-extrabold ${
                          on
                            ? "border-marino bg-marino text-on-dark"
                            : "border-line bg-surface text-marino"
                        }`}
                        onClick={() => {
                          setEditDate(s.date);
                          setEditStart(s.start);
                          setEditEnd(s.end);
                        }}
                      >
                        {formatDayChip(s.date, i18n.language)} · {s.start}
                      </button>
                    );
                  })}
                </div>
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-bold text-azul-700">
                    {t("admin.moveFreeTime", { defaultValue: "Hora libre" })}
                  </summary>
                  <div className="mt-2 flex flex-wrap items-end gap-3">
                    <label className="flex flex-col gap-1 text-sm font-bold">
                      {t("clubs.start")}
                      <TimeField
                        value={editStart}
                        onChange={setStartKeepDuration}
                        aria-label={t("clubs.start")}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-bold">
                      {t("clubs.end")}
                      <TimeField
                        value={editEnd}
                        onChange={setEditEnd}
                        aria-label={t("clubs.end")}
                      />
                    </label>
                  </div>
                </details>

                <fieldset className="mt-3 border-0 p-0">
                  <legend className="mb-1 text-sm font-bold">{t("clubs.unit")}</legend>
                  <div className="flex gap-1 rounded-[10px] bg-bruma p-1">
                    {(
                      [
                        ["full", t("admin.unitCompleta", { defaultValue: "Completa" })],
                        ["a", t("admin.unitMediaA", { defaultValue: "Media A" })],
                        ["b", t("admin.unitMediaB", { defaultValue: "Media B" })],
                      ] as const
                    ).map(([kind, label]) => {
                      const uid = unitIdForKind(kind);
                      const on = editUnitId === uid;
                      return (
                        <button
                          key={kind}
                          type="button"
                          disabled={!uid}
                          className={`min-h-10 flex-1 rounded-lg px-2 text-sm font-extrabold ${
                            on
                              ? "border-2 border-marino bg-surface text-marino"
                              : "border border-transparent text-graphite"
                          }`}
                          onClick={() => setEditUnitId(uid)}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
                <div className="mt-4 rounded-[12px] bg-paper p-3 text-sm">
                  <strong>{t("admin.moveMatchSummary")}</strong>
                  <p className="m-0 mt-1">
                    {formatDayChip(editMatch.date, i18n.language)} · {editMatch.start} →{" "}
                    {formatDayChip(editDate, i18n.language)} · {editStart} ·{" "}
                    {unitShortLabel(editUnitId || editMatch.unit, t, moveUnits)}
                  </p>
                </div>
                <div className="mt-4 flex flex-col gap-2">
                  <button
                    type="submit"
                    className="pa-btn-primary w-full text-sm"
                    disabled={editUnchanged}
                    title={editUnchanged ? t("admin.moveSameSlot") : undefined}
                  >
                    {t("admin.moveMatchSubmit")}
                  </button>
                  <button
                    type="button"
                    className="pa-btn-secondary w-full text-sm"
                    onClick={() => setEditMatchId(null)}
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              </form>
              </>
            ) : null}
          </div>
          <ul className="mt-8 space-y-3">
            {data.matches.map((m) => {
              const isConflict = m.status === "conflict";
              const past = matchIsPast(m);
              return (
                <li
                  key={m.id}
                  className={`rounded-card border bg-white p-4 ${
                    isConflict
                      ? "border-[3px] border-warnBorder bg-warnBg"
                      : "border-line"
                  } ${past ? "opacity-70" : ""}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      {isConflict && (
                        <span className="mb-1 inline-flex items-center gap-1 text-sm font-bold text-warnText">
                          <span aria-hidden>⚠</span> {t("pavilion.clash")}
                        </span>
                      )}
                      <p className="text-lg font-bold">
                        {m.homeTeam} — {m.awayTeam}
                      </p>
                      <p className="text-sm text-graphite">
                        {formatDate(m.date, i18n.language)} · {m.start}–{m.end} ·{" "}
                        {unitShortLabel(m.unit, t)} · {m.club}
                      </p>
                      {m.notes && isConflict && (
                        <p className="mt-1 text-sm text-warnText">{m.notes}</p>
                      )}
                    </div>
                    {/* REVISION-50 A3: só «Mover» (intercambiar / media pista quitados). */}
                    {!past && isAdmin ? (
                      <button
                        type="button"
                        className="pa-btn-secondary min-h-11 text-sm"
                        onClick={() => openEditMatch(m)}
                      >
                        {t("admin.editMove")}
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          {conflicts.length === 0 && (
            <div className="pa-ok-banner mt-6">
              <span aria-hidden>✓</span>
              <span>{t("pavilion.allClear")}</span>
            </div>
          )}
        </>
      )}
    </AdminShell>
  );
}

export function AdminSeasonPage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const { t } = useTranslation();
  const [rows, setRows] = useState<Awaited<ReturnType<typeof apiX.season>>["data"]>([]);
  const [campaigns, setCampaigns] = useState<
    Awaited<ReturnType<typeof apiX.seasons>>["data"]
  >([]);
  const [clubNames, setClubNames] = useState<Record<string, string>>({});
  const [unitNames, setUnitNames] = useState<Record<string, string>>({});
  const [facilities, setFacilities] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [criteriaGl, setCriteriaGl] = useState("");
  const [criteriaEs, setCriteriaEs] = useState("");
  const [facilityIds, setFacilityIds] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => {
    void apiX.season(slug).then((r) => setRows(r.data));
    void apiX.seasons(slug).then((r) => setCampaigns(r.data)).catch(() => setCampaigns([]));
    void apiX.clubs(slug).then((r) => {
      const map: Record<string, string> = {};
      for (const c of r.data) map[c.id] = c.name;
      setClubNames(map);
    });
    void api.facilities(slug).then((r) => {
      const map: Record<string, string> = {};
      const facs: Array<{ id: string; name: string }> = [];
      for (const f of r.data) {
        facs.push({ id: f.id, name: f.name });
        for (const u of f.units ?? []) map[u.id] = u.name;
      }
      setFacilities(facs);
      setUnitNames(map);
    });
  };

  useEffect(() => {
    load();
  }, [slug]);

  const labelClub = (id: string) => clubNames[id] ?? id.replace(/^club-/, "").replace(/-/g, " ");
  const labelUnit = (id: string) => unitNames[id] ?? id.replace(/^unit-/, "").replace(/-/g, " ");
  const filtered = useMemo(
    () =>
      filterByQuery(rows, q, (s) => [
        labelClub(s.clubId),
        labelUnit(s.unitId),
        s.start,
        s.end,
        String(s.weekday),
      ]),
    [rows, q, clubNames, unitNames],
  );

  const createCampaign = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    await apiX.createSeason(slug, {
      name,
      startsAt,
      endsAt,
      facilityIds,
      criteriaGl,
      criteriaEs,
      published: false,
    });
    setName("");
    setStartsAt("");
    setEndsAt("");
    setCriteriaGl("");
    setCriteriaEs("");
    setFacilityIds([]);
    setMsg(t("admin.seasonCreated"));
    load();
  };

  return (
    <AdminShell active="tempada" pageTitle={t("admin.season")}>
      <p className="text-sm text-graphite">{t("admin.seasonCampaignsHint")}</p>

      <form onSubmit={(e) => void createCampaign(e)} className="pa-card mt-4 flex flex-col gap-3 p-5">
        <h3 className="m-0 font-bold">{t("admin.seasonCreate")}</h3>
        <label className="flex flex-col gap-1 text-sm font-bold">
          {t("admin.seasonName")}
          <input className="pa-input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Tempada 2026-27" />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-bold">
            {t("admin.seasonStarts")}
            <input className="pa-input" type="date" required value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-bold">
            {t("admin.seasonEnds")}
            <input className="pa-input" type="date" required value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm font-bold">
          {t("admin.seasonCriteriaGl")}
          <textarea className="pa-input min-h-[4rem]" value={criteriaGl} onChange={(e) => setCriteriaGl(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-bold">
          {t("admin.seasonCriteriaEs")}
          <textarea className="pa-input min-h-[4rem]" value={criteriaEs} onChange={(e) => setCriteriaEs(e.target.value)} />
        </label>
        <fieldset className="m-0 border-0 p-0">
          <legend className="text-sm font-bold">{t("admin.seasonFacilities")}</legend>
          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
            {facilities.map((f) => (
              <li key={f.id}>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={facilityIds.includes(f.id)}
                    onChange={(e) => {
                      setFacilityIds((prev) =>
                        e.target.checked
                          ? [...prev, f.id]
                          : prev.filter((x) => x !== f.id),
                      );
                    }}
                  />
                  {f.name}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        <button type="submit" className="pa-btn-primary self-start">
          {t("admin.seasonCreateBtn")}
        </button>
        {msg ? <p className="m-0 text-sm font-bold">{msg}</p> : null}
      </form>

      <ul className="mt-6 space-y-3">
        {campaigns.map((s) => (
          <li key={s.id} className="pa-card flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="m-0 font-bold">
                {s.name}{" "}
                {s.published ? (
                  <span className="text-sm font-normal text-graphite">({t("admin.seasonPublished")})</span>
                ) : (
                  <span className="text-sm font-normal text-graphite">({t("admin.seasonDraft")})</span>
                )}
              </p>
              <p className="m-0 text-sm text-graphite">
                {s.startsAt} → {s.endsAt} · {s.facilityIds.length} {t("nav.facilities")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="pa-btn-secondary text-sm"
                onClick={() => {
                  void apiX
                    .updateSeason(slug, s.id, { published: !s.published })
                    .then(() => load())
                    .catch(() => setMsg(t("common.error")));
                }}
              >
                {s.published ? t("admin.seasonUnpublish") : t("admin.seasonPublish")}
              </button>
              <button
                type="button"
                className="text-sm font-bold text-erro underline"
                onClick={() => {
                  if (!window.confirm(t("admin.seasonDeleteConfirm"))) return;
                  void apiX
                    .deleteSeason(slug, s.id)
                    .then(() => load())
                    .catch(() => setMsg(t("common.error")));
                }}
              >
                {t("common.delete")}
              </button>
            </div>
          </li>
        ))}
        {campaigns.length === 0 ? (
          <li className="list-none">
            <EmptyState title={t("admin.seasonCampaignsEmpty")} body={t("admin.seasonCampaignsEmptyHint")} />
          </li>
        ) : null}
      </ul>

      <h3 className="mt-10 font-extrabold text-marino">{t("admin.seasonSlotsTitle")}</h3>
      <p className="text-sm text-graphite">{t("admin.seasonHint")}</p>
      <ListSearch
        value={q}
        onChange={setQ}
        placeholder={t("admin.search")}
        count={rows.length}
      />
      {rows.length === 0 ? (
        <div className="mt-6">
          <EmptyState title={t("admin.seasonEmpty")} body={t("admin.seasonEmptyHint")} />
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto" tabIndex={0}>
          <table className="w-full min-w-[480px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line text-graphite">
                <th className="px-2 py-2 font-bold">{t("admin.clubs")}</th>
                <th className="px-2 py-2 font-bold">{t("clubs.weekday")}</th>
                <th className="px-2 py-2 font-bold">{t("reserve.time")}</th>
                <th className="px-2 py-2 font-bold">{t("admin.unit")}</th>
                <th className="px-2 py-2 font-bold">
                  <span className="sr-only">{t("admin.seasonSlotRetire")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id} className="border-b border-line/60">
                  <td className="px-2 py-2.5 font-bold">{labelClub(s.clubId)}</td>
                  <td className="px-2 py-2.5">{t(`dow.${s.weekday}`)}</td>
                  <td className="px-2 py-2.5">
                    {s.start}–{s.end}
                  </td>
                  <td className="px-2 py-2.5 text-graphite">{labelUnit(s.unitId)}</td>
                  <td className="px-2 py-2.5">
                    <button
                      type="button"
                      className="text-sm font-bold text-erro underline"
                      onClick={() => {
                        if (!window.confirm(t("admin.seasonSlotRetireConfirm"))) return;
                        void apiX
                          .deleteSeasonSlot(slug, s.id)
                          .then(() => {
                            setMsg(t("admin.seasonSlotRetired"));
                            load();
                          })
                          .catch(() => setMsg(t("common.error")));
                      }}
                    >
                      {t("admin.seasonSlotRetire")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
}

export function AdminIndicatorsPage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const { t, i18n } = useTranslation();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [dash, setDash] = useState<Awaited<ReturnType<typeof apiX.dashboard>>["data"] | null>(null);
  const [report, setReport] = useState<
    Awaited<ReturnType<typeof apiX.monthlyReport>>["data"] | null
  >(null);
  const [unitNames, setUnitNames] = useState<Record<string, string>>({});

  useEffect(() => {
    void apiX.dashboard(slug).then((r) => setDash(r.data));
    void api.facilities(slug).then((r) => {
      const map: Record<string, string> = {};
      for (const f of r.data) {
        for (const u of f.units ?? []) map[u.id] = `${f.name} · ${u.name}`;
      }
      setUnitNames(map);
    });
  }, [slug]);

  useEffect(() => {
    void apiX.monthlyReport(slug, year, month).then((r) => setReport(r.data));
  }, [slug, year, month]);

  const printPdf = () => {
    window.print();
  };

  if (!dash) {
    return (
      <AdminShell active="indicadores" pageTitle={t("admin.indicators")}>
        <p>{t("common.loading")}</p>
      </AdminShell>
    );
  }
  const max = Math.max(
    1,
    ...dash.heat.map((h) => Number(h.openHours ?? h.bookings) || h.bookings),
  );
  const peakMax = Math.max(1, ...(report?.hourHeat.map((h) => h.count) ?? [1]));
  const labelUnit = (id: string) => unitNames[id] ?? id.replace(/^unit-/, "").replace(/-/g, " ");
  const demandValue =
    report?.totals.waitlistDemand ?? dash.demandUnmet ?? 0;

  return (
    <AdminShell active="indicadores" pageTitle={t("admin.indicators")}>
      <p className="text-sm text-graphite print:hidden">{t("admin.indicatorsHint")}</p>
      <div className="mt-4 flex flex-wrap items-end gap-3 print:hidden">
        <label className="flex flex-col gap-1 text-sm font-bold">
          {t("admin.year")}
          <input
            type="number"
            className="pa-input w-28"
            value={year}
            onChange={(e) => setYear(Number(e.target.value) || year)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-bold">
          {t("admin.month")}
          <input
            type="number"
            min={1}
            max={12}
            className="pa-input w-20"
            value={month}
            onChange={(e) => setMonth(Number(e.target.value) || month)}
          />
        </label>
        <details className="relative self-end">
          <summary className="pa-btn-secondary list-none cursor-pointer [&::-webkit-details-marker]:hidden">
            {t("admin.downloadMenu")} ▾
          </summary>
          <div className="absolute right-0 z-20 mt-1 min-w-[10rem] rounded-xl border border-line bg-surface p-1 shadow-pa-alta">
            <a
              className="block rounded-lg px-3 py-2 text-sm font-bold text-marino no-underline hover:bg-area"
              href={apiX.monthlyReportCsvUrl(slug, year, month)}
              download
            >
              CSV
            </a>
            <a
              className="block rounded-lg px-3 py-2 text-sm font-bold text-marino no-underline hover:bg-area"
              href={apiX.monthlyReportXlsxUrl(slug, year, month)}
              download
            >
              Excel (.xlsx)
            </a>
            <button
              type="button"
              className="block w-full rounded-lg px-3 py-2 text-left text-sm font-bold text-marino hover:bg-area"
              onClick={printPdf}
            >
              PDF
            </button>
            <button
              type="button"
              className="block w-full rounded-lg px-3 py-2 text-left text-sm font-bold text-marino hover:bg-area"
              onClick={() =>
                void apiX.adminExportJson(slug).then((r) => {
                  const range = bookingExportRange();
                  const blob = new Blob([JSON.stringify(r.data, null, 2)], {
                    type: "application/json",
                  });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `pista-aberta-${slug}-export-${range.fileTag}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                })
              }
            >
              JSON
            </button>
          </div>
        </details>
      </div>

      {report && (
        <dl className="mt-6 grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
          <div className="pa-card p-3">
            <dt className="text-graphite">{t("admin.reportBookings")}</dt>
            <dd className="text-2xl font-bold">{report.totals.bookings}</dd>
          </div>
          <div className="pa-card p-3">
            <dt className="text-graphite">{t("admin.reportCheckedIn")}</dt>
            <dd className="text-2xl font-bold">{report.totals.checkedIn}</dd>
          </div>
          <div className="pa-card p-3">
            <dt className="text-graphite">{t("admin.noShows")}</dt>
            <dd className="text-2xl font-bold">{report.totals.noShows}</dd>
          </div>
          <div className="pa-card p-3">
            <dt className="text-graphite">{t("admin.demand")}</dt>
            <dd className="text-2xl font-bold">{demandValue}</dd>
          </div>
        </dl>
      )}

      <p className="mt-6 text-sm text-graphite">{dash.recommendation}</p>
      <p className="mt-1 text-sm text-graphite">{t("admin.demandHint")}</p>

      <h2 className="pa-h2 mt-8">{t("admin.occupancyTitle")}</h2>
      <div className="mt-4 space-y-3">
        {dash.heat.map((h) => {
          const hours = Number(h.hours ?? h.bookings) || 0;
          const pct = typeof h.pct === "number" ? h.pct : Math.round((hours / max) * 100);
          const barPct = Math.min(100, Math.max(0, pct));
          return (
            <div key={h.name}>
              <div className="mb-1 flex justify-between text-sm">
                <span>{h.name}</span>
                <span className="font-bold">
                  {t("admin.hoursBookedPct", {
                    n: hours,
                    pct,
                    defaultValue: `${hours} h · ${pct} %`,
                  })}
                </span>
              </div>
              <div className="h-3 overflow-hidden rounded bg-area">
                <div className="h-full bg-ink" style={{ width: `${barPct}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      <h2 className="pa-h2 mt-8">{t("admin.peakHours")}</h2>
      {report && report.hourHeat.length > 0 ? (
        <div className="mt-4 flex h-40 items-end gap-1">
          {report.hourHeat.map((h) => {
            const px = peakMax > 0 ? Math.round((h.count / peakMax) * 140) : 0;
            return (
              <div key={h.start} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                <span className="text-[10px] font-bold tabular-nums text-marino">{h.count}</span>
                <div
                  role="img"
                  className="w-full max-w-[2rem] rounded-t bg-ink"
                  style={{ height: `${Math.max(px, h.count ? 4 : 0)}px` }}
                  title={`${h.start}: ${h.count}`}
                  aria-label={`${h.start}: ${h.count}`}
                />
                <span className="text-[10px] text-graphite">{h.start.slice(0, 2)}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-2 text-sm text-graphite">—</p>
      )}

      {report && report.byFacility.length > 0 && (
        <>
          <h2 className="pa-h2 mt-8">{t("admin.facilities")}</h2>
          {/* PC: táboa · móbil &lt;768: tarxetas (REVISION-16 N7) */}
          <div className="mt-3 hidden overflow-x-auto md:block">
            <table className="w-full min-w-[480px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line text-graphite">
                  <th className="px-2 py-2 font-bold">{t("admin.facilities")}</th>
                  <th className="px-2 py-2 font-bold">{t("admin.reportCheckedIn")}</th>
                  <th className="px-2 py-2 font-bold">{t("admin.noShows")}</th>
                  <th className="px-2 py-2 font-bold">{t("bookings.statusCancelled")}</th>
                </tr>
              </thead>
              <tbody>
                {report.byFacility.map((f) => (
                  <tr key={f.name} className="border-b border-line/60">
                    <td className="px-2 py-2.5 font-bold">{f.name}</td>
                    <td className="px-2 py-2.5">{f.checkedIn}</td>
                    <td className="px-2 py-2.5">{f.noShow}</td>
                    <td className="px-2 py-2.5">{f.cancelled}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="mt-3 m-0 flex list-none flex-col gap-3 p-0 md:hidden">
            {report.byFacility.map((f) => (
              <li
                key={f.name}
                className="rounded-2xl border border-line bg-surface px-4 py-3"
              >
                <p className="m-0 font-extrabold text-marino">{f.name}</p>
                <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="text-graphite">{t("admin.reportCheckedIn")}</dt>
                    <dd className="m-0 font-bold tabular-nums">{f.checkedIn}</dd>
                  </div>
                  <div>
                    <dt className="text-graphite">{t("admin.noShows")}</dt>
                    <dd className="m-0 font-bold tabular-nums">{f.noShow}</dd>
                  </div>
                  <div>
                    <dt className="text-graphite">{t("bookings.statusCancelled")}</dt>
                    <dd className="m-0 font-bold tabular-nums">{f.cancelled}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="mt-8 font-bold">{t("admin.lowOcc")}</h3>
      {dash.lowOccupancy.length === 0 ? (
        <div className="mt-3">
          <EmptyState title={t("admin.lowOccEmpty")} body={t("admin.lowOccEmptyHint")} />
        </div>
      ) : (
        <ul className="mt-2 space-y-1 text-sm text-graphite">
          {dash.lowOccupancy.map((s, i) => (
            <li key={i}>
              {formatDate(s.date, i18n.language)} {s.start} · {labelUnit(s.unitId)}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-sm">
        {t("admin.demand")}: <strong>{demandValue}</strong> ·{" "}
        {t("admin.noShowsLast8Weeks")}: <strong>{dash.noShows}</strong>
      </p>
    </AdminShell>
  );
}

function useAdminTimeZone(): string {
  const { municipality } = useSession();
  return municipality?.settings?.timezone ?? "Europe/Madrid";
}

/** REVISION-21 Q1 + REVISION-24 T19 — Concello › Auditoría con filtros, CSV e detalle. */
function auditActionLabel(
  action: string,
  t: (key: string, opts?: Record<string, string>) => string,
): string {
  const key = `admin.auditAction.${action.replace(/\./g, "_")}`;
  const labeled = t(key);
  if (labeled !== key) return labeled;
  return t("admin.auditAction.fallback", { action });
}

/** REVISION-40 T6: nome da persoa ou «Veciña» / «Sistema». */
function auditActorLabel(
  row: { actor: string; actorLabel?: string; actorRole?: string | null },
  t: (key: string, opts?: Record<string, string>) => string,
): string {
  const label = row.actorLabel ?? row.actor;
  if (label === "sistema" || row.actor === "sistema" || row.actor === "system") {
    return t("admin.auditActor.system");
  }
  if (label === "citizen" || row.actorRole === "citizen") {
    return t("admin.auditActor.citizen");
  }
  if (/^user-/.test(label)) {
    return t("admin.auditActor.citizen");
  }
  return label;
}

export function AdminAuditoriaPage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const { t, i18n } = useTranslation();
  const tz = useAdminTimeZone();
  const [audit, setAudit] = useState<Awaited<ReturnType<typeof apiX.audit>>["data"]>([]);
  const [loading, setLoading] = useState(true);
  const [actorFilter, setActorFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [fromFilter, setFromFilter] = useState("");
  const [toFilter, setToFilter] = useState("");
  const [detail, setDetail] = useState<(typeof audit)[number] | null>(null);

  useEffect(() => {
    setLoading(true);
    void apiX
      .audit(slug)
      .then((r) => setAudit(r.data))
      .catch(() => setAudit([]))
      .finally(() => setLoading(false));
  }, [slug]);

  const actors = useMemo(
    () => [...new Set(audit.map((a) => a.actor))].sort((a, b) => a.localeCompare(b)),
    [audit],
  );
  const actions = useMemo(
    () => [...new Set(audit.map((a) => a.action))].sort((a, b) => a.localeCompare(b)),
    [audit],
  );

  const filtered = useMemo(() => {
    return audit.filter((a) => {
      if (actorFilter && a.actor !== actorFilter) return false;
      if (actionFilter && a.action !== actionFilter) return false;
      const day = a.at.slice(0, 10);
      if (fromFilter && day < fromFilter) return false;
      if (toFilter && day > toFilter) return false;
      return true;
    });
  }, [audit, actorFilter, actionFilter, fromFilter, toFilter]);

  const exportCsv = () => {
    /* REVISION-57 W14: escape anti-fórmula + BOM (coma no servidor). */
    const header = ["at", "actor", "action", "action_label", "detail"];
    const lines = [
      header.map((c) => csvEscapeCell(c)).join(","),
      ...filtered.map((a) => {
        const cells = [
          formatDateTime(a.at, i18n.language, tz),
          auditActorLabel(a, t),
          a.action,
          auditActionLabel(a.action, t),
          a.detail ?? "",
        ].map((c) => csvEscapeCell(String(c)));
        return cells.join(",");
      }),
    ];
    const blob = new Blob(["\uFEFF" + lines.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url;
    el.download = `pista-aberta-${slug}-auditoria.csv`;
    el.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AdminShell active="auditoria" pageTitle={t("admin.audit")}>
      <p className="text-sm text-graphite">{t("admin.auditHint")}</p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm font-bold">
          {t("admin.auditFilterActor")}
          <select
            className="pa-input min-w-[10rem]"
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
          >
            <option value="">{t("admin.auditFilterAll")}</option>
            {actors.map((a) => (
              <option key={a} value={a}>
                {auditActorLabel({ actor: a }, t)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-bold">
          {t("admin.auditFilterAction")}
          <select
            className="pa-input min-w-[12rem]"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
          >
            <option value="">{t("admin.auditFilterAll")}</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {auditActionLabel(a, t)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-bold">
          {t("admin.auditFilterFrom")}
          <input
            type="date"
            className="pa-input"
            value={fromFilter}
            onChange={(e) => setFromFilter(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-bold">
          {t("admin.auditFilterTo")}
          <input
            type="date"
            className="pa-input"
            value={toFilter}
            onChange={(e) => setToFilter(e.target.value)}
          />
        </label>
        <button type="button" className="pa-btn-secondary" onClick={exportCsv} disabled={filtered.length === 0}>
          {t("admin.auditExportCsv")}
        </button>
      </div>
      {loading ? (
        <p className="mt-4 text-sm text-graphite">{t("common.loading")}</p>
      ) : filtered.length === 0 ? (
        <p className="mt-4 text-sm text-graphite">{t("admin.auditEmpty")}</p>
      ) : (
        <ul className="mt-4 space-y-2 text-sm">
          {          filtered.map((a) => (
            <li key={a.id} className="pa-card flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2">
              <span className="font-bold text-marino">
                {formatDateTime(a.at, i18n.language, tz)}
              </span>
              <span aria-hidden>·</span>
              <span>{auditActorLabel(a, t)}</span>
              <span aria-hidden>·</span>
              <span className="font-extrabold">{auditActionLabel(a.action, t)}</span>
              <button
                type="button"
                className="ml-auto text-sm font-bold text-azul-700 underline"
                onClick={() => setDetail(a)}
              >
                {t("admin.auditDetail")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {detail ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="audit-detail-title"
          onClick={() => setDetail(null)}
        >
          <div
            className="pa-card max-h-[80vh] w-full max-w-lg overflow-auto p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="audit-detail-title" className="m-0 text-lg font-extrabold text-marino">
              {t("admin.auditDetailTitle")}
            </h2>
            <dl className="mt-4 space-y-2 text-sm">
              <div>
                <dt className="font-bold text-graphite">{t("admin.auditFilterFrom")}</dt>
                <dd>{formatDateTime(detail.at, i18n.language, tz)}</dd>
              </div>
              <div>
                <dt className="font-bold text-graphite">{t("admin.auditFilterActor")}</dt>
                <dd>{auditActorLabel(detail, t)}</dd>
              </div>
              <div>
                <dt className="font-bold text-graphite">{t("admin.auditFilterAction")}</dt>
                <dd>
                  {auditActionLabel(detail.action, t)}
                  <span className="ml-2 text-graphite">({detail.action})</span>
                </dd>
              </div>
              {detail.detail ? (
                <div>
                  <dt className="font-bold text-graphite">{t("admin.auditDetail")}</dt>
                  <dd className="whitespace-pre-wrap break-words">{detail.detail}</dd>
                </div>
              ) : null}
            </dl>
            <button
              type="button"
              className="pa-btn-secondary mt-4"
              onClick={() => setDetail(null)}
            >
              {t("admin.auditClose")}
            </button>
          </div>
        </div>
      ) : null}
    </AdminShell>
  );
}

export function AdminExportPage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const { t } = useTranslation();
  const range = bookingExportRange();
  return (
    <AdminShell active="exportar" pageTitle={t("admin.export")}>
      <p className="text-sm text-graphite">
        {t("admin.exportHint", { from: range.from, to: range.to })}
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <a href={exportCsvUrl(slug)} className="pa-btn-primary">
          CSV
        </a>
        <a href={apiX.frictionlessZipUrl(slug)} className="pa-btn-secondary">
          Frictionless ZIP
        </a>
        <a href={apiX.activityCsvUrl(slug)} className="pa-btn-secondary">
          Actividade CSV
        </a>
        <button
          type="button"
          className="pa-btn-secondary"
          onClick={() =>
            void apiX.adminExportJson(slug).then((r) => {
              const blob = new Blob([JSON.stringify(r.data, null, 2)], {
                type: "application/json",
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `pista-aberta-${slug}-export-${range.fileTag}.json`;
              a.click();
              URL.revokeObjectURL(url);
            })
          }
        >
          JSON
        </button>
        <Link to={`/c/${slug}/datos-abertos`} className="pa-btn-secondary">
          {t("nav.openData")}
        </Link>
      </div>
      <p className="mt-6 text-sm text-graphite">
        <Link
          to={`/c/${slug}/admin/concello?tab=auditoria`}
          className="font-bold text-azul-700 no-underline hover:underline"
        >
          {t("admin.audit")}
        </Link>
      </p>
    </AdminShell>
  );
}

export function AdminDatosPage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const [demoMode, setDemoMode] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [lastResetAt, setLastResetAt] = useState<string | null>(null);

  useEffect(() => {
    void fetchPublicConfig().then((c) => setDemoMode(!!c.demo));
  }, []);

  /* REVISION-33 D2: só Deputación; amosar última restauración. */
  const canReset = user?.role === "superadmin" && demoMode;

  useEffect(() => {
    if (!canReset) {
      setLastResetAt(null);
      return;
    }
    void apiX
      .lastDemoReset()
      .then((r) => setLastResetAt(r.data.at))
      .catch(() => setLastResetAt(null));
  }, [canReset]);

  const doReset = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiX.resetDemo();
      setLastResetAt(r.data.at);
      setMsg(t("admin.demoResetOk"));
      setConfirmOpen(false);
    } catch {
      setMsg(t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const lastResetLabel = lastResetAt
    ? t("admin.demoResetLast", {
        when: new Date(lastResetAt).toLocaleString(
          i18n.language === "es" ? "es-ES" : "gl-ES",
          { dateStyle: "short", timeStyle: "short" },
        ),
      })
    : t("admin.demoResetNever");

  return (
    <AdminShell active="datos" pageTitle={t("admin.datos")}>
      <p className="text-sm text-graphite">{t("admin.datosHint")}</p>
      {canReset ? <DemoSnapshotCard className="mt-6 max-w-xl" /> : null}
      {canReset ? (
        <Card lift={false} className="mt-6 max-w-xl p-5">
          <h2 className="m-0 text-lg font-extrabold text-marino">{t("admin.demoReset")}</h2>
          <p className="mt-2 text-sm text-graphite">{t("admin.demoResetBody")}</p>
          <p className="mt-3 text-sm text-graphite" data-testid="demo-reset-last">
            {lastResetLabel}
          </p>
          <Button
            type="button"
            variant="danger"
            className="mt-4"
            disabled={busy}
            onClick={() => setConfirmOpen(true)}
          >
            {t("admin.demoReset")}
          </Button>
          {msg ? (
            <p className="mt-3 text-sm font-bold" role="status">
              {msg}
            </p>
          ) : null}
        </Card>
      ) : null}

      {confirmOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,43,74,0.5)] p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="demo-reset-title"
        >
          <Card lift={false} className="w-full max-w-md p-6">
            <h2 id="demo-reset-title" className="m-0 text-xl font-extrabold text-marino">
              {t("admin.demoReset")}
            </h2>
            <p className="mt-3 text-sm text-graphite">{t("admin.demoResetConfirm")}</p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button type="button" variant="danger" disabled={busy} onClick={() => void doReset()}>
                {t("admin.demoResetConfirmYes")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setConfirmOpen(false)}
              >
                {t("common.cancel")}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}

      <Card lift={false} className="mt-6 max-w-xl p-5">
        <h2 className="m-0 text-lg font-extrabold text-marino">{t("admin.export")}</h2>
        <p className="mt-2 text-sm text-graphite">
          {t("admin.exportHint", {
            from: bookingExportRange().from,
            to: bookingExportRange().to,
          })}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <a href={exportCsvUrl(slug)} className="pa-btn-primary">
            CSV
          </a>
          <a href={apiX.frictionlessZipUrl(slug)} className="pa-btn-secondary">
            Frictionless ZIP
          </a>
          <a href={apiX.activityCsvUrl(slug)} className="pa-btn-secondary">
            Actividade CSV
          </a>
          <button
            type="button"
            className="pa-btn-secondary"
            onClick={() =>
              void apiX.adminExportJson(slug).then((r) => {
                const range = bookingExportRange();
                const blob = new Blob([JSON.stringify(r.data, null, 2)], {
                  type: "application/json",
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `pista-aberta-${slug}-export-${range.fileTag}.json`;
                a.click();
                URL.revokeObjectURL(url);
              })
            }
          >
            JSON
          </button>
          <button
            type="button"
            className="pa-btn-secondary"
            onClick={() =>
              void apiX.adminExportFull(slug).then((r) => {
                const blob = new Blob([JSON.stringify(r.data, null, 2)], {
                  type: "application/json",
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `pista-aberta-${slug}-full.json`;
                a.click();
                URL.revokeObjectURL(url);
              })
            }
          >
            {t("admin.exportFull")}
          </button>
          <Link to={`/c/${slug}/datos-abertos`} className="pa-btn-secondary">
            {t("nav.openData")}
          </Link>
        </div>
      </Card>
    </AdminShell>
  );
}

export function AdminBrandingPage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const { t } = useTranslation();
  const { user } = useSession();
  const readOnly = user?.role === "superadmin";
  const [muni, setMuni] = useState<Awaited<ReturnType<typeof api.info>>["data"] | null>(null);
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("#5A4636");
  const [accent, setAccent] = useState("#5A4636");
  const [welcomeGl, setWelcomeGl] = useState("");
  const [welcomeEs, setWelcomeEs] = useState("");
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [logoClear, setLogoClear] = useState(false);
  const [legalTitular, setLegalTitular] = useState("");
  const [legalNif, setLegalNif] = useState("");
  const [legalAddress, setLegalAddress] = useState("");
  const [legalEmail, setLegalEmail] = useState("");
  const [legalDpd, setLegalDpd] = useState("");
  const [legalSinatura, setLegalSinatura] = useState("");
  const [contactServiceName, setContactServiceName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactAddress, setContactAddress] = useState("");
  const [contactHours, setContactHours] = useState("");
  const [contactWeb, setContactWeb] = useState("");
  const [openLicense, setOpenLicense] = useState("CC BY 4.0");
  const [openDir3, setOpenDir3] = useState("");
  const [openPublisher, setOpenPublisher] = useState("");
  const [deputacionCanViewPersonalData, setDeputacionCanViewPersonalData] =
    useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [contrastNote, setContrastNote] = useState<string | null>(null);
  const [baseline, setBaseline] = useState("");
  const [widgetCopied, setWidgetCopied] = useState(false);

  const snapshot = useCallback(
    (s: {
      name: string;
      brand: string;
      accent: string;
      welcomeGl: string;
      welcomeEs: string;
      logoDataUrl: string | null;
      logoClear: boolean;
      legalTitular: string;
      legalNif: string;
      legalAddress: string;
      legalEmail: string;
      legalDpd: string;
      legalSinatura: string;
      contactServiceName: string;
      contactPhone: string;
      contactEmail: string;
      contactAddress: string;
      contactHours: string;
      contactWeb: string;
      openLicense: string;
      openDir3: string;
      openPublisher: string;
      deputacionCanViewPersonalData: boolean;
    }) => JSON.stringify(s),
    [],
  );

  const load = useCallback(() => {
    void Promise.all([
      api.info(slug),
      apiX.getBranding(slug).catch(() => null),
    ]).then(([r, adminMeta]) => {
      setMuni(r.data);
      const nextName = r.data.name;
      const th = r.data.settings.theme ?? {
        brand: r.data.accentColor ?? "#5A4636",
        accent: r.data.accentColor ?? "#5A4636",
      };
      const legal = r.data.settings.legal ?? {};
      const contact = r.data.settings.contact ?? {};
      const open = r.data.settings.openData ?? {};
      const nextLogo =
        adminMeta?.data.logoUrl ??
        r.data.settings.logoUrl ??
        r.data.settings.logoDataUrl ??
        null;
      const nextDepOptIn = adminMeta
        ? adminMeta.data.deputacionCanViewPersonalData === true
        : r.data.settings.deputacionCanViewPersonalData === true;
      const next = {
        name: nextName,
        brand: th.brand,
        accent: th.accent,
        welcomeGl: r.data.settings.welcomeGl ?? "",
        welcomeEs: r.data.settings.welcomeEs ?? "",
        logoDataUrl: nextLogo,
        logoClear: false,
        legalTitular: legal.titular ?? "",
        legalNif: legal.nif ?? "",
        legalAddress: legal.address ?? "",
        legalEmail: legal.email ?? "",
        legalDpd: legal.dpd ?? "",
        legalSinatura: legal.sinatura ?? "",
        contactServiceName: contact.serviceName ?? "",
        contactPhone: contact.phone ?? "",
        contactEmail: contact.email ?? "",
        contactAddress: contact.address ?? "",
        contactHours: contact.hours ?? "",
        contactWeb: contact.web ?? "",
        openLicense: open.license ?? "CC BY 4.0",
        openDir3: open.dir3 ?? "",
        openPublisher: open.catalogPublisher ?? "",
        deputacionCanViewPersonalData: nextDepOptIn,
      };
      setName(next.name);
      setBrand(next.brand);
      setAccent(next.accent);
      setWelcomeGl(next.welcomeGl);
      setWelcomeEs(next.welcomeEs);
      setLogoDataUrl(next.logoDataUrl);
      setLogoClear(false);
      setLegalTitular(next.legalTitular);
      setLegalNif(next.legalNif);
      setLegalAddress(next.legalAddress);
      setLegalEmail(next.legalEmail);
      setLegalDpd(next.legalDpd);
      setLegalSinatura(next.legalSinatura);
      setContactServiceName(next.contactServiceName);
      setContactPhone(next.contactPhone);
      setContactEmail(next.contactEmail);
      setContactAddress(next.contactAddress);
      setContactHours(next.contactHours);
      setContactWeb(next.contactWeb);
      setOpenLicense(next.openLicense);
      setOpenDir3(next.openDir3);
      setOpenPublisher(next.openPublisher);
      setDeputacionCanViewPersonalData(next.deputacionCanViewPersonalData);
      setBaseline(snapshot(next));
    });
  }, [slug, snapshot]);

  useEffect(() => {
    load();
  }, [load]);

  const onLogoFile = (file: File | null) => {
    setErr(null);
    if (!file) return;
    if (file.size > 500_000) {
      setErr(t("admin.brandingLogoTooBig"));
      return;
    }
    const okType =
      file.type === "image/svg+xml" ||
      file.type === "image/png" ||
      file.type === "image/jpeg" ||
      file.type === "image/webp";
    if (!okType) {
      setErr(t("admin.brandingLogoType"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!result) {
        setErr(t("admin.brandingLogoType"));
        return;
      }
      setLogoDataUrl(result);
      setLogoClear(false);
    };
    reader.readAsDataURL(file);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    setErr(null);
    setContrastNote(null);
    try {
      const r = await apiX.putBranding(slug, {
        name,
        brand,
        accent,
        welcomeGl,
        welcomeEs,
        logoDataUrl: logoClear
          ? null
          : logoDataUrl?.startsWith("data:")
            ? logoDataUrl
            : undefined,
        legal: {
          titular: legalTitular,
          nif: legalNif,
          address: legalAddress,
          email: legalEmail,
          dpd: legalDpd,
          sinatura: legalSinatura,
        },
        contact: {
          serviceName: contactServiceName,
          phone: contactPhone,
          email: contactEmail,
          address: contactAddress,
          hours: contactHours,
          web: contactWeb,
        },
        openData: {
          license: openLicense,
          dir3: openDir3,
          catalogPublisher: openPublisher,
        },
        deputacionCanViewPersonalData,
      });
      setBrand(r.data.theme.brand);
      setAccent(r.data.theme.accent);
      setLogoDataUrl(r.data.logoDataUrl);
      setLogoClear(false);
      setOpenLicense(r.data.openData?.license ?? openLicense);
      setOpenDir3(r.data.openData?.dir3 ?? openDir3);
      setOpenPublisher(r.data.openData?.catalogPublisher ?? openPublisher);
      setDeputacionCanViewPersonalData(r.data.deputacionCanViewPersonalData === true);
      if (r.data.contrastOk === false) {
        setContrastNote(t("admin.brandingContrastFixed"));
      }
      setMsg(t("admin.saved"));
      load();
    } catch {
      setErr(t("admin.brandingSaveError"));
    } finally {
      setSaving(false);
    }
  };

  const initial = (name || "P").replace(/^Concello de\s+/i, "").charAt(0) || "P";
  const dirty =
    baseline !== "" &&
    snapshot({
      name,
      brand,
      accent,
      welcomeGl,
      welcomeEs,
      logoDataUrl,
      logoClear,
      legalTitular,
      legalNif,
      legalAddress,
      legalEmail,
      legalDpd,
      legalSinatura,
      contactServiceName,
      contactPhone,
      contactEmail,
      contactAddress,
      contactHours,
      contactWeb,
      openLicense,
      openDir3,
      openPublisher,
      deputacionCanViewPersonalData,
    }) !== baseline;

  const widgetEmbed = `<iframe src="${typeof window !== "undefined" ? window.location.origin : ""}/c/${slug}/widget?tema=claro&lang=gl" title="Pista Aberta" width="360" height="480" style="border:0;border-radius:12px;max-width:100%" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>`;

  return (
    <AdminShell active="personalizacion" pageTitle={t("admin.branding")}>
      <p className="text-sm text-graphite">{t("admin.brandingHint")}</p>
      {muni && (
        <form onSubmit={(e) => void save(e)} className="relative mt-6 space-y-5 pb-24">
          <Card lift={false} className="space-y-4 p-5">
          <p className="text-sm text-graphite">/{muni.slug}</p>
          <div className="rounded-xl border border-line bg-area p-4">
            <h2 className="m-0 text-base font-extrabold text-marino">
              {t("widget.embedTitle")}
            </h2>
            <p className="mt-1 text-sm font-normal text-graphite">
              {t("widget.embedHint")}
            </p>
            <pre
              className="mt-3 max-h-40 overflow-auto rounded-lg bg-surface p-3 text-xs leading-relaxed text-marino"
              tabIndex={0}
            >
              {widgetEmbed}
            </pre>
            <button
              type="button"
              className="pa-btn-secondary mt-3 text-sm"
              onClick={() => {
                void navigator.clipboard.writeText(widgetEmbed).then(() => {
                  setWidgetCopied(true);
                  window.setTimeout(() => setWidgetCopied(false), 2000);
                });
              }}
            >
              {widgetCopied ? t("widget.embedCopied") : t("widget.embedCopy")}
            </button>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
          <label className="flex flex-col gap-2 font-bold">
            {t("admin.brandingName")}
            <input
              className="pa-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              maxLength={120}
            />
          </label>
          <fieldset className="space-y-2">
            <legend className="font-bold">{t("admin.brandingLogo")}</legend>
            <p className="text-sm font-normal text-graphite">{t("admin.brandingLogoHint")}</p>
            <FilePickButton
              accept="image/svg+xml,image/png,image/jpeg,image/webp"
              labelKey="file.chooseShield"
              onFile={(f) => onLogoFile(f)}
            />
            {(logoDataUrl || logoClear) && (
              <div className="flex items-center gap-3">
                {!logoClear && logoDataUrl ? (
                  <span
                    className="flex h-14 w-12 items-center justify-center rounded-btn"
                    style={{ background: brand }}
                  >
                    <ShieldMark initial={initial} size={36} src={logoDataUrl} />
                  </span>
                ) : null}
                <button
                  type="button"
                  className="pa-btn-secondary text-sm"
                  onClick={() => {
                    setLogoDataUrl(null);
                    setLogoClear(true);
                  }}
                >
                  {t("admin.brandingLogoRemove")}
                </button>
              </div>
            )}
          </fieldset>
          <div className="flex flex-wrap gap-6">
            <label className="font-bold">
              {t("admin.brandingBrand")}
              <input
                type="color"
                className="mt-2 block h-12 w-24 cursor-pointer"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
              />
              <span className="mt-1 block font-mono text-sm font-normal text-graphite">{brand}</span>
            </label>
            <label className="font-bold">
              {t("admin.brandingAccent")}
              <input
                type="color"
                className="mt-2 block h-12 w-24 cursor-pointer"
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
              />
              <span className="mt-1 block font-mono text-sm font-normal text-graphite">{accent}</span>
            </label>
          </div>
          </div>
          <div className="overflow-hidden rounded-[var(--pa-radius-card)] border border-line bg-white text-ink">
            <div className="flex items-center gap-3 px-4 py-3 font-bold">
              <ShieldMark
                initial={initial}
                size={32}
                src={logoClear ? null : logoDataUrl}
                variant="onLight"
                brandColor={brand}
              />
              {name || t("admin.title")}
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
          <label className="flex flex-col gap-2 font-bold">
            {t("admin.brandingWelcomeGl")}
            <textarea
              className="pa-input min-h-20"
              value={welcomeGl}
              onChange={(e) => setWelcomeGl(e.target.value)}
              maxLength={500}
            />
          </label>
          <label className="flex flex-col gap-2 font-bold">
            {t("admin.brandingWelcomeEs")}
            <textarea
              className="pa-input min-h-20"
              value={welcomeEs}
              onChange={(e) => setWelcomeEs(e.target.value)}
              maxLength={500}
            />
          </label>
          </div>
          </Card>
          <Card lift={false} className="space-y-3 p-5">
            <h2 className="m-0 text-lg font-extrabold text-marino">
              {t("admin.brandingContact")}
            </h2>
            <p className="m-0 text-sm text-graphite">{t("admin.brandingContactHint")}</p>
            <div className="grid gap-3 lg:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-bold">
                {t("admin.brandingContact.serviceName")}
                <input
                  className="pa-input"
                  value={contactServiceName}
                  onChange={(e) => setContactServiceName(e.target.value)}
                  maxLength={120}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-bold">
                {t("admin.brandingContact.phone")}
                <input
                  className="pa-input"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  maxLength={40}
                  type="tel"
                  autoComplete="tel"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-bold">
                {t("admin.brandingContact.email")}
                <input
                  className="pa-input"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  maxLength={120}
                  type="email"
                  autoComplete="email"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-bold">
                {t("admin.brandingContact.web")}
                <input
                  className="pa-input"
                  value={contactWeb}
                  onChange={(e) => setContactWeb(e.target.value)}
                  maxLength={200}
                  type="url"
                  placeholder="https://"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-bold lg:col-span-2">
                {t("admin.brandingContact.address")}
                <input
                  className="pa-input"
                  value={contactAddress}
                  onChange={(e) => setContactAddress(e.target.value)}
                  maxLength={300}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-bold lg:col-span-2">
                {t("admin.brandingContact.hours")}
                <textarea
                  className="pa-input min-h-16"
                  value={contactHours}
                  onChange={(e) => setContactHours(e.target.value)}
                  maxLength={300}
                />
              </label>
            </div>
          </Card>
          <Card lift={false} className="space-y-3 p-5">
            <h2 className="m-0 text-lg font-extrabold text-marino">{t("admin.brandingLegal")}</h2>
            <p className="m-0 text-sm text-graphite">{t("admin.brandingLegalHint")}</p>
            <div className="grid gap-3 lg:grid-cols-2">
            {(
              [
                ["titular", legalTitular, setLegalTitular, 200],
                ["nif", legalNif, setLegalNif, 32],
                ["address", legalAddress, setLegalAddress, 300],
                ["email", legalEmail, setLegalEmail, 120],
                ["dpd", legalDpd, setLegalDpd, 200],
              ] as const
            ).map(([key, val, setVal, max]) => (
              <label key={key} className="flex flex-col gap-1 text-sm font-bold">
                {t(`admin.brandingLegal.${key}`)}
                <input
                  className="pa-input"
                  value={val}
                  onChange={(e) => setVal(e.target.value)}
                  maxLength={max}
                  type={key === "email" ? "email" : "text"}
                />
              </label>
            ))}
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-bold">
                {t("admin.brandingEmailSignature")}
                <input
                  className="pa-input"
                  value={legalSinatura}
                  onChange={(e) => setLegalSinatura(e.target.value)}
                  maxLength={120}
                  placeholder="Servizo Municipal de Deportes"
                />
                <span className="font-normal text-graphite">
                  {t("admin.brandingEmailSignatureHint")}
                </span>
              </label>
              <div
                className="rounded-xl border border-line bg-[#E9EEF3] p-3 text-sm"
                aria-label={t("admin.brandingEmailPreview")}
              >
                <div className="mb-2 text-xs font-extrabold uppercase tracking-wide text-graphite">
                  {t("admin.brandingEmailPreview")}
                </div>
                <div
                  className="overflow-hidden rounded-lg border border-line bg-white"
                  style={{ borderTop: `4px solid ${brand}` }}
                >
                  <div
                    className="px-3 py-2 text-[13px] font-extrabold text-white"
                    style={{ background: brand }}
                  >
                    {name || "Concello"}
                  </div>
                  <div className="space-y-1 px-3 py-3 text-[13px] text-ink">
                    <div className="font-bold">
                      {[legalTitular || name, legalSinatura].filter(Boolean).join(" · ")}
                    </div>
                    {legalAddress ? (
                      <div className="text-graphite">{legalAddress}</div>
                    ) : null}
                    {legalEmail ? (
                      <div className="text-graphite">{legalEmail}</div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </Card>
          <Card lift={false} className="space-y-3 p-5">
            <h2 className="m-0 text-lg font-extrabold text-marino">
              {t("admin.brandingDeputacionPersonalData")}
            </h2>
            <p className="m-0 text-sm text-graphite">
              {t("admin.brandingDeputacionPersonalDataHint")}
            </p>
            <label className="flex cursor-pointer items-start gap-3 text-sm font-bold">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0"
                checked={deputacionCanViewPersonalData}
                disabled={readOnly}
                onChange={(e) => setDeputacionCanViewPersonalData(e.target.checked)}
              />
              <span>{t("admin.brandingDeputacionPersonalData")}</span>
            </label>
          </Card>
          <Card lift={false} className="space-y-3 p-5">
            <h2 className="m-0 text-lg font-extrabold text-marino">
              {t("admin.brandingOpenData")}
            </h2>
            <p className="m-0 text-sm text-graphite">{t("admin.brandingOpenDataHint")}</p>
            <div className="grid gap-3 lg:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-bold">
                {t("admin.brandingOpenDataLicense")}
                <input
                  className="pa-input"
                  value={openLicense}
                  onChange={(e) => setOpenLicense(e.target.value)}
                  maxLength={120}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-bold">
                {t("admin.brandingOpenDataDir3")}
                <input
                  className="pa-input"
                  value={openDir3}
                  onChange={(e) => setOpenDir3(e.target.value)}
                  maxLength={32}
                  placeholder="L01215000"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-bold lg:col-span-2">
                {t("admin.brandingOpenDataPublisher")}
                <input
                  className="pa-input"
                  value={openPublisher}
                  onChange={(e) => setOpenPublisher(e.target.value)}
                  maxLength={200}
                />
              </label>
            </div>
          </Card>
          {contrastNote ? (
            <p className="text-sm text-aviso" role="status">
              {contrastNote}
            </p>
          ) : null}
          {msg ? (
            <p className="text-sm font-bold" role="status" aria-live="polite">
              {msg}
            </p>
          ) : null}
          {err ? (
            <p className="text-sm text-erro" role="alert">
              {err}
            </p>
          ) : null}
          {dirty ? (
            <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-line bg-surface px-4 py-3 backdrop-blur md:px-8">
              <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-3">
                <p className="m-0 text-sm font-bold text-marino">{t("admin.unsavedChanges")}</p>
                <Button type="submit" disabled={saving}>
                  {t("admin.saveChanges")}
                </Button>
              </div>
            </div>
          ) : null}
        </form>
      )}
    </AdminShell>
  );
}

type StaffRow = {
  id: string;
  displayName: string;
  email?: string;
  role: string;
  active: boolean;
};

export function AdminStaffPage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const { t } = useTranslation();
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [nif, setNif] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    void apiX.staffList(slug).then((r) => setRows(r.data));
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    try {
      const res = await apiX.staffInvite(slug, {
        displayName: name,
        email,
        nif: nif.trim() || undefined,
      });
      setName("");
      setEmail("");
      setNif("");
      const linked = (res as { data?: { linkedExistingCitizen?: boolean } }).data
        ?.linkedExistingCitizen;
      setMsg(linked ? t("admin.staffLinkedCitizen") : t("admin.staffInvited"));
      load();
    } catch {
      setErr(t("admin.staffInviteError"));
    }
  };

  return (
    <AdminShell active="persoal" pageTitle={t("admin.staff")}>
      <p className="text-sm text-graphite">{t("admin.staffHint")}</p>

      <form onSubmit={(e) => void invite(e)} className="pa-card mt-6 flex flex-col gap-3 p-5">
        <h3 className="font-bold">{t("admin.staffInvite")}</h3>
        <div className="grid gap-3 lg:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm font-bold">
          {t("admin.staffName")}
          <input
            className="pa-input"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-bold">
          {t("admin.staffEmail")}
          <input
            type="email"
            className="pa-input"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="conserxe@concello.gal"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-bold">
          {t("admin.staffNif")}
          <input
            className="pa-input"
            required
            value={nif}
            onChange={(e) => setNif(e.target.value.toUpperCase())}
            placeholder="12345678Z"
            autoComplete="off"
          />
        </label>
        </div>
        <button type="submit" className="pa-btn-primary self-start">
          {t("admin.staffInviteBtn")}
        </button>
        {msg && <p className="text-sm font-bold text-ink">{msg}</p>}
        {err && (
          <p className="text-sm font-bold text-[var(--pa-danger)]" role="alert">
            {err}
          </p>
        )}
      </form>

      <ul className="mt-6 space-y-2">
        {rows.map((r) => (
          <li
            key={r.id}
            className="pa-card flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          >
            <div>
              <p className="font-bold">
                {r.displayName}{" "}
                <span className="text-sm font-normal text-graphite">
                  ({t(`userMenu.role.${r.role === "monitor" ? "staff" : r.role}`, {
                    defaultValue: t("userMenu.role.staff"),
                  })})
                </span>
              </p>
              <p className="text-sm text-graphite">{r.email}</p>
              <p className="text-xs font-bold tracking-wide text-graphite">
                {r.active ? t("admin.staffActive") : t("admin.staffRevoked")}
              </p>
            </div>
            {r.active ? (
              <button
                type="button"
                className="pa-btn-secondary text-sm"
                onClick={() => {
                  if (!window.confirm(t("admin.staffRevokeConfirm"))) return;
                  void apiX
                    .staffRevoke(slug, r.id)
                    .then(() => load())
                    .catch(() => setErr(t("common.error")));
                }}
              >
                {t("admin.staffRevoke")}
              </button>
            ) : (
              <button
                type="button"
                className="pa-btn-secondary text-sm"
                onClick={() =>
                  void apiX
                    .staffReactivate(slug, r.id)
                    .then(() => load())
                    .catch(() => setErr(t("common.error")))
                }
              >
                {t("admin.staffReactivate")}
              </button>
            )}
          </li>
        ))}
        {rows.length === 0 && (
          <li className="text-sm text-graphite">{t("admin.staffEmpty")}</li>
        )}
      </ul>
    </AdminShell>
  );
}

type ClubAdminRow = {
  id: string;
  name: string;
  shortName: string;
  account: {
    id: string;
    displayName: string;
    email?: string;
    active: boolean;
  } | null;
};

export {
  AdminRulesEditorPage as AdminRulesPage,
  AdminSchedulesEditorPage as AdminSchedulesPage,
  AdminSolicitudesPage,
  AdminMatchImportPage,
} from "./AdminMellorasPages";

export function AdminMonitorPage() {
  const { t } = useTranslation();
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  return (
    <AdminShell active="monitoraxe" pageTitle={t("admin.monitor")}>
      <p className="text-sm text-graphite">{t("admin.monitorHint")}</p>
      <div className="mt-6">
        <EmptyState
          title={t("admin.monitorEmpty")}
          body={t("admin.monitorEmptyHint")}
          actionLabel={t("nav.actividades")}
          actionTo={`/c/${slug}/admin/actividades`}
        />
      </div>
      <p className="mt-4 text-sm">
        <Link to={`/c/${slug}/conserxeria`} className="font-bold underline">
          {t("staff.checkin")}
        </Link>
      </p>
    </AdminShell>
  );
}

export function AdminClubsPage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const { t } = useTranslation();
  const [rows, setRows] = useState<ClubAdminRow[]>([]);
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [email, setEmail] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editShort, setEditShort] = useState("");
  const [reinviteEmail, setReinviteEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [responsables, setResponsables] = useState<
    Awaited<ReturnType<typeof apiX.clubResponsables>>["data"]
  >([]);
  const [respEmail, setRespEmail] = useState("");
  const [respNif, setRespNif] = useState("");

  const load = useCallback(() => {
    void apiX.adminClubs(slug).then((r) => setRows(r.data));
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    try {
      await apiX.adminCreateClub(slug, {
        name,
        shortName: shortName || undefined,
        accountEmail: email,
        accountDisplayName: name,
      });
      setName("");
      setShortName("");
      setEmail("");
      setMsg(t("admin.clubCreated"));
      load();
    } catch {
      setErr(t("admin.clubCreateError"));
    }
  };

  const startEdit = (r: ClubAdminRow) => {
    setEditId(r.id);
    setEditName(r.name);
    setEditShort(r.shortName);
    setReinviteEmail(r.account?.email ?? "");
    setRespEmail("");
    setRespNif("");
    setResponsables([]);
    setMsg(null);
    setErr(null);
    void apiX
      .clubResponsables(slug, r.id)
      .then((x) => setResponsables(x.data))
      .catch(() => setResponsables([]));
  };

  const saveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editId) return;
    setErr(null);
    setMsg(null);
    try {
      await apiX.updateClub(slug, editId, {
        name: editName,
        shortName: editShort,
        reinviteEmail: reinviteEmail.trim() || undefined,
      });
      setMsg(t("admin.clubUpdated"));
      setEditId(null);
      load();
    } catch {
      setErr(t("admin.clubUpdateError"));
    }
  };

  const setActive = async (id: string, active: boolean) => {
    setErr(null);
    setMsg(null);
    try {
      await apiX.updateClub(slug, id, { active });
      setMsg(active ? t("admin.clubReactivated") : t("admin.clubDeactivated"));
      load();
    } catch {
      setErr(t("admin.clubUpdateError"));
    }
  };

  return (
    <AdminShell active="clubs" pageTitle={t("admin.clubs")}>
      <p className="text-sm text-graphite">{t("admin.clubsHint")}</p>

      <form onSubmit={(e) => void create(e)} className="pa-card mt-6 flex flex-col gap-3 p-5">
        <h3 className="font-bold">{t("admin.clubCreate")}</h3>
        <div className="grid gap-3 lg:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-bold">
          {t("admin.clubName")}
          <input
            className="pa-input"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Club Deportivo Exemplo"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-bold">
          {t("admin.clubShort")}
          <input
            className="pa-input"
            value={shortName}
            onChange={(e) => setShortName(e.target.value)}
            placeholder="Club Deportivo Exemplo"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-bold lg:col-span-2">
          {t("admin.clubEmail")}
          <input
            type="email"
            className="pa-input"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="club@concello.gal"
          />
        </label>
        </div>
        <button type="submit" className="pa-btn-primary self-start">
          {t("admin.clubCreateBtn")}
        </button>
        {msg && <p className="text-sm font-bold text-ink">{msg}</p>}
        {err && (
          <p className="text-sm font-bold text-[var(--pa-danger)]" role="alert">
            {err}
          </p>
        )}
      </form>

      <ul className="mt-6 space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="pa-card px-4 py-3">
            {editId === r.id ? (
              <form onSubmit={(e) => void saveEdit(e)} className="flex flex-col gap-2">
                <label className="flex flex-col gap-1 text-sm font-bold">
                  {t("admin.clubName")}
                  <input
                    className="pa-input"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm font-bold">
                  {t("admin.clubShort")}
                  <input
                    className="pa-input"
                    value={editShort}
                    onChange={(e) => setEditShort(e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm font-bold">
                  {t("admin.clubReinvite")}
                  <input
                    type="email"
                    className="pa-input"
                    value={reinviteEmail}
                    onChange={(e) => setReinviteEmail(e.target.value)}
                    placeholder="club@concello.gal"
                  />
                </label>
                {/* REVISION-22 B3 — responsables */}
                <div className="mt-2 rounded-xl border border-line p-3">
                  <p className="m-0 text-sm font-extrabold">{t("admin.clubResponsables")}</p>
                  <ul className="mt-2 space-y-1">
                    {responsables.map((m) => (
                      <li
                        key={m.id}
                        className="flex flex-wrap items-center justify-between gap-2 text-sm"
                      >
                        <span>
                          {m.displayName} · {m.email}
                        </span>
                        <button
                          type="button"
                          className="font-bold text-erro underline"
                          onClick={() => {
                            if (
                              !window.confirm(t("admin.clubResponsableRemoveConfirm"))
                            ) {
                              return;
                            }
                            void apiX
                              .removeClubResponsable(slug, r.id, m.id)
                              .then(() =>
                                apiX.clubResponsables(slug, r.id).then((x) =>
                                  setResponsables(x.data),
                                ),
                              )
                              .catch(() => window.alert(t("common.error")));
                          }}
                        >
                          {t("admin.clubResponsableRemove")}
                        </button>
                      </li>
                    ))}
                    {responsables.length === 0 ? (
                      <li className="text-sm text-graphite">{t("admin.clubResponsablesEmpty")}</li>
                    ) : null}
                  </ul>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <input
                      type="email"
                      className="pa-input min-h-11 max-w-xs"
                      value={respEmail}
                      onChange={(e) => setRespEmail(e.target.value)}
                      placeholder="persoa@proba.gal"
                    />
                    <input
                      className="pa-input min-h-11 max-w-[10rem]"
                      value={respNif}
                      onChange={(e) => setRespNif(e.target.value.toUpperCase())}
                      placeholder={t("admin.staffNif")}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      className="pa-btn-secondary text-sm"
                      onClick={() => {
                        void apiX
                          .addClubResponsable(slug, r.id, {
                            email: respEmail,
                            nif: respNif.trim() || undefined,
                          })
                          .then(() => {
                            setRespEmail("");
                            setRespNif("");
                            return apiX.clubResponsables(slug, r.id);
                          })
                          .then((x) => setResponsables(x.data))
                          .catch((e: Error) => {
                            const code = e.message ?? "";
                            const key = code ? `error.${code}` : "";
                            const translated = key ? t(key) : "";
                            setErr(
                              translated && translated !== key
                                ? translated
                                : t("common.error"),
                            );
                          });
                      }}
                    >
                      {t("admin.clubResponsableAdd")}
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="submit" className="pa-btn-primary text-sm">
                    {t("admin.save")}
                  </button>
                  <button
                    type="button"
                    className="pa-btn-secondary text-sm"
                    onClick={() => setEditId(null)}
                  >
                    {t("common.close")}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <p className="font-bold">
                  {r.name}{" "}
                  <span className="text-sm font-normal text-graphite">({r.shortName})</span>
                  {r.account && !r.account.active && (
                    <span className="pa-chip-off ml-2">{t("admin.clubInactive")}</span>
                  )}
                </p>
                {r.account ? (
                  <p className="mt-1 text-sm text-graphite">
                    {t("admin.clubAccount")}: {r.account.displayName} · {r.account.email}
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-graphite">{t("admin.clubNoAccount")}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-3">
                  <Link
                    to={`/c/${slug}/clubs/${r.id}`}
                    className="text-sm font-bold underline"
                  >
                    {t("admin.clubOpen")}
                  </Link>
                  <button
                    type="button"
                    className="text-sm font-bold underline"
                    onClick={() => startEdit(r)}
                  >
                    {t("admin.clubEdit")}
                  </button>
                  {r.account?.active !== false ? (
                    <button
                      type="button"
                      className="text-sm font-bold underline text-[var(--pa-danger)]"
                      onClick={() => void setActive(r.id, false)}
                    >
                      {t("admin.clubDeactivate")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="text-sm font-bold underline"
                      onClick={() => void setActive(r.id, true)}
                    >
                      {t("admin.clubReactivateBtn")}
                    </button>
                  )}
                </div>
              </>
            )}
          </li>
        ))}
        {rows.length === 0 && (
          <li className="mt-2 list-none">
            <EmptyState title={t("admin.clubsEmpty")} body={t("admin.clubsEmptyHint")} />
          </li>
        )}
      </ul>
    </AdminShell>
  );
}

/** SIMPLIFICACION §2 / REVISION-11 S1 — Clubs e pavillón (contido inline). */
export function AdminClubsPavilionPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const rawTab = params.get("tab") || "pavillon";
  const tab = rawTab === "importar" ? "pavillon" : rawTab;
  const importOpen =
    rawTab === "importar" || params.get("import") === "1" || params.get("import") === "open";
  const tabs = [
    { id: "pavillon", label: t("nav.pavillon") },
    { id: "tempada", label: t("admin.season") },
    { id: "clubs", label: t("admin.clubs") },
    { id: "solicitudes", label: t("admin.requests") },
  ] as const;

  const setTab = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("tab", id);
    next.delete("import");
    setParams(next, { replace: true });
  };

  const openImport = () => {
    const next = new URLSearchParams(params);
    next.set("tab", "pavillon");
    next.set("import", "1");
    setParams(next, { replace: true });
    requestAnimationFrame(() => {
      document.getElementById("importar-partidos")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <AdminShell active="clubs-pavillon" pageTitle={t("admin.navClubsPavilion")}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-2" role="tablist">
          {tabs.map((x) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={tab === x.id}
              className={`min-h-11 rounded-full px-4 text-sm font-extrabold ${
                tab === x.id ? "bg-marino text-on-dark" : "border border-line bg-surface text-marino"
              }`}
              onClick={() => setTab(x.id)}
            >
              {x.label}
            </button>
          ))}
        </div>
        {tab === "pavillon" ? (
          <button
            type="button"
            className="ml-auto min-h-11 rounded-full border border-line bg-surface px-4 text-sm font-extrabold text-marino"
            onClick={openImport}
          >
            {t("admin.csvImportBtn")}
          </button>
        ) : null}
      </div>

      <Suspense fallback={<p className="text-graphite">{t("common.loading")}</p>}>
        <AdminEmbed>
          {tab === "tempada" ? (
            <AdminSeasonPage />
          ) : tab === "clubs" ? (
            <AdminClubsPage />
          ) : tab === "solicitudes" ? (
            <LazySolicitudesPage />
          ) : (
            <>
              <AdminPavilionPage />
              <details
                id="importar-partidos"
                className="mt-8 rounded-card border border-line bg-surface p-4"
                open={importOpen}
              >
                <summary className="cursor-pointer text-sm font-extrabold text-marino">
                  {t("admin.csvImport")}
                </summary>
                <div className="mt-4">
                  <LazyMatchImportPage />
                </div>
              </details>
              <div className="mt-10 border-t border-line pt-8">
                <h2 className="m-0 text-lg font-extrabold text-marino">{t("admin.requests")}</h2>
                <LazySolicitudesPage />
              </div>
            </>
          )}
        </AdminEmbed>
      </Suspense>
    </AdminShell>
  );
}

/** SIMPLIFICACION §2 / REVISION-11 S1 — Concello (contido inline). */
export function AdminConcelloPage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const rawTab = params.get("tab") || "indicadores";
  // Alias legado «vecinhaza» → «persoas» (REVISION-12 A5)
  const tab = rawTab === "vecinhaza" ? "persoas" : rawTab;
  const tabs = [
    { id: "indicadores", label: t("admin.indicators") },
    { id: "persoas", label: t("admin.people") },
    { id: "persoal", label: t("admin.staff") },
    { id: "personalizacion", label: t("admin.branding") },
    { id: "normas", label: t("admin.rulesGeneral") },
    { id: "datos", label: t("admin.datos") },
    { id: "auditoria", label: t("admin.audit") },
  ] as const;
  type ConcelloTab = (typeof tabs)[number]["id"];
  const activeTab: ConcelloTab = tabs.some((x) => x.id === tab)
    ? (tab as ConcelloTab)
    : "indicadores";

  const renderTab = (id: ConcelloTab) => {
    switch (id) {
      case "persoas":
        return <LazyPeoplePage />;
      case "persoal":
        return <AdminStaffPage />;
      case "personalizacion":
        return <AdminBrandingPage />;
      case "normas":
        return <LazyRulesPage sections="system" />;
      case "datos":
        return <AdminDatosPage />;
      case "auditoria":
        return <AdminAuditoriaPage />;
      case "indicadores":
        return <AdminIndicatorsPage />;
      default: {
        const _exhaustive: never = id;
        return _exhaustive;
      }
    }
  };

  return (
    <AdminShell active="concello" pageTitle={t("admin.navTown")}>
      <div className="mb-4 flex flex-wrap gap-2" role="tablist">
        {tabs.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={activeTab === x.id}
            className={`min-h-11 rounded-full px-4 text-sm font-extrabold ${
              activeTab === x.id
                ? "bg-marino text-on-dark"
                : "border border-line bg-surface text-marino"
            }`}
            onClick={() => {
              const next = new URLSearchParams(params);
              next.set("tab", x.id);
              setParams(next, { replace: true });
            }}
          >
            {x.label}
          </button>
        ))}
      </div>

      <Suspense fallback={<p className="text-graphite">{t("common.loading")}</p>}>
        <AdminEmbed>{renderTab(activeTab)}</AdminEmbed>
      </Suspense>
      {activeTab === "indicadores" ? (
        <p className="mt-4 text-sm text-graphite">
          <Link to={`/c/${slug}/datos-abertos`} className="font-bold text-azul-700 no-underline hover:underline">
            {t("nav.openData")}
          </Link>
        </p>
      ) : null}
    </AdminShell>
  );
}
