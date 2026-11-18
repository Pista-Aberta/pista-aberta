import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { NoticePayload } from "@pista-aberta/shared";
import { formatOfferCountdown } from "@pista-aberta/shared";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Info,
  RefreshCw,
  Users,
} from "lucide-react";
import { apiX } from "../lib/api-complete";
import { EmptyState, Button, Card, Badge } from "../components/ui";
import { formatDate, formatDayChip, formatTimeHm } from "../lib/format-date";
import { useSession } from "../context/SessionContext";

type NoticeRow = {
  id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt?: string;
  payload?: NoticePayload | null;
};

function isWaitlistOffer(n: NoticeRow): boolean {
  return n.type === "waitlist";
}

/** REVISION-38 J3: sen holdUntil / caducado → sen «Aceptar». */
function waitlistOfferLive(n: NoticeRow, now: Date): boolean {
  const hold = n.payload?.holdUntil;
  if (typeof hold !== "string" || !hold.trim()) return false;
  const until = new Date(hold);
  if (Number.isNaN(until.getTime())) return false;
  return until.getTime() > now.getTime();
}

function isClubCounter(n: NoticeRow): boolean {
  return (
    n.type === "info" &&
    n.payload?.kind === "club_counter" &&
    typeof n.payload?.requestId === "string"
  );
}

/** REVISION-39 L2: só botóns se a solicitude segue en counter_proposed. */
function clubCounterActionable(n: NoticeRow): boolean {
  if (!isClubCounter(n)) return false;
  const status = n.payload?.requestStatus;
  if (status == null) return true;
  return status === "counter_proposed";
}

function counterExpectBody(n: NoticeRow): {
  counterVersion?: number;
  start?: string;
  end?: string;
  date?: string;
  weekday?: number;
} {
  const p = n.payload ?? {};
  const body: {
    counterVersion?: number;
    start?: string;
    end?: string;
    date?: string;
    weekday?: number;
  } = {};
  if (typeof p.counterVersion === "number") body.counterVersion = p.counterVersion;
  if (typeof p.start === "string") body.start = p.start;
  if (typeof p.end === "string") body.end = p.end;
  if (typeof p.date === "string") body.date = p.date;
  if (typeof p.weekday === "number") body.weekday = p.weekday;
  return body;
}

function noticeKind(n: NoticeRow): string {
  const kind = n.payload?.kind;
  if (typeof kind === "string" && kind.trim()) return kind;
  if (n.type === "info" && typeof n.payload?.openMatchId === "string") {
    return "open_match";
  }
  return n.type;
}

/** REVISION-40 T2: quita datas ISO do corpo se aínda veñen da API. */
function scrubIsoDates(
  text: string,
  locale: string,
): string {
  return text.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (_, iso: string) =>
    formatDayChip(iso, locale),
  );
}

function displayBody(
  n: NoticeRow,
  locale: string,
  t: (key: string, opts?: Record<string, string>) => string,
  timeZone: string,
): string {
  const p = n.payload;
  /* REVISION-39 L1: Pediu / Propuxemos no aviso de contraproposta. */
  if (isClubCounter(n)) {
    const asked =
      typeof p?.askedLabel === "string" && p.askedLabel.trim()
        ? p.askedLabel.trim()
        : null;
    const proposed =
      typeof p?.whenLabel === "string" && p.whenLabel.trim()
        ? p.whenLabel.trim()
        : null;
    if (asked && proposed) {
      return t("notices.counterBody", { asked, proposed });
    }
    if (proposed) return proposed;
  }
  if (p?.date && typeof p.date === "string" && p.start && typeof p.start === "string") {
    const dateLabel = formatDayChip(p.date, locale);
    const unit =
      typeof p.unitName === "string" && p.unitName.trim()
        ? p.unitName.trim()
        : "";
    const fac =
      typeof p.facilityName === "string" && p.facilityName.trim()
        ? p.facilityName.trim()
        : "";
    /* REVISION-43 R3: preferir unitName (pista concreta). */
    const place = unit || fac || t("nav.reserve");
    if (p.holdUntil && typeof p.holdUntil === "string") {
      return t("notices.waitlistHoldBody", {
        facility: place,
        date: dateLabel,
        start: p.start,
        hold: formatTimeHm(p.holdUntil, timeZone),
      });
    }
    if (n.type === "waitlist") {
      return t("notices.waitlistRushBody", {
        facility: place,
        date: dateLabel,
        start: p.start,
      });
    }
    const code =
      typeof p.shortCode === "string" && p.shortCode.trim()
        ? p.shortCode.trim()
        : "";
    const parts = [fac, dateLabel, p.start, code].filter(Boolean);
    if (parts.length > 0) return parts.join(" · ");
  }
  return scrubIsoDates(n.body, locale);
}

/** REVISION-40 T2: icona segundo o tipo. */
function noticeIcon(n: NoticeRow) {
  const kind = noticeKind(n);
  if (n.type === "waitlist" || n.type === "reminder") {
    return { bg: "bg-aviso-bg", fg: "text-aviso", Icon: Bell };
  }
  if (n.type === "closure") {
    return { bg: "bg-aviso-bg", fg: "text-aviso", Icon: AlertTriangle };
  }
  if (
    kind === "open_match" ||
    kind.startsWith("open_match_") ||
    kind === "open_match_join" ||
    kind === "open_match_joined" ||
    kind === "open_match_invite" ||
    kind === "open_match_cancelled" ||
    kind === "open_match_moved"
  ) {
    return { bg: "bg-azul-25", fg: "text-azul-700", Icon: Users };
  }
  if (kind === "club_counter") {
    return { bg: "bg-azul-50", fg: "text-azul-700", Icon: RefreshCw };
  }
  const title = n.title.toLowerCase();
  if (
    n.type === "change" &&
    (title.includes("confirmada") ||
      title.includes("confirmada") ||
      title.includes("aprobada") ||
      title.includes("aprovada"))
  ) {
    return { bg: "bg-libre-bg", fg: "text-libre", Icon: CheckCircle2 };
  }
  if (n.type === "change") {
    return { bg: "bg-azul-50", fg: "text-azul-700", Icon: RefreshCw };
  }
  if (n.type === "info") {
    return { bg: "bg-azul-25", fg: "text-azul-700", Icon: Info };
  }
  return { bg: "bg-azul-25", fg: "text-azul-700", Icon: Info };
}

function relativeWhen(
  iso: string | undefined,
  locale: string,
  t: (key: string, opts?: Record<string, string | number>) => string,
): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return t("notices.relative.now");
  if (mins < 60) return t("notices.relative.minutes", { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("notices.relative.hours", { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("notices.relative.days", { n: days });
  return formatDate(iso.slice(0, 10), locale);
}

export function NoticesPage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { municipality } = useSession();
  const tz = municipality?.settings?.timezone ?? "Europe/Madrid";
  const [rows, setRows] = useState<NoticeRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const load = () => {
    void apiX.notices(slug).then((r) => {
      const now = new Date();
      /* Mantén ofertas waitlist vivas aínda se marcadas como lidas (aceptar). */
      setRows(
        r.data.filter(
          (n) => !n.read || (isWaitlistOffer(n) && waitlistOfferLive(n, now)),
        ),
      );
    });
  };

  useEffect(() => {
    load();
  }, [slug]);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const typeLabel = (n: NoticeRow) => {
    const kind = noticeKind(n);
    const kindKey = `notices.type.${kind}`;
    const kindLabel = t(kindKey);
    if (kindLabel !== kindKey) return kindLabel;
    const typeKey = `notices.type.${n.type}`;
    const typeLabelled = t(typeKey);
    return typeLabelled === typeKey ? n.type : typeLabelled;
  };

  const markRead = async (id: string) => {
    setError(null);
    setBusyId(id);
    try {
      await apiX.markNotice(slug, id);
      setRows((prev) =>
        prev.filter((x) => {
          if (x.id !== id) return true;
          /* Non ocultar oferta waitlist viva: ainda hai que aceptar. */
          return isWaitlistOffer(x) && waitlistOfferLive(x, new Date());
        }),
      );
    } catch {
      setError(t("notices.markError"));
    } finally {
      setBusyId(null);
    }
  };

  const acceptPraza = async (id: string) => {
    setError(null);
    setMsg(null);
    setBusyId(id);
    try {
      const res = await apiX.acceptWaitlistNotice(slug, id);
      setRows((prev) => prev.filter((x) => x.id !== id));
      const fac = res.data.facilityName?.trim() || "";
      const start = res.data.start?.trim() || "";
      setMsg(
        t("notices.acceptOk", {
          facility: fac || t("nav.reserve"),
          start: start || "—",
        }),
      );
      /* REVISION-42 Q9c: volver á portada para refrescar. */
      window.setTimeout(() => {
        navigate(`/c/${slug}`);
      }, 1200);
    } catch (ex) {
      const code = ex instanceof Error ? ex.message : "";
      if (code === "overlapping_booking") {
        const fac =
          ex && typeof ex === "object" && "facilityName" in ex
            ? String((ex as { facilityName?: string }).facilityName ?? "")
            : "";
        const time =
          ex && typeof ex === "object" && "start" in ex
            ? String((ex as { start?: string }).start ?? "")
            : "";
        setError(
          t("error.overlapping_booking", {
            facility: fac || "—",
            time: time || "—",
          }),
        );
      } else if (code === "slot_occupied") {
        setError(t("error.slot_occupied"));
      } else {
        setError(t("notices.acceptError"));
      }
    } finally {
      setBusyId(null);
    }
  };

  const respondCounter = async (n: NoticeRow, accept: boolean) => {
    const requestId =
      typeof n.payload?.requestId === "string" ? n.payload.requestId : "";
    if (!requestId) return;
    setError(null);
    setMsg(null);
    setBusyId(n.id);
    try {
      const body = counterExpectBody(n);
      if (accept) await apiX.acceptClubCounter(slug, requestId, body);
      else await apiX.rejectClubCounter(slug, requestId, body);
      setRows((prev) => prev.filter((x) => x.id !== n.id));
      setMsg(accept ? t("notices.counterAcceptOk") : t("notices.counterRejectOk"));
    } catch (ex) {
      const code = ex instanceof Error ? ex.message : "";
      if (code === "stale_counter") setError(t("notices.counterStale"));
      else setError(t("common.error"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main className="pa-page-read pb-28 md:pb-12">
      <h1 className="pa-h1 m-0">{t("nav.notices")}</h1>
      {msg ? (
        <p className="pa-ok-banner mt-3 text-sm" role="status">
          ✓ {msg}
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm font-bold text-erro" role="alert">
          {error}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title={t("notices.empty")}
            description={t("notices.emptyHint")}
            actionLabel={t("nav.reserve")}
            onAction={() => navigate(`/c/${slug}/reservar`)}
          />
        </div>
      ) : (
        <ul className="mt-6 flex list-none flex-col gap-3 p-0">
          {rows.map((n) => {
            const offer = isWaitlistOffer(n);
            const counter = clubCounterActionable(n);
            const now = new Date(nowTick);
            const offerLive = offer && waitlistOfferLive(n, now);
            const offerExpired = offer && !offerLive;
            const tone = noticeIcon(n);
            const Icon = tone.Icon;
            const when = relativeWhen(n.createdAt, i18n.language, t);
            return (
              <li key={n.id}>
                <Card lift={false} className="p-4">
                  <div className="flex items-start gap-3">
                    <span
                      className={`flex h-10 w-10 flex-none items-center justify-center rounded-[12px] ${tone.bg} ${tone.fg}`}
                      aria-hidden
                    >
                      <Icon size={20} strokeWidth={2.2} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={offer ? "aviso" : "info"}>{typeLabel(n)}</Badge>
                        {when ? (
                          <span className="text-[12px] font-bold text-graphite">{when}</span>
                        ) : null}
                      </div>
                      <p className="mt-1.5 m-0 font-extrabold text-marino">{n.title}</p>
                      <p className="mt-1 m-0 text-sm text-graphite">
                        {displayBody(n, i18n.language, t, tz)}
                      </p>
                      {offerLive
                        ? (() => {
                            const hold =
                              n.payload?.holdUntil && typeof n.payload.holdUntil === "string"
                                ? n.payload.holdUntil
                                : null;
                            const label = formatOfferCountdown(hold, now, tz);
                            return label ? (
                              <p className="mt-2 m-0 text-sm font-bold text-aviso">{label}</p>
                            ) : null;
                          })()
                        : null}
                      {offerExpired ? (
                        <p className="mt-2 m-0 text-sm font-bold text-erro" role="status">
                          {t("notices.offerExpired")}
                        </p>
                      ) : null}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {offerLive ? (
                          <Button
                            type="button"
                            disabled={busyId === n.id}
                            onClick={() => void acceptPraza(n.id)}
                            className="min-h-11"
                          >
                            {t("notices.accept")}
                          </Button>
                        ) : null}
                        {counter ? (
                          <>
                            <Button
                              type="button"
                              disabled={busyId === n.id}
                              onClick={() => void respondCounter(n, true)}
                              className="min-h-11"
                            >
                              {t("notices.counterAccept")}
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={busyId === n.id}
                              onClick={() => void respondCounter(n, false)}
                              className="min-h-11"
                            >
                              {t("notices.counterReject")}
                            </Button>
                          </>
                        ) : null}
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={busyId === n.id}
                          onClick={() => void markRead(n.id)}
                          className="min-h-11"
                        >
                          {t("notices.markRead")}
                        </Button>
                      </div>
                      {offer ? (
                        <p className="mt-3 m-0 text-sm">
                          <Link
                            to={`/c/${slug}/reservas`}
                            className="font-bold text-azul-700 no-underline hover:underline"
                          >
                            {t("nav.myBookings")}
                          </Link>
                        </p>
                      ) : null}
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
