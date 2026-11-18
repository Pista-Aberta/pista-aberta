import { Link, useNavigate, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { formatDate } from "../lib/format-date";
import { Badge, Card, EmptyState, Skeleton } from "../components/ui";

type Act = Awaited<ReturnType<typeof api.activities>>["data"][number];

function inscriptionOpen(a: Act): boolean {
  return a.lotteryStatus === "open";
}

export function ActivitiesPage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [list, setList] = useState<Act[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .activities(slug)
      .then((r) => setList(r.data))
      .catch(() => setError(t("common.error")));
  }, [slug, t]);

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-8 pb-28 text-ink md:px-8 md:pb-12">
      <h1 className="pa-h1 m-0">{t("activities.title")}</h1>
      <p className="mt-2 text-graphite">{t("activities.hint")}</p>

      {error ? (
        <div className="pa-warn-banner mt-4" role="alert">
          <span aria-hidden>⚠</span>
          <span>{error}</span>
        </div>
      ) : null}

      {!list && !error ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2" aria-busy="true">
          <Skeleton height={144} radiusClass="rounded-card" />
          <Skeleton height={144} radiusClass="rounded-card" />
        </div>
      ) : null}

      {list && list.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title={t("activities.empty")}
            description={t("activities.emptyHint")}
            actionLabel={t("nav.reserve")}
            onAction={() => navigate(`/c/${slug}/reservar`)}
          />
        </div>
      ) : null}

      <ul className="mt-6 grid list-none gap-4 p-0 sm:grid-cols-2">
        {list?.map((a) => {
          const lottery = a.method === "lottery";
          const open = inscriptionOpen(a);
          return (
            <li key={a.id}>
              <Card className="flex flex-col gap-2.5 p-5">
                <Badge tone={lottery ? "aviso" : "libre"} className="self-start">
                  {lottery ? t("portada.methodLottery") : t("portada.methodFirstCome")}
                </Badge>
                <strong className="text-lg font-extrabold text-marino">{a.name}</strong>
                <span className="text-sm text-graphite">
                  {a.days} · {a.hours}
                </span>
                {a.description ? (
                  <p className="m-0 line-clamp-2 text-sm text-graphite">{a.description}</p>
                ) : null}
                <span className="mt-1 flex items-center justify-between gap-3 text-[13px] text-graphite">
                  <span>{t("portada.placesTotal", { count: a.places, n: a.places })}</span>
                  {open ? (
                    <Link
                      to={`/c/${slug}/actividades/${a.id}`}
                      className="font-extrabold text-azul-700 no-underline"
                    >
                      {t("portada.enroll")}
                    </Link>
                  ) : (
                    <span className="font-extrabold text-graphite">
                      {a.deadline
                        ? t("activities.inscriptionClosed", {
                            date: formatDate(a.deadline, i18n.language),
                          })
                        : t("activities.inscriptionClosedShort")}
                    </span>
                  )}
                </span>
              </Card>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
