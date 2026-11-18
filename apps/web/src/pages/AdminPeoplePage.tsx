import { FormEvent, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiX } from "../lib/api-complete";
import { AdminShell } from "./AdminPages";
import { EmptyState } from "../components/EmptyState";
import { formatDate } from "../lib/format-date";

export function AdminPeoplePage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const { t, i18n } = useTranslation();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<
    Awaited<ReturnType<typeof apiX.searchPeople>>["data"]
  >([]);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const reqSeq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setRows([]);
      setSearched(false);
      setBusy(false);
      return;
    }
    const seq = ++reqSeq.current;
    setBusy(true);
    const handle = window.setTimeout(() => {
      void apiX
        .searchPeople(slug, term)
        .then((r) => {
          if (seq !== reqSeq.current) return;
          setRows(r.data);
          setSearched(true);
        })
        .catch(() => {
          if (seq !== reqSeq.current) return;
          setRows([]);
          setSearched(true);
        })
        .finally(() => {
          if (seq === reqSeq.current) setBusy(false);
        });
    }, 300);
    return () => {
      window.clearTimeout(handle);
    };
  }, [q, slug]);

  const search = (e: FormEvent) => {
    e.preventDefault();
    // O typeahead xa busca; o submit só força se hai ≥2 chars.
    if (q.trim().length < 2) return;
  };

  return (
    <AdminShell active="persoas" pageTitle={t("admin.people")}>
      <p className="text-sm text-graphite">{t("admin.peopleHint")}</p>
      <form onSubmit={search} className="mt-4 flex flex-wrap gap-2">
        <input
          className="pa-input min-w-[16rem] flex-1"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("admin.peoplePlaceholder")}
          minLength={2}
          autoComplete="off"
          aria-busy={busy}
        />
        <button type="submit" className="pa-btn-primary" disabled={busy || q.trim().length < 2}>
          {busy ? t("admin.searching") : t("admin.search")}
        </button>
      </form>

      {!searched ? null : rows.length === 0 ? (
        <div className="mt-6">
          <EmptyState title={t("admin.peopleEmpty")} body={t("admin.peopleEmptyHint")} />
        </div>
      ) : (
        <ul className="mt-6 space-y-4">
          {rows.map((p) => (
            <li key={p.id} className="pa-card p-4">
              <p className="font-bold text-lg">{p.displayName}</p>
              <p className="text-sm text-graphite">
                {p.email ?? "—"}
                {p.personIdentifier ? ` · ${p.personIdentifier}` : ""}
                {" · "}
                {t(`role.${p.role}`, { defaultValue: p.role })}
              </p>
              {p.bookingBlockedUntil &&
              new Date(p.bookingBlockedUntil).getTime() > Date.now() ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <p className="m-0 text-sm font-bold text-[var(--pa-warn-text,#8a5a00)]">
                    {t("admin.peopleBlockedUntil", {
                      date: formatDate(p.bookingBlockedUntil.slice(0, 10), i18n.language),
                    })}
                  </p>
                  <button
                    type="button"
                    className="pa-btn-secondary text-sm"
                    onClick={() => {
                      void apiX
                        .clearBookingBlock(slug, p.id)
                        .then(() => {
                          setRows((prev) =>
                            prev.map((row) =>
                              row.id === p.id
                                ? { ...row, bookingBlockedUntil: null }
                                : row,
                            ),
                          );
                        })
                        .catch(() => undefined);
                    }}
                  >
                    {t("admin.peopleClearBlock")}
                  </button>
                </div>
              ) : null}
              {p.bookings.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm">
                  {p.bookings.map((b) => (
                    <li key={b.id}>
                      {formatDate(b.date, i18n.language)} · {b.start}–{b.end} ·{" "}
                      {t(`status.${b.status}`, { defaultValue: b.status })}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </AdminShell>
  );
}
