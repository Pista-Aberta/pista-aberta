/**
 * Envío de aviso in-app + correo respectando preferencias (REVISION-22 A4).
 * CORREOS: correo vía renderEmail({ kind, data }).
 */
import { eq } from "drizzle-orm";
import type { Locale, Municipality } from "@pista-aberta/shared";
import { getDb } from "../db/client.js";
import * as t from "../db/schema.js";
import { getMunicipalityById } from "../store/db.js";
import { sendMail } from "./mail.js";
import { shouldNotify, type NotifyType } from "./prefs.js";
import { unsubscribeUrl } from "./unsubscribe.js";
import {
  renderEmail,
  type EmailKind,
  renderedToDemo,
} from "./emails/index.js";

export type UserNoticeOptions = {
  id: string;
  municipalityId: string;
  userId: string;
  /** Tipo interno do notice (BD). */
  noticeType: "reminder" | "closure" | "waitlist" | "change" | "info";
  /** Tipo da matriz Conta › Avisos. Null = sempre in-app (p.ex. info). */
  notifyType: NotifyType | null;
  title: string;
  body: string;
  payload?: Record<string, unknown> | null;
  /**
   * Correo HTML vía renderEmail.
   * Se `kind` falta, non se envía correo (só in-app).
   */
  email?: {
    kind: EmailKind;
    data: Record<string, unknown>;
  };
};

export async function sendUserNotice(
  opts: UserNoticeOptions,
): Promise<{ inApp: boolean; email: boolean; emailAttempted: boolean }> {
  const users = await getDb()
    .select()
    .from(t.users)
    .where(eq(t.users.id, opts.userId))
    .limit(1);
  const user = users[0];
  if (!user) return { inApp: false, email: false, emailAttempted: false };

  const prefs = user.notifyPrefs;
  const allowInApp =
    opts.notifyType === null || shouldNotify(prefs, opts.notifyType, "inApp");
  /* Tipo A: respect prefs. Tipo T/P (notifyType null + kind): sempre se hai correo. */
  const allowEmail =
    !!user.email &&
    !!opts.email &&
    (opts.notifyType === null ||
      shouldNotify(prefs, opts.notifyType, "email"));

  if (allowInApp) {
    await getDb()
      .insert(t.notices)
      .values({
        id: opts.id,
        municipalityId: opts.municipalityId,
        userId: opts.userId,
        type: opts.noticeType,
        title: opts.title,
        body: opts.body,
        payload: opts.payload ?? null,
        read: false,
        createdAt: new Date(),
      })
      .onConflictDoNothing({ target: t.notices.id });
  }

  let emailed = false;
  if (allowEmail && opts.email && user.email) {
    const muni: Municipality | null =
      (await getMunicipalityById(opts.municipalityId)) ?? null;
    const locale = (user.locale === "es" ? "es" : "gl") as Locale;
    const unsub = unsubscribeUrl(user.id);
    const data = {
      ...opts.email.data,
      unsubscribeUrl:
        (opts.email.data.unsubscribeUrl as string | undefined) ?? unsub,
      userName:
        (opts.email.data.userName as string | undefined) ||
        user.displayName ||
        user.email,
    };
    const rendered = await renderEmail({
      muni,
      locale,
      kind: opts.email.kind,
      data,
    });
    renderedToDemo(user.email, opts.email.kind, rendered, {
      userId: user.id,
      municipalitySlug: muni?.slug,
    });
    emailed = await sendMail({
      to: user.email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      unsubscribeUrl:
        rendered.footerKind === "A" ? unsub : undefined,
      fromName: rendered.fromName,
      replyTo: rendered.replyTo,
      attachments: rendered.attachments,
    });
  }

  return { inApp: allowInApp, email: emailed, emailAttempted: allowEmail };
}

/** Envía un correo renderizado sen notice in-app (OTP, convites, reservar-nome). */
export async function sendRenderedMail(opts: {
  to: string;
  muni: Municipality | null;
  locale: Locale;
  kind: EmailKind;
  data: Record<string, unknown>;
  userId?: string;
  /** Forzar baixa (só tipo A). */
  withUnsubscribe?: boolean;
}): Promise<boolean> {
  const rendered = await renderEmail({
    muni: opts.muni,
    locale: opts.locale,
    kind: opts.kind,
    data: opts.data,
  });
  renderedToDemo(opts.to, opts.kind, rendered, {
    userId: opts.userId,
    municipalitySlug: opts.muni?.slug,
  });
  const unsub =
    opts.withUnsubscribe && opts.userId
      ? unsubscribeUrl(opts.userId)
      : undefined;
  return sendMail({
    to: opts.to,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    unsubscribeUrl:
      rendered.footerKind === "A" ? unsub : undefined,
    fromName: rendered.fromName,
    replyTo: rendered.replyTo,
    attachments: rendered.attachments,
  });
}
