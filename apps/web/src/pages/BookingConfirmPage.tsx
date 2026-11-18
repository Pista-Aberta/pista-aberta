import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarPlus, MapPinned, Share2 } from "lucide-react";
import { isEmailLocalPartName, shortPublicName } from "@pista-aberta/shared";
import { api } from "../lib/api";
import { formatDate, formatWeekdayShort } from "../lib/format-date";
import { QrPlaceholder } from "../components/QrPlaceholder";
import { CancelDialog } from "../components/CancelDialog";
import { InstallAppButton } from "../components/InstallAppButton";
import { downloadBookingIcs, shareBookingLink } from "../lib/booking-ics";
import { useSession } from "../context/SessionContext";
import { Button, Ticket, Toast } from "../components/ui";

type Booking = Awaited<ReturnType<typeof api.booking>>["data"];

function dayNum(iso: string) {
  return Number(iso.slice(8, 10));
}

function coordStr(v: unknown): string | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n)) return null;
  return String(n);
}

function osmDirectionsUrl(b: Booking): string | null {
  const lat = coordStr(b.facilityLat);
  const lng = coordStr(b.facilityLng);
  if (lat && lng) {
    return `https://www.openstreetmap.org/?mlat=${encodeURIComponent(lat)}&mlon=${encodeURIComponent(lng)}#map=17/${encodeURIComponent(lat)}/${encodeURIComponent(lng)}`;
  }
  const q = [b.facilityName, b.facilityAddress].filter(Boolean).join(", ");
  if (!q) return null;
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(q)}`;
}

function ConfirmCheck() {
  return (
    <span
      className="pa-ui-check inline-flex h-14 w-14 items-center justify-center rounded-full bg-libre-bg text-libre"
      aria-hidden
    >
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
        <path
          className="pa-ui-check__mark"
          d="M5 12l5 5 9-10"
          stroke="currentColor"
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function BookingConfirmPage() {
  const { slug: slugParam, id = "" } = useParams();
  const slug = slugParam!;
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const { t, i18n } = useTranslation();
  const changed = search.get("cambiada") === "1";
  const openCancelFromQuery = search.get("accion") === "cancelar";
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offlineOk, setOfflineOk] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /* REVISION-40 P2 — facer partido aberto desde reserva confirmada futura. */
  const [makeMatchOpen, setMakeMatchOpen] = useState(false);
  const [omTitle, setOmTitle] = useState("");
  const [omSport, setOmSport] = useState("padel");
  const [omSpots, setOmSpots] = useState(4);
  const [omLevel, setOmLevel] = useState("");
  const [omNotes, setOmNotes] = useState("");
  const [omBusy, setOmBusy] = useState(false);
  const [nameConsent, setNameConsent] = useState(false);
  const [displayNameInput, setDisplayNameInput] = useState("");
  const { user, refreshUser } = useSession();
  const needsDisplayName =
    !!user && isEmailLocalPartName(user.displayName, user.email);
  const publicNamePreview = needsDisplayName
    ? displayNameInput.trim()
      ? shortPublicName(displayNameInput)
      : "…"
    : user?.displayName
      ? shortPublicName(user.displayName)
      : "Ana R.";

  useEffect(() => {
    const cacheKey = `pa_qr_${id}`;
    void api
      .booking(slug, id)
      .then((r) => {
        setBooking(r.data);
        try {
          localStorage.setItem(cacheKey, JSON.stringify(r.data));
          setOfflineOk(true);
        } catch {
          /* ignore */
        }
      })
      .catch((e) => {
        try {
          const raw = localStorage.getItem(cacheKey);
          if (raw) {
            setBooking(JSON.parse(raw) as Booking);
            setOfflineOk(true);
            return;
          }
        } catch {
          /* ignore */
        }
        const code = e instanceof Error ? e.message : "";
        const key = code ? `error.${code}` : "";
        const translated = key ? t(key) : "";
        setError(
          translated && translated !== key ? translated : t("common.error"),
        );
      });
  }, [slug, id, t]);

  /* REVISION-38 K1: ?accion=cancelar abre o diálogo (correo confirmación/pendente). */
  useEffect(() => {
    if (!booking || !openCancelFromQuery) return;
    const canCancel =
      booking.status === "confirmed" || booking.status === "pending";
    if (canCancel) setCancelOpen(true);
    const next = new URLSearchParams(search);
    next.delete("accion");
    setSearch(next, { replace: true });
  }, [booking, openCancelFromQuery, search, setSearch]);

  const doCancel = async () => {
    if (!booking) return;
    setBusy(true);
    try {
      const res = await api.cancelBooking(slug, booking.id);
      setCancelOpen(false);
      const offered = res.offeredTo ?? 0;
      setToast(
        offered > 0
          ? t("bookings.cancelToast")
          : t("bookings.cancelToastFree", {
              defaultValue:
                "Cancelada. A hora queda libre para outra persoa",
            }),
      );
      setBooking({ ...booking, status: "cancelled" });
      window.setTimeout(() => setToast(null), 5000);
    } catch {
      setError(t("common.error"));
      setCancelOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const createOpenMatchFromBooking = async () => {
    if (!booking || !omTitle.trim()) {
      setError(t("openMatch.titleRequired"));
      return;
    }
    if (needsDisplayName && displayNameInput.trim().length < 2) {
      setError(t("error.display_name_required"));
      return;
    }
    if (!nameConsent) {
      setError(t("error.consent_required"));
      return;
    }
    setOmBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/c/${slug}/partidos-abertos`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookingId: booking.id,
          title: omTitle.trim(),
          sport: omSport || undefined,
          spotsTotal: omSpots,
          level: omLevel || undefined,
          notes: omNotes.trim() || undefined,
          nameDisplayConsent: true,
          ...(needsDisplayName
            ? { displayName: displayNameInput.trim() }
            : {}),
        }),
      });
      const j = (await res.json()) as {
        data?: { id: string };
        error?: string;
      };
      if (!res.ok) throw new Error(j.error ?? t("common.error"));
      if (needsDisplayName) await refreshUser();
      setToast(t("openMatch.created"));
      navigate(`/c/${slug}/partidos-abertos/${j.data!.id}`);
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      const key = code ? `error.${code}` : "";
      const translated = key ? t(key) : "";
      setError(
        translated && translated !== key ? translated : t("common.error"),
      );
    } finally {
      setOmBusy(false);
    }
  };

  if (error && !booking) {
    return (
      <main className="mx-auto max-w-lg px-4 py-10">
        <div className="pa-warn-banner" role="alert">
          <span aria-hidden>⚠</span>
          <span>{error === "unauthorized" ? t("common.needLogin") : error}</span>
        </div>
        <Link
          to={`/c/${slug}/acceso?returnTo=/c/${slug}/reserva/${id}`}
          className="mt-4 inline-flex"
        >
          <Button>{t("nav.login")}</Button>
        </Link>
      </main>
    );
  }

  if (!booking) {
    return (
      <main className="mx-auto max-w-lg px-4 py-10" aria-busy="true">
        <div className="flex flex-col items-center gap-4">
          <span className="pa-ui-skeleton h-14 w-14 rounded-full" />
          <span className="pa-ui-skeleton h-6 w-48 rounded-lg" />
          <span className="pa-ui-skeleton h-56 w-full rounded-[22px]" />
        </div>
      </main>
    );
  }

  const facilityName = booking.facilityName ?? t("booking.title");
  const pending = booking.status === "pending";
  const cancelled = booking.status === "cancelled";
  const showQr = booking.status === "confirmed" || booking.status === "checked_in";
  const canCancel = booking.status === "confirmed" || booking.status === "pending";
  const bookingStartMs = Date.parse(`${booking.date}T${booking.start}:00`);
  const existingOpenMatchId =
    typeof booking.openMatchId === "string" && booking.openMatchId.trim()
      ? booking.openMatchId.trim()
      : null;
  const canMakeOpenMatch =
    !existingOpenMatchId &&
    booking.status === "confirmed" &&
    Number.isFinite(bookingStartMs) &&
    bookingStartMs > Date.now();
  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/c/${slug}/reserva/${booking.id}`
      : `/c/${slug}/reserva/${booking.id}`;
  const osmUrl = osmDirectionsUrl(booking);
  const dateLabel = formatDate(booking.date, i18n.language);
  const cancelReason =
    typeof booking.cancelReason === "string" && booking.cancelReason.trim()
      ? booking.cancelReason.trim()
      : null;

  const onCalendar = () => {
    downloadBookingIcs({
      id: booking.id,
      facilityName,
      date: booking.date,
      start: booking.start,
      end: booking.end,
      shortCode: booking.shortCode,
      slug,
    });
  };

  const onShare = () => {
    void shareBookingLink({
      title: t("booking.shareTitle", { facility: facilityName }),
      text: t("booking.shareText", {
        facility: facilityName,
        date: dateLabel,
        start: booking.start,
        end: booking.end,
      }),
      url: shareUrl,
    }).then((r) => {
      if (r === "copied") setToast(t("booking.linkCopied"));
      else if (r === "shared") setToast(t("booking.shared"));
      else setToast(t("common.error"));
    });
  };

  const title = cancelled
    ? t("booking.cancelled")
    : pending
      ? t("booking.pending")
      : changed
        ? t("booking.changed")
        : t("booking.confirmed");

  const eyebrow = cancelled
    ? t("booking.cancelledEyebrow")
    : pending
      ? t("booking.pendingEyebrow", { defaultValue: t("booking.pendingNote") })
      : t("ui.ticket.eyebrow");

  return (
    <main className="relative mx-auto min-h-[70vh] max-w-lg px-4 pb-28 pt-8 text-ink md:pb-12">
      <div className="flex flex-col items-center gap-3 text-center">
        {cancelled ? (
          <span
            className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-erro-bg text-2xl text-erro"
            aria-hidden
          >
            ×
          </span>
        ) : pending ? (
          <span
            className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-ambar-bg text-2xl text-marino"
            aria-hidden
          >
            …
          </span>
        ) : (
          <ConfirmCheck />
        )}
        <h1 className="m-0 text-[26px] font-extrabold tracking-[-0.02em] text-marino">
          {title}
        </h1>
        {cancelled && cancelReason ? (
          <p className="m-0 rounded-xl border border-line bg-surface px-3 py-2 text-[15px] font-bold text-marino">
            {cancelReason}
          </p>
        ) : null}
        {pending ? (
          <p className="m-0 rounded-xl border border-ambar bg-ambar-bg px-3 py-2 text-[15px] font-bold text-marino">
            {t("booking.pendingNote")}
          </p>
        ) : changed && !cancelled ? (
          <p className="m-0 rounded-xl border border-ambar bg-ambar-bg px-3 py-2 text-[15px] font-bold text-marino">
            {t("booking.changedNote")}
          </p>
        ) : null}
        <p className="m-0 text-[15px] text-graphite">
          {cancelled
            ? t("booking.cancelledHint")
            : pending
              ? t("booking.pendingHint")
              : t("booking.qrHint")}
        </p>
      </div>

      <div className="mt-7">
        <Ticket
          accent={cancelled ? "ambar" : "azul"}
          weekday={formatWeekdayShort(booking.date, i18n.language)}
          day={dayNum(booking.date)}
          eyebrow={eyebrow}
          title={facilityName}
          subtitle={`${dateLabel} · ${booking.start}–${booking.end}`}
          body={
            showQr ? (
              <div className="flex flex-col items-center gap-2">
                <QrPlaceholder
                  shortCode={booking.shortCode}
                  payload={booking.qrPayload}
                  size={200}
                  bare
                />
                {offlineOk ? (
                  <p className="m-0 text-center text-[13px] text-graphite">
                    {t("booking.offlineSaved")}
                  </p>
                ) : null}
                <div className="mt-3 w-full max-w-sm text-left">
                  <p className="m-0 mb-2 text-center text-[13px] text-graphite">
                    {t("install.confirmHint")}
                  </p>
                  <InstallAppButton compact />
                </div>
              </div>
            ) : (
              <p className="m-0 text-center text-sm text-graphite">
                {cancelled
                  ? t("booking.cancelledTicketBody")
                  : t("booking.pendingTicketBody")}
              </p>
            )
          }
        />
      </div>

      {cancelled ? (
        <div className="mt-6 flex flex-col gap-3">
          <Button
            type="button"
            onClick={() => navigate(`/c/${slug}/reservar`)}
            className="w-full"
          >
            {t("booking.bookAgain")}
          </Button>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          <Button type="button" onClick={onCalendar} className="w-full">
            <CalendarPlus size={20} strokeWidth={2.4} aria-hidden />
            {t("booking.addToCalendar")}
          </Button>
          <Button type="button" variant="secondary" onClick={onShare} className="w-full">
            <Share2 size={20} strokeWidth={2.4} aria-hidden />
            {t("booking.shareWithPlayers")}
          </Button>
          {existingOpenMatchId ? (
            <Link
              to={`/c/${slug}/partidos-abertos/${existingOpenMatchId}`}
              className="pa-ui-interactive inline-flex h-12 min-h-11 w-full items-center justify-center gap-2.5 rounded-btn border-[1.5px] border-line bg-surface px-[18px] font-extrabold text-base text-marino no-underline hover:border-marino"
            >
              {t("openMatch.viewFromBooking")}
            </Link>
          ) : null}
          {canMakeOpenMatch ? (
            makeMatchOpen ? (
              <div className="flex flex-col gap-2 rounded-xl border border-line bg-paper/60 p-3 text-left">
                <p className="m-0 text-[15px] font-extrabold text-marino">
                  {t("openMatch.makeFromBooking")}
                </p>
                <label className="flex flex-col gap-1 text-sm font-bold">
                  {t("openMatch.formTitle")}
                  <input
                    className="pa-input"
                    required
                    minLength={2}
                    maxLength={120}
                    value={omTitle}
                    onChange={(e) => setOmTitle(e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm font-bold">
                  {t("openMatch.sport")}
                  <select
                    className="pa-input"
                    value={omSport}
                    onChange={(e) => setOmSport(e.target.value)}
                  >
                    <option value="padel">{t("openMatch.sport.padel")}</option>
                    <option value="tenis">{t("openMatch.sport.tenis")}</option>
                    <option value="futbol_sala">
                      {t("openMatch.sport.futbol_sala")}
                    </option>
                    <option value="baloncesto">
                      {t("openMatch.sport.baloncesto")}
                    </option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm font-bold">
                  {t("openMatch.spots")}
                  <input
                    type="number"
                    min={2}
                    max={20}
                    className="pa-input w-24"
                    value={omSpots}
                    onChange={(e) =>
                      setOmSpots(
                        Math.min(20, Math.max(2, Number(e.target.value) || 4)),
                      )
                    }
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm font-bold">
                  {t("openMatch.levelLabel")}
                  <select
                    className="pa-input"
                    value={omLevel}
                    onChange={(e) => setOmLevel(e.target.value)}
                  >
                    <option value="">{t("openMatch.levelAny")}</option>
                    <option value="principiante">
                      {t("openMatch.level.principiante")}
                    </option>
                    <option value="medio">{t("openMatch.level.medio")}</option>
                    <option value="avanzado">
                      {t("openMatch.level.avanzado")}
                    </option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm font-bold">
                  {t("openMatch.notes")}
                  <textarea
                    className="pa-input min-h-[64px]"
                    maxLength={500}
                    value={omNotes}
                    onChange={(e) => setOmNotes(e.target.value)}
                  />
                </label>
                {needsDisplayName ? (
                  <label className="flex flex-col gap-1 text-sm font-bold">
                    {t("openMatch.displayNameLabel")}
                    <input
                      className="pa-input"
                      required
                      minLength={2}
                      maxLength={80}
                      autoComplete="name"
                      placeholder={t("openMatch.displayNamePh")}
                      value={displayNameInput}
                      onChange={(e) => setDisplayNameInput(e.target.value)}
                      data-testid="confirm-open-match-display-name"
                    />
                  </label>
                ) : null}
                <label className="flex min-h-11 items-start gap-2.5 text-[15px]">
                  <input
                    type="checkbox"
                    className="mt-1 h-[22px] w-[22px] shrink-0 accent-azul"
                    checked={nameConsent}
                    onChange={(e) => setNameConsent(e.target.checked)}
                    disabled={
                      needsDisplayName && displayNameInput.trim().length < 2
                    }
                  />
                  <span>
                    {t("openMatch.nameConsent", { name: publicNamePreview })}
                  </span>
                </label>
                <p className="m-0 pl-[34px] text-[13px] leading-snug text-graphite">
                  {t("openMatch.nameConsentHint")}{" "}
                  <Link
                    to={`/c/${slug}/legal/privacidade`}
                    className="font-bold text-azul-700 underline"
                  >
                    {t("legal.privacy")}
                  </Link>
                </p>
                <div className="mt-1 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    disabled={
                      omBusy ||
                      !omTitle.trim() ||
                      !nameConsent ||
                      (needsDisplayName && displayNameInput.trim().length < 2)
                    }
                    onClick={() => void createOpenMatchFromBooking()}
                  >
                    {t("openMatch.publish")}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={omBusy}
                    onClick={() => setMakeMatchOpen(false)}
                  >
                    {t("common.cancel")}
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setMakeMatchOpen(true)}
                className="w-full"
              >
                {t("openMatch.makeFromBooking")}
              </Button>
            )
          ) : null}
          {osmUrl ? (
            <a
              href={osmUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="pa-ui-interactive inline-flex h-12 min-h-11 w-full items-center justify-center gap-2.5 rounded-btn border-[1.5px] border-line bg-surface px-[18px] font-extrabold text-base text-marino no-underline hover:border-marino"
            >
              <MapPinned size={20} strokeWidth={2.4} aria-hidden />
              {t("booking.howToGet")}
            </a>
          ) : null}
        </div>
      )}

      {error && booking ? (
        <p className="mt-4 text-center text-sm font-bold text-alert" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        {booking.status === "confirmed" ? (
          <>
            <Link
              to={`/c/${slug}/reservar/${booking.facilityId}?data=${booking.date}&slot=${booking.slotId ?? ""}&modificar=${booking.id}`}
              className="pa-btn-secondary min-h-11 px-4 text-sm"
            >
              {t("bookings.modify")}
            </Link>
            <span className="text-line" aria-hidden>
              ·
            </span>
          </>
        ) : null}
        {canCancel ? (
          <>
            <button
              type="button"
              className="pa-btn-danger min-h-11 px-4 text-sm"
              onClick={() => setCancelOpen(true)}
            >
              {t("bookings.cancel")}
            </button>
            <span className="text-line" aria-hidden>
              ·
            </span>
          </>
        ) : null}
        <Link
          to={`/c/${slug}/reservas`}
          className="font-bold text-azul-700 no-underline hover:underline"
        >
          {t("nav.myBookings")}
        </Link>
        <span className="text-line" aria-hidden>
          ·
        </span>
        <Link
          to={`/c/${slug}`}
          className="font-bold text-azul-700 no-underline hover:underline"
        >
          {t("nav.home")}
        </Link>
        <span className="text-line" aria-hidden>
          ·
        </span>
        <Link
          to={`/c/${slug}/incidencia?facility=${encodeURIComponent(booking.facilityId)}`}
          className="font-bold text-azul-700 no-underline hover:underline"
        >
          {t("incident.fromFacility")}
        </Link>
      </div>

      <CancelDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={() => void doCancel()}
        busy={busy}
      />

      {toast ? (
        <Toast message={toast} onDismiss={() => setToast(null)} />
      ) : null}
    </main>
  );
}
