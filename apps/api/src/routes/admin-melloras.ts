/**
 * Rutas admin P1 (MELLORAS-UX): normas, instalacións, horarios, peches, solicitudes.
 */
import { Hono } from "hono";
import { z } from "zod";
import { municipalityMiddleware } from "../tenancy.js";
import {
  hhmmEndSchema,
  hhmmStartSchema,
  isoDateSchema,
} from "../lib/date-time-zod.js";
import {
  requireMuniRoles,
  deputacionAnonymizeMiddleware,
} from "../middleware/auth.js";
import {
  adminHomeTodos,
  approveClubRequest,
  clubRequestConflicts,
  createActivityAdmin,
  createClosureAdmin,
  createFacilityAdmin,
  createUnitAdmin,
  deleteClosureAdmin,
  applyOpeningHoursToFacilityUnits,
  getNormas,
  listActivityAdminDetail,
  listAdminFacilities,
  listClosures,
  listClubRequests,
  listOpeningHours,
  listFreeHoursForMatch,
  moveClubRequest,
  moveMatch,
  pendingRequestsCount,
  previewFacilityDeactivateImpact,
  publishFacilityAdmin,
  putFacilityNormas,
  putMunicipalityBranding,
  putMunicipalityNormas,
  rejectClubRequest,
  runLotteryAdmin,
  updateActivityAdmin,
  updateClosureAdmin,
  updateFacilityAdmin,
  updateUnitAdmin,
  upsertOpeningHours,
} from "../store/admin-ops.js";
import { listActivities, getMunicipalityById } from "../store/db.js";
import { logoVersionHash } from "./public-portal-routes.js";
import {
  confirmMatchCsv,
  previewMatchCsv,
} from "../store/match-csv.js";

export const adminMellorasRoutes = new Hono();
adminMellorasRoutes.use("/api/c/:slug/*", deputacionAnonymizeMiddleware);

const rulesSchema = z.object({
  bookingAntelationDays: z.number().int().min(1).max(60).optional(),
  maxActiveBookings: z.number().int().min(0).max(20).optional(),
  maxHoursPerWeek: z.number().min(0).max(40).optional(),
  cancelMinHours: z.number().min(0).max(72).optional(),
  checkInMarginMinutes: z.number().int().min(0).max(120).optional(),
  noShowReleaseMinutes: z.number().int().min(0).max(120).optional(),
  anonymizeAfterDays: z.number().int().min(1).max(3650).optional(),
  noShowPenaltyCount: z.number().int().min(0).max(30).optional(),
  noShowPenaltyDays: z.number().int().min(0).max(365).optional(),
  noShowPenaltyWindowDays: z.number().int().min(1).max(365).optional(),
  whoCanBook: z.enum(["vecinhaza", "clubs", "ambas"]).optional(),
  approvalRequired: z.boolean().optional(),
  informativePrice: z.string().max(120).optional(),
  slotMinutes: z.union([z.literal(30), z.literal(60), z.literal(90)]).optional(),
});

const rulesTextItem = z.object({
  id: z.string().min(1),
  order: z.number().int(),
  gl: z.string(),
  es: z.string(),
});

/* ——— Normas ——— */
adminMellorasRoutes.get(
  "/api/c/:slug/admin/normas",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    return c.json({ data: await getNormas(c.get("municipalityId")) });
  },
);

adminMellorasRoutes.put(
  "/api/c/:slug/admin/normas",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const body = z
      .object({
        rules: rulesSchema.optional(),
        rulesText: z.array(rulesTextItem).optional(),
      })
      .parse(await c.req.json());
    const data = await putMunicipalityNormas(
      c.get("municipalityId"),
      c.get("user")!.displayName,
      body,
    );
    return c.json({ data });
  },
);

adminMellorasRoutes.get(
  "/api/c/:slug/admin/instalacions/:id/normas",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    try {
      return c.json({
        data: await getNormas(c.get("municipalityId"), c.req.param("id")),
      });
    } catch {
      return c.json({ error: "not_found" }, 404);
    }
  },
);

adminMellorasRoutes.put(
  "/api/c/:slug/admin/instalacions/:id/normas",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const body = z
      .object({
        rulesOverride: rulesSchema.nullable().optional(),
        rulesText: z.array(rulesTextItem).nullable().optional(),
      })
      .parse(await c.req.json());
    try {
      const data = await putFacilityNormas(
        c.get("municipalityId"),
        c.req.param("id")!,
        c.get("user")!.displayName,
        body,
      );
      return c.json({ data });
    } catch {
      return c.json({ error: "not_found" }, 404);
    }
  },
);

/* ——— Instalacións ——— */
adminMellorasRoutes.get(
  "/api/c/:slug/admin/instalacions",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    return c.json({ data: await listAdminFacilities(c.get("municipalityId")) });
  },
);

adminMellorasRoutes.get(
  "/api/c/:slug/admin/instalacions/mapa-centro",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const { resolveMunicipalityMapCenter } = await import(
      "../store/facility-admin-templates.js"
    );
    const data = await resolveMunicipalityMapCenter(c.get("municipalityId"));
    return c.json({ data });
  },
);

adminMellorasRoutes.get(
  "/api/c/:slug/admin/instalacions/censo/suxestions",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const { listCensusFacilitySuggestions } = await import(
      "../store/census-facilities.js"
    );
    try {
      const data = await listCensusFacilitySuggestions(c.get("municipalityId"));
      return c.json({ data });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      return c.json({ error: msg }, msg === "not_found" ? 404 : 400);
    }
  },
);

adminMellorasRoutes.post(
  "/api/c/:slug/admin/instalacions/censo/crear",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const body = z.object({ keys: z.array(z.string().min(3)).min(1) }).parse(
      await c.req.json(),
    );
    const { createFacilitiesFromCensusAdmin } = await import(
      "../store/census-facilities.js"
    );
    try {
      const data = await createFacilitiesFromCensusAdmin(
        c.get("municipalityId"),
        c.get("user")!.displayName,
        body.keys,
      );
      return c.json({ data }, 201);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      return c.json({ error: msg }, msg === "not_found" ? 404 : 400);
    }
  },
);

adminMellorasRoutes.get(
  "/api/c/:slug/admin/instalacions/:id/impacto-desactivar",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    try {
      const data = await previewFacilityDeactivateImpact(
        c.get("municipalityId"),
        c.req.param("id")!,
      );
      return c.json({ data });
    } catch {
      return c.json({ error: "not_found" }, 404);
    }
  },
);

/* REVISION-56 H1 + REVISION-60 N6 — slotMinutes 30|60|90 e capacity 1–100. */
const unitSlotMinutesSchema = z.union([
  z.literal(30),
  z.literal(60),
  z.literal(90),
]);
const unitCapacitySchema = z.number().int().min(1).max(100);

adminMellorasRoutes.post(
  "/api/c/:slug/admin/instalacions",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const parsed = z
      .object({
        name: z.string().min(2),
        type: z.enum(["pista", "pavillon", "campo", "sala"]),
        address: z.string().min(2),
        lat: z.number(),
        lng: z.number(),
        courtCount: z.number().int().min(1).max(12).optional(),
        halfCourts: z.boolean().optional(),
        accessibility: z.string().optional(),
        services: z.array(z.string()).optional(),
        rules: z.string().optional(),
        units: z
          .array(
            z.object({
              name: z.string().min(1),
              bookingKind: z.string().optional(),
              slotMinutes: unitSlotMinutesSchema.optional(),
              capacity: unitCapacitySchema.optional(),
              incompatibleWith: z.array(z.string()).optional(),
            }),
          )
          .optional(),
      })
      .safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "validation_error", issues: parsed.error.issues }, 400);
    }
    const body = parsed.data;
    try {
      const data = await createFacilityAdmin(
        c.get("municipalityId"),
        c.get("user")!.displayName,
        body,
      );
      return c.json({ data }, 201);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      if (msg === "coords_required" || msg === "name_taken") {
        return c.json({ error: msg }, 400);
      }
      throw e;
    }
  },
);

adminMellorasRoutes.post(
  "/api/c/:slug/admin/instalacions/:id/publicar",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    try {
      const data = await publishFacilityAdmin(
        c.get("municipalityId"),
        c.req.param("id")!,
        c.get("user")!.displayName,
      );
      return c.json({ data });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      if (msg === "coords_required" || msg === "no_units") {
        return c.json({ error: msg }, 400);
      }
      return c.json({ error: "not_found" }, 404);
    }
  },
);

adminMellorasRoutes.put(
  "/api/c/:slug/admin/instalacions/:id",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const facilityPatchSchema = z.object({
      name: z.string().min(2).optional(),
      type: z.enum(["pista", "pavillon", "campo", "sala"]).optional(),
      address: z.string().min(2).optional(),
      lat: z.number().optional(),
      lng: z.number().optional(),
      accessibility: z.string().max(200).optional(),
      services: z.array(z.string()).optional(),
      rules: z.string().optional(),
      active: z.boolean().optional(),
      confirm: z.boolean().optional(),
      imageDataUrl: z
        .string()
        .max(700_000)
        .nullable()
        .optional()
        .refine(
          (v) =>
            v == null ||
            v === "" ||
            /^data:image\/(jpeg|jpg|png|webp);base64,/i.test(v),
          { message: "bad_image" },
        ),
      imageAlt: z.string().max(200).nullable().optional(),
      checkInRequired: z.boolean().optional(),
      outdoor: z.boolean().optional(),
      contactPhone: z.string().max(40).nullable().optional(),
      contactEmail: z.string().max(120).nullable().optional(),
      contactPerson: z.string().max(120).nullable().optional(),
      parkingInfo: z.string().max(200).nullable().optional(),
      publicTransport: z.string().max(200).nullable().optional(),
      entranceInfo: z.string().max(200).nullable().optional(),
    });
    let body: z.infer<typeof facilityPatchSchema>;
    try {
      body = facilityPatchSchema.parse(await c.req.json());
    } catch (e) {
      if (
        e instanceof z.ZodError &&
        e.issues.some((x: { message: string }) => x.message === "bad_image")
      ) {
        return c.json(
          {
            error: "bad_image",
            message: "Formato non permitido (JPG, PNG ou WebP)",
          },
          400,
        );
      }
      throw e;
    }
    try {
      if (body.active === false && !body.confirm) {
        const impact = await previewFacilityDeactivateImpact(
          c.get("municipalityId"),
          c.req.param("id")!,
        );
        if (impact.cancelledCount > 0 || impact.matchCount > 0) {
          return c.json({ data: { needsConfirm: true as const, ...impact } });
        }
      }
      const { confirm: _confirm, ...patch } = body;
      const data = await updateFacilityAdmin(
        c.get("municipalityId"),
        c.req.param("id")!,
        c.get("user")!.displayName,
        patch,
      );
      return c.json({ data });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "bad_image") {
        return c.json(
          {
            error: "bad_image",
            message: "Formato non permitido (JPG, PNG ou WebP)",
          },
          400,
        );
      }
      return c.json({ error: "not_found" }, 404);
    }
  },
);

adminMellorasRoutes.post(
  "/api/c/:slug/admin/instalacions/:id/unidades",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const body = z
      .object({
        name: z.string().min(1),
        bookingKind: z.string().optional(),
        slotMinutes: unitSlotMinutesSchema.optional(),
        capacity: unitCapacitySchema.optional(),
        incompatibleWith: z.array(z.string()).optional(),
      })
      .parse(await c.req.json());
    try {
      const data = await createUnitAdmin(
        c.get("municipalityId"),
        c.req.param("id")!,
        c.get("user")!.displayName,
        body,
      );
      return c.json({ data }, 201);
    } catch {
      return c.json({ error: "not_found" }, 404);
    }
  },
);

adminMellorasRoutes.put(
  "/api/c/:slug/admin/instalacions/:id/unidades/:uid",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const body = z
      .object({
        name: z.string().min(1).optional(),
        bookingKind: z.string().optional(),
        slotMinutes: unitSlotMinutesSchema.optional(),
        capacity: unitCapacitySchema.optional(),
        incompatibleWith: z.array(z.string()).optional(),
        active: z.boolean().optional(),
      })
      .parse(await c.req.json());
    try {
      const data = await updateUnitAdmin(
        c.get("municipalityId"),
        c.req.param("id")!,
        c.req.param("uid")!,
        c.get("user")!.displayName,
        body,
      );
      return c.json({ data });
    } catch {
      return c.json({ error: "not_found" }, 404);
    }
  },
);

adminMellorasRoutes.put(
  "/api/c/:slug/admin/instalacions/:id/unidades/:uid/incompatibles",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const body = z.object({ ids: z.array(z.string()) }).parse(await c.req.json());
    try {
      const data = await updateUnitAdmin(
        c.get("municipalityId"),
        c.req.param("id")!,
        c.req.param("uid")!,
        c.get("user")!.displayName,
        { incompatibleWith: body.ids },
      );
      return c.json({ data });
    } catch {
      return c.json({ error: "not_found" }, 404);
    }
  },
);

/* ——— Horarios ——— */
adminMellorasRoutes.get(
  "/api/c/:slug/admin/horarios",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const unitId = c.req.query("unitId") || undefined;
    return c.json({
      data: await listOpeningHours(c.get("municipalityId"), unitId),
    });
  },
);

adminMellorasRoutes.put(
  "/api/c/:slug/admin/horarios",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const body = z
      .object({
        unitId: z.string().min(1),
        facilityId: z.string().optional(),
        hours: z.array(
          z.object({
            weekday: z.number().int().min(0).max(6),
            open: z.string(),
            close: z.string(),
            validFrom: z.string().nullable().optional(),
            validTo: z.string().nullable().optional(),
          }),
        ),
      })
      .parse(await c.req.json());
    try {
      const data = await upsertOpeningHours(
        c.get("municipalityId"),
        c.get("user")!.displayName,
        body,
      );
      return c.json({ data });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      if (msg === "hours_overlap" || msg === "invalid_range") {
        return c.json({ error: msg }, 400);
      }
      return c.json({ error: "not_found" }, 404);
    }
  },
);

adminMellorasRoutes.post(
  "/api/c/:slug/admin/horarios/aplicar",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const body = z
      .object({
        facilityId: z.string().min(1),
        sourceUnitId: z.string().min(1),
      })
      .parse(await c.req.json());
    try {
      const data = await applyOpeningHoursToFacilityUnits(
        c.get("municipalityId"),
        c.get("user")!.displayName,
        body,
      );
      return c.json({ data });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      if (msg === "no_hours") return c.json({ error: msg }, 400);
      return c.json({ error: "not_found" }, 404);
    }
  },
);

/* ——— Peches ——— */
adminMellorasRoutes.get(
  "/api/c/:slug/admin/peches",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    return c.json({ data: await listClosures(c.get("municipalityId")) });
  },
);

adminMellorasRoutes.post(
  "/api/c/:slug/admin/peches",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const body = z
      .object({
        facilityId: z.string().optional(),
        unitId: z.string().optional(),
        startsAt: z.string().min(10),
        endsAt: z.string().min(10),
        reason: z.string().min(2),
        notifyCitizens: z.boolean().optional(),
        confirm: z.boolean().optional(),
        mode: z.enum(["cancel_notify", "skip_booked_days"]).optional(),
        notifyReason: z.string().max(500).optional(),
      })
      .parse(await c.req.json());
    try {
      const data = await createClosureAdmin(
        c.get("municipalityId"),
        c.get("user")!.displayName,
        body,
      );
      return c.json({ data }, data.needsConfirm ? 200 : 201);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "facility_not_found" || msg === "unit_not_found") {
        return c.json({ error: msg }, 404);
      }
      /* REVISION-57 J2 */
      if (msg === "invalid_closure_datetime") {
        return c.json({ error: msg }, 400);
      }
      throw e;
    }
  },
);

adminMellorasRoutes.put(
  "/api/c/:slug/admin/peches/:id",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const body = z
      .object({
        startsAt: z.string().min(10).optional(),
        endsAt: z.string().min(10).optional(),
        reason: z.string().min(2).optional(),
        confirm: z.boolean().optional(),
        mode: z.enum(["cancel_notify", "skip_booked_days"]).optional(),
        notifyReason: z.string().max(500).optional(),
        notifyCitizens: z.boolean().optional(),
      })
      .parse(await c.req.json());
    try {
      const data = await updateClosureAdmin(
        c.get("municipalityId"),
        c.req.param("id")!,
        c.get("user")!.displayName,
        body,
      );
      if ("needsConfirm" in data && data.needsConfirm) {
        return c.json({ data });
      }
      return c.json({
        data: {
          id: data.id,
          facilityId: data.facilityId,
          unitId: data.unitId,
          startsAt: data.startsAt,
          endsAt: data.endsAt,
          reason: data.reason,
          needsConfirm: false,
          cancelledCount: data.cancelledCount,
          peopleCount: data.peopleCount,
          matchCount: data.matchCount,
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "invalid_closure_datetime") {
        return c.json({ error: msg }, 400);
      }
      /* REVISION-58 K6: not_found → 404; resto → 500. */
      if (msg === "not_found") {
        return c.json({ error: "not_found" }, 404);
      }
      console.error("[peches:update]", e);
      return c.json({ error: "internal_error" }, 500);
    }
  },
);

adminMellorasRoutes.delete(
  "/api/c/:slug/admin/peches/:id",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    try {
      await deleteClosureAdmin(
        c.get("municipalityId"),
        c.req.param("id")!,
        c.get("user")!.displayName,
      );
      return c.json({ data: { ok: true } });
    } catch {
      return c.json({ error: "not_found" }, 404);
    }
  },
);

/* ——— Busca de cidadáns (reservar en nome) ——— */
adminMellorasRoutes.get(
  "/api/c/:slug/admin/persoas",
  municipalityMiddleware,
  requireMuniRoles("admin", "staff", { personalData: true }),
  async (c) => {
    const q = c.req.query("q") ?? "";
    const { searchPeople } = await import("../store/rev4-ops.js");
    // Rev4: incluir reservas activas (substitúe searchCitizens mínimo)
    const data = await searchPeople(c.get("municipalityId"), q);
    return c.json({ data });
  },
);

/* REVISION-21 Q3: levantamento manual da penalización por non presentados. */
adminMellorasRoutes.post(
  "/api/c/:slug/admin/persoas/:userId/desbloquear-reservas",
  municipalityMiddleware,
  requireMuniRoles("admin", "staff"),
  async (c) => {
    const { clearBookingBlock } = await import("../store/rev4-ops.js");
    try {
      const data = await clearBookingBlock(
        c.get("municipalityId"),
        c.req.param("userId")!,
        c.get("user")!.displayName,
      );
      return c.json({ data });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      return c.json({ error: msg }, msg === "not_found" ? 404 : 400);
    }
  },
);

/* ——— Solicitudes ——— */
adminMellorasRoutes.get(
  "/api/c/:slug/admin/solicitudes",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const estado = c.req.query("estado") || undefined;
    const data = await listClubRequests(c.get("municipalityId"), estado);
    const pending = await pendingRequestsCount(c.get("municipalityId"));
    return c.json({ data, pending });
  },
);

adminMellorasRoutes.get(
  "/api/c/:slug/admin/solicitudes/:id/choques",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    try {
      const data = await clubRequestConflicts(
        c.get("municipalityId"),
        c.req.param("id")!,
      );
      return c.json({ data });
    } catch {
      return c.json({ error: "not_found" }, 404);
    }
  },
);

adminMellorasRoutes.post(
  "/api/c/:slug/admin/solicitudes/:id/aprobar",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    try {
      const data = await approveClubRequest(
        c.get("municipalityId"),
        c.req.param("id")!,
        c.get("user")!.displayName,
      );
      return c.json({ data });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      if (msg === "conflict" || msg === "duplicate") {
        const conflicts =
          e instanceof Error && "conflicts" in e
            ? (e as Error & { conflicts?: unknown }).conflicts
            : undefined;
        return c.json({ error: msg, conflicts }, 409);
      }
      return c.json({ error: msg }, msg === "not_found" ? 404 : 400);
    }
  },
);

adminMellorasRoutes.post(
  "/api/c/:slug/admin/solicitudes/:id/rexeitar",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const body = z.object({ reason: z.string().min(2) }).parse(await c.req.json());
    try {
      const data = await rejectClubRequest(
        c.get("municipalityId"),
        c.req.param("id")!,
        c.get("user")!.displayName,
        body.reason,
      );
      return c.json({ data });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      return c.json({ error: msg }, msg === "not_found" ? 404 : 400);
    }
  },
);

adminMellorasRoutes.post(
  "/api/c/:slug/admin/solicitudes/:id/mover",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const parsed = z
      .object({
        facilityId: z.string().min(1).optional(),
        unitId: z.string().min(1).optional(),
        weekday: z.number().int().min(0).max(6).optional(),
        date: isoDateSchema.optional(),
        start: hhmmStartSchema.optional(),
        end: hhmmEndSchema.optional(),
      })
      .refine((b) => !b.start || !b.end || b.start < b.end, {
        message: "invalid_time_range",
      })
      .safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "validation_error", issues: parsed.error.issues }, 400);
    }
    const body = parsed.data;
    try {
      const data = await moveClubRequest(
        c.get("municipalityId"),
        c.req.param("id")!,
        c.get("user")!.displayName,
        body,
      );
      return c.json({ data });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      if (msg === "conflict") {
        const conflicts =
          e instanceof Error && "conflicts" in e
            ? (e as Error & { conflicts?: unknown }).conflicts
            : undefined;
        return c.json({ error: msg, conflicts }, 409);
      }
      return c.json(
        { error: msg },
        msg === "not_found" ? 404 : 400,
      );
    }
  },
);

/** REVISION-51 B1 — suxestións coa mesma validación que mover. */
adminMellorasRoutes.get(
  "/api/c/:slug/admin/pavillon/matches/:id/horas-libres",
  municipalityMiddleware,
  requireMuniRoles("admin", "club_manager"),
  async (c) => {
    const unitId = c.req.query("unitId") || undefined;
    const facilityId = c.req.query("facilityId") || undefined;
    const weekOffset = Number(c.req.query("weekOffset") ?? "0") || 0;
    try {
      const data = await listFreeHoursForMatch(
        c.get("municipalityId"),
        c.req.param("id")!,
        { unitId, facilityId, weekOffset },
      );
      return c.json({ data });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      return c.json({ error: msg }, msg === "not_found" ? 404 : 400);
    }
  },
);

adminMellorasRoutes.post(
  "/api/c/:slug/admin/pavillon/matches/:id/mover",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const parsed = z
      .object({
        facilityId: z.string().min(1),
        unitId: z.string().min(1),
        date: isoDateSchema,
        start: hhmmStartSchema,
        end: hhmmEndSchema,
      })
      .refine((b) => b.start < b.end, { message: "invalid_time_range" })
      .safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "validation_error", issues: parsed.error.issues }, 400);
    }
    const body = parsed.data;
    try {
      const data = await moveMatch(
        c.get("municipalityId"),
        c.req.param("id")!,
        body,
        c.get("user")!.displayName,
      );
      return c.json({ data });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      if (msg === "conflict") {
        const conflicts =
          e instanceof Error && "conflicts" in e
            ? (e as Error & { conflicts?: unknown }).conflicts
            : undefined;
        return c.json({ error: msg, conflicts }, 409);
      }
      return c.json({ error: msg }, msg === "not_found" ? 404 : 400);
    }
  },
);

/* ——— Actividades ——— */
adminMellorasRoutes.get(
  "/api/c/:slug/admin/actividades",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const acts = await listActivities(c.get("municipalityId"));
    return c.json({ data: acts });
  },
);

adminMellorasRoutes.get(
  "/api/c/:slug/admin/actividades/:id",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    try {
      const data = await listActivityAdminDetail(
        c.get("municipalityId"),
        c.req.param("id")!,
      );
      return c.json({ data });
    } catch {
      return c.json({ error: "not_found" }, 404);
    }
  },
);

adminMellorasRoutes.post(
  "/api/c/:slug/admin/actividades",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const body = z
      .object({
        name: z.string().min(2),
        description: z.string().optional().default(""),
        facilityId: z.string().min(1),
        days: z.string().min(1),
        hours: z.string().min(1),
        places: z.number().int().min(1).max(500),
        ageMin: z.number().int().min(0).max(100),
        ageMax: z.number().int().min(0).max(100),
        method: z.enum(["first_come", "lottery"]),
        deadline: z.string().min(10),
      })
      .refine((b) => b.ageMin <= b.ageMax, { message: "invalid_age_range" })
      .parse(await c.req.json());
    try {
      const data = await createActivityAdmin(
        c.get("municipalityId"),
        c.get("user")!.displayName,
        body,
      );
      return c.json({ data }, 201);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      return c.json({ error: msg }, msg === "not_found" ? 404 : 400);
    }
  },
);

adminMellorasRoutes.put(
  "/api/c/:slug/admin/actividades/:id",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const parsed = z
      .object({
        name: z.string().min(2).optional(),
        description: z.string().optional(),
        facilityId: z.string().optional(),
        days: z.string().optional(),
        hours: z.string().optional(),
        places: z.number().int().min(1).max(500).optional(),
        ageMin: z.number().int().min(0).max(100).optional(),
        ageMax: z.number().int().min(0).max(100).optional(),
        method: z.enum(["first_come", "lottery"]).optional(),
        deadline: z.string().optional(),
        lotteryStatus: z.enum(["open", "closed"]).optional(),
      })
      .safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "validation_error", issues: parsed.error.issues }, 400);
    }
    try {
      const data = await updateActivityAdmin(
        c.get("municipalityId"),
        c.req.param("id")!,
        c.get("user")!.displayName,
        parsed.data,
      );
      return c.json({ data });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      const status =
        msg === "not_found"
          ? 404
          : msg === "lottery_already_drawn" ||
              msg === "already_drawn" ||
              msg === "has_applications"
            ? 409
            : 400;
      return c.json({ error: msg }, status);
    }
  },
);

adminMellorasRoutes.post(
  "/api/c/:slug/admin/actividades/:id/sortear",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    try {
      const result = await runLotteryAdmin(
        c.get("municipalityId"),
        c.req.param("id")!,
        c.get("user")!.displayName,
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
      const status = msg === "wrong_municipality" || msg === "not_found" ? 403 : 400;
      return c.json({ error: msg }, status);
    }
  },
);

adminMellorasRoutes.get(
  "/api/c/:slug/admin/hoxe",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const data = await adminHomeTodos(c.get("municipalityId"));
    return c.json({ data });
  },
);

adminMellorasRoutes.get(
  "/api/c/:slug/admin/personalizacion",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const muni = await getMunicipalityById(c.get("municipalityId"));
    if (!muni) return c.json({ error: "not_found" }, 404);
    const v = logoVersionHash(muni.settings.logoDataUrl);
    return c.json({
      data: {
        deputacionCanViewPersonalData:
          muni.settings.deputacionCanViewPersonalData === true,
        hasLogo: Boolean(muni.settings.logoDataUrl),
        logoUrl: v ? `/api/c/${muni.slug}/logo?v=${v}` : null,
      },
    });
  },
);

adminMellorasRoutes.put(
  "/api/c/:slug/admin/personalizacion",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const body = z
      .object({
        name: z.string().min(2).max(120).optional(),
        brand: z.string().min(4).max(32).optional(),
        accent: z.string().min(4).max(32).optional(),
        welcomeGl: z.string().max(500).optional(),
        welcomeEs: z.string().max(500).optional(),
        logoDataUrl: z.string().max(700_000).nullable().optional(),
        legal: z
          .object({
            titular: z.string().max(200).optional(),
            nif: z.string().max(32).optional(),
            address: z.string().max(300).optional(),
            email: z.string().max(120).optional(),
            dpd: z.string().max(200).optional(),
            sinatura: z.string().max(120).optional(),
          })
          .optional(),
        contact: z
          .object({
            serviceName: z.string().max(120).optional(),
            phone: z.string().max(40).optional(),
            email: z.string().max(120).optional(),
            address: z.string().max(300).optional(),
            hours: z.string().max(300).optional(),
            web: z.string().max(200).optional(),
          })
          .optional(),
        openData: z
          .object({
            license: z.string().max(120).optional(),
            dir3: z.string().max(32).optional(),
            catalogPublisher: z.string().max(200).optional(),
          })
          .optional(),
        deputacionCanViewPersonalData: z.boolean().optional(),
      })
      .parse(await c.req.json());
    try {
      const data = await putMunicipalityBranding(
        c.get("municipalityId"),
        c.get("user")!.displayName,
        body,
      );
      return c.json({ data });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      return c.json({ error: msg }, msg === "not_found" ? 404 : 400);
    }
  },
);

const matchCsvBody = z.object({
  csv: z.string().min(1).max(500_000),
  categoryMinutes: z.record(z.string(), z.number().int().min(30).max(180)).optional(),
});

/** Vista previa CSV partidos (erros + choques) sen escribir. */
adminMellorasRoutes.post(
  "/api/c/:slug/admin/partidos/importar/preview",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const body = matchCsvBody.parse(await c.req.json());
    const data = await previewMatchCsv(
      c.get("municipalityId"),
      body.csv,
      body.categoryMinutes,
    );
    return c.json({ data });
  },
);

/** Confirma a importación das filas válidas. */
adminMellorasRoutes.post(
  "/api/c/:slug/admin/partidos/importar",
  municipalityMiddleware,
  requireMuniRoles("admin"),
  async (c) => {
    const body = matchCsvBody.parse(await c.req.json());
    const data = await confirmMatchCsv(
      c.get("municipalityId"),
      c.get("user")!.displayName,
      body.csv,
      body.categoryMinutes,
    );
    return c.json({ data });
  },
);
