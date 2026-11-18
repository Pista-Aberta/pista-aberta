/**
 * Seed diario de reservas demo para hoxe (contadores do panel + conserxería).
 * Idempotente: só enche se non hai xa reservas demo do día.
 */
import { and, eq, like, gte } from "drizzle-orm";
import { getDb } from "../db/client.js";
import * as t from "../db/schema.js";
import {
  DEFAULT_TIMEZONE,
  localDateIso,
  slotInstant,
} from "./business-rules.js";
import { makeShortCode, signQrPayload } from "./qr.js";

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const DEMO_NAMES = [
  "Antía Rivas",
  "Breixo Castro",
  "Carla Míguez",
  "Miguel Ferreiro",
  "Elena Pazos",
  "Fiz Lamas",
  "Carla Novo",
  "Pedro Vidal",
];

type SeedMuni = {
  mid: string;
  idPrefix: string;
  unitPrefix: string;
  facilityId: string;
  todayTarget: number;
};

/**
 * Asegura reservas demo hoxe (panel / conserxaría) e repartidas pola semana
 * (ocupación semanal do panel — REVISION-8 B6 / REVISION-13 F2 Proba).
 */
export async function ensureDemoTodayBookings(
  now: Date = new Date(),
): Promise<number> {
  const db = getDb();
  const today = localDateIso(now, DEFAULT_TIMEZONE);
  let inserted = 0;

  async function seedDay(
    cfg: SeedMuni,
    date: string,
    target: number,
    preferEvening: boolean,
  ) {
    const existingDemo = await db
      .select()
      .from(t.bookings)
      .where(
        and(
          eq(t.bookings.municipalityId, cfg.mid),
          eq(t.bookings.date, date),
          like(t.bookings.id, `${cfg.idPrefix}%`),
        ),
      );
    if (existingDemo.length >= target) return 0;

    const slots = await db
      .select()
      .from(t.timeSlots)
      .where(
        and(
          eq(t.timeSlots.municipalityId, cfg.mid),
          eq(t.timeSlots.date, date),
          eq(t.timeSlots.closed, false),
        ),
      );

    const occupied = await db
      .select()
      .from(t.bookings)
      .where(
        and(
          eq(t.bookings.municipalityId, cfg.mid),
          eq(t.bookings.date, date),
        ),
      );
    const occupiedSlots = new Set(
      occupied
        .filter((b) => b.status !== "cancelled" && b.status !== "no_show")
        .map((b) => b.slotId),
    );
    let free = slots
      .filter((s) => !occupiedSlots.has(s.id) && s.unitId.startsWith(cfg.unitPrefix))
      .sort((a, b) => a.start.localeCompare(b.start));
    if (preferEvening) {
      free = [
        ...free.filter((s) => s.start >= "16:00"),
        ...free.filter((s) => s.start < "16:00"),
      ];
    }

    const need = Math.max(0, target - existingDemo.length);
    let dayInserted = 0;
    for (let i = 0; i < need && i < free.length; i++) {
      const slot = free[i]!;
      const id = `${cfg.idPrefix}${date.replace(/-/g, "")}-${String(i + 1).padStart(2, "0")}`;
      const shortCode = makeShortCode();
      const qrPayload = signQrPayload(id, date, shortCode);
      const started =
        date === today &&
        slotInstant(date, slot.start, DEFAULT_TIMEZONE).getTime() <= now.getTime();
      const checkedIn = started && i < 2;
      const facilityId =
        slot.unitId.includes("sala")
          ? "fac-proba-sala"
          : slot.unitId.includes("campo")
            ? "fac-proba-campo"
            : cfg.facilityId;
      try {
        await db.insert(t.bookings).values({
          id,
          municipalityId: cfg.mid,
          unitId: slot.unitId,
          facilityId,
          userId: `demo-citizen-${(i % 8) + 1}`,
          userDisplayName: DEMO_NAMES[i % DEMO_NAMES.length]!,
          slotId: slot.id,
          date,
          start: slot.start,
          end: slot.end,
          status: checkedIn ? "checked_in" : "confirmed",
          shortCode,
          qrPayload,
          forMemberId: null,
          forMemberName: null,
          bookedByStaff: false,
          rulesVersion: null,
          createdAt: now,
        });
        dayInserted += 1;
      } catch {
        // unique / id xa existe
      }
    }
    return dayInserted;
  }

  async function seedMunicipality(cfg: SeedMuni) {
    let n = 0;
    n += await seedDay(cfg, today, cfg.todayTarget, true);
    const dow = new Date(`${today}T12:00:00`).getDay(); // 0=dom
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    for (let d = 0; d < 7; d++) {
      const date = addDaysIso(today, mondayOffset + d);
      if (date === today) continue;
      const target = 2 + (d % 3); // 2–4 por día
      n += await seedDay(cfg, date, target, d % 2 === 0);
    }
    return n;
  }

  inserted += await seedMunicipality({
    mid: "muni-exemplo",
    idPrefix: "bk-demo-",
    unitPrefix: "unit-padel",
    facilityId: "fac-exemplo-padel",
    todayTarget: 8,
  });
  // REVISION-13 F2: Proba con datos para a comparativa Deputación.
  inserted += await seedMunicipality({
    mid: "muni-proba",
    idPrefix: "bk-ex-",
    unitPrefix: "unit-ex-",
    facilityId: "fac-proba-campo",
    todayTarget: 4,
  });

  /* Rev24 D10: 4 semanas de historia realista (tendencias Deputación / panel). */
  async function seedHistory(cfg: SeedMuni) {
    let n = 0;
    for (let weeksAgo = 1; weeksAgo <= 4; weeksAgo++) {
      for (let d = 0; d < 7; d++) {
        const date = addDaysIso(today, -(weeksAgo * 7) + d);
        /* Ocupación crecente: ~25 % → ~55 % segundo a semana. */
        const target = 1 + weeksAgo + (d % 2);
        n += await seedDay(
          {
            ...cfg,
            idPrefix: `${cfg.idPrefix}h${weeksAgo}-`,
          },
          date,
          target,
          d % 2 === 0,
        );
      }
    }
    return n;
  }
  inserted += await seedHistory({
    mid: "muni-exemplo",
    idPrefix: "bk-demo-",
    unitPrefix: "unit-padel",
    facilityId: "fac-exemplo-padel",
    todayTarget: 8,
  });
  inserted += await seedHistory({
    mid: "muni-proba",
    idPrefix: "bk-ex-",
    unitPrefix: "unit-ex-",
    facilityId: "fac-proba-campo",
    todayTarget: 4,
  });

  return inserted;
}

/**
 * Reserva futura de Ana (user-cidada) para mañá 18:00 — tarxeta QR na portada.
 * Idempotente por id `bk-demo-ana-next`.
 */
export async function ensureAnaTomorrowBooking(
  now: Date = new Date(),
): Promise<boolean> {
  const db = getDb();
  const today = localDateIso(now, DEFAULT_TIMEZONE);
  const tomorrow = addDaysIso(today, 1);
  const mid = "muni-exemplo";
  const id = "bk-demo-ana-next";

  const existing = await db
    .select()
    .from(t.bookings)
    .where(eq(t.bookings.id, id))
    .limit(1);
  if (existing[0] && existing[0].date >= today && existing[0].status === "confirmed") {
    return false;
  }
  if (existing[0]) {
    await db.delete(t.bookings).where(eq(t.bookings.id, id));
  }

  // Outras reservas futuras de Ana xa cobren a tarxeta
  const anaFuture = await db
    .select()
    .from(t.bookings)
    .where(
      and(
        eq(t.bookings.userId, "user-cidada"),
        eq(t.bookings.municipalityId, mid),
        eq(t.bookings.status, "confirmed"),
        gte(t.bookings.date, tomorrow),
      ),
    )
    .limit(1);
  if (anaFuture.length) return false;

  const slots = await db
    .select()
    .from(t.timeSlots)
    .where(
      and(
        eq(t.timeSlots.municipalityId, mid),
        eq(t.timeSlots.date, tomorrow),
        eq(t.timeSlots.closed, false),
      ),
    );
  const slot =
    slots.find((s) => s.start === "18:00" && s.unitId.startsWith("unit-padel")) ??
    slots.find((s) => s.start === "18:00") ??
    slots.find((s) => s.start >= "17:00" && s.start <= "19:00");
  if (!slot) return false;

  const shortCode = makeShortCode();
  const qrPayload = signQrPayload(id, tomorrow, shortCode);
  try {
    await db.insert(t.bookings).values({
      id,
      municipalityId: mid,
      unitId: slot.unitId,
      facilityId: slot.unitId.includes("padel") ? "fac-exemplo-padel" : "fac-exemplo-padel",
      userId: "user-cidada",
      userDisplayName: "Ana Demo",
      slotId: slot.id,
      date: tomorrow,
      start: slot.start,
      end: slot.end,
      status: "confirmed",
      shortCode,
      qrPayload,
      forMemberId: null,
      forMemberName: null,
      bookedByStaff: false,
      rulesVersion: null,
      createdAt: now,
    });
  } catch {
    return false;
  }

  // Aviso de recordatorio coherente coa franxa real (non 19:00 fixo).
  const noticeId = "n-demo-ana-next";
  const body = `Mañá ás ${slot.start} · Pistas de pádel · Cancelar se non vas.`;
  await db.delete(t.notices).where(eq(t.notices.id, noticeId));
  await db.delete(t.notices).where(eq(t.notices.id, "n1"));
  try {
    await db.insert(t.notices).values({
      id: noticeId,
      municipalityId: mid,
      userId: "user-cidada",
      type: "reminder",
      title: "Recordatorio · mañá",
      body,
      read: false,
      createdAt: now,
    });
  } catch {
    // ignore
  }
  return true;
}

/** Engade franxas 20–22 se faltan (horario coherente coa conserxaría). */
export async function ensureEveningSlotsExtended(
  now: Date = new Date(),
): Promise<number> {
  const db = getDb();
  const today = localDateIso(now, DEFAULT_TIMEZONE);
  const mid = "muni-exemplo";
  let inserted = 0;
  const padelUnits = await db
    .select()
    .from(t.units)
    .where(eq(t.units.facilityId, "fac-exemplo-padel"));
  for (let day = 0; day < 14; day++) {
    const date = addDaysIso(today, day);
    for (const unit of padelUnits) {
      for (const [start, end] of [
        ["20:00", "21:00"],
        ["21:00", "22:00"],
      ] as const) {
        const id = `slot-eve-${unit.id}-${date}-${start.replace(":", "")}`;
        try {
          await db.insert(t.timeSlots).values({
            id,
            unitId: unit.id,
            municipalityId: mid,
            date,
            start,
            end,
            closed: false,
          });
          inserted += 1;
        } catch {
          // unique — xa existe
        }
      }
    }
  }
  return inserted;
}

/**
 * REVISION-38 J1 / REVISION-39 L4 — oferta real de lista de espera para Ana.
 * Hold de 2 h; se a oferta aínda vive non a recrea; se caducou, renova.
 * Chamada no boot/reset, cada ~30 min e ao abrir avisos de Ana.
 */
export async function ensureAnaWaitlistOffer(
  now: Date = new Date(),
): Promise<boolean> {
  const db = getDb();
  const today = localDateIso(now, DEFAULT_TIMEZONE);
  const mid = "muni-exemplo";
  const noticeId = "n3";
  const entryId = "wl-demo-ana-offer";
  const userId = "user-cidada";
  const HOLD_MS = 2 * 60 * 60_000;

  const existing = await db
    .select()
    .from(t.waitlistEntries)
    .where(eq(t.waitlistEntries.id, entryId))
    .limit(1);
  const entry = existing[0];
  if (
    entry &&
    entry.status === "offered" &&
    entry.offeredUntil &&
    entry.offeredUntil.getTime() > now.getTime()
  ) {
    return true;
  }

  // Buscar franxa futura libre (pádel), preferindo mañá 19:00 (Ana ten 18:00).
  const tomorrow = addDaysIso(today, 1);
  const candidates: Array<{ id: string; date: string; start: string; end: string; unitId: string }> = [];
  for (let day = 1; day <= 7; day++) {
    const date = addDaysIso(today, day);
    const slots = await db
      .select()
      .from(t.timeSlots)
      .where(
        and(
          eq(t.timeSlots.municipalityId, mid),
          eq(t.timeSlots.date, date),
          eq(t.timeSlots.closed, false),
        ),
      );
    const booked = await db
      .select()
      .from(t.bookings)
      .where(
        and(
          eq(t.bookings.municipalityId, mid),
          eq(t.bookings.date, date),
        ),
      );
    const taken = new Set(
      booked
        .filter((b) => b.status !== "cancelled" && b.status !== "no_show")
        .map((b) => b.slotId),
    );
    for (const s of slots) {
      if (taken.has(s.id)) continue;
      if (!s.unitId.startsWith("unit-padel")) continue;
      if (slotInstant(s.date, s.start, DEFAULT_TIMEZONE).getTime() <= now.getTime()) {
        continue;
      }
      candidates.push({
        id: s.id,
        date: s.date,
        start: s.start,
        end: s.end,
        unitId: s.unitId,
      });
    }
  }
  const slot =
    candidates.find((s) => s.date === tomorrow && s.start === "19:00") ??
    candidates.find((s) => s.start === "19:00") ??
    candidates[0];
  if (!slot) return false;

  const holdUntil = new Date(now.getTime() + HOLD_MS);
  await db.delete(t.waitlistEntries).where(eq(t.waitlistEntries.id, entryId));
  await db.delete(t.notices).where(eq(t.notices.id, noticeId));
  await db.delete(t.noticeReads).where(eq(t.noticeReads.noticeId, noticeId));

  await db.insert(t.waitlistEntries).values({
    id: entryId,
    municipalityId: mid,
    slotId: slot.id,
    userId,
    userDisplayName: "Ana Demo",
    status: "offered",
    offeredUntil: holdUntil,
    createdAt: now,
  });

  const facRows = await db
    .select()
    .from(t.facilities)
    .where(eq(t.facilities.id, "fac-exemplo-padel"))
    .limit(1);
  const facilityName = facRows[0]?.name ?? "Pistas de pádel";
  /* REVISION-43 R3: unitName na oferta demo (faixa/aviso/correo). */
  const unitRows = await db
    .select()
    .from(t.units)
    .where(eq(t.units.id, slot.unitId))
    .limit(1);
  const unitName = unitRows[0]?.name?.trim() || undefined;
  const { formatDayChip } = await import("@pista-aberta/shared");
  const dayLabel = formatDayChip(slot.date, "gl");
  const holdLabel = holdUntil.toLocaleTimeString("gl-ES", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: DEFAULT_TIMEZONE,
  });

  await db.insert(t.notices).values({
    id: noticeId,
    municipalityId: mid,
    userId,
    type: "waitlist",
    title: "Praza liberada",
    body: `Liberouse unha franxa ás ${slot.start}. Apartámosche a praza ata as ${holdLabel}.`,
    payload: {
      date: slot.date,
      start: slot.start,
      facilityId: "fac-exemplo-padel",
      facilityName,
      unitName,
      dayLabel,
      slotId: slot.id,
      holdUntil: holdUntil.toISOString(),
    },
    read: false,
    createdAt: now,
  });
  return true;
}
