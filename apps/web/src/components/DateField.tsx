import { formatDate } from "../lib/format-date";

/**
 * Selector de data con formato GL/ES visible (evita mm/dd/yyyy do navegador).
 * Redeseno B10.
 */
export function DateField({
  value,
  onChange,
  required,
  label,
  locale = "gl",
}: {
  value: string;
  onChange: (iso: string) => void;
  required?: boolean;
  label: string;
  locale?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm font-bold">
      {label}
      <input
        type="date"
        lang={locale.toLowerCase().startsWith("es") ? "es-ES" : "gl-ES"}
        className="pa-input"
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <span className="font-normal text-graphite">{formatDate(value, locale)}</span>
      )}
    </label>
  );
}
