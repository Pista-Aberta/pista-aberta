/** URLs e utilidades «Como chegar» (ficha + correo). */

export type ComoChegarFields = {
  parkingInfo?: string | null;
  publicTransport?: string | null;
  entranceInfo?: string | null;
  accessibility?: string | null;
};

export function trimComoChegar(v: string | null | undefined): string {
  return (v ?? "").trim();
}

/** Liña curta para correo: entrada ou aparcamento (nesta orde). */
export function comoChegarHintLine(
  fields: ComoChegarFields,
  locale: "gl" | "es" = "gl",
): string | null {
  const entrance = trimComoChegar(fields.entranceInfo);
  if (entrance) {
    const label = locale === "es" ? "Entrada" : "Entrada";
    return `${label}: ${entrance}`;
  }
  const parking = trimComoChegar(fields.parkingInfo);
  if (parking) {
    const label = locale === "es" ? "Aparcamiento" : "Aparcamento";
    return `${label}: ${parking}`;
  }
  return null;
}

export function hasComoChegarContent(
  fields: ComoChegarFields,
  opts?: { lat?: number | null; lng?: number | null; address?: string | null },
): boolean {
  if (trimComoChegar(fields.parkingInfo)) return true;
  if (trimComoChegar(fields.publicTransport)) return true;
  if (trimComoChegar(fields.entranceInfo)) return true;
  if (trimComoChegar(fields.accessibility)) return true;
  const lat = opts?.lat;
  const lng = opts?.lng;
  if (
    lat != null &&
    lng != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    !(lat === 0 && lng === 0)
  ) {
    return true;
  }
  if ((opts?.address ?? "").trim()) return true;
  return false;
}

export function osmEmbedUrl(lat: number, lng: number, pad = 0.012): string {
  const bbox = [lng - pad, lat - pad, lng + pad, lat + pad].join("%2C");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lng}`;
}

export function osmDirectionsUrl(lat: number, lng: number): string {
  return `https://www.openstreetmap.org/directions?to=${encodeURIComponent(`${lat},${lng}`)}`;
}

/**
 * Ligazón «Abrir no mapa do móbil»:
 * Android geo: · iOS Apple Maps · resto OSM directions.
 */
export function mobileMapUrl(
  lat: number,
  lng: number,
  name: string,
  userAgent?: string,
): string {
  const ua = userAgent ?? "";
  if (/Android/i.test(ua)) {
    return `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(name)})`;
  }
  if (/iPhone|iPad|iPod/i.test(ua)) {
    return `https://maps.apple.com/?daddr=${lat},${lng}`;
  }
  return osmDirectionsUrl(lat, lng);
}
