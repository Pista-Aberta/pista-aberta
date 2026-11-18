export const DEFAULT_MADRID_TZ = "Europe/Madrid";

/**
 * REVISION-60 N11: data YYYY-MM-DD e hora HH:MM na zona do concello (Europe/Madrid por defecto),
 * evitando o desfase de 1–2 h de `new Date().toISOString().slice(0, 10)` (UTC).
 */
export function madridTodayAndHm(
  now: Date = new Date(),
  timeZone: string = DEFAULT_MADRID_TZ,
): { today: string; hm: string } {
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = dateParts.find((p) => p.type === "year")?.value ?? "1970";
  const m = dateParts.find((p) => p.type === "month")?.value ?? "01";
  const d = dateParts.find((p) => p.type === "day")?.value ?? "01";

  const timeParts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const rawHour = timeParts.find((p) => p.type === "hour")?.value ?? "00";
  const hour = rawHour === "24" ? "00" : rawHour;
  const minute = timeParts.find((p) => p.type === "minute")?.value ?? "00";

  return {
    today: `${y}-${m}-${d}`,
    hm: `${hour}:${minute}`,
  };
}
