import type { ReactNode } from "react";
import { Button } from "./Button";
import { CourtArt, type CourtArtType } from "./CourtArt";

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  courtType = "padel",
  className = "",
}: {
  title: string;
  description?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  courtType?: CourtArtType;
  className?: string;
}) {
  return (
    <div
      className={[
        "flex flex-col items-center gap-4 px-5 py-9 text-center",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <CourtArt
        type={courtType}
        width={120}
        height={80}
        className="pa-ui-empty-court"
        toneClass="bg-marino"
      />
      <strong className="text-lg font-extrabold text-marino">{title}</strong>
      {description != null ? (
        <span className="max-w-xs text-[15px] text-graphite">{description}</span>
      ) : null}
      {actionLabel && onAction ? (
        <Button variant="primary" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
