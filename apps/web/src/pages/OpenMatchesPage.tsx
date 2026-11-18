/**
 * REVISION-40 P2/M9 — lista de partidos abertos (crear = mesmo selector ca reservar).
 */
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { formatDayChip } from "@pista-aberta/shared";
import { Button } from "../components/ui";

type OpenMatch = {
  id: string;
  title: string;
  sport: string;
  date: string;
  start: string;
  end: string;
  spotsTotal: number;
  spotsTaken: number;
  facilityName?: string;
  status: string;
  level?: string | null;
};

function statusLabel(
  status: string,
  t: (k: string, o?: Record<string, string>) => string,
): string {
  if (status === "open") return t("openMatch.statusOpen");
  if (status === "full") return t("openMatch.statusFull");
  if (status === "cancelled") return t("openMatch.statusCancelled");
  return status;
}

function levelLabel(
  level: string | null | undefined,
  t: (k: string) => string,
): string {
  if (!level) return "";
  const key = `openMatch.level.${level}`;
  const translated = t(key);
  return translated === key ? level : translated;
}

export function OpenMatchesPage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const { t, i18n } = useTranslation();
  const [list, setList] = useState<OpenMatch[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void fetch(`/api/c/${slug}/partidos-abertos`, { credentials: "include" })
      .then((r) => r.json())
      .then((j: { data: OpenMatch[] }) => setList(j.data ?? []))
      .catch(() => setErr(t("openMatch.loadError")));
  }, [slug, t]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl font-extrabold text-marino">
            {t("openMatch.title")}
          </h1>
          <p className="mt-1 text-sm text-graphite">{t("openMatch.hint")}</p>
        </div>
        <Link to={`/c/${slug}/reservar?partido=1`}>
          <Button type="button">{t("openMatch.create")}</Button>
        </Link>
      </header>

      {err ? <p className="mb-4 text-sm font-bold text-alert">{err}</p> : null}

      {list.length === 0 ? (
        <p className="text-sm text-graphite">{t("openMatch.empty")}</p>
      ) : (
        <ul className="m-0 list-none space-y-3 p-0">
          {list.map((m) => (
            <li key={m.id}>
              <Link
                to={`/c/${slug}/partidos-abertos/${m.id}`}
                className="block rounded-2xl border border-line bg-surface p-4 no-underline transition hover:border-azul"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <strong className="text-marino">{m.title}</strong>
                  <span className="rounded-full bg-bruma px-2 py-0.5 text-xs font-bold text-marino">
                    {statusLabel(m.status, t)}
                  </span>
                </div>
                <p className="mt-1 m-0 text-sm text-graphite">
                  {formatDayChip(m.date, i18n.language)} · {m.start}–{m.end}
                  {m.facilityName ? ` · ${m.facilityName}` : ""}
                  {m.level ? ` · ${levelLabel(m.level, t)}` : ""}
                  {` · ${m.spotsTaken} ${t("openMatch.of")} ${m.spotsTotal}`}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
