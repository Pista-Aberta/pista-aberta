import { Link, useParams } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { apiX } from "../lib/api-complete";
import { formatDate } from "../lib/format-date";
import { useSession } from "../context/SessionContext";
import { BackLink } from "../components/BackLink";
import { Badge, Button, Card } from "../components/ui";
import { mapApiError } from "../lib/api-error";

type Detail = Awaited<ReturnType<typeof api.activity>>["data"] & {
  mines?: Array<{
    applicationNumber: string;
    status: string;
    priorityGroup: string;
    forMemberId: string | null;
    forMemberName: string | null;
  }>;
};

const APPS_PREVIEW = 5;

export function ActivityDetailPage() {
  const { slug: slugParam, id = "" } = useParams();
  const slug = slugParam!;
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const [act, setAct] = useState<Detail | null>(null);
  const [secret, setSecret] = useState("");
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const [verifyOk, setVerifyOk] = useState<boolean | null>(null);
  const [drawMsg, setDrawMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appsOpen, setAppsOpen] = useState(false);
  const [family, setFamily] = useState<
    Array<{ id: string; displayName: string; birthYear?: number }>
  >([]);
  /** "" = eu; se non, id do familiar. */
  const [forWhom, setForWhom] = useState("");

  const load = useCallback(() => {
    void api
      .activity(slug, id)
      .then((r) => {
        setAct(r.data as Detail);
        if (r.data.lotterySecret) setSecret(r.data.lotterySecret);
      })
      .catch(() => setError(t("common.error")));
  }, [slug, id, t]);

  useEffect(load, [load]);

  useEffect(() => {
    if (!user) {
      setFamily([]);
      return;
    }
    void apiX
      .family()
      .then((r) => setFamily(r.data))
      .catch(() => setFamily([]));
  }, [user]);

  const enrolledIds = useMemo(() => {
    const set = new Set<string>();
    for (const m of act?.mines ?? []) {
      set.add(m.forMemberId ?? "");
    }
    if (!act?.mines?.length && act?.mine) set.add("");
    return set;
  }, [act]);

  const currentYear = useMemo(
    () => new Date().getFullYear(),
    [],
  );

  const enrollOptions = useMemo(() => {
    const opts: Array<{
      id: string;
      label: string;
      disabled?: boolean;
    }> = [];
    const kidsOnly = (act?.ageMax ?? 99) < 18;
    /* REVISION-52 C1b: se ageMax < 18 non ofrecer «Eu». */
    if (!kidsOnly && !enrolledIds.has("")) {
      opts.push({
        id: "",
        label: user?.displayName
          ? t("activities.forSelfNamed", {
              name: user.displayName,
              defaultValue: `Eu (${user.displayName})`,
            })
          : t("activities.forSelf", { defaultValue: "Eu" }),
      });
    }
    for (const f of family) {
      if (enrolledIds.has(f.id)) continue;
      const age =
        f.birthYear != null ? currentYear - f.birthYear : null;
      const outOfAge =
        age != null &&
        act != null &&
        (age < (act.ageMin ?? 0) || age > (act.ageMax ?? 99));
      opts.push({
        id: f.id,
        disabled: !!outOfAge,
        label: outOfAge
          ? t("activities.outOfAge", {
              name: f.displayName,
              age: age ?? "—",
              defaultValue: `${f.displayName} (${age} anos · fóra de idade)`,
            })
          : f.displayName,
      });
    }
    return opts;
  }, [act, enrolledIds, family, user, t, currentYear]);

  const selectableOptions = useMemo(
    () => enrollOptions.filter((o) => !o.disabled),
    [enrollOptions],
  );

  useEffect(() => {
    if (!selectableOptions.some((o) => o.id === forWhom)) {
      setForWhom(selectableOptions[0]?.id ?? "");
    }
  }, [selectableOptions, forWhom]);

  const enroll = async () => {
    setError(null);
    if (!user) {
      setError(t("common.needLogin"));
      return;
    }
    try {
      const API = import.meta.env.VITE_API_URL ?? "";
      const body = forWhom ? { forMemberId: forWhom } : {};
      const res = await fetch(`${API}/api/c/${slug}/actividades/${id}/inscribir`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json()) as {
        data?: { applicationNumber: string };
        error?: string;
      };
      if (!res.ok) throw new Error(j.error ?? "error");
      setDrawMsg(t("activities.enrolled", { n: j.data!.applicationNumber }));
      load();
    } catch (e) {
      setError(mapApiError(t, e));
    }
  };

  const verify = async () => {
    setVerifyMsg(null);
    setVerifyOk(null);
    try {
      const { data } = await api.verifyLottery(slug, id, secret);
      setVerifyOk(data.ok);
      setVerifyMsg(
        data.ok
          ? t("activities.verifyOk")
          : t("activities.verifyFail", { hash: String(data.hashMatches) }),
      );
    } catch (e) {
      setError(mapApiError(t, e));
    }
  };

  if (!act && !error) {
    return (
      <main className="pa-page">
        <p className="text-graphite">{t("common.loading")}</p>
      </main>
    );
  }

  if (!act) {
    return (
      <main className="pa-page">
        <div className="pa-warn-banner" role="alert">
          <span aria-hidden>⚠</span>
          <span>{error}</span>
        </div>
      </main>
    );
  }

  const accepted = act.applications.filter((a) => a.status === "accepted");
  const waitlist = act.applications.filter((a) => a.status === "waitlist");
  const pending = act.applications.filter((a) => a.status === "pending");
  const myApps = act.mines?.length
    ? act.mines
    : act.mine
      ? [
          {
            applicationNumber: act.mine.applicationNumber,
            status: act.mine.status,
            priorityGroup: act.mine.priorityGroup,
            forMemberId: null,
            forMemberName: null,
          },
        ]
      : [];

  const lottery = act.method === "lottery";
  const pendingShown = appsOpen ? pending : pending.slice(0, APPS_PREVIEW);
  const inscriptionOpen = act.lotteryStatus === "open";
  const canEnroll = inscriptionOpen && selectableOptions.length > 0;
  /* REVISION-53 D1: sen sesión → entrar; con sesión e sen quen poida ir → aviso familia. */
  const showLoginToEnroll = inscriptionOpen && !user;
  const showNeedFamily =
    inscriptionOpen && !!user && !canEnroll && myApps.length === 0;
  const accesoEnroll = `/c/${slug}/acceso?returnTo=${encodeURIComponent(
    `/c/${slug}/actividades/${id}`,
  )}`;

  return (
    <main className="mx-auto max-w-[960px] px-4 py-8 pb-28 text-ink md:px-8 md:pb-12">
      <BackLink to={`/c/${slug}/actividades`}>{t("activities.title")}</BackLink>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Badge tone={lottery ? "aviso" : "libre"} className="self-start">
          {lottery ? t("portada.methodLottery") : t("portada.methodFirstCome")}
        </Badge>
      </div>
      <h1 className="pa-h1 mt-2 m-0">{act.name}</h1>
      <p className="mt-2 max-w-2xl text-graphite">
        {t("portada.placesTotal", { count: act.places, n: act.places })}
      </p>
      {act.days || act.hours || act.deadline ? (
        <p className="mt-3 max-w-2xl text-sm font-bold text-marino">
          {t("activities.metaLine", {
            days: act.days ?? "—",
            hours: act.hours ?? "—",
            place: act.facilityName ?? "—",
            ages: t("activities.ages", {
              min: act.ageMin ?? "—",
              max: act.ageMax ?? "—",
            }),
            deadline: act.deadline
              ? formatDate(act.deadline, i18n.language)
              : "—",
          })}
        </p>
      ) : null}
      <p className="mt-2 max-w-2xl text-graphite">{act.description}</p>

      {myApps.length > 0 ? (
        <div role="status" className="mt-4">
          <ul className="m-0 list-none space-y-2 p-0">
            {myApps.map((m) => {
              const statusLabel = t(`status.${m.priorityGroup}`, {
                defaultValue: m.priorityGroup,
              });
              const who =
                m.forMemberName?.trim() ||
                user?.displayName ||
                t("activities.forSelf", { defaultValue: "Eu" });
              return (
                <li
                  key={`${m.applicationNumber}-${m.forMemberId ?? "self"}`}
                  className="pa-ok-banner text-sm"
                >
                  ✓{" "}
                  {t("activities.alreadyEnrolledFor", {
                    name: who,
                    n: m.applicationNumber,
                    status: statusLabel,
                  })}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {canEnroll ? (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          {user && (family.length > 0 || enrollOptions.length > 1) ? (
            <label className="flex min-w-[12rem] flex-col gap-1 text-sm font-bold">
              {t("activities.forWhom", { defaultValue: "Para quen?" })}
              <select
                className="pa-input"
                value={forWhom}
                onChange={(e) => setForWhom(e.target.value)}
              >
                {enrollOptions.map((o) => (
                  <option
                    key={o.id || "self"}
                    value={o.id}
                    disabled={o.disabled}
                  >
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <Button type="button" onClick={() => void enroll()}>
            {t("activities.enroll")}
          </Button>
        </div>
      ) : showLoginToEnroll ? (
        <p className="mt-4">
          <Link to={accesoEnroll} className="pa-btn-primary inline-flex">
            {t("activities.enroll")}
          </Link>
        </p>
      ) : showNeedFamily ? (
        <p className="mt-4 text-sm text-graphite" role="status">
          {t("activities.needFamilyAges", {
            min: act.ageMin ?? "—",
            max: act.ageMax ?? "—",
          })}{" "}
          <Link
            to={`/c/${slug}/conta#familia`}
            className="font-extrabold text-azul-700 underline"
          >
            {t("activities.needFamilyLink")}
          </Link>
        </p>
      ) : act.lotteryStatus !== "open" ? (
        <p className="mt-4 text-sm font-extrabold text-graphite" role="status">
          {act.deadline
            ? t("activities.inscriptionClosed", {
                date: formatDate(act.deadline, i18n.language),
              })
            : t("activities.inscriptionClosedShort")}
        </p>
      ) : null}

      {error && (
        <div className="pa-warn-banner mt-4" role="alert">
          <span aria-hidden>⚠</span>
          <span>{error}</span>
        </div>
      )}
      {drawMsg && (
        <div className="pa-ok-banner mt-4" role="status">
          <span aria-hidden>✓</span>
          <span>{drawMsg}</span>
        </div>
      )}

      {act.method === "lottery" && (
        <>
          {/* REVISION-54 E3: paso de inscrición só se se pode (ou sen sesión). */}
          {canEnroll || showLoginToEnroll ? (
            <ol className="mt-8 space-y-3">
              {(
                [
                  t("activities.citizenStep1"),
                  t("activities.citizenStep2"),
                  t("activities.citizenStep3"),
                ] as const
              ).map((label, i) => (
                <li key={label} className="flex gap-3 text-sm">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-white">
                    {i + 1}
                  </span>
                  <span className="pt-0.5">{label}</span>
                </li>
              ))}
            </ol>
          ) : (
            <ol className="mt-8 space-y-3">
              {(
                [t("activities.citizenStep2"), t("activities.citizenStep3")] as const
              ).map((label, i) => (
                <li key={label} className="flex gap-3 text-sm">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-white">
                    {i + 1}
                  </span>
                  <span className="pt-0.5">{label}</span>
                </li>
              ))}
            </ol>
          )}

          <details className="pa-card mt-6 p-4">
            <summary className="cursor-pointer font-bold">
              {t("activities.howVerify")}
            </summary>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              {[
                {
                  n: 1,
                  title: t("activities.step1"),
                  body: act.lotterySeedHash
                    ? `SHA-256: ${act.lotterySeedHash.slice(0, 12)}…${act.lotterySeedHash.slice(-8)}`
                    : "—",
                },
                {
                  n: 2,
                  title: t("activities.step2"),
                  body:
                    act.lotteryStatus === "drawn" && act.lotterySecret
                      ? act.lotterySecret
                      : t("activities.step2pending"),
                },
                {
                  n: 3,
                  title: t("activities.step3"),
                  body: t("activities.step3body"),
                },
              ].map((s) => (
                <div key={s.n}>
                  <h3 className="text-sm font-bold">{s.title}</h3>
                  <p className="mt-1 break-all rounded-btn bg-area px-3 py-2 font-mono text-xs text-graphite">
                    {s.body}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-sm text-graphite">{t("activities.verifyHint")}</p>
          </details>

          {act.lotteryStatus !== "drawn" && user?.role === "admin" && (
            <p className="mt-6">
              <Link
                to={`/c/${slug}/admin/actividades/${id}`}
                className="pa-btn-primary inline-flex"
              >
                {t("activities.runDrawAdmin")}
              </Link>
            </p>
          )}

          {act.lotteryStatus === "drawn" && (
            <div className="mt-8 flex flex-wrap items-start gap-6">
              <section className="min-w-0 flex-[999_1_480px]">
                <h2 className="pa-h2">{t("activities.result")}</h2>
                <p className="mt-1 text-sm text-graphite">{t("activities.privacy")}</p>
                <div className="pa-card mt-4 overflow-x-auto">
                  <table className="w-full min-w-[320px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-line text-graphite">
                        <th className="px-4 py-3 font-bold">{t("activities.colPos")}</th>
                        <th className="px-4 py-3 font-bold">{t("activities.colReq")}</th>
                        <th className="px-4 py-3 font-bold">{t("activities.colGroup")}</th>
                        <th className="px-4 py-3 font-bold">{t("activities.colStatus")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...accepted, ...waitlist].map((a, i) => (
                        <tr key={a.applicationNumber} className="border-b border-line last:border-0">
                          <td className="px-4 py-3 font-bold">{i + 1}</td>
                          <td className="px-4 py-3 font-mono">{a.applicationNumber}</td>
                          <td className="px-4 py-3">
                            {t(`status.${a.priorityGroup}`, {
                              defaultValue: a.priorityGroup,
                            })}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={
                                a.status === "accepted" ? "pa-chip-ok" : "pa-chip-warn"
                              }
                            >
                              {a.status === "accepted"
                                ? t("activities.place")
                                : t("activities.waitlist")}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <aside className="w-full rounded-card border-2 border-ink bg-white p-5 lg:flex-[1_1_300px]">
                <h2 className="text-xl font-bold">{t("activities.verify")}</h2>
                <p className="mt-2 text-sm text-graphite">{t("activities.verifyHint")}</p>
                <label className="mt-4 flex flex-col gap-1 text-sm font-bold">
                  {t("activities.secret")}
                  <input
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    className="pa-input min-h-12 font-mono text-xs"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void verify()}
                  className="pa-btn-primary mt-4 w-full"
                >
                  {t("activities.verifyBtn")}
                </button>
                {verifyMsg && (
                  <div
                    className={`mt-4 ${verifyOk ? "pa-ok-banner" : "pa-warn-banner"}`}
                    role="status"
                  >
                    <span aria-hidden>{verifyOk ? "✓" : "⚠"}</span>
                    <span>{verifyMsg}</span>
                  </div>
                )}
              </aside>
            </div>
          )}

          {act.lotteryStatus !== "drawn" && pending.length > 0 && (
            <Card lift={false} className="mt-8 p-5">
              <h2 className="m-0 text-lg font-extrabold text-marino">
                {t("activities.applications")}
              </h2>
              <p className="mt-1 text-sm text-graphite">{t("activities.privacy")}</p>
              <ul className="mt-3 space-y-1.5 text-sm">
                {pendingShown.map((a) => (
                  <li key={a.applicationNumber}>
                    <span className="font-mono font-bold">{a.applicationNumber}</span>
                    <span className="text-graphite">
                      {" "}
                      ·{" "}
                      {t(`status.${a.priorityGroup}`, {
                        defaultValue: a.priorityGroup,
                      })}
                    </span>
                  </li>
                ))}
              </ul>
              {pending.length > APPS_PREVIEW ? (
                <button
                  type="button"
                  className="pa-ui-interactive mt-3 border-0 bg-transparent p-0 font-extrabold text-azul-700"
                  onClick={() => setAppsOpen((v) => !v)}
                  aria-expanded={appsOpen}
                >
                  {appsOpen
                    ? t("activities.hideApps")
                    : t("activities.showAllApps", { n: pending.length })}
                </button>
              ) : null}
            </Card>
          )}
        </>
      )}
    </main>
  );
}
