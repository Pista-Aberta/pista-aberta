import {
  FormEvent,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BackLink } from "../components/BackLink";
import { ShieldMark } from "../components/ShieldMark";
import { ReadingPrefsAaControl } from "../components/ReadingPrefsAaControl";
import { api } from "../lib/api";
import { AccesoPickPage } from "./AccesoPickPage";
import { slugFromReturnTo, writeLastMuni } from "../lib/acceso";
import { formatDemoLoginNotice } from "../lib/demo-login-notice";
import { applyMunicipalityTheme, clearMunicipalityTheme } from "../lib/theme";

const API = import.meta.env.VITE_API_URL ?? "";
const OTP_LEN = 6;
const RESEND_SECS = 60;

type OtpStep = "closed" | "email" | "code";

function OtpDigitBoxes({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: OTP_LEN }, (_, i) => value[i] ?? "");

  const setAt = (index: number, char: string) => {
    const clean = char.replace(/\D/g, "").slice(-1);
    const next = digits.map((d, i) => (i === index ? clean : d));
    onChange(next.join(""));
    if (clean && index < OTP_LEN - 1) {
      refs.current[index + 1]?.focus();
    }
  };

  const onKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      e.preventDefault();
      const next = digits.map((d, i) => (i === index - 1 ? "" : d));
      onChange(next.join(""));
      refs.current[index - 1]?.focus();
    }
    if (e.key === "ArrowLeft" && index > 0) {
      refs.current[index - 1]?.focus();
    }
    if (e.key === "ArrowRight" && index < OTP_LEN - 1) {
      refs.current[index + 1]?.focus();
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, OTP_LEN);
    if (!pasted) return;
    onChange(pasted);
    const focusIdx = Math.min(pasted.length, OTP_LEN) - 1;
    refs.current[Math.max(0, focusIdx)]?.focus();
  };

  return (
    <div
      role="group"
      aria-label={t("login.otpDigits")}
      className="grid grid-cols-6 gap-2"
    >
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          aria-label={t("login.otpDigitN", { n: i + 1 })}
          value={d}
          disabled={disabled}
          onChange={(e) => setAt(i, e.target.value)}
          onKeyDown={(e) => onKeyDown(i, e)}
          onPaste={onPaste}
          onFocus={(e) => e.target.select()}
          className={`box-border h-[52px] w-full rounded-xl border-[1.5px] text-center text-[24px] font-extrabold text-marino outline-none md:h-[60px] md:text-[26px] ${
            d ? "border-azul" : "border-border2"
          } focus:border-azul focus-visible:ring-2 focus-visible:ring-azul focus-visible:ring-offset-2`}
        />
      ))}
    </div>
  );
}

type PerfilTab = "vecina" | "entidade";

export function LoginPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { slug: routeSlug } = useParams();
  const [params] = useSearchParams();
  const slugFromQuery = slugFromReturnTo(params.get("returnTo"));
  const slug = routeSlug ?? slugFromQuery ?? null;
  const perfilParam = params.get("perfil");
  const returnToParam = params.get("returnTo") ?? "";
  const initialPerfil: PerfilTab =
    perfilParam === "entidade" || perfilParam === "persoal"
      ? "entidade"
      : returnToParam.includes("/convite/")
        ? "entidade"
        : "vecina";

  const [perfil, setPerfil] = useState<PerfilTab>(initialPerfil);
  const [muniName, setMuniName] = useState("");
  const [legalTitular, setLegalTitular] = useState("");
  const [muniLoading, setMuniLoading] = useState(true);
  const [muniMissing, setMuniMissing] = useState(false);
  const [brand, setBrand] = useState("#5A4636");
  const [logo, setLogo] = useState<string | undefined>();
  const [contactEmail, setContactEmail] = useState<string | undefined>();
  const [contactAddress, setContactAddress] = useState<string | undefined>();
  const [email, setEmail] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  /** REVISION-22 A9: só presente cando a API devolve demoCode (PA_DEMO=1). */
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [samlError, setSamlError] = useState<string | null>(null);
  const [certLogin, setCertLogin] = useState(false);
  const [samlLogin, setSamlLogin] = useState(false);
  const [isDemo, setIsDemo] = useState(() => {
    const v = import.meta.env.VITE_PA_DEMO;
    return v === "1" || v === "true";
  });
  const [certHint, setCertHint] = useState(false);
  const [certError, setCertError] = useState<string | null>(null);
  const [otpStep, setOtpStep] = useState<OtpStep>("closed");
  const [resendLeft, setResendLeft] = useState(0);
  const [logoutNotice, setLogoutNotice] = useState(
    () => params.get("aviso") === "saida",
  );

  const returnToDefault = slug
    ? perfil === "entidade"
      ? `/c/${slug}/admin`
      : `/c/${slug}`
    : "/";
  /** Preferencia explícita na URL; se non, segundo pestana de perfil. */
  const returnTo = params.get("returnTo") ?? returnToDefault;

  useEffect(() => {
    if (!slug) return;
    setMuniLoading(true);
    setMuniMissing(false);
    setMuniName("");
    setLegalTitular("");
    void api
      .info(slug)
      .then((r) => {
        setMuniName(r.data.name);
        setLegalTitular(r.data.settings.legal?.titular?.trim() ?? "");
        const theme = applyMunicipalityTheme(r.data);
        setBrand(theme.brand);
        setLogo(r.data.settings.logoUrl ?? r.data.settings.logoDataUrl ?? undefined);
        setContactEmail(r.data.settings.legal?.email);
        setContactAddress(r.data.settings.legal?.address);
        writeLastMuni(slug, r.data.name);
        setMuniLoading(false);
      })
      .catch(() => {
        setMuniMissing(true);
        clearMunicipalityTheme();
        setMuniLoading(false);
      });
  }, [slug]);

  useEffect(() => {
    void fetch(`${API}/api/config`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg: { certLogin?: boolean; samlLogin?: boolean; demo?: boolean } | null) => {
        setCertLogin(Boolean(cfg?.certLogin));
        setSamlLogin(Boolean(cfg?.samlLogin));
        setIsDemo(Boolean(cfg?.demo));
      })
      .catch(() => {
        setCertLogin(false);
        setSamlLogin(false);
        setIsDemo(false);
      });
  }, []);

  useEffect(() => {
    const erro = params.get("erro");
    /* REVISION-56 H11 */
    if (erro === "concello") {
      setError(t("login.erroConcello"));
      setCertError(null);
      return;
    }
    if (erro === "concello_non_creado") {
      setError(formatDemoLoginNotice(t, "concello_non_creado"));
      setCertError(null);
      return;
    }
    const motivo = params.get("motivo") ?? "";
    if (erro !== "cert") return;
    let msg = t("login.cert.err.failed");
    if (motivo === "NONE") msg = t("login.cert.err.none");
    else if (motivo.includes("revoked")) msg = t("login.cert.err.revoked");
    else if (motivo.includes("expired")) msg = t("login.cert.err.expired");
    else if (motivo === "ticket") msg = t("login.cert.err.ticket");
    else if (motivo === "cert_sen_nif") msg = t("login.cert.err.nif");
    else if (
      motivo === "cert_ocsp_erro" ||
      motivo === "cert_sen_ocsp" ||
      motivo === "cert_revogado"
    ) {
      if (motivo === "cert_revogado") msg = t("login.cert.err.revoked");
      else msg = t("login.cert.err.ocsp");
    }
    else if (motivo.startsWith("FAILED")) msg = t("login.cert.err.failed");
    setCertError(msg);
    setError(null);
  }, [params, t]);

  useEffect(() => {
    if (resendLeft <= 0) return;
    const id = window.setTimeout(() => setResendLeft((n) => n - 1), 1000);
    return () => window.clearTimeout(id);
  }, [resendLeft]);

  const startSaml = async () => {
    setError(null);
    setSamlError(null);
    // REVISION-16 N1: sen identifier — o límite vai por IP, non por "cidada" global.
    const res = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        method: "saml",
        returnTo,
        ...(slug ? { municipalityId: `muni-${slug}` } : {}),
      }),
    });
    const data = (await res.json()) as {
      redirectUrl?: string;
      error?: string;
      retryAfterMinutes?: number;
    };
    if (data.redirectUrl) {
      window.location.href = data.redirectUrl;
      return;
    }
    if (res.status === 429 || data.error === "rate_limited") {
      const mins = data.retryAfterMinutes ?? 10;
      setSamlError(t("login.errorRateLimit", { minutes: mins }));
      return;
    }
    setSamlError(t("login.errorSamlGeneric"));
  };

  const startCert = async () => {
    setError(null);
    setCertError(null);
    if (!certLogin) {
      nav(`/acceso/certificado?returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }
    setCertHint(true);
    await new Promise((r) => window.setTimeout(r, 1000));
    try {
      const res = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          method: "certificate",
          municipalityId: `muni-${slug}`,
          returnTo,
        }),
      });
      const data = (await res.json()) as { redirectUrl?: string; error?: string };
      if (data.redirectUrl) window.location.assign(data.redirectUrl);
      else {
        setCertHint(false);
        setCertError(t("login.cert.error"));
      }
    } catch {
      setCertHint(false);
      setCertError(t("login.cert.error"));
    }
  };

  const sendOtp = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setDemoCode(null);
    try {
      const res = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          method: "email_otp",
          identifier: email,
          municipalityId: `muni-${slug}`,
        }),
      });
      if (!res.ok) throw new Error("otp");
      const data = (await res.json()) as {
        challengeId?: string;
        message?: string;
        demoCode?: string;
      };
      setChallengeId(data.challengeId ?? null);
      setMsg(data.message ?? null);
      setDemoCode(
        typeof data.demoCode === "string" && /^\d{6}$/.test(data.demoCode)
          ? data.demoCode
          : null,
      );
      setCode("");
      setOtpStep("code");
      setResendLeft(RESEND_SECS);
    } catch {
      setError(t("login.errorOtp"));
    }
  };

  const verifyOtp = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!challengeId) return;
    try {
      const res = await fetch(`${API}/auth/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ challengeId, code, returnTo }),
      });
      /* REVISION-58 W7: non tratar 429/rede coma «código incorrecto». */
      if (res.status === 429) {
        setError(t("login.errorRateLimit", { minutes: 15 }));
        return;
      }
      if (!res.ok) {
        setError(t("login.errorCode"));
        return;
      }
      const data = (await res.json()) as { redirectTo?: string };
      window.location.href = data.redirectTo ?? returnTo;
    } catch {
      setError(t("login.errorNetwork"));
    }
  };

  const resendOtp = async () => {
    if (resendLeft > 0 || !email) return;
    setError(null);
    setDemoCode(null);
    try {
      const res = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          method: "email_otp",
          identifier: email,
          municipalityId: `muni-${slug}`,
        }),
      });
      if (!res.ok) throw new Error("otp");
      const data = (await res.json()) as {
        challengeId?: string;
        message?: string;
        demoCode?: string;
      };
      setChallengeId(data.challengeId ?? null);
      setMsg(data.message ?? null);
      setDemoCode(
        typeof data.demoCode === "string" && /^\d{6}$/.test(data.demoCode)
          ? data.demoCode
          : null,
      );
      setCode("");
      setResendLeft(RESEND_SECS);
    } catch {
      setError(t("login.errorOtp"));
    }
  };

  const toggleOtp = () => {
    setOtpStep((s) => (s === "closed" ? "email" : "closed"));
    if (otpStep !== "closed") {
      /* closing — keep challenge if any */
    }
  };

  if (!slug) {
    return <AccesoPickPage />;
  }

  if (muniMissing) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-ink">
        <h1 className="m-0 text-2xl font-extrabold text-marino">
          {t("login.muniNotFound")}
        </h1>
        <p className="mt-3 text-graphite">{t("login.muniNotFoundBody")}</p>
        <Link to="/" className="mt-6 inline-block font-bold text-azul-700 underline">
          {t("nav.home")}
        </Link>
      </main>
    );
  }

  const shortName = muniName.replace(/^Concello de\s+/i, "");
  const initial = shortName.charAt(0) || "";
  const homeTo = `/c/${slug}`;
  const mailOpen = otpStep !== "closed";
  const resendLabel =
    resendLeft > 0
      ? t("login.resendIn", {
          t: `${Math.floor(resendLeft / 60)}:${String(resendLeft % 60).padStart(2, "0")}`,
        })
      : t("login.resend");

  const perks = [
    {
      t: t("login.perk1Title"),
      d: t("login.perk1Desc"),
      icon: "M12 7v5l3 3M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
    },
    {
      t: t("login.perk2Title"),
      d: t("login.perk2Desc"),
      icon: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM18 18h3v3h-3z",
    },
    {
      t: t("login.perk3Title"),
      d: t("login.perk3Desc"),
      icon: "M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
    },
  ] as const;

  const claveCard = (
    <div className="flex flex-col gap-2" data-testid="login-clave-card">
      <button
        type="button"
        onClick={() => void startSaml()}
        className="flex w-full items-center gap-3.5 rounded-[16px] border-2 border-azul bg-white p-3.5 text-left transition hover:shadow-[0_14px_30px_-22px_rgba(0,43,74,.55)] md:gap-4 md:rounded-[18px] md:border-[1.5px] md:border-line md:p-5 md:hover:border-azul"
      >
        <span
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[13px] bg-azul text-white md:h-[52px] md:w-[52px] md:rounded-[14px] max-md:bg-azul"
          aria-hidden
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 3l8 4v5c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V7zM9 12l2 2 4-4" />
          </svg>
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <strong className="text-lg font-extrabold text-marino md:text-[19px]">
              {t("login.samlShort")}
            </strong>
            <span className="rounded-full bg-azul-25 px-2 py-0.5 text-[11px] font-extrabold text-azul-700 md:hidden md:text-xs">
              {t("login.recommended")}
            </span>
          </span>
          <span className="text-[13px] text-graphite md:text-sm">
            <span className="md:hidden">{t("login.claveDescMobile")}</span>
            <span className="hidden md:inline">{t("login.claveDescV2")}</span>
          </span>
        </span>
        <svg
          aria-hidden
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#007BC4"
          strokeWidth="2.6"
          className="shrink-0 md:h-5 md:w-5"
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
      {samlError ? (
        <p
          role="alert"
          className="rounded-[12px] border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-semibold text-red-800"
          data-testid="login-clave-rate-limit"
        >
          {samlError}
        </p>
      ) : null}
    </div>
  );

  const certCard = (
    <div className="flex flex-col gap-2" data-testid="login-cert-card">
      <button
        type="button"
        onClick={() => void startCert()}
        disabled={certHint}
        className="flex w-full items-center gap-3.5 rounded-[16px] border-[1.5px] border-line bg-white p-3.5 text-left transition hover:shadow-[0_14px_30px_-22px_rgba(0,43,74,.55)] disabled:opacity-90 md:gap-4 md:rounded-[18px] md:border-2 md:border-azul md:p-5"
      >
        <span
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[13px] bg-azul text-white md:h-[52px] md:w-[52px] md:rounded-[14px]"
          aria-hidden
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 5h18v14H3zM7 9h6M7 13h4M17 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
          </svg>
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <strong className="text-lg font-extrabold text-marino md:text-[19px]">
              {t("login.cert")}
            </strong>
            <span className="hidden rounded-full bg-azul-25 px-2 py-0.5 text-[11px] font-extrabold text-azul-700 md:inline md:text-xs">
              {t("login.recommended")}
            </span>
          </span>
          <span className="text-[13px] text-graphite md:text-sm">
            <span className="md:hidden">{t("login.cert.subMobile")}</span>
            <span className="hidden md:inline">{t("login.cert.subDesktop")}</span>
          </span>
          {certHint ? (
            <span className="text-[13px] font-bold text-azul-700" aria-live="polite">
              {t("login.cert.pickHint")}
            </span>
          ) : null}
        </span>
        <svg
          aria-hidden
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#007BC4"
          strokeWidth="2.6"
          className="shrink-0 md:h-5 md:w-5"
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
      {certError ? (
        <div className="rounded-[14px] border border-aviso-bd bg-aviso-bg px-3.5 py-3 text-sm text-aviso-ink" role="alert">
          <p className="m-0 font-bold">{certError}</p>
          <div className="mt-2 flex flex-wrap gap-3">
            <button
              type="button"
              className="border-0 bg-transparent p-0 font-extrabold text-azul-700 underline"
              onClick={() => void startCert()}
            >
              {t("login.cert.retry")}
            </button>
            <Link
              to={`/acceso/certificado?returnTo=${encodeURIComponent(returnTo)}`}
              className="font-extrabold text-azul-700 underline"
            >
              {t("login.cert.helpLink")}
            </Link>
          </div>
        </div>
      ) : null}
      <p className="m-0 px-1 text-[13px]">
        <Link
          to={`/acceso/certificado?returnTo=${encodeURIComponent(returnTo)}`}
          className="font-bold text-azul-700 underline"
        >
          {t("login.cert.helpLink")}
        </Link>
      </p>
      {isDemo ? (
        <p className="m-0 px-1 text-[12px] text-graphite md:text-[13px]">
          {t("login.cert.demoPrivacy")}
        </p>
      ) : null}
    </div>
  );

  const otpPanel = (
    <div
      className={`overflow-hidden rounded-[16px] border-[1.5px] bg-white md:rounded-[18px] ${
        mailOpen ? "border-azul" : "border-line"
      }`}
    >
      <button
        type="button"
        aria-expanded={mailOpen}
        onClick={toggleOtp}
        className="flex w-full items-center gap-3.5 p-3.5 text-left md:gap-4 md:p-5"
      >
        <span
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[13px] bg-[#F0F6FB] text-azul-700 md:h-[52px] md:w-[52px] md:rounded-[14px]"
          aria-hidden
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 5h16v14H4zM4 7l8 6 8-6" />
          </svg>
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <strong className="text-lg font-extrabold text-marino md:text-[19px]">
            {t("login.otpCard")}
          </strong>
          <span className="text-[13px] text-graphite md:text-sm">
            {isDemo ? (
              <span>{t("login.otpCardDescDemo")}</span>
            ) : (
              <>
                <span className="md:hidden">{t("login.otpCardDescMobile")}</span>
                <span className="hidden md:inline">{t("login.otpCardDescV2")}</span>
              </>
            )}
          </span>
        </span>
        <svg
          aria-hidden
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#4A5B6B"
          strokeWidth="2.6"
          className={`shrink-0 transition-transform md:h-5 md:w-5 ${
            mailOpen ? "rotate-90" : ""
          }`}
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>

      {otpStep === "email" && (
        <form
          onSubmit={(e) => void sendOtp(e)}
          className="flex flex-col gap-3 px-5 pb-5"
        >
          <label className="flex flex-col gap-1.5 text-sm font-extrabold text-[#3B4D5E]">
            {t("login.email")}
            <input
              type="email"
              required
              autoComplete="email"
              placeholder={t("login.emailPh")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-[52px] rounded-xl border-[1.5px] border-border2 px-3.5 text-[17px] font-normal text-ink outline-none focus:border-azul focus-visible:ring-2 focus-visible:ring-azul focus-visible:ring-offset-2"
            />
          </label>
          <button
            type="submit"
            className="h-[52px] rounded-[14px] border-0 bg-azul text-base font-extrabold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-azul-700"
          >
            {t("login.sendCode")}
          </button>
        </form>
      )}

      {otpStep === "code" && (
        <form
          onSubmit={(e) => void verifyOtp(e)}
          className="flex flex-col gap-3 px-5 pb-5"
        >
          <p className="m-0 text-[15px] text-[#3B4D5E]">
            {msg ?? t("login.otpSent", { email })}
          </p>
          {demoCode ? (
            <div
              className="rounded-xl border border-dashed border-azul/40 bg-[#F0F6FB] px-3.5 py-3"
              data-testid="demo-otp-code"
              role="status"
            >
              <p className="m-0 text-[15px] text-[#3B4D5E]">
                {t("login.otpDemoCode", { code: demoCode })}
              </p>
              <p className="m-0 mt-2 text-[13px]">
                <a
                  className="font-bold text-azul-700 underline"
                  href="/correo/"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("login.otpDemoMailpit")}
                </a>
              </p>
            </div>
          ) : null}
          <OtpDigitBoxes value={code} onChange={setCode} />
          <button
            type="submit"
            disabled={code.replace(/\D/g, "").length < OTP_LEN}
            className="h-[52px] rounded-[14px] border-0 bg-azul text-base font-extrabold text-white disabled:opacity-50"
          >
            {t("login.enter")}
          </button>
          <span className="flex justify-between text-sm">
            <button
              type="button"
              className="border-0 bg-transparent p-0 font-bold text-azul-700 underline"
              onClick={() => {
                setChallengeId(null);
                setDemoCode(null);
                setCode("");
                setOtpStep("email");
              }}
            >
              {t("login.changeEmail")}
            </button>
            {resendLeft > 0 ? (
              <span className="text-graphite">{resendLabel}</span>
            ) : (
              <button
                type="button"
                className="border-0 bg-transparent p-0 font-bold text-azul-700 underline"
                onClick={() => void resendOtp()}
              >
                {resendLabel}
              </button>
            )}
          </span>
        </form>
      )}
    </div>
  );

  /* REVISION-43 R9: selector segmentado tamén no móbil (non dúas tarxetas). */
  const profileTabs = (
    <div className="flex flex-col gap-2" data-testid="login-perfil-tabs">
      <div
        role="tablist"
        aria-label={t("login.perfilAria")}
        className="flex overflow-hidden rounded-btn border-[1.5px] border-border2"
      >
        <button
          type="button"
          role="tab"
          aria-selected={perfil === "vecina"}
          className={`flex min-h-[52px] flex-1 items-center justify-center border-0 px-2.5 py-2 text-center text-[13px] font-extrabold leading-snug sm:text-sm ${
            perfil === "vecina"
              ? "bg-marino text-on-dark"
              : "bg-surface text-marino hover:bg-azul-25"
          }`}
          onClick={() => setPerfil("vecina")}
        >
          {t("login.perfilVecina")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={perfil === "entidade"}
          className={`flex min-h-[52px] flex-1 items-center justify-center border-0 border-l-[1.5px] border-border2 px-2.5 py-2 text-center text-[13px] font-extrabold leading-snug sm:text-sm ${
            perfil === "entidade"
              ? "bg-marino text-on-dark"
              : "bg-surface text-marino hover:bg-azul-25"
          }`}
          onClick={() => setPerfil("entidade")}
        >
          {t("login.perfilEntidade")}
        </button>
      </div>
      {perfil === "entidade" ? (
        <p className="m-0 text-[13px] text-graphite">
          {t("login.perfilEntidadeHint")}{" "}
          {contactEmail ? (
            <a href={`mailto:${contactEmail}`} className="font-bold underline">
              {t("login.perfilAskConcello")}
            </a>
          ) : (
            <span className="font-bold">{t("login.perfilAskConcello")}</span>
          )}
        </p>
      ) : null}
    </div>
  );

  const logoutBanner = logoutNotice ? (
    <div
      className="rounded-2xl border border-libre-bd bg-libre-bg px-4 py-3 text-sm font-bold text-marino"
      role="status"
      aria-live="polite"
      data-testid="logout-notice"
    >
      {t("login.loggedOut")}
      <button
        type="button"
        className="ml-2 border-0 bg-transparent p-0 text-azul-700 underline"
        onClick={() => setLogoutNotice(false)}
      >
        {t("common.dismiss", { defaultValue: "Pechar" })}
      </button>
    </div>
  ) : null;

  const helpDetails = (
    <details className="rounded-2xl border border-line bg-white px-4 py-3.5 md:rounded-none md:border-0 md:border-t md:border-line md:bg-transparent md:px-0 md:pb-0 md:pt-3.5">
      <summary className="min-h-7 cursor-pointer text-[15px] font-extrabold text-marino">
        {t("login.helpNone")}
      </summary>
      <p className="mt-2 text-sm leading-relaxed text-graphite">
        {t("login.helpNoneBody")}
        {(contactEmail || contactAddress) && (
          <>
            {" "}
            {contactEmail ? (
              <a href={`mailto:${contactEmail}`} className="font-bold underline">
                {contactEmail}
              </a>
            ) : null}
            {contactEmail && contactAddress ? " · " : null}
            {contactAddress ? <strong>{contactAddress}</strong> : null}
            {"."}
          </>
        )}{" "}
        <a
          href="https://clave.gob.es"
          target="_blank"
          rel="noreferrer"
          className="font-bold underline"
        >
          {t("login.helpClave")}
        </a>
        {" · "}
        <a
          href="https://www.sede.fnmt.gob.es/certificados"
          target="_blank"
          rel="noreferrer"
          className="font-bold underline"
        >
          {t("login.cert.help.fnmt")}
        </a>
      </p>
    </details>
  );

  /* titular legal se existe; se non, nome do concello (evita «O  trata…»). */
  const privacyMuni = legalTitular || muniName;
  const privacyLine = privacyMuni ? (
    <p className="m-0 text-xs leading-relaxed text-graphite md:text-[13px]">
      {t("login.privacyBriefV2", { muni: privacyMuni })}{" "}
      <Link
        to={`/c/${slug}/legal/privacidade`}
        className="font-bold text-azul-700 underline"
      >
        {t("legal.privacy")}
      </Link>
      <span className="md:hidden">
        {" · "}
        <Link
          to={`/c/${slug}/lectura-facil`}
          className="font-bold text-azul-700 underline"
        >
          {t("login.easyRead")}
        </Link>
      </span>
    </p>
  ) : null;

  return (
    <div className="min-h-screen bg-paper text-ink md:flex md:min-h-screen md:flex-wrap">
      {/* ── PC left panel ── */}
      <aside className="pa-hero-v3 relative hidden flex-[1_1_520px] flex-col gap-10 overflow-hidden px-10 py-10 text-marino md:flex lg:px-14">
        <svg
          aria-hidden
          width="620"
          height="400"
          viewBox="0 0 620 400"
          className="pointer-events-none absolute -bottom-[110px] -right-[160px]"
        >
          <g fill="none" stroke="#CFE3F2" strokeWidth="3">
            <rect x="10" y="10" width="600" height="380" rx="8" />
            <path d="M310 10v380" />
            <circle cx="310" cy="200" r="60" />
          </g>
        </svg>

        <Link
          to={homeTo}
          className="relative flex items-center gap-3 self-start text-marino no-underline"
        >
          {muniLoading || !muniName ? (
            <span
              className="flex h-10 w-10 animate-pulse rounded-xl bg-area"
              aria-hidden
            />
          ) : (
            <ShieldMark
              initial={initial}
              size={40}
              src={logo}
              variant="onLight"
              brandColor={brand}
            />
          )}
          <span className="flex flex-col leading-tight">
            <strong className="text-lg">
              {muniLoading || !muniName ? (
                <span className="inline-block h-5 w-40 animate-pulse rounded bg-area" />
              ) : (
                muniName
              )}
            </strong>
            <span className="text-sm text-hero-ink">{t("login.asideFacilities")}</span>
          </span>
        </Link>

        <div className="relative my-auto flex max-w-[480px] flex-col gap-6">
          <p className="m-0 font-display text-[50px] font-extrabold leading-[1.04] tracking-[-0.025em] text-marino">
            {perfil === "entidade"
              ? t("login.heroTitleEntidade")
              : t("login.heroTitle")}
          </p>
          <ul className="m-0 flex list-none flex-col gap-4 p-0">
            {perks.map((p) => (
              <li key={p.t} className="flex items-center gap-3.5">
                <span
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-hero-line bg-surface text-azul-700"
                  aria-hidden
                >
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d={p.icon} />
                  </svg>
                </span>
                <span className="flex flex-col gap-0.5">
                  <strong className="text-[17px] text-marino">{p.t}</strong>
                  <span className="text-[15px] text-hero-ink">{p.d}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <span className="relative text-[13px] text-graphite">{t("login.footerBrand")}</span>
      </aside>

      {/* ── Mobile header ── */}
      <header className="pa-hero-v3 relative overflow-hidden px-3.5 pb-[92px] pt-2.5 text-marino md:hidden">
        <div className="relative flex items-center gap-2">
          <BackLink to={homeTo} className="shrink-0">
            {t("nav.home")}
          </BackLink>
          <div className="ml-auto">
            <ReadingPrefsAaControl variant="onLight" />
          </div>
        </div>
        <h1 className="relative mx-1.5 mt-[22px] font-display text-[30px] font-extrabold leading-[1.08] tracking-[-0.02em] text-marino">
          {t("login.titleMobile")}
        </h1>
      </header>

      {/* ── Right / main ── */}
      <main className="relative flex flex-[1_1_560px] flex-col gap-3 px-3.5 pb-10 md:gap-6 md:px-14 md:pb-10 md:pt-7">
        <div className="hidden items-center gap-3 md:flex">
          <BackLink to={homeTo}>{t("nav.home")}</BackLink>
          <div className="ml-auto">
            <ReadingPrefsAaControl variant="onLight" />
          </div>
        </div>

        <div className="-mt-[68px] flex w-full max-w-[520px] flex-col gap-3 md:mx-auto md:mt-0 md:gap-5">
          <div className="hidden flex-col gap-2 md:flex">
            <h2 className="m-0 text-[34px] font-extrabold tracking-[-0.02em] text-marino">
              {t("login.titleShort")}
            </h2>
            <p className="m-0 text-base leading-relaxed text-graphite">
              {perfil === "entidade"
                ? t("login.leadEntidade")
                : t("login.leadV2")}
            </p>
          </div>

          {logoutBanner}
          {profileTabs}

          {/* PC: cert → Cl@ve → OTP · Móbil: Cl@ve → OTP → cert */}
          <div className="flex flex-col gap-2.5 rounded-[22px] bg-white p-3.5 shadow-[0_24px_48px_-30px_rgba(0,43,74,.6)] md:gap-5 md:rounded-none md:bg-transparent md:p-0 md:shadow-none">
            <div className="order-2 md:order-1">{certCard}</div>
            {samlLogin ? (
              <div className="order-1 md:order-2">{claveCard}</div>
            ) : null}
            <div className="order-3">{otpPanel}</div>
          </div>

          {error && (
            <div className="pa-warn-banner" role="alert">
              <span aria-hidden>⚠</span>
              <span>{error}</span>
            </div>
          )}

          {helpDetails}
          {privacyLine}
        </div>
      </main>
    </div>
  );
}
