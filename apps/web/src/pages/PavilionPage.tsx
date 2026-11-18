import { useParams } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { icsUrl } from "../lib/api-complete";
import { formatDate } from "../lib/format-date";
import { useSession } from "../context/SessionContext";
import { PavilionWeekendGrid } from "../components/PavilionWeekendGrid";

type Pavilion = Awaited<ReturnType<typeof api.pavilion>>["data"];

export function PavilionPage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const [data, setData] = useState<Pavilion | null>(null);
  const [msg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void api
      .pavilion(slug)
      .then((r) => setData(r.data))
      .catch(() => setError(t("common.error")));
  }, [slug, t]);

  useEffect(load, [load]);

  const canResolve =
    user && (user.role === "admin" || user.role === "club_manager");

  /* REVISION-50 A3: media pista quitada — usar «Mover» no panel. */

  if (!data && !error) {
    return (
      <main className="pa-page">
        <p className="text-graphite">{t("common.loading")}</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="pa-page">
        <div className="pa-warn-banner" role="alert">
          <span aria-hidden>⚠</span>
          <span>{error}</span>
        </div>
      </main>
    );
  }

  const showConflicts = Boolean(canResolve);
  const conflicts = showConflicts
    ? data.matches.filter((m) => m.status === "conflict")
    : [];
  /* REVISION-19 B1: veciñanza só ve aprobados, sen Proposto/Choque. */
  const publicStatuses = new Set(["scheduled", "resolved", "swapped", "moved"]);
  const gridMatches = showConflicts
    ? data.matches
    : data.matches
        .filter((m) => publicStatuses.has(m.status) && !m.id.startsWith("proposed-"))
        .map((m) => ({ ...m, status: "scheduled" }));

  return (
    <main className="pa-page">
      <h1 className="pa-h1">{t("pavilion.title")}</h1>
      <p className="mt-2 text-graphite">
        {formatDate(data.weekend, i18n.language)}
        {showConflicts && data.conflicts > 0 ? (
          <span className="pa-chip-warn ml-3">
            <span aria-hidden>⚠</span> {t("pavilion.conflicts", { count: data.conflicts })}
          </span>
        ) : null}
      </p>

      <a href={icsUrl(slug)} className="pa-btn-secondary mt-4 inline-flex min-h-11">
        {t("weekend.ics")}
      </a>

      {msg ? (
        <div className="pa-ok-banner mt-4" role="status">
          <span aria-hidden>✓</span>
          <span>{msg}</span>
        </div>
      ) : null}
      {error ? (
        <div className="pa-warn-banner mt-4" role="alert">
          <span aria-hidden>⚠</span>
          <span>{error}</span>
        </div>
      ) : null}

      <div className="mt-6">
        <PavilionWeekendGrid
          matches={gridMatches}
          hideHeading
          hideStatus={!showConflicts}
        />
      </div>

      {showConflicts && conflicts.length > 0 ? (
        <section className="mt-8">
          <h2 className="pa-h2">{t("pavilion.clash")}</h2>
          <ul className="mt-4 space-y-3">
            {conflicts.map((m) => (
              <li key={m.id} className="rounded-card border-[3px] border-warnBorder bg-warnBg p-4">
                <p className="text-lg font-bold">
                  {m.homeTeam} — {m.awayTeam}
                </p>
                <p className="text-sm text-graphite">
                  {formatDate(m.date, i18n.language)} · {m.start}–{m.end} · {m.unit}
                </p>
                {/* REVISION-50 A3: media pista / intercambio quitados — usar «Mover». */}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {showConflicts && conflicts.length === 0 ? (
        <div className="pa-ok-banner mt-8">
          <span aria-hidden>✓</span>
          <span>{t("pavilion.allClear")}</span>
        </div>
      ) : null}
    </main>
  );
}
