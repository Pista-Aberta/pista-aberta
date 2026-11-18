import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { resolvePublicContact, type Municipality } from "@pista-aberta/shared";
import { api } from "../lib/api";
import { ContactBlock } from "../components/ContactBlock";
import { BackLink } from "../components/BackLink";

type FacRow = {
  id: string;
  name: string;
  address: string;
  lat?: number;
  lng?: number;
  contactPhone?: string | null;
  contactEmail?: string | null;
  contactPerson?: string | null;
  imageUrl?: string | null;
  imageAlt?: string | null;
};

export function ContactPage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const { t } = useTranslation();
  const [muni, setMuni] = useState<Municipality | null>(null);
  const [facilities, setFacilities] = useState<FacRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([api.info(slug), api.facilities(slug)])
      .then(([info, fac]) => {
        if (cancelled) return;
        setMuni(info.data);
        setFacilities(
          fac.data.map((f) => ({
            id: f.id,
            name: f.name,
            address: f.address,
            lat: (f as FacRow).lat,
            lng: (f as FacRow).lng,
            contactPhone: (f as FacRow).contactPhone ?? null,
            contactEmail: (f as FacRow).contactEmail ?? null,
            contactPerson: (f as FacRow).contactPerson ?? null,
            /* REVISION-47 W6: miniatura en Contacto. */
            imageUrl: f.imageUrl ?? null,
            imageAlt: f.imageAlt ?? null,
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setErr(t("common.error"));
      });
    return () => {
      cancelled = true;
    };
  }, [slug, t]);

  if (err) {
    return (
      <main className="pa-page">
        <p className="text-erro" role="alert">
          {err}
        </p>
      </main>
    );
  }

  if (!muni) {
    return (
      <main className="pa-page">
        <p className="text-graphite">{t("common.loading")}</p>
      </main>
    );
  }

  const muniContact = resolvePublicContact(muni);

  return (
    <main className="pa-page">
      <p className="mb-2">
        <BackLink to={`/c/${slug}`}>{t("nav.home")}</BackLink>
      </p>
      <h1 className="pa-h1">{t("contact.pageTitle")}</h1>
      <p className="mt-2 max-w-2xl text-graphite">{t("contact.pageHint")}</p>

      <ContactBlock
        className="pa-card mt-6 max-w-2xl p-5"
        contact={muniContact}
        facilityAddress={muniContact.address}
        title={
          muniContact.serviceName ||
          t("contact.serviceName", {
            defaultValue: "Servizo Municipal de Deportes",
          })
        }
      />

      <section className="mt-8" aria-labelledby="contact-facilities-title">
        <h2
          id="contact-facilities-title"
          className="m-0 text-lg font-extrabold text-marino"
        >
          {t("contact.facilitiesTitle")}
        </h2>
        {facilities.length === 0 ? (
          <p className="mt-3 text-sm text-graphite">{t("contact.noFacilities")}</p>
        ) : (
          <ul className="mt-3 list-none space-y-3 p-0">
            {facilities.map((f) => {
              /* REVISION-41 O11: só datos propios da instalación (sen repetir comúns). */
              const own = {
                serviceName: "",
                phone: (f.contactPhone ?? "").trim(),
                email: (f.contactEmail ?? "").trim(),
                address: "",
                hours: "",
                web: "",
                person: (f.contactPerson ?? "").trim(),
              };
              return (
                <li key={f.id} className="pa-card flex gap-3 p-4">
                  {/* REVISION-46 D3: miniatura (nunca nos correos). */}
                  {f.imageUrl ? (
                    <img
                      src={f.imageUrl}
                      alt={f.imageAlt?.trim() || f.name}
                      className="h-16 w-24 shrink-0 rounded-[10px] object-cover"
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                  <h3 className="m-0 text-base font-extrabold text-marino">
                    <Link
                      to={`/c/${slug}/reservar/${f.id}`}
                      className="text-azul-700 no-underline hover:underline"
                    >
                      {f.name}
                    </Link>
                  </h3>
                  <ContactBlock
                    className="mt-3"
                    contact={own}
                    facilityAddress={f.address}
                    lat={f.lat}
                    lng={f.lng}
                    compact
                    hideTitle
                    headingId={`contact-fac-${f.id}`}
                  />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
