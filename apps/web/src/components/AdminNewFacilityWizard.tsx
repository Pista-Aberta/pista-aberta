import { FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { apiX } from "../lib/api-complete";
import { FacilityTypeIcon } from "./icons";
import { FacilityMapPicker } from "./FacilityMapPicker";

function FieldError({ msg }: { msg?: string | null }) {
  if (!msg) return null;
  return (
    <p className="text-sm font-bold text-coral" role="alert">
      {msg}
    </p>
  );
}

const FACILITY_TYPES = ["pista", "pavillon", "campo", "sala"] as const;
type FacilityType = (typeof FACILITY_TYPES)[number];

type Props = {
  slug: string;
  onCreated: () => void;
  onCancel: () => void;
};

/** REVISION-32 C4 — nome libre («… 2», «… 3»…) se xa existe. */
function uniqueFacilityName(base: string, existing: string[]): string {
  const taken = new Set(existing.map((n) => n.trim().toLowerCase()));
  if (!taken.has(base.trim().toLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`.toLowerCase())) n += 1;
  return `${base} ${n}`;
}

export function AdminNewFacilityWizard({ slug, onCreated, onCancel }: Props) {
  const { t } = useTranslation();
  const [step, setStep] = useState(1);
  const [type, setType] = useState<FacilityType>("pista");
  const [courtCount, setCourtCount] = useState(2);
  const [halfCourts, setHalfCourts] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState(42.75);
  const [lng, setLng] = useState(-7.65);
  const [addressHint, setAddressHint] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [muniName, setMuniName] = useState(slug);
  const [existingNames, setExistingNames] = useState<string[]>([]);

  useEffect(() => {
    void apiX.facilityMapCenter(slug).then((r) => {
      setLat(r.data.lat);
      setLng(r.data.lng);
      if (r.data.addressHint) {
        setAddressHint(r.data.addressHint);
        setAddress((prev) => prev || r.data.addressHint || "");
      }
    });
    void api.info(slug).then((r) => {
      if (r.data?.name) setMuniName(r.data.name);
    });
    void apiX.adminFacilities(slug).then((r) => {
      const names = (r.data ?? []).map((f) => f.name).filter(Boolean);
      setExistingNames(names);
    }).catch(() => setExistingNames([]));
  }, [slug]);

  const typeLabel = (ty: string) => t(`facilities.type.${ty}`, { defaultValue: ty });

  /** REVISION-30 Z15 / REVISION-31 B3 — nome proposto co nome curto. */
  const proposedName = (ty: FacilityType, concello: string) => {
    const short = concello.replace(/^Concello de\s+/i, "").trim() || concello;
    if (ty === "pavillon") return `Pavillón municipal de ${short}`;
    if (ty === "campo") return `Campo municipal de ${short}`;
    if (ty === "sala") return `Sala municipal de ${short}`;
    return `Pistas municipais de ${short}`;
  };

  const nameTaken = (candidate: string) => {
    const key = candidate.trim().toLowerCase();
    if (!key) return false;
    return existingNames.some((n) => n.trim().toLowerCase() === key);
  };

  const goNext = () => {
    setErr(null);
    if (step === 1) {
      setStep(2);
      setName((prev) => {
        if (prev.trim()) return prev;
        return uniqueFacilityName(proposedName(type, muniName), existingNames);
      });
      return;
    }
    if (step === 2) {
      if (nameTaken(name)) {
        setErr(t("admin.facilityNameTaken"));
        return;
      }
      setStep(3);
      return;
    }
    setStep((s) => s + 1);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    if (nameTaken(name)) {
      setErr(t("admin.facilityNameTaken"));
      setSaving(false);
      setStep(2);
      return;
    }
    try {
      await apiX.createFacility(slug, {
        name: name.trim(),
        type,
        address: address.trim(),
        lat,
        lng,
        courtCount: type === "sala" ? 1 : courtCount,
        halfCourts: type === "pavillon" && halfCourts,
      });
      onCreated();
    } catch (ex) {
      const code = ex instanceof Error ? ex.message : "";
      if (code === "coords_required") setErr(t("admin.facilityCoordsRequired"));
      else if (code === "name_taken") setErr(t("admin.facilityNameTaken"));
      else setErr(t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="pa-card mt-4 space-y-4 p-5">
      <h2 className="font-bold">{t("admin.facilityWizardTitle")}</h2>
      <p className="text-sm text-graphite">
        {t("admin.facilityWizardStep", { step, total: 4 })}
      </p>

      {step === 1 && (
        <div className="space-y-4">
          <p className="text-sm font-bold">{t("admin.facilityWizardType")}</p>
          <div
            className="grid gap-2 sm:grid-cols-2"
            role="radiogroup"
            aria-label={t("admin.facilityWizardType")}
          >
            {FACILITY_TYPES.map((ty) => (
              <button
                key={ty}
                type="button"
                role="radio"
                aria-checked={type === ty}
                aria-pressed={type === ty}
                className={`flex items-center gap-3 rounded-btn border p-3 text-left font-bold ${
                  type === ty ? "border-ink bg-area" : "border-line bg-white"
                }`}
                onClick={() => setType(ty)}
              >
                <FacilityTypeIcon type={ty} size={32} />
                {typeLabel(ty)}
              </button>
            ))}
          </div>
          {type !== "sala" && (
            <label className="flex max-w-xs flex-col gap-1 text-sm font-bold">
              {t("admin.facilityCourtCount")}
              <input
                className="pa-input"
                type="number"
                min={1}
                max={12}
                value={courtCount}
                onChange={(e) => setCourtCount(Number(e.target.value) || 1)}
              />
            </label>
          )}
          {type === "pavillon" && courtCount === 1 && (
            <label className="flex items-center gap-2 text-sm font-bold">
              <input
                type="checkbox"
                checked={halfCourts}
                onChange={(e) => setHalfCourts(e.target.checked)}
              />
              {t("admin.facilityHalfCourts")}
            </label>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="grid gap-3 lg:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-bold lg:col-span-2">
            {t("admin.facilityName")}
            <input
              className="pa-input"
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setErr(null);
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-bold lg:col-span-2">
            {t("admin.facilityAddress")}
            <input
              className="pa-input"
              required
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </label>
        </div>
      )}

      {step === 3 && (
        <FacilityMapPicker
          lat={lat}
          lng={lng}
          addressHint={addressHint}
          onChange={({ lat: la, lng: ln }) => {
            setLat(la);
            setLng(ln);
          }}
        />
      )}

      {step === 4 && (
        <div className="space-y-2 text-sm">
          <p>
            <strong>{typeLabel(type)}</strong> · {name}
          </p>
          <p>{address}</p>
          <p>
            {t("admin.facilityCourtCount")}:{" "}
            {type === "sala" ? 1 : courtCount}
            {type === "pavillon" && halfCourts && courtCount === 1
              ? ` (${t("admin.facilityHalfCourts")})`
              : ""}
          </p>
          <p className="text-graphite">{t("admin.facilityWizardDraftNote")}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {step > 1 && (
          <button
            type="button"
            className="pa-btn-secondary"
            onClick={() => {
              setErr(null);
              setStep((s) => s - 1);
            }}
          >
            {t("common.back")}
          </button>
        )}
        {step < 4 ? (
          <button
            key={`wizard-next-${step}`}
            type="button"
            className="pa-btn-primary"
            disabled={(step === 2 && (!name.trim() || !address.trim())) || false}
            onClick={goNext}
          >
            {t("admin.wizardContinue")}
          </button>
        ) : (
          <button
            key="wizard-create-draft"
            type="submit"
            className="pa-btn-primary"
            disabled={saving}
          >
            {t("admin.facilityWizardCreateDraft")}
          </button>
        )}
        <button type="button" className="pa-btn-secondary" onClick={onCancel}>
          {t("common.cancel")}
        </button>
      </div>
      <FieldError msg={err} />
    </form>
  );
}
