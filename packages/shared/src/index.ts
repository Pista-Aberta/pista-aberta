/** Tipos compartidos — demo MVP (3 lonchas). */

import type { MunicipalityContact } from "./contact.js";

export type Role =
  | "citizen"
  | "staff"
  | "monitor"
  | "club_manager"
  | "admin"
  | "superadmin";

export {
  homePathForRole,
  zoneFromPath,
  rolesForZone,
  roleAllowedInZone,
  resolvePostLoginPath,
  isSafeReturnPath,
  isElevatedRole,
  citizenMayCrossMunicipality,
  slugFromPath,
  elevatedBelongsToSlug,
  type AppZone,
} from "./roles.js";

export {
  buildUsageRulesLines,
  buildAntesDeIrRuleLines,
  ANTES_DE_IR_KINDS,
  type UsageRulesLine,
  type UsageRulesLineKind,
} from "./usage-rules-lines.js";

export {
  DEFAULT_THEME,
  resolveTheme,
  ensureBrandContrast,
  contrastRatio,
  normalizeHex,
  themeToCssVars,
  type MunicipalityTheme,
} from "./theme.js";

export {
  resolvePublicContact,
  type MunicipalityContact,
  type FacilityContactFields,
  type ResolvedContact,
} from "./contact.js";

export {
  trimComoChegar,
  comoChegarHintLine,
  hasComoChegarContent,
  osmEmbedUrl,
  osmDirectionsUrl,
  mobileMapUrl,
  type ComoChegarFields,
} from "./como-chegar.js";

export {
  DEFAULT_DISPLAY_TIMEZONE,
  formatDate,
  formatDateLong,
  formatDateShort,
  formatDateTime,
  formatDayChip,
  formatDayTimeChip,
  formatMonthYear,
  formatSentAt,
  formatTimeHm,
  formatWeekendRangeShort,
  formatWeekdayShort,
} from "./format-date.js";

export { GALICIA_HOLIDAYS_2026_2027 } from "./galicia-holidays.js";

export {
  offerCountdown,
  formatOfferCountdown,
  type OfferCountdown,
} from "./waitlist-offer.js";

export {
  shortPublicName,
  isEmailLocalPartName,
  isValidDisplayName,
  assertDisplayNameForMatch,
  csvEscapeCell,
} from "./short-public-name.js";

export {
  DEFAULT_TIMEZONE,
  localDateIso,
  slotInstant,
  isSlotInPast,
} from "./timezone.js";

export type Locale = "gl" | "es";

export type FacilityType = "pista" | "pavillon" | "campo" | "sala";

export type BookingStatus =
  | "pending"
  | "confirmed"
  | "cancelled"
  | "checked_in"
  | "no_show";

export type ActivityMethod = "first_come" | "lottery";

export type LotteryStatus = "open" | "closed" | "drawn";

/** Punto de norma en texto (GL/ES) para a veciñanza. */
export interface RulesTextItem {
  id: string;
  order: number;
  gl: string;
  es: string;
}

/** Quen pode reservar (instalación ou unidade). */
export type WhoCanBook = "vecinhaza" | "clubs" | "ambas";

/** Regras que o sistema aplica (concello ou sobrescrita por instalación). */
export interface UsageRules {
  bookingAntelationDays: number;
  maxActiveBookings: number;
  maxHoursPerWeek: number;
  cancelMinHours: number;
  checkInMarginMinutes: number;
  noShowReleaseMinutes: number;
  anonymizeAfterDays: number;
  /**
   * Penalización por non presentados: número de no-shows na xanela
   * que activan o bloqueo. 0 = desactivada (xunto con noShowPenaltyDays).
   */
  noShowPenaltyCount: number;
  /**
   * Días sen poder reservar tras alcanzar noShowPenaltyCount.
   * 0 = penalización desactivada.
   */
  noShowPenaltyDays: number;
  /**
   * REVISION-23 R11 — xanela en días para contar non presentados (antes fixa 30).
   */
  noShowPenaltyWindowDays?: number;
  /** Quen pode reservar nesta instalación (sobrescrita). */
  whoCanBook?: WhoCanBook;
  /** A reserva require aprobación do concello. */
  approvalRequired?: boolean;
  /** Prezo informativo (texto libre, sen cobro na app). */
  informativePrice?: string;
  /** Duración da franxa (min) — sobrescrita a nivel instalación. */
  slotMinutes?: number;
  /**
   * REVISION-35 G2 — check-in obrigatorio nesta instalación.
   * As liñas de QR / liberación sen check-in só saen se é true.
   */
  checkInRequired?: boolean;
}

export interface Municipality {
  id: string;
  slug: string;
  name: string;
  /** Alias legado = theme.brand (cabeceira). */
  accentColor: string;
  locales: Locale[];
  settings: {
    maxHoursPerWeek: number;
    bookingAntelationDays: number;
    /**
     * Máximo de reservas activas (status confirmed, data ≥ hoxe) por usuario.
     * Default 3 se non figura nos settings.
     */
    maxActiveBookings?: number;
    /** Días tras os que se anonimiza PII de reservas pasadas. Default 90. */
    anonymizeAfterDays?: number;
    /** Antelación mínima para cancelar (horas). Default 2. */
    cancelMinHours?: number;
    /** Marxe de check-in QR (± minutos). Default 30. */
    checkInMarginMinutes?: number;
    /** Minutos sen check-in para liberar a pista. Default 30. */
    noShowReleaseMinutes?: number;
    /** Nº de non presentados na xanela para activar penalización. */
    noShowPenaltyCount?: number;
    /** Días sen reservar tras a penalización (0 = off). */
    noShowPenaltyDays?: number;
    /** Xanela (días) para contar non presentados. Default 30. */
    noShowPenaltyWindowDays?: number;
    /** Normas en texto (GL/ES), ordenadas. */
    rulesText?: RulesTextItem[];
    /** Versión das normas (hash) para gardar na reserva ao aceptar. */
    rulesVersion?: string;
    /**
     * Zona IANA para datas/franxas/check-in (non a TZ do proceso/contedor).
     * Default Europe/Madrid.
     */
    timezone?: string;
    /** Persoal municipal require Cl@ve/certificado (non OTP). Default true en prod. */
    staffStrongAuth?: boolean;
    demoImage?: string;
    /** Paleta do concello (todos os roles). */
    theme?: {
      brand: string;
      accent: string;
    };
    /** Texto de benvida da portada (GL/ES). */
    welcomeGl?: string;
    welcomeEs?: string;
    /** Escudo (data URL SVG/PNG, máx. ~500 kB; uso interno en persistencia). */
    logoDataUrl?: string;
    /** URL pública do escudo servida por /api/c/:slug/logo (sen base64 inline). */
    logoUrl?: string | null;
    /** Datos legais para páxinas legais. */
    legal?: {
      titular?: string;
      nif?: string;
      address?: string;
      email?: string;
      dpd?: string;
      /** Sinatura dos correos (p.ex. «Servizo Municipal de Deportes»). */
      sinatura?: string;
    };
    /** REVISION-40 P1 — contacto do servizo de deportes (Personalización › Contacto). */
    contact?: MunicipalityContact;
    /** Datos abertos: licenza e DIR3 editables. */
    openData?: {
      license?: string;
      dir3?: string;
      catalogPublisher?: string;
    };
    /** Código INE do concello (MeteoGalicia). */
    ineCode?: string;
    /** @deprecated usar ineCode */
    ine?: string;
    /** Alta demo pública: non aparece na lista e caduca. */
    sandbox?: boolean;
    sandboxExpiresAt?: string;
    demoCreatedDay?: string;
    /** REVISION-25 N3: opt-in para que a Deputación vexa PII neste concello. */
    deputacionCanViewPersonalData?: boolean;
    /** REVISION-27 §3.3 — false mentres o concello non publica o portal. */
    portalPublished?: boolean;
    /** REVISION-29 Y13 — ancla técnica Deputación (non concello adherido). */
    deputacionPlatform?: boolean;
  };
}

export interface Facility {
  id: string;
  municipalityId: string;
  name: string;
  type: FacilityType;
  address: string;
  lat: number;
  lng: number;
  accessibility: string;
  services: string[];
  rules: string;
  active: boolean;
  /** TANDA-1: instalación ao aire libre (MeteoGalicia). */
  outdoor?: boolean;
  /** REVISION-25 N2: check-in obrigatorio (liberación automática sen check-in). */
  checkInRequired?: boolean;
  /** REVISION-40 M7: permitir partidos abertos (defecto si en pista/pavillón/campo). */
  openMatchesAllowed?: boolean | null;
  /** Foto da instalación (data URL), opcional. */
  /** @deprecated prefer imageUrl na lista pública */
  imageDataUrl?: string | null;
  /** URL pública da foto (REVISION-28 X10). */
  imageUrl?: string | null;
  /** REVISION-46 D3 — alt text da foto. */
  imageAlt?: string | null;
  /** Sobrescrita opcional das regras numéricas do concello. */
  rulesOverride?: Partial<UsageRules> | null;
  /** Normas en texto propias (null = herda do concello). */
  rulesText?: RulesTextItem[] | null;
  /** REVISION-40 P1 — contacto da instalación (opcional; fallback ao concello). */
  contactPhone?: string | null;
  contactEmail?: string | null;
  /** Persoa ou posto (p.ex. «Conserxaría do pavillón»). */
  contactPerson?: string | null;
  /** Como chegar — textos opcionais (máx. 200). */
  parkingInfo?: string | null;
  publicTransport?: string | null;
  entranceInfo?: string | null;
}

export interface Unit {
  id: string;
  facilityId: string;
  municipalityId: string;
  name: string;
  /** Unidades incompatibles (p.ex. pista completa vs transversais). */
  incompatibleWith: string[];
  /** Tipo de reserva: veciñanza, clubs ou ambas. */
  bookingKind?: "vecinhaza" | "clubs" | "ambas";
  /** Duración da franxa en minutos (30/60/90). */
  slotMinutes?: number;
  capacity?: number;
  active?: boolean;
}

export interface TimeSlot {
  id: string;
  unitId: string;
  municipalityId: string;
  date: string; // YYYY-MM-DD
  start: string; // HH:mm
  end: string;
  closed: boolean;
  closedReason?: string;
  /** Franxa apartada (lista de espera). */
  heldForUserId?: string | null;
  heldUntil?: string | null;
}

export interface Booking {
  id: string;
  municipalityId: string;
  unitId: string;
  facilityId: string;
  /** Null tras anonimización RGPD (conservación sen clave persoal). */
  userId: string | null;
  userDisplayName: string;
  slotId: string;
  date: string;
  start: string;
  end: string;
  status: BookingStatus;
  shortCode: string;
  qrPayload: string;
  createdAt: string;
  /** Versión das normas aceptadas ao confirmar. */
  rulesVersion?: string;
  /** SEQUENCE do .ics (0 na creación; +1 por modificación). */
  icsSequence?: number;
  /** Motivo da cancelación (admin, peche, rexeitamento), se o hai. */
  cancelReason?: string | null;
}

export interface Club {
  id: string;
  municipalityId: string;
  name: string;
  shortName: string;
  /** REVISION-22 B3 */
  cif?: string | null;
  sport?: string | null;
  email?: string | null;
}

export interface Team {
  id: string;
  clubId: string;
  municipalityId: string;
  name: string;
  category: string;
}

export interface MatchSlot {
  id: string;
  municipalityId: string;
  facilityId: string;
  unitId: string;
  date: string;
  start: string;
  end: string;
  homeTeamId: string;
  awayTeamId: string;
  clubId: string;
  status:
    | "scheduled"
    | "conflict"
    | "resolved"
    | "swapped"
    | "proposed"
    | "change_requested"
    | "moved";
  conflictWith?: string[];
  notes?: string;
}

export interface SlotSwap {
  id: string;
  municipalityId: string;
  fromMatchId: string;
  toMatchId: string;
  status: "proposed" | "accepted" | "rejected" | "validated";
}

export interface Activity {
  id: string;
  municipalityId: string;
  facilityId: string;
  name: string;
  description: string;
  days: string;
  hours: string;
  places: number;
  ageMin: number;
  ageMax: number;
  method: ActivityMethod;
  deadline: string;
  lotteryStatus: LotteryStatus;
  /** SHA-256 do segredo (publicado antes do sorteo). */
  lotterySeedHash: string | null;
  /** Valor revelado ao sortear (null ata o sorteo). */
  lotterySecret: string | null;
  lotteryResultOrder: string[] | null;
}

export interface ActivityApplication {
  id: string;
  activityId: string;
  municipalityId: string;
  userId: string;
  /** REVISION-51 C1 — familiar inscrito (null = a propia persoa). */
  forMemberId?: string | null;
  forMemberName?: string | null;
  /** Número público de solicitude (nunca o nome na vista pública). */
  applicationNumber: string;
  priorityGroup: "renovacion" | "sorteo";
  status: "pending" | "accepted" | "waitlist" | "declined";
  createdAt: string;
}

export interface AuthUser {
  id: string;
  municipalityId: string;
  /** REVISION-29 Y13 — entidade Deputación (superadmin). */
  organizationId?: string | null;
  /** Slug do concello ao que pertence (roles elevados = só este). */
  municipalitySlug?: string;
  role: Role;
  displayName: string;
  email?: string;
  /** Identificador eIDAS (PersonIdentifier) cando a vía é SAML. */
  personIdentifier?: string;
  /**
   * Conta de club: unha sola por club (rol club_manager).
   * Creada polo admin do concello; illada ao municipalityId.
   * Mantense por compat; B3 engade linkedClubs + activeClubId.
   */
  clubId?: string | null;
  /** REVISION-22 B3 — clubs aos que a persoa está vinculada. */
  linkedClubs?: Array<{ id: string; name: string; shortName: string }>;
  /** Club activo no conmutador («Entrar como»). */
  activeClubId?: string | null;
  /** Rol real na BD cando activeClubId eleva a club_manager. */
  baseRole?: Role;
  /** REVISION-28 X3 — roles municipais extra (conserxaría, admin). */
  linkedMuniRoles?: Array<{
    role: Role;
    municipalityId: string;
    municipalityName: string;
    municipalitySlug?: string;
    label: string;
  }>;
  /** Rol municipal activo no conmutador. */
  activeMuniRole?: Role | null;
  locale: Locale;
  consentAt?: string | null;
  consentVersion?: string | null;
  /** Derivado: algún tipo coa canle correo activa. */
  notifyEmail?: boolean;
  /** Derivado: recordatorio.email ou recordatorio.inApp. */
  notifyReminders?: boolean;
  /** Matriz tipo × canle (REVISION-22 A4). */
  notifyPrefs?: NotifyPrefs;
}

/** Tipos de aviso na matriz Conta › Avisos (REVISION-22 A4). */
export type NotifyType =
  | "confirmacion"
  | "cambio"
  | "cancelacion"
  | "recordatorio"
  | "praza_liberada"
  | "partido_club"
  | "partido_aberto";

export type NotifyChannelPrefs = { email: boolean; inApp: boolean };

export type NotifyPrefs = Record<NotifyType, NotifyChannelPrefs>;

export const NOTIFY_TYPES: NotifyType[] = [
  "confirmacion",
  "cambio",
  "cancelacion",
  "recordatorio",
  "praza_liberada",
  "partido_club",
  "partido_aberto",
];

export function defaultNotifyPrefs(): NotifyPrefs {
  const all: NotifyChannelPrefs = { email: true, inApp: true };
  return {
    confirmacion: { ...all },
    cambio: { ...all },
    cancelacion: { ...all },
    recordatorio: { ...all },
    praza_liberada: { ...all },
    partido_club: { ...all },
    partido_aberto: { ...all },
  };
}

export interface FamilyMember {
  id: string;
  userId: string;
  municipalityId: string;
  displayName: string;
  birthYear?: number;
  relation: "fillo" | "filla" | "dependente" | "outro";
}

/** Datos estruturados dun aviso (formatar na UI). */
export type NoticePayload = {
  facilityName?: string;
  /** REVISION-43 R3: nome da unidade (p.ex. «Pista pádel 2»). */
  unitName?: string;
  dayLabel?: string;
  date?: string;
  start?: string;
  facilityId?: string;
  holdUntil?: string;
  [key: string]: unknown;
};

export interface Notice {
  id: string;
  municipalityId: string;
  userId: string | null; // null = público do concello
  type: "reminder" | "closure" | "waitlist" | "change" | "info";
  title: string;
  body: string;
  /** Opcional: data/hora/instalación para formatar ao mostrar. */
  payload?: NoticePayload | null;
  createdAt: string;
  read: boolean;
}

/** REVISION-22 B4 — campaña de tempada. */
export interface Season {
  id: string;
  municipalityId: string;
  name: string;
  startsAt: string;
  endsAt: string;
  facilityIds: string[];
  criteriaGl: string;
  criteriaEs: string;
  published: boolean;
  createdAt?: string;
}

export interface SeasonSlot {
  id: string;
  municipalityId: string;
  clubId: string;
  facilityId: string;
  unitId: string;
  weekday: number; // 0=dom
  start: string;
  end: string;
  priority: number;
  seasonId?: string | null;
  /** REVISION-58 K3 — fin do bloqueo se non hai campaña. */
  validTo?: string | null;
}

export interface ClubMember {
  id: string;
  clubId: string;
  municipalityId: string;
  displayName: string;
  email: string;
  role: "manager" | "coach";
  /** REVISION-22 B3 */
  userId?: string | null;
}

export interface AuditEvent {
  id: string;
  municipalityId: string;
  at: string;
  actor: string;
  action: string;
  detail: string;
}

export interface WaitlistEntry {
  id: string;
  municipalityId: string;
  slotId: string;
  userId: string;
  userDisplayName: string;
  createdAt: string;
  status: "waiting" | "offered" | "accepted" | "expired" | "cancelled";
  offeredUntil?: string | null;
}

/** Amplía Booking opcionalmente. */
export type BookingWithFor = Booking & {
  forMemberId?: string | null;
  forMemberName?: string | null;
  bookedByStaff?: boolean;
};

/** Seed canónico — paletas distintas por concello (DISENO). */
export const DEMO_MUNICIPALITIES: Municipality[] = [
  {
    id: "muni-exemplo",
    slug: "exemplo",
    name: "Concello de Exemplo",
    accentColor: "#5A4636",
    locales: ["gl", "es"],
    settings: {
      maxHoursPerWeek: 4,
      bookingAntelationDays: 7,
      maxActiveBookings: 3,
      anonymizeAfterDays: 90,
      cancelMinHours: 2,
      checkInMarginMinutes: 30,
      noShowReleaseMinutes: 30,
      /* Rev24 T20: penalización visible na demo */
      noShowPenaltyCount: 3,
      noShowPenaltyDays: 7,
      noShowPenaltyWindowDays: 30,
      timezone: "Europe/Madrid",
      /* Censo OSM de proba: Sarreaus (Ourense), sen concellos reais no código. */
      ineCode: "32078",
      demoImage: "pavillon-exemplo",
      theme: { brand: "#5A4636", accent: "#8B6914" },
      /* REVISION-19 B2: datos legais da demo (sen «—»). */
      legal: {
        titular: "Concello de Exemplo",
        nif: "P1500200B",
        address: "Rúa Maior, 1, 15000 Exemplo",
        email: "deportes@exemplo.gal",
        dpd: "dpd@exemplo.gal",
        sinatura: "Servizo Municipal de Deportes",
      },
      contact: {
        serviceName: "Servizo Municipal de Deportes",
        phone: "981 82 15 00",
        email: "deportes@exemplo.gal",
        address: "Rúa Maior, 1, 15000 Exemplo",
        hours: "Luns a venres, 9:00–14:00",
        web: "https://www.exemplo.gal",
      },
    },
  },
  {
    id: "muni-proba",
    slug: "proba",
    name: "Concello de Proba",
    accentColor: "#2F4A55",
    locales: ["gl", "es"],
    settings: {
      maxHoursPerWeek: 6,
      bookingAntelationDays: 7,
      maxActiveBookings: 3,
      anonymizeAfterDays: 90,
      cancelMinHours: 2,
      checkInMarginMinutes: 30,
      noShowReleaseMinutes: 30,
      noShowPenaltyCount: 3,
      noShowPenaltyDays: 7,
      noShowPenaltyWindowDays: 30,
      timezone: "Europe/Madrid",
      ineCode: "32078",
      demoImage: "pista-proba",
      theme: { brand: "#2F4A55", accent: "#3D6B7A" },
      legal: {
        titular: "Concello de Proba",
        nif: "P1500100A",
        address: "Praza Maior, 1, 15000 Proba, A Coruña",
        email: "deportes@proba.gal",
        dpd: "dpd@proba.gal",
        sinatura: "Servizo Municipal de Deportes",
      },
      contact: {
        serviceName: "Servizo Municipal de Deportes",
        phone: "981 00 00 00",
        email: "deportes@proba.gal",
        address: "Praza Maior, 1, 15000 Proba, A Coruña",
        hours: "Luns a venres, 9:00–14:00",
        web: "https://proba.example.org",
      },
      /* Demo sen INE real — MeteoGalicia devolve null. */
    },
  },
];
