/**
 * Aplica o esquema (CREATE TABLE IF NOT EXISTS) — compatible Postgres e PGlite.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { getDb, getDbMode, type AppDb } from "./client.js";
import * as t from "./schema.js";

const DDL = `
CREATE TABLE IF NOT EXISTS municipalities (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  accent_color text NOT NULL,
  locales jsonb NOT NULL DEFAULT '["gl","es"]',
  settings jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  municipality_id text NOT NULL REFERENCES municipalities(id),
  role text NOT NULL,
  display_name text NOT NULL,
  email text,
  person_identifier text,
  locale text NOT NULL DEFAULT 'gl',
  active boolean NOT NULL DEFAULT true,
  club_id text,
  consent_at timestamptz,
  consent_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users(email);
ALTER TABLE users ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS club_id text;

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS otp_challenges (
  id text PRIMARY KEY,
  email text NOT NULL,
  code text NOT NULL,
  municipality_id text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE otp_challenges ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE otp_challenges ADD COLUMN IF NOT EXISTS user_id text;
ALTER TABLE otp_challenges ADD COLUMN IF NOT EXISTS purpose text;

CREATE TABLE IF NOT EXISTS otp_rate_limits (
  email text PRIMARY KEY,
  hits jsonb NOT NULL DEFAULT '[]',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS facilities (
  id text PRIMARY KEY,
  municipality_id text NOT NULL REFERENCES municipalities(id),
  name text NOT NULL,
  type text NOT NULL,
  address text NOT NULL,
  lat text NOT NULL,
  lng text NOT NULL,
  accessibility text NOT NULL,
  services jsonb NOT NULL DEFAULT '[]',
  rules text NOT NULL,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS units (
  id text PRIMARY KEY,
  facility_id text NOT NULL REFERENCES facilities(id),
  municipality_id text NOT NULL REFERENCES municipalities(id),
  name text NOT NULL,
  incompatible_with jsonb NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS time_slots (
  id text PRIMARY KEY,
  unit_id text NOT NULL REFERENCES units(id),
  municipality_id text NOT NULL REFERENCES municipalities(id),
  date text NOT NULL,
  start text NOT NULL,
  "end" text NOT NULL,
  closed boolean NOT NULL DEFAULT false,
  closed_reason text
);
CREATE UNIQUE INDEX IF NOT EXISTS slots_unit_date_start_idx ON time_slots(unit_id, date, start);

CREATE TABLE IF NOT EXISTS bookings (
  id text PRIMARY KEY,
  municipality_id text NOT NULL REFERENCES municipalities(id),
  unit_id text NOT NULL REFERENCES units(id),
  facility_id text NOT NULL REFERENCES facilities(id),
  user_id text,
  user_display_name text NOT NULL,
  slot_id text NOT NULL REFERENCES time_slots(id),
  date text NOT NULL,
  start text NOT NULL,
  "end" text NOT NULL,
  status text NOT NULL DEFAULT 'confirmed',
  short_code text NOT NULL,
  qr_payload text NOT NULL,
  for_member_id text,
  for_member_name text,
  booked_by_staff boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS bookings_slot_active_idx ON bookings(slot_id) WHERE status NOT IN ('cancelled', 'no_show');
CREATE INDEX IF NOT EXISTS bookings_muni_date_status_idx
  ON bookings(municipality_id, date, status);
CREATE INDEX IF NOT EXISTS bookings_muni_user_date_idx
  ON bookings(municipality_id, user_id, date);
/* P2.5 — o historial anonimizado non conserva unha chave persoal enlazable. */
ALTER TABLE bookings ALTER COLUMN user_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS clubs (
  id text PRIMARY KEY,
  municipality_id text NOT NULL REFERENCES municipalities(id),
  name text NOT NULL,
  short_name text NOT NULL
);

CREATE TABLE IF NOT EXISTS teams (
  id text PRIMARY KEY,
  club_id text NOT NULL REFERENCES clubs(id),
  municipality_id text NOT NULL REFERENCES municipalities(id),
  name text NOT NULL,
  category text NOT NULL
);

CREATE TABLE IF NOT EXISTS matches (
  id text PRIMARY KEY,
  municipality_id text NOT NULL REFERENCES municipalities(id),
  facility_id text NOT NULL REFERENCES facilities(id),
  unit_id text NOT NULL REFERENCES units(id),
  date text NOT NULL,
  start text NOT NULL,
  "end" text NOT NULL,
  home_team_id text NOT NULL,
  away_team_id text NOT NULL,
  club_id text NOT NULL REFERENCES clubs(id),
  status text NOT NULL DEFAULT 'scheduled',
  conflict_with jsonb NOT NULL DEFAULT '[]',
  notes text
);

CREATE TABLE IF NOT EXISTS slot_swaps (
  id text PRIMARY KEY,
  municipality_id text NOT NULL REFERENCES municipalities(id),
  from_match_id text NOT NULL,
  to_match_id text NOT NULL,
  status text NOT NULL DEFAULT 'proposed'
);

CREATE TABLE IF NOT EXISTS activities (
  id text PRIMARY KEY,
  municipality_id text NOT NULL REFERENCES municipalities(id),
  facility_id text NOT NULL REFERENCES facilities(id),
  name text NOT NULL,
  description text NOT NULL,
  days text NOT NULL,
  hours text NOT NULL,
  places integer NOT NULL,
  age_min integer NOT NULL,
  age_max integer NOT NULL,
  method text NOT NULL,
  deadline text NOT NULL,
  lottery_status text NOT NULL DEFAULT 'open',
  lottery_seed_hash text,
  lottery_secret text,
  lottery_result_order jsonb
);

CREATE TABLE IF NOT EXISTS activity_applications (
  id text PRIMARY KEY,
  activity_id text NOT NULL REFERENCES activities(id),
  municipality_id text NOT NULL REFERENCES municipalities(id),
  user_id text NOT NULL,
  application_number text NOT NULL,
  priority_group text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS activity_applications_user_activity_idx ON activity_applications(activity_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS activity_applications_number_idx ON activity_applications(activity_id, application_number);

CREATE TABLE IF NOT EXISTS notices (
  id text PRIMARY KEY,
  municipality_id text NOT NULL REFERENCES municipalities(id),
  user_id text,
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notices_muni_user_created_idx
  ON notices(municipality_id, user_id, created_at);

CREATE TABLE IF NOT EXISTS notification_outbox (
  id text PRIMARY KEY,
  dedupe_key text NOT NULL UNIQUE,
  municipality_id text NOT NULL REFERENCES municipalities(id),
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS notification_outbox_dedupe_idx
  ON notification_outbox(dedupe_key);

CREATE TABLE IF NOT EXISTS notice_reads (
  notice_id text NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notice_id, user_id)
);

CREATE TABLE IF NOT EXISTS family_members (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  municipality_id text NOT NULL REFERENCES municipalities(id),
  display_name text NOT NULL,
  birth_year integer,
  relation text NOT NULL
);

CREATE TABLE IF NOT EXISTS season_slots (
  id text PRIMARY KEY,
  municipality_id text NOT NULL REFERENCES municipalities(id),
  club_id text NOT NULL REFERENCES clubs(id),
  facility_id text NOT NULL REFERENCES facilities(id),
  unit_id text NOT NULL REFERENCES units(id),
  weekday integer NOT NULL,
  start text NOT NULL,
  "end" text NOT NULL,
  priority integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS club_members (
  id text PRIMARY KEY,
  club_id text NOT NULL REFERENCES clubs(id),
  municipality_id text NOT NULL REFERENCES municipalities(id),
  display_name text NOT NULL,
  email text NOT NULL,
  role text NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id text PRIMARY KEY,
  municipality_id text NOT NULL REFERENCES municipalities(id),
  at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  action text NOT NULL,
  detail text NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_events_muni_at_idx
  ON audit_events(municipality_id, at);
CREATE INDEX IF NOT EXISTS audit_events_muni_actor_at_idx
  ON audit_events(municipality_id, actor, at);

CREATE TABLE IF NOT EXISTS waitlist_entries (
  id text PRIMARY KEY,
  municipality_id text NOT NULL REFERENCES municipalities(id),
  slot_id text NOT NULL,
  user_id text NOT NULL,
  user_display_name text NOT NULL,
  status text NOT NULL DEFAULT 'waiting',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS waitlist_muni_status_created_idx
  ON waitlist_entries(municipality_id, status, created_at);
CREATE INDEX IF NOT EXISTS waitlist_muni_user_status_idx
  ON waitlist_entries(municipality_id, user_id, status);

CREATE TABLE IF NOT EXISTS meta (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS cert_login_states (
  id text PRIMARY KEY,
  municipality_id text NOT NULL,
  return_to text,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS cert_login_tickets (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  state_id text NOT NULL,
  return_to text,
  expires_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS users_person_identifier_uidx
  ON users(person_identifier)
  WHERE person_identifier IS NOT NULL;

ALTER TABLE facilities ADD COLUMN IF NOT EXISTS rules_override jsonb;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS rules_text jsonb;
ALTER TABLE units ADD COLUMN IF NOT EXISTS booking_kind text NOT NULL DEFAULT 'ambas';
ALTER TABLE units ADD COLUMN IF NOT EXISTS slot_minutes integer NOT NULL DEFAULT 60;
ALTER TABLE units ADD COLUMN IF NOT EXISTS capacity integer NOT NULL DEFAULT 4;
ALTER TABLE units ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS rules_version text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS ics_sequence integer NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancel_reason text;

CREATE TABLE IF NOT EXISTS opening_hours (
  id text PRIMARY KEY,
  municipality_id text NOT NULL REFERENCES municipalities(id),
  facility_id text REFERENCES facilities(id),
  unit_id text REFERENCES units(id),
  weekday integer NOT NULL,
  open text NOT NULL,
  close text NOT NULL,
  valid_from text,
  valid_to text
);

CREATE TABLE IF NOT EXISTS closures (
  id text PRIMARY KEY,
  municipality_id text NOT NULL REFERENCES municipalities(id),
  facility_id text REFERENCES facilities(id),
  unit_id text REFERENCES units(id),
  starts_at text NOT NULL,
  ends_at text NOT NULL,
  reason text NOT NULL,
  notify_citizens boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS club_requests (
  id text PRIMARY KEY,
  municipality_id text NOT NULL REFERENCES municipalities(id),
  club_id text NOT NULL REFERENCES clubs(id),
  type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  payload jsonb NOT NULL,
  note text,
  reject_reason text,
  created_by_user_id text NOT NULL,
  created_by_name text NOT NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS incidents (
  id text PRIMARY KEY,
  municipality_id text NOT NULL REFERENCES municipalities(id),
  facility_id text REFERENCES facilities(id),
  user_id text NOT NULL,
  user_display_name text NOT NULL,
  body text NOT NULL,
  photo_data_url text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS incidents_muni_status_created_idx
  ON incidents(municipality_id, status, created_at);
CREATE INDEX IF NOT EXISTS incidents_muni_user_created_idx
  ON incidents(municipality_id, user_id, created_at);

CREATE TABLE IF NOT EXISTS notification_dedupes (
  key text PRIMARY KEY,
  municipality_id text NOT NULL REFERENCES municipalities(id),
  user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notification_dedupes_muni_created_idx
  ON notification_dedupes(municipality_id, created_at);

CREATE TABLE IF NOT EXISTS fixed_groups (
  id text PRIMARY KEY,
  municipality_id text NOT NULL REFERENCES municipalities(id),
  facility_id text NOT NULL REFERENCES facilities(id),
  unit_id text NOT NULL REFERENCES units(id),
  name text NOT NULL,
  weekday integer NOT NULL,
  start text NOT NULL,
  "end" text NOT NULL,
  valid_from text NOT NULL,
  valid_to text NOT NULL,
  club_id text,
  created_by text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE waitlist_entries ADD COLUMN IF NOT EXISTS offered_until timestamptz;
ALTER TABLE time_slots ADD COLUMN IF NOT EXISTS held_for_user_id text;
ALTER TABLE time_slots ADD COLUMN IF NOT EXISTS held_until timestamptz;
CREATE INDEX IF NOT EXISTS slots_muni_date_idx ON time_slots(municipality_id, date);
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS image_data_url text;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS image_alt text;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS check_in_required boolean NOT NULL DEFAULT false;
/* TANDA-1 — MeteoGalicia */
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS outdoor boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_email boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_reminders boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS calendar_feed_token text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS booking_blocked_until timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS users_calendar_feed_token_uidx
  ON users(calendar_feed_token)
  WHERE calendar_feed_token IS NOT NULL;
ALTER TABLE notices ADD COLUMN IF NOT EXISTS payload jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_prefs jsonb;

/* REVISION-22 B3 — clubs multi-responsable */
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS cif text;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS sport text;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE club_members ADD COLUMN IF NOT EXISTS user_id text;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS active_club_id text;

/* REVISION-28 X3 / §3.2 — roles por concello e convites */
CREATE TABLE IF NOT EXISTS user_roles (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  municipality_id text NOT NULL REFERENCES municipalities(id),
  role text NOT NULL,
  club_id text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, municipality_id, role, club_id)
);

CREATE TABLE IF NOT EXISTS invitations (
  id text PRIMARY KEY,
  token text NOT NULL UNIQUE,
  municipality_id text NOT NULL REFERENCES municipalities(id),
  role text NOT NULL,
  email text,
  person_identifier text,
  club_id text,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS active_muni_role text;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS auth_method text;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS active_municipality_id text;

INSERT INTO user_roles (user_id, municipality_id, role, club_id)
SELECT id, municipality_id, role, COALESCE(club_id, '')
FROM users
ON CONFLICT DO NOTHING;

INSERT INTO user_roles (user_id, municipality_id, role, club_id)
SELECT cm.user_id, cm.municipality_id, 'club_manager', cm.club_id
FROM club_members cm
WHERE cm.user_id IS NOT NULL
ON CONFLICT DO NOTHING;

/* REVISION-22 B4 — tempadas publicadas */
CREATE TABLE IF NOT EXISTS seasons (
  id text PRIMARY KEY,
  municipality_id text NOT NULL REFERENCES municipalities(id),
  name text NOT NULL,
  starts_at text NOT NULL,
  ends_at text NOT NULL,
  facility_ids jsonb NOT NULL DEFAULT '[]',
  criteria_gl text NOT NULL DEFAULT '',
  criteria_es text NOT NULL DEFAULT '',
  published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE season_slots ADD COLUMN IF NOT EXISTS season_id text;
ALTER TABLE season_slots ADD COLUMN IF NOT EXISTS valid_to text;
/* REVISION-59 L5 — lexado sen campaña nin data: pechar o 30 de xuño da tempada actual */
UPDATE season_slots
SET valid_to = CASE
  WHEN CAST(EXTRACT(MONTH FROM CURRENT_DATE) AS integer) >= 7
  THEN (CAST(EXTRACT(YEAR FROM CURRENT_DATE) AS integer) + 1)::text || '-06-30'
  ELSE CAST(EXTRACT(YEAR FROM CURRENT_DATE) AS integer)::text || '-06-30'
END
WHERE season_id IS NULL AND valid_to IS NULL;

CREATE TABLE IF NOT EXISTS organizations (
  id text PRIMARY KEY,
  name text NOT NULL,
  dir3 text,
  logo_data_url text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS email text;

ALTER TABLE users ADD COLUMN IF NOT EXISTS organization_id text;
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS organization_id text;
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS display_name text;

/* TANDA-1 — outdoor default unha soa vez (non sobrescribir eleccións posteriores) */
INSERT INTO meta (key, value)
  SELECT 'tanda1_outdoor_defaults', 'pending'
  WHERE NOT EXISTS (SELECT 1 FROM meta WHERE key = 'tanda1_outdoor_defaults');
UPDATE facilities SET outdoor = true
  WHERE outdoor = false
    AND type IN ('pista', 'campo')
    AND EXISTS (
      SELECT 1 FROM meta WHERE key = 'tanda1_outdoor_defaults' AND value = 'pending'
    );
UPDATE meta SET value = 'done'
  WHERE key = 'tanda1_outdoor_defaults' AND value = 'pending';

/* REVISION-40 M7 — partidos abertos por instalación */
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS open_matches_allowed boolean;

/* REVISION-40 P1 — contacto por instalación */
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS contact_phone text;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS contact_email text;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS contact_person text;

/* Como chegar — aparcamento / transporte / entrada (accesibilidade xa existía) */
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS parking_info text;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS public_transport text;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS entrance_info text;

/* TANDA-2 — Partidos abertos */
CREATE TABLE IF NOT EXISTS open_matches (
  id text PRIMARY KEY,
  municipality_id text NOT NULL REFERENCES municipalities(id),
  facility_id text NOT NULL REFERENCES facilities(id),
  unit_id text NOT NULL REFERENCES units(id),
  booking_id text,
  organizer_user_id text NOT NULL,
  title text NOT NULL,
  sport text NOT NULL DEFAULT 'padel',
  date text NOT NULL,
  start text NOT NULL,
  "end" text NOT NULL,
  spots_total integer NOT NULL DEFAULT 4,
  level text,
  notes text,
  status text NOT NULL DEFAULT 'open',
  qr_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS open_match_players (
  open_match_id text NOT NULL REFERENCES open_matches(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL DEFAULT 'player',
  joined_at timestamptz NOT NULL DEFAULT now(),
  name_consent_at timestamptz,
  PRIMARY KEY (open_match_id, user_id)
);
ALTER TABLE open_match_players ADD COLUMN IF NOT EXISTS name_consent_at timestamptz;

/* REVISION-51 C1 — inscrición de familiares */
ALTER TABLE activity_applications ADD COLUMN IF NOT EXISTS for_member_id text;
ALTER TABLE activity_applications ADD COLUMN IF NOT EXISTS for_member_name text;
DROP INDEX IF EXISTS activity_applications_user_activity_idx;
CREATE UNIQUE INDEX IF NOT EXISTS activity_applications_person_idx
  ON activity_applications (activity_id, user_id, COALESCE(for_member_id, ''));
CREATE TABLE IF NOT EXISTS open_match_invites (
  id text PRIMARY KEY,
  open_match_id text NOT NULL REFERENCES open_matches(id) ON DELETE CASCADE,
  municipality_id text NOT NULL REFERENCES municipalities(id),
  from_user_id text NOT NULL,
  to_user_id text,
  to_email text,
  token text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

/** REVISION-40 N2 — settings.ineCode desde o censo por slug (unha soa vez). */
async function backfillMunicipalityIneCodes(d: AppDb): Promise<void> {
  await d.execute(
    sql.raw(`
INSERT INTO meta (key, value)
  SELECT 'rev40_ine_backfill', 'pending'
  WHERE NOT EXISTS (SELECT 1 FROM meta WHERE key = 'rev40_ine_backfill')
`),
  );
  const metaRows = await d
    .select()
    .from(t.meta)
    .where(eq(t.meta.key, "rev40_ine_backfill"))
    .limit(1);
  if (metaRows[0]?.value !== "pending") return;

  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../..",
  );
  const listaPath = path.join(root, "data/concellos-lista.json");
  if (!fs.existsSync(listaPath)) {
    await d
      .update(t.meta)
      .set({ value: "skipped_no_census" })
      .where(eq(t.meta.key, "rev40_ine_backfill"));
    return;
  }
  type ListaRow = { ine: string; slug: string };
  const lista = JSON.parse(fs.readFileSync(listaPath, "utf8")) as ListaRow[];
  const bySlug = new Map(
    lista
      .filter((r) => /^\d{5}$/.test(String(r.ine ?? "").trim()) && r.slug)
      .map((r) => [r.slug.trim().toLowerCase(), String(r.ine).trim()]),
  );

  const munis = await d.select().from(t.municipalities);
  for (const row of munis) {
    const settings = row.settings;
    const existing =
      String(settings.ineCode ?? settings.ine ?? "").replace(/\D/g, "").slice(0, 5);
    if (/^\d{5}$/.test(existing)) continue;
    const fromCensus = bySlug.get(String(row.slug).toLowerCase());
    if (!fromCensus) continue;
    await d
      .update(t.municipalities)
      .set({ settings: { ...settings, ineCode: fromCensus } })
      .where(eq(t.municipalities.id, row.id));
  }

  await d
    .update(t.meta)
    .set({ value: "done" })
    .where(eq(t.meta.key, "rev40_ine_backfill"));
}

/** REVISION-60 M2 — recrear bookings_slot_active_idx excluíndo tamén no_show. */
async function migrateBookingsSlotActiveIndex(d: AppDb): Promise<void> {
  const res = await d.execute(
    sql.raw(`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND indexname = 'bookings_slot_active_idx'
    `),
  );
  const rows = Array.isArray(res)
    ? res
    : ((res as { rows?: Array<{ indexdef?: string }> }).rows ?? []);
  const def = String((rows[0] as { indexdef?: string } | undefined)?.indexdef ?? "");
  if (!def || !def.includes("no_show")) {
    await d.execute(sql.raw(`DROP INDEX IF EXISTS bookings_slot_active_idx`));
    await d.execute(
      sql.raw(
        `CREATE UNIQUE INDEX bookings_slot_active_idx ON bookings(slot_id) WHERE status NOT IN ('cancelled', 'no_show')`,
      ),
    );
  }
}

export async function migrateSchema(database?: AppDb): Promise<void> {
  const d = database ?? getDb();
  // Executar por sentencias (PGlite e postgres.js)
  const statements = DDL.split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    await d.execute(sql.raw(stmt));
  }
  await migrateBookingsSlotActiveIndex(d);
  await backfillMunicipalityIneCodes(d);
  console.info(`[db] esquema aplicado (${getDbMode()})`);
}
