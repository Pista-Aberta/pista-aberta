import { FormEvent, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { apiX } from "../lib/api-complete";
import { useSession } from "../context/SessionContext";
import { BackLink } from "../components/BackLink";
import { EmptyState } from "../components/EmptyState";
import { FilePickButton } from "../components/FilePickButton";

export function IncidentPage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const [search] = useSearchParams();
  const prefFacility = search.get("facility") ?? "";
  const { t } = useTranslation();
  const { user } = useSession();
  const [facilities, setFacilities] = useState<Array<{ id: string; name: string }>>([]);
  const [facilityId, setFacilityId] = useState(prefFacility);
  const [body, setBody] = useState("");
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void api.facilities(slug).then((r) => {
      setFacilities(r.data.map((f) => ({ id: f.id, name: f.name })));
      const preferred = prefFacility && r.data.some((f) => f.id === prefFacility)
        ? prefFacility
        : r.data[0]?.id ?? "";
      setFacilityId(preferred);
    });
  }, [slug, prefFacility]);

  const onPhoto = (file: File | null) => {
    setErr(null);
    if (!file) {
      setPhotoDataUrl(null);
      return;
    }
    if (file.size > 500_000) {
      setErr(t("common.error"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setPhotoDataUrl(typeof reader.result === "string" ? reader.result : null);
    };
    reader.readAsDataURL(file);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) {
      setErr(t("common.error"));
      return;
    }
    if (body.trim().length < 5) {
      setErr(t("incident.body"));
      return;
    }
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      await apiX.createIncident(slug, {
        facilityId: facilityId || undefined,
        body: body.trim(),
        photoDataUrl,
      });
      setBody("");
      setPhotoDataUrl(null);
      setMsg(t("incident.sent"));
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return (
      <main className="pa-page max-w-lg">
        <h1 className="pa-h1">{t("incident.title")}</h1>
        <EmptyState
          title={t("incident.needLoginTitle")}
          body={t("incident.needLoginBody")}
          actionLabel={t("nav.identify")}
          actionTo={`/c/${slug}/acceso?returnTo=${encodeURIComponent(`/c/${slug}/incidencia`)}`}
        />
      </main>
    );
  }

  return (
    <main className="pa-page max-w-lg">
      <BackLink to={`/c/${slug}`}>{t("nav.home")}</BackLink>
      <h1 className="pa-h1 mt-2">{t("incident.title")}</h1>
      <p className="mt-2 text-sm text-graphite">{t("incident.hint")}</p>

      <form onSubmit={(e) => void submit(e)} className="mt-6 flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm font-bold">
          {t("incident.facility")}
          <select
            className="pa-input min-h-12"
            value={facilityId}
            onChange={(e) => setFacilityId(e.target.value)}
          >
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-bold">
          {t("incident.body")} *
          <textarea
            className="pa-input min-h-28"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            minLength={5}
          />
        </label>
        <div className="flex flex-col gap-1 text-sm font-bold">
          {t("incident.photo")}
          <FilePickButton
            accept="image/*"
            labelKey="file.choosePhoto"
            onFile={(f) => onPhoto(f)}
          />
        </div>
        {photoDataUrl && (
          <img src={photoDataUrl} alt="" className="max-h-40 rounded-card border border-line object-contain" />
        )}
        <button type="submit" className="pa-btn-primary min-h-12 self-start" disabled={saving}>
          {t("incident.send")}
        </button>
        {msg && (
          <p className="pa-ok-banner" role="status">
            ✓ {msg}
          </p>
        )}
        {err && (
          <p className="text-sm font-bold text-[var(--pa-warn-text,#8a5a00)]" role="alert">
            ⚠ {err}
          </p>
        )}
      </form>
    </main>
  );
}
