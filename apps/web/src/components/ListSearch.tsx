import { IconSearch } from "./icons";

/** Search field shown when a list has more than `minRows` items (default 8). */
export function ListSearch({
  value,
  onChange,
  placeholder,
  count,
  minRows = 8,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  count: number;
  minRows?: number;
  label?: string;
}) {
  if (count <= minRows) return null;
  return (
    <label className="mt-4 flex max-w-md flex-col gap-1 text-sm font-bold">
      {label ?? placeholder}
      <span className="relative">
        <IconSearch
          size={18}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-graphite"
        />
        <input
          type="search"
          className="pa-input pl-10 text-base"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      </span>
    </label>
  );
}

export function filterByQuery<T>(
  items: T[],
  query: string,
  fields: (item: T) => Array<string | number | null | undefined>,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) =>
    fields(item).some((f) => String(f ?? "").toLowerCase().includes(q)),
  );
}
