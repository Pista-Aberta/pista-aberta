import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiX } from "../lib/api-complete";
import { api } from "../lib/api";
import { formatDate } from "../lib/format-date";

type PavMatch = Awaited<ReturnType<typeof api.pavilion>>["data"]["matches"][number];

function matchSortKey(m: PavMatch) {
  return `${m.date}T${m.start}`;
}

export function StaffSheetPage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const { t, i18n } = useTranslation();
  const [day, setDay] = useState<Array<Record<string, unknown>>>([]);
  const [pav, setPav] = useState<Awaited<ReturnType<typeof api.pavilion>>["data"] | null>(null);
  const [date, setDate] = useState("");
  const [muniName, setMuniName] = useState("");

  useEffect(() => {
    void apiX.staffDay(slug).then((r) => {
      setDay(r.data);
      setDate(r.date);
    });
    void api.pavilion(slug).then((r) => setPav(r.data));
    void api.info(slug).then((r) => setMuniName(r.data.name)).catch(() => setMuniName(slug));
  }, [slug]);

  const weekendMatches = useMemo(() => {
    if (!pav) return [];
    return [...pav.matches]
      .filter((m) => m.status !== "conflict")
      .sort((a, b) => matchSortKey(a).localeCompare(matchSortKey(b)));
  }, [pav]);

  const conflicts = useMemo(
    () => (pav ? pav.matches.filter((m) => m.status === "conflict") : []),
    [pav],
  );

  const subtitle = date
    ? `${formatDate(date, i18n.language)} · ${muniName || slug}`
    : muniName || slug;

  return (
    <main className="pa-page print:max-w-none">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h1 className="pa-h1 m-0">{t("staff.sheetTitle")}</h1>
        <div className="flex flex-wrap gap-2">
          <Link to={`/c/${slug}/conserxeria`} className="pa-btn-secondary print:hidden">
            {t("staff.checkin")}
          </Link>
          <button type="button" className="pa-btn-primary" onClick={() => window.print()}>
            {t("staff.print")}
          </button>
        </div>
      </div>
      <article className="pa-card p-6">
        {/* REVISION-33 D7: título «Folla do día»; partidos na súa sección. */}
        <h2 className="m-0 text-lg font-extrabold text-marino">{t("staff.sheetSubtitle")}</h2>
        <p className="mt-1 text-graphite">{subtitle}</p>
        <h3 className="mt-6 font-bold">{t("staff.opening")}</h3>
        <p className="text-sm">08:00 — 22:00</p>
        <h3 className="mt-4 font-bold">{t("staff.today")}</h3>
        <ul className="mt-2 space-y-1 text-sm">
          {day.map((b) => (
            <li key={String(b.id)}>
              {String(b.start)}–{String(b.end)} · {String(b.facilityName)} · {String(b.userDisplayName)} ·{" "}
              {String(b.shortCode)}
            </li>
          ))}
        </ul>
      </article>
      {pav ? (
        <article className="pa-card mt-6 p-6">
          <h2 className="m-0 text-lg font-extrabold text-marino">{t("weekend.title")}</h2>
          {conflicts.length > 0 ? (
            <p className="mt-2 text-sm font-bold text-aviso" role="status">
              {t("pavilion.conflicts", { count: pav.conflicts })}
            </p>
          ) : null}
          <ul className="mt-3 space-y-1 text-sm">
            {weekendMatches.map((m) => (
              <li key={m.id}>
                {formatDate(m.date, i18n.language)} {m.start}–{m.end} · {m.homeTeam} vs {m.awayTeam} ·{" "}
                {m.unit} · {t("admin.svc.vestiarios")}
              </li>
            ))}
          </ul>
        </article>
      ) : null}
    </main>
  );
}
