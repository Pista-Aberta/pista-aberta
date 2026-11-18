import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Accessibility,
  Bus,
  Car,
  DoorOpen,
  MapPinned,
  type LucideIcon,
} from "lucide-react";
import {
  hasComoChegarContent,
  mobileMapUrl,
  trimComoChegar,
} from "@pista-aberta/shared";

type Props = {
  name: string;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  parkingInfo?: string | null;
  publicTransport?: string | null;
  entranceInfo?: string | null;
  accessibility?: string | null;
  className?: string;
  titleAs?: "h2" | "h3";
  /** REVISION-42 Q3: sen iframe; só botón + textos. */
  hideTitle?: boolean;
};

function hasCoords(lat?: number | null, lng?: number | null): boolean {
  return (
    lat != null &&
    lng != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    !(lat === 0 && lng === 0)
  );
}

export function ComoChegarSection({
  name,
  address,
  lat,
  lng,
  parkingInfo,
  publicTransport,
  entranceInfo,
  accessibility,
  className = "",
  titleAs = "h2",
  hideTitle = false,
}: Props) {
  const { t } = useTranslation();
  const fields = { parkingInfo, publicTransport, entranceInfo, accessibility };
  const show = hasComoChegarContent(fields, { lat, lng, address });
  const coordsOk = hasCoords(lat, lng);

  const openHref = useMemo(() => {
    if (!coordsOk || lat == null || lng == null) return null;
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    return mobileMapUrl(lat, lng, name, ua);
  }, [coordsOk, lat, lng, name]);

  if (!show) return null;

  const TitleTag = titleAs;
  const items: Array<{
    key: string;
    label: string;
    text: string;
    Icon: LucideIcon;
  }> = [];
  const parking = trimComoChegar(parkingInfo);
  if (parking) {
    items.push({
      key: "parking",
      label: t("comoChegar.parking"),
      text: parking,
      Icon: Car,
    });
  }
  const transport = trimComoChegar(publicTransport);
  if (transport) {
    items.push({
      key: "transport",
      label: t("comoChegar.publicTransport"),
      text: transport,
      Icon: Bus,
    });
  }
  const entrance = trimComoChegar(entranceInfo);
  if (entrance) {
    items.push({
      key: "entrance",
      label: t("comoChegar.entrance"),
      text: entrance,
      Icon: DoorOpen,
    });
  }
  const access = trimComoChegar(accessibility);
  if (access) {
    items.push({
      key: "access",
      label: t("comoChegar.accessibility"),
      text: access,
      Icon: Accessibility,
    });
  }

  const addr = (address ?? "").trim();

  return (
    <section
      className={className}
      aria-labelledby={hideTitle ? undefined : "pa-como-chegar-heading"}
      aria-label={hideTitle ? t("comoChegar.title") : undefined}
      data-testid="como-chegar"
    >
      {hideTitle ? null : (
        <TitleTag
          id="pa-como-chegar-heading"
          className="m-0 text-lg font-extrabold text-marino"
        >
          {t("comoChegar.title")}
        </TitleTag>
      )}

      {addr ? (
        <p className={`text-sm text-marino ${hideTitle ? "m-0" : "mt-3"}`} role="note">
          {addr}
        </p>
      ) : null}

      {openHref ? (
        <a
          href={openHref}
          className="pa-btn-secondary mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 no-underline sm:w-auto"
          data-testid="como-chegar-open-map"
        >
          <MapPinned size={18} strokeWidth={2.4} aria-hidden />
          {t("comoChegar.openMobileMap")}
        </a>
      ) : null}

      {items.length > 0 ? (
        <ul className="mt-4 m-0 list-none space-y-3 p-0">
          {items.map(({ key, label, text, Icon }) => (
            <li key={key} className="flex gap-3 text-sm">
              <span
                className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-btn bg-area text-marino"
                aria-hidden
              >
                <Icon size={18} strokeWidth={2.2} />
              </span>
              <div className="min-w-0">
                <p className="m-0 font-extrabold text-marino">{label}</p>
                <p className="m-0 text-graphite">{text}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
