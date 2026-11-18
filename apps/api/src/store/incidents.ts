/**
 * Incidencias (Rev3 D1): foto+texto+instalación → bandexa concello.
 */
import { and, count, desc, eq, gte, lte, or } from "drizzle-orm";
import { getDb } from "../db/client.js";
import * as t from "../db/schema.js";
import { audit } from "./extra.js";
import { getFacility } from "./db.js";
import { newId } from "../lib/ids.js";

function nid(prefix: string) {
  return newId(prefix);
}

export async function createIncident(
  municipalityId: string,
  actor: { id: string; displayName: string },
  input: {
    facilityId?: string;
    body: string;
    photoDataUrl?: string | null;
  },
) {
  const body = input.body.trim();
  if (body.length < 5) throw new Error("body_required");
  if (input.facilityId) {
    const fac = await getFacility(input.facilityId);
    if (!fac || fac.municipalityId !== municipalityId) throw new Error("not_found");
  }
  let photo: string | null = input.photoDataUrl?.trim() || null;
  if (photo && photo.length > 700_000) throw new Error("photo_too_big");
  if (photo && !photo.startsWith("data:image/")) throw new Error("photo_type");

  const id = nid("inc");
  await getDb().insert(t.incidents).values({
    id,
    municipalityId,
    facilityId: input.facilityId ?? null,
    userId: actor.id,
    userDisplayName: actor.displayName,
    body,
    photoDataUrl: photo,
    status: "open",
    createdAt: new Date(),
  });
  await audit(municipalityId, actor.displayName, "incident.create", id);
  return getIncident(municipalityId, id);
}

export async function listIncidents(
  municipalityId: string,
  opts?: {
    status?: string;
    userId?: string;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  },
) {
  const limit = Math.min(500, Math.max(1, Math.trunc(opts?.limit ?? 100)));
  const offset = Math.max(0, Math.trunc(opts?.offset ?? 0));
  const rows = await getDb()
    .select({
      id: t.incidents.id,
      facilityId: t.incidents.facilityId,
      userId: t.incidents.userId,
      userDisplayName: t.incidents.userDisplayName,
      body: t.incidents.body,
      status: t.incidents.status,
      createdAt: t.incidents.createdAt,
      resolvedAt: t.incidents.resolvedAt,
    })
    .from(t.incidents)
    .where(
      and(
        eq(t.incidents.municipalityId, municipalityId),
        opts?.status ? eq(t.incidents.status, opts.status) : undefined,
        opts?.userId ? eq(t.incidents.userId, opts.userId) : undefined,
        opts?.from ? gte(t.incidents.createdAt, opts.from) : undefined,
        opts?.to ? lte(t.incidents.createdAt, opts.to) : undefined,
      ),
    )
    .orderBy(desc(t.incidents.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  }));
}

export async function openIncidentsCount(municipalityId: string): Promise<number> {
  const rows = await getDb()
    .select({ value: count() })
    .from(t.incidents)
    .where(
      and(
        eq(t.incidents.municipalityId, municipalityId),
        // Abertas ou en curso contan como pendentes no panel
        or(eq(t.incidents.status, "open"), eq(t.incidents.status, "in_progress")),
      ),
    );
  return Number(rows[0]?.value ?? 0);
}

export async function resolveIncident(
  municipalityId: string,
  id: string,
  actor: string,
) {
  return setIncidentStatus(municipalityId, id, "done", actor);
}

/** Estados: open → in_progress → done (Rev4 día a día 10). */
export async function setIncidentStatus(
  municipalityId: string,
  id: string,
  status: "open" | "in_progress" | "done",
  actor: string,
) {
  const row = await getIncident(municipalityId, id);
  if (!row) throw new Error("not_found");
  const resolvedAt = status === "done" ? new Date() : null;
  await getDb()
    .update(t.incidents)
    .set({ status, resolvedAt })
    .where(
      and(eq(t.incidents.id, id), eq(t.incidents.municipalityId, municipalityId)),
    );
  await audit(municipalityId, actor, `incident.${status}`, id);

  // Aviso á persoa que a comunicou
  if (status === "in_progress" || status === "done") {
    const title =
      status === "done" ? "Incidencia resolta" : "Incidencia en curso";
    const body =
      status === "done"
        ? `O concello resolveu a túa incidencia: «${row.body.slice(0, 80)}».`
        : `O concello está a traballar na túa incidencia: «${row.body.slice(0, 80)}».`;
    await getDb().insert(t.notices).values({
      id: newId("n-inc"),
      municipalityId,
      userId: row.userId,
      type: "info",
      title,
      body,
      read: false,
      createdAt: new Date(),
    });
  }
  return getIncident(municipalityId, id);
}

export async function getIncident(municipalityId: string, id: string) {
  const rows = await getDb()
    .select()
    .from(t.incidents)
    .where(
      and(eq(t.incidents.id, id), eq(t.incidents.municipalityId, municipalityId)),
    )
    .limit(1);
  return rows[0] ? mapIncident(rows[0]) : null;
}

function mapIncident(r: typeof t.incidents.$inferSelect) {
  return {
    id: r.id,
    facilityId: r.facilityId,
    userId: r.userId,
    userDisplayName: r.userDisplayName,
    body: r.body,
    photoDataUrl: r.photoDataUrl,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
  };
}
