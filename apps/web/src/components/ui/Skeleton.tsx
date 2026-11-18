export function Skeleton({
  width = "100%",
  height = 16,
  radiusClass = "rounded-chip",
  className = "",
}: {
  width?: number | string;
  height?: number | string;
  radiusClass?: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={["pa-ui-skeleton block", radiusClass, className].filter(Boolean).join(" ")}
      style={{ width, height }}
    />
  );
}

export function SkeletonBlock({ rows = 3 }: { rows?: number }) {
  return (
    <div
      className="flex flex-col gap-3"
      aria-busy="true"
      aria-live="polite"
    >
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton
          key={i}
          height={i === 0 ? 22 : 14}
          width={i === rows - 1 ? "70%" : "100%"}
        />
      ))}
    </div>
  );
}
