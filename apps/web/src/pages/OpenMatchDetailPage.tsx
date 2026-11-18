/**
 * REVISION-40 — ficha partido aberto (M9: datas, estado, cancelar con confirmación).
 * REVISION-42 Q5/Q6/Q8 — sen sesión, displayName OTP, leave_too_late, cancel peril.
 */
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  formatDayChip,
  isEmailLocalPartName,
  shortPublicName,
} from "@pista-aberta/shared";
import { useSession } from "../context/SessionContext";
import { Button } from "../components/ui";
import { QrPlaceholder } from "../components/QrPlaceholder";

type Detail = {
  id: string;
  title: string;
  sport: string;
  date: string;
  start: string;
  end: string;
  spotsTotal: number;
  spotsTaken: number;
  facilityName?: string;
  organizerName?: string;
  status: string;
  level?: string | null;
  notes?: string | null;
  players: Array<{ displayName: string; role: string }>;
  iAmOrganizer?: boolean;
  iAmJoined?: boolean;
};

export function OpenMatchDetailPage() {
  const { slug: slugParam, id = "" } = useParams();
  const slug = slugParam!;
  const { t, i18n } = useTranslation();
  const { user, refreshUser } = useSession();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const [m, setM] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [qrPath, setQrPath] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [nameConsent, setNameConsent] = useState(false);
  const [displayNameInput, setDisplayNameInput] = useState("");
  const verified = search.get("t");
  const needsDisplayName =
    !!user && isEmailLocalPartName(user.displayName, user.email);
  const publicNamePreview = needsDisplayName
    ? displayNameInput.trim()
      ? shortPublicName(displayNameInput)
      : "…"
    : user?.displayName
      ? shortPublicName(user.displayName)
      : "Ana R.";

  const load = () => {
    const q = verified ? `?t=${encodeURIComponent(verified)}` : "";
    const path = verified
      ? `/api/c/${slug}/partidos-abertos/${id}/qr${q}`
      : `/api/c/${slug}/partidos-abertos/${id}`;
    void fetch(path, { credentials: "include" })
      .then(async (r) => {
        const j = (await r.json()) as { data?: Detail; error?: string };
        if (!r.ok) throw new Error(j.error ?? t("common.error"));
        setM(j.data ?? null);
      })
      .catch((e) => {
        const code = e instanceof Error ? e.message : "";
        const key = code ? `error.${code}` : "";
        const translated = key ? t(key) : "";
        setErr(
          translated && translated !== key ? translated : t("common.error"),
        );
      });
  };

  useEffect(() => {
    load();
  }, [slug, id, verified]);

  const accesoJoin = `/c/${slug}/acceso?returnTo=${encodeURIComponent(
    `/c/${slug}/partidos-abertos/${id}`,
  )}`;

  const authedPost = async (path: string, body?: unknown) => {
    if (!user) {
      navigate(accesoJoin);
      return null;
    }
    const res = await fetch(path, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : "{}",
    });
    const j = (await res.json()) as {
      data?: Detail;
      error?: string;
      ok?: boolean;
    };
    if (!res.ok) throw new Error(j.error ?? t("common.error"));
    return j;
  };

  const join = async () => {
    if (!user) {
      navigate(accesoJoin);
      return;
    }
    if (needsDisplayName && displayNameInput.trim().length < 2) {
      setErr(t("error.display_name_required"));
      return;
    }
    if (!nameConsent) {
      setErr(t("error.consent_required"));
      return;
    }
    try {
      await authedPost(`/api/c/${slug}/partidos-abertos/${id}/apuntarse`, {
        nameDisplayConsent: true,
        ...(needsDisplayName
          ? { displayName: displayNameInput.trim() }
          : {}),
      });
      if (needsDisplayName) await refreshUser();
      setMsg(t("openMatch.joined"));
      setNameConsent(false);
      load();
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      const key = code ? `error.${code}` : "";
      const translated = key ? t(key) : "";
      setErr(
        translated && translated !== key ? translated : t("common.error"),
      );
    }
  };

  const leave = async () => {
    try {
      await authedPost(`/api/c/${slug}/partidos-abertos/${id}/sair`);
      setMsg(t("openMatch.left"));
      load();
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      if (code === "leave_too_late") {
        setErr(t("error.leave_too_late"));
      } else {
        const key = code ? `error.${code}` : "";
        const translated = key ? t(key) : "";
        setErr(
          translated && translated !== key ? translated : t("common.error"),
        );
      }
    }
  };

  const cancel = async () => {
    try {
      await authedPost(`/api/c/${slug}/partidos-abertos/${id}/cancelar`);
      setConfirmCancel(false);
      setMsg(t("openMatch.cancelled"));
      load();
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      const key = code ? `error.${code}` : "";
      const translated = key ? t(key) : "";
      setErr(translated && translated !== key ? translated : t("common.error"));
    }
  };

  const invite = async () => {
    try {
      await authedPost(`/api/c/${slug}/partidos-abertos/${id}/convidar`, {
        toEmail: inviteEmail || undefined,
      });
      setMsg(t("openMatch.invited"));
      setInviteEmail("");
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      const key = code ? `error.${code}` : "";
      const translated = key ? t(key) : "";
      setErr(translated && translated !== key ? translated : t("common.error"));
    }
  };

  const loadQr = async () => {
    if (!user) {
      navigate(accesoJoin);
      return;
    }
    const res = await fetch(`/api/c/${slug}/partidos-abertos/${id}/qr`, {
      credentials: "include",
    });
    const j = (await res.json()) as {
      data?: { urlPath: string };
      error?: string;
    };
    if (!res.ok) {
      const code = j.error ?? "";
      const key = code ? `error.${code}` : "";
      const translated = key ? t(key) : "";
      setErr(translated && translated !== key ? translated : t("common.error"));
      return;
    }
    setQrPath(j.data?.urlPath ?? null);
  };

  if (err && !m) {
    return (
      <main className="mx-auto max-w-lg px-4 py-8">
        <p className="text-alert">{err}</p>
        <Link to={`/c/${slug}/partidos-abertos`}>{t("openMatch.back")}</Link>
      </main>
    );
  }

  if (!m) {
    return (
      <main className="mx-auto max-w-lg px-4 py-8">
        <p>{t("common.loading")}</p>
      </main>
    );
  }

  const statusKey =
    m.status === "open"
      ? "openMatch.statusOpen"
      : m.status === "full"
        ? "openMatch.statusFull"
        : m.status === "cancelled"
          ? "openMatch.statusCancelled"
          : m.status;
  const levelKey = m.level ? `openMatch.level.${m.level}` : "";
  const levelText =
    m.level && t(levelKey) !== levelKey ? t(levelKey) : m.level ?? "";
  const canJoin = !m.iAmJoined && m.status === "open";
  const joinDisabled =
    needsDisplayName && displayNameInput.trim().length < 2
      ? true
      : !nameConsent;

  return (
    <main className="mx-auto max-w-lg px-4 py-6">
      <Link
        to={`/c/${slug}/partidos-abertos`}
        className="text-sm font-bold text-azul-700 no-underline"
      >
        ← {t("openMatch.back")}
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <h1 className="m-0 text-2xl font-extrabold text-marino">{m.title}</h1>
        <span className="rounded-full bg-bruma px-2.5 py-0.5 text-xs font-bold text-marino">
          {t(statusKey)}
        </span>
      </div>
      <p className="text-sm text-graphite">
        {formatDayChip(m.date, i18n.language)} · {m.start}–{m.end}
        {m.facilityName ? ` · ${m.facilityName}` : ""}
        {levelText ? ` · ${levelText}` : ""}
      </p>
      {m.organizerName ? (
        <p className="text-sm">
          {t("openMatch.organizer")}: {m.organizerName}
        </p>
      ) : null}
      {m.notes ? <p className="text-sm text-graphite">{m.notes}</p> : null}

      <h2 className="mt-6 text-base font-extrabold">{t("openMatch.players")}</h2>
      {/* REVISION-43 R9: «X de Y prazas ocupadas» só aquí (non na cabeceira). */}
      {m.players.length > 0 ? (
        <>
          <p className="mt-1 text-sm text-graphite" data-testid="open-match-spots">
            {t("openMatch.spotsOccupied", {
              taken: m.spotsTaken,
              total: m.spotsTotal,
              defaultValue: `${m.spotsTaken} de ${m.spotsTotal} prazas ocupadas`,
            })}
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {m.players.map((p, i) => (
              <li key={`${p.displayName}-${i}`}>
                {p.displayName}
                {p.role === "organizer" ? ` (${t("openMatch.roleOrg")})` : ""}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-2 text-sm text-graphite" data-testid="open-match-anon-spots">
          {t("openMatch.spotsOccupiedAnon", {
            taken: m.spotsTaken,
            total: m.spotsTotal,
          })}
        </p>
      )}

      {canJoin && !user ? (
        <div className="mt-6">
          <Button
            type="button"
            className="w-full"
            onClick={() => navigate(accesoJoin)}
            data-testid="open-match-identify"
          >
            {t("openMatch.identifyToJoin")}
          </Button>
        </div>
      ) : null}

      {canJoin && user ? (
        <div className="mt-6 flex flex-col gap-2 rounded-xl border border-line bg-paper/60 p-3">
          {needsDisplayName ? (
            <label className="flex flex-col gap-1 text-sm font-bold">
              {t("openMatch.displayNameLabel")}
              <input
                className="pa-input"
                required
                minLength={2}
                maxLength={80}
                autoComplete="name"
                placeholder={t("openMatch.displayNamePh")}
                value={displayNameInput}
                onChange={(e) => setDisplayNameInput(e.target.value)}
                data-testid="open-match-display-name"
              />
            </label>
          ) : null}
          <label className="flex min-h-11 items-start gap-2.5 text-[15px]">
            <input
              type="checkbox"
              className="mt-1 h-[22px] w-[22px] shrink-0 accent-azul"
              checked={nameConsent}
              onChange={(e) => setNameConsent(e.target.checked)}
              disabled={needsDisplayName && displayNameInput.trim().length < 2}
            />
            <span>{t("openMatch.nameConsent", { name: publicNamePreview })}</span>
          </label>
          <p className="m-0 pl-[34px] text-[13px] leading-snug text-graphite">
            {t("openMatch.nameConsentHint")}{" "}
            <Link
              to={`/c/${slug}/legal/privacidade`}
              className="font-bold text-azul-700 underline"
            >
              {t("legal.privacy")}
            </Link>
          </p>
          <Button
            type="button"
            disabled={joinDisabled}
            onClick={() => void join()}
          >
            {t("openMatch.join")}
          </Button>
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-2">
        {m.iAmJoined && !m.iAmOrganizer && m.status !== "cancelled" ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => void leave()}
          >
            {t("openMatch.leave")}
          </Button>
        ) : null}
        {m.iAmOrganizer && m.status !== "cancelled" ? (
          <Button
            type="button"
            variant="danger"
            onClick={() => setConfirmCancel(true)}
          >
            {t("openMatch.cancel")}
          </Button>
        ) : null}
        {(m.iAmOrganizer || m.iAmJoined) && m.status !== "cancelled" ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => void loadQr()}
          >
            {t("openMatch.showQr")}
          </Button>
        ) : null}
      </div>

      {m.iAmOrganizer && m.status === "open" ? (
        <div className="mt-6 rounded-xl border border-line p-4">
          <h2 className="m-0 text-base font-extrabold">{t("openMatch.invite")}</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              type="email"
              className="pa-input flex-1"
              placeholder="correo@proba.gal"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
            <Button
              type="button"
              disabled={!inviteEmail.trim()}
              onClick={() => void invite()}
            >
              {t("openMatch.sendInvite")}
            </Button>
          </div>
        </div>
      ) : null}

      {qrPath ? (
        <div className="mt-6 text-center">
          <QrPlaceholder
            shortCode={m.id.slice(-6).toUpperCase()}
            payload={`${window.location.origin}${qrPath}`}
            size={180}
          />
        </div>
      ) : null}

      {confirmCancel ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(0,43,74,0.4)] p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-card bg-surface p-6">
            <p className="m-0 text-lg font-extrabold text-marino">
              {t("openMatch.cancelConfirm")}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="danger"
                onClick={() => void cancel()}
              >
                {t("openMatch.cancel")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConfirmCancel(false)}
              >
                {t("common.close")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {msg ? <p className="mt-4 text-sm font-bold text-libre">{msg}</p> : null}
      {err ? <p className="mt-2 text-sm font-bold text-alert">{err}</p> : null}
    </main>
  );
}
