import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { displayHost, fetchPublicConfig } from "../lib/public-config";
import { QrPlaceholder } from "../components/QrPlaceholder";

export function QrPosterPage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const { t } = useTranslation();
  const [facilities, setFacilities] = useState<Awaited<ReturnType<typeof api.facilities>>["data"]>([]);
  const [muni, setMuni] = useState("");
  const [host, setHost] = useState("demo.pistaaberta.com");

  useEffect(() => {
    void api.facilities(slug).then((r) => setFacilities(r.data));
    void api.info(slug).then((r) => setMuni(r.data.name));
    void fetchPublicConfig().then((cfg) => setHost(displayHost(cfg)));
  }, [slug]);

  return (
    <main className="pa-page">
      <div className="mb-6 flex justify-between print:hidden">
        <h1 className="pa-h1">{t("poster.title")}</h1>
        <button type="button" className="pa-btn-primary" onClick={() => window.print()}>
          {t("staff.print")} A4
        </button>
      </div>
      <div className="grid gap-8">
        {facilities.map((f) => {
          // Código curto legible (ex. EXEM-PADEL), sen cortar a media palabra.
          const typeTag =
            f.type === "pista"
              ? "PADEL"
              : f.type === "pavillon"
                ? "PAV"
                : f.type === "campo"
                  ? "CAMPO"
                  : f.type === "sala"
                    ? "SALA"
                    : "PISTA";
          const code = `${slug}-${typeTag}`
            .normalize("NFD")
            .replace(/\p{M}/gu, "")
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, "-")
            .replace(/^-|-$/g, "");
          return (
            <article
              key={f.id}
              className="pa-card flex flex-col items-center gap-5 p-10 text-center print:break-inside-avoid"
            >
              <p className="text-sm font-bold uppercase tracking-wide text-graphite">{muni}</p>
              <h2 className="text-3xl font-bold">{f.name}</h2>
              <p className="max-w-md text-2xl font-bold leading-snug text-ink sm:text-3xl">
                {t("poster.scanCheckIn")}
              </p>
              <QrPlaceholder shortCode={code || "PISTA"} payload={`facility|${f.id}|${slug}`} />
              <p className="text-sm text-graphite">{t("poster.scanSecondary")}</p>
              <p className="text-sm">
                {host}/c/{slug}
              </p>
            </article>
          );
        })}
      </div>
    </main>
  );
}
