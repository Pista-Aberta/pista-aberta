import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb, type AppDb } from "../db/client.js";
import * as t from "../db/schema.js";
import { newId } from "../lib/ids.js";
import {
  sendUserNotice,
  type UserNoticeOptions,
} from "./send-notice.js";

export type NotificationOutboxPayload = {
  operationKey: string;
  notice: UserNoticeOptions;
};

type OutboxWriter = {
  insert(
    table: typeof t.notificationOutbox,
  ): ReturnType<AppDb["insert"]>;
};

/** Encola dentro da mesma transacción que a mutación de negocio. */
export async function enqueueUserNotice(
  db: OutboxWriter,
  dedupeKey: string,
  municipalityId: string,
  payload: NotificationOutboxPayload,
): Promise<void> {
  await db
    .insert(t.notificationOutbox)
    .values({
      id: newId("out"),
      dedupeKey,
      municipalityId,
      payload,
    })
    .onConflictDoNothing({ target: t.notificationOutbox.dedupeKey });
}

let failureInjector:
  | ((payload: NotificationOutboxPayload, deliveryNumber: number) => void)
  | undefined;

/** Só para probas deterministas do comportamento de reintento. */
export function setNotificationOutboxFailureInjector(
  injector:
    | ((payload: NotificationOutboxPayload, deliveryNumber: number) => void)
    | undefined,
): void {
  failureInjector = injector;
}

/**
 * Entrega pendentes en orde. Un fallo deixa esa fila pendente e non impide
 * reintentar; as xa procesadas non se volven enviar.
 */
export async function drainNotificationOutbox(
  operationKey?: string,
): Promise<{ delivered: number; failed: number }> {
  const db = getDb();
  const rows = await db
    .select()
    .from(t.notificationOutbox)
    .where(isNull(t.notificationOutbox.processedAt))
    .orderBy(asc(t.notificationOutbox.createdAt), asc(t.notificationOutbox.id));

  let delivered = 0;
  let failed = 0;
  let deliveryNumber = 0;
  for (const row of rows) {
    const payload = row.payload as NotificationOutboxPayload;
    if (operationKey && payload.operationKey !== operationKey) continue;
    const claimed = await db
      .update(t.notificationOutbox)
      .set({ attempts: row.attempts + 1, lastError: null })
      .where(
        and(
          eq(t.notificationOutbox.id, row.id),
          eq(t.notificationOutbox.attempts, row.attempts),
          isNull(t.notificationOutbox.processedAt),
        ),
      )
      .returning();
    if (claimed.length === 0) continue;
    deliveryNumber += 1;
    try {
      failureInjector?.(payload, deliveryNumber);
      const result = await sendUserNotice(payload.notice);
      if (
        process.env.NODE_ENV === "production" &&
        result.emailAttempted &&
        !result.email
      ) {
        throw new Error("email_delivery_failed");
      }
      await db
        .update(t.notificationOutbox)
        .set({
          processedAt: new Date(),
          lastError: null,
        })
        .where(
          and(
            eq(t.notificationOutbox.id, row.id),
            isNull(t.notificationOutbox.processedAt),
          ),
        );
      delivered += 1;
    } catch (error) {
      await db
        .update(t.notificationOutbox)
        .set({
          lastError: error instanceof Error ? error.message : String(error),
        })
        .where(eq(t.notificationOutbox.id, row.id));
      failed += 1;
      break;
    }
  }
  return { delivered, failed };
}

/** Post-commit best effort: a fila pendente é o mecanismo de recuperación. */
export async function drainNotificationOutboxSafely(
  operationKey?: string,
): Promise<void> {
  try {
    await drainNotificationOutbox(operationKey);
  } catch (error) {
    console.warn("[notification-outbox] drain failed", operationKey, error);
  }
}
