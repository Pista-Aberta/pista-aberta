import { useId, useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";

/** Botón propio en galego/castelán — evita «Choose File / No file chosen». */
export function FilePickButton({
  accept,
  onFile,
  labelKey = "file.choosePhoto",
  className = "",
}: {
  accept?: string;
  onFile: (file: File | null) => void;
  labelKey?:
    | "file.choosePhoto"
    | "file.chooseShield"
    | "file.chooseCsv"
    | "admin.facilityPhotoChange";
  className?: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState<string | null>(null);

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setName(f?.name ?? null);
    onFile(f);
  };

  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={onChange}
      />
      <label htmlFor={id} className="pa-btn-secondary inline-flex min-h-11 cursor-pointer">
        {t(labelKey)}
      </label>
      <span className="text-sm text-graphite">{name ?? t("file.noFile")}</span>
    </div>
  );
}
