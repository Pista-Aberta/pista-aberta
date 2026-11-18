/** Xera un ficheiro .ics dunha reserva confirmada (redeseno B4). */

export type BookingIcsInput = {
  id: string;
  facilityName: string;
  date: string; // YYYY-MM-DD
  start: string; // HH:MM
  end: string;
  shortCode?: string;
  slug?: string;
  /** SEQUENCE RFC5545 — +1 ao modificar. */
  sequence?: number;
};

function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function toIcsLocalStamp(date: string, hm: string): string {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = hm.split(":").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}${pad(mo!)}${pad(d!)}T${pad(h!)}${pad(mi!)}00`;
}

function dtStampUtc(now = new Date()): string {
  return now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

const EUROPE_MADRID_VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Madrid",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "TZNAME:CEST",
  "DTSTART:19700329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "TZNAME:CET",
  "DTSTART:19701025T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
] as const;

function veventLines(b: BookingIcsInput, stamp: string): string[] {
  const uid = `booking-${b.id}@pistaaberta.com`;
  const summary = icsEscape(`${b.facilityName} · ${b.start}–${b.end}`);
  const desc = icsEscape(
    b.shortCode
      ? `Reserva Pista Aberta · código ${b.shortCode}`
      : "Reserva Pista Aberta",
  );
  const dtStart = toIcsLocalStamp(b.date, b.start);
  const dtEnd = toIcsLocalStamp(b.date, b.end);
  return [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `SEQUENCE:${Math.max(0, b.sequence ?? 0)}`,
    `DTSTART;TZID=Europe/Madrid:${dtStart}`,
    `DTEND;TZID=Europe/Madrid:${dtEnd}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${desc}`,
    "END:VEVENT",
  ];
}

export function buildBookingIcs(b: BookingIcsInput): string {
  const stamp = dtStampUtc();
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Pista Aberta//Reservas//GL",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...EUROPE_MADRID_VTIMEZONE,
    ...veventLines(b, stamp),
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

export function buildPersonalCalendarIcs(events: BookingIcsInput[]): string {
  const stamp = dtStampUtc();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Pista Aberta//Calendario persoal//GL",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "NAME:Pista Aberta",
    ...EUROPE_MADRID_VTIMEZONE,
  ];
  for (const ev of events) {
    lines.push(...veventLines(ev, stamp));
  }
  lines.push("END:VCALENDAR", "");
  return lines.join("\r\n");
}

export function downloadBookingIcs(b: BookingIcsInput): void {
  const blob = new Blob([buildBookingIcs(b)], {
    type: "text/calendar;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `reserva-${b.date}-${(b.shortCode ?? b.id).slice(0, 12)}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function shareBookingLink(opts: {
  title: string;
  text: string;
  url: string;
}): Promise<"shared" | "copied" | "failed"> {
  try {
    if (typeof navigator !== "undefined" && navigator.share) {
      await navigator.share(opts);
      return "shared";
    }
  } catch {
    /* fall through to clipboard */
  }
  try {
    await navigator.clipboard.writeText(opts.url);
    return "copied";
  } catch {
    return "failed";
  }
}
