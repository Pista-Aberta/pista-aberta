import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type Hazard = { kind: string; text: string };

type MeteoPayload = {
  outdoor?: boolean;
  line?: string | null;
  hazards?: Hazard[];
  warning?: { period: "manha" | "tarde" | "noite"; chance: number } | null;
  attribution?: string;
};

type Props = {
  slug: string;
  facilityId: string;
  date?: string;
  start?: string;
  className?: string;
};

/**
 * REVISION-40 N3 — liña de previsión sempre en outdoor
 * («Tarde: chuvascos, 14 °C») + avisos en palabras (vento/treboada/calor/xeada).
 */
export function MeteoRainNotice({
  slug,
  facilityId,
  date,
  start,
  className = "",
}: Props) {
  const { t, i18n } = useTranslation();
  const [outdoor, setOutdoor] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [hazards, setHazards] = useState<Hazard[]>([]);
  const [attribution, setAttribution] = useState("Datos: MeteoGalicia");

  useEffect(() => {
    if (!facilityId) return;
    const lang = i18n.language?.startsWith("es") ? "es" : "gl";
    const q = new URLSearchParams({ lang });
    if (date) q.set("date", date);
    if (start) q.set("start", start);
    let cancelled = false;
    void fetch(`/api/c/${slug}/facilities/${facilityId}/meteo?${q}`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { data?: MeteoPayload } | null) => {
        if (cancelled || !j?.data) return;
        setOutdoor(j.data.outdoor === true);
        setLine(j.data.line ?? null);
        setHazards(Array.isArray(j.data.hazards) ? j.data.hazards : []);
        if (j.data.attribution) setAttribution(j.data.attribution);
      })
      .catch(() => {
        /* silencioso: tempo opcional */
      });
    return () => {
      cancelled = true;
    };
  }, [slug, facilityId, date, start, i18n.language]);

  if (!outdoor || (!line && hazards.length === 0)) return null;

  return (
    <aside
      className={`rounded-xl border border-line bg-area px-3 py-2 text-sm text-marino ${className}`}
      role="status"
    >
      {line ? <p className="font-bold">{line}</p> : null}
      {hazards.length > 0 ? (
        <ul className={`text-sm ${line ? "mt-1" : ""}`}>
          {hazards.map((h) => (
            <li key={h.kind}>{h.text}</li>
          ))}
        </ul>
      ) : null}
      <p className="mt-1 text-xs text-graphite">
        {attribution || t("meteo.attribution")}
      </p>
    </aside>
  );
}
