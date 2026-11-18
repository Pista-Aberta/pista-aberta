import { buildBookingIcs } from "../../lib/booking-ics.js";
import {
  absolutePath,
  bookingPath,
  buildEmailContext,
  cancelBookingPath,
  modifyBookingPath,
} from "./context.js";
import {
  antesDeIrBlock,
  dataCard,
  primaryButton,
  qrInline,
  secondaryButton,
  secondaryLink,
} from "./blocks.js";
import {
  bookingCalendarIcsUrl,
  bookingCardRows,
  designBookingTitle,
  timeRangeLabel,
} from "./booking-content.js";
import { comoChegarMailBlock } from "./como-chegar-block.js";
import { emailT } from "./i18n.js";
import { finalizeKind } from "./kind-result.js";
import { buildQrPng } from "./qr-png.js";
import type { Municipality, Locale } from "@pista-aberta/shared";
import type { RenderedEmail } from "./types.js";

export type BookingConfirmedData = {
  userName: string;
  sport: string;
  facilityName: string;
  facilityId: string;
  facilityAddress?: string;
  facilityLat?: number;
  facilityLng?: number;
  facilityPhone?: string;
  facilityEmail?: string;
  facilityPerson?: string;
  parkingInfo?: string;
  entranceInfo?: string;
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

export async function renderBookingConfirmed(
  muni: Municipality,
  locale: Locale,
  data: BookingConfirmedData,
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
      ? `Reserva confirmada · ${data.sport}, ${data.dayLabel} a las ${data.start}`
      : `Reserva confirmada · ${data.sport}, ${data.dayLabel} ás ${data.start}`;
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
  const changeHref = absolutePath(
    ctx,
    modifyBookingPath(muni.slug, data.facilityId, data.bookingId),
  );
  const cancelHref = absolutePath(
    ctx,
    cancelBookingPath(muni.slug, data.bookingId),
  );
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

  const how = comoChegarMailBlock(ctx, locale, {
    facilityName: data.facilityName,
    facilityLat: data.facilityLat,
    facilityLng: data.facilityLng,
    parkingInfo: data.parkingInfo,
    entranceInfo: data.entranceInfo,
  });

  /* E5: código unha soa vez, xunto ao QR (qrInline xa o amosa). */
  /* G9: calendario = botón secundario. */
  const bodyHtml =
    dataCard(ctx, rows) +
    qrInline("booking-qr", data.shortCode) +
    primaryButton(ctx, emailT(locale, "cta.viewBooking"), viewHref) +
    secondaryButton(emailT(locale, "cta.addToCalendar"), calHref, ctx) +
    how.html +
    secondaryLink(emailT(locale, "cta.change"), changeHref) +
    secondaryLink(emailT(locale, "cta.cancel"), cancelHref) +
    antesDeIrBlock(locale === "es" ? "es" : "gl", data.antesDeIr ?? []);

  return finalizeKind(ctx, {
    subject,
    preheader,
    title,
    pill: "confirmed",
    helloName: data.userName,
    bodyHtml,
    textParts: [
      data.unitName ? `Pista: ${data.unitName}` : "",
      data.facilityName,
      data.facilityAddress ?? "",
      `${data.date} · ${range}`,
      `Código ${data.shortCode}`,
      ...how.textParts,
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
