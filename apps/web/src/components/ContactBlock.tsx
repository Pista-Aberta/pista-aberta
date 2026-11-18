import { useTranslation } from "react-i18next";
import type { ResolvedContact } from "@pista-aberta/shared";

function osmUrl(opts: {
  lat?: number | null;
  lng?: number | null;
  address?: string;
}): string | null {
  const { lat, lng, address } = opts;
  if (
    lat != null &&
    lng != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    !(lat === 0 && lng === 0)
  ) {
    return `https://www.openstreetmap.org/?mlat=${encodeURIComponent(String(lat))}&mlon=${encodeURIComponent(String(lng))}#map=17/${encodeURIComponent(String(lat))}/${encodeURIComponent(String(lng))}`;
  }
  if (address?.trim()) {
    return `https://www.openstreetmap.org/search?query=${encodeURIComponent(address.trim())}`;
  }
  return null;
}

function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

/** REVISION-50 S4 — só http(s) no href. */
function safeWebHref(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  try {
    const u = new URL(v.includes("://") ? v : `https://${v}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Bloque «Contacto» axe-friendly (tel / mailto / Como chegar / horario). */
export function ContactBlock({
  contact,
  facilityAddress,
  lat,
  lng,
  titleAs = "h2",
  title,
  className = "",
  compact = false,
  hideTitle = false,
  headingId,
}: {
  contact: ResolvedContact;
  /** Enderezo da instalación (preferido sobre o do concello). */
  facilityAddress?: string;
  lat?: number | null;
  lng?: number | null;
  titleAs?: "h2" | "h3";
  /** REVISION-41 O11: título da tarxeta xeral («Servizo Municipal…»). */
  title?: string;
  className?: string;
  compact?: boolean;
  hideTitle?: boolean;
  headingId?: string;
}) {
  const { t } = useTranslation();
  const address = (facilityAddress ?? "").trim() || contact.address;
  const map = osmUrl({ lat, lng, address });
  const hasAnything =
    !!contact.person ||
    !!contact.phone ||
    !!contact.email ||
    !!address ||
    !!contact.hours ||
    !!contact.web ||
    !!contact.serviceName;
  if (!hasAnything) return null;

  const TitleTag = titleAs;
  const hid = headingId ?? "pa-contact-heading";

  return (
    <section
      className={className}
      aria-labelledby={hideTitle ? undefined : hid}
      aria-label={hideTitle ? t("contact.title") : undefined}
      data-testid="contact-block"
    >
      {hideTitle ? null : (
        <TitleTag
          id={hid}
          className={
            compact
              ? "m-0 text-sm font-extrabold text-marino"
              : "m-0 text-lg font-extrabold text-marino"
          }
        >
          {title ?? t("contact.title")}
        </TitleTag>
      )}
      <dl className={`m-0 grid gap-2 ${compact ? "mt-2 text-sm" : "mt-3 text-sm"}`}>
        {contact.serviceName && contact.serviceName !== title ? (
          <div>
            <dt className="sr-only">{t("contact.serviceName")}</dt>
            <dd className="m-0 font-bold text-marino">{contact.serviceName}</dd>
          </div>
        ) : null}
        {contact.person ? (
          <div>
            <dt className="text-graphite">{t("contact.person")}</dt>
            <dd className="m-0 font-bold text-marino">{contact.person}</dd>
          </div>
        ) : null}
        {contact.phone ? (
          <div>
            <dt className="text-graphite">{t("contact.phone")}</dt>
            <dd className="m-0">
              <a
                className="font-bold text-azul-700 underline"
                href={telHref(contact.phone)}
              >
                {contact.phone}
              </a>
            </dd>
          </div>
        ) : null}
        {contact.email ? (
          <div>
            <dt className="text-graphite">{t("contact.email")}</dt>
            <dd className="m-0">
              <a
                className="font-bold text-azul-700 underline"
                href={`mailto:${contact.email}`}
              >
                {contact.email}
              </a>
            </dd>
          </div>
        ) : null}
        {address ? (
          <div>
            <dt className="text-graphite">{t("contact.address")}</dt>
            <dd className="m-0 text-marino">
              <span>{address}</span>
              {map ? (
                <>
                  {" · "}
                  <a
                    className="font-bold text-azul-700 underline"
                    href={map}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("booking.howToGet")}
                  </a>
                </>
              ) : null}
            </dd>
          </div>
        ) : null}
        {contact.hours ? (
          <div>
            <dt className="text-graphite">{t("contact.hours")}</dt>
            <dd className="m-0 text-marino">{contact.hours}</dd>
          </div>
        ) : null}
        {contact.web && safeWebHref(contact.web) ? (
          <div>
            <dt className="text-graphite">{t("contact.web")}</dt>
            <dd className="m-0">
              <a
                className="font-bold text-azul-700 underline"
                href={safeWebHref(contact.web)!}
                target="_blank"
                rel="noopener noreferrer"
              >
                {contact.web.replace(/^https?:\/\//, "")}
              </a>
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
