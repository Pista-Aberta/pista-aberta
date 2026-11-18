import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getCookie, deleteCookie, setCookie } from "hono/cookie";
import { resolvePostLoginPath, resolveTheme, type Role } from "@pista-aberta/shared";
import {
  CompositeIdentityProvider,
  createSession,
  getSession,
} from "./identity/index.js";
import {
  resolveUserSlug,
  setSessionActiveClub,
  setSessionActiveMuniRole,
} from "./identity/sessions.js";
import { DemoMunicipalityNotCreatedError } from "./identity/demo-users-provision.js";
import {
  getLoadedDemoFileUsers,
  hasDemoUsersFile,
} from "./identity/demo-users-file.js";
import { setSessionCookie } from "./identity/session-cookie.js";
import { certOrigin } from "./identity/cert-origin.js";
import { SAML_DEMO_USERS } from "./identity/saml-users.js";
import { idpAutoPostHtml } from "./identity/saml-idp.js";
import { IDP_HTML_CSP } from "./identity/saml-idp-csp.js";
import { renderMockIdpSelectHtml } from "./identity/saml-idp-select-html.js";
import {
  describeSamlEndpoints,
  getSpMetadataXml,
  validateAcsPost,
} from "./identity/saml-sp.js";
import { municipalityMiddleware } from "./tenancy.js";
import {
  optionalAuth,
  requireAuth,
  requireMuniRoles,
  requireSameMunicipality,
  deputacionAnonymizeMiddleware,
} from "./middleware/auth.js";
import { originGuard } from "./middleware/origin-guard.js";
import {
  getSingleMuniSlug,
  isCertLoginEnabled,
  isDemoEmptyMode,
  isDemoMode,
  isSamlLoginConfigured,
} from "./env.js";
import { certificateRoutes } from "./identity/certificate-routes.js";
import { newId } from "./lib/ids.js";
import { StrongAuthRequiredError } from "./identity/email-otp.js";
import {
  registerAuthLoginRoute,
  samlRoutesExposed,
} from "./identity/auth-login-route.js";
import { withLoginParam } from "./identity/login-rate-limit.js";
import {
  applyToActivity,
  assertMunicipalityCreateRateLimit,
  cancelBooking,
  checkInByQr,
  createBooking,
  modifyBooking,
  createMunicipality,
  getActivity,
  getBooking,
  getFacility,
  getMunicipalityBySlug,
  listActivities,
  listApplicationsPublic,
  listBookings,
  listFacilities,
  listMunicipalities,
  listSlots,
  listUnits,
  pavilionWeekend,
  proposeSwap,
  resolveConflict,
  runLottery,
  verifyLottery,
} from "./store/db.js";
import { completeRoutes } from "./routes/complete.js";
import { adminMellorasRoutes } from "./routes/admin-melloras.js";
import { avisosBaixaRoutes } from "./routes/avisos-baixa.js";
import {
  publicPortalRoutes,
  registerMockIdpRoutes,
} from "./routes/public-portal-routes.js";
import { bootstrap } from "./bootstrap.js";
import { getDbMode } from "./db/client.js";
import { clientSentPriorityGroup } from "./store/business-rules.js";
import { z } from "zod";

const app = new Hono();
const identity = new CompositeIdentityProvider();
const port = Number(process.env.API_PORT ?? 3001);
const appBase = process.env.APP_BASE_URL ?? "http://localhost:3000";
/** REVISION-52 L1 — orixe da landing pública (partidos abertos sen credentials). */
const landingOrigin = (
  process.env.LANDING_ORIGIN ?? "https://pistaaberta.com"
).replace(/\/$/, "");

/* REVISION-30 Z6 — validación Zod → 400 (non 500). */
app.onError((err, c) => {
  if (err instanceof z.ZodError) {
    return c.json(
      {
        error: "validation_error",
        issues: err.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      400,
    );
  }
  console.error(err);
  return c.json({ error: "internal" }, 500);
});

const checkinBodySchema = z
  .object({
    qrPayload: z.string().min(1).max(2048).optional(),
    shortCode: z.string().min(2).max(32).optional(),
  })
  .refine((v) => !!(v.qrPayload || v.shortCode), {
    message: "qrPayload_or_shortCode_required",
  });

app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header(
    "Permissions-Policy",
    "camera=(self), microphone=(), geolocation=()",
  );
  c.header("X-DNS-Prefetch-Control", "off");
  if (!c.res.headers.get("Content-Security-Policy")) {
    c.header(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    );
  }
});

/* REVISION-52 L1 — CORS landing para GET públicos (partidos + facilities demo), sen credentials. */
app.use("*", async (c, next) => {
  const path = c.req.path.replace(/\/$/, "");
  const isPublicList =
    /^\/api\/c\/[^/]+\/partidos-abertos$/.test(path) ||
    /^\/api\/c\/[^/]+\/facilities$/.test(path);
  if (!isPublicList) {
    await next();
    return;
  }
  const method = c.req.method.toUpperCase();
  if (method !== "GET" && method !== "OPTIONS" && method !== "HEAD") {
    await next();
    return;
  }
  const origin = (c.req.header("origin") ?? "").replace(/\/$/, "");
  if (origin !== landingOrigin) {
    await next();
    return;
  }
  if (method === "OPTIONS") {
    c.header("Access-Control-Allow-Origin", landingOrigin);
    c.header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    c.header("Access-Control-Allow-Headers", "Accept, Content-Type");
    c.header("Access-Control-Max-Age", "86400");
    c.header("Vary", "Origin");
    return c.body(null, 204);
  }
  await next();
  c.res.headers.set("Access-Control-Allow-Origin", landingOrigin);
  c.res.headers.append("Vary", "Origin");
  c.res.headers.delete("Access-Control-Allow-Credentials");
});

app.use(
  "*",
  cors({
    origin: [appBase, "http://localhost:3000", "http://127.0.0.1:3000"],
    credentials: true,
  }),
);
/* REVISION-46: orixe allea → 403 forbidden_origin (excepto widget + Cl@ve). */
app.use("*", originGuard);
app.use("*", optionalAuth);
app.use("/api/c/:slug/*", deputacionAnonymizeMiddleware);
app.route("/", completeRoutes);
app.route("/", adminMellorasRoutes);
app.route("/", avisosBaixaRoutes);
app.route("/", certificateRoutes());

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "pista-aberta-api",
    db: getDbMode(),
    ts: new Date().toISOString(),
  }),
);

/** Flags públicos (sen segredos) para a UI de acceso. */
/**
 * REVISION-37 I5 / REVISION-38 K5 —
 * titular + correo: Deputación (org) ou concello único; sen correo fixo.
 */
app.get("/api/legal/platform", async (c) => {
  try {
    const { getDeputacionOrganization } = await import(
      "./store/deputacion-org.js"
    );
    const org = await getDeputacionOrganization();
    if (org?.name?.trim()) {
      return c.json({
        data: {
          titular: org.name.trim(),
          email: org.email?.trim() || null,
          mode: "deputacion" as const,
        },
      });
    }
    const single = getSingleMuniSlug();
    if (single) {
      const muni = await getMunicipalityBySlug(single);
      const email = muni?.settings?.legal?.email?.trim() || null;
      return c.json({
        data: {
          titular: muni?.name?.trim() || single,
          email,
          mode: "concello" as const,
        },
      });
    }
    return c.json({ data: { titular: null, email: null, mode: "none" as const } });
  } catch {
    return c.json({ data: { titular: null, email: null, mode: "none" as const } });
  }
});

app.get("/api/config", (c) => {
  const origin = certOrigin();
  const demo = process.env.PA_DEMO === "1" || process.env.PA_DEMO === "true";
  let demoClub: { municipalitySlug: string; clubName: string } | null = null;
  if (hasDemoUsersFile()) {
    const club = getLoadedDemoFileUsers()?.find((u) => u.role === "club");
    if (club?.clubName && club.municipalitySlug) {
      demoClub = {
        municipalitySlug: club.municipalitySlug,
        clubName: club.clubName,
      };
    }
  }
  return c.json({
    certLogin: isCertLoginEnabled(),
    samlLogin: isSamlLoginConfigured(),
    certOrigin: origin || null,
    appBaseUrl: process.env.APP_BASE_URL ?? null,
    demo,
    demoEmpty: isDemoEmptyMode(),
    demoClub,
    /** REVISION-22 A8 — slug do único concello, ou null. */
    singleMuni: getSingleMuniSlug(),
  });
});

/* ——— Multi-concello + rutas públicas endurecidas (REVISION-60) ——— */
app.route("/", publicPortalRoutes);

app.post("/api/municipalities", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "unauthorized" }, 401);
  if (user.role !== "superadmin") return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json<{
    name: string;
    slug: string;
    accentColor?: string;
  }>();
  const slug = (body.slug ?? "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!body.name?.trim() || !slug) {
    return c.json({ error: "invalid" }, 400);
  }
  try {
    assertMunicipalityCreateRateLimit();
    const sandbox = false;
    const m = await createMunicipality({
      name: body.name.trim(),
      slug,
      accentColor: body.accentColor ?? "#3D4A3A",
      sandbox,
    });
    return c.json({ data: m, sandbox: !!m.settings.sandbox }, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    if (msg === "rate_limited") return c.json({ error: "rate_limited" }, 429);
    return c.json({ error: "slug_exists" }, 409);
  }
});

/**
 * REVISION-22 A7 — manifest PWA por concello.
 * Nome «Exemplo: reservas», short_name curto, id=/c/{slug}, theme_color.
 * Icona 512 maskable: se o escudo é PNG úsase; se é SVG (sen rasterizar)
 * caemos nos PNG por defecto de /icons (fallback documentado).
 */
app.get("/api/c/:slug/manifest.webmanifest", municipalityMiddleware, async (c) => {
  const slug = c.get("municipalitySlug");
  const muni = await getMunicipalityBySlug(slug);
  if (!muni) return c.json({ error: "not_found" }, 404);
  const theme = resolveTheme({
    accentColor: muni.accentColor,
    theme: muni.settings.theme,
  });
  const shortName = muni.name.replace(/^Concello de\s+/i, "").trim() || muni.name;
  const initial = shortName.charAt(0) || "P";
  const { muniIconCacheKey } = await import("./lib/muni-icon-png.js");
  const v =
    c.req.query("v") ||
    muniIconCacheKey(muni.settings.logoDataUrl, theme.brand, initial);
  const q = `?v=${encodeURIComponent(v)}`;
  /* Iconas co escudo; ?v= bust cache cando cambia o logo. */
  const icons = [
    {
      src: `/api/c/${slug}/icon-192.png${q}`,
      sizes: "192x192",
      type: "image/png",
      purpose: "any",
    },
    {
      src: `/api/c/${slug}/icon-512.png${q}`,
      sizes: "512x512",
      type: "image/png",
      purpose: "any",
    },
    {
      src: `/api/c/${slug}/icon-512.png${q}`,
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ];
  const body = {
    id: `/c/${slug}`,
    name: `${shortName}: reservas`,
    short_name: shortName,
    description: `Reserva de instalacións deportivas — ${shortName}`,
    lang: "gl",
    start_url: `/c/${slug}/`,
    scope: `/`,
    display: "standalone",
    background_color: "#FFFFFF",
    theme_color: theme.brand,
    icons,
  };
  return c.body(JSON.stringify(body, null, 2), 200, {
    "Content-Type": "application/manifest+json; charset=utf-8",
    "Cache-Control": "public, max-age=300",
  });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function respondMuniIcon(c: any, size: 180 | 192 | 512, apple: boolean) {
  const slug = c.get("municipalitySlug");
  const muni = await getMunicipalityBySlug(slug);
  if (!muni) return c.json({ error: "not_found" }, 404);
  const theme = resolveTheme({
    accentColor: muni.accentColor,
    theme: muni.settings.theme,
  });
  const initial =
    muni.name.replace(/^Concello de\s+/i, "").charAt(0) || "P";
  const { buildMunicipalityIconPng, muniIconCacheKey } = await import(
    "./lib/muni-icon-png.js"
  );
  const v =
    c.req.query("v") ||
    muniIconCacheKey(muni.settings.logoDataUrl, theme.brand, initial);
  const png = await buildMunicipalityIconPng({
    size,
    brandHex: theme.brand,
    logoDataUrl: muni.settings.logoDataUrl,
    initial,
    apple,
  });
  return c.body(new Uint8Array(png), 200, {
    "Content-Type": "image/png",
    "Cache-Control": "public, max-age=86400, immutable",
    ETag: `"${v}"`,
  });
}

app.get("/api/c/:slug/icon-192.png", municipalityMiddleware, (c) =>
  respondMuniIcon(c, 192, false),
);
app.get("/api/c/:slug/icon-512.png", municipalityMiddleware, (c) =>
  respondMuniIcon(c, 512, false),
);
app.get("/api/c/:slug/icon-180.png", municipalityMiddleware, (c) =>
  respondMuniIcon(c, 180, true),
);

app.get("/api/c/:slug/escudo.png", municipalityMiddleware, async (c) => {
  const slug = c.get("municipalitySlug");
  const muni = await getMunicipalityBySlug(slug);
  if (!muni) return c.json({ error: "not_found" }, 404);
  const theme = resolveTheme({
    accentColor: muni.accentColor,
    theme: muni.settings.theme,
  });
  const { buildEscudoPng, escudoCacheKey } = await import("./lib/escudo-png.js");
  const initial = muni.name.replace(/^Concello de\s+/i, "").charAt(0) || "P";
  const v =
    c.req.query("v") ||
    escudoCacheKey(muni.settings.logoDataUrl, theme.brand, initial);
  const png = await buildEscudoPng({
    brandHex: theme.brand,
    logoDataUrl: muni.settings.logoDataUrl,
    initial,
  });
  return c.body(new Uint8Array(png), 200, {
    "Content-Type": "image/png",
    "Cache-Control": "public, max-age=86400, immutable",
    ETag: `"${v}"`,
  });
});

/* ——— Loncha 1: foto da instalación (facilities e facilities/:id van en publicPortalRoutes) ——— */
/** REVISION-28 X10 — foto da instalación (sen base64 na lista). */
app.get(
  "/api/c/:slug/instalacions/:id/foto",
  municipalityMiddleware,
  async (c) => {
    const f = await getFacility(c.req.param("id")!);
    if (!f || f.municipalityId !== c.get("municipalityId") || !f.imageDataUrl) {
      return c.body(null, 404);
    }
    const { parseFacilityImageDataUrl } = await import(
      "./store/facility-image.js"
    );
    const parsed = parseFacilityImageDataUrl(f.imageDataUrl);
    if (!parsed) return c.body(null, 404);
    /* REVISION-46 D3: ETag + Cache-Control. */
    const { createHash } = await import("node:crypto");
    const etag = `"${createHash("sha1").update(parsed.body).digest("hex")}"`;
    const inm = c.req.header("if-none-match");
    if (inm && inm === etag) {
      return c.body(null, 304, {
        ETag: etag,
        "Cache-Control": "public, max-age=86400",
      });
    }
    return c.body(new Uint8Array(parsed.body), 200, {
      "Content-Type": parsed.mime,
      "Cache-Control": "public, max-age=86400",
      ETag: etag,
    });
  },
);

/** TANDA-1 — previsión MeteoGalicia (só outdoor; sen clave; caché 1 h). */
app.get("/api/c/:slug/meteo", municipalityMiddleware, async (c) => {
  const mid = c.get("municipalityId");
  const muni = await getMunicipalityBySlug(c.get("municipalitySlug"));
  if (!muni) return c.json({ error: "municipality_not_found" }, 404);
  const {
    resolveMunicipalityIne,
    fetchMeteoGalicia,
  } = await import("./store/meteogalicia.js");
  const ine = resolveMunicipalityIne(muni);
  const locale = c.req.query("lang") === "es" ? "es" : "gl";
  if (!ine) {
    return c.json({
      data: {
        ine: null,
        forecast: null,
        attribution: "Datos: MeteoGalicia",
      },
    });
  }
  const forecast = await fetchMeteoGalicia(ine, locale);
  return c.json({
    data: {
      ine,
      forecast,
      attribution: "Datos: MeteoGalicia",
    },
  });
});

app.get(
  "/api/c/:slug/facilities/:id/meteo",
  municipalityMiddleware,
  async (c) => {
    const mid = c.get("municipalityId");
    const f = await getFacility(c.req.param("id")!);
    if (!f || f.municipalityId !== mid) {
      return c.json({ error: "not_found" }, 404);
    }
    const {
      facilityIsOutdoor,
      resolveMunicipalityIne,
      fetchMeteoGalicia,
      periodSummaryForSlot,
      rainWarningForSlot,
    } = await import("./store/meteogalicia.js");
    const outdoor = facilityIsOutdoor(f);
    if (!outdoor) {
      return c.json({
        data: {
          outdoor: false,
          forecast: null,
          attribution: "Datos: MeteoGalicia",
        },
      });
    }
    const muni = await getMunicipalityBySlug(c.get("municipalitySlug"));
    const ine = muni ? resolveMunicipalityIne(muni) : null;
    const locale = c.req.query("lang") === "es" ? "es" : "gl";
    const forecast = ine ? await fetchMeteoGalicia(ine, locale) : null;
    const date = c.req.query("date");
    const start = c.req.query("start") ?? "16:00";
    const summary =
      date && forecast
        ? periodSummaryForSlot(forecast, date, start, locale)
        : null;
    const warning =
      date && forecast
        ? rainWarningForSlot(forecast, date, start)
        : null;
    return c.json({
      data: {
        outdoor: true,
        ine,
        forecast,
        /** REVISION-40 N3 — liña sempre + avisos en palabras. */
        line: summary?.line ?? null,
        hazards: summary?.hazards ?? [],
        summary,
        warning,
        attribution: "Datos: MeteoGalicia",
      },
    });
  },
);

/** TANDA-1 — datos do widget (horas libres hoxe/mañá). */
app.get("/api/c/:slug/widget-data", municipalityMiddleware, async (c) => {
  const mid = c.get("municipalityId");
  const muni = await getMunicipalityBySlug(c.get("municipalitySlug"));
  if (!muni || muni.settings.portalPublished === false) {
    return c.json({ data: { days: [], facilities: [] } });
  }
  const facilityId = c.req.query("facilityId") || c.req.param("facilityId");
  if (facilityId) {
    const f = await getFacility(facilityId);
    if (!f || f.municipalityId !== mid || !f.active) {
      return c.json({ error: "not_found" }, 404);
    }
  }
  const { DEFAULT_TIMEZONE, localDateIso, addDaysIso, isSlotInPast } =
    await import("./store/business-rules.js");
  const tz = muni.settings.timezone ?? DEFAULT_TIMEZONE;
  const now = new Date();
  const today = localDateIso(now, tz);
  const tomorrow = addDaysIso(today, 1);
  const { listSlots, listUnits } = await import("./store/db.js");
  const allFac = (await listFacilities(mid)).filter(
    (f) => f.active && (!facilityId || f.id === facilityId),
  );
  const unitToFac = new Map<string, string>();
  const unitNames = new Map<string, string>();
  for (const f of allFac) {
    for (const u of await listUnits(f.id)) {
      unitToFac.set(u.id, f.id);
      unitNames.set(u.id, u.name);
    }
  }
  const days = [];
  for (const date of [today, tomorrow]) {
    const slots = await listSlots({
      municipalityId: mid,
      facilityId: facilityId || undefined,
      date,
    });
    const free = slots.filter((s) => {
      if (s.closed || s.occupied) return false;
      if (date !== today) return true;
      /* REVISION-44 S1: start <= agora → non libre (igual que createBooking). */
      return !isSlotInPast(s.date, s.start, now, tz);
    });
    days.push({
      date,
      label: date === today ? "hoxe" : "mana",
      free: free.map((s) => ({
        id: s.id,
        facilityId: unitToFac.get(s.unitId) ?? "",
        unitId: s.unitId,
        unitName: unitNames.get(s.unitId) ?? "",
        start: s.start,
        end: s.end,
      })),
    });
  }
  return c.json({
    data: {
      slug: muni.slug,
      name: muni.name,
      accentColor: muni.accentColor,
      facilities: allFac.map((f) => ({
        id: f.id,
        name: f.name,
        type: f.type,
      })),
      days,
    },
  });
});

app.get("/api/c/:slug/availability", municipalityMiddleware, async (c) => {
  const muni = await getMunicipalityBySlug(c.get("municipalitySlug"));
  if (muni?.settings.portalPublished === false) {
    return c.json({ data: [] });
  }
  const facilityId = c.req.query("facilityId");
  const unitId = c.req.query("unitId");
  const type = c.req.query("type") || c.req.query("deporte");
  const mid = c.get("municipalityId");
  const tz = muni?.settings.timezone ?? "Europe/Madrid";
  const { localDateIso, isSlotInPast } = await import("./store/business-rules.js");
  const now = new Date();
  const today = localDateIso(now, tz);
  /* REVISION-56 H4: sen date → hoxe (evita cargar todas as franxas). */
  const date = c.req.query("date") || today;
  const facilities = await listFacilities(mid);
  const typed =
    type && type !== "all"
      ? facilities.filter((f) => f.type === type && f.active)
      : facilities.filter((f) => f.active);
  const typedIds = new Set(typed.map((f) => f.id));
  const unitToFacility = new Map<string, string>();
  await Promise.all(
    typed.map(async (f) => {
      for (const u of await listUnits(f.id)) {
        unitToFacility.set(u.id, f.id);
      }
    }),
  );
  const slots = await listSlots({
    municipalityId: mid,
    facilityId: facilityId || undefined,
    unitId: unitId || undefined,
    date,
  });
  const viewerId = c.get("user")?.id;
  const publicSlots = slots
    .map((s) => {
      const facId = unitToFacility.get(s.unitId);
      if (!facId) return null;
      if (facilityId && facId !== facilityId) return null;
      if (type && type !== "all" && !typedIds.has(facId)) return null;
      /* REVISION-44 S1: start <= agora → pechada (tachada, non clicábel). */
      const past =
        s.date < today ||
        (s.date === today && isSlotInPast(s.date, s.start, now, tz));
      const closed = s.closed || past;
      const mine = !!(viewerId && s.bookingUserId && s.bookingUserId === viewerId);
      return {
        id: s.id,
        unitId: s.unitId,
        facilityId: facId,
        date: s.date,
        start: s.start,
        end: s.end,
        closed,
        status: closed
          ? ("closed" as const)
          : mine
            ? ("mine" as const)
            : s.occupied
              ? ("occupied" as const)
              : ("free" as const),
        mine,
        bookingId: mine ? s.bookingId : undefined,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);
  const freeToday = publicSlots.filter((s) => s.status === "free" && s.date === (date || today)).length;
  return c.json({ data: publicSlots, meta: { freeToday, date: date || today } });
});

app.get("/api/c/:slug/horas-tranquilas", municipalityMiddleware, async (c) => {
  const facilityId = c.req.query("facilityId") || undefined;
  const date = c.req.query("date") || undefined;
  const { horasTranquilas } = await import("./store/horas-tranquilas.js");
  const data = await horasTranquilas(c.get("municipalityId"), facilityId, date);
  return c.json({ data });
});

app.get(
  "/api/c/:slug/me/calendario.ics",
  municipalityMiddleware,
  async (c) => {
    const token = c.req.query("token");
    if (!token) return c.text("token required", 400);
    const { findUserByCalendarToken, personalCalendarIcs } = await import(
      "./store/calendar-feed.js"
    );
    const user = await findUserByCalendarToken(c.get("municipalityId"), token);
    if (!user || !user.active) return c.text("not found", 404);
    const body = await personalCalendarIcs(c.get("municipalityId"), user.id);
    return c.text(body, 200, {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="mis-reservas.ics"',
      "Cache-Control": "private, max-age=300",
    });
  },
);

app.get(
  "/api/c/:slug/me/calendario-feed",
  municipalityMiddleware,
  requireSameMunicipality(),
  async (c) => {
    const user = c.get("user")!;
    const { getOrCreateCalendarFeedToken, rotateCalendarFeedToken } = await import(
      "./store/calendar-feed.js"
    );
    const rotate = c.req.query("rotate") === "1";
    const token = rotate
      ? await rotateCalendarFeedToken(user.id)
      : await getOrCreateCalendarFeedToken(user.id);
    const slug = c.get("municipalitySlug");
    const reqUrl = new URL(c.req.url);
    const apiBase = (
      process.env.API_PUBLIC_URL ??
      `${reqUrl.protocol}//${reqUrl.host}`
    ).replace(/\/$/, "");
    const path = `/api/c/${slug}/me/calendario.ics?token=${encodeURIComponent(token)}`;
    const httpsUrl = `${apiBase}${path}`;
    const webcalUrl = httpsUrl.replace(/^https:/, "webcal:").replace(/^http:/, "webcal:");
    return c.json({ data: { token, httpsUrl, webcalUrl } });
  },
);

app.get(
  "/api/c/:slug/reservas",
  municipalityMiddleware,
  requireSameMunicipality(),
  async (c) => {
    const user = c.get("user")!;
    const bookings = await listBookings({
      municipalityId: c.get("municipalityId"),
      userId: user.id,
    });
    const data = await Promise.all(
      bookings.map(async (b) => {
        const facility = await getFacility(b.facilityId);
        return {
          ...b,
          facilityName: facility?.name,
          checkInRequired: !!facility?.checkInRequired,
        };
      }),
    );
    return c.json({ data });
  },
);

/** REVISION-35 G7 / REVISION-37 I1 — .ics con token; path `/…/:id/calendario.ics` (Hono non mestura `.ics` no param). */
app.get(
  "/api/c/:slug/reservas/:id/calendario.ics",
  municipalityMiddleware,
  async (c) => {
    const token = c.req.query("t") || c.req.query("token");
    if (!token) return c.text("token required", 400);
    const { verifyBookingIcsToken } = await import("./lib/booking-ics-token.js");
    const bookingId = verifyBookingIcsToken(token);
    if (!bookingId || bookingId !== c.req.param("id")) {
      return c.text("invalid token", 403);
    }
    const b = await getBooking(bookingId);
    if (!b || b.municipalityId !== c.get("municipalityId")) {
      return c.text("not found", 404);
    }
    const fac = await getFacility(b.facilityId);
    const { buildBookingIcs, buildBookingCancelIcs } = await import(
      "./lib/booking-ics.js"
    );
    const cancelled = b.status === "cancelled";
    const body = cancelled
      ? buildBookingCancelIcs({
          id: b.id,
          facilityName: fac?.name ?? "Reserva",
          date: b.date,
          start: b.start,
          end: b.end,
          sequence: (b.icsSequence ?? 0) + 1,
        })
      : buildBookingIcs({
          id: b.id,
          facilityName: fac?.name ?? "Reserva",
          date: b.date,
          start: b.start,
          end: b.end,
          shortCode: b.shortCode,
          sequence: b.icsSequence ?? 0,
        });
    return c.text(body, 200, {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="reserva-${b.id}.ics"`,
      "Cache-Control": "private, max-age=300",
    });
  },
);

/* POST /api/c/:slug/reservas vai en publicPortalRoutes (REVISION-60 N4). */
app.get(
  "/api/c/:slug/reservas/:id",
  municipalityMiddleware,
  requireSameMunicipality(),
  async (c) => {
    const user = c.get("user")!;
    const b = await getBooking(c.req.param("id")!);
    if (!b || b.municipalityId !== c.get("municipalityId")) {
      return c.json({ error: "not_found" }, 404);
    }
    /* REVISION-50 S3: só a persoa da reserva ou admin/staff/monitor/superadmin. */
    const elevated = new Set(["admin", "staff", "monitor", "superadmin"]);
    if (b.userId !== user.id && !elevated.has(c.get("effectiveRole"))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const facility = await getFacility(b.facilityId);
    const { findOpenMatchIdByBooking } = await import("./store/open-matches.js");
    const openMatchId = await findOpenMatchIdByBooking(b.id);
    return c.json({
      data: {
        ...b,
        facilityName: facility?.name,
        facilityAddress: facility?.address,
        facilityLat: facility?.lat,
        facilityLng: facility?.lng,
        openMatchId,
      },
    });
  },
);

app.post(
  "/api/c/:slug/reservas/:id/cancel",
  municipalityMiddleware,
  requireSameMunicipality(),
  async (c) => {
    const user = c.get("user")!;
    try {
      const existing = await getBooking(c.req.param("id")!);
      if (!existing || existing.municipalityId !== c.get("municipalityId")) {
        return c.json({ error: "not_found" }, 404);
      }
      const { listWaitlist } = await import("./store/extra.js");
      const waiting = (await listWaitlist(existing.municipalityId)).filter(
        (w) => w.slotId === existing.slotId && w.status === "waiting",
      );
      const b = await cancelBooking(c.req.param("id")!, user.id);
      /* REVISION-34 E7: «cancelaches ti» + .ics METHOD:CANCEL (mesmo UID). */
      {
        const { sendUserNotice } = await import("./notify/send-notice.js");
        const { formatDayChip } = await import("@pista-aberta/shared");
        const fac = await getFacility(existing.facilityId);
        await sendUserNotice({
          id: newId(`n-cancel-self-${b.id}`),
          municipalityId: c.get("municipalityId"),
          userId: existing.userId ?? user.id,
          noticeType: "change",
          notifyType: "cancelacion",
          title: "Reserva cancelada",
          body: `${fac?.name ?? "Instalación"} · ${formatDayChip(existing.date, "gl")} ${existing.start}`,
          email: {
            kind: "booking_cancelled",
            data: {
              facilityName: fac?.name ?? "Instalación",
              dayLabel: formatDayChip(existing.date, "gl"),
              timeLabel: `${existing.start}–${existing.end}`,
              date: existing.date,
              start: existing.start,
              end: existing.end,
              bookingId: existing.id,
              icsSequence: existing.icsSequence ?? 0,
              byStaff: false,
            },
          },
        });
      }
      return c.json({ data: b, offeredTo: waiting.length });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      /* REVISION-55 G11: cancelar allea → 403. */
      if (msg === "forbidden") return c.json({ error: msg }, 403);
      return c.json({ error: msg }, 400);
    }
  },
);

/* PATCH /api/c/:slug/reservas/:id vai en publicPortalRoutes (REVISION-60 N6). */

app.post(
  "/api/c/:slug/checkin",
  municipalityMiddleware,
  requireMuniRoles("staff", "admin", "monitor"),
  async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = checkinBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", details: parsed.error.flatten() }, 400);
    }
    if (parsed.data.shortCode && !parsed.data.qrPayload) {
      const { checkInByShortCode } = await import("./store/admin-ops.js");
      const result = await checkInByShortCode(
        parsed.data.shortCode,
        c.get("municipalityId"),
      );
      return c.json({ data: result });
    }
    const result = await checkInByQr(
      parsed.data.qrPayload!,
      c.get("municipalityId"),
    );
    return c.json({ data: result });
  },
);

/* ——— Loncha 2: pavillón / clubs (GET /api/c/:slug/pavillon vai en publicPortalRoutes) ——— */
app.post(
  "/api/c/:slug/pavillon/swap",
  municipalityMiddleware,
  requireMuniRoles("club_manager", "admin"),
  async (c) => {
    const body = await c.req.json<{ fromMatchId: string; toMatchId: string }>();
    try {
      const user = c.get("user")!;
      const swap = await proposeSwap({
        municipalityId: c.get("municipalityId"),
        fromMatchId: body.fromMatchId,
        toMatchId: body.toMatchId,
        actorClubId: user.clubId,
        actorRole: c.get("effectiveRole"),
      });
      return c.json({ data: swap }, 201);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      const status =
        msg === "match_not_found" ? 404 : msg === "forbidden" ? 403 : 400;
      return c.json({ error: msg }, status);
    }
  },
);

app.post(
  "/api/c/:slug/pavillon/resolve",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const body = await c.req.json<{
      matchId: string;
      action: "move_media" | "accept_swap" | "clear";
      swapId?: string;
    }>();
    try {
      const match = await resolveConflict({
        municipalityId: c.get("municipalityId"),
        matchId: body.matchId,
        action: body.action,
        swapId: body.swapId,
        actor: c.get("user")!.displayName,
      });
      return c.json({
        data: match,
        pavilion: await pavilionWeekend(c.get("municipalityId")),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      if (msg === "conflict") {
        const conflicts =
          e instanceof Error && "conflicts" in e
            ? (e as Error & { conflicts?: unknown }).conflicts
            : undefined;
        return c.json({ error: msg, conflicts }, 409);
      }
      return c.json({ error: msg }, 400);
    }
  },
);

/* ——— Loncha 3: actividades + sorteo ——— */
app.get("/api/c/:slug/actividades", municipalityMiddleware, async (c) => {
  const acts = await listActivities(c.get("municipalityId"));
  const facIds = [...new Set(acts.map((a) => a.facilityId))];
  const facNames = new Map<string, string>();
  for (const fid of facIds) {
    const f = await getFacility(fid);
    if (f) facNames.set(fid, f.name);
  }
  return c.json({
    data: acts.map((a) => ({
      ...a,
      facilityName: facNames.get(a.facilityId) ?? null,
      lotterySecret: a.lotteryStatus === "drawn" ? a.lotterySecret : null,
    })),
  });
});

app.get("/api/c/:slug/actividades/:id", municipalityMiddleware, async (c) => {
  const act = await getActivity(c.req.param("id")!);
  if (!act || act.municipalityId !== c.get("municipalityId")) {
    return c.json({ error: "not_found" }, 404);
  }
  const applications = await listApplicationsPublic(act.id);
  const user = c.get("user");
  let mine: {
    applicationNumber: string;
    status: string;
    priorityGroup: string;
    forMemberId?: string | null;
    forMemberName?: string | null;
  } | null = null;
  let mines: Array<{
    applicationNumber: string;
    status: string;
    priorityGroup: string;
    forMemberId: string | null;
    forMemberName: string | null;
  }> = [];
  if (user) {
    const { getDb } = await import("./db/client.js");
    const schema = await import("./db/schema.js");
    const { and, eq } = await import("drizzle-orm");
    const rows = await getDb()
      .select()
      .from(schema.activityApplications)
      .where(
        and(
          eq(schema.activityApplications.activityId, act.id),
          eq(schema.activityApplications.userId, user.id),
        ),
      );
    mines = rows.map((r) => ({
      applicationNumber: r.applicationNumber,
      status: r.status,
      priorityGroup: r.priorityGroup,
      forMemberId: r.forMemberId ?? null,
      forMemberName: r.forMemberName ?? null,
    }));
    if (rows[0]) {
      mine = mines[0]!;
    }
  }
  const facility = await getFacility(act.facilityId);
  return c.json({
    data: {
      ...act,
      facilityName: facility?.name ?? null,
      lotterySecret: act.lotteryStatus === "drawn" ? act.lotterySecret : null,
      applications,
      mine,
      mines,
    },
  });
});

app.post(
  "/api/c/:slug/actividades/:id/inscribir",
  municipalityMiddleware,
  requireSameMunicipality(),
  async (c) => {
    const user = c.get("user")!;
    const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    // priorityGroup nunca do cliente (só concello/seed/admin).
    if (clientSentPriorityGroup(body)) {
      return c.json({ error: "priority_group_forbidden" }, 400);
    }
    try {
      const forMemberId =
        typeof body.for_member_id === "string"
          ? body.for_member_id
          : typeof body.forMemberId === "string"
            ? body.forMemberId
            : null;
      const application = await applyToActivity({
        activityId: c.req.param("id")!,
        municipalityId: c.get("municipalityId"),
        userId: user.id,
        forMemberId,
      });
      return c.json(
        {
          data: {
            applicationNumber: application.applicationNumber,
            id: application.id,
            forMemberId: application.forMemberId ?? null,
            forMemberName: application.forMemberName ?? null,
          },
        },
        201,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      const status =
        msg === "already_applied" || msg === "deadline_passed"
          ? 409
          : msg === "family_member_forbidden"
            ? 403
            : 400;
      return c.json({ error: msg }, status);
    }
  },
);

app.post(
  "/api/c/:slug/actividades/:id/sortear",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    try {
      const result = await runLottery(
        c.req.param("id")!,
        c.get("municipalityId"),
      );
      return c.json({
        data: {
          seedHash: result.activity.lotterySeedHash,
          secret: result.activity.lotterySecret,
          accepted: result.accepted,
          waitlist: result.waitlist,
          order: result.activity.lotteryResultOrder,
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      const status = msg === "wrong_municipality" ? 403 : 400;
      return c.json({ error: msg }, status);
    }
  },
);

app.post("/api/c/:slug/actividades/:id/verificar", municipalityMiddleware, async (c) => {
  const body = await c.req.json<{ secret: string }>();
  try {
    /* REVISION-39 L15: a actividade debe ser deste concello. */
    const result = await verifyLottery(
      c.req.param("id")!,
      body.secret,
      c.get("municipalityId"),
    );
    return c.json({ data: result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    if (msg === "wrong_municipality" || msg === "not_found") {
      return c.json({ error: msg }, msg === "not_found" ? 404 : 403);
    }
    return c.json({ error: msg }, 400);
  }
});

/* ——— Auth (ambos camiños) ——— */
registerAuthLoginRoute(app, identity);

/** Metadatos do SP (node-saml). */
app.get("/auth/saml/metadata", (c) => {
  return c.text(getSpMetadataXml(), 200, {
    "Content-Type": "application/samlmetadata+xml; charset=utf-8",
  });
});

app.get("/auth/saml/info", (c) => c.json(describeSamlEndpoints()));

registerMockIdpRoutes(app);

/**
 * ACS do SP: valida firma / audience / destination con @node-saml/node-saml,
 * crea sesión na DB e redirixe ao panel do rol (RelayState só se está permitido).
 */
app.post("/auth/saml/acs", async (c) => {
  if (!samlRoutesExposed()) return c.text("Not Found", 404);
  try {
    const body = await c.req.parseBody();
    const { user, relayState, warning, activateClubId, activateMuniRole } =
      await validateAcsPost({
        SAMLResponse: String(body.SAMLResponse ?? ""),
        RelayState: String(body.RelayState ?? "/"),
      });
    const sessionId = await createSession(user, { authMethod: "saml" });
    if (activateClubId) {
      await setSessionActiveClub(sessionId, activateClubId);
    } else if (activateMuniRole) {
      await setSessionActiveMuniRole(
        sessionId,
        activateMuniRole.role,
        activateMuniRole.municipalityId,
      );
    }
    setSessionCookie(c, sessionId);
    const userSlug = await resolveUserSlug(user);
    const normalizedRelay =
      relayState === "/" ||
      (user.role === "club_manager" &&
        user.clubId &&
        relayState === `/c/${userSlug}/clubs`)
        ? undefined
        : relayState;
    const dest = resolvePostLoginPath(
      user.role,
      userSlug,
      normalizedRelay,
      user.clubId,
    );
    let redirectUrl = withLoginParam(appBase, dest, "saml");
    if (warning === "club_non_creado") {
      const parsedUrl = new URL(redirectUrl);
      parsedUrl.searchParams.set("aviso", "club_non_creado");
      redirectUrl = parsedUrl.toString();
    }
    return c.redirect(redirectUrl);
  } catch (e) {
    if (e instanceof DemoMunicipalityNotCreatedError) {
      return c.redirect(`${appBase}/acceso?erro=concello_non_creado`);
    }
    const msg = e instanceof Error ? e.message : "saml_error";
    console.error("[saml/acs]", msg);
    /* REVISION-56 H11: sen concello → redirixir ao acceso, non HTML cru. */
    if (msg === "municipality_required") {
      return c.redirect(`${appBase}/acceso?erro=concello`);
    }
    if (msg === "concello_non_creado") {
      return c.redirect(`${appBase}/acceso?erro=concello_non_creado`);
    }
    const safe = msg
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
    return c.html(
      `<!doctype html><html lang="gl"><body><h1>Erro SAML</h1><p>${safe}</p><p><a href="/acceso">Volver ao acceso</a></p></body></html>`,
      400,
    );
  }
});

app.post("/auth/otp/verify", async (c) => {
  try {
    const body = await c.req.json<{
      challengeId: string;
      code: string;
      returnTo?: string;
    }>();
    const authUser = await identity.callback({
      method: "email_otp",
      payload: { challengeId: body.challengeId, code: body.code },
    });
    const sessionId = await createSession(authUser, { authMethod: "email_otp" });
    setSessionCookie(c, sessionId);
    const userSlug = await resolveUserSlug(authUser);
    const redirectTo = resolvePostLoginPath(
      authUser.role,
      userSlug,
      body.returnTo,
      authUser.clubId,
    );
    const user = { ...authUser, municipalitySlug: userSlug };
    return c.json({ user, redirectTo });
  } catch (e) {
    if (e instanceof StrongAuthRequiredError) {
      return c.json({ error: e.code }, 403);
    }
    const msg = e instanceof Error ? e.message : "error";
    return c.json({ error: msg }, 400);
  }
});

app.get("/auth/me", async (c) => {
  const sessionId = getCookie(c, "pa_sesion");
  if (!sessionId) return c.json({ user: null, sessionExpiresAt: null });
  const { getSessionMeta } = await import("./identity/sessions.js");
  const meta = await getSessionMeta(sessionId);
  if (!meta) return c.json({ user: null, sessionExpiresAt: null });
  return c.json({
    user: meta.user,
    sessionExpiresAt: meta.expiresAt.toISOString(),
  });
});

app.post("/auth/renovar", async (c) => {
  const sessionId = getCookie(c, "pa_sesion");
  if (!sessionId) return c.json({ error: "unauthorized" }, 401);
  const { renewSession } = await import("./identity/sessions.js");
  const meta = await renewSession(sessionId);
  if (!meta) return c.json({ error: "unauthorized" }, 401);
  return c.json({
    user: meta.user,
    sessionExpiresAt: meta.expiresAt.toISOString(),
  });
});

/** REVISION-22 B3 — conmutador «Entrar como: Club / A miña conta». */
app.post("/api/me/club-activo", async (c) => {
  const sessionId = getCookie(c, "pa_sesion");
  if (!sessionId) return c.json({ error: "unauthorized" }, 401);
  const body = await c.req.json<{ clubId?: string | null }>();
  const clubId =
    body.clubId === undefined || body.clubId === null || body.clubId === ""
      ? null
      : String(body.clubId);
  try {
    const { setSessionActiveClub } = await import("./identity/sessions.js");
    const user = await setSessionActiveClub(sessionId, clubId);
    if (!user) return c.json({ error: "unauthorized" }, 401);
    return c.json({ user });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return c.json({ error: msg }, msg === "forbidden" ? 403 : 400);
  }
});

/** REVISION-28 X3 / REVISION-55 G10 — «Entrar como» con municipalityId opcional. */
app.post("/api/me/rol-activo", async (c) => {
  const sessionId = getCookie(c, "pa_sesion");
  if (!sessionId) return c.json({ error: "unauthorized" }, 401);
  const body = await c.req.json<{
    role?: Role | null | string;
    municipalityId?: string | null;
  }>();
  const raw = body.role;
  const role: Role | null =
    raw === undefined || raw === null || raw === "" ? null : (raw as Role);
  try {
    const { setSessionActiveMuniRole } = await import("./identity/sessions.js");
    const user = await setSessionActiveMuniRole(
      sessionId,
      role,
      body.municipalityId ?? null,
    );
    if (!user) return c.json({ error: "unauthorized" }, 401);
    return c.json({ user });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return c.json({ error: msg }, msg === "forbidden" ? 403 : 400);
  }
});

app.get("/api/convite/:token", async (c) => {
  const { getInvitationByToken } = await import("./store/invitations.js");
  const data = await getInvitationByToken(c.req.param("token")!);
  if (!data) return c.json({ error: "invite_not_found" }, 404);
  return c.json({ data });
});

app.post("/api/convite/:token/aceptar", async (c) => {
  const sessionId = getCookie(c, "pa_sesion");
  if (!sessionId) return c.json({ error: "unauthorized" }, 401);
  const { getSessionMeta } = await import("./identity/sessions.js");
  const meta = await getSessionMeta(sessionId);
  if (!meta) return c.json({ error: "unauthorized" }, 401);
  try {
    const { acceptInvitation, getInvitationByToken } = await import(
      "./store/invitations.js"
    );
    const token = c.req.param("token")!;
    const inv = await getInvitationByToken(token);
    if (!inv) return c.json({ error: "invite_not_found" }, 404);
    const user = await acceptInvitation({
      token,
      user: meta.user,
    });
    /* REVISION-32 C1: activar o papel do convite e ir ao panel dese concello. */
    const { setSessionActiveMuniRole } = await import("./identity/sessions.js");
    const activated = await setSessionActiveMuniRole(
      sessionId,
      inv.role,
      inv.municipalityId,
    );
    return c.json({ user: activated ?? user });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    const status =
      msg === "invite_wrong_person" ||
      msg === "invite_used" ||
      msg === "invite_expired" ||
      msg === "invite_not_found" ||
      msg === "nif_required"
        ? 400
        : 409;
    return c.json({ error: msg }, status);
  }
});

/** REVISION-29 Y2 — demo: identidade de proba + aceptar convite nun paso. */
app.post("/api/convite/:token/demo-aceptar", async (c) => {
  try {
    /* REVISION-33 D12: PA_DEMO primeiro → sempre 403 fóra da demo (sen filtrar polo token). */
    const paDemo =
      process.env.PA_DEMO === "1" || process.env.PA_DEMO === "true";
    if (!paDemo) return c.json({ error: "demo_only" }, 403);

    const { demoAcceptInvitation, getInvitationByToken } = await import(
      "./store/invitations.js"
    );
    const token = c.req.param("token")!;
    const inv = await getInvitationByToken(token);
    if (!inv) return c.json({ error: "invite_not_found" }, 404);
    const user = await demoAcceptInvitation(token);
    const sessionId = await createSession(user);
    setSessionCookie(c, sessionId);
    /* REVISION-32 C1: activar o papel do convite (p.ex. admin noutro concello). */
    const { setSessionActiveMuniRole } = await import("./identity/sessions.js");
    const activated = await setSessionActiveMuniRole(
      sessionId,
      inv.role,
      inv.municipalityId,
    );
    return c.json({ user: activated ?? user });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    if (msg === "demo_only") return c.json({ error: msg }, 403);
    const status =
      msg === "invite_wrong_person" ||
      msg === "invite_used" ||
      msg === "invite_expired" ||
      msg === "invite_not_found" ||
      msg === "nif_required"
        ? 400
        : 409;
    return c.json({ error: msg }, status);
  }
});

app.post("/auth/logout", async (c) => {
  const sessionId = getCookie(c, "pa_sesion");
  if (sessionId) await identity.logout(sessionId);
  deleteCookie(c, "pa_sesion", { path: "/" });
  return c.json({ ok: true });
});

await bootstrap();
console.log(`Pista Aberta API escoitando en :${port} [db=${getDbMode()}]`);
serve({ fetch: app.fetch, port, hostname: process.env.API_HOST ?? "0.0.0.0" });
