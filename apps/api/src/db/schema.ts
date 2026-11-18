/**
 * Esquema Drizzle — multi-concello (SPEC §2–§9).
 * Todas as táboas de negocio levan municipalityId.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  index,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** REVISION-29 Y13 — Deputación (non concello). */
export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  dir3: text("dir3"),
  logoDataUrl: text("logo_data_url"),
  /** REVISION-38 K5 — correo de contacto da organización (Deputación). */
  email: text("email"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const municipalities = pgTable("municipalities", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  accentColor: text("accent_color").notNull(),
  locales: jsonb("locales").$type<string[]>().notNull().default(["gl", "es"]),
  settings: jsonb("settings")
    .$type<{
      maxHoursPerWeek: number;
      bookingAntelationDays: number;
      maxActiveBookings?: number;
      anonymizeAfterDays?: number;
      cancelMinHours?: number;
      checkInMarginMinutes?: number;
      noShowReleaseMinutes?: number;
      noShowPenaltyCount?: number;
      noShowPenaltyDays?: number;
      noShowPenaltyWindowDays?: number;
      rulesText?: Array<{ id: string; order: number; gl: string; es: string }>;
      rulesVersion?: string;
      timezone?: string;
      staffStrongAuth?: boolean;
      demoImage?: string;
      theme?: { brand: string; accent: string };
      welcomeGl?: string;
      welcomeEs?: string;
      logoDataUrl?: string;
      legal?: {
        titular?: string;
        nif?: string;
        address?: string;
        email?: string;
        dpd?: string;
      };
      openData?: {
        license?: string;
        dir3?: string;
        catalogPublisher?: string;
      };
      /** Código INE (MeteoGalicia jsonPredConcellos). */
      ineCode?: string;
      ine?: string;
      /** Alta pública demo: oculto na lista e caduca. */
      sandbox?: boolean;
      sandboxExpiresAt?: string;
      /** REVISION-25 N3: Deputación (superadmin) pode ver datos persoais neste concello. Default false. */
      deputacionCanViewPersonalData?: boolean;
      /** REVISION-27 §3.3 — portal visible para a veciñanza. */
      portalPublished?: boolean;
      /** REVISION-29 Y13 — ancla técnica da entidade Deputación. */
      deputacionPlatform?: boolean;
      /** REVISION-40 P1 — contacto do servizo de deportes. */
      contact?: {
        serviceName?: string;
        phone?: string;
        email?: string;
        address?: string;
        hours?: string;
        web?: string;
      };
    }>()
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    municipalityId: text("municipality_id")
      .notNull()
      .references(() => municipalities.id),
    organizationId: text("organization_id").references(() => organizations.id),
    role: text("role").notNull(),
    displayName: text("display_name").notNull(),
    email: text("email"),
    /** Teléfono opcional (REVISION-17 R2 — buscar / sen conta). */
    phone: text("phone"),
    personIdentifier: text("person_identifier"),
    locale: text("locale").notNull().default("gl"),
    /** false = acceso revogado (p.ex. conserxe). */
    active: boolean("active").notNull().default(true),
    /**
     * Conta de club: 1 usuario club_manager ↔ 1 club do mesmo concello.
     * Null para cidadáns, admin, staff.
     */
    clubId: text("club_id"),
    consentAt: timestamp("consent_at", { withTimezone: true }),
    consentVersion: text("consent_version"),
    /** Preferencias de avisos (Rev4 día a día) — derivadas da matriz. */
    notifyEmail: boolean("notify_email").notNull().default(true),
    notifyReminders: boolean("notify_reminders").notNull().default(true),
    /** Matriz tipo × canle (REVISION-22 A4). Null = todo activado. */
    notifyPrefs: jsonb("notify_prefs").$type<Record<string, { email: boolean; inApp: boolean }>>(),
    /** Token para subscrición webcal (.ics persoal). */
    calendarFeedToken: text("calendar_feed_token"),
    /**
     * Ata cando a persoa non pode reservar (penalización por non presentados).
     * Null = sen bloqueo.
     */
    bookingBlockedUntil: timestamp("booking_blocked_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("users_email_idx").on(t.email),
    uniqueIndex("users_person_identifier_uidx")
      .on(t.personIdentifier)
      .where(sql`${t.personIdentifier} is not null`),
    uniqueIndex("users_calendar_feed_token_uidx")
      .on(t.calendarFeedToken)
      .where(sql`${t.calendarFeedToken} is not null`),
  ],
);

/** Estado CSRF do login con certificado (5 min, un uso). */
export const certLoginStates = pgTable("cert_login_states", {
  id: text("id").primaryKey(),
  municipalityId: text("municipality_id").notNull(),
  returnTo: text("return_to"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/** Ticket dun só uso (60 s) para crear a cookie na orixe da app. */
export const certLoginTickets = pgTable("cert_login_tickets", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  stateId: text("state_id").notNull(),
  returnTo: text("return_to"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  /** REVISION-22 B3 — club activo no conmutador «Entrar como». */
  activeClubId: text("active_club_id"),
  /** REVISION-28 X3 — rol municipal activo (staff/admin) no conmutador. */
  activeMuniRole: text("active_muni_role"),
  /** REVISION-55 G10 — concello do rol activo (cando hai o mesmo rol en dous). */
  activeMunicipalityId: text("active_municipality_id"),
  /** REVISION-50 S2 — como se entrou: saml | certificate | email_otp. */
  authMethod: text("auth_method"),
});

/** REVISION-28 X3 — varios roles por concello (veciña + conserxe, etc.). */
export const userRoles = pgTable(
  "user_roles",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    municipalityId: text("municipality_id")
      .notNull()
      .references(() => municipalities.id),
    role: text("role").notNull(),
    /** Baleiro salvo club_manager. */
    clubId: text("club_id").notNull().default(""),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.userId, t.municipalityId, t.role, t.clubId],
    }),
  ],
);

/** REVISION-27 §3.2 / REVISION-28 — convites dun só uso. */
export const invitations = pgTable("invitations", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  municipalityId: text("municipality_id")
    .notNull()
    .references(() => municipalities.id),
  organizationId: text("organization_id").references(() => organizations.id),
  role: text("role").notNull(),
  email: text("email"),
  /** Nome proposto no convite (REVISION-30 Z1). */
  displayName: text("display_name"),
  personIdentifier: text("person_identifier"),
  clubId: text("club_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const otpChallenges = pgTable("otp_challenges", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  code: text("code").notNull(),
  municipalityId: text("municipality_id").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  /** REVISION-50 S1 — cambio de correo (user_id + purpose=email_change). */
  userId: text("user_id"),
  purpose: text("purpose"),
});

/** Rate limit OTP por correo (persistente). */
export const otpRateLimits = pgTable("otp_rate_limits", {
  email: text("email").primaryKey(),
  hits: jsonb("hits").$type<number[]>().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const facilities = pgTable("facilities", {
  id: text("id").primaryKey(),
  municipalityId: text("municipality_id")
    .notNull()
    .references(() => municipalities.id),
  name: text("name").notNull(),
  type: text("type").notNull(),
  address: text("address").notNull(),
  lat: text("lat").notNull(),
  lng: text("lng").notNull(),
  accessibility: text("accessibility").notNull(),
  services: jsonb("services").$type<string[]>().notNull().default([]),
  rules: text("rules").notNull(),
  active: boolean("active").notNull().default(true),
  /** TANDA-1: ao aire libre → avisos MeteoGalicia. */
  outdoor: boolean("outdoor").notNull().default(false),
  /** REVISION-25 N2: liberación automática sen check-in só se está activo. */
  checkInRequired: boolean("check_in_required").notNull().default(false),
  /** REVISION-40 M7: partidos abertos permitidos (defecto si en pista/pavillón). */
  openMatchesAllowed: boolean("open_matches_allowed"),
  /** REVISION-40 P1 — contacto da instalación (opcional). */
  contactPhone: text("contact_phone"),
  contactEmail: text("contact_email"),
  contactPerson: text("contact_person"),
  /** Como chegar — textos opcionais (máx. 200). */
  parkingInfo: text("parking_info"),
  publicTransport: text("public_transport"),
  entranceInfo: text("entrance_info"),
  imageDataUrl: text("image_data_url"),
  /** REVISION-46 D3 — descrición para lectores de pantalla. */
  imageAlt: text("image_alt"),
  rulesOverride: jsonb("rules_override").$type<Record<string, unknown> | null>(),
  rulesText: jsonb("rules_text").$type<
    Array<{ id: string; order: number; gl: string; es: string }> | null
  >(),
});

export const units = pgTable("units", {
  id: text("id").primaryKey(),
  facilityId: text("facility_id")
    .notNull()
    .references(() => facilities.id),
  municipalityId: text("municipality_id")
    .notNull()
    .references(() => municipalities.id),
  name: text("name").notNull(),
  incompatibleWith: jsonb("incompatible_with").$type<string[]>().notNull().default([]),
  bookingKind: text("booking_kind").notNull().default("ambas"),
  slotMinutes: integer("slot_minutes").notNull().default(60),
  capacity: integer("capacity").notNull().default(4),
  active: boolean("active").notNull().default(true),
});

export const timeSlots = pgTable(
  "time_slots",
  {
    id: text("id").primaryKey(),
    unitId: text("unit_id")
      .notNull()
      .references(() => units.id),
    municipalityId: text("municipality_id")
      .notNull()
      .references(() => municipalities.id),
    date: text("date").notNull(),
    start: text("start").notNull(),
    end: text("end").notNull(),
    closed: boolean("closed").notNull().default(false),
    closedReason: text("closed_reason"),
    /** Franxa apartada para a primeira da cola (AVISOS §3). */
    heldForUserId: text("held_for_user_id"),
    heldUntil: timestamp("held_until", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("slots_unit_date_start_idx").on(
      table.unitId,
      table.date,
      table.start,
    ),
    index("slots_muni_date_idx").on(table.municipalityId, table.date),
  ],
);

export const bookings = pgTable(
  "bookings",
  {
    id: text("id").primaryKey(),
    municipalityId: text("municipality_id")
      .notNull()
      .references(() => municipalities.id),
    unitId: text("unit_id")
      .notNull()
      .references(() => units.id),
    facilityId: text("facility_id")
      .notNull()
      .references(() => facilities.id),
    /**
     * Ordinary writes require an owner. The physical column is nullable so the
     * dedicated anonymizers can assign SQL NULL after expiry/account closure.
     */
    userId: text("user_id"),
    userDisplayName: text("user_display_name").notNull(),
    slotId: text("slot_id")
      .notNull()
      .references(() => timeSlots.id),
    date: text("date").notNull(),
    start: text("start").notNull(),
    end: text("end").notNull(),
    status: text("status").notNull().default("confirmed"),
    shortCode: text("short_code").notNull(),
    qrPayload: text("qr_payload").notNull(),
    forMemberId: text("for_member_id"),
    forMemberName: text("for_member_name"),
    bookedByStaff: boolean("booked_by_staff").notNull().default(false),
    rulesVersion: text("rules_version"),
    /** SEQUENCE do .ics (incrementa ao modificar a reserva). */
    icsSequence: integer("ics_sequence").notNull().default(0),
    /** REVISION-38 K2 — motivo (admin / peche / rexeitamento). */
    cancelReason: text("cancel_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("bookings_slot_active_idx")
      .on(table.slotId)
      .where(sql`${table.status} not in ('cancelled', 'no_show')`),
    index("bookings_muni_date_status_idx").on(
      table.municipalityId,
      table.date,
      table.status,
    ),
    index("bookings_muni_user_date_idx").on(
      table.municipalityId,
      table.userId,
      table.date,
    ),
  ],
);

/** Horarios de apertura (día da semana 0=dom … 6=sáb). */
export const openingHours = pgTable("opening_hours", {
  id: text("id").primaryKey(),
  municipalityId: text("municipality_id")
    .notNull()
    .references(() => municipalities.id),
  facilityId: text("facility_id").references(() => facilities.id),
  unitId: text("unit_id").references(() => units.id),
  weekday: integer("weekday").notNull(),
  open: text("open").notNull(),
  close: text("close").notNull(),
  validFrom: text("valid_from"),
  validTo: text("valid_to"),
});

/** Peches temporais (instalación ou unidade). */
export const closures = pgTable("closures", {
  id: text("id").primaryKey(),
  municipalityId: text("municipality_id")
    .notNull()
    .references(() => municipalities.id),
  facilityId: text("facility_id").references(() => facilities.id),
  unitId: text("unit_id").references(() => units.id),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at").notNull(),
  reason: text("reason").notNull(),
  notifyCitizens: boolean("notify_citizens").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const clubs = pgTable("clubs", {
  id: text("id").primaryKey(),
  municipalityId: text("municipality_id")
    .notNull()
    .references(() => municipalities.id),
  name: text("name").notNull(),
  shortName: text("short_name").notNull(),
  /** REVISION-22 B3 */
  cif: text("cif"),
  sport: text("sport"),
  email: text("email"),
});

/** Solicitudes de clubs (tempada / partido) pendentes de aprobación. */
export const clubRequests = pgTable("club_requests", {
  id: text("id").primaryKey(),
  municipalityId: text("municipality_id")
    .notNull()
    .references(() => municipalities.id),
  clubId: text("club_id")
    .notNull()
    .references(() => clubs.id),
  type: text("type").notNull(),
  status: text("status").notNull().default("pending"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  note: text("note"),
  rejectReason: text("reject_reason"),
  createdByUserId: text("created_by_user_id").notNull(),
  createdByName: text("created_by_name").notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const teams = pgTable("teams", {
  id: text("id").primaryKey(),
  clubId: text("club_id")
    .notNull()
    .references(() => clubs.id),
  municipalityId: text("municipality_id")
    .notNull()
    .references(() => municipalities.id),
  name: text("name").notNull(),
  category: text("category").notNull(),
});

export const matches = pgTable("matches", {
  id: text("id").primaryKey(),
  municipalityId: text("municipality_id")
    .notNull()
    .references(() => municipalities.id),
  facilityId: text("facility_id")
    .notNull()
    .references(() => facilities.id),
  unitId: text("unit_id")
    .notNull()
    .references(() => units.id),
  date: text("date").notNull(),
  start: text("start").notNull(),
  end: text("end").notNull(),
  homeTeamId: text("home_team_id").notNull(),
  awayTeamId: text("away_team_id").notNull(),
  clubId: text("club_id")
    .notNull()
    .references(() => clubs.id),
  status: text("status").notNull().default("scheduled"),
  conflictWith: jsonb("conflict_with").$type<string[]>().notNull().default([]),
  notes: text("notes"),
});

export const slotSwaps = pgTable("slot_swaps", {
  id: text("id").primaryKey(),
  municipalityId: text("municipality_id")
    .notNull()
    .references(() => municipalities.id),
  fromMatchId: text("from_match_id").notNull(),
  toMatchId: text("to_match_id").notNull(),
  status: text("status").notNull().default("proposed"),
});

export const activities = pgTable("activities", {
  id: text("id").primaryKey(),
  municipalityId: text("municipality_id")
    .notNull()
    .references(() => municipalities.id),
  facilityId: text("facility_id")
    .notNull()
    .references(() => facilities.id),
  name: text("name").notNull(),
  description: text("description").notNull(),
  days: text("days").notNull(),
  hours: text("hours").notNull(),
  places: integer("places").notNull(),
  ageMin: integer("age_min").notNull(),
  ageMax: integer("age_max").notNull(),
  method: text("method").notNull(),
  deadline: text("deadline").notNull(),
  lotteryStatus: text("lottery_status").notNull().default("open"),
  lotterySeedHash: text("lottery_seed_hash"),
  lotterySecret: text("lottery_secret"),
  lotteryResultOrder: jsonb("lottery_result_order").$type<string[] | null>(),
});

export const activityApplications = pgTable(
  "activity_applications",
  {
    id: text("id").primaryKey(),
    activityId: text("activity_id")
      .notNull()
      .references(() => activities.id),
    municipalityId: text("municipality_id")
      .notNull()
      .references(() => municipalities.id),
    userId: text("user_id").notNull(),
    /** REVISION-51 C1 — familiar inscrito (null = a propia persoa). */
    forMemberId: text("for_member_id"),
    forMemberName: text("for_member_name"),
    applicationNumber: text("application_number").notNull(),
    priorityGroup: text("priority_group").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("activity_applications_number_idx").on(
      table.activityId,
      table.applicationNumber,
    ),
  ],
);

export const notices = pgTable(
  "notices",
  {
    id: text("id").primaryKey(),
    municipalityId: text("municipality_id")
      .notNull()
      .references(() => municipalities.id),
    userId: text("user_id"),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** Datos estruturados (data, hora, facilityId…) para formatar na UI. */
    payload: jsonb("payload").$type<Record<string, unknown> | null>(),
    /** @deprecated Preferir notice_reads por usuario. Mantense por compat seed. */
    read: boolean("read").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("notices_muni_user_created_idx").on(
      table.municipalityId,
      table.userId,
      table.createdAt,
    ),
  ],
);

/**
 * Avisos que deben saír só despois de confirmar a transacción de negocio.
 * dedupeKey fai que reintentar unha operación non duplique a entrega.
 */
export const notificationOutbox = pgTable(
  "notification_outbox",
  {
    id: text("id").primaryKey(),
    dedupeKey: text("dedupe_key").notNull(),
    municipalityId: text("municipality_id")
      .notNull()
      .references(() => municipalities.id),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("notification_outbox_dedupe_idx").on(table.dedupeKey),
  ],
);

/** Estado lido por usuario (avisos públicos e persoais). */
export const noticeReads = pgTable(
  "notice_reads",
  {
    noticeId: text("notice_id")
      .notNull()
      .references(() => notices.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.noticeId, table.userId] }),
  }),
);

export const familyMembers = pgTable("family_members", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  municipalityId: text("municipality_id")
    .notNull()
    .references(() => municipalities.id),
  displayName: text("display_name").notNull(),
  birthYear: integer("birth_year"),
  relation: text("relation").notNull(),
});

/** REVISION-22 B4 — campaña de tempada publicada. */
export const seasons = pgTable("seasons", {
  id: text("id").primaryKey(),
  municipalityId: text("municipality_id")
    .notNull()
    .references(() => municipalities.id),
  name: text("name").notNull(),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at").notNull(),
  facilityIds: jsonb("facility_ids").$type<string[]>().notNull().default([]),
  criteriaGl: text("criteria_gl").notNull().default(""),
  criteriaEs: text("criteria_es").notNull().default(""),
  published: boolean("published").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const seasonSlots = pgTable("season_slots", {
  id: text("id").primaryKey(),
  municipalityId: text("municipality_id")
    .notNull()
    .references(() => municipalities.id),
  clubId: text("club_id")
    .notNull()
    .references(() => clubs.id),
  facilityId: text("facility_id")
    .notNull()
    .references(() => facilities.id),
  unitId: text("unit_id")
    .notNull()
    .references(() => units.id),
  weekday: integer("weekday").notNull(),
  start: text("start").notNull(),
  end: text("end").notNull(),
  priority: integer("priority").notNull().default(1),
  /** Opcional: ligazón á campaña B4. */
  seasonId: text("season_id"),
  /** REVISION-58 K3: fin do bloqueo se non hai campaña. */
  validTo: text("valid_to"),
});

export const clubMembers = pgTable("club_members", {
  id: text("id").primaryKey(),
  clubId: text("club_id")
    .notNull()
    .references(() => clubs.id),
  municipalityId: text("municipality_id")
    .notNull()
    .references(() => municipalities.id),
  displayName: text("display_name").notNull(),
  email: text("email").notNull(),
  role: text("role").notNull(),
  /** REVISION-22 B3 — persoa xa autenticada (nullable = só convite legado). */
  userId: text("user_id"),
});

export const auditEvents = pgTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    municipalityId: text("municipality_id")
      .notNull()
      .references(() => municipalities.id),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    detail: text("detail").notNull(),
  },
  (table) => [
    index("audit_events_muni_at_idx").on(table.municipalityId, table.at),
    index("audit_events_muni_actor_at_idx").on(
      table.municipalityId,
      table.actor,
      table.at,
    ),
  ],
);

export const waitlistEntries = pgTable(
  "waitlist_entries",
  {
    id: text("id").primaryKey(),
    municipalityId: text("municipality_id")
      .notNull()
      .references(() => municipalities.id),
    slotId: text("slot_id").notNull(),
    userId: text("user_id").notNull(),
    userDisplayName: text("user_display_name").notNull(),
    status: text("status").notNull().default("waiting"),
    offeredUntil: timestamp("offered_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("waitlist_muni_status_created_idx").on(
      table.municipalityId,
      table.status,
      table.createdAt,
    ),
    index("waitlist_muni_user_status_idx").on(
      table.municipalityId,
      table.userId,
      table.status,
    ),
  ],
);

/** Incidencias da veciñanza / conserxería (Rev3 D1). */
export const incidents = pgTable(
  "incidents",
  {
    id: text("id").primaryKey(),
    municipalityId: text("municipality_id")
      .notNull()
      .references(() => municipalities.id),
    facilityId: text("facility_id").references(() => facilities.id),
    userId: text("user_id").notNull(),
    userDisplayName: text("user_display_name").notNull(),
    body: text("body").notNull(),
    photoDataUrl: text("photo_data_url"),
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    index("incidents_muni_status_created_idx").on(
      table.municipalityId,
      table.status,
      table.createdAt,
    ),
    index("incidents_muni_user_created_idx").on(
      table.municipalityId,
      table.userId,
      table.createdAt,
    ),
  ],
);

/** Claims idempotentes para jobs de notificación. */
export const notificationDedupes = pgTable(
  "notification_dedupes",
  {
    key: text("key").primaryKey(),
    municipalityId: text("municipality_id")
      .notNull()
      .references(() => municipalities.id),
    userId: text("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("notification_dedupes_muni_created_idx").on(
      table.municipalityId,
      table.createdAt,
    ),
  ],
);

/** Grupos fixos / trimestre (Rev3 D3). */
export const fixedGroups = pgTable("fixed_groups", {
  id: text("id").primaryKey(),
  municipalityId: text("municipality_id")
    .notNull()
    .references(() => municipalities.id),
  facilityId: text("facility_id")
    .notNull()
    .references(() => facilities.id),
  unitId: text("unit_id")
    .notNull()
    .references(() => units.id),
  name: text("name").notNull(),
  weekday: integer("weekday").notNull(),
  start: text("start").notNull(),
  end: text("end").notNull(),
  validFrom: text("valid_from").notNull(),
  validTo: text("valid_to").notNull(),
  clubId: text("club_id"),
  createdBy: text("created_by").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * TANDA-2 — Partidos abertos («busco xente»).
 * Independentes dos partidos de clubs (táboa matches).
 */
export const openMatches = pgTable("open_matches", {
  id: text("id").primaryKey(),
  municipalityId: text("municipality_id")
    .notNull()
    .references(() => municipalities.id),
  facilityId: text("facility_id")
    .notNull()
    .references(() => facilities.id),
  unitId: text("unit_id")
    .notNull()
    .references(() => units.id),
  bookingId: text("booking_id"),
  organizerUserId: text("organizer_user_id").notNull(),
  title: text("title").notNull(),
  sport: text("sport").notNull().default("padel"),
  date: text("date").notNull(),
  start: text("start").notNull(),
  end: text("end").notNull(),
  spotsTotal: integer("spots_total").notNull().default(4),
  level: text("level"),
  notes: text("notes"),
  status: text("status").notNull().default("open"),
  qrToken: text("qr_token").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const openMatchPlayers = pgTable(
  "open_match_players",
  {
    openMatchId: text("open_match_id")
      .notNull()
      .references(() => openMatches.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role").notNull().default("player"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
    /** Consentimento para amosar o nome na lista (art. 6.1.a RGPD). */
    nameConsentAt: timestamp("name_consent_at", { withTimezone: true }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.openMatchId, table.userId] }),
  }),
);

export const openMatchInvites = pgTable("open_match_invites", {
  id: text("id").primaryKey(),
  openMatchId: text("open_match_id")
    .notNull()
    .references(() => openMatches.id, { onDelete: "cascade" }),
  municipalityId: text("municipality_id")
    .notNull()
    .references(() => municipalities.id),
  fromUserId: text("from_user_id").notNull(),
  toUserId: text("to_user_id"),
  toEmail: text("to_email"),
  token: text("token").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const meta = pgTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/** Evita import ciclico non usado. */
void primaryKey;
