import {
  contrastRatio,
  normalizeHex,
  resolvePublicContact,
  resolveTheme,
  type FacilityContactFields,
  type Locale,
  type Municipality,
} from "@pista-aberta/shared";
import { createHash } from "node:crypto";
import type { EmailBlockContext } from "./types.js";
import { emailT } from "./i18n.js";

const MARINO = "#002B4A";

export function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/** Botón: brand se contraste ≥ 4.5:1; se non, marino. */
export function emailButtonBg(brand: string): string {
  const b = normalizeHex(brand, MARINO);
  return contrastRatio(b, "#FFFFFF") >= 4.5 ? b : MARINO;
}

export function escudoHash(logoDataUrl?: string | null, brand?: string): string {
  return createHash("sha256")
    .update((brand ?? "") + (logoDataUrl ?? ""))
    .digest("hex")
    .slice(0, 12);
}

export function escudoAbsoluteUrl(muni: Municipality): string {
  const theme = resolveTheme({
    accentColor: muni.accentColor,
    theme: muni.settings.theme,
  });
  const v = escudoHash(muni.settings.logoDataUrl, theme.brand);
  return `${appBaseUrl()}/api/c/${muni.slug}/escudo.png?v=${v}`;
}

export function buildEmailContext(opts: {
  muni: Municipality | null;
  locale: Locale;
  headerMode?: "reservas" | "clubs" | "panel" | "platform" | "deputacion";
  /** Contacto da instalación se o correo vai ligado a unha ficha. */
  facility?: FacilityContactFields | null;
}): EmailBlockContext {
  const { muni, locale } = opts;
  const mode = opts.headerMode ?? "reservas";
  const isPlatform = !muni;
  const isDeputacion =
    mode === "deputacion" || muni?.settings.deputacionPlatform === true;

  const theme = muni
    ? resolveTheme({
        accentColor: muni.accentColor,
        theme: muni.settings.theme,
      })
    : { brand: MARINO, accent: "#F2B33D" };

  /** Brand cru dos settings (sen escurecer) para decidir o botón. */
  const rawBrand = normalizeHex(
    muni?.settings.theme?.brand ?? muni?.accentColor ?? MARINO,
    MARINO,
  );
  const brand = isPlatform || isDeputacion ? MARINO : theme.brand;
  const accent = isDeputacion || isPlatform ? "#F2B33D" : theme.accent;
  const buttonBg = isPlatform || isDeputacion ? MARINO : emailButtonBg(rawBrand);
  const legal = muni?.settings.legal ?? {};
  const resolved = muni
    ? resolvePublicContact(muni, opts.facility ?? null)
    : {
        serviceName: "",
        phone: "",
        email: "",
        address: "",
        hours: "",
        web: "",
        person: "",
      };

  let concelloName: string;
  let headerSubtitle: string;
  if (isPlatform) {
    concelloName = "Pista Aberta";
    headerSubtitle = emailT(locale, "header.platform");
  } else if (isDeputacion) {
    /* REVISION-35 G6: nunca amosar o pseudo «Deputación (plataforma)». */
    const raw = muni?.name?.trim() || "";
    concelloName =
      !raw || /plataforma/i.test(raw)
        ? emailT(locale, "header.deputacion")
        : raw;
    headerSubtitle = emailT(locale, "header.deputacion");
  } else {
    concelloName = muni!.name;
    headerSubtitle = emailT(
      locale,
      mode === "clubs"
        ? "header.clubs"
        : mode === "panel"
          ? "header.panel"
          : "header.reservas",
    );
  }

  const contactEmail = resolved.email || legal.email || "";

  return {
    muni,
    locale,
    baseUrl: appBaseUrl(),
    brand,
    accent,
    buttonBg,
    escudoUrl: muni && !isPlatform ? escudoAbsoluteUrl(muni) : null,
    concelloName,
    headerSubtitle,
    titular: legal.titular || concelloName,
    sinatura: legal.sinatura?.trim() || resolved.serviceName || "",
    address: resolved.address || legal.address || "",
    legalEmail: contactEmail,
    contactPhone: resolved.phone,
    contactEmail,
    isDeputacion,
    isPlatform,
  };
}

export function absolutePath(ctx: EmailBlockContext, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${ctx.baseUrl}${p}`;
}

export function bookingPath(slug: string, id: string): string {
  return `/c/${slug}/reserva/${id}`;
}

export function cancelBookingPath(slug: string, id: string): string {
  return `/c/${slug}/reserva/${id}?accion=cancelar`;
}

export function modifyBookingPath(slug: string, facilityId: string, id: string): string {
  return `/c/${slug}/reservar/${facilityId}?modificar=${id}`;
}

export function reserveSlotPath(
  slug: string,
  facilityId: string,
  date: string,
  slotId: string,
): string {
  return `/c/${slug}/reservar/${facilityId}?data=${encodeURIComponent(date)}&slot=${encodeURIComponent(slotId)}`;
}

export function fromNameFor(muni: Municipality | null): string {
  if (!muni) return "Pista Aberta · Reservas";
  if (muni.settings.deputacionPlatform) {
    const raw = muni.name?.trim() || "";
    const name = !raw || /plataforma/i.test(raw) ? "Deputación" : raw;
    return `${name} · Reservas`;
  }
  return `${muni.name} · Reservas`;
}
