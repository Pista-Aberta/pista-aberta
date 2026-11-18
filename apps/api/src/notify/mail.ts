/**
 * Módulo único de correo (AVISOS-E-CORREO §1.1).
 * SMTP vía nodemailer; sen SDKs propietarios.
 * REVISION-22 A4: cabeceiras List-Unsubscribe + rodapé de baixa.
 * CORREOS: From nome do concello, Reply-To legal, adxuntos CID.
 */
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

export type MailAttachment = {
  filename: string;
  content: Buffer | string;
  contentType?: string;
  cid?: string;
  contentDisposition?: "inline" | "attachment";
};

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Cabeceiras extra (p.ex. List-Unsubscribe). */
  headers?: Record<string, string>;
  /**
   * URL de baixa nun clic. Se presente, engade rodapé e cabeceiras RFC 8058.
   * Non usar en OTP / correo transaccional de autenticación.
   */
  unsubscribeUrl?: string;
  /** Nome visible: "{Concello} · Reservas". */
  fromName?: string;
  /** Reply-To (legal.email). */
  replyTo?: string;
  attachments?: MailAttachment[];
};

let cached: Transporter | null = null;

/** Opcións SMTP compartidas (OTP + avisos). REVISION-23 R3. */
export function buildSmtpTransportOptions(): {
  host: string;
  port: number;
  secure: boolean;
  pool: boolean;
  requireTLS: boolean;
  auth?: { user: string; pass: string };
} | null {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  const port = Number(process.env.SMTP_PORT ?? 1025);
  const secure =
    process.env.SMTP_SECURE === "1" ||
    process.env.SMTP_SECURE === "true" ||
    port === 465;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  return {
    host,
    port,
    secure,
    pool: true,
    requireTLS: !secure && port === 587,
    auth: user ? { user, pass: pass ?? "" } : undefined,
  };
}

/** Invalida o transporte cacheado (tests). */
export function resetMailTransport(): void {
  cached = null;
}

function transport(): Transporter | null {
  const opts = buildSmtpTransportOptions();
  if (!opts) return null;
  if (cached) return cached;
  cached = nodemailer.createTransport(opts);
  return cached;
}

const UNSUB_FOOTER_GL = "Non quero recibir estes avisos";

function withUnsubscribe(msg: MailMessage): {
  text: string;
  html: string;
  headers: Record<string, string>;
} {
  const headers: Record<string, string> = { ...(msg.headers ?? {}) };
  let text = msg.text;
  let html = msg.html ?? `<p>${msg.text.replace(/\n/g, "<br/>")}</p>`;

  if (msg.unsubscribeUrl) {
    headers["List-Unsubscribe"] = `<${msg.unsubscribeUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
    /* Se o HTML xa leva a ligazón de baixa no rodapé do layout, só cabeceiras. */
    if (!html.includes(msg.unsubscribeUrl)) {
      text = `${text}\n\n---\n${UNSUB_FOOTER_GL}: ${msg.unsubscribeUrl}`;
      html = `${html}<hr/><p style="font-size:12px;color:#555"><a href="${msg.unsubscribeUrl}">${UNSUB_FOOTER_GL}</a></p>`;
    } else if (!text.includes(msg.unsubscribeUrl)) {
      text = `${text}\n\n---\n${UNSUB_FOOTER_GL}: ${msg.unsubscribeUrl}`;
    }
  }

  return { text, html, headers };
}

function resolveFrom(msg: MailMessage): string {
  const addr = process.env.SMTP_FROM ?? "noreply@pistaaberta.local";
  if (msg.fromName?.trim()) {
    const name = msg.fromName.trim().replace(/[\r\n"<>]/g, "");
    return `"${name}" <${addr}>`;
  }
  return addr;
}

/** Envía correo. Devolve false se non hai SMTP ou falla (non lanza). */
export async function sendMail(msg: MailMessage): Promise<boolean> {
  const prepared = withUnsubscribe(msg);
  const t = transport();
  if (!t) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[mail] (sen SMTP) → ${msg.to}: ${msg.subject}`);
    }
    return false;
  }
  try {
    await t.sendMail({
      from: resolveFrom(msg),
      replyTo: msg.replyTo || process.env.SMTP_REPLY_TO || undefined,
      to: msg.to,
      subject: msg.subject,
      text: prepared.text,
      html: prepared.html,
      headers: prepared.headers,
      attachments: msg.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
        cid: a.cid,
        contentDisposition: a.contentDisposition,
      })),
    });
    return true;
  } catch (err) {
    console.warn(`[mail] fallo a ${msg.to}: ${(err as Error).message}`);
    return false;
  }
}

/** Expón o corpo/cabeceiras preparadas (tests sen SMTP). */
export function prepareMail(msg: MailMessage) {
  return {
    ...withUnsubscribe(msg),
    from: resolveFrom(msg),
    replyTo: msg.replyTo || process.env.SMTP_REPLY_TO || undefined,
  };
}
