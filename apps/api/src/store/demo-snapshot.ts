import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { eq, getTableColumns, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { getDb, getDbMode } from "../db/client.js";
import * as t from "../db/schema.js";
import { isDemoMode } from "../env.js";
import { newId } from "../lib/ids.js";
import { DEPUTACION_PLATFORM_MUNI_ID } from "./deputacion-org.js";

const execFileAsync = promisify(execFile);

export const SNAPSHOT_VERSION = 1 as const;
const INSERT_BATCH_SIZE = 200;
const RESTORE_ERROR_META_KEY = "demo_restore_last_error";

export type SnapshotTableEntry = {
  name: string;
  table: PgTable;
};

/**
 * Orde topolóxica pais → fillos para inserción sen violar claves foráneas.
 * Inclúe as 39 táboas do esquema.
 */
export const SNAPSHOT_TABLES: readonly SnapshotTableEntry[] = [
  { name: "meta", table: t.meta },
  { name: "organizations", table: t.organizations },
  { name: "municipalities", table: t.municipalities },
  { name: "otp_rate_limits", table: t.otpRateLimits },
  { name: "cert_login_states", table: t.certLoginStates },
  { name: "cert_login_tickets", table: t.certLoginTickets },
  { name: "otp_challenges", table: t.otpChallenges },
  { name: "users", table: t.users },
  { name: "invitations", table: t.invitations },
  { name: "facilities", table: t.facilities },
  { name: "clubs", table: t.clubs },
  { name: "seasons", table: t.seasons },
  { name: "notices", table: t.notices },
  { name: "notification_outbox", table: t.notificationOutbox },
  { name: "notification_dedupes", table: t.notificationDedupes },
  { name: "family_members", table: t.familyMembers },
  { name: "audit_events", table: t.auditEvents },
  { name: "waitlist_entries", table: t.waitlistEntries },
  { name: "slot_swaps", table: t.slotSwaps },
  { name: "sessions", table: t.sessions },
  { name: "user_roles", table: t.userRoles },
  { name: "notice_reads", table: t.noticeReads },
  { name: "units", table: t.units },
  { name: "opening_hours", table: t.openingHours },
  { name: "closures", table: t.closures },
  { name: "activities", table: t.activities },
  { name: "incidents", table: t.incidents },
  { name: "teams", table: t.teams },
  { name: "club_members", table: t.clubMembers },
  { name: "club_requests", table: t.clubRequests },
  { name: "time_slots", table: t.timeSlots },
  { name: "season_slots", table: t.seasonSlots },
  { name: "fixed_groups", table: t.fixedGroups },
  { name: "matches", table: t.matches },
  { name: "activity_applications", table: t.activityApplications },
  { name: "open_matches", table: t.openMatches },
  { name: "bookings", table: t.bookings },
  { name: "open_match_players", table: t.openMatchPlayers },
  { name: "open_match_invites", table: t.openMatchInvites },
];

export const ALL_DEMO_TABLE_NAMES: readonly string[] = SNAPSHOT_TABLES.map(
  (entry) => entry.name,
);

type SnapshotMetaFile = {
  version: typeof SNAPSHOT_VERSION;
  format: "postgres-sql" | "pglite-json";
  savedAt: string;
  actor: string;
};

type PgliteSnapshotPayload = {
  version: typeof SNAPSHOT_VERSION;
  format: "pglite-json";
  savedAt: string;
  actor: string;
  tables: Record<string, Array<Record<string, unknown>>>;
};

export function getDemoSnapshotPath(): string | null {
  const raw = process.env.DEMO_SNAPSHOT_PATH?.trim();
  if (!raw) return null;
  return path.resolve(raw);
}

/** DEMO_SNAPSHOT_LOCKED=1 — non permitir gardar unha foto nova. */
export function isDemoSnapshotLocked(): boolean {
  const v = (process.env.DEMO_SNAPSHOT_LOCKED ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function truncateSql(): string {
  const list = ALL_DEMO_TABLE_NAMES.map((name) => `"${name}"`).join(", ");
  return `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`;
}

export type DemoRestoreLastError = {
  at: string;
  message: string;
};

export async function getDemoRestoreLastError(): Promise<DemoRestoreLastError | null> {
  if (!isDemoMode()) return null;
  try {
    const rows = await getDb()
      .select()
      .from(t.meta)
      .where(eq(t.meta.key, RESTORE_ERROR_META_KEY))
      .limit(1);
    const raw = rows[0]?.value;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DemoRestoreLastError>;
    if (
      typeof parsed.at === "string" &&
      parsed.at.trim() &&
      typeof parsed.message === "string" &&
      parsed.message.trim()
    ) {
      return { at: parsed.at, message: parsed.message };
    }
  } catch {
    return null;
  }
  return null;
}

export async function clearDemoRestoreLastError(): Promise<void> {
  if (!isDemoMode()) return;
  await getDb().delete(t.meta).where(eq(t.meta.key, RESTORE_ERROR_META_KEY));
}

export async function recordDemoRestoreFailure(
  actor: string,
  err: unknown,
): Promise<DemoRestoreLastError> {
  const message =
    err instanceof Error
      ? err.message.slice(0, 500)
      : String(err).slice(0, 500);
  const at = new Date().toISOString();
  const payload: DemoRestoreLastError = { at, message };
  const db = getDb();
  await db
    .insert(t.meta)
    .values({
      key: RESTORE_ERROR_META_KEY,
      value: JSON.stringify(payload),
    })
    .onConflictDoUpdate({
      target: t.meta.key,
      set: { value: JSON.stringify(payload) },
    });

  const platformMuni = await db
    .select({ id: t.municipalities.id })
    .from(t.municipalities)
    .where(eq(t.municipalities.id, DEPUTACION_PLATFORM_MUNI_ID))
    .limit(1);
  if (platformMuni[0]) {
    await db.insert(t.auditEvents).values({
      id: newId("audit-demo-reset-fail"),
      municipalityId: DEPUTACION_PLATFORM_MUNI_ID,
      actor,
      action: "demo.reset.failed",
      detail: message,
    });
  }
  console.error(`[demo-snapshot] restauración fallida: ${message}`);
  return payload;
}

function metaSidecarPath(snapshotPath: string): string {
  return `${snapshotPath}.meta.json`;
}

function writeFileAtomically(targetPath: string, content: string): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.tmp.${process.pid}.${randomUUID()}`;
  const fd = fs.openSync(tmpPath, "w", 0o600);
  try {
    fs.writeFileSync(fd, content, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, targetPath);
}

function fsyncAndRenameAtomically(tmpPath: string, targetPath: string): void {
  const fd = fs.openSync(tmpPath, "r+");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, targetPath);
}

function resolvePgClientBinary(tool: "pg_dump" | "psql"): string {
  const candidates = [
    `/usr/libexec/postgresql16/${tool}`,
    `/usr/bin/${tool}`,
    `/usr/local/bin/${tool}`,
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return tool;
}

export function hasDemoSnapshot(): boolean {
  if (!isDemoMode()) return false;
  const snapshotPath = getDemoSnapshotPath();
  if (!snapshotPath) return false;
  try {
    const stat = fs.statSync(snapshotPath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

export function getDemoSnapshotStatus(): {
  configured: boolean;
  exists: boolean;
  at: string | null;
  locked: boolean;
} {
  const locked = isDemoMode() && isDemoSnapshotLocked();
  if (!isDemoMode()) {
    return { configured: false, exists: false, at: null, locked: false };
  }
  const snapshotPath = getDemoSnapshotPath();
  if (!snapshotPath) {
    return { configured: false, exists: false, at: null, locked };
  }
  if (!hasDemoSnapshot()) {
    return { configured: true, exists: false, at: null, locked };
  }

  try {
    const sidecar = metaSidecarPath(snapshotPath);
    if (fs.existsSync(sidecar)) {
      const parsed = JSON.parse(
        fs.readFileSync(sidecar, "utf8"),
      ) as Partial<SnapshotMetaFile>;
      if (typeof parsed.savedAt === "string" && parsed.savedAt.trim()) {
        return { configured: true, exists: true, at: parsed.savedAt, locked };
      }
    }
  } catch {
    // Fallback to embedded metadata or file mtime below.
  }

  try {
    const head = fs.readFileSync(snapshotPath, "utf8").slice(0, 512);
    const commentMatch = head.match(/^--\s*PA_SNAPSHOT_SAVED_AT:\s*(\S+)/m);
    if (commentMatch?.[1]) {
      return {
        configured: true,
        exists: true,
        at: commentMatch[1],
        locked,
      };
    }
    if (head.trimStart().startsWith("{")) {
      const parsed = JSON.parse(
        fs.readFileSync(snapshotPath, "utf8"),
      ) as Partial<PgliteSnapshotPayload>;
      if (typeof parsed.savedAt === "string" && parsed.savedAt.trim()) {
        return {
          configured: true,
          exists: true,
          at: parsed.savedAt,
          locked,
        };
      }
    }
    const stat = fs.statSync(snapshotPath);
    return {
      configured: true,
      exists: true,
      at: stat.mtime.toISOString(),
      locked,
    };
  } catch {
    return { configured: true, exists: false, at: null, locked };
  }
}

export function getLastDemoSnapshotAt(): string | null {
  return getDemoSnapshotStatus().at;
}

function hydrateTableRow(
  table: PgTable,
  rawRow: Record<string, unknown>,
): Record<string, unknown> {
  const cols = getTableColumns(table);
  const out: Record<string, unknown> = { ...rawRow };
  for (const [propName, col] of Object.entries(cols)) {
    const val = out[propName];
    if (val === null || val === undefined) continue;
    if (col.dataType === "date" && typeof val === "string") {
      out[propName] = new Date(val);
    }
  }
  return out;
}

async function exportJsonPayload(
  savedAt: string,
  actor: string,
): Promise<PgliteSnapshotPayload> {
  const db = getDb();
  const tables: Record<string, Array<Record<string, unknown>>> = {};
  for (const entry of SNAPSHOT_TABLES) {
    const rows = (await db.select().from(entry.table)) as Array<
      Record<string, unknown>
    >;
    tables[entry.name] = rows;
  }
  return {
    version: SNAPSHOT_VERSION,
    format: "pglite-json",
    savedAt,
    actor,
    tables,
  };
}

function parseJsonSnapshotPayload(rawJson: string): PgliteSnapshotPayload {
  let parsed: Partial<PgliteSnapshotPayload>;
  try {
    parsed = JSON.parse(rawJson) as Partial<PgliteSnapshotPayload>;
  } catch {
    throw new Error("snapshot_invalid");
  }
  if (!parsed || typeof parsed !== "object" || !parsed.tables) {
    throw new Error("snapshot_invalid");
  }
  return parsed as PgliteSnapshotPayload;
}

/** TRUNCATE + inserción na mesma transacción PGlite/Drizzle. */
async function restoreFromJsonPayloadAtomic(rawJson: string): Promise<void> {
  const parsed = parseJsonSnapshotPayload(rawJson);
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(truncateSql()));
    for (const entry of SNAPSHOT_TABLES) {
      const rows = parsed.tables[entry.name];
      if (!Array.isArray(rows) || rows.length === 0) continue;
      const hydrated = rows.map((row) => hydrateTableRow(entry.table, row));
      for (let i = 0; i < hydrated.length; i += INSERT_BATCH_SIZE) {
        const chunk = hydrated.slice(i, i + INSERT_BATCH_SIZE);
        await tx.insert(entry.table).values(chunk as never);
      }
    }
  });
}

/** Postgres: TRUNCATE + ficheiro SQL na mesma entrada `--single-transaction`. */
async function restorePostgresSqlAtomic(snapshotPath: string): Promise<void> {
  const dbUrl = process.env.DATABASE_URL?.trim() ?? "";
  if (!dbUrl) throw new Error("database_url_missing");
  const psql = resolvePgClientBinary("psql");
  await execFileAsync(psql, [
    "-v",
    "ON_ERROR_STOP=1",
    "--single-transaction",
    "--quiet",
    "-c",
    truncateSql(),
    `--file=${snapshotPath}`,
    `--dbname=${dbUrl}`,
  ]);
}

export async function saveDemoSnapshot(
  actor = "system:demo-snapshot",
): Promise<{ ok: true; mode: "postgres" | "pglite"; at: string }> {
  if (!isDemoMode()) {
    throw new Error("demo_only");
  }
  if (isDemoSnapshotLocked()) {
    throw new Error("snapshot_locked");
  }
  const snapshotPath = getDemoSnapshotPath();
  if (!snapshotPath) {
    throw new Error("snapshot_path_unconfigured");
  }

  const db = getDb();
  const mode = getDbMode();
  const savedAt = new Date().toISOString();

  await db
    .insert(t.meta)
    .values({ key: "demo_snapshot_at", value: savedAt })
    .onConflictDoUpdate({
      target: t.meta.key,
      set: { value: savedAt },
    });

  const platformMuni = await db
    .select({ id: t.municipalities.id })
    .from(t.municipalities)
    .where(eq(t.municipalities.id, DEPUTACION_PLATFORM_MUNI_ID))
    .limit(1);
  if (platformMuni[0]) {
    await db.insert(t.auditEvents).values({
      id: newId("audit-demo-snap"),
      municipalityId: DEPUTACION_PLATFORM_MUNI_ID,
      actor,
      action: "demo.snapshot.save",
      detail: `mode=${mode}`,
    });
  }

  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });

  switch (mode) {
    case "postgres": {
      const dbUrl = process.env.DATABASE_URL?.trim() ?? "";
      if (!dbUrl) throw new Error("database_url_missing");
      const pgDump = resolvePgClientBinary("pg_dump");
      const tmpDumpPath = `${snapshotPath}.tmp.${process.pid}.${randomUUID()}`;
      try {
        await execFileAsync(pgDump, [
          "--data-only",
          "--no-owner",
          "--no-privileges",
          "--encoding=UTF8",
          `--file=${tmpDumpPath}`,
          `--dbname=${dbUrl}`,
        ]);
        const dumpSql = fs.readFileSync(tmpDumpPath, "utf8");
        writeFileAtomically(
          snapshotPath,
          `-- PA_SNAPSHOT_SAVED_AT: ${savedAt}\n${dumpSql}`,
        );
        fs.rmSync(tmpDumpPath, { force: true });
      } catch (err) {
        fs.rmSync(tmpDumpPath, { force: true });
        throw err;
      }
      const meta: SnapshotMetaFile = {
        version: SNAPSHOT_VERSION,
        format: "postgres-sql",
        savedAt,
        actor,
      };
      writeFileAtomically(
        metaSidecarPath(snapshotPath),
        `${JSON.stringify(meta, null, 2)}\n`,
      );
      break;
    }
    case "pglite": {
      const payload = await exportJsonPayload(savedAt, actor);
      writeFileAtomically(snapshotPath, `${JSON.stringify(payload)}\n`);
      const meta: SnapshotMetaFile = {
        version: SNAPSHOT_VERSION,
        format: "pglite-json",
        savedAt,
        actor,
      };
      writeFileAtomically(
        metaSidecarPath(snapshotPath),
        `${JSON.stringify(meta, null, 2)}\n`,
      );
      break;
    }
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }

  void fsyncAndRenameAtomically;
  return { ok: true, mode, at: savedAt };
}

/**
 * Restaura a foto: TRUNCATE + contido na mesma transacción.
 * Se falla, non se borra nada (rollback).
 */
export async function restoreDemoSnapshot(): Promise<void> {
  if (!isDemoMode()) {
    throw new Error("demo_only");
  }
  const snapshotPath = getDemoSnapshotPath();
  if (!snapshotPath || !hasDemoSnapshot()) {
    throw new Error("snapshot_not_found");
  }

  const mode = getDbMode();
  const raw = fs.readFileSync(snapshotPath, "utf8");
  const rawHead = raw.slice(0, 64).trimStart();

  switch (mode) {
    case "postgres": {
      if (rawHead.startsWith("{")) {
        await restoreFromJsonPayloadAtomic(raw);
        return;
      }
      await restorePostgresSqlAtomic(snapshotPath);
      return;
    }
    case "pglite": {
      await restoreFromJsonPayloadAtomic(raw);
      return;
    }
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}
