import { useTranslation } from "react-i18next";

type Props = {
  lat: number;
  lng: number;
  onChange: (coords: { lat: number; lng: number }) => void;
  addressHint?: string;
};

export function FacilityMapPicker({ lat, lng, onChange, addressHint }: Props) {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      <p className="text-sm text-graphite">{t("admin.facilityMapHint")}</p>
      {addressHint ? (
        <p className="text-xs text-muted">
          {t("admin.facilityMapAddressHint")}: {addressHint}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-bold">
          {t("admin.facilityLat")}
          <input
            className="pa-input"
            type="number"
            step="0.00001"
            required
            value={Number.isFinite(lat) ? lat : ""}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) onChange({ lat: v, lng });
            }}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-bold">
          {t("admin.facilityLng")}
          <input
            className="pa-input"
            type="number"
            step="0.00001"
            required
            value={Number.isFinite(lng) ? lng : ""}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) onChange({ lat, lng: v });
            }}
          />
        </label>
      </div>
      <a
        className="text-sm font-bold text-azul-700 underline"
        href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`}
        target="_blank"
        rel="noreferrer"
      >
        {t("admin.facilityMapOpenOsm")}
      </a>
    </div>
  );
}
