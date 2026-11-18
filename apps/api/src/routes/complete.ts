import { Hono } from "hono";
import { deleteCookie } from "hono/cookie";
import { and, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { csvEscapeCell } from "@pista-aberta/shared";
import { municipalityMiddleware } from "../tenancy.js";
import {
  optionalAuth,
  requireAuth,
  requireMuniRoles,
  requireSameMunicipality,
  effectiveRoleInMunicipality,
  assertDeputacionPersonalDataAllowed,
  deputacionAnonymizeMiddleware,
} from "../middleware/auth.js";
import {
  assertMunicipalityCreateRateLimit,
  createBooking,
  approvePendingBooking,
  rejectPendingBooking,
  listPendingBookings,
  dashboardStats,
  exportOpenData,
  getBooking,
  getClub,
  getFacility,
  getMunicipalityById,
  getMunicipalityBySlug,
  listBookings,
  listBookingsForAuthenticatedUser,
  listClubs,
  listFacilities,
  listTeams,
  listUnits,
  pavilionWeekend,
  rejectSwap,
  acceptSwapProposal,
  staffDayList,
} from "../store/db.js";
import { newId } from "../lib/ids.js";
import { isDemoMode, isTrustProxy } from "../env.js";
import { getLastDemoResetAt, resetDemoData } from "../store/demo-reset.js";
import {
  getDemoRestoreLastError,
  getDemoSnapshotStatus,
  saveDemoSnapshot,
} from "../store/demo-snapshot.js";
import {
  hhmmEndSchema,
  hhmmStartSchema,
  isoDateSchema,
} from "../lib/date-time-zod.js";
import {
  DEFAULT_TIMEZONE,
  localDateIso,
} from "../store/business-rules.js";
import {
  acceptWaitlistOffer,
  addFamilyMember,
  removeFamilyMember,
  audit,
  getConsent,
  listAudit,
  listFamily,
  listNotices,
  listUnreadNotices,
  listSeasonSlots,
  listWaitlist,
  markNoticeRead,
  offerWaitlistOnCancel,
  setConsent,
  onBookingCancelledBridge,
} from "../store/extra-bridge.js";
import { getDb, getDbMode } from "../db/client.js";
import * as schema from "../db/schema.js";
import { mapUser } from "../db/mappers.js";
import {
  clubAccountOwnsClub,
  createClubWithAccount,
  listClubAccounts,
  updateClubAccount,
} from "../store/club-accounts.js";
import { createClubRequest, createMatchChangeRequest } from "../store/admin-ops.js";
import { cookieSecure } from "../env.js";

export const completeRoutes = new Hono();
completeRoutes.use("*", optionalAuth);
completeRoutes.use("/api/c/:slug/*", deputacionAnonymizeMiddleware);

function boundedQuery(c: { req: { query(name: string): string | undefined } }) {
  const integer = (name: string, fallback: number, max: number) => {
    const value = Number(c.req.query(name));
    return Number.isFinite(value)
      ? Math.min(max, Math.max(name === "limit" ? 1 : 0, Math.trunc(value)))
      : fallback;
  };
  const date = (name: string, end = false) => {
    const raw = c.req.query(name);
    if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
    const parsed = new Date(`${raw}T${end ? "23:59:59.999" : "00:00:00.000"}Z`);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  };
  return {
    limit: integer("limit", 100, 500),
    offset: integer("offset", 0, 1_000_000),
    from: date("from"),
    to: date("to", true),
  };
}

completeRoutes.get("/api/me/reservas", requireAuth, async (c) => {
  const user = c.get("user")!;
  const data = await listBookingsForAuthenticatedUser({
    id: user.id,
    personIdentifier: user.personIdentifier ?? null,
  });
  return c.json({ data });
});

/* Avisos — por defecto só pendentes (non lidos) do usuario. ?all=1 devolve todos. */
completeRoutes.get("/api/c/:slug/avisos", municipalityMiddleware, async (c) => {
  const user = c.get("user");
  const all = c.req.query("all") === "1";
  const muni = c.get("municipalityId");
  /* REVISION-39 L4: ao abrir avisos de Ana, renovar oferta se caducou. */
  if (user?.id === "user-cidada" && muni === "muni-exemplo") {
    try {
      const { isDemoMode } = await import("../env.js");
      if (isDemoMode()) {
        const { ensureAnaWaitlistOffer } = await import(
          "../store/demo-bookings.js"
        );
        await ensureAnaWaitlistOffer(new Date());
      }
    } catch {
      /* non bloquear avisos */
    }
  }
  const page = boundedQuery(c);
  const data = all
    ? await listNotices(muni, user?.id, page)
    : await listUnreadNotices(muni, user?.id, page);
  return c.json({ data });
});
completeRoutes.post(
  "/api/c/:slug/avisos/:id/ler",
  municipalityMiddleware,
  requireSameMunicipality(),
  async (c) => {
    try {
      const user = c.get("user")!;
      await markNoticeRead(
        c.req.param("id")!,
        user.id,
        c.get("municipalityId"),
      );
      return c.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      if (msg === "notice_not_found") return c.json({ error: msg }, 404);
      if (msg === "notice_forbidden") return c.json({ error: msg }, 403);
      throw e;
    }
  },
);
completeRoutes.post(
  "/api/c/:slug/avisos/:id/aceptar-praza",
  municipalityMiddleware,
  requireSameMunicipality(),
  async (c) => {
    const user = c.get("user")!;
    try {
      /* REVISION-38 J2: slotId do payload do aviso. */
      let slotId: string | undefined;
      {
        const { getDb } = await import("../db/client.js");
        const schema = await import("../db/schema.js");
        const { and, eq, or, isNull } = await import("drizzle-orm");
        const rows = await getDb()
          .select()
          .from(schema.notices)
          .where(
            and(
              eq(schema.notices.id, c.req.param("id")!),
              eq(schema.notices.municipalityId, c.get("municipalityId")),
              or(
                eq(schema.notices.userId, user.id),
                isNull(schema.notices.userId),
              ),
            ),
          )
          .limit(1);
        if (!rows[0]) return c.json({ error: "notice_not_found" }, 404);
        if (rows[0].userId && rows[0].userId !== user.id) {
          return c.json({ error: "notice_forbidden" }, 403);
        }
        const payload = rows[0]?.payload as Record<string, unknown> | null;
        const raw = payload?.slotId;
        if (typeof raw === "string" && raw.trim()) slotId = raw.trim();
      }
      const result = await acceptWaitlistOffer(
        c.get("municipalityId"),
        user.id,
        user.displayName,
        new Date(),
        slotId,
      );
      try {
        await markNoticeRead(
          c.req.param("id")!,
          user.id,
          c.get("municipalityId"),
        );
      } catch {
        /* aviso opcional */
      }
      return c.json({ data: result });
    } catch (e) {
      const { OverlappingBookingError } = await import(
        "../store/booking-overlap.js"
      );
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
      const status =
        msg === "no_offer" || msg === "offer_expired"
          ? 404
          : msg === "slot_not_found" ||
              msg === "slot_closed" ||
              msg === "slot_in_past" ||
              msg === "slot_occupied" ||
              msg === "overlapping_booking"
            ? 409
            : 400;
      return c.json({ error: msg }, status);
    }
  },
);

/* Conta / familia / consentimento */
completeRoutes.get("/api/me/familia", requireAuth, async (c) => {
  const user = c.get("user")!;
  return c.json({
    data: await listFamily(user.id),
    consent: await getConsent(user.id),
  });
});
const familyRelationSchema = z.enum(["fillo", "filla", "dependente", "outro"]);
function familyBirthYearSchema() {
  return z.number().int().min(1900).max(new Date().getFullYear());
}

completeRoutes.post("/api/me/familia", requireAuth, async (c) => {
  const user = c.get("user")!;
  const parsed = z
    .object({
      displayName: z.string().trim().min(1).max(120),
      birthYear: familyBirthYearSchema().optional(),
      relation: familyRelationSchema,
    })
    .safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: "validation_error", issues: parsed.error.issues }, 400);
  }
  const body = parsed.data;
  const m = await addFamilyMember({
    userId: user.id,
    municipalityId: user.municipalityId,
    displayName: body.displayName,
    birthYear: body.birthYear,
    relation: body.relation,
  });
  return c.json({ data: m }, 201);
});
completeRoutes.delete("/api/me/familia/:id", requireAuth, async (c) => {
  const user = c.get("user")!;
  try {
    await removeFamilyMember(user.id, c.req.param("id")!);
    return c.json({ data: { ok: true } });
  } catch {
    return c.json({ error: "not_found" }, 404);
  }
});
/* REVISION-58 K7 + REVISION-60 N5 — mesma validación Zod en POST e PATCH. */
completeRoutes.patch("/api/me/familia/:id", requireAuth, async (c) => {
  const user = c.get("user")!;
  const parsed = z
    .object({
      birthYear: familyBirthYearSchema(),
      relation: familyRelationSchema.optional(),
    })
    .safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: "validation_error", issues: parsed.error.issues }, 400);
  }
  const body = parsed.data;
  const { updateFamilyMember } = await import("../store/extra.js");
  try {
    const data = await updateFamilyMember(user.id, c.req.param("id")!, body);
    return c.json({ data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return c.json(
      { error: msg },
      msg === "not_found" ? 404 : 400,
    );
  }
});
completeRoutes.patch("/api/me", requireAuth, async (c) => {
  const user = c.get("user")!;
  const channelSchema = z.object({
    email: z.boolean(),
    inApp: z.boolean(),
  });
  const body = z
    .object({
      email: z.string().email().max(120).optional(),
      locale: z.enum(["gl", "es"]).optional(),
      notifyEmail: z.boolean().optional(),
      notifyReminders: z.boolean().optional(),
      notifyPrefs: z
        .object({
          confirmacion: channelSchema,
          cambio: channelSchema,
          cancelacion: channelSchema,
          recordatorio: channelSchema,
          praza_liberada: channelSchema,
          partido_club: channelSchema,
          partido_aberto: channelSchema,
        })
        .optional(),
    })
    .parse(await c.req.json());

  const {
    normalizeNotifyPrefs,
    derivedNotifyFlags,
    applyLegacyToggles,
  } = await import("../notify/prefs.js");

  const rows0 = await getDb()
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, user.id))
    .limit(1);
  let prefs = normalizeNotifyPrefs(rows0[0]?.notifyPrefs);

  if (body.notifyPrefs) {
    prefs = normalizeNotifyPrefs(body.notifyPrefs);
  } else if (
    body.notifyEmail !== undefined ||
    body.notifyReminders !== undefined
  ) {
    prefs = applyLegacyToggles(prefs, {
      notifyEmail: body.notifyEmail,
      notifyReminders: body.notifyReminders,
    });
  }
  const flags = derivedNotifyFlags(prefs);

  const set: Record<string, unknown> = {};
  if (body.locale !== undefined) set.locale = body.locale;
  if (
    body.notifyPrefs !== undefined ||
    body.notifyEmail !== undefined ||
    body.notifyReminders !== undefined
  ) {
    set.notifyPrefs = prefs;
    set.notifyEmail = flags.notifyEmail;
    set.notifyReminders = flags.notifyReminders;
  }

  /* REVISION-50 S1: cambio de correo só cun código ao correo novo. */
  let emailChange: {
    challengeId: string;
    message: string;
    demoCode?: string;
  } | null = null;
  if (body.email !== undefined) {
    const nextEmail = body.email.trim().toLowerCase();
    const current = (rows0[0]?.email ?? "").trim().toLowerCase();
    if (nextEmail && nextEmail !== current) {
      const taken = await getDb()
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, nextEmail))
        .limit(1);
      if (taken[0] && taken[0].id !== user.id) {
        return c.json({ error: "email_taken" }, 409);
      }
      /* REVISION-51 B3: 5/hora/persoa e 3/hora/destino. */
      {
        const {
          assertEmailChangeRateLimit,
          LoginRateLimitedError,
        } = await import("../identity/login-rate-limit.js");
        try {
          await assertEmailChangeRateLimit(user.id, nextEmail);
        } catch (err) {
          if (err instanceof LoginRateLimitedError) {
            return c.json(
              {
                error: "rate_limited",
                retryAfterMinutes: err.retryAfterMinutes,
              },
              429,
            );
          }
          throw err;
        }
      }
      const { randomInt, randomUUID } = await import("node:crypto");
      const code = String(randomInt(100000, 999999));
      const challengeId = randomUUID();
      await getDb().insert(schema.otpChallenges).values({
        id: challengeId,
        email: nextEmail,
        code,
        municipalityId: user.municipalityId,
        attempts: 0,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        userId: user.id,
        purpose: "email_change",
      });
      try {
        const { getMunicipalityById } = await import("../store/db.js");
        const muni = await getMunicipalityById(user.municipalityId);
        const { sendRenderedMail } = await import("../notify/send-notice.js");
        await sendRenderedMail({
          to: nextEmail,
          muni: muni ?? null,
          locale: "gl",
          kind: "otp",
          data: { code },
        });
      } catch (err) {
        console.warn(`[mail] email_change: ${(err as Error).message}`);
      }
      const paDemo =
        process.env.PA_DEMO === "1" || process.env.PA_DEMO === "true";
      emailChange = {
        challengeId,
        message: "Enviamos un código ao correo novo. Confírmao para gardalo.",
        ...(paDemo ? { demoCode: code } : {}),
      };
    }
  }

  if (Object.keys(set).length) {
    try {
      await getDb()
        .update(schema.users)
        .set(set)
        .where(eq(schema.users.id, user.id));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/unique|duplicate|users_email/i.test(msg)) {
        return c.json({ error: "email_taken" }, 409);
      }
      throw err;
    }
  }
  const rows = await getDb()
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, user.id))
    .limit(1);
  return c.json({
    data: mapUser(rows[0]!),
    ...(emailChange ? { emailChange } : {}),
  });
});

/** REVISION-50 S1 — confirmar cambio de correo co código OTP. */
completeRoutes.post("/api/me/email/confirmar", requireAuth, async (c) => {
  const user = c.get("user")!;
  const body = z
    .object({
      challengeId: z.string().min(1),
      code: z.string().min(4).max(12),
    })
    .parse(await c.req.json());
  const rows = await getDb()
    .select()
    .from(schema.otpChallenges)
    .where(eq(schema.otpChallenges.id, body.challengeId))
    .limit(1);
  const ch = rows[0];
  if (
    !ch ||
    ch.purpose !== "email_change" ||
    ch.userId !== user.id ||
    ch.expiresAt.getTime() < Date.now()
  ) {
    return c.json({ error: "challenge_invalid" }, 400);
  }
  if (ch.code !== body.code.trim()) {
    const next = (ch.attempts ?? 0) + 1;
    if (next >= 5) {
      await getDb()
        .delete(schema.otpChallenges)
        .where(eq(schema.otpChallenges.id, body.challengeId));
      return c.json({ error: "code_locked" }, 400);
    }
    await getDb()
      .update(schema.otpChallenges)
      .set({ attempts: next })
      .where(eq(schema.otpChallenges.id, body.challengeId));
    return c.json({ error: "code_invalid" }, 400);
  }
  const email = ch.email.trim().toLowerCase();
  const taken = await getDb()
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  if (taken[0] && taken[0].id !== user.id) {
    await getDb()
      .delete(schema.otpChallenges)
      .where(eq(schema.otpChallenges.id, body.challengeId));
    return c.json({ error: "email_taken" }, 409);
  }
  try {
    await getDb()
      .update(schema.users)
      .set({ email })
      .where(eq(schema.users.id, user.id));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/unique|duplicate|users_email/i.test(msg)) {
      return c.json({ error: "email_taken" }, 409);
    }
    throw err;
  }
  await getDb()
    .delete(schema.otpChallenges)
    .where(eq(schema.otpChallenges.id, body.challengeId));
  const updated = await getDb()
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, user.id))
    .limit(1);
  return c.json({ data: mapUser(updated[0]!) });
});
completeRoutes.get("/api/me/datos", requireAuth, async (c) => {
  const user = c.get("user")!;
  const family = await listFamily(user.id);
  const consent = await getConsent(user.id);
  const bookings = await listBookingsForAuthenticatedUser(user);
  const db = getDb();
  const [
    userRoles,
    activityApplications,
    waitlistEntries,
    incidents,
    openMatchPlayers,
    openMatchInvites,
  ] = await Promise.all([
    db
      .select()
      .from(schema.userRoles)
      .where(eq(schema.userRoles.userId, user.id)),
    db
      .select()
      .from(schema.activityApplications)
      .where(eq(schema.activityApplications.userId, user.id)),
    db
      .select()
      .from(schema.waitlistEntries)
      .where(eq(schema.waitlistEntries.userId, user.id)),
    db
      .select()
      .from(schema.incidents)
      .where(eq(schema.incidents.userId, user.id)),
    db
      .select()
      .from(schema.openMatchPlayers)
      .where(eq(schema.openMatchPlayers.userId, user.id)),
    db
      .select()
      .from(schema.openMatchInvites)
      .where(
        or(
          eq(schema.openMatchInvites.fromUserId, user.id),
          eq(schema.openMatchInvites.toUserId, user.id),
        ),
      ),
  ]);
  const openMatchIds = [
    ...new Set(openMatchPlayers.map((p) => p.openMatchId)),
  ];
  const openMatches =
    openMatchIds.length > 0
      ? await db
          .select()
          .from(schema.openMatches)
          .where(inArray(schema.openMatches.id, openMatchIds))
      : [];
  return c.json({
    data: {
      exportedAt: new Date().toISOString(),
      user: {
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        role: user.role,
        locale: user.locale,
        municipalityId: user.municipalityId,
      },
      consent,
      family,
      bookings,
      userRoles,
      activityApplications,
      waitlistEntries,
      incidents,
      openMatches: {
        matches: openMatches,
        players: openMatchPlayers,
        invites: openMatchInvites,
      },
    },
  });
});
completeRoutes.post("/api/me/pechar", requireAuth, async (c) => {
  const user = c.get("user")!;
  if (user.role !== "citizen") {
    return c.json({ error: "only_citizen" }, 403);
  }
  try {
    const { detachUserFromOpenMatches } = await import("../store/open-matches.js");
    await detachUserFromOpenMatches(user.id);
  } catch (err) {
    console.warn("[open-match] detach on pechar failed", err);
  }
  /* REVISION-55 G5: cancelar futuras, saír waitlist/actividades, anonimizar nome. */
  try {
    const { closeCitizenAccount } = await import("../store/close-account.js");
    await closeCitizenAccount(user);
  } catch (err) {
    console.warn("[pechar] closeCitizenAccount failed", err);
    return c.json({ error: "close_failed" }, 500);
  }
  deleteCookie(c, "pa_sesion", {
    path: "/",
    secure: cookieSecure(),
  });
  return c.json({ data: { ok: true } });
});
completeRoutes.post("/api/me/consentimento", requireAuth, async (c) => {
  const user = c.get("user")!;
  const body = await c.req.json<{ version?: string }>().catch(() => ({}));
  return c.json({
    data: await setConsent(user.id, (body as { version?: string }).version),
  });
});

/* Fin de semana pública + ICS */
/** REVISION-19 B1: público só partidos aprobados/programados. */
const PUBLIC_MATCH_STATUSES = new Set([
  "scheduled",
  "resolved",
  "swapped",
  "moved",
]);

function isPublicMatch(status: string): boolean {
  return PUBLIC_MATCH_STATUSES.has(status) && !status.startsWith("proposed");
}

completeRoutes.get("/api/c/:slug/fin-de-semana", municipalityMiddleware, async (c) => {
  const raw = c.req.query("weekOffset");
  const weekOffset = raw != null && raw !== "" ? Number(raw) : 0;
  const offset = Number.isFinite(weekOffset) ? Math.trunc(weekOffset) : 0;
  const data = await pavilionWeekend(c.get("municipalityId"), offset);
  const matches = data.matches.filter((m) => isPublicMatch(m.status));
  return c.json({
    data: {
      weekend: data.weekend,
      matches: matches.map((m) => ({
        id: m.id,
        date: m.date,
        start: m.start,
        end: m.end,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        unit: m.unit,
        club: m.club,
        status: "scheduled",
      })),
    },
  });
});
completeRoutes.get("/api/c/:slug/fin-de-semana.ics", municipalityMiddleware, async (c) => {
  const { EUROPE_MADRID_VTIMEZONE, dtStampUtc, toIcsLocalStamp } = await import(
    "../lib/booking-ics.js"
  );
  const data = await pavilionWeekend(c.get("municipalityId"));
  const stamp = dtStampUtc();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Pista Aberta//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...EUROPE_MADRID_VTIMEZONE,
  ];
  for (const m of data.matches.filter((x) => isPublicMatch(x.status))) {
    const start = toIcsLocalStamp(m.date, m.start);
    const end = toIcsLocalStamp(m.date, m.end);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${m.id}@pistaaberta.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=Europe/Madrid:${start}`,
      `DTEND;TZID=Europe/Madrid:${end}`,
      `SUMMARY:${m.homeTeam} vs ${m.awayTeam}`,
      `DESCRIPTION:${m.unit} · ${m.club}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return c.text(lines.join("\r\n"), 200, {
    "Content-Type": "text/calendar; charset=utf-8",
    "Content-Disposition": 'attachment; filename="pavillon.ics"',
  });
});

/* Conserxería */
completeRoutes.get(
  "/api/c/:slug/conserxeria/dia",
  municipalityMiddleware,
  requireMuniRoles("staff", "admin", "monitor"),
  async (c) => {
    const muniId = c.get("municipalityId");
    const muni = await getMunicipalityById(muniId);
    const date =
      c.req.query("date") ??
      localDateIso(new Date(), muni?.settings.timezone ?? DEFAULT_TIMEZONE);
    return c.json({ data: await staffDayList(muniId, date), date });
  },
);

/* Clubs — 1 conta por club; listado admin ou redirect da súa conta */
completeRoutes.get(
  "/api/c/:slug/clubs",
  municipalityMiddleware,
  requireMuniRoles("club_manager", "admin"),
  async (c) => {
  const user = c.get("user")!;
  const effectiveRole = c.get("effectiveRole");
  const mid = c.get("municipalityId");
  if (effectiveRole === "club_manager") {
    if (!user.clubId) return c.json({ data: [] });
    const club = await getClub(user.clubId);
    if (!club || club.municipalityId !== mid) return c.json({ data: [] });
    return c.json({
      data: [
        {
          ...club,
          seasonSlots: await listSeasonSlots(mid, club.id),
          accountEmail: user.email,
        },
      ],
    });
  }
  if (effectiveRole !== "admin" && effectiveRole !== "superadmin") {
    return c.json({ error: "forbidden", reason: "role" }, 403);
  }
  const clubs = await listClubs(mid);
  const data = await Promise.all(
    clubs.map(async (cl) => ({
      ...cl,
      seasonSlots: await listSeasonSlots(mid, cl.id),
    })),
  );
  return c.json({ data });
  },
);
completeRoutes.get(
  "/api/c/:slug/clubs/:clubId",
  municipalityMiddleware,
  requireMuniRoles("club_manager", "admin"),
  async (c) => {
  const user = c.get("user")!;
  const mid = c.get("municipalityId");
  const clubId = c.req.param("clubId")!;
  if (!clubAccountOwnsClub(user, clubId, mid)) {
    return c.json({ error: "forbidden", reason: "wrong_club" }, 403);
  }
  const club = await getClub(clubId);
  if (!club || club.municipalityId !== mid) {
    return c.json({ error: "not_found" }, 404);
  }
  const accounts = await listClubAccounts(mid);
  const row = accounts.find((a) => a.id === club.id);
  const { listClubRequests } = await import("../store/admin-ops.js");
  const pendingRequests = (await listClubRequests(mid, "pending")).filter(
    (r) => r.clubId === club.id,
  );
  return c.json({
    data: {
      ...club,
      seasonSlots: await listSeasonSlots(mid, club.id),
      teams: await listTeams(mid, club.id),
      pendingRequests: pendingRequests.map((r) => ({
        id: r.id,
        type: r.type,
        status: r.status,
        createdAt: r.createdAt,
      })),
      account: row?.account
        ? {
            id: row.account.id,
            displayName: row.account.displayName,
            email: row.account.email,
            active: row.account.active,
          }
        : null,
    },
  });
  },
);

/* REVISION-55 G6 — validación zod das solicitudes de club. */
const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "invalid_time");
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "invalid_date")
  .refine((s) => {
    const [y, m, d] = s.split("-").map(Number);
    const dt = new Date(Date.UTC(y!, m! - 1, d!));
    return (
      dt.getUTCFullYear() === y &&
      dt.getUTCMonth() === m! - 1 &&
      dt.getUTCDate() === d
    );
  }, "invalid_date");
const teamName = z.string().trim().min(1).max(80);

function endAfterStart(start: string, end: string): boolean {
  return end > start;
}

const seasonBodyFields = {
  name: z.string().trim().min(1).max(120),
  startsAt: isoDate,
  endsAt: isoDate,
  facilityIds: z.array(z.string().trim().min(1)).max(100),
  criteriaGl: z.string().max(10_000),
  criteriaEs: z.string().max(10_000),
  published: z.boolean(),
};

export const seasonCreateBodySchema = z
  .object({
    name: seasonBodyFields.name,
    startsAt: seasonBodyFields.startsAt,
    endsAt: seasonBodyFields.endsAt,
    facilityIds: seasonBodyFields.facilityIds.optional().default([]),
    criteriaGl: seasonBodyFields.criteriaGl.optional().default(""),
    criteriaEs: seasonBodyFields.criteriaEs.optional().default(""),
    published: seasonBodyFields.published.optional().default(false),
  })
  .strict()
  .refine((body) => body.startsAt <= body.endsAt, {
    message: "dates_inverted",
    path: ["endsAt"],
  });

export const seasonUpdateBodySchema = z
  .object({
    name: seasonBodyFields.name.optional(),
    startsAt: seasonBodyFields.startsAt.optional(),
    endsAt: seasonBodyFields.endsAt.optional(),
    facilityIds: seasonBodyFields.facilityIds.optional(),
    criteriaGl: seasonBodyFields.criteriaGl.optional(),
    criteriaEs: seasonBodyFields.criteriaEs.optional(),
    published: seasonBodyFields.published.optional(),
  })
  .strict()
  .refine(
    (body) =>
      !body.startsAt || !body.endsAt || body.startsAt <= body.endsAt,
    { message: "dates_inverted", path: ["endsAt"] },
  );

export function seasonErrorStatus(message: string): 400 | 404 {
  return message === "not_found" || message === "facility_not_found"
    ? 404
    : 400;
}

const seasonRequestSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    start: hhmm,
    end: hhmm,
    unitId: z.string().trim().min(1),
    facilityId: z.string().trim().min(1),
    note: z.string().optional(),
  })
  .refine((v) => endAfterStart(v.start, v.end), {
    message: "end_before_start",
    path: ["end"],
  });

const matchRequestSchema = z
  .object({
    date: isoDate,
    start: hhmm,
    end: hhmm,
    homeTeam: teamName,
    awayTeam: teamName,
    unitId: z.string().trim().min(1),
    facilityId: z.string().trim().min(1),
    note: z.string().optional(),
  })
  .refine((v) => endAfterStart(v.start, v.end), {
    message: "end_before_start",
    path: ["end"],
  });

const matchChangeRequestSchema = z
  .object({
    matchId: z.string().trim().min(1),
    date: isoDate.optional(),
    start: hhmm.optional(),
    end: hhmm.optional(),
    unitId: z.string().trim().min(1).optional(),
    facilityId: z.string().trim().min(1).optional(),
    note: z.string().optional(),
  })
  .refine(
    (v) => {
      if (v.start && v.end) return endAfterStart(v.start, v.end);
      return true;
    },
    { message: "end_before_start", path: ["end"] },
  );

/** Solicitude de franxa de tempada (conta do club). */
completeRoutes.post(
  "/api/c/:slug/clubs/:clubId/solicitar-tempada",
  municipalityMiddleware,
  requireMuniRoles("club_manager", "admin"),
  async (c) => {
    const user = c.get("user")!;
    const mid = c.get("municipalityId");
    const clubId = c.req.param("clubId")!;
    if (!clubAccountOwnsClub(user, clubId, mid)) {
      return c.json({ error: "forbidden", reason: "wrong_club" }, 403);
    }
    const raw = await c.req.json().catch(() => null);
    const parsed = seasonRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        { error: "validation_error", issues: parsed.error.issues },
        400,
      );
    }
    const body = parsed.data;
    const club = await getClub(clubId);
    if (!club || club.municipalityId !== mid) return c.json({ error: "not_found" }, 404);
    try {
      const data = await createClubRequest({
        municipalityId: mid,
        clubId,
        type: "season",
        payload: {
          weekday: body.weekday,
          start: body.start,
          end: body.end,
          unitId: body.unitId,
          facilityId: body.facilityId,
        },
        note: body.note,
        userId: user.id,
        userName: user.displayName,
      });
      return c.json({ data }, 201);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      if (msg === "facility_required" || msg === "unit_required") {
        return c.json({ error: msg }, 400);
      }
      throw e;
    }
  },
);

/** Solicitude de horario para partido de fin de semana. */
completeRoutes.post(
  "/api/c/:slug/clubs/:clubId/solicitar-partido",
  municipalityMiddleware,
  requireMuniRoles("club_manager", "admin"),
  async (c) => {
    const user = c.get("user")!;
    const mid = c.get("municipalityId");
    const clubId = c.req.param("clubId")!;
    if (!clubAccountOwnsClub(user, clubId, mid)) {
      return c.json({ error: "forbidden", reason: "wrong_club" }, 403);
    }
    const raw = await c.req.json().catch(() => null);
    const parsed = matchRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        { error: "validation_error", issues: parsed.error.issues },
        400,
      );
    }
    const body = parsed.data;
    const club = await getClub(clubId);
    if (!club || club.municipalityId !== mid) return c.json({ error: "not_found" }, 404);
    try {
      const data = await createClubRequest({
        municipalityId: mid,
        clubId,
        type: "match",
        payload: {
          date: body.date,
          start: body.start,
          end: body.end,
          homeTeam: body.homeTeam,
          awayTeam: body.awayTeam,
          unitId: body.unitId,
          facilityId: body.facilityId,
        },
        note: body.note,
        userId: user.id,
        userName: user.displayName,
      });
      return c.json({ data }, 201);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      if (msg === "facility_required" || msg === "unit_required") {
        return c.json({ error: msg }, 400);
      }
      throw e;
    }
  },
);

/** Pedido de cambio dun partido xa aprobado ou importado (REVISION-17 R3). */
completeRoutes.post(
  "/api/c/:slug/clubs/:clubId/solicitar-cambio-partido",
  municipalityMiddleware,
  requireMuniRoles("club_manager", "admin"),
  async (c) => {
    const user = c.get("user")!;
    const mid = c.get("municipalityId");
    const clubId = c.req.param("clubId")!;
    if (!clubAccountOwnsClub(user, clubId, mid)) {
      return c.json({ error: "forbidden", reason: "wrong_club" }, 403);
    }
    const raw = await c.req.json().catch(() => null);
    const parsed = matchChangeRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        { error: "validation_error", issues: parsed.error.issues },
        400,
      );
    }
    const body = parsed.data;
    try {
      const data = await createMatchChangeRequest({
        municipalityId: mid,
        clubId,
        matchId: body.matchId,
        date: body.date,
        start: body.start,
        end: body.end,
        unitId: body.unitId,
        facilityId: body.facilityId,
        note: body.note,
        userId: user.id,
        userName: user.displayName,
      });
      return c.json({ data }, 201);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      if (msg === "not_found" || msg === "not_changeable") {
        return c.json({ error: msg }, msg === "not_found" ? 404 : 400);
      }
      throw e;
    }
  },
);

/* REVISION-38 J4 / REVISION-39 L2–L3 — club acepta / rexeita contraproposta. */
completeRoutes.post(
  "/api/c/:slug/solicitudes/:id/aceptar-contraproposta",
  municipalityMiddleware,
  requireMuniRoles("club_manager"),
  async (c) => {
    const user = c.get("user")!;
    const body = (await c.req.json().catch(() => ({}))) as {
      counterVersion?: number;
      start?: string;
      end?: string;
      date?: string;
      weekday?: number;
    };
    try {
      const { acceptClubCounter } = await import("../store/admin-ops.js");
      const data = await acceptClubCounter(
        c.get("municipalityId"),
        c.req.param("id")!,
        user.id,
        body,
      );
      return c.json({ data });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      const status =
        msg === "not_found"
          ? 404
          : msg === "forbidden"
            ? 403
            : msg === "stale_counter" || msg === "conflict"
              ? 409
              : 400;
      return c.json({ error: msg }, status);
    }
  },
);
completeRoutes.post(
  "/api/c/:slug/solicitudes/:id/rexeitar-contraproposta",
  municipalityMiddleware,
  requireMuniRoles("club_manager"),
  async (c) => {
    const user = c.get("user")!;
    const body = (await c.req.json().catch(() => ({}))) as {
      counterVersion?: number;
      start?: string;
      end?: string;
      date?: string;
      weekday?: number;
    };
    try {
      const { rejectClubCounter } = await import("../store/admin-ops.js");
      const data = await rejectClubCounter(
        c.get("municipalityId"),
        c.req.param("id")!,
        user.id,
        body,
      );
      return c.json({ data });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      const status =
        msg === "not_found"
          ? 404
          : msg === "forbidden"
            ? 403
            : msg === "stale_counter" || msg === "conflict"
              ? 409
              : 400;
      return c.json({ error: msg }, status);
    }
  },
);

completeRoutes.post(
  "/api/c/:slug/pavillon/swap/:id/aceptar",
  municipalityMiddleware,
  requireMuniRoles("club_manager", "admin"),
  async (c) => {
    try {
      const user = c.get("user")!;
      return c.json({
        data: await acceptSwapProposal(
          c.req.param("id")!,
          c.get("municipalityId"),
          { actorClubId: user.clubId, actorRole: c.get("effectiveRole") },
        ),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      if (msg === "forbidden") return c.json({ error: msg }, 403);
      return c.json({ error: msg === "not_found" ? "not_found" : msg }, 404);
    }
  },
);
completeRoutes.post(
  "/api/c/:slug/pavillon/swap/:id/rexeitar",
  municipalityMiddleware,
  requireMuniRoles("club_manager", "admin"),
  async (c) => {
    try {
      const user = c.get("user")!;
      return c.json({
        data: await rejectSwap(c.req.param("id")!, c.get("municipalityId"), {
          actorClubId: user.clubId,
          actorRole: c.get("effectiveRole"),
        }),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      if (msg === "forbidden") return c.json({ error: msg }, 403);
      if (msg === "not_pending") return c.json({ error: msg }, 409);
      return c.json({ error: msg === "not_found" ? "not_found" : msg }, 404);
    }
  },
);

/* Panel concello — só admin **deste** concello */
completeRoutes.get(
  "/api/c/:slug/admin/dashboard",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
  const mid = c.get("municipalityId");
  const stats = await dashboardStats(mid);
  const { adminHomeTodos } = await import("../store/admin-ops.js");
  const todos = await adminHomeTodos(mid);
  const slug = c.get("municipalitySlug");
  const { computeLaunchChecklist } = await import("../store/municipality-launch.js");
  const launch = await computeLaunchChecklist(mid, slug);
  return c.json({ data: { ...stats, todos, launch } });
});
completeRoutes.get(
  "/api/c/:slug/admin/reservas-dia",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
  const muniId = c.get("municipalityId");
  const muni = await getMunicipalityById(muniId);
  const date =
    c.req.query("date") ??
    localDateIso(new Date(), muni?.settings.timezone ?? DEFAULT_TIMEZONE);
  return c.json({ data: await staffDayList(muniId, date), date });
});
completeRoutes.post(
  "/api/c/:slug/admin/reservar-nome",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
  const user = c.get("user")!;
  const mid = c.get("municipalityId");
  const body = await c.req.json<{
    slotId: string;
    citizenName: string;
    citizenId?: string;
    phone?: string;
    email?: string;
  }>();
  try {
    /* REVISION-55 G4: citizenId só se a persoa é deste concello. */
    if (body.citizenId) {
      const rows = await getDb()
        .select({
          id: schema.users.id,
          municipalityId: schema.users.municipalityId,
        })
        .from(schema.users)
        .where(eq(schema.users.id, body.citizenId))
        .limit(1);
      const citizen = rows[0];
      if (!citizen || citizen.municipalityId !== mid) {
        return c.json({ error: "user_not_found" }, 404);
      }
    }
    const booking = await createBooking({
      municipalityId: mid,
      slotId: body.slotId,
      userId: body.citizenId ?? newId("proxy"),
      userDisplayName: body.citizenName,
      bookedByStaff: true,
    });
    if (body.citizenId && body.phone?.trim()) {
      await getDb()
        .update(schema.users)
        .set({ phone: body.phone.trim() })
        .where(
          and(
            eq(schema.users.id, body.citizenId),
            eq(schema.users.municipalityId, mid),
          ),
        );
    }
    await audit(
      mid,
      user.displayName,
      "booking.proxy",
      `Reserva en nome de ${body.citizenName}${body.phone ? ` · ${body.phone}` : ""}`,
    );
    return c.json({ data: booking }, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    const bad = new Set([
      "slot_in_past",
      "antelation_exceeded",
      "booking_limit_exceeded",
      "booking_blocked",
      "weekly_hours_exceeded",
      "slot_closed",
      "slot_not_found",
    ]);
    return c.json({ error: msg }, msg === "slot_occupied" ? 409 : bad.has(msg) ? 400 : 409);
  }
});

/* REVISION-20 H2: reservas pendentes de aprobación. */
completeRoutes.get(
  "/api/c/:slug/admin/reservas-pendentes",
  municipalityMiddleware,
  requireMuniRoles("admin", "staff"),
  async (c) => {
    const data = await listPendingBookings(c.get("municipalityId"));
    return c.json({ data });
  },
);
completeRoutes.post(
  "/api/c/:slug/admin/reservas/:id/aprobar",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    try {
      const data = await approvePendingBooking(
        c.get("municipalityId"),
        c.req.param("id")!,
        c.get("user")!.displayName,
      );
      return c.json({ data });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      return c.json({ error: msg }, msg === "not_found" ? 404 : 400);
    }
  },
);
completeRoutes.post(
  "/api/c/:slug/admin/reservas/:id/rexeitar",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    try {
      const data = await rejectPendingBooking(
        c.get("municipalityId"),
        c.req.param("id")!,
        c.get("user")!.displayName,
      );
      return c.json({ data });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      return c.json({ error: msg }, msg === "not_found" ? 404 : 400);
    }
  },
);

/** REVISION-17 R2: enviar o código PA por correo tras reservar en nome. */
completeRoutes.post(
  "/api/c/:slug/admin/reservar-nome/:id/correo",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const bookingId = c.req.param("id");
    const body = await c.req.json<{ email?: string }>().catch(() => ({} as { email?: string }));
    const booking = await getBooking(bookingId!);
    if (!booking || booking.municipalityId !== c.get("municipalityId")) {
      return c.json({ error: "not_found" }, 404);
    }
    let to = body.email?.trim() || "";
    const ownerId = booking.userId;
    if (!to && ownerId) {
      const rows = await getDb()
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, ownerId))
        .limit(1);
      to = rows[0]?.email?.trim() ?? "";
    }
    if (!to) return c.json({ error: "no_email" }, 400);
    const { shouldNotify } = await import("../notify/prefs.js");
    const { unsubscribeUrl } = await import("../notify/unsubscribe.js");
    const owner = ownerId
      ? (
          await getDb()
            .select()
            .from(schema.users)
            .where(eq(schema.users.id, ownerId))
            .limit(1)
        )[0]
      : undefined;
    if (owner && !shouldNotify(owner.notifyPrefs, "confirmacion", "email")) {
      return c.json({ error: "prefs_disabled" }, 403);
    }
    {
      const muni =
        (await getMunicipalityBySlug(c.get("municipalitySlug"))) ?? null;
      const fac = await getFacility(booking.facilityId);
      const { formatDayChip } = await import("@pista-aberta/shared");
      const { sendRenderedMail } = await import("../notify/send-notice.js");
      const locale = owner?.locale === "es" ? "es" : "gl";
      await sendRenderedMail({
        to,
        muni,
        locale,
        kind: "booking_confirmed",
        data: {
          userName: booking.userDisplayName,
          sport: fac?.name ?? "Deporte",
          facilityName: fac?.name ?? "Instalación",
          facilityId: booking.facilityId,
          dayLabel: formatDayChip(booking.date, locale),
          timeLabel: booking.start,
          date: booking.date,
          start: booking.start,
          end: booking.end,
          shortCode: booking.shortCode,
          qrPayload: booking.qrPayload,
          bookingId: booking.id,
          icsSequence: booking.icsSequence ?? 0,
          unsubscribeUrl: owner ? unsubscribeUrl(owner.id) : undefined,
        },
        userId: owner?.id,
        withUnsubscribe: true,
      });
    }
    return c.json({ data: { ok: true, to } });
  },
);
/** CSV: escapar e prefijo ' contra fórmulas Excel (=, +, -, @). REVISION-43 R2. */
function csvCell(value: string): string {
  return csvEscapeCell(value);
}

completeRoutes.get(
  "/api/c/:slug/admin/export",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
  const mid = c.get("municipalityId");
  const fmt = c.req.query("format") ?? "json";
  /* Full JSON is an explicit portability backup, not an operational list. */
  if (fmt === "full" || fmt === "full-json") {
    const blocked = await assertDeputacionPersonalDataAllowed(c);
    if (blocked) return blocked;
    const { exportFullMunicipality } = await import("../store/muni-portability.js");
    const data = await exportFullMunicipality(mid);
    return c.json({ data });
  }
  /* REVISION-58 H4-resto: CSV/JSON acotado (1 ano atrás → 60 días). */
  const { localDateIso, addDaysIso, DEFAULT_TIMEZONE } = await import(
    "../store/business-rules.js"
  );
  const { getMunicipalityById } = await import("../store/db.js");
  const muni = await getMunicipalityById(mid);
  const tz =
    (muni?.settings as { timezone?: string } | undefined)?.timezone ??
    DEFAULT_TIMEZONE;
  const today = localDateIso(new Date(), tz);
  /* REVISION-59 L2: rango no nome do ficheiro (1 ano atrás → 60 días). */
  const requestedFrom = c.req.query("from");
  const requestedTo = c.req.query("to");
  const validIso = (value: string | undefined) =>
    value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
  const dateFrom = validIso(requestedFrom) ?? addDaysIso(today, -365);
  let dateTo = validIso(requestedTo) ?? addDaysIso(today, 60);
  if (
    new Date(`${dateTo}T00:00:00Z`).getTime() -
      new Date(`${dateFrom}T00:00:00Z`).getTime() >
    366 * 86_400_000
  ) {
    dateTo = addDaysIso(dateFrom, 366);
  }
  const page = boundedQuery(c);
  const { listBookingsForExport } = await import("../store/bounded-export.js");
  const bookings = await listBookingsForExport({
    municipalityId: mid,
    dateFrom,
    dateTo,
    limit: Math.min(1_000, Number(c.req.query("limit")) || 500),
    offset: page.offset,
  });
  if (fmt === "csv") {
    const header = "id,date,start,end,status,user,facility\n";
    const rows = bookings
      .map((b) => {
        // DD/MM/YYYY (sen ISO cru no CSV de exportación)
        const dmY = /^(\d{4})-(\d{2})-(\d{2})$/.exec(b.date);
        const dateLabel = dmY ? `${dmY[3]}/${dmY[2]}/${dmY[1]}` : b.date;
        return [
          csvCell(b.id),
          csvCell(dateLabel),
          csvCell(b.start),
          csvCell(b.end),
          csvCell(b.status),
          csvCell(b.userDisplayName),
          csvCell(b.facilityId),
        ].join(",");
      })
      .join("\n");
    const csvName = `reservas-${dateFrom}_${dateTo}.csv`;
    return c.text(header + rows, 200, {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${csvName}"`,
    });
  }
  return c.json({
    data: {
      bookings,
      facilities: await listFacilities(mid),
      openData: await exportOpenData(mid),
      audit: await listAudit(mid, page),
      waitlist: await listWaitlist(mid, page),
    },
  });
});
completeRoutes.get(
  "/api/c/:slug/admin/auditoria",
  municipalityMiddleware,
  requireMuniRoles("admin", { personalData: true }),
  async (c) => {
  return c.json({
    data: await listAudit(c.get("municipalityId"), {
      ...boundedQuery(c),
      actor: c.req.query("actor"),
    }),
  });
});
completeRoutes.get(
  "/api/c/:slug/admin/tempada",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
  return c.json({ data: await listSeasonSlots(c.get("municipalityId")) });
});

/* REVISION-58 K3 — retirar franxa de tempada */
completeRoutes.delete(
  "/api/c/:slug/admin/tempada/:id",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const { deleteSeasonSlot } = await import("../store/seasons.js");
    try {
      await deleteSeasonSlot(
        c.get("municipalityId"),
        c.req.param("id")!,
        c.get("user")!.displayName,
      );
      return c.json({ data: { ok: true } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      return c.json({ error: msg }, msg === "not_found" ? 404 : 400);
    }
  },
);

/* Persoal / conserxes — só admin */
completeRoutes.get(
  "/api/c/:slug/admin/persoal",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
  const { listStaffRows } = await import("../store/staff-users.js");
  return c.json({ data: await listStaffRows(c.get("municipalityId")) });
});
completeRoutes.post(
  "/api/c/:slug/admin/persoal",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
  const user = c.get("user")!;
  const body = await c.req.json<{
    displayName: string;
    email: string;
    role?: "staff" | "monitor";
    nif?: string;
  }>();
  try {
    const { inviteStaffUser } = await import("../store/staff-users.js");
    const row = await inviteStaffUser({
      municipalityId: c.get("municipalityId"),
      displayName: body.displayName,
      email: body.email,
      role: body.role,
      nif: body.nif,
      invitedBy: user.displayName,
    });
    await audit(
      c.get("municipalityId"),
      user.displayName,
      "staff.invite",
      `Invitou a ${row.displayName} <${row.email}>`,
    );
    return c.json({ data: row }, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    const status =
      msg === "email_invalid" || msg === "nif_invalid" ? 400 : 409;
    return c.json({ error: msg }, status);
  }
});
completeRoutes.post(
  "/api/c/:slug/admin/persoal/:id/revogar",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const user = c.get("user")!;
    try {
      const { revokeStaffUser } = await import("../store/staff-users.js");
      await revokeStaffUser(c.get("municipalityId"), c.req.param("id")!);
      await audit(
        c.get("municipalityId"),
        user.displayName,
        "staff.revoke",
        `Revogou acceso ${c.req.param("id")}`,
      );
      return c.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      return c.json({ error: msg }, 404);
    }
  },
);
completeRoutes.post(
  "/api/c/:slug/admin/persoal/:id/reactivar",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    try {
      const { reactivateStaffUser } = await import("../store/staff-users.js");
      const row = await reactivateStaffUser(
        c.get("municipalityId"),
        c.req.param("id")!,
      );
      return c.json({ data: row });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      return c.json({ error: msg }, 404);
    }
  },
);

/* Clubs — admin crea club + conta única */
completeRoutes.get(
  "/api/c/:slug/admin/clubs",
  municipalityMiddleware,
  requireMuniRoles("admin", { personalData: true }),
  async (c) => {
  return c.json({ data: await listClubAccounts(c.get("municipalityId")) });
});
completeRoutes.post(
  "/api/c/:slug/admin/clubs",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
  const user = c.get("user")!;
  const body = await c.req.json<{
    name: string;
    shortName?: string;
    accountEmail: string;
    accountDisplayName?: string;
  }>();
  try {
    const row = await createClubWithAccount({
      municipalityId: c.get("municipalityId"),
      name: body.name,
      shortName: body.shortName,
      accountEmail: body.accountEmail,
      accountDisplayName: body.accountDisplayName,
    });
    await audit(
      c.get("municipalityId"),
      user.displayName,
      "club.create",
      `Club ${row.name} · conta ${row.account?.email}`,
    );
    return c.json({ data: row }, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    const status = msg === "email_invalid" || msg === "name_required" ? 400 : 409;
    return c.json({ error: msg }, status);
  }
});
completeRoutes.put(
  "/api/c/:slug/admin/clubs/:id",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const user = c.get("user")!;
    const body = z
      .object({
        name: z.string().min(1).max(120).optional(),
        shortName: z.string().max(32).optional(),
        active: z.boolean().optional(),
        reinviteEmail: z.string().email().optional(),
        cif: z.string().max(32).optional().nullable(),
        sport: z.string().max(80).optional().nullable(),
        email: z.string().email().optional().nullable(),
      })
      .parse(await c.req.json());
    try {
      const mid = c.get("municipalityId");
      const clubId = c.req.param("id")!;
      if (
        body.cif !== undefined ||
        body.sport !== undefined ||
        body.email !== undefined
      ) {
        const { updateClubEntity } = await import("../store/club-members.js");
        await updateClubEntity(mid, clubId, {
          cif: body.cif,
          sport: body.sport,
          email: body.email,
          name: body.name,
          shortName: body.shortName,
        });
      }
      const row = await updateClubAccount(mid, clubId, body);
      await audit(
        mid,
        user.displayName,
        "club.update",
        `Club ${row.name}`,
      );
      return c.json({ data: row });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      return c.json(
        { error: msg },
        msg === "not_found" ? 404 : msg === "email_invalid" ? 400 : 409,
      );
    }
  },
);

/* REVISION-22 B3 — responsables do club */
completeRoutes.get(
  "/api/c/:slug/admin/clubs/:id/responsables",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const { listClubResponsables } = await import("../store/club-members.js");
    try {
      return c.json({
        data: await listClubResponsables(
          c.req.param("id")!,
          c.get("municipalityId"),
        ),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      return c.json({ error: msg }, msg === "not_found" ? 404 : 400);
    }
  },
);
completeRoutes.post(
  "/api/c/:slug/admin/clubs/:id/responsables",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const user = c.get("user")!;
    const body = await c.req.json<{
      userId?: string;
      email?: string;
      displayName?: string;
      nif?: string;
      role?: "manager" | "coach";
    }>();
    try {
      const { addClubResponsable } = await import("../store/club-members.js");
      const row = await addClubResponsable({
        municipalityId: c.get("municipalityId"),
        clubId: c.req.param("id")!,
        userId: body.userId,
        email: body.email,
        displayName: body.displayName,
        nif: body.nif,
        role: body.role,
        actor: user.displayName,
      });
      return c.json({ data: row }, 201);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      const status =
        msg === "not_found" || msg === "user_not_found"
          ? 404
          : msg === "already_member"
            ? 409
            : 400;
      return c.json({ error: msg }, status);
    }
  },
);
completeRoutes.delete(
  "/api/c/:slug/admin/clubs/:id/responsables/:memberId",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const user = c.get("user")!;
    try {
      const { removeClubResponsable } = await import("../store/club-members.js");
      await removeClubResponsable({
        municipalityId: c.get("municipalityId"),
        clubId: c.req.param("id")!,
        memberId: c.req.param("memberId")!,
        actor: user.displayName,
      });
      return c.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      return c.json({ error: msg }, msg === "not_found" ? 404 : 400);
    }
  },
);

/* REVISION-22 B4 — Tempadas CRUD */
completeRoutes.get(
  "/api/c/:slug/admin/tempadas",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const { listSeasons } = await import("../store/seasons.js");
    return c.json({ data: await listSeasons(c.get("municipalityId")) });
  },
);
completeRoutes.post(
  "/api/c/:slug/admin/tempadas",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const user = c.get("user")!;
    const parsed = seasonCreateBodySchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return c.json(
        { error: "validation_error", issues: parsed.error.issues },
        400,
      );
    }
    const body = parsed.data;
    try {
      const { createSeason } = await import("../store/seasons.js");
      const row = await createSeason({
        municipalityId: c.get("municipalityId"),
        name: body.name,
        startsAt: body.startsAt,
        endsAt: body.endsAt,
        facilityIds: body.facilityIds,
        criteriaGl: body.criteriaGl,
        criteriaEs: body.criteriaEs,
        published: body.published,
        actor: user.displayName,
      });
      return c.json({ data: row }, 201);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      return c.json({ error: msg }, seasonErrorStatus(msg));
    }
  },
);
completeRoutes.put(
  "/api/c/:slug/admin/tempadas/:id",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const user = c.get("user")!;
    const parsed = seasonUpdateBodySchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return c.json(
        { error: "validation_error", issues: parsed.error.issues },
        400,
      );
    }
    const body = parsed.data;
    try {
      const { updateSeason } = await import("../store/seasons.js");
      const row = await updateSeason(c.get("municipalityId"), c.req.param("id")!, {
        ...body,
        actor: user.displayName,
      });
      return c.json({ data: row });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      return c.json({ error: msg }, seasonErrorStatus(msg));
    }
  },
);
completeRoutes.delete(
  "/api/c/:slug/admin/tempadas/:id",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const user = c.get("user")!;
    try {
      const { deleteSeason } = await import("../store/seasons.js");
      await deleteSeason(
        c.get("municipalityId"),
        c.req.param("id")!,
        user.displayName,
      );
      return c.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      return c.json({ error: msg }, msg === "not_found" ? 404 : 400);
    }
  },
);

/* REVISION-22 B4 — ICS do club con RRULE das franxas de tempada */
completeRoutes.get(
  "/api/c/:slug/clubs/:clubId/tempada.ics",
  municipalityMiddleware,
  requireMuniRoles("club_manager", "admin"),
  async (c) => {
    const user = c.get("user")!;
    const mid = c.get("municipalityId");
    const clubId = c.req.param("clubId")!;
    if (!clubAccountOwnsClub(user, clubId, mid)) {
      return c.json({ error: "forbidden", reason: "wrong_club" }, 403);
    }
    const {
      listSeasonSlotsForClub,
      seasonSlotRrule,
      firstWeekdayOnOrAfter,
    } = await import("../store/seasons.js");
    const { EUROPE_MADRID_VTIMEZONE, dtStampUtc, toIcsLocalStamp } =
      await import("../lib/booking-ics.js");
    const club = await getClub(clubId);
    const slots = await listSeasonSlotsForClub(mid, clubId);
    const stamp = dtStampUtc();
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Pista Aberta//Club tempada//GL",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      ...EUROPE_MADRID_VTIMEZONE,
    ];
    let events = 0;
    for (const s of slots) {
      const season = s.season;
      /* REVISION-23 R8: sen tempada → non exportar a franxa. */
      if (!season?.startsAt || !season?.endsAt) continue;
      const startDate = firstWeekdayOnOrAfter(season.startsAt, s.weekday);
      if (startDate > season.endsAt) continue;
      const until = season.endsAt;
      const dtStart = toIcsLocalStamp(startDate, s.start);
      const dtEnd = toIcsLocalStamp(startDate, s.end);
      const rrule = seasonSlotRrule({ weekday: s.weekday, untilDate: until });
      lines.push(
        "BEGIN:VEVENT",
        `UID:season-slot-${s.id}@pistaaberta.com`,
        `DTSTAMP:${stamp}`,
        `DTSTART;TZID=Europe/Madrid:${dtStart}`,
        `DTEND;TZID=Europe/Madrid:${dtEnd}`,
        `RRULE:${rrule}`,
        `SUMMARY:${(club?.shortName ?? "Club").replace(/[,;]/g, "")} · tempada`,
        `DESCRIPTION:Franxa de tempada`,
        "END:VEVENT",
      );
      events += 1;
    }
    lines.push("END:VCALENDAR");
    if (events === 0) {
      return c.text("", 404, { "Content-Type": "text/plain; charset=utf-8" });
    }
    return c.text(lines.join("\r\n"), 200, {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="tempada-${clubId}.ics"`,
    });
  },
);

/* Datos abertos — REVISION-21 Q5 + REVISION-60 N10 (non confiar en X-Forwarded-Host) */
function publicBaseUrl(c: { req: { url: string; header: (n: string) => string | undefined } }): string {
  const configured =
    process.env.APP_BASE_URL?.trim() || process.env.API_BASE_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      /* fallback ao URL da petición */
    }
  }
  const reqUrl = new URL(c.req.url);
  const rawProto = isTrustProxy() ? c.req.header("x-forwarded-proto") : undefined;
  const proto =
    rawProto === "https" || rawProto === "http"
      ? rawProto
      : reqUrl.protocol.replace(":", "");
  const rawHost = c.req.header("host")?.trim();
  const host =
    rawHost && /^[a-zA-Z0-9.-]+(?::\d{1,5})?$/.test(rawHost)
      ? rawHost
      : reqUrl.host || "localhost";
  return `${proto}://${host}`;
}

completeRoutes.get("/api/c/:slug/datos-abertos", municipalityMiddleware, async (c) => {
  const mid = c.get("municipalityId");
  const { openDataPayload } = await import("../store/open-data.js");
  try {
    const data = await openDataPayload(mid);
    return c.json({ data });
  } catch {
    return c.json({ error: "not_found" }, 404);
  }
});
completeRoutes.get(
  "/api/c/:slug/datos-abertos/instalacions.geojson",
  municipalityMiddleware,
  async (c) => {
    const open = await exportOpenData(c.get("municipalityId"));
    return c.json(open.geojson);
  },
);
completeRoutes.get(
  "/api/c/:slug/datos-abertos/instalacions.csv",
  municipalityMiddleware,
  async (c) => {
    const mid = c.get("municipalityId");
    const facilities = await listFacilities(mid);
    const { facilitiesCatalogCsv } = await import("../store/open-data.js");
    const csv = facilitiesCatalogCsv(facilities);
    return c.text(csv, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="instalacions.csv"',
    });
  },
);
completeRoutes.get(
  "/api/c/:slug/datos-abertos/instalacions.jsonld",
  municipalityMiddleware,
  async (c) => {
    const mid = c.get("municipalityId");
    const muni = await getMunicipalityById(mid);
    if (!muni) return c.json({ error: "not_found" }, 404);
    const facilities = await listFacilities(mid);
    const { facilitiesSchemaOrgJsonLd } = await import("../store/open-data.js");
    const body = facilitiesSchemaOrgJsonLd(
      { name: muni.name, slug: muni.slug },
      facilities,
      publicBaseUrl(c),
    );
    return c.json(body, 200, { "Content-Type": "application/ld+json" });
  },
);
completeRoutes.get(
  "/api/c/:slug/datos-abertos/ocupacion.json",
  municipalityMiddleware,
  async (c) => {
    const { occupancyAggregate } = await import("../store/open-data.js");
    const data = await occupancyAggregate(c.get("municipalityId"));
    return c.json({ data });
  },
);
completeRoutes.get(
  "/api/c/:slug/datos-abertos/ocupacion.csv",
  municipalityMiddleware,
  async (c) => {
    const { occupancyAggregate, occupancyAggregateCsv } = await import(
      "../store/open-data.js"
    );
    const rows = await occupancyAggregate(c.get("municipalityId"));
    return c.text(occupancyAggregateCsv(rows), 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="ocupacion.csv"',
    });
  },
);
completeRoutes.get(
  "/api/c/:slug/datos-abertos/dcat.jsonld",
  municipalityMiddleware,
  async (c) => {
    const mid = c.get("municipalityId");
    const muni = await getMunicipalityById(mid);
    if (!muni) return c.json({ error: "not_found" }, 404);
    const { dcatApEsJsonLd, resolveOpenDataMeta } = await import(
      "../store/open-data.js"
    );
    const meta = resolveOpenDataMeta(muni.settings);
    const body = dcatApEsJsonLd({
      muni: { id: muni.id, slug: muni.slug, name: muni.name },
      license: meta.license,
      dir3: meta.dir3,
      catalogPublisher: meta.catalogPublisher,
      baseUrl: publicBaseUrl(c),
    });
    return c.json(body, 200, { "Content-Type": "application/ld+json" });
  },
);

/* Alta completa — só Deputación (REVISION-29 Y14). */
completeRoutes.post("/api/municipalities/wizard", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "unauthorized" }, 401);
  if (user.role !== "superadmin") return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json<{
    name: string;
    slug: string;
    ine?: string;
    accentColor?: string;
    accent?: string;
    theme?: { brand?: string; accent?: string };
    dir3?: string;
    markedFacilities?: string[];
    schedule?: Record<string, { open: string; close: string }>;
    norms?: { rule1?: boolean; rule2?: boolean; rule3?: boolean };
    facilityName?: string;
    adminEmail?: string;
    adminDisplayName?: string;
    adminNif?: string;
    legalEmail?: string;
    facilityNames?: Record<string, string>;
  }>();
  const slug = (body.slug ?? "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!body.name?.trim() || !slug) return c.json({ error: "invalid" }, 400);
  try {
    assertMunicipalityCreateRateLimit();
    const sandbox = false;
    const { createMunicipalityFromWizard, createMunicipalityFull } = await import(
      "../store/municipality-launch.js"
    );
    if (body.markedFacilities?.length || body.ine || body.schedule) {
      const brand =
        body.theme?.brand ?? body.accentColor ?? undefined;
      const m = await createMunicipalityFromWizard({
        name: body.name.trim(),
        slug,
        ine: body.ine ?? slug,
        accentColor: brand,
        dir3: body.dir3,
        markedFacilities:
          body.markedFacilities ??
          (body.facilityName ? [body.facilityName] : ["Pista municipal"]),
        facilityNames: body.facilityNames,
        schedule: body.schedule ?? { pista: { open: "09:00", close: "22:00" } },
        norms: body.norms ?? {},
        adminEmail: body.adminEmail,
        adminDisplayName: body.adminDisplayName,
        adminNif: body.adminNif,
        legalEmail: body.legalEmail,
        sandbox,
        createdBy: user?.displayName ?? "sandbox",
      });
      await audit(
        m.id,
        "wizard",
        "municipality.create",
        `Alta de ${m.name}; sandbox=${sandbox}`,
      );
      return c.json({ data: m, sandbox }, 201);
    }
    const brand = body.theme?.brand ?? body.accentColor ?? "#5A4636";
    const m = await createMunicipalityFull({
      name: body.name.trim(),
      slug,
      accentColor: brand,
      accent: body.theme?.accent ?? body.accent,
      theme: body.theme ?? { brand, accent: body.accent ?? brand },
      facilityName: body.facilityName,
      adminEmail: body.adminEmail,
      adminDisplayName: body.adminDisplayName,
      adminNif: body.adminNif,
      sandbox,
    });
    await audit(
      m.id,
      "wizard",
      "municipality.create",
      `Alta de ${m.name}; admin=${m.admin?.email ?? "?"}; sandbox=${sandbox}`,
    );
    return c.json({ data: m, sandbox }, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    if (msg === "rate_limited") return c.json({ error: "rate_limited" }, 429);
    /* REVISION-38 K3 */
    if (msg === "nif_required" || msg === "nif_invalid") {
      return c.json({ error: msg }, 400);
    }
    if (msg === "slug_exists") {
      const { getMunicipalityBySlug } = await import("../store/db.js");
      const existing = await getMunicipalityBySlug(slug);
      return c.json(
        {
          error: "slug_exists",
          slug,
          name: existing?.name ?? body.name?.trim(),
        },
        409,
      );
    }
    return c.json({ error: msg }, 500);
  }
});

completeRoutes.get("/api/deputacion/concellos", requireAuth, async (c) => {
  const user = c.get("user")!;
  if (user.role !== "superadmin") return c.json({ error: "forbidden" }, 403);
  const { listDeputacionConcellos } = await import("../store/municipality-launch.js");
  const data = await listDeputacionConcellos();
  return c.json({ data });
});

completeRoutes.post("/api/deputacion/concellos/:slug/convite", requireAuth, async (c) => {
  const user = c.get("user")!;
  if (user.role !== "superadmin") return c.json({ error: "forbidden" }, 403);
  const slug = c.req.param("slug")!;
  const body = z
    .object({
      email: z.string().email(),
      nif: z.string().min(1),
      name: z.string().optional(),
    })
    .parse(await c.req.json());
  const { getMunicipalityBySlug } = await import("../store/db.js");
  const muni = await getMunicipalityBySlug(slug);
  if (!muni) return c.json({ error: "not_found" }, 404);
  try {
    const { createInvitation } = await import("../store/invitations.js");
    const inv = await createInvitation({
      municipalityId: muni.id,
      role: "admin",
      email: body.email,
      nif: body.nif,
      displayName: body.name,
      createdBy: user.displayName,
    });
    return c.json({ data: inv }, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    if (msg === "nif_required" || msg === "nif_invalid") {
      return c.json({ error: msg }, 400);
    }
    throw e;
  }
});

/** REVISION-31 A3 — só { exists }; sen nome/correo; rate limit + auditoría. */
completeRoutes.get("/api/deputacion/nif-lookup", requireAuth, async (c) => {
  const user = c.get("user")!;
  if (user.role !== "superadmin") return c.json({ error: "forbidden" }, 403);
  const nif = (c.req.query("nif") ?? "").trim();
  if (!nif) return c.json({ data: { exists: false } });
  try {
    const { assertLoginRateLimit, LoginRateLimitedError, clientIpFromContext } =
      await import("../identity/login-rate-limit.js");
    try {
      await assertLoginRateLimit(
        `nif-lookup:${user.id}:${clientIpFromContext(c)}`,
      );
    } catch (e) {
      if (e instanceof LoginRateLimitedError) {
        return c.json(
          { error: "rate_limited", retryAfterMinutes: e.retryAfterMinutes },
          429,
        );
      }
      throw e;
    }
    const { toPersonIdentifier } = await import("../lib/nif.js");
    const pid = toPersonIdentifier(nif);
    const { getDb } = await import("../db/client.js");
    const schema = await import("../db/schema.js");
    const { eq } = await import("drizzle-orm");
    const rows = await getDb()
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.personIdentifier, pid))
      .limit(1);
    const exists = !!rows[0];
    const { DEPUTACION_PLATFORM_MUNI_ID } = await import(
      "../store/deputacion-org.js"
    );
    await audit(
      DEPUTACION_PLATFORM_MUNI_ID,
      user.displayName,
      "deputacion.nif_lookup",
      exists ? "exists=1" : "exists=0",
    );
    return c.json({ data: { exists } });
  } catch {
    return c.json({ data: { exists: false } });
  }
});

completeRoutes.post(
  "/api/deputacion/concellos/:slug/convite/revogar",
  requireAuth,
  async (c) => {
    const user = c.get("user")!;
    if (user.role !== "superadmin") return c.json({ error: "forbidden" }, 403);
    const { getMunicipalityBySlug } = await import("../store/db.js");
    const muni = await getMunicipalityBySlug(c.req.param("slug")!);
    if (!muni) return c.json({ error: "not_found" }, 404);
    const { revokeAdminInvite } = await import("../store/municipality-launch.js");
    await revokeAdminInvite(muni.id, user.displayName);
    return c.json({ ok: true });
  },
);

completeRoutes.post(
  "/api/deputacion/concellos/:slug/admin/revogar",
  requireAuth,
  async (c) => {
    const user = c.get("user")!;
    if (user.role !== "superadmin") return c.json({ error: "forbidden" }, 403);
    const body = z.object({ reason: z.string().min(3).max(500) }).parse(await c.req.json());
    const { getMunicipalityBySlug } = await import("../store/db.js");
    const muni = await getMunicipalityBySlug(c.req.param("slug")!);
    if (!muni) return c.json({ error: "not_found" }, 404);
    const { retirarAdminAccess } = await import("../store/municipality-launch.js");
    await retirarAdminAccess(muni.id, user.displayName, body.reason);
    return c.json({ ok: true });
  },
);

completeRoutes.get("/api/deputacion/org", requireAuth, async (c) => {
  const user = c.get("user")!;
  if (user.role !== "superadmin") return c.json({ error: "forbidden" }, 403);
  const { getDeputacionOrganization } = await import("../store/deputacion-org.js");
  const org = await getDeputacionOrganization();
  if (!org) return c.json({ data: null });
  return c.json({ data: org });
});

/* REVISION-39 L6 — editar correo de contacto da Deputación. */
completeRoutes.patch("/api/deputacion/org", requireAuth, async (c) => {
  const user = c.get("user")!;
  if (user.role !== "superadmin") return c.json({ error: "forbidden" }, 403);
  const body = z
    .object({
      email: z.string().email().optional(),
      name: z.string().min(1).optional(),
    })
    .safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: "email_invalid" }, 400);
  try {
    const { updateDeputacionOrganization } = await import(
      "../store/deputacion-org.js"
    );
    const data = await updateDeputacionOrganization(body.data);
    return c.json({ data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    if (msg === "no_deputacion_org") return c.json({ error: msg }, 404);
    if (msg === "email_invalid") return c.json({ error: msg }, 400);
    throw e;
  }
});

completeRoutes.get("/api/deputacion/persoas", requireAuth, async (c) => {
  const user = c.get("user")!;
  if (user.role !== "superadmin") return c.json({ error: "forbidden" }, 403);
  const { listDeputacionManagers } = await import("../store/deputacion-org.js");
  return c.json({ data: await listDeputacionManagers() });
});

completeRoutes.post("/api/deputacion/persoas/convite", requireAuth, async (c) => {
  const user = c.get("user")!;
  if (user.role !== "superadmin") return c.json({ error: "forbidden" }, 403);
  const body = z
    .object({
      email: z.string().email(),
      nif: z.string().min(1),
      name: z.string().optional(),
    })
    .safeParse(await c.req.json());
  if (!body.success) {
    return c.json({ error: "nif_invalid" }, 400);
  }
  const { inviteDeputacionManager } = await import("../store/deputacion-org.js");
  try {
    const inv = await inviteDeputacionManager({
      email: body.data.email,
      nif: body.data.nif,
      name: body.data.name,
      createdBy: user.displayName,
    });
    return c.json({ data: inv }, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    if (msg === "no_deputacion_org") return c.json({ error: "no_org" }, 400);
    /* REVISION-34 F2 */
    if (msg === "nif_invalid" || msg === "nif_required") {
      return c.json({ error: "nif_invalid" }, 400);
    }
    throw e;
  }
});

completeRoutes.post("/api/deputacion/persoas/:userId/revogar", requireAuth, async (c) => {
  const user = c.get("user")!;
  if (user.role !== "superadmin") return c.json({ error: "forbidden" }, 403);
  if (user.id === c.req.param("userId")) {
    return c.json({ error: "cannot_revoke_self" }, 400);
  }
  const { retirarDeputacionManager } = await import("../store/deputacion-org.js");
  try {
    await retirarDeputacionManager(c.req.param("userId")!, user.displayName);
    return c.json({ ok: true });
  } catch {
    return c.json({ error: "not_found" }, 404);
  }
});

completeRoutes.post(
  "/api/c/:slug/admin/publicar",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const user = c.get("user")!;
    const { publishPortal } = await import("../store/municipality-launch.js");
    const result = await publishPortal(c.get("municipalityId"), user.displayName);
    if (!result.ok) return c.json({ error: "incomplete", missing: result.missing }, 400);
    return c.json({ ok: true });
  },
);

/* OpenAPI 3.1 + docs HTML (Rev4 certame) */
completeRoutes.get("/api/openapi.json", async (c) => {
  const { openApiDocument } = await import("../openapi.js");
  return c.json(openApiDocument);
});

completeRoutes.get("/api/docs", (c) => {
  return c.html(`<!doctype html><html lang="gl"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>API · Pista Aberta</title>
<style>
@font-face{font-family:"Atkinson Hyperlegible";src:url("/fonts/AtkinsonHyperlegible-Regular.woff2") format("woff2");font-weight:400;font-display:swap}
@font-face{font-family:"Atkinson Hyperlegible";src:url("/fonts/AtkinsonHyperlegible-Bold.woff2") format("woff2");font-weight:700;font-display:swap}
:root{--pa-bg:#F4F7FA;--pa-ink:#0F1E2C;--pa-graphite:#4A5B6B;--pa-azul:#007BC4;--pa-azul-700:#005A93;--pa-marino:#002B4A;--pa-line:#D8E3EC}
body{font-family:"Atkinson Hyperlegible",system-ui,sans-serif;max-width:52rem;margin:2rem auto;padding:0 1rem;background:var(--pa-bg);color:var(--pa-ink)}
h1{color:var(--pa-marino);letter-spacing:-0.02em}
a{color:var(--pa-azul-700)} a:hover{color:var(--pa-marino)}
code{background:#E6F2FA;padding:2px 6px;border-radius:4px;border:1px solid var(--pa-line)}
li{margin:.35rem 0} h2{margin-top:1.75rem;color:var(--pa-marino);font-size:1.15rem}
</style></head>
<body><h1>Documentación API</h1>
<p>Spec OpenAPI 3.1: <a href="/api/openapi.json"><code>/api/openapi.json</code></a>.
Persistencia: <strong>Drizzle + ${getDbMode() === "postgres" ? "PostgreSQL" : "PGlite (dev)"}</strong>.</p>
<h2>Públicos</h2>
<ul>
  <li><code>GET /health</code></li>
  <li><code>GET /api/municipalities</code></li>
  <li><code>GET /api/c/:slug/facilities</code></li>
  <li><code>GET /api/c/:slug/availability</code></li>
  <li><code>GET /api/c/:slug/fin-de-semana</code> · <code>.ics</code></li>
  <li><code>GET /api/c/:slug/datos-abertos</code> · GeoJSON</li>
  <li><code>GET /api/c/:slug/actividades</code></li>
  <li><code>GET /api/openapi.json</code></li>
</ul>
<h2>Auth</h2>
<ul>
  <li><code>POST /auth/login</code> saml | email_otp</li>
  <li><code>GET /auth/saml/mock-idp</code></li>
  <li><code>POST /auth/otp/verify</code></li>
</ul>
<h2>Autenticados</h2>
<ul>
  <li><code>POST /api/c/:slug/reservas</code> · check-in · admin · clubs · avisos · familia</li>
  <li><code>POST /api/demo/reset</code> (só PA_DEMO · superadmin Deputación)</li>
  <li><code>GET /api/demo/reset</code> (última restauración)</li>
</ul>
<p><a href="/demo">Guía do xurado</a> · <a href="/correo/">Bandexa Mailpit</a> · <a href="/">Volver</a></p></body></html>`);
});

/** CORREOS §8 — últimos correos da demo (só PA_DEMO; a UI do xurado usa Mailpit /correo/).
 * REVISION-50 S5: só Deputación, ou só os do propio correo. */
completeRoutes.get("/api/demo/correos", requireAuth, async (c) => {
  const pa =
    process.env.PA_DEMO === "1" || process.env.PA_DEMO === "true";
  if (!pa) return c.json({ error: "demo_only" }, 403);
  const user = c.get("user")!;
  const { listDemoEmails } = await import("../notify/emails/index.js");
  const qTo = c.req.query("to") ?? undefined;
  const userId = c.req.query("userId") ?? undefined;
  if (user.role === "superadmin") {
    return c.json({ data: listDemoEmails({ to: qTo, userId, limit: 40 }) });
  }
  const own = (user.email ?? "").trim().toLowerCase();
  if (!own) return c.json({ error: "forbidden" }, 403);
  if (qTo && qTo.trim().toLowerCase() !== own) {
    return c.json({ error: "forbidden" }, 403);
  }
  return c.json({
    data: listDemoEmails({ to: own, userId: user.id, limit: 40 }),
  });
});

/** REVISION-33 D2 — última restauración (só PA_DEMO). */
completeRoutes.get("/api/demo/reset", requireAuth, async (c) => {
  if (!isDemoMode()) return c.json({ error: "demo_only" }, 403);
  const user = c.get("user")!;
  if (user.role !== "superadmin") {
    return c.json({ error: "forbidden" }, 403);
  }
  const at = await getLastDemoResetAt();
  return c.json({ data: { at } });
});

completeRoutes.post("/api/demo/reset", requireAuth, async (c) => {
  if (!isDemoMode()) return c.json({ error: "demo_only" }, 403);
  const user = c.get("user")!;
  /* REVISION-33 D2: só Deputación (superadmin), non admin de concello. */
  if (user.role !== "superadmin") {
    return c.json({ error: "forbidden" }, 403);
  }
  try {
    const data = await resetDemoData(user.displayName);
    return c.json({ data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return c.json({ error: msg }, 400);
  }
});

completeRoutes.get("/api/demo/snapshot", requireAuth, async (c) => {
  if (!isDemoMode()) return c.json({ error: "demo_only" }, 403);
  const user = c.get("user")!;
  if (user.role !== "superadmin") {
    return c.json({ error: "forbidden" }, 403);
  }
  const base = getDemoSnapshotStatus();
  const lastRestoreError = await getDemoRestoreLastError();
  return c.json({ data: { ...base, lastRestoreError } });
});

completeRoutes.post("/api/demo/snapshot", requireAuth, async (c) => {
  if (!isDemoMode()) return c.json({ error: "demo_only" }, 403);
  const user = c.get("user")!;
  if (user.role !== "superadmin") {
    return c.json({ error: "forbidden" }, 403);
  }
  try {
    const data = await saveDemoSnapshot(user.displayName);
    return c.json({ data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    if (msg === "snapshot_locked") {
      return c.json({ error: "snapshot_locked" }, 403);
    }
    return c.json({ error: msg }, 400);
  }
});

/* Rev3 D2 — Avisarme se se libera */
completeRoutes.post(
  "/api/c/:slug/lista-espera",
  municipalityMiddleware,
  requireAuth,
  requireSameMunicipality(),
  async (c) => {
    const user = c.get("user")!;
    const body = z.object({ slotId: z.string().min(1) }).parse(await c.req.json());
    const { addWaitlist } = await import("../store/extra.js");
    try {
      const data = await addWaitlist({
        municipalityId: c.get("municipalityId"),
        slotId: body.slotId,
        userId: user.id,
        userDisplayName: user.displayName,
      });
      return c.json({ data }, 201);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      const status =
        msg === "waitlist_duplicate" || msg === "waitlist_limit" || msg === "already_booked"
          ? 409
          : msg === "slot_not_found"
            ? 404
            : 400;
      return c.json({ error: msg }, status);
    }
  },
);

completeRoutes.delete(
  "/api/c/:slug/lista-espera/:slotId",
  municipalityMiddleware,
  requireAuth,
  requireSameMunicipality(),
  async (c) => {
    const user = c.get("user")!;
    const { leaveWaitlist } = await import("../store/extra.js");
    try {
      await leaveWaitlist(c.get("municipalityId"), user.id, c.req.param("slotId")!);
      return c.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      return c.json({ error: msg }, msg === "not_found" ? 404 : 400);
    }
  },
);

completeRoutes.get("/api/me/lista-espera", requireAuth, async (c) => {
  const user = c.get("user")!;
  const { listMyWaitlist } = await import("../store/extra.js");
  const data = await listMyWaitlist(user.municipalityId, user.id);
  return c.json({ data });
});

/** Lista de espera do concello da URL (illamento multi-concello). */
completeRoutes.get(
  "/api/c/:slug/lista-espera",
  municipalityMiddleware,
  requireSameMunicipality(),
  async (c) => {
    const user = c.get("user")!;
    const { listMyWaitlist } = await import("../store/extra.js");
    const data = await listMyWaitlist(c.get("municipalityId"), user.id);
    return c.json({ data });
  },
);

/* Rev3 D1 — Incidencias */
completeRoutes.post(
  "/api/c/:slug/incidencias",
  municipalityMiddleware,
  requireAuth,
  requireSameMunicipality(),
  async (c) => {
    const user = c.get("user")!;
    const body = z
      .object({
        facilityId: z.string().optional(),
        body: z.string().min(5).max(2000),
        photoDataUrl: z.string().max(700_000).optional().nullable(),
      })
      .parse(await c.req.json());
    const { createIncident } = await import("../store/incidents.js");
    try {
      const data = await createIncident(c.get("municipalityId"), user, body);
      return c.json({ data }, 201);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      return c.json({ error: msg }, msg === "not_found" ? 404 : 400);
    }
  },
);

completeRoutes.get(
  "/api/c/:slug/admin/incidencias",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const { listIncidents, openIncidentsCount } = await import("../store/incidents.js");
    const status = c.req.query("estado") || undefined;
    const data = await listIncidents(c.get("municipalityId"), {
      ...boundedQuery(c),
      status,
      userId: c.req.query("userId"),
    });
    const open = await openIncidentsCount(c.get("municipalityId"));
    return c.json({ data, open });
  },
);

completeRoutes.get(
  "/api/c/:slug/admin/incidencias/:id",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const { getIncident } = await import("../store/incidents.js");
    const data = await getIncident(
      c.get("municipalityId"),
      c.req.param("id")!,
    );
    return data ? c.json({ data }) : c.json({ error: "not_found" }, 404);
  },
);

completeRoutes.post(
  "/api/c/:slug/admin/incidencias/:id/resolver",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const { resolveIncident } = await import("../store/incidents.js");
    try {
      const data = await resolveIncident(
        c.get("municipalityId"),
        c.req.param("id")!,
        c.get("user")!.displayName,
      );
      return c.json({ data });
    } catch {
      return c.json({ error: "not_found" }, 404);
    }
  },
);

completeRoutes.post(
  "/api/c/:slug/admin/incidencias/:id/estado",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const body = z
      .object({ status: z.enum(["open", "in_progress", "done"]) })
      .parse(await c.req.json());
    const { setIncidentStatus } = await import("../store/incidents.js");
    try {
      const data = await setIncidentStatus(
        c.get("municipalityId"),
        c.req.param("id")!,
        body.status,
        c.get("user")!.displayName,
      );
      return c.json({ data });
    } catch {
      return c.json({ error: "not_found" }, 404);
    }
  },
);

completeRoutes.post(
  "/api/c/:slug/admin/reservas/:id/cancelar",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const body = z
      .object({ reason: z.string().max(500).optional() })
      .parse(await c.req.json().catch(() => ({})));
    const { adminCancelBooking } = await import("../store/rev4-ops.js");
    try {
      const data = await adminCancelBooking(
        c.get("municipalityId"),
        c.req.param("id")!,
        c.get("user")!,
        body.reason ?? "",
      );
      return c.json({ data });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      return c.json({ error: msg }, msg === "not_found" ? 404 : 400);
    }
  },
);

completeRoutes.post(
  "/api/c/:slug/admin/reservas/:id/non-presentado",
  municipalityMiddleware,
  requireMuniRoles("admin", "staff"),
  async (c) => {
    const { markNoShow } = await import("../store/rev4-ops.js");
    try {
      const data = await markNoShow(
        c.get("municipalityId"),
        c.req.param("id")!,
        c.get("user")!.displayName,
      );
      return c.json({ data });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      return c.json({ error: msg }, msg === "not_found" ? 404 : 400);
    }
  },
);

completeRoutes.post(
  "/api/c/:slug/reservas/:id/estou-aqui",
  municipalityMiddleware,
  requireAuth,
  requireSameMunicipality(),
  async (c) => {
    const { selfCheckIn } = await import("../store/rev4-ops.js");
    try {
      const data = await selfCheckIn(
        c.get("municipalityId"),
        c.get("user")!.id,
        c.req.param("id")!,
      );
      return c.json({ data });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      const status =
        msg === "forbidden" ? 403 : msg === "not_found" ? 404 : 400;
      return c.json({ error: msg }, status);
    }
  },
);

completeRoutes.get(
  "/api/c/:slug/porta/:facilityId/codigo",
  municipalityMiddleware,
  requireMuniRoles("admin", "staff"),
  async (c) => {
    const { dailyDoorCode, doorCheckUrl } = await import("../store/rev4-ops.js");
    const { assertFacilityInMuni } = await import("../store/tenancy-assert.js");
    const muni = await getMunicipalityById(c.get("municipalityId"));
    const date =
      c.req.query("date") ??
      localDateIso(new Date(), muni?.settings.timezone ?? DEFAULT_TIMEZONE);
    const facilityId = c.req.param("facilityId")!;
    try {
      await assertFacilityInMuni(c.get("municipalityId"), facilityId);
    } catch {
      return c.json({ error: "not_found" }, 404);
    }
    const code = dailyDoorCode(facilityId, date);
    const base = process.env.APP_BASE_URL ?? "";
    return c.json({
      data: {
        date,
        code,
        url: doorCheckUrl(c.req.param("slug")!, facilityId, date, base),
      },
    });
  },
);

completeRoutes.post(
  "/api/c/:slug/porta/:facilityId/checkin",
  municipalityMiddleware,
  requireAuth,
  requireSameMunicipality(),
  async (c) => {
    const body = z
      .object({
        code: z.string().min(4),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(await c.req.json());
    const { doorSelfCheckIn } = await import("../store/rev4-ops.js");
    try {
      const data = await doorSelfCheckIn(
        c.get("municipalityId"),
        c.get("user")!.id,
        c.req.param("facilityId")!,
        body.code,
        body.date,
      );
      return c.json({ data });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      return c.json({ error: msg }, msg === "not_found" ? 404 : 400);
    }
  },
);

completeRoutes.get(
  "/api/c/:slug/admin/informe-mensual",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const now = new Date();
    const rawAno = c.req.query("ano");
    const rawMes = c.req.query("mes");
    let year = now.getFullYear();
    let month = now.getMonth() + 1;

    if (rawMes && /^\d{4}-\d{2}$/.test(rawMes)) {
      const [yStr, mStr] = rawMes.split("-");
      year = Number(yStr);
      month = Number(mStr);
    } else {
      if (rawAno !== undefined) {
        if (!/^\d{4}$/.test(rawAno)) {
          return c.json({ error: "validation_error" }, 400);
        }
        year = Number(rawAno);
      }
      if (rawMes !== undefined) {
        if (!/^\d{1,2}$/.test(rawMes)) {
          return c.json({ error: "validation_error" }, 400);
        }
        month = Number(rawMes);
      }
    }
    if (
      !Number.isInteger(year) ||
      year < 2000 ||
      year > 2100 ||
      !Number.isInteger(month) ||
      month < 1 ||
      month > 12
    ) {
      return c.json({ error: "validation_error" }, 400);
    }
    const { monthlyReport, monthlyReportCsv } = await import("../store/rev4-ops.js");
    const data = await monthlyReport(c.get("municipalityId"), year, month);
    if (c.req.query("formato") === "xlsx") {
      const { buildIndicatorsXlsx } = await import("../store/export-xlsx.js");
      const headers = [
        "metric",
        "value",
        "year",
        "month",
      ];
      const rows: Array<Array<string | number>> = [
        ["bookings", data.totals.bookings, year, month],
        ["checkedIn", data.totals.checkedIn, year, month],
        ["noShows", data.totals.noShows, year, month],
        ["cancelled", data.totals.cancelled, year, month],
      ];
      for (const h of data.hourHeat ?? []) {
        rows.push([`hour.${h.start}`, h.count, year, month]);
      }
      const buf = buildIndicatorsXlsx("indicadores", headers, rows);
      return new Response(new Uint8Array(buf), {
        status: 200,
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="indicadores-${year}-${String(month).padStart(2, "0")}.xlsx"`,
        },
      });
    }
    if (c.req.query("formato") === "csv") {
      return c.text(monthlyReportCsv(data), 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="informe-${year}-${month}.csv"`,
      });
    }
    return c.json({ data });
  },
);

completeRoutes.get(
  "/api/c/:slug/admin/export/frictionless.zip",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const persoais = c.req.query("persoais") === "1";
    if (persoais) {
      const blocked = await assertDeputacionPersonalDataAllowed(c);
      if (blocked) return blocked;
    }
    const { buildFrictionlessZip } = await import("../store/frictionless-zip.js");
    const user = c.get("user");
    const { buffer, filename } = await buildFrictionlessZip(
      c.get("municipalityId"),
      {
        persoais,
        actor: user?.displayName ?? user?.email ?? user?.id ?? "admin",
      },
    );
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  },
);

completeRoutes.get(
  "/api/c/:slug/admin/auditoria.csv",
  municipalityMiddleware,
  requireMuniRoles("admin", { personalData: true }),
  async (c) => {
    const rows = await listAudit(c.get("municipalityId"), boundedQuery(c));
    const header = "at,actor,action,detail\n";
    const body = rows
      .map((a) =>
        [a.at, a.actor, a.action, a.detail ?? ""]
          .map((v) => csvEscapeCell(String(v)))
          .join(","),
      )
      .join("\n");
    return c.text(header + body, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="actividade.csv"',
    });
  },
);

/* Rev3 D3 — Grupos fixos */
completeRoutes.get(
  "/api/c/:slug/admin/grupos-fixos",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const { listFixedGroups } = await import("../store/fixed-groups.js");
    return c.json({ data: await listFixedGroups(c.get("municipalityId")) });
  },
);

completeRoutes.post(
  "/api/c/:slug/admin/grupos-fixos",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const parsed = z
      .object({
        name: z.string().min(2),
        facilityId: z.string().min(1),
        unitId: z.string().min(1),
        weekday: z.number().int().min(0).max(6),
        start: hhmmStartSchema,
        end: hhmmEndSchema,
        validFrom: isoDateSchema,
        validTo: isoDateSchema,
        clubId: z.string().optional(),
        confirm: z.boolean().optional(),
      })
      .refine((b) => b.start < b.end, { message: "invalid_time_range" })
      .refine((b) => b.validFrom <= b.validTo, { message: "invalid_date_range" })
      .safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "validation_error", issues: parsed.error.issues }, 400);
    }
    const body = parsed.data;
    const { createFixedGroup } = await import("../store/fixed-groups.js");
    try {
      const data = await createFixedGroup(
        c.get("municipalityId"),
        c.get("user")!.displayName,
        body,
      );
      /* REVISION-58 K2: needsConfirm → 200; creado → 201. */
      return c.json({ data }, data.needsConfirm ? 200 : 201);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      return c.json({ error: msg }, msg === "not_found" ? 404 : 400);
    }
  },
);

completeRoutes.post(
  "/api/c/:slug/admin/grupos-fixos/:id/desactivar",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const { deactivateFixedGroup } = await import("../store/fixed-groups.js");
    try {
      const data = await deactivateFixedGroup(
        c.get("municipalityId"),
        c.req.param("id")!,
        c.get("user")!.displayName,
      );
      return c.json({ data });
    } catch {
      return c.json({ error: "not_found" }, 404);
    }
  },
);

/* ——— TANDA-2: Partidos abertos ——— */
completeRoutes.get(
  "/api/c/:slug/me/partidos",
  municipalityMiddleware,
  requireSameMunicipality(),
  async (c) => {
    const user = c.get("user")!;
    const { listOpenMatchesForUser } = await import("../store/open-matches.js");
    const data = await listOpenMatchesForUser(c.get("municipalityId"), user.id);
    return c.json({ data });
  },
);

completeRoutes.get(
  "/api/c/:slug/partidos-abertos",
  municipalityMiddleware,
  async (c) => {
    const { listOpenMatches } = await import("../store/open-matches.js");
    const { DEFAULT_TIMEZONE, localDateIso } = await import(
      "../store/business-rules.js"
    );
    const today = localDateIso(new Date(), DEFAULT_TIMEZONE);
    const data = await listOpenMatches(c.get("municipalityId"), {
      userId: c.get("user")?.id,
      /* Por defecto só futuros (admin usa includeClosed e sen desde). */
      fromDate: c.req.query("desde") ?? today,
      publicList: true,
    });
    return c.json({ data });
  },
);

completeRoutes.get(
  "/api/c/:slug/partidos-abertos/:id",
  municipalityMiddleware,
  async (c) => {
    const { getOpenMatch } = await import("../store/open-matches.js");
    const data = await getOpenMatch(
      c.get("municipalityId"),
      c.req.param("id")!,
      c.get("user")?.id,
    );
    if (!data) return c.json({ error: "not_found" }, 404);
    return c.json({ data });
  },
);

completeRoutes.post(
  "/api/c/:slug/partidos-abertos",
  municipalityMiddleware,
  requireSameMunicipality(),
  async (c) => {
    const body = z
      .object({
        bookingId: z.string().min(1).optional(),
        slotId: z.string().min(1).optional(),
        title: z.string().min(2).max(120),
        sport: z.string().max(40).optional(),
        spotsTotal: z.number().int().min(2).max(40).optional(),
        level: z.string().max(40).optional(),
        notes: z.string().max(500).optional(),
        rulesVersion: z.string().optional(),
        nameDisplayConsent: z.boolean().optional(),
        displayName: z.string().min(2).max(80).optional(),
      })
      .parse(await c.req.json());
    const user = c.get("user")!;
    try {
      const {
        createOpenMatch,
        createBookingWithOpenMatch,
      } = await import("../store/open-matches.js");
      if (body.slotId && !body.bookingId) {
        const { booking, match } = await createBookingWithOpenMatch({
          municipalityId: c.get("municipalityId"),
          slotId: body.slotId,
          userId: user.id,
          displayName: user.displayName,
          email: user.email,
          userRole: c.get("effectiveRole"),
          rulesVersion: body.rulesVersion,
          title: body.title,
          sport: body.sport,
          spotsTotal: body.spotsTotal,
          level: body.level,
          notes: body.notes,
          nameDisplayConsent: body.nameDisplayConsent === true,
          proposedDisplayName: body.displayName,
        });
        return c.json({ data: match, booking }, 201);
      }
      if (!body.bookingId) {
        return c.json({ error: "booking_required" }, 400);
      }
      const data = await createOpenMatch({
        municipalityId: c.get("municipalityId"),
        userId: user.id,
        displayName: user.displayName,
        email: user.email,
        bookingId: body.bookingId,
        title: body.title,
        sport: body.sport,
        spotsTotal: body.spotsTotal,
        level: body.level,
        notes: body.notes,
        nameDisplayConsent: body.nameDisplayConsent === true,
        proposedDisplayName: body.displayName,
      });
      return c.json({ data }, 201);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      const status =
        msg === "not_found"
          ? 404
          : msg === "forbidden"
            ? 403
            : msg === "slot_occupied"
              ? 409
              : 400;
      return c.json({ error: msg }, status);
    }
  },
);

completeRoutes.post(
  "/api/c/:slug/partidos-abertos/:id/apuntarse",
  municipalityMiddleware,
  requireSameMunicipality(),
  async (c) => {
    const user = c.get("user")!;
    const body = await c.req
      .json<{ nameDisplayConsent?: boolean; displayName?: string }>()
      .catch(
        () =>
          ({}) as { nameDisplayConsent?: boolean; displayName?: string },
      );
    try {
      const { joinOpenMatch } = await import("../store/open-matches.js");
      const data = await joinOpenMatch({
        municipalityId: c.get("municipalityId"),
        openMatchId: c.req.param("id")!,
        userId: user.id,
        displayName: user.displayName,
        email: user.email,
        nameDisplayConsent: body.nameDisplayConsent === true,
        proposedDisplayName: body.displayName,
      });
      return c.json({ data });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      const conflict = new Set([
        "schedule_conflict",
        "match_in_past",
        "booking_blocked",
        "full",
      ]);
      const status =
        msg === "not_found"
          ? 404
          : msg === "forbidden"
            ? 403
            : conflict.has(msg)
              ? 409
              : 400;
      return c.json({ error: msg }, status);
    }
  },
);

completeRoutes.post(
  "/api/c/:slug/partidos-abertos/:id/sair",
  municipalityMiddleware,
  requireSameMunicipality(),
  async (c) => {
    const user = c.get("user")!;
    try {
      const { leaveOpenMatch } = await import("../store/open-matches.js");
      const data = await leaveOpenMatch({
        municipalityId: c.get("municipalityId"),
        openMatchId: c.req.param("id")!,
        userId: user.id,
      });
      return c.json({ data });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      return c.json({ error: msg }, msg === "not_found" ? 404 : 400);
    }
  },
);

completeRoutes.post(
  "/api/c/:slug/partidos-abertos/:id/cancelar",
  municipalityMiddleware,
  requireSameMunicipality(),
  async (c) => {
    const user = c.get("user")!;
    const body = await c.req
      .json<{ reason?: string }>()
      .catch(() => ({}) as { reason?: string });
    const effectiveRole = c.get("effectiveRole");
    const asAdmin = effectiveRole === "admin" || effectiveRole === "staff";
    if (asAdmin && !body.reason?.trim()) {
      return c.json({ error: "reason_required" }, 400);
    }
    try {
      const { cancelOpenMatch } = await import("../store/open-matches.js");
      await cancelOpenMatch({
        municipalityId: c.get("municipalityId"),
        openMatchId: c.req.param("id")!,
        userId: user.id,
        asAdmin,
        reason: body.reason,
      });
      return c.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      const status =
        msg === "not_found" ? 404 : msg === "forbidden" ? 403 : 400;
      return c.json({ error: msg }, status);
    }
  },
);

completeRoutes.post(
  "/api/c/:slug/partidos-abertos/:id/convidar",
  municipalityMiddleware,
  requireSameMunicipality(),
  async (c) => {
    const body = z
      .object({
        toUserId: z.string().optional(),
        toEmail: z.string().email().optional(),
      })
      .refine((v) => !!(v.toUserId || v.toEmail), {
        message: "recipient_required",
      })
      .parse(await c.req.json());
    const user = c.get("user")!;
    try {
      const { inviteToOpenMatch } = await import("../store/open-matches.js");
      const data = await inviteToOpenMatch({
        municipalityId: c.get("municipalityId"),
        openMatchId: c.req.param("id")!,
        fromUserId: user.id,
        toUserId: body.toUserId,
        toEmail: body.toEmail,
      });
      return c.json({ data }, 201);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      const status =
        msg === "not_found"
          ? 404
          : msg === "forbidden"
            ? 403
            : msg === "invite_limit_match" || msg === "invite_limit_day"
              ? 429
              : 400;
      return c.json({ error: msg }, status);
    }
  },
);

completeRoutes.get(
  "/api/c/:slug/partidos-abertos/:id/qr",
  municipalityMiddleware,
  async (c) => {
    const { openMatchQrPayload, verifyOpenMatchQr, getOpenMatch } = await import(
      "../store/open-matches.js"
    );
    const token = c.req.query("t");
    if (token) {
      const data = await verifyOpenMatchQr(
        c.get("municipalityId"),
        c.req.param("id")!,
        token,
        c.get("user")?.id,
      );
      if (!data) return c.json({ error: "not_found" }, 404);
      return c.json({ data, verified: true });
    }
    const user = c.get("user");
    if (!user) return c.json({ error: "unauthorized" }, 401);
    const mid = c.get("municipalityId");
    const match = await getOpenMatch(mid, c.req.param("id")!, user.id);
    if (!match) return c.json({ error: "not_found" }, 404);
    const effectiveRole = effectiveRoleInMunicipality(user, mid);
    const staff =
      effectiveRole === "admin" ||
      effectiveRole === "staff" ||
      effectiveRole === "superadmin";
    if (!staff && !match.iAmOrganizer && !match.iAmJoined) {
      return c.json({ error: "forbidden" }, 403);
    }
    const qr = await openMatchQrPayload(mid, c.req.param("id")!);
    if (!qr) return c.json({ error: "not_found" }, 404);
    return c.json({ data: qr });
  },
);

completeRoutes.get(
  "/api/c/:slug/admin/partidos-abertos",
  municipalityMiddleware,
  requireMuniRoles("admin", "staff"),
  async (c) => {
    const { listOpenMatches } = await import("../store/open-matches.js");
    const data = await listOpenMatches(c.get("municipalityId"), {
      includeClosed: true,
      userId: c.get("user")?.id,
    });
    return c.json({ data });
  },
);

/* bridge cancel → waitlist (await para non gañar a carreira coa resposta) */
onBookingCancelledBridge(async (slotId, municipalityId) => {
  await offerWaitlistOnCancel(slotId, municipalityId);
});
