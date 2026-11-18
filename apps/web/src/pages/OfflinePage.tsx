import { Link, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { QrPlaceholder } from "../components/QrPlaceholder";
import { formatDate } from "../lib/format-date";
import { BackLink } from "../components/BackLink";
import { useSession } from "../context/SessionContext";

type SavedQr = {
  id: string;
  shortCode: string;
  qrPayload: string;
  date: string;
  start: string;
  end: string;
  facilityName?: string;
  status?: string;
};

function readSavedQrs(): SavedQr[] {
  const out: SavedQr[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith("pa_qr_")) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const data = JSON.parse(raw) as Partial<SavedQr>;
        if (!data.id || !data.shortCode || !data.qrPayload || !data.date || !data.start) {
          continue;
        }
        out.push({
          id: data.id,
          shortCode: data.shortCode,
          qrPayload: data.qrPayload,
          date: data.date,
          start: data.start,
          end: data.end ?? data.start,
          facilityName: data.facilityName,
          status: data.status,
        });
      } catch {
        /* ignore bad entry */
      }
    }
  } catch {
    /* localStorage unavailable */
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || b.start.localeCompare(a.start));
}

/** REVISION-21 Q6 — páxina offline cos QR gardados (pa_qr_*). */
const STAFF_ROLES = new Set(["staff", "monitor", "admin", "superadmin"]);

export function OfflinePage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const showConserxeria = !!user && STAFF_ROLES.has(user.role);
  const [items, setItems] = useState<SavedQr[]>([]);
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    setItems(readSavedQrs());
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  return (
    <main className="pa-page mx-auto max-w-lg">
      <BackLink to={`/c/${slug}`}>{t("nav.home")}</BackLink>
      <h1 className="pa-h1 mt-4">{t("offline.title")}</h1>
      <p className="mt-2 text-sm text-graphite">
        {online ? t("offline.onlineHint") : t("offline.offlineHint")}
      </p>

      {items.length === 0 ? (
        <p className="mt-6 text-sm text-graphite">{t("offline.empty")}</p>
      ) : (
        <ul className="mt-6 space-y-6">
          {items.map((b) => (
            <li key={b.id} className="pa-card flex flex-col items-center gap-3 p-5 text-center">
              <p className="m-0 text-[15px] font-extrabold text-marino">
                {b.facilityName ?? t("booking.title")}
              </p>
              <p className="m-0 text-sm text-graphite">
                {formatDate(b.date, i18n.language)} · {b.start}–{b.end}
              </p>
              <QrPlaceholder shortCode={b.shortCode} payload={b.qrPayload} size={160} bare />
              <Link
                to={`/c/${slug}/reserva/${b.id}`}
                className="text-sm font-bold text-azul-700 no-underline hover:underline"
              >
                {t("offline.openBooking")}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {showConserxeria ? (
        <p className="mt-8 text-sm text-graphite">
          <Link
            to={`/c/${slug}/folla-conserxe`}
            className="font-bold text-azul-700 no-underline hover:underline"
          >
            {t("offline.conserxeria")}
          </Link>
        </p>
      ) : null}
    </main>
  );
}
