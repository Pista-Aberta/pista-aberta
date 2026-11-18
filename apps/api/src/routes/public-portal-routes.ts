import { createHash } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { formatDayChip, formatDayTimeChip, type Municipality } from "@pista-aberta/shared";
import { getDb } from "../db/client.js";
import * as t from "../db/schema.js";
import { isMockIdpEnabled } from "../env.js";
import { findDemoFileUser, hasDemoUsersFile } from "../identity/demo-users-file.js";
import { idpAutoPostHtml } from "../identity/saml-idp.js";
import { IDP_HTML_CSP } from "../identity/saml-idp-csp.js";
import { renderMockIdpSelectHtml } from "../identity/saml-idp-select-html.js";
import { newId } from "../lib/ids.js";
import {
  effectiveRoleInMunicipality,
  requireSameMunicipality,
} from "../middleware/auth.js";
import { unitNameForBooking } from "../notify/emails/booking-content.js";
import { sendUserNotice } from "../notify/send-notice.js";
import { getNormas, upcomingClosuresForFacility } from "../store/admin-ops.js";
import { OverlappingBookingError } from "../store/booking-overlap.js";
import {
  createBooking,
  getBooking,
  getFacility,
  getMunicipalityById,
  getMunicipalityBySlug,
  listFacilities,
  listMunicipalities,
  listUnits,
  modifyBooking,
  pavilionWeekend,
} from "../store/db.js";
import { audit } from "../store/extra.js";
import { isPortalPublished } from "../store/municipality-launch.js";
import { createBookingWithOpenMatch } from "../store/open-matches.js";
import { sanitizeSvg } from "../store/sanitize-svg.js";
import { publishedSeasonsForFacility } from "../store/seasons.js";
import { municipalityMiddleware } from "../tenancy.js";

const PUBLIC_PAVILION_MATCH_STATUSES = new Set([
  "scheduled",
  "resolved",
  "swapped",
  "moved",
]);

const PORTAL_PANEL_ROLES = new Set([
  "admin",
  "staff",
  "monitor",
  "club_manager",
  "superadmin",
]);

const ALLOWED_LOGO_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);

export function logoVersionHash(logoDataUrl?: string | null): string | null {
  if (!logoDataUrl) return null;
  return createHash("sha1").update(logoDataUrl).digest("hex").slice(0, 12);
}

/** REVISION-60 N9 — só campos públicos de settings e logoUrl sen base64 inline. */
export function toPublicMunicipalityInfo(muni: Municipality) {
  const s = muni.settings;
  const published = isPortalPublished(muni);
  const v = logoVersionHash(s.logoDataUrl);
  const logoUrl = v ? `/api/c/${muni.slug}/logo?v=${v}` : null;

  return {
    id: muni.id,
    slug: muni.slug,
    name: muni.name,
    accentColor: muni.accentColor,
    locales: muni.locales,
    portalPublished: published,
    settings: {
      maxHoursPerWeek: s.maxHoursPerWeek,
      bookingAntelationDays: s.bookingAntelationDays,
      ...(s.maxActiveBookings !== undefined
        ? { maxActiveBookings: s.maxActiveBookings }
        : {}),
      ...(s.anonymizeAfterDays !== undefined
        ? { anonymizeAfterDays: s.anonymizeAfterDays }
        : {}),
      ...(s.cancelMinHours !== undefined
        ? { cancelMinHours: s.cancelMinHours }
        : {}),
      ...(s.checkInMarginMinutes !== undefined
        ? { checkInMarginMinutes: s.checkInMarginMinutes }
        : {}),
      ...(s.noShowReleaseMinutes !== undefined
        ? { noShowReleaseMinutes: s.noShowReleaseMinutes }
        : {}),
      ...(s.noShowPenaltyCount !== undefined
        ? { noShowPenaltyCount: s.noShowPenaltyCount }
        : {}),
      ...(s.noShowPenaltyDays !== undefined
        ? { noShowPenaltyDays: s.noShowPenaltyDays }
        : {}),
      ...(s.noShowPenaltyWindowDays !== undefined
        ? { noShowPenaltyWindowDays: s.noShowPenaltyWindowDays }
        : {}),
      ...(s.rulesText !== undefined ? { rulesText: s.rulesText } : {}),
      ...(s.rulesVersion !== undefined ? { rulesVersion: s.rulesVersion } : {}),
      ...(s.timezone !== undefined ? { timezone: s.timezone } : {}),
      ...(s.theme !== undefined ? { theme: s.theme } : {}),
      ...(s.welcomeGl !== undefined ? { welcomeGl: s.welcomeGl } : {}),
      ...(s.welcomeEs !== undefined ? { welcomeEs: s.welcomeEs } : {}),
      ...(s.legal !== undefined ? { legal: s.legal } : {}),
      ...(s.contact !== undefined ? { contact: s.contact } : {}),
      ...(s.openData !== undefined ? { openData: s.openData } : {}),
      portalPublished: published,
      sandbox: Boolean(s.sandbox),
      logoUrl,
    },
  };
}

export function parseSafeLogoDataUrl(
  raw: string,
): { mime: string; body: Buffer } | null {
  const trimmed = raw.trim();
  const comma = trimmed.indexOf(",");
  if (!trimmed.startsWith("data:") || comma < 0) return null;
  const header = trimmed.slice(5, comma);
  const payload = trimmed.slice(comma + 1);
  const parts = header.split(";").map((p) => p.trim());
  const mime = (parts[0] ?? "").toLowerCase();
  if (!ALLOWED_LOGO_MIMES.has(mime)) return null;
  const isBase64 = parts.includes("base64");

  if (mime === "image/svg+xml") {
    try {
      const text = isBase64
        ? Buffer.from(payload, "base64").toString("utf8")
        : decodeURIComponent(payload);
      const clean = sanitizeSvg(text);
      return { mime: "image/svg+xml; charset=utf-8", body: Buffer.from(clean, "utf8") };
    } catch {
      return null;
    }
  }

  if (!isBase64) return null;
  const body = Buffer.from(payload, "base64");
  if (body.length === 0 || body.length > 600_000) return null;
  return { mime, body };
}

export const publicPortalRoutes = new Hono();

publicPortalRoutes.get("/api/municipalities", async (c) => {
  const all = await listMunicipalities();
  return c.json({ data: all.map(toPublicMunicipalityInfo) });
});

publicPortalRoutes.get("/api/c/:slug/info", municipalityMiddleware, async (c) => {
  const muni = await getMunicipalityBySlug(c.get("municipalitySlug"));
  if (!muni) return c.json({ error: "not_found" }, 404);
  return c.json({ data: toPublicMunicipalityInfo(muni) });
});

publicPortalRoutes.get("/api/c/:slug/logo", municipalityMiddleware, async (c) => {
  const muni = await getMunicipalityBySlug(c.get("municipalitySlug"));
  if (!muni?.settings.logoDataUrl) return c.body(null, 404);
  const parsed = parseSafeLogoDataUrl(muni.settings.logoDataUrl);
  if (!parsed) return c.body(null, 404);
  const etag = `"${createHash("sha1").update(parsed.body).digest("hex")}"`;
  const inm = c.req.header("if-none-match");
  const versioned = Boolean(c.req.query("v")?.trim());
  const baseHeaders: Record<string, string> = {
    ETag: etag,
    "Cache-Control": versioned
      ? "public, max-age=31536000, immutable"
      : "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  };
  if (parsed.mime.startsWith("image/svg+xml")) {
    baseHeaders["Content-Security-Policy"] =
      "default-src 'none'; style-src 'unsafe-inline'; sandbox";
  }
  if (inm && inm === etag) {
    return c.body(null, 304, baseHeaders);
  }
  return c.body(new Uint8Array(parsed.body), 200, {
    ...baseHeaders,
    "Content-Type": parsed.mime,
  });
});

publicPortalRoutes.get(
  "/api/c/:slug/facilities",
  municipalityMiddleware,
  async (c) => {
    const mid = c.get("municipalityId");
    const slug = c.get("municipalitySlug");
    const muni = await getMunicipalityById(mid);
    if (muni && !isPortalPublished(muni)) {
      const user = c.get("user");
      const eff = user ? effectiveRoleInMunicipality(user, mid) : null;
      if (!eff || !PORTAL_PANEL_ROLES.has(eff)) {
        return c.json({ data: [] });
      }
    }
    const facilities = await Promise.all(
      (await listFacilities(mid)).map(async (f) => {
        const { imageDataUrl, ...rest } = f;
        const upcomingClosures = await upcomingClosuresForFacility(mid, f.id);
        return {
          ...rest,
          imageDataUrl: undefined,
          imageUrl: imageDataUrl
            ? `/api/c/${slug}/instalacions/${f.id}/foto`
            : null,
          units: await listUnits(f.id),
          upcomingClosures,
        };
      }),
    );
    return c.json({ data: facilities });
  },
);

publicPortalRoutes.get(
  "/api/c/:slug/facilities/:id",
  municipalityMiddleware,
  async (c) => {
    const id = c.req.param("id")!;
    const mid = c.get("municipalityId");
    const slug = c.get("municipalitySlug");
    const muni = await getMunicipalityById(mid);
    if (muni && !isPortalPublished(muni)) {
      const user = c.get("user");
      const eff = user ? effectiveRoleInMunicipality(user, mid) : null;
      if (!eff || !PORTAL_PANEL_ROLES.has(eff)) {
        return c.json({ error: "not_found" }, 404);
      }
    }
    const f = await getFacility(id);
    if (!f || f.municipalityId !== mid || !f.active) {
      return c.json({ error: "not_found" }, 404);
    }
    const normas = await getNormas(mid, id);
    const publishedSeasons = await publishedSeasonsForFacility(mid, id);
    const upcomingClosures = await upcomingClosuresForFacility(mid, id);
    const { imageDataUrl, imageAlt, ...rest } = f;
    return c.json({
      data: {
        ...rest,
        imageDataUrl: undefined,
        imageAlt: imageAlt ?? null,
        imageUrl: imageDataUrl
          ? `/api/c/${slug}/instalacions/${f.id}/foto`
          : null,
        units: (await listUnits(f.id)).filter((u) => u.active !== false),
        rulesApplied: normas.rules,
        rulesText: normas.rulesText,
        publishedSeasons,
        upcomingClosures,
        rulesVersion: normas.rulesVersion,
      },
    });
  },
);

/* REVISION-60 N3 — non expor email, cif nin note de propostas sen sesión club/admin no concello. */
publicPortalRoutes.get(
  "/api/c/:slug/pavillon",
  municipalityMiddleware,
  async (c) => {
    const mid = c.get("municipalityId");
    const raw = c.req.query("weekOffset");
    const weekOffset = raw != null && raw !== "" ? Number(raw) : 0;
    const offset = Number.isFinite(weekOffset) ? Math.trunc(weekOffset) : 0;
    const data = await pavilionWeekend(mid, offset);

    const user = c.get("user");
    const effRole = user ? effectiveRoleInMunicipality(user, mid) : null;
    const isClubOrAdmin =
      effRole === "admin" ||
      effRole === "club_manager" ||
      effRole === "superadmin";

    if (!isClubOrAdmin) {
      return c.json({
        data: {
          ...data,
          conflicts: 0,
          swaps: [],
          neighborBookings: [],
          clubs: data.clubs.map(({ email: _e, cif: _c, ...pub }) => pub),
          matches: data.matches
            .filter(
              (m) =>
                PUBLIC_PAVILION_MATCH_STATUSES.has(m.status) &&
                !m.id.startsWith("proposed-"),
            )
            .map(({ notes: _n, ...pub }) => ({
              ...pub,
              conflictWith: [],
              status: "scheduled" as const,
            })),
        },
      });
    }

    if (effRole === "club_manager") {
      const ownClubId = user?.clubId ?? null;
      return c.json({
        data: {
          ...data,
          clubs: data.clubs.map((cl) =>
            cl.id === ownClubId
              ? cl
              : {
                  id: cl.id,
                  municipalityId: cl.municipalityId,
                  name: cl.name,
                  shortName: cl.shortName,
                  ...(cl.sport ? { sport: cl.sport } : {}),
                },
          ),
        },
      });
    }

    return c.json({ data });
  },
);

async function targetHasConfiguredRules(
  municipalityId: string,
  slotId: string,
): Promise<boolean> {
  const db = getDb();
  const slot = (
    await db
      .select({ unitId: t.timeSlots.unitId })
      .from(t.timeSlots)
      .where(eq(t.timeSlots.id, slotId))
      .limit(1)
  )[0];
  if (!slot) return false;
  const unit = (
    await db
      .select({ facilityId: t.units.facilityId })
      .from(t.units)
      .where(eq(t.units.id, slot.unitId))
      .limit(1)
  )[0];
  if (!unit) return false;
  const [fac, muni] = await Promise.all([
    getFacility(unit.facilityId),
    getMunicipalityById(municipalityId),
  ]);
  if (!fac || fac.municipalityId !== municipalityId) return false;
  if (fac.rules?.trim()) return true;
  if (Array.isArray(fac.rulesText) && fac.rulesText.length > 0) return true;
  if (Array.isArray(muni?.settings.rulesText) && muni.settings.rulesText.length > 0) {
    return true;
  }
  return false;
}

publicPortalRoutes.post(
  "/api/c/:slug/reservas",
  municipalityMiddleware,
  requireSameMunicipality(),
  async (c) => {
    const user = c.get("user")!;
    const mid = c.get("municipalityId");
    const body = await c.req.json<{
      slotId: string;
      forMemberId?: string;
      forMemberName?: string;
      rulesAccepted?: boolean;
      rulesVersion?: string;
      openMatch?: {
        title: string;
        sport?: string;
        spotsTotal?: number;
        level?: string;
        notes?: string;
        nameDisplayConsent?: boolean;
        displayName?: string;
      };
    }>();
    if (!body.slotId || typeof body.slotId !== "string" || !body.slotId.trim()) {
      return c.json({ error: "slot_required" }, 400);
    }
    if (body.rulesAccepted === false) {
      return c.json({ error: "rules_not_accepted" }, 400);
    }
    if (
      body.rulesAccepted !== true &&
      (await targetHasConfiguredRules(mid, body.slotId))
    ) {
      return c.json({ error: "rules_not_accepted" }, 400);
    }
    try {
      if (body.openMatch?.title) {
        const { booking, match } = await createBookingWithOpenMatch({
          municipalityId: mid,
          slotId: body.slotId,
          userId: user.id,
          displayName: user.displayName,
          email: user.email,
          userRole: c.get("effectiveRole"),
          rulesVersion: body.rulesVersion,
          title: body.openMatch.title,
          sport: body.openMatch.sport,
          spotsTotal: body.openMatch.spotsTotal,
          level: body.openMatch.level,
          notes: body.openMatch.notes,
          nameDisplayConsent: body.openMatch.nameDisplayConsent === true,
          proposedDisplayName: body.openMatch.displayName,
        });
        return c.json({ data: booking, openMatch: match }, 201);
      }
      const booking = await createBooking({
        municipalityId: mid,
        slotId: body.slotId,
        userId: user.id,
        userDisplayName: user.displayName,
        userRole: c.get("effectiveRole"),
        forMemberId: body.forMemberId,
        forMemberName: body.forMemberName,
        rulesVersion: body.rulesVersion,
      });
      return c.json({ data: booking }, 201);
    } catch (e) {
      if (e instanceof OverlappingBookingError) {
        return c.json(
          {
            error: "overlapping_booking",
            facilityName: e.facilityName,
            start: e.start,
            date: e.date,
          },
          409,
        );
      }
      const msg = e instanceof Error ? e.message : "error";
      const bad = new Set([
        "slot_in_past",
        "antelation_exceeded",
        "booking_limit_exceeded",
        "booking_blocked",
        "weekly_hours_exceeded",
        "family_member_required",
        "family_member_forbidden",
        "slot_closed",
        "slot_not_found",
        "who_cannot_book",
        "title_invalid",
        "title_required",
        "booking_required",
        "open_matches_disabled",
        "spots_exceed_capacity",
        "unit_not_found",
        "display_name_required",
        "invalid_display_name",
        "consent_required",
      ]);
      const status =
        msg === "slot_occupied" || msg === "overlapping_booking"
          ? 409
          : bad.has(msg)
            ? 400
            : 409;
      return c.json({ error: msg }, status);
    }
  },
);

const modifyBookingBodySchema = z.object({
  slotId: z.string().trim().min(1).max(200),
});

publicPortalRoutes.patch(
  "/api/c/:slug/reservas/:id",
  municipalityMiddleware,
  requireSameMunicipality(),
  async (c) => {
    const user = c.get("user")!;
    const parsed = modifyBookingBodySchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!parsed.success) return c.json({ error: "slot_required" }, 400);
    try {
      const existing = await getBooking(c.req.param("id")!);
      if (!existing || existing.municipalityId !== c.get("municipalityId")) {
        return c.json({ error: "not_found" }, 404);
      }
      const { booking, previousSlotId } = await modifyBooking({
        bookingId: existing.id,
        newSlotId: parsed.data.slotId,
        userId: user.id,
      });
      await audit(
        c.get("municipalityId"),
        c.get("effectiveRole") === "citizen" ? user.id : user.displayName,
        "booking.modify",
        `${booking.id}:${previousSlotId}->${booking.slotId}`,
      );
      const fac = await getFacility(booking.facilityId);
      const beforeLabel = formatDayTimeChip(existing.date, existing.start, "gl");
      const unitName = await unitNameForBooking(booking.facilityId, booking.unitId);
      await sendUserNotice({
        id: newId(`n-mod-${booking.id}`),
        municipalityId: c.get("municipalityId"),
        userId: user.id,
        noticeType: "change",
        notifyType: "cambio",
        title: "Reserva modificada",
        body: `${fac?.name ?? "instalación"} · ${formatDayChip(booking.date, "gl")} ${booking.start}–${booking.end}`,
        email: {
          kind: "booking_changed",
          data: {
            facilityName: fac?.name ?? "Instalación",
            unitName: unitName || undefined,
            facilityAddress: fac?.address,
            beforeLabel,
            afterDayLabel: formatDayChip(booking.date, "gl"),
            afterTimeLabel: booking.start,
            date: booking.date,
            start: booking.start,
            end: booking.end,
            shortCode: booking.shortCode,
            bookingId: booking.id,
            icsSequence: booking.icsSequence ?? 1,
            byStaff: false,
          },
        },
      });
      return c.json({
        data: {
          ...booking,
          facilityName: fac?.name,
          previousSlotId,
        },
      });
    } catch (e) {
      if (e instanceof OverlappingBookingError) {
        return c.json(
          {
            error: "overlapping_booking",
            facilityName: e.facilityName,
            start: e.start,
            date: e.date,
          },
          409,
        );
      }
      const msg = e instanceof Error ? e.message : "error";
      if (msg === "forbidden") return c.json({ error: msg }, 403);
      if (
        msg === "slot_occupied" ||
        msg === "slot_held" ||
        msg === "overlapping_booking"
      ) {
        return c.json({ error: msg }, 409);
      }
      return c.json({ error: msg }, 400);
    }
  },
);

/** REVISION-60 N11 — mock-idp pechado en canto hai Cl@ve real configurada (ou fóra de demo). */
export function registerMockIdpRoutes<E extends object>(app: Hono<E>): void {
  app.get("/auth/saml/mock-idp", (c) => {
    if (!isMockIdpEnabled()) return c.text("Not Found", 404);
    const relayState =
      c.req.query("RelayState") ?? c.req.query("returnTo") ?? "/";
    const samlRequest = c.req.query("SAMLRequest") ?? "";
    const prefer = c.req.query("user") ?? "cidada";
    const showTech =
      c.req.query("tech") === "1" || c.req.query("debug") === "1";
    c.header("Content-Security-Policy", IDP_HTML_CSP);
    return c.html(
      renderMockIdpSelectHtml({
        relayState,
        samlRequest,
        prefer,
        showTech,
      }),
    );
  });

  app.post("/auth/saml/mock-idp/sso", async (c) => {
    if (!isMockIdpEnabled()) return c.text("Not Found", 404);
    const body = await c.req.parseBody();
    const userKey = String(body.user ?? "cidada");
    const relayState = String(body.RelayState ?? "/");
    if (hasDemoUsersFile() && !findDemoFileUser(userKey, relayState)) {
      return c.redirect(
        `/auth/saml/mock-idp?RelayState=${encodeURIComponent(relayState)}`,
      );
    }
    c.header("Content-Security-Policy", IDP_HTML_CSP);
    return c.html(
      idpAutoPostHtml({
        userKey,
        relayState,
      }),
    );
  });

  app.get("/auth/saml/callback", (c) => {
    if (!isMockIdpEnabled()) return c.text("Not Found", 404);
    const user = c.req.query("user") ?? "cidada";
    const returnTo = c.req.query("returnTo") ?? "/";
    return c.redirect(
      `/auth/saml/mock-idp?user=${encodeURIComponent(user)}&RelayState=${encodeURIComponent(returnTo)}`,
    );
  });
}
