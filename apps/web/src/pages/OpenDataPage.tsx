import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiX, geoJsonUrl, icsUrl } from "../lib/api-complete";

function openDataPath(slug: string, file: string) {
  return `/api/c/${slug}/datos-abertos/${file}`;
}

export function OpenDataPage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const { t } = useTranslation();
  const [data, setData] = useState<Awaited<ReturnType<typeof apiX.openData>>["data"] | null>(null);

  useEffect(() => {
    void apiX.openData(slug).then((r) => setData(r.data));
  }, [slug]);

  if (!data) return <main className="pa-page"><p>{t("common.loading")}</p></main>;

  return (
    <main className="pa-page max-w-3xl">
      <h1 className="pa-h1">{t("openData.title")}</h1>
      <p className="mt-2 text-graphite">
        {t("openData.license")}: <strong>{data.license}</strong> · {data.catalog}
        {data.dir3 ? ` · DIR3 ${data.dir3}` : ""}
      </p>
      <p className="mt-2 text-sm text-graphite">{t("openData.privacy")}</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <a href={geoJsonUrl(slug)} className="pa-btn-primary">
          GeoJSON
        </a>
        <a href={openDataPath(slug, "instalacions.csv")} className="pa-btn-secondary">
          CSV
        </a>
        <a href={openDataPath(slug, "instalacions.jsonld")} className="pa-btn-secondary">
          schema.org
        </a>
        <a href={openDataPath(slug, "ocupacion.csv")} className="pa-btn-secondary">
          {t("openData.occupancyCsv")}
        </a>
        <a href={openDataPath(slug, "ocupacion.json")} className="pa-btn-secondary">
          {t("openData.occupancyJson")}
        </a>
        <a href={openDataPath(slug, "dcat.jsonld")} className="pa-btn-secondary">
          DCAT-AP-ES
        </a>
        <a href={icsUrl(slug)} className="pa-btn-secondary">
          iCalendar
        </a>
        <a href="/api/docs" className="pa-btn-secondary">
          Docs API
        </a>
      </div>
      <h2 className="pa-h2 mt-10">{t("openData.catalog")}</h2>
      <ul className="mt-3 space-y-2 text-sm">
        {(data.facilities as Array<{ id: string; name: string; type: string }>).map((f) => (
          <li key={f.id} className="pa-card px-4 py-3">
            {f.name} · {t(`facilities.type.${f.type}`, { defaultValue: f.type })}
          </li>
        ))}
      </ul>
    </main>
  );
}
