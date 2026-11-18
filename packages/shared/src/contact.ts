/** REVISION-40 P1 — contacto concello / instalación. */

export type MunicipalityContact = {
  /** Nome do servizo de deportes. */
  serviceName?: string;
  phone?: string;
  email?: string;
  address?: string;
  /** Horario de atención (texto libre). */
  hours?: string;
  web?: string;
};

export type FacilityContactFields = {
  contactPhone?: string | null;
  contactEmail?: string | null;
  contactPerson?: string | null;
};

export type ResolvedContact = {
  serviceName: string;
  phone: string;
  email: string;
  address: string;
  hours: string;
  web: string;
  person: string;
};

type MuniLike = {
  settings: {
    contact?: MunicipalityContact;
    legal?: { email?: string; address?: string };
  };
};

/** Teléfono/correo da instalación se existen; se non, os do concello. */
export function resolvePublicContact(
  muni: MuniLike,
  facility?: FacilityContactFields | null,
): ResolvedContact {
  const mc = muni.settings.contact ?? {};
  const legal = muni.settings.legal ?? {};
  const phone = (facility?.contactPhone ?? "").trim() || (mc.phone ?? "").trim();
  const email =
    (facility?.contactEmail ?? "").trim() ||
    (mc.email ?? "").trim() ||
    (legal.email ?? "").trim();
  const address = (mc.address ?? "").trim() || (legal.address ?? "").trim();
  return {
    serviceName: (mc.serviceName ?? "").trim(),
    phone,
    email,
    address,
    hours: (mc.hours ?? "").trim(),
    web: (mc.web ?? "").trim(),
    person: (facility?.contactPerson ?? "").trim(),
  };
}
