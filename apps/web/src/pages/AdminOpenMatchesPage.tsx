/** TANDA-2 — panel admin de partidos abertos. REVISION-46 V8. */
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { formatDayChip } from "@pista-aberta/shared";
import { AdminShell } from "./AdminPages";

type Row = {
  id: string;
  title: string;
  date: string;
  start: string;
  end: string;
  spotsTaken: number;
  spotsTotal: number;
  status: string;
  facilityName?: string;
  organizerName?: string;
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

export function AdminOpenMatchesPage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const { t, i18n } = useTranslation();
  const [rows, setRows] = useState<Row[]>([]);

  const load = useCallback(() => {
    void fetch(`/api/c/${slug}/admin/partidos-abertos`, { credentials: "include" })
      .then((r) => r.json())
      .then((j: { data: Row[] }) => setRows(j.data ?? []))
      .catch(() => setRows([]));
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  const cancel = async (row: Row) => {
    const others = Math.max(0, row.spotsTaken - 1);
    const msg =
      others > 0
        ? t("openMatch.cancelConfirmN", {
            count: others,
            n: others,
            defaultValue:
              others === 1
                ? "Cancelar o partido? Avisaremos a 1 persoa apuntada"
                : `Cancelar o partido? Avisaremos ás ${others} persoas apuntadas`,
          })
        : t("openMatch.cancelConfirm", {
            defaultValue: "Cancelar o partido?",
          });
    if (!window.confirm(msg)) return;
    const res = await fetch(`/api/c/${slug}/partidos-abertos/${row.id}/cancelar`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (res.ok) load();
  };

  return (
    <AdminShell active="partidos-abertos" pageTitle={t("openMatch.adminTitle")}>
      <p className="text-sm text-graphite">{t("openMatch.hint")}</p>
      <p className="mt-2 text-sm">
        <Link to={`/c/${slug}/admin/actividades`} className="font-bold text-azul-700">
          ← {t("nav.actividades")}
        </Link>
      </p>
      <ul className="mt-4 space-y-2">
        {rows.map((r) => (
          <li
            key={r.id}
            className="pa-card flex flex-wrap items-center gap-2 px-4 py-3 text-sm"
          >
            <Link
              to={`/c/${slug}/partidos-abertos/${r.id}`}
              className="font-bold text-marino no-underline"
            >
              {r.title}
            </Link>
            <span className="text-graphite">
              {formatDayChip(r.date, i18n.language)} · {r.start}
              {` · ${r.spotsTaken} ${t("openMatch.of")} ${r.spotsTotal}`}
              {` · ${statusLabel(r.status, t)}`}
            </span>
            {r.organizerName ? (
              <span className="text-graphite">· {r.organizerName}</span>
            ) : null}
            {r.status !== "cancelled" ? (
              <button
                type="button"
                className="ml-auto text-sm font-bold text-alert underline"
                onClick={() => void cancel(r)}
              >
                {t("openMatch.cancel")}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-graphite">{t("openMatch.empty")}</p>
      ) : null}
    </AdminShell>
  );
}
