import type {
  Activity,
  ActivityApplication,
  AuditEvent,
  AuthUser,
  Booking,
  Club,
  ClubMember,
  Facility,
  FamilyMember,
  MatchSlot,
  Municipality,
  Notice,
  Season,
  SeasonSlot,
  SlotSwap,
  Team,
  TimeSlot,
  Unit,
  WaitlistEntry,
} from "@pista-aberta/shared";
import {
  derivedNotifyFlags,
  normalizeNotifyPrefs,
} from "../notify/prefs.js";
import type * as s from "./schema.js";

type Row<T> = typeof s extends never ? never : T;

export function mapMunicipality(r: typeof s.municipalities.$inferSelect): Municipality {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    accentColor: r.accentColor,
    locales: r.locales as Municipality["locales"],
    settings: r.settings,
  };
}

export function mapFacility(r: typeof s.facilities.$inferSelect): Facility {
  return {
    id: r.id,
    municipalityId: r.municipalityId,
    name: r.name,
    type: r.type as Facility["type"],
    address: r.address,
    lat: Number(r.lat),
    lng: Number(r.lng),
    accessibility: r.accessibility,
    services: r.services ?? [],
    rules: r.rules,
    active: r.active,
    outdoor: r.outdoor ?? false,
    checkInRequired: r.checkInRequired,
    openMatchesAllowed: r.openMatchesAllowed ?? null,
    contactPhone: r.contactPhone ?? null,
    contactEmail: r.contactEmail ?? null,
    contactPerson: r.contactPerson ?? null,
    parkingInfo: r.parkingInfo ?? null,
    publicTransport: r.publicTransport ?? null,
    entranceInfo: r.entranceInfo ?? null,
    imageDataUrl: r.imageDataUrl ?? null,
    imageAlt: r.imageAlt ?? null,
    rulesOverride: (r.rulesOverride as Facility["rulesOverride"]) ?? null,
    rulesText: (r.rulesText as Facility["rulesText"]) ?? null,
  };
}

export function mapUnit(r: typeof s.units.$inferSelect): Unit {
  return {
    id: r.id,
    facilityId: r.facilityId,
    municipalityId: r.municipalityId,
    name: r.name,
    incompatibleWith: r.incompatibleWith ?? [],
    bookingKind: (r.bookingKind as Unit["bookingKind"]) ?? "ambas",
    slotMinutes: r.slotMinutes ?? 60,
    capacity: r.capacity ?? 4,
    active: r.active ?? true,
  };
}

export function mapSlot(r: typeof s.timeSlots.$inferSelect): TimeSlot {
  return {
    id: r.id,
    unitId: r.unitId,
    municipalityId: r.municipalityId,
    date: r.date,
    start: r.start,
    end: r.end,
    closed: r.closed,
    closedReason: r.closedReason ?? undefined,
    heldForUserId: r.heldForUserId ?? null,
    heldUntil: r.heldUntil ? r.heldUntil.toISOString() : null,
  };
}

export function mapBooking(r: typeof s.bookings.$inferSelect): Booking {
  return {
    id: r.id,
    municipalityId: r.municipalityId,
    unitId: r.unitId,
    facilityId: r.facilityId,
    userId: r.userId ?? null,
    userDisplayName: r.userDisplayName,
    slotId: r.slotId,
    date: r.date,
    start: r.start,
    end: r.end,
    status: r.status as Booking["status"],
    shortCode: r.shortCode,
    qrPayload: r.qrPayload,
    rulesVersion: r.rulesVersion ?? undefined,
    icsSequence: r.icsSequence ?? 0,
    cancelReason: r.cancelReason ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

export function mapClub(r: typeof s.clubs.$inferSelect): Club {
  return {
    id: r.id,
    municipalityId: r.municipalityId,
    name: r.name,
    shortName: r.shortName,
    cif: r.cif ?? null,
    sport: r.sport ?? null,
    email: r.email ?? null,
  };
}

export function mapTeam(r: typeof s.teams.$inferSelect): Team {
  return {
    id: r.id,
    clubId: r.clubId,
    municipalityId: r.municipalityId,
    name: r.name,
    category: r.category,
  };
}

export function mapMatch(r: typeof s.matches.$inferSelect): MatchSlot {
  return {
    id: r.id,
    municipalityId: r.municipalityId,
    facilityId: r.facilityId,
    unitId: r.unitId,
    date: r.date,
    start: r.start,
    end: r.end,
    homeTeamId: r.homeTeamId,
    awayTeamId: r.awayTeamId,
    clubId: r.clubId,
    status: r.status as MatchSlot["status"],
    conflictWith: r.conflictWith ?? [],
    notes: r.notes ?? undefined,
  };
}

export function mapSwap(r: typeof s.slotSwaps.$inferSelect): SlotSwap {
  return {
    id: r.id,
    municipalityId: r.municipalityId,
    fromMatchId: r.fromMatchId,
    toMatchId: r.toMatchId,
    status: r.status as SlotSwap["status"],
  };
}

export function mapActivity(r: typeof s.activities.$inferSelect): Activity {
  return {
    id: r.id,
    municipalityId: r.municipalityId,
    facilityId: r.facilityId,
    name: r.name,
    description: r.description,
    days: r.days,
    hours: r.hours,
    places: r.places,
    ageMin: r.ageMin,
    ageMax: r.ageMax,
    method: r.method as Activity["method"],
    deadline: r.deadline,
    lotteryStatus: r.lotteryStatus as Activity["lotteryStatus"],
    lotterySeedHash: r.lotterySeedHash,
    /* REVISION-56 H6: segredo só despois do sorteo. */
    lotterySecret:
      r.lotteryStatus === "drawn" ? r.lotterySecret : null,
    lotteryResultOrder: r.lotteryResultOrder ?? null,
  };
}

export function mapApplication(
  r: typeof s.activityApplications.$inferSelect,
): ActivityApplication {
  return {
    id: r.id,
    activityId: r.activityId,
    municipalityId: r.municipalityId,
    userId: r.userId,
    forMemberId: r.forMemberId ?? null,
    forMemberName: r.forMemberName ?? null,
    applicationNumber: r.applicationNumber,
    priorityGroup: r.priorityGroup as ActivityApplication["priorityGroup"],
    status: r.status as ActivityApplication["status"],
    createdAt: r.createdAt.toISOString(),
  };
}

export function mapUser(r: typeof s.users.$inferSelect): AuthUser {
  const notifyPrefs = normalizeNotifyPrefs(r.notifyPrefs);
  const derived = derivedNotifyFlags(notifyPrefs);
  return {
    id: r.id,
    municipalityId: r.municipalityId,
    organizationId: r.organizationId ?? null,
    role: r.role as AuthUser["role"],
    displayName: r.displayName,
    email: r.email ?? undefined,
    personIdentifier: r.personIdentifier ?? undefined,
    clubId: r.clubId ?? null,
    locale: r.locale as AuthUser["locale"],
    consentAt: r.consentAt?.toISOString() ?? null,
    consentVersion: r.consentVersion ?? null,
    notifyEmail: derived.notifyEmail,
    notifyReminders: derived.notifyReminders,
    notifyPrefs,
  };
}

export function mapNotice(r: typeof s.notices.$inferSelect): Notice {
  return {
    id: r.id,
    municipalityId: r.municipalityId,
    userId: r.userId,
    type: r.type as Notice["type"],
    title: r.title,
    body: r.body,
    payload: (r.payload as Notice["payload"]) ?? null,
    createdAt: r.createdAt.toISOString(),
    read: r.read,
  };
}

export function mapFamily(r: typeof s.familyMembers.$inferSelect): FamilyMember {
  return {
    id: r.id,
    userId: r.userId,
    municipalityId: r.municipalityId,
    displayName: r.displayName,
    birthYear: r.birthYear ?? undefined,
    relation: r.relation as FamilyMember["relation"],
  };
}

export function mapSeasonCampaign(r: typeof s.seasons.$inferSelect): Season {
  return {
    id: r.id,
    municipalityId: r.municipalityId,
    name: r.name,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    facilityIds: (r.facilityIds as string[]) ?? [],
    criteriaGl: r.criteriaGl ?? "",
    criteriaEs: r.criteriaEs ?? "",
    published: !!r.published,
    createdAt: r.createdAt?.toISOString?.() ?? undefined,
  };
}

export function mapSeason(r: typeof s.seasonSlots.$inferSelect): SeasonSlot {
  return {
    id: r.id,
    municipalityId: r.municipalityId,
    clubId: r.clubId,
    facilityId: r.facilityId,
    unitId: r.unitId,
    weekday: r.weekday,
    start: r.start,
    end: r.end,
    priority: r.priority,
    seasonId: r.seasonId ?? null,
    validTo: r.validTo ?? null,
  };
}

export function mapClubMember(r: typeof s.clubMembers.$inferSelect): ClubMember {
  return {
    id: r.id,
    clubId: r.clubId,
    municipalityId: r.municipalityId,
    displayName: r.displayName,
    email: r.email,
    role: r.role as ClubMember["role"],
    userId: r.userId ?? null,
  };
}

export function mapAudit(r: typeof s.auditEvents.$inferSelect): AuditEvent {
  return {
    id: r.id,
    municipalityId: r.municipalityId,
    at: r.at.toISOString(),
    actor: r.actor,
    action: r.action,
    detail: r.detail,
  };
}

export function mapWaitlist(r: typeof s.waitlistEntries.$inferSelect): WaitlistEntry {
  return {
    id: r.id,
    municipalityId: r.municipalityId,
    slotId: r.slotId,
    userId: r.userId,
    userDisplayName: r.userDisplayName,
    createdAt: r.createdAt.toISOString(),
    status: r.status as WaitlistEntry["status"],
    offeredUntil: r.offeredUntil ? r.offeredUntil.toISOString() : null,
  };
}

void (null as unknown as Row<never>);
