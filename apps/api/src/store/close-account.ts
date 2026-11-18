/**
 * Peche de conta cidadá.
 *
 * O estado de negocio cambia nunha única transacción: ou se cancelan todas as
 * reservas futuras e se desvincula o historial, ou a conta segue activa. Os
 * efectos externos (waitlist/avisos de partidos) execútanse só tras o commit.
 * O bloqueo da fila de users compártese con createBooking, polo que unha alta
 * concorrente non pode aparecer despois de completar o peche.
 */
import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { AuthUser } from "@pista-aberta/shared";
import { getDb } from "../db/client.js";
import * as t from "../db/schema.js";
import { notifyBookingCancellationCommitted } from "./db.js";
import { DEFAULT_TIMEZONE, slotInstant } from "./business-rules.js";

const CLOSED_LABEL = "Conta pechada";

type CloseAccountOptions = {
  /** Test seam: simula un fallo de cancelación dentro da transacción. */
  beforeCancel?: (bookingId: string, index: number) => void | Promise<void>;
};

export async function closeCitizenAccount(
  user: AuthUser,
  options: CloseAccountOptions = {},
): Promise<void> {
  const db = getDb();
  const now = new Date();
  const committedCancellations: Array<{
    id: string;
    slotId: string;
    municipalityId: string;
  }> = [];

  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select id, active from users where id = ${user.id} for update`,
    );
    const [row] = await tx
      .select({ id: t.users.id, active: t.users.active })
      .from(t.users)
      .where(eq(t.users.id, user.id))
      .limit(1);
    if (!row) throw new Error("user_not_found");
    /* Idempotencia: un segundo intento non recrea efectos nin falla. */
    if (!row.active) return;

    const bookings = await tx
      .select()
      .from(t.bookings)
      .where(
        and(
          eq(t.bookings.userId, user.id),
          inArray(t.bookings.status, ["confirmed", "pending"]),
        ),
      );
    const municipalityIds = [...new Set(bookings.map((b) => b.municipalityId))];
    const municipalities =
      municipalityIds.length > 0
        ? await tx
            .select()
            .from(t.municipalities)
            .where(inArray(t.municipalities.id, municipalityIds))
        : [];
    const timezoneByMunicipality = new Map(
      municipalities.map((m) => [
        m.id,
        (m.settings as { timezone?: string }).timezone ?? DEFAULT_TIMEZONE,
      ]),
    );
    const future = bookings.filter((b) => {
      const timezone =
        timezoneByMunicipality.get(b.municipalityId) ?? DEFAULT_TIMEZONE;
      return slotInstant(b.date, b.start, timezone).getTime() > now.getTime();
    });

    for (const [index, booking] of future.entries()) {
      await options.beforeCancel?.(booking.id, index);
      await tx
        .update(t.bookings)
        .set({ status: "cancelled", cancelReason: CLOSED_LABEL })
        .where(
          and(
            eq(t.bookings.id, booking.id),
            ne(t.bookings.status, "cancelled"),
          ),
        );
      committedCancellations.push({
        id: booking.id,
        slotId: booking.slotId,
        municipalityId: booking.municipalityId,
      });
    }

    await tx
      .update(t.waitlistEntries)
      .set({ status: "cancelled", offeredUntil: null })
      .where(
        and(
          eq(t.waitlistEntries.userId, user.id),
          inArray(t.waitlistEntries.status, ["waiting", "offered"]),
        ),
      );

    const openActs = await tx
      .select({ id: t.activities.id })
      .from(t.activities)
      .where(eq(t.activities.lotteryStatus, "open"));
    const openIds = openActs.map((a) => a.id);
    if (openIds.length > 0) {
      await tx
        .delete(t.activityApplications)
        .where(
          and(
            eq(t.activityApplications.userId, user.id),
            inArray(t.activityApplications.activityId, openIds),
          ),
        );
    }

    /* Datos persoais de menores a cargo — borrado definitivo no peche. */
    await tx
      .delete(t.familyMembers)
      .where(eq(t.familyMembers.userId, user.id));

    /* Sesións activas: revogar todas (logout forzado). */
    await tx.delete(t.sessions).where(eq(t.sessions.userId, user.id));

    /* Roles multi-concello do usuario (se os hai). */
    await tx.delete(t.userRoles).where(eq(t.userRoles.userId, user.id));

    /* Invites de partidos abertos onde a persoa é destinataria ou emisora. */
    await tx
      .delete(t.openMatchInvites)
      .where(
        or(
          eq(t.openMatchInvites.fromUserId, user.id),
          eq(t.openMatchInvites.toUserId, user.id),
        ),
      );

    /* Por se detach previo fallou: quitar filas de open_match_players. */
    await tx
      .delete(t.openMatchPlayers)
      .where(eq(t.openMatchPlayers.userId, user.id));

    /*
     * A reserva consérvase para estatística/auditoría operativa, pero sen unha
     * chave persoal estable: NULL é deliberado, non un pseudónimo reutilizable.
     */
    await tx
      .update(t.bookings)
      .set({
        userId: sql<string>`NULL`,
        userDisplayName: CLOSED_LABEL,
        forMemberName: null,
        forMemberId: null,
      })
      .where(eq(t.bookings.userId, user.id));

    await tx
      .update(t.users)
      .set({
        active: false,
        email: null,
        displayName: CLOSED_LABEL,
        personIdentifier: null,
        phone: null,
      })
      .where(eq(t.users.id, user.id));
  });

  for (const booking of committedCancellations) {
    await notifyBookingCancellationCommitted(booking).catch((err) => {
      console.warn(
        "[pechar] post-commit cancellation effect failed",
        booking.id,
        err,
      );
    });
  }
}
