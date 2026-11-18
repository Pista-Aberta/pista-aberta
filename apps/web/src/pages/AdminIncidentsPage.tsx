import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiX } from "../lib/api-complete";
import { AdminShell } from "./AdminPages";
import { EmptyState } from "../components/EmptyState";
import { formatDateTime } from "../lib/format-date";
import { useSession } from "../context/SessionContext";

type Incident = {
  id: string;
  facilityId: string | null;
  userDisplayName: string;
  body: string;
  status: string;
  createdAt: string;
};

export function AdminIncidentsPage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const { t, i18n } = useTranslation();
  const { municipality } = useSession();
  const tz = municipality?.settings?.timezone ?? "Europe/Madrid";
  const [rows, setRows] = useState<Incident[]>([]);
  const [open, setOpen] = useState(0);
  const [filter, setFilter] = useState<"open" | "in_progress" | "done" | "">("open");
  const [msg, setMsg] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Record<string, string | null>>({});

  const load = useCallback(() => {
    void apiX.listIncidents(slug, filter || undefined).then((r) => {
      setRows(r.data);
      setOpen(r.open);
    });
  }, [slug, filter]);

  useEffect(() => {
    load();
  }, [load]);

  const setStatus = async (id: string, status: "open" | "in_progress" | "done") => {
    await apiX.setIncidentStatus(slug, id, status);
    setMsg(
      status === "done"
        ? t("admin.incidentResolved")
        : t(`status.${status}`, { defaultValue: status }),
    );
    load();
  };

  const loadPhoto = async (id: string) => {
    const detail = await apiX.getIncident(slug, id);
    setPhotos((current) => ({ ...current, [id]: detail.data.photoDataUrl }));
  };

  return (
    <AdminShell active="incidencias" pageTitle={t("admin.incidents")}>
      <p className="text-sm text-graphite">
        {t("admin.incidentsHint")}{" "}
        {open > 0 && <strong>({t("admin.openIncidents", { count: open })})</strong>}
      </p>
      <div className="mt-3 flex flex-wrap gap-2" role="tablist">
        {(
          [
            ["open", t("admin.incidentStatusOpen")],
            ["in_progress", t("status.in_progress")],
            ["done", t("status.done")],
            ["", t("admin.filterAll")],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id || "all"}
            type="button"
            role="tab"
            aria-selected={filter === id}
            className={`rounded-btn border px-3 py-2 text-sm font-bold ${
              filter === id ? "border-ink bg-ink text-white" : "border-line bg-white"
            }`}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title={t("admin.incidentsEmpty")}
            body={t("admin.incidentsEmptyBody")}
          />
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {rows.map((r) => (
            <li key={r.id} className="pa-card p-4">
              <p className="font-bold">
                {r.userDisplayName} · {formatDateTime(r.createdAt, i18n.language, tz)}
                <span className="pa-chip-ink ml-2 text-xs">
                  {t(`status.${r.status}`, { defaultValue: r.status })}
                </span>
              </p>
              <p className="mt-2 text-sm">{r.body}</p>
              <div className="mt-3 flex flex-wrap items-start gap-3">
                {photos[r.id] && (
                  <img
                    src={photos[r.id]!}
                    alt=""
                    className="h-16 w-16 shrink-0 rounded-btn border border-line object-cover"
                  />
                )}
                <div className="flex flex-wrap gap-2">
                  {!(r.id in photos) && (
                    <button
                      type="button"
                      className="pa-btn-secondary min-h-12 text-sm"
                      onClick={() => void loadPhoto(r.id)}
                    >
                      {t("admin.incidentLoadPhoto")}
                    </button>
                  )}
                  {r.status === "open" && (
                    <button
                      type="button"
                      className="pa-btn-secondary min-h-12 text-sm"
                      onClick={() => void setStatus(r.id, "in_progress")}
                    >
                      {t("admin.incidentInProgress")}
                    </button>
                  )}
                  {(r.status === "open" || r.status === "in_progress") && (
                    <button
                      type="button"
                      className="pa-btn-primary min-h-12 text-sm"
                      onClick={() => void setStatus(r.id, "done")}
                    >
                      {t("admin.resolveIncident")}
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {msg && (
        <p className="pa-ok-banner mt-4" role="status">
          ✓ {msg}
        </p>
      )}
    </AdminShell>
  );
}
