import {
  lazy,
  Suspense,
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { SessionProvider } from "./context/SessionContext";
import { AppChrome } from "./components/AppChrome";
import { RoleGate } from "./components/RoleGate";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { ConvitePage } from "./pages/ConvitePage";
import { MunicipalityPage } from "./pages/MunicipalityPage";
import { FacilitiesPage } from "./pages/FacilitiesPage";
import { ReservePage } from "./pages/ReservePage";
import { ReservarHubPage } from "./pages/ReservarHubPage";
import { BookingConfirmPage } from "./pages/BookingConfirmPage";
import { MyBookingsPage } from "./pages/MyBookingsPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { DeputacionGate } from "./components/DeputacionGate";
import { AltaConcelloGate } from "./components/AltaConcelloGate";
import { SingleMuniRedirect } from "./components/SingleMuniRedirect";

/** Páxinas cidadás secundarias / legais / panel — chunks aparte (redeseno A8). */
const PavilionPage = lazy(() =>
  import("./pages/PavilionPage").then((m) => ({ default: m.PavilionPage })),
);
const ActivitiesPage = lazy(() =>
  import("./pages/ActivitiesPage").then((m) => ({ default: m.ActivitiesPage })),
);
const ActivityDetailPage = lazy(() =>
  import("./pages/ActivityDetailPage").then((m) => ({ default: m.ActivityDetailPage })),
);
const OnboardWizardPage = lazy(() =>
  import("./pages/OnboardWizardPage").then((m) => ({ default: m.OnboardWizardPage })),
);
const DemoEntrarPage = lazy(() =>
  import("./pages/DemoEntrarPage").then((m) => ({ default: m.DemoEntrarPage })),
);
const LegalPage = lazy(() =>
  import("./pages/LegalPage").then((m) => ({ default: m.LegalPage })),
);
const PlatformLegalPage = lazy(() =>
  import("./pages/PlatformLegalPage").then((m) => ({
    default: m.PlatformLegalPage,
  })),
);
const WidgetPage = lazy(() =>
  import("./pages/WidgetPage").then((m) => ({ default: m.WidgetPage })),
);
const ContactPage = lazy(() =>
  import("./pages/ContactPage").then((m) => ({ default: m.ContactPage })),
);
const OpenMatchesPage = lazy(() =>
  import("./pages/OpenMatchesPage").then((m) => ({ default: m.OpenMatchesPage })),
);
const OpenMatchDetailPage = lazy(() =>
  import("./pages/OpenMatchDetailPage").then((m) => ({
    default: m.OpenMatchDetailPage,
  })),
);
const AdminOpenMatchesPage = lazy(() =>
  import("./pages/AdminOpenMatchesPage").then((m) => ({
    default: m.AdminOpenMatchesPage,
  })),
);
const CertificadoInfoPage = lazy(() =>
  import("./pages/CertificadoInfoPage").then((m) => ({
    default: m.CertificadoInfoPage,
  })),
);
const AccountPage = lazy(() =>
  import("./pages/AccountPage").then((m) => ({ default: m.AccountPage })),
);
const StaffAccountPage = lazy(() =>
  import("./pages/StaffAccountPage").then((m) => ({
    default: m.StaffAccountPage,
  })),
);
const ConsentStartPage = lazy(() =>
  import("./pages/ConsentStartPage").then((m) => ({ default: m.ConsentStartPage })),
);
const EasyReadPage = lazy(() =>
  import("./pages/EasyReadPage").then((m) => ({ default: m.EasyReadPage })),
);
const NoticesPage = lazy(() =>
  import("./pages/NoticesPage").then((m) => ({ default: m.NoticesPage })),
);
const WeekendPublicPage = lazy(() =>
  import("./pages/WeekendPublicPage").then((m) => ({ default: m.WeekendPublicPage })),
);
const OpenDataPage = lazy(() =>
  import("./pages/OpenDataPage").then((m) => ({ default: m.OpenDataPage })),
);
const IncidentPage = lazy(() =>
  import("./pages/IncidentPage").then((m) => ({ default: m.IncidentPage })),
);
const DoorCheckinPage = lazy(() =>
  import("./pages/DoorCheckinPage").then((m) => ({ default: m.DoorCheckinPage })),
);
const DemoGuidePage = lazy(() =>
  import("./pages/DemoGuidePage").then((m) => ({ default: m.DemoGuidePage })),
);
const QrPosterPage = lazy(() =>
  import("./pages/QrPosterPage").then((m) => ({ default: m.QrPosterPage })),
);
const DeputacionPage = lazy(() =>
  import("./pages/DeputacionPage").then((m) => ({ default: m.DeputacionPage })),
);

const StaffCheckinPage = lazy(() =>
  import("./pages/StaffCheckinPage").then((m) => ({ default: m.StaffCheckinPage })),
);
const StaffSheetPage = lazy(() =>
  import("./pages/StaffSheetPage").then((m) => ({ default: m.StaffSheetPage })),
);
const OfflinePage = lazy(() =>
  import("./pages/OfflinePage").then((m) => ({ default: m.OfflinePage })),
);
const ClubPortalPage = lazy(() =>
  import("./pages/ClubPortalPage").then((m) => ({ default: m.ClubPortalPage })),
);
const ClubsIndexPage = lazy(() =>
  import("./pages/ClubsIndexPage").then((m) => ({ default: m.ClubsIndexPage })),
);
const AdminIncidentsPage = lazy(() =>
  import("./pages/AdminIncidentsPage").then((m) => ({ default: m.AdminIncidentsPage })),
);
const AdminMonthlyReportPage = lazy(() =>
  import("./pages/AdminMonthlyReportPage").then((m) => ({
    default: m.AdminMonthlyReportPage,
  })),
);

function LazyFallback() {
  return (
    <main className="pa-page">
      <p className="text-graphite">…</p>
    </main>
  );
}

/** Carga un export concreto de AdminPages nun chunk aparte. */
function AdminRoute({ name }: { name: string }) {
  const Lazy = lazy(async () => {
    const mod = (await import("./pages/AdminPages")) as unknown as Record<
      string,
      ComponentType
    >;
    const Comp = mod[name];
    if (!Comp) throw new Error(`Admin export missing: ${name}`);
    return { default: Comp };
  });
  return (
    <Suspense fallback={<LazyFallback />}>
      <Lazy />
    </Suspense>
  );
}

function SuspenseGate({ children }: { children: ReactNode }) {
  return <Suspense fallback={<LazyFallback />}>{children}</Suspense>;
}

function LegalRoute({ tab }: { tab: "privacidade" | "accesibilidade" | "aviso" | "cookies" }) {
  return (
    <SuspenseGate>
      <LegalPage tab={tab} />
    </SuspenseGate>
  );
}

function PlatformLegalRoute({
  tab,
}: {
  tab: "privacidade" | "accesibilidade" | "aviso" | "cookies";
}) {
  return (
    <SuspenseGate>
      <PlatformLegalPage tab={tab} />
    </SuspenseGate>
  );
}

function LegacyAdminRedirect({ to }: { to: string }) {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  return <Navigate to={`/c/${slug}/admin/${to}`} replace />;
}

/** REVISION-11 S1 — rutas vellas → hub?tab= */
function LegacyAdminHubRedirect({
  hub,
  tab,
  importOpen,
}: {
  hub: "clubs-pavillon" | "concello" | "";
  tab?: string;
  importOpen?: boolean;
}) {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const base = hub ? `/c/${slug}/admin/${hub}` : `/c/${slug}/admin`;
  const qs = new URLSearchParams();
  if (tab) qs.set("tab", tab);
  if (importOpen) qs.set("import", "1");
  const q = qs.toString();
  const to = q ? `${base}?${q}` : base;
  return <Navigate to={to} replace />;
}

/** REVISION-12 A12 — /admin/horarios|grupos → ficha instalación ?tab= */
function LegacyFacilityTabRedirect({ tab }: { tab: string }) {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  return (
    <SuspenseGate>
      <LegacyFacilityTabRedirectInner slug={slug} tab={tab} />
    </SuspenseGate>
  );
}

function mapLegacyFacilityTab(tab: string): string {
  if (tab === "unidades") return "datos";
  if (tab === "horarios") return "horarios-peches";
  if (tab === "grupos") return "horarios-peches";
  if (tab === "cartel-qr") return "acceso";
  return tab;
}

function LegacyFacilityTabRedirectInner({
  slug,
  tab,
}: {
  slug: string;
  tab: string;
}) {
  const [to, setTo] = useState<string | null>(null);
  const mappedTab = mapLegacyFacilityTab(tab);
  useEffect(() => {
    let cancelled = false;
    void import("./lib/api-complete").then(({ apiX }) =>
      apiX
        .adminFacilities(slug)
        .then((r) => {
          if (cancelled) return;
          const id = r.data[0]?.id;
          setTo(
            id
              ? `/c/${slug}/admin/instalacions/${id}?tab=${mappedTab}`
              : `/c/${slug}/admin/instalacions`,
          );
        })
        .catch(() => {
          if (!cancelled) setTo(`/c/${slug}/admin/instalacions`);
        }),
    );
    return () => {
      cancelled = true;
    };
  }, [slug, mappedTab]);
  if (!to) return <LazyFallback />;
  return <Navigate to={to} replace />;
}

export default function App() {
  return (
    <SessionProvider>
      <AppChrome>
        <Routes>
          <Route
            path="/"
            element={
              <SingleMuniRedirect kind="home">
                <HomePage />
              </SingleMuniRedirect>
            }
          />
          <Route
            path="/demo"
            element={
              <SuspenseGate>
                <DemoGuidePage />
              </SuspenseGate>
            }
          />
          <Route
            path="/entrar/:slug/:perfil"
            element={
              <SuspenseGate>
                <DemoEntrarPage />
              </SuspenseGate>
            }
          />
          <Route
            path="/acceso"
            element={
              <SingleMuniRedirect kind="acceso">
                <LoginPage />
              </SingleMuniRedirect>
            }
          />
          <Route path="/c/:slug/acceso" element={<LoginPage />} />
          <Route path="/convite/:token" element={<ConvitePage />} />
          {/* REVISION-37 I5 — privacidade plataforma / Deputación (sen menú reservar) */}
          <Route path="/legal/privacidade" element={<PlatformLegalRoute tab="privacidade" />} />
          <Route
            path="/legal/accesibilidade"
            element={<PlatformLegalRoute tab="accesibilidade" />}
          />
          <Route path="/legal/aviso" element={<PlatformLegalRoute tab="aviso" />} />
          <Route path="/legal/cookies" element={<PlatformLegalRoute tab="cookies" />} />
          <Route path="/plataforma" element={<Navigate to="/" replace />} />
          <Route
            path="/alta-concello"
            element={
              <AltaConcelloGate>
                <SuspenseGate>
                  <OnboardWizardPage />
                </SuspenseGate>
              </AltaConcelloGate>
            }
          />
          <Route
            path="/deputacion"
            element={
              <DeputacionGate>
                <SuspenseGate>
                  <DeputacionPage />
                </SuspenseGate>
              </DeputacionGate>
            }
          />
          <Route path="/admin/deputacion" element={<Navigate to="/deputacion" replace />} />

          <Route path="/c/:slug" element={<MunicipalityPage />} />
          <Route path="/c/:slug/instalacions" element={<FacilitiesPage />} />
          <Route path="/c/:slug/reservar" element={<ReservarHubPage />} />
          <Route path="/c/:slug/reservar/:facilityId" element={<ReservePage />} />
          <Route
            path="/c/:slug/contacto"
            element={
              <SuspenseGate>
                <ContactPage />
              </SuspenseGate>
            }
          />
          <Route
            path="/c/:slug/widget"
            element={
              <SuspenseGate>
                <WidgetPage />
              </SuspenseGate>
            }
          />
          <Route
            path="/c/:slug/widget/:facilityId"
            element={
              <SuspenseGate>
                <WidgetPage />
              </SuspenseGate>
            }
          />
          <Route
            path="/c/:slug/lectura-facil"
            element={
              <SuspenseGate>
                <EasyReadPage />
              </SuspenseGate>
            }
          />
          <Route path="/c/:slug/reserva/:id" element={<BookingConfirmPage />} />
          <Route path="/c/:slug/reservas" element={<MyBookingsPage />} />
          <Route
            path="/c/:slug/pavillon"
            element={
              <SuspenseGate>
                <PavilionPage />
              </SuspenseGate>
            }
          />
          <Route
            path="/c/:slug/fin-de-semana"
            element={
              <SuspenseGate>
                <WeekendPublicPage />
              </SuspenseGate>
            }
          />
          <Route
            path="/c/:slug/actividades"
            element={
              <SuspenseGate>
                <ActivitiesPage />
              </SuspenseGate>
            }
          />
          <Route
            path="/c/:slug/actividades/:id"
            element={
              <SuspenseGate>
                <ActivityDetailPage />
              </SuspenseGate>
            }
          />
          <Route
            path="/c/:slug/partidos-abertos"
            element={
              <SuspenseGate>
                <OpenMatchesPage />
              </SuspenseGate>
            }
          />
          <Route
            path="/c/:slug/partidos-abertos/:id"
            element={
              <SuspenseGate>
                <OpenMatchDetailPage />
              </SuspenseGate>
            }
          />
          <Route
            path="/c/:slug/avisos"
            element={
              <SuspenseGate>
                <NoticesPage />
              </SuspenseGate>
            }
          />
          <Route
            path="/c/:slug/incidencia"
            element={
              <SuspenseGate>
                <IncidentPage />
              </SuspenseGate>
            }
          />
          <Route
            path="/c/:slug/conta"
            element={
              <SuspenseGate>
                <AccountPage />
              </SuspenseGate>
            }
          />
          <Route
            path="/c/:slug/admin/conta"
            element={
              <RoleGate allow={["admin", "superadmin"]} title="Admin">
                <SuspenseGate>
                  <StaffAccountPage />
                </SuspenseGate>
              </RoleGate>
            }
          />
          <Route
            path="/c/:slug/conserxeria/conta"
            element={
              <RoleGate allow={["staff", "monitor", "admin", "superadmin"]} title="Conserxería">
                <SuspenseGate>
                  <StaffAccountPage />
                </SuspenseGate>
              </RoleGate>
            }
          />
          <Route
            path="/c/:slug/antes-de-comezar"
            element={
              <SuspenseGate>
                <ConsentStartPage />
              </SuspenseGate>
            }
          />
          <Route
            path="/c/:slug/datos-abertos"
            element={
              <SuspenseGate>
                <OpenDataPage />
              </SuspenseGate>
            }
          />
          <Route
            path="/c/:slug/porta/:facilityId"
            element={
              <SuspenseGate>
                <DoorCheckinPage />
              </SuspenseGate>
            }
          />

          <Route path="/c/:slug/legal/privacidade" element={<LegalRoute tab="privacidade" />} />
          <Route
            path="/c/:slug/legal/accesibilidade"
            element={<LegalRoute tab="accesibilidade" />}
          />
          <Route path="/c/:slug/legal/aviso" element={<LegalRoute tab="aviso" />} />
          <Route path="/c/:slug/legal/cookies" element={<LegalRoute tab="cookies" />} />
          <Route
            path="/c/:slug/legal/certificado"
            element={
              <SuspenseGate>
                <CertificadoInfoPage />
              </SuspenseGate>
            }
          />
          <Route
            path="/acceso/certificado"
            element={
              <SuspenseGate>
                <CertificadoInfoPage />
              </SuspenseGate>
            }
          />

          <Route
            path="/c/:slug/conserxeria"
            element={
              <RoleGate allow={["staff", "monitor", "admin", "superadmin"]} title="Conserxería">
                <SuspenseGate>
                  <StaffCheckinPage />
                </SuspenseGate>
              </RoleGate>
            }
          />
          <Route
            path="/c/:slug/offline"
            element={
              <SuspenseGate>
                <OfflinePage />
              </SuspenseGate>
            }
          />
          <Route
            path="/c/:slug/folla-conserxe"
            element={
              <RoleGate allow={["staff", "monitor", "admin", "superadmin"]} title="Folla conserxe">
                <SuspenseGate>
                  <StaffSheetPage />
                </SuspenseGate>
              </RoleGate>
            }
          />
          <Route
            path="/c/:slug/cartel-qr"
            element={
              <SuspenseGate>
                <QrPosterPage />
              </SuspenseGate>
            }
          />

          <Route
            path="/c/:slug/clubs"
            element={
              <RoleGate allow={["club_manager", "admin", "superadmin"]} title="Clubs">
                <SuspenseGate>
                  <ClubsIndexPage />
                </SuspenseGate>
              </RoleGate>
            }
          />
          <Route
            path="/c/:slug/clubs/:clubId"
            element={
              <RoleGate allow={["club_manager", "admin", "superadmin"]}>
                <SuspenseGate>
                  <ClubPortalPage view="home" />
                </SuspenseGate>
              </RoleGate>
            }
          />
          <Route
            path="/c/:slug/clubs/:clubId/tempada"
            element={
              <RoleGate allow={["club_manager", "admin", "superadmin"]}>
                <SuspenseGate>
                  <ClubPortalPage view="tempada" />
                </SuspenseGate>
              </RoleGate>
            }
          />
          <Route
            path="/c/:slug/clubs/:clubId/partidos"
            element={<Navigate to=".." relative="path" replace />}
          />
          <Route
            path="/c/:slug/clubs/:clubId/datos"
            element={
              <RoleGate allow={["club_manager", "admin", "superadmin"]}>
                <SuspenseGate>
                  <ClubPortalPage view="datos" />
                </SuspenseGate>
              </RoleGate>
            }
          />

          <Route
            path="/c/:slug/admin"
            element={
              <RoleGate allow={["admin", "superadmin"]} title="Admin">
                <AdminRoute name="AdminHomePage" />
              </RoleGate>
            }
          />
          <Route
            path="/c/:slug/admin/reservas"
            element={
              <RoleGate allow={["admin", "superadmin"]}>
                <LegacyAdminHubRedirect hub="" />
              </RoleGate>
            }
          />
          <Route
            path="/c/:slug/admin/reservar-nome"
            element={
              <RoleGate allow={["admin", "superadmin"]}>
                <AdminRoute name="AdminBookForPage" />
              </RoleGate>
            }
          />
          <Route
            path="/c/:slug/admin/instalacions"
            element={
              <RoleGate allow={["admin", "superadmin"]}>
                <AdminRoute name="AdminFacilitiesPage" />
              </RoleGate>
            }
          />
          <Route
            path="/c/:slug/admin/instalacions/:id"
            element={
              <RoleGate allow={["admin", "superadmin"]}>
                <AdminRoute name="AdminFacilityDetailPage" />
              </RoleGate>
            }
          />
          <Route
            path="/c/:slug/admin/actividades"
            element={
              <RoleGate allow={["admin", "superadmin"]}>
                <AdminRoute name="AdminActivitiesPage" />
              </RoleGate>
            }
          />
          <Route
            path="/c/:slug/admin/actividades/:id"
            element={
              <RoleGate allow={["admin", "superadmin"]}>
                <AdminRoute name="AdminActivityDetailPage" />
              </RoleGate>
            }
          />
          <Route
            path="/c/:slug/admin/partidos-abertos"
            element={
              <RoleGate allow={["admin", "superadmin", "staff"]}>
                <SuspenseGate>
                  <AdminOpenMatchesPage />
                </SuspenseGate>
              </RoleGate>
            }
          />
          <Route
            path="/c/:slug/admin/pavillon"
            element={
              <RoleGate allow={["admin", "superadmin"]}>
                <LegacyAdminHubRedirect hub="clubs-pavillon" tab="pavillon" />
              </RoleGate>
            }
          />
          <Route
            path="/c/:slug/admin/tempada"
            element={
              <RoleGate allow={["admin", "superadmin"]}>
                <LegacyAdminHubRedirect hub="clubs-pavillon" tab="tempada" />
              </RoleGate>
            }
          />
          <Route
            path="/c/:slug/admin/importar-partidos"
            element={
              <RoleGate allow={["admin", "superadmin"]}>
                <LegacyAdminHubRedirect hub="clubs-pavillon" tab="pavillon" importOpen />
              </RoleGate>
            }
          />
          <Route
            path="/c/:slug/admin/indicadores"
            element={
              <RoleGate allow={["admin", "superadmin"]}>
                <LegacyAdminHubRedirect hub="concello" tab="indicadores" />
              </RoleGate>
            }
          />
          <Route
            path="/c/:slug/admin/exportar"
            element={
              <RoleGate allow={["admin", "superadmin"]}>
                <LegacyAdminHubRedirect hub="concello" tab="indicadores" />
              </RoleGate>
            }
          />
          <Route
            path="/c/:slug/admin/auditoria"
            element={
              <RoleGate allow={["admin", "superadmin"]}>
                <LegacyAdminHubRedirect hub="concello" tab="auditoria" />
              </RoleGate>
            }
          />
          <Route
            path="/c/:slug/admin/personalizacion"
            element={
              <RoleGate allow={["admin", "superadmin"]}>
                <LegacyAdminHubRedirect hub="concello" tab="personalizacion" />
              </RoleGate>
            }
          />
          <Route
            path="/c/:slug/admin/datos"
            element={
              <RoleGate allow={["admin", "superadmin"]}>
                <LegacyAdminHubRedirect hub="concello" tab="datos" />
              </RoleGate>
            }
          />
          <Route
            path="/c/:slug/admin/persoal"
            element={
              <RoleGate allow={["admin", "superadmin"]}>
                <LegacyAdminHubRedirect hub="concello" tab="persoal" />
              </RoleGate>
            }
          />
          <Route
            path="/c/:slug/admin/clubs"
            element={
              <RoleGate allow={["admin", "superadmin"]}>
                <LegacyAdminHubRedirect hub="clubs-pavillon" tab="clubs" />
              </RoleGate>
            }
          />
          <Route
            path="/c/:slug/admin/normas"
            element={
              <RoleGate allow={["admin", "superadmin"]}>
                <LegacyAdminHubRedirect hub="concello" tab="normas" />
              </RoleGate>
            }
          />
          <Route
            path="/c/:slug/admin/horarios"
            element={
              <RoleGate allow={["admin", "superadmin"]}>
                <LegacyFacilityTabRedirect tab="horarios" />
              </RoleGate>
            }
          />
          <Route
            path="/c/:slug/admin/peches"
            element={
              <RoleGate allow={["admin", "superadmin"]}>
                <LegacyFacilityTabRedirect tab="peches" />
              </RoleGate>
            }
          />
          <Route
            path="/c/:slug/admin/solicitudes"
            element={
              <RoleGate allow={["admin", "superadmin"]}>
                <LegacyAdminHubRedirect hub="clubs-pavillon" tab="solicitudes" />
              </RoleGate>
            }
          />
          <Route
            path="/c/:slug/admin/monitoraxe"
            element={<LegacyAdminRedirect to="actividades" />}
          />
          <Route
            path="/c/:slug/admin/clubs-pavillon"
            element={
              <RoleGate allow={["admin", "superadmin"]}>
                <AdminRoute name="AdminClubsPavilionPage" />
              </RoleGate>
            }
          />
          <Route
            path="/c/:slug/admin/concello"
            element={
              <RoleGate allow={["admin", "superadmin"]}>
                <AdminRoute name="AdminConcelloPage" />
              </RoleGate>
            }
          />
          <Route
            path="/c/:slug/admin/incidencias"
            element={
              <RoleGate allow={["admin", "superadmin"]}>
                <SuspenseGate>
                  <AdminIncidentsPage />
                </SuspenseGate>
              </RoleGate>
            }
          />
          <Route
            path="/c/:slug/admin/grupos-fixos"
            element={
              <RoleGate allow={["admin", "superadmin"]}>
                <LegacyFacilityTabRedirect tab="grupos" />
              </RoleGate>
            }
          />
          <Route
            path="/c/:slug/admin/persoas"
            element={
              <RoleGate allow={["admin", "superadmin"]}>
                <LegacyAdminHubRedirect hub="concello" tab="persoas" />
              </RoleGate>
            }
          />
          <Route
            path="/c/:slug/admin/informe"
            element={
              <RoleGate allow={["admin", "superadmin"]}>
                <SuspenseGate>
                  <AdminMonthlyReportPage />
                </SuspenseGate>
              </RoleGate>
            }
          />

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AppChrome>
    </SessionProvider>
  );
}
