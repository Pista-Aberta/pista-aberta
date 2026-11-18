import type { Locale, Municipality } from "@pista-aberta/shared";
import { buildBookingIcs } from "../../lib/booking-ics.js";
import {
  absolutePath,
  bookingPath,
  buildEmailContext,
} from "./context.js";
import {
  antesDeIrBlock,
  dataCard,
  primaryButton,
  qrInline,
  secondaryButton,
} from "./blocks.js";
import {
  bookingCalendarIcsUrl,
  bookingCardRows,
  designBookingTitle,
  timeRangeLabel,
} from "./booking-content.js";
import { emailT } from "./i18n.js";
import { finalizeKind } from "./kind-result.js";
import { buildQrPng } from "./qr-png.js";
import type { RenderedEmail } from "./types.js";

export type BookingApprovedData = {
  userName: string;
  sport: string;
  facilityName: string;
  facilityId?: string;
  facilityAddress?: string;
  facilityPhone?: string;
  facilityEmail?: string;
  facilityPerson?: string;
  unitName?: string;
  dayLabel: string;
  timeLabel: string;
  date: string;
  start: string;
  end: string;
  shortCode: string;
  qrPayload: string;
  bookingId: string;
  icsSequence?: number;
  antesDeIr?: string[];
  unsubscribeUrl?: string;
};

export async function renderBookingApproved(
  muni: Municipality,
  locale: Locale,
  data: BookingApprovedData,
): Promise<RenderedEmail> {
  const ctx = buildEmailContext({
    muni,
    locale,
    facility: {
      contactPhone: data.facilityPhone,
      contactEmail: data.facilityEmail,
      contactPerson: data.facilityPerson,
    },
  });
  const range = timeRangeLabel(data.start, data.end);
  const subject =
    locale === "es"
      ? `Reserva aprobada · ${data.sport}, ${data.dayLabel} a las ${data.start}`
      : `Reserva aprobada · ${data.sport}, ${data.dayLabel} ás ${data.start}`;
  const preheader =
    locale === "es"
      ? `Código ${data.shortCode}. Muestra el QR en conserjería.`
      : `Código ${data.shortCode}. Amosa o QR na conserxería.`;
  const title = designBookingTitle(locale, data.date, data.start);
  const qrBuf = await buildQrPng(data.qrPayload, 180);
  const ics = buildBookingIcs({
    id: data.bookingId,
    facilityName: data.facilityName,
    date: data.date,
    start: data.start,
    end: data.end,
    shortCode: data.shortCode,
    sequence: data.icsSequence ?? 0,
  });
  const viewHref = absolutePath(ctx, bookingPath(muni.slug, data.bookingId));
  const calHref = bookingCalendarIcsUrl({
    slug: muni.slug,
    bookingId: data.bookingId,
  });
  const rows = bookingCardRows(locale, {
    facilityName: data.facilityName,
    unitName: data.unitName,
    address: data.facilityAddress,
    date: data.date,
    start: data.start,
    end: data.end,
  });

  return finalizeKind(ctx, {
    subject,
    preheader,
    title,
    pill: "confirmed",
    helloName: data.userName,
    bodyHtml:
      dataCard(ctx, rows) +
      qrInline("booking-qr", data.shortCode) +
      primaryButton(ctx, emailT(locale, "cta.viewBooking"), viewHref) +
      secondaryButton(emailT(locale, "cta.addToCalendar"), calHref, ctx) +
      antesDeIrBlock(locale === "es" ? "es" : "gl", data.antesDeIr ?? []),
    textParts: [
      data.unitName ? `Pista: ${data.unitName}` : "",
      data.facilityName,
      data.facilityAddress ?? "",
      `${data.date} · ${range}`,
      `Código ${data.shortCode}`,
      ...(data.antesDeIr ?? []),
      viewHref,
      calHref,
    ],
    footerKind: "A",
    notifyType: "confirmacion",
    unsubscribeUrl: data.unsubscribeUrl,
    attachments: [
      {
        filename: "qr.png",
        content: qrBuf,
        contentType: "image/png",
        cid: "booking-qr",
        contentDisposition: "inline",
      },
      {
        filename: "reserva.ics",
        content: Buffer.from(ics, "utf8"),
        contentType: "text/calendar; method=PUBLISH",
        contentDisposition: "attachment",
      },
    ],
  });
}
