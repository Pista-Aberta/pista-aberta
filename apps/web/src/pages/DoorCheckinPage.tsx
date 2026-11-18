import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { apiX } from "../lib/api-complete";
import { useSession } from "../context/SessionContext";
import { EmptyState } from "../components/EmptyState";
import { formatWeekdayShort } from "../lib/format-date";

type DoorResult =
  | {
      state: "checked_in";
      facilityName: string;
      start: string;
      end: string;
      bookingId: string;
    }
  | {
      state: "no_reservation";
      facilityName: string;
      nextBooking?: {
        facilityName: string;
        date: string;
        start: string;
        end: string;
      };
    }
  | {
      state: "too_early";
      facilityName: string;
      start: string;
      end: string;
      checkInFrom: string;
      bookingId: string;
    }
  | {
      state: "passed";
      facilityName: string;
      start: string;
      end: string;
      bookingId: string;
    };

type NextBooking = {
  id: string;
  date: string;
  start: string;
  end: string;
  facilityName?: string;
  facilityId: string;
};

/** Check-in vía QR diario da porta (Rev4 / rev12 V5–V6). */
export function DoorCheckinPage() {
  const { slug: slugParam, facilityId = "" } = useParams();
  const slug = slugParam!;
  const [params] = useSearchParams();
  const code = params.get("code") ?? "";
  const date =
    params.get("d") ??
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Madrid",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  const { t, i18n } = useTranslation();
  const { user, municipality } = useSession();
  const [result, setResult] = useState<DoorResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [next, setNext] = useState<NextBooking | null>(null);
  const [facilityName, setFacilityName] = useState<string>("");

  useEffect(() => {
    if (!facilityId) return;
    void api
      .facility(slug, facilityId)
      .then((r) => setFacilityName(r.data.name))
      .catch(() => setFacilityName(""));
  }, [slug, facilityId]);

  useEffect(() => {
    if (!user) return;
    void api
      .myBookings(slug)
      .then((r) => {
        const upcoming = (r.data as NextBooking[])
          .filter((b) => b.date >= date)
          .sort((a, b) =>
            a.date === b.date
              ? a.start.localeCompare(b.start)
              : a.date.localeCompare(b.date),
          );
        setNext(upcoming[0] ?? null);
      })
      .catch(() => setNext(null));
  }, [user, slug, date]);

  useEffect(() => {
    if (!user || !code || !facilityId) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    void apiX
      .doorCheckIn(slug, facilityId, code, date)
      .then((r) => setResult(r.data as DoorResult))
      .catch((e) => {
        const codeErr = e instanceof Error ? e.message : "error";
        const key = `error.${codeErr}`;
        const margin =
          municipality?.settings?.checkInMarginMinutes ?? 30;
        const translated = t(key, { min: margin });
        setErr(translated === key ? t("common.error") : translated);
      })
      .finally(() => setBusy(false));
  }, [user, code, facilityId, slug, date, t]);

  if (!user) {
    return (
      <main className="pa-page max-w-lg">
        <h1 className="pa-h1">{t("door.title")}</h1>
        <EmptyState
          title={t("common.needLogin")}
          body={t("door.loginHint")}
          actionLabel={t("nav.identify")}
          actionTo={`/c/${slug}/acceso?returnTo=${encodeURIComponent(`/c/${slug}/porta/${facilityId}?code=${code}&d=${date}`)}`}
        />
      </main>
    );
  }

  const summary = (facility: string, start: string, end: string) =>
    t("door.bookingSummary", { facility, time: start, end });

  const nextLabel = (nb: { date: string; start: string; facilityName?: string }) => {
    const day = formatWeekdayShort(nb.date, i18n.language).toLowerCase();
    const n = Number(nb.date.slice(8, 10));
    return t("door.nextBookingLine", {
      date: `${day} ${n}`,
      time: nb.start,
      facility: nb.facilityName ?? "",
    });
  };

  // V5: sen código (ligazón directa / QR vello)
  if (!code) {
    return (
      <main className="pa-page max-w-lg text-center">
        <h1 className="pa-h1">{t("door.title")}</h1>
        <p className="mt-4 text-base text-ink">{t("door.scanQrHint")}</p>
        {facilityName ? (
          <p className="mt-2 text-sm text-graphite">{facilityName}</p>
        ) : null}
        {next ? (
          <p className="mt-6 text-base font-bold text-marino" role="status">
            {nextLabel(next)}
          </p>
        ) : (
          <p className="mt-6 text-sm text-graphite">{t("door.noUpcoming")}</p>
        )}
        <Link to={`/c/${slug}/reservas`} className="pa-btn-secondary mt-8 inline-flex">
          {t("nav.myBookings")}
        </Link>
      </main>
    );
  }

  return (
    <main className="pa-page max-w-lg text-center">
      <h1 className="pa-h1">{t("door.title")}</h1>
      {busy && !result ? (
        <p className="mt-2 text-graphite">{t("door.hint")}</p>
      ) : null}
      {busy && <p className="mt-6 text-graphite">{t("common.loading")}</p>}
      {result?.state === "checked_in" && (
        <div className="mt-6 space-y-3">
          <p className="pa-ok-banner justify-center" role="status">
            ✓{" "}
            {t("door.checkinDone", {
              facility: result.facilityName,
              time: result.start,
            })}
          </p>
          <p className="text-base font-bold text-marino">
            {summary(result.facilityName, result.start, result.end)}
          </p>
        </div>
      )}
      {result?.state === "no_reservation" && (
        <div className="mt-6 space-y-4">
          <p className="pa-warn-banner justify-center" role="status">
            {result.nextBooking
              ? t("door.noReservationNext", {
                  date: `${formatWeekdayShort(result.nextBooking.date, i18n.language).toLowerCase()} ${Number(result.nextBooking.date.slice(8, 10))}`,
                  time: result.nextBooking.start,
                })
              : t("door.noReservation")}
          </p>
          {result.nextBooking ? (
            <p className="text-sm text-graphite">
              {result.nextBooking.facilityName} · {result.nextBooking.start}–
              {result.nextBooking.end}
            </p>
          ) : (
            <p className="text-sm text-graphite">{result.facilityName}</p>
          )}
          <Link to={`/c/${slug}/instalacions`} className="pa-btn-primary inline-flex">
            {t("door.reserveCta")}
          </Link>
        </div>
      )}
      {result?.state === "too_early" && (
        <div className="mt-6 space-y-3">
          <p className="text-lg font-bold text-marino">
            {summary(result.facilityName, result.start, result.end)}
          </p>
          <p className="text-base text-ink" role="status">
            {t("door.reservationLater", {
              time: result.start,
              from: result.checkInFrom,
              facility: result.facilityName,
            })}
          </p>
        </div>
      )}
      {result?.state === "passed" && (
        <p className="pa-warn-banner mt-6 justify-center" role="status">
          {t("door.passed", {
            facility: result.facilityName,
            time: result.start,
          })}
        </p>
      )}
      {err && (
        <div className="pa-warn-banner mt-6" role="alert">
          <span aria-hidden>⚠</span>
          <span>{err}</span>
        </div>
      )}
      {result?.state !== "no_reservation" && (
        <Link to={`/c/${slug}/reservas`} className="pa-btn-secondary mt-8 inline-flex">
          {t("nav.myBookings")}
        </Link>
      )}
    </main>
  );
}
