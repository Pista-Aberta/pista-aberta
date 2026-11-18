import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ScanLine } from "lucide-react";
import jsQR from "jsqr";
import { api } from "../lib/api";
import { apiX } from "../lib/api-complete";
import { InstallAppButton } from "../components/InstallAppButton";
import { Button, Card, EmptyState } from "../components/ui";

type CheckResult = {
  valid: boolean;
  reason?: string;
  booking?: { shortCode: string; userDisplayName: string; start: string; end: string };
};

type FlashKind = "ok" | "already" | "early" | "bad" | null;

declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats: string[] }) => {
      detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue: string }>>;
    };
  }
}

function vibrate(pattern: number | number[]) {
  try {
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  } catch {
    /* ignore */
  }
}

function earlyFrom(start: string, marginMin = 30): string {
  const [h, m] = start.split(":").map(Number);
  let mins = (h ?? 0) * 60 + (m ?? 0) - marginMin;
  if (mins < 0) mins = 0;
  const hh = String(Math.floor(mins / 60)).padStart(2, "0");
  const mm = String(mins % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function isEarlyArrival(r: CheckResult): boolean {
  if (r.valid || r.reason !== "fora_de_ventan" || !r.booking?.start) return false;
  const nowHm = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  return nowHm < r.booking.start;
}

function isAlreadyCheckedIn(r: CheckResult): boolean {
  return !r.valid && (r.reason === "xa_rexistrado" || r.reason === "already_checked_in");
}

function madridTodayIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());
}

function madridTomorrowIso(): string {
  const [y, m, d] = madridTodayIso().split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + 1, 12));
  return dt.toISOString().slice(0, 10);
}

function nowHmMadrid(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

function earliestStart(rows: Array<{ start?: unknown }>): string | null {
  const starts = rows
    .map((r) => String(r.start ?? ""))
    .filter((s) => /^\d{2}:\d{2}$/.test(s))
    .sort();
  return starts[0] ?? null;
}

export function StaffCheckinPage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const { t } = useTranslation();
  const [shortCode, setShortCode] = useState("");
  const [payload, setPayload] = useState("");
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [flash, setFlash] = useState<FlashKind>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [day, setDay] = useState<Array<Record<string, unknown>>>([]);
  const [tomorrowDay, setTomorrowDay] = useState<Array<Record<string, unknown>>>([]);
  const [tomorrowOpen, setTomorrowOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [printMode, setPrintMode] = useState(false);
  /* REVISION-57 W9: sen cámara → só código curto. */
  const cameraAvailable = useMemo(
    () =>
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia &&
      (window.isSecureContext || location.hostname === "localhost"),
    [],
  );
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const scanGenRef = useRef(0);

  const reloadDay = useCallback(() => {
    const tomorrow = madridTomorrowIso();
    /* REVISION-58 W10: .catch visible. */
    void apiX
      .staffDay(slug)
      .then((r) => setDay(r.data))
      .catch(() => setDay([]));
    void apiX
      .staffDay(slug, tomorrow)
      .then((r) => {
        setTomorrowDay(r.data);
        const fromBookings = earliestStart(r.data);
        if (fromBookings) {
          setTomorrowOpen(fromBookings);
          return;
        }
        void api
          .availability(slug, { date: tomorrow })
          .then((av) => {
            const openSlots = av.data.filter((s) => !s.closed);
            setTomorrowOpen(earliestStart(openSlots));
          })
          .catch(() => setTomorrowOpen(null));
      })
      .catch(() => {
        setTomorrowDay([]);
        setTomorrowOpen(null);
      });
  }, [slug]);

  useEffect(() => {
    reloadDay();
  }, [reloadDay]);

  useEffect(() => {
    const onBefore = () => setPrintMode(true);
    const onAfter = () => setPrintMode(false);
    window.addEventListener("beforeprint", onBefore);
    window.addEventListener("afterprint", onAfter);
    return () => {
      window.removeEventListener("beforeprint", onBefore);
      window.removeEventListener("afterprint", onAfter);
    };
  }, []);

  const showResult = (r: CheckResult) => {
    setResult(r);
    const already = isAlreadyCheckedIn(r);
    const early = isEarlyArrival(r);
    const kind: FlashKind = r.valid ? "ok" : already ? "already" : early ? "early" : "bad";
    setFlash(kind);
    if (kind === "ok" || kind === "already") vibrate([40, 40, 80]);
    else if (kind === "early") vibrate([30, 60, 30, 60, 30]);
    else vibrate(120);
    reloadDay();
    window.setTimeout(() => setFlash(null), 3200);
  };

  const normalizeShort = (raw: string) => {
    let code = raw.trim().toUpperCase().replace(/\s+/g, "");
    if (code && !code.startsWith("PA-") && /^[A-Z0-9]{4,8}$/.test(code)) {
      code = `PA-${code}`;
    }
    return code;
  };

  const doCheckin = async (body: { qrPayload?: string; shortCode?: string }) => {
    const payloadBody = body.shortCode
      ? { shortCode: normalizeShort(body.shortCode) }
      : body;
    try {
      const r = await apiX.checkin(slug, payloadBody);
      showResult(r.data);
    } catch (ex) {
      /* REVISION-58 W10: amosar o erro real da API se existe. */
      const msg =
        ex instanceof Error && ex.message && ex.message !== "Error"
          ? ex.message
          : "reserva_inexistente";
      showResult({ valid: false, reason: msg });
    }
  };

  const stopScan = useCallback(() => {
    scanGenRef.current += 1;
    setScanning(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    const video = videoRef.current;
    if (video) {
      video.srcObject = null;
    }
  }, []);

  useEffect(() => () => stopScan(), [stopScan]);

  const cameraFailReason = (err: unknown): string => {
    const name = err instanceof DOMException ? err.name : "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      return t("staff.cameraDenied");
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return t("staff.cameraMissing");
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
      return t("staff.cameraBusy");
    }
    if (!window.isSecureContext && location.hostname !== "localhost") {
      return t("staff.needHttps");
    }
    return t("staff.cameraDenied");
  };

  const startScan = async () => {
    setResult(null);
    setFlash(null);
    setCameraError(null);

    if (!window.isSecureContext && location.hostname !== "localhost") {
      setCameraError(t("staff.needHttps"));
      setResult({ valid: false, reason: t("staff.needHttps") });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(t("staff.cameraMissing"));
      setResult({ valid: false, reason: t("staff.cameraMissing") });
      return;
    }

    const gen = ++scanGenRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      if (gen !== scanGenRef.current) {
        stream.getTracks().forEach((tr) => tr.stop());
        return;
      }
      streamRef.current = stream;
      setScanning(true);
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      }

      /* REVISION-57 W9: BarcodeDetector se existe; se non, jsqr nos fotogramas. */
      const Detector = window.BarcodeDetector;
      const detector = Detector ? new Detector({ formats: ["qr_code"] }) : null;
      if (!canvasRef.current) {
        canvasRef.current = document.createElement("canvas");
      }
      const tick = async () => {
        if (gen !== scanGenRef.current) return;
        const v = videoRef.current;
        if (v && v.readyState >= 2) {
          try {
            let raw: string | undefined;
            if (detector) {
              const codes = await detector.detect(v);
              raw = codes[0]?.rawValue?.trim();
            } else {
              const canvas = canvasRef.current!;
              const w = v.videoWidth || 640;
              const h = v.videoHeight || 480;
              if (canvas.width !== w) canvas.width = w;
              if (canvas.height !== h) canvas.height = h;
              const ctx = canvas.getContext("2d", { willReadFrequently: true });
              if (ctx) {
                ctx.drawImage(v, 0, 0, w, h);
                const img = ctx.getImageData(0, 0, w, h);
                const code = jsQR(img.data, img.width, img.height, {
                  inversionAttempts: "dontInvert",
                });
                raw = code?.data?.trim();
              }
            }
            if (raw) {
              stopScan();
              await doCheckin(
                raw.includes("|") ? { qrPayload: raw } : { shortCode: raw },
              );
              return;
            }
          } catch {
            /* keep scanning */
          }
        }
        rafRef.current = requestAnimationFrame(() => void tick());
      };
      rafRef.current = requestAnimationFrame(() => void tick());
    } catch (err) {
      if (gen !== scanGenRef.current) return;
      setCameraError(cameraFailReason(err));
      setScanning(false);
    }
  };

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    if (shortCode.trim()) {
      await doCheckin({ shortCode: shortCode.trim() });
      setShortCode("");
      return;
    }
    if (payload.trim()) {
      await doCheckin({ qrPayload: payload.trim() });
      setPayload("");
    }
  };

  const manualCheckin = async (b: Record<string, unknown>) => {
    const code = String(b.shortCode ?? "");
    if (code) await doCheckin({ shortCode: code });
  };

  const markNoShow = async (b: Record<string, unknown>) => {
    const id = String(b.id ?? "");
    if (!id) return;
    try {
      await apiX.adminNoShow(slug, id);
      reloadDay();
    } catch {
      showResult({ valid: false, reason: "reserva_inexistente" });
    }
  };

  const reasonLabel = (reason?: string) => {
    if (!reason) return "";
    /* REVISION-59 L4: staff.reason.* → error.* → texto xenérico. */
    const staffKey = `staff.reason.${reason}`;
    const staffT = t(staffKey);
    if (staffT !== staffKey) return staffT;
    const errKey = `error.${reason}`;
    const errT = t(errKey);
    if (errT !== errKey) return errT;
    return t("common.error");
  };

  const listSource = printMode || !filter.trim() ? day : day.filter((b) => {
    const q = filter.toLowerCase();
    return (
      String(b.shortCode ?? "").toLowerCase().includes(q) ||
      String(b.userDisplayName ?? "").toLowerCase().includes(q)
    );
  });

  const demoNext = import.meta.env.VITE_PA_DEMO === "1";

  const dayList = (
    <section className="pa-staff-day-list">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h2 className="m-0 text-lg font-extrabold text-marino">{t("staff.today")}</h2>
        <button
          type="button"
          className="text-sm font-bold text-azul-700 underline"
          onClick={() => window.print()}
        >
          {t("staff.printSheet", { defaultValue: "Imprimir folla" })}
        </button>
      </div>
      <h2 className="mb-3 hidden text-lg font-extrabold text-marino print:block">
        {t("staff.today")}
      </h2>
      <input
        className="pa-input mt-3 print:hidden"
        placeholder={t("staff.search")}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {day.length === 0 && tomorrowDay.length === 0 && !tomorrowOpen ? (
        <div className="mt-3">
          <EmptyState
            title={t("staff.empty")}
            description={t("staff.emptyHint")}
            actionLabel={t("staff.printSheet", { defaultValue: "Imprimir folla" })}
            onAction={() => window.print()}
          />
        </div>
      ) : (
        (() => {
          const nowHm = nowHmMadrid();
          const bucket = (b: Record<string, unknown>) => {
            const start = String(b.start ?? "");
            const end = String(b.end ?? "");
            if (b.status === "checked_in" || b.status === "no_show") return "done";
            if (end && end <= nowHm) return "past";
            if (start && start <= nowHm && end > nowHm) return "now";
            return "soon";
          };
          const groups: Array<{
            id: "now" | "soon" | "past" | "done";
            title: string;
            rows: typeof listSource;
          }> = [
            { id: "now", title: t("staff.now"), rows: [] },
            { id: "soon", title: t("staff.upcoming"), rows: [] },
            { id: "past", title: t("staff.past"), rows: [] },
            { id: "done", title: t("staff.doneGroup"), rows: [] },
          ];
          for (const b of listSource) {
            const g = groups.find((x) => x.id === bucket(b));
            g?.rows.push(b);
          }
          const nowEmpty = groups.find((g) => g.id === "now")!.rows.length === 0;
          const soonGroup = groups.find((g) => g.id === "soon")!;
          const soonFirst = soonGroup.rows[0];
          const showTomorrowUpcoming = nowEmpty && soonGroup.rows.length === 0;
          const nextHint =
            nowEmpty && soonFirst
              ? t("staff.nobodyNowNext", {
                  time: String(soonFirst.start ?? ""),
                  defaultValue: `Non hai ninguén agora · próxima ás ${String(soonFirst.start ?? "")}`,
                })
              : nowEmpty
                ? t("staff.nobodyNow", {
                    defaultValue: "Non hai ninguén agora",
                  })
                : null;

          const renderRows = (
            rows: typeof listSource,
            groupId: "now" | "soon" | "past" | "done",
          ) => (
            <ul className="mt-2 flex list-none flex-col gap-2 p-0">
              {rows.map((b) => (
                <li key={String(b.id)}>
                  <Card
                    lift={false}
                    className="flex min-h-[52px] flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
                  >
                    <span>
                      <strong>{String(b.shortCode ?? "")}</strong> ·{" "}
                      {String(b.userDisplayName ?? "")} · {String(b.start ?? "")}–
                      {String(b.end ?? "")} ·{" "}
                      {t(`status.${String(b.status)}`, {
                        defaultValue: String(b.status),
                      })}
                    </span>
                    {(groupId === "now" || groupId === "soon") &&
                    b.status === "confirmed" ? (
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-11 min-h-11 text-sm print:hidden"
                        onClick={() => void manualCheckin(b)}
                      >
                        {t("staff.manualCheckin")}
                      </Button>
                    ) : null}
                    {groupId === "past" && b.status === "confirmed" ? (
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-11 min-h-11 text-sm print:hidden"
                        onClick={() => void markNoShow(b)}
                      >
                        {t("staff.markNoShow")}
                      </Button>
                    ) : null}
                  </Card>
                </li>
              ))}
            </ul>
          );

          return (
            <div className="mt-4 space-y-6">
              {nextHint ? (
                <p className="m-0 text-sm font-bold text-graphite print:hidden" role="status">
                  {nextHint}
                </p>
              ) : null}
              {groups
                .filter((g) => {
                  if (g.rows.length > 0) return true;
                  /* Keep Próximas visible when nobody now and we fall back to tomorrow. */
                  return g.id === "soon" && showTomorrowUpcoming;
                })
                .map((g) => {
                  const pastCollapsedHint = g.id === "past" && !printMode;
                  /* Past starts closed on screen (toggleable); force open when printing. */
                  const openProp =
                    printMode || g.id !== "past" ? ({ open: true } as const) : {};
                  return (
                    <details
                      key={`${g.id}-${printMode ? "print" : "screen"}`}
                      {...openProp}
                      className="group pa-staff-day-group"
                      data-group={g.id}
                    >
                      <summary className="cursor-pointer list-none text-sm font-extrabold uppercase tracking-wide text-graphite [&::-webkit-details-marker]:hidden">
                        {g.title}
                        {pastCollapsedHint ? (
                          <span className="ml-2 font-normal normal-case tracking-normal">
                            ({g.rows.length})
                          </span>
                        ) : null}
                      </summary>
                      {g.id === "soon" && showTomorrowUpcoming ? (
                        <div className="mt-2 space-y-2">
                          {tomorrowOpen ? (
                            <p className="m-0 text-sm font-bold text-marino" role="status">
                              {t("staff.tomorrowOpens", {
                                time: tomorrowOpen,
                                defaultValue: `Mañá abre ás ${tomorrowOpen}`,
                              })}
                            </p>
                          ) : null}
                          {tomorrowDay.length > 0
                            ? renderRows(tomorrowDay, "soon")
                            : null}
                        </div>
                      ) : (
                        renderRows(g.rows, g.id)
                      )}
                    </details>
                  );
                })}
            </div>
          );
        })()
      )}
    </section>
  );

  const flashTone =
    flash === "ok" || flash === "already"
      ? "bg-libre text-on-dark"
      : flash === "early"
        ? "bg-aviso text-on-dark"
        : "bg-erro text-on-dark";

  return (
    <main className="pa-page pb-28 md:pb-12">
      <h1 className="pa-h1 m-0">{t("staff.checkin")}</h1>
      <p className="mt-2 text-graphite print:hidden">{t("staff.hintScan")}</p>

      {flash && result ? (
        <div
          className={`fixed inset-0 z-[70] flex items-center justify-center p-6 print:hidden ${flashTone}`}
          role="status"
          aria-live="assertive"
        >
          <div className="max-w-sm text-center">
            <p className="text-7xl font-extrabold" aria-hidden>
              {flash === "ok" || flash === "already" ? "✓" : flash === "early" ? "⏳" : "!"}
            </p>
            <p className="mt-5 text-[28px] font-extrabold leading-tight">
              {flash === "ok"
                ? t("staff.entryRegistered")
                : flash === "already"
                  ? t("staff.alreadyEntered", {
                      time: result.booking?.start ?? "",
                      name: result.booking?.userDisplayName ?? "",
                      start: result.booking?.start ?? "",
                      end: result.booking?.end ?? "",
                      defaultValue: `Xa entrou ás ${result.booking?.start ?? ""} · ${result.booking?.userDisplayName ?? ""} · ${result.booking?.start ?? ""}–${result.booking?.end ?? ""}`,
                    })
                  : flash === "early"
                    ? t("staff.arrivedEarly", {
                        time: earlyFrom(result.booking?.start ?? "18:00"),
                      })
                    : t("staff.invalid")}
            </p>
            {flash === "bad" && result.reason ? (
              <p className="mt-3 text-lg font-bold opacity-95">{reasonLabel(result.reason)}</p>
            ) : null}
            {flash !== "already" && result.booking ? (
              <p className="mt-4 text-lg font-bold opacity-95">
                {result.booking.userDisplayName} · {result.booking.start}–{result.booking.end}
              </p>
            ) : null}
            <button
              type="button"
              className="pa-ui-interactive pa-ui-interactive-on-dark mt-8 min-h-12 rounded-btn border-[1.5px] border-on-dark/40 bg-transparent px-5 font-extrabold"
              onClick={() => setFlash(null)}
            >
              {t("common.close")}
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-6 grid gap-10 lg:grid-cols-2 lg:items-start">
        <div className="pa-staff-scan print:hidden">
          <div className="flex flex-col gap-3">
            <video
              ref={videoRef}
              className={
                scanning
                  ? "aspect-[4/3] w-full rounded-card bg-marino object-cover"
                  : "pointer-events-none absolute h-px w-px opacity-0"
              }
              playsInline
              muted
              autoPlay
              aria-hidden={!scanning}
            />
            {cameraAvailable ? (
              !scanning ? (
                <Button
                  type="button"
                  className="h-28 min-h-28 w-full text-[22px]"
                  onClick={() => void startScan()}
                >
                  <ScanLine size={28} strokeWidth={2.4} aria-hidden />
                  {t("staff.scan")}
                </Button>
              ) : (
                <Button type="button" variant="secondary" onClick={stopScan}>
                  {t("staff.stopScan")}
                </Button>
              )
            ) : null}
            {cameraError && !scanning ? (
              <p className="text-sm text-aviso" role="alert">
                {cameraError}
              </p>
            ) : null}
          </div>

          <form onSubmit={(e) => void submitCode(e)} className="mt-8 flex flex-col gap-3">
            <label className="flex flex-col gap-2 font-bold">
              {t("staff.shortCode")}
              <input
                className="pa-input font-mono uppercase tracking-wider"
                value={shortCode}
                onChange={(e) => setShortCode(e.target.value.toUpperCase())}
                placeholder="PA-7K2M"
                autoCapitalize="characters"
                autoComplete="off"
                inputMode="text"
                enterKeyHint="go"
                spellCheck={false}
              />
              <span className="text-xs font-normal text-graphite">{t("staff.shortCodeHint")}</span>
            </label>
            {demoNext ? (
              <details>
                <summary className="cursor-pointer text-sm font-bold text-graphite">
                  {t("staff.pastePayload")}
                </summary>
                <textarea
                  className="pa-input mt-2 min-h-20 font-mono text-sm"
                  value={payload}
                  onChange={(e) => setPayload(e.target.value)}
                />
              </details>
            ) : null}
            <Button type="submit" variant="secondary" className="self-start">
              {t("staff.validate")}
            </Button>
          </form>

          {demoNext && day[0] ? (
            <button
              type="button"
              className="mt-3 text-xs font-bold text-graphite underline"
              onClick={() =>
                void doCheckin({
                  qrPayload: String(day.find((b) => b.status === "confirmed")?.qrPayload ?? ""),
                })
              }
            >
              {t("staff.simulateScan")}
            </button>
          ) : null}

          <div className="mt-4 border-t border-line pt-4">
            <InstallAppButton compact />
          </div>
        </div>

        <div>{dayList}</div>
      </div>
    </main>
  );
}
