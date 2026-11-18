import type { Locale, Municipality } from "@pista-aberta/shared";

/** Tipos de correo (AVISOS-E-CORREO.md). */
export type EmailKind =
  | "booking_confirmed"
  | "booking_pending"
  | "booking_approved"
  | "booking_rejected"
  | "reminder"
  | "booking_changed"
  | "booking_cancelled"
  | "facility_closure"
  | "waitlist_offer"
  | "no_show_warning"
  | "no_show_pause"
  | "pause_lifted"
  | "otp"
  | "match_cancelled"
  | "match_moved"
  | "open_match_invite"
  | "open_match_cancelled"
  | "open_match_moved"
  | "open_match_joined"
  | "open_match_left"
  | "season_approved"
  | "season_rejected"
  | "club_counter"
  | "invite_staff"
  | "invite_deputacion";

/** Rodapé A = aviso (baixa), T = transaccional, P = persoal. */
export type EmailFooterKind = "A" | "T" | "P";

export type EmailAttachment = {
  filename: string;
  content: Buffer;
  contentType: string;
  /** CID para imaxes en liña (sen data:). */
  cid?: string;
  contentDisposition?: "inline" | "attachment";
};

export type EmailPill =
  | "confirmed"
  | "pending"
  | "free"
  | "reminder"
  | "invite"
  | "warning"
  | "closure"
  | "cancelled"
  | "pause"
  | "changed"
  | "code"
  | "pause_lifted"
  | "season_ok"
  | "season_no";

export type RenderEmailInput = {
  muni: Municipality | null;
  locale: Locale;
  kind: EmailKind;
  data: Record<string, unknown>;
};

export type RenderedEmail = {
  subject: string;
  preheader: string;
  html: string;
  text: string;
  attachments: EmailAttachment[];
  footerKind: EmailFooterKind;
  /** Nome visible From: "{Concello} · Reservas". */
  fromName: string;
  replyTo?: string;
  /** Preferencia Conta › Avisos (null = transaccional / persoal). */
  notifyType:
    | "confirmacion"
    | "recordatorio"
    | "cambio"
    | "cancelacion"
    | "praza_liberada"
    | "partido_club"
    | "partido_aberto"
    | null;
};

export type EmailBlockContext = {
  muni: Municipality | null;
  locale: Locale;
  baseUrl: string;
  brand: string;
  accent: string;
  buttonBg: string;
  escudoUrl: string | null;
  concelloName: string;
  headerSubtitle: string;
  titular: string;
  sinatura: string;
  address: string;
  legalEmail: string;
  /** REVISION-40 P1 — teléfono/correo de contacto (instalación ou concello). */
  contactPhone: string;
  contactEmail: string;
  isDeputacion: boolean;
  isPlatform: boolean;
};
