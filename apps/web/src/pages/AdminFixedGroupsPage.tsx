import { FormEvent, useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiX } from "../lib/api-complete";
import { AdminShell } from "./AdminPages";
import { EmptyState } from "../components/EmptyState";
import { TimeField } from "../components/TimeField";
import { formatFixedGroupImpactBody } from "../lib/impact-copy";

type Group = {
  id: string;
  name: string;
  facilityId: string;
  unitId: string;
  weekday: number;
  start: string;
  end: string;
  validFrom: string;
  validTo: string;
  active: boolean;
};

type GroupImpact = {
  cancelledCount: number;
  peopleCount: number;
  matchCount: number;
};

function localYmd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function AdminFixedGroupsPage({
  lockFacilityId,
}: {
  lockFacilityId?: string;
} = {}) {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const { t } = useTranslation();
  const [rows, setRows] = useState<Group[]>([]);
  const [facilities, setFacilities] = useState<
    Array<{ id: string; name: string; units: Array<{ id: string; name: string }> }>
  >([]);
  const [name, setName] = useState("");
  const [facilityId, setFacilityId] = useState(lockFacilityId ?? "");
  const [unitId, setUnitId] = useState("");
  const [weekday, setWeekday] = useState(1);
  const [start, setStart] = useState("17:00");
  const [end, setEnd] = useState("18:00");
  const [validFrom, setValidFrom] = useState(localYmd());
  const [validTo, setValidTo] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 3);
    return localYmd(d);
  });
  const [openForm, setOpenForm] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /* REVISION-58 K2 */
  const [impact, setImpact] = useState<GroupImpact | null>(null);

  const load = useCallback(() => {
    void apiX.listFixedGroups(slug).then((r) => {
      const all = r.data;
      setRows(
        lockFacilityId ? all.filter((g) => g.facilityId === lockFacilityId) : all,
      );
    });
    void apiX.adminFacilities(slug).then((r) => {
      const active = r.data.filter((f) => f.active);
      const list = lockFacilityId
        ? active.filter((f) => f.id === lockFacilityId)
        : active;
      setFacilities(list.map((f) => ({ id: f.id, name: f.name, units: f.units })));
      const pick = list[0] ?? active[0];
      if (pick && (lockFacilityId || !facilityId)) {
        setFacilityId(pick.id);
        setUnitId(pick.units[0]?.id ?? "");
      }
    });
  }, [slug, facilityId, lockFacilityId]);

  useEffect(() => {
    load();
  }, [load]);

  const units = facilities.find((f) => f.id === facilityId)?.units ?? [];

  const submitCreate = async (opts: { confirm?: boolean } = {}) => {
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await apiX.createFixedGroup(slug, {
        name,
        facilityId,
        unitId,
        weekday,
        start,
        end,
        validFrom,
        validTo,
        confirm: opts.confirm,
      });
      if (r.data.needsConfirm) {
        setImpact({
          cancelledCount: r.data.cancelledCount ?? 0,
          peopleCount: r.data.peopleCount ?? 0,
          matchCount: r.data.matchCount ?? 0,
        });
        return;
      }
      setImpact(null);
      setName("");
      setMsg(t("admin.groupSaved"));
      setOpenForm(false);
      load();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    await submitCreate();
  };

  const active = rows.filter((r) => r.active);

  return (
    <AdminShell active="grupos-fixos" pageTitle={t("admin.fixedGroups")}>
      <h2 className="m-0 mb-2 text-lg font-extrabold text-marino">{t("admin.fixedGroups")}</h2>
      <p className="text-sm text-graphite">{t("admin.fixedGroupsHint")}</p>

      <div className="mt-4">
        <button
          type="button"
          className="pa-btn-primary min-h-12"
          onClick={() => setOpenForm((v) => !v)}
        >
          {t("admin.addFixedGroup")}
        </button>
      </div>

      {openForm && (
        <form onSubmit={(e) => void create(e)} className="pa-card mt-4 flex max-w-xl flex-col gap-3 p-5">
          <label className="flex flex-col gap-1 text-sm font-bold">
            {t("admin.fixedGroupName")} *
            <input className="pa-input min-h-12" required value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-bold">
            {t("admin.facilities")}
            <select
              className="pa-input min-h-12"
              value={facilityId}
              onChange={(e) => {
                setFacilityId(e.target.value);
                const fac = facilities.find((f) => f.id === e.target.value);
                setUnitId(fac?.units[0]?.id ?? "");
              }}
            >
              {facilities.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-bold">
            {t("admin.unit")}
            <select className="pa-input min-h-12" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-bold">
            {t("clubs.weekday")}
            <select
              className="pa-input min-h-12"
              value={weekday}
              onChange={(e) => setWeekday(Number(e.target.value))}
            >
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <option key={d} value={d}>
                  {t(`dow.${d}`)}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-bold">
              {t("admin.activityHours")} (ini)
              <TimeField value={start} onChange={setStart} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-bold">
              {t("admin.activityHours")} (fin)
              <TimeField value={end} onChange={setEnd} />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-bold">
              {t("admin.validFrom")}
              <input type="date" className="pa-input min-h-12" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-bold">
              {t("admin.validTo")}
              <input type="date" className="pa-input min-h-12" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
            </label>
          </div>
          <button type="submit" className="pa-btn-primary min-h-12 self-start" disabled={saving}>
            {t("admin.save")}
          </button>
          {err && (
            <p className="text-sm font-bold text-[var(--pa-warn-text,#8a5a00)]" role="alert">
              ⚠ {err}
            </p>
          )}
        </form>
      )}

      {active.length === 0 ? (
        <div className="mt-6">
          <EmptyState title={t("admin.fixedGroupsEmpty")} body="" />
        </div>
      ) : (
        <ul className="mt-6 space-y-2">
          {active.map((g) => (
            <li key={g.id} className="pa-card flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <span>
                <strong>{g.name}</strong> · {t(`dow.${g.weekday}`)} · {g.start}–{g.end} ·{" "}
                {g.validFrom} → {g.validTo}
              </span>
              <button
                type="button"
                className="pa-btn-secondary text-sm"
                onClick={() => {
                  if (!window.confirm(t("admin.deactivateGroupConfirm"))) return;
                  void apiX
                    .deactivateFixedGroup(slug, g.id)
                    .then(() => {
                      setMsg(t("admin.deactivateGroupDone"));
                      load();
                    })
                    .catch(() => setErr(t("common.error")));
                }}
              >
                {t("admin.deactivateGroup")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {msg && (
        <p className="pa-ok-banner mt-4" role="status">
          ✓ {msg}
        </p>
      )}

      {impact && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(0,43,74,0.4)] p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="fixed-group-impact-title"
        >
          <div className="pa-card w-full max-w-lg space-y-4 p-6">
            <h2
              id="fixed-group-impact-title"
              className="m-0 text-xl font-extrabold text-marino"
            >
              {t("admin.fixedGroupImpactTitle")}
            </h2>
            <p className="m-0 text-graphite">
              {formatFixedGroupImpactBody(t, {
                bookings: impact.cancelledCount,
                people: impact.peopleCount,
              })}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                className="pa-btn-primary"
                disabled={saving}
                onClick={() => void submitCreate({ confirm: true })}
              >
                {t("admin.fixedGroupImpactConfirm")}
              </button>
              <button
                type="button"
                className="pa-btn-secondary"
                disabled={saving}
                onClick={() => setImpact(null)}
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
