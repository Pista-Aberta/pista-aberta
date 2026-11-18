import { Link } from "react-router-dom";

export function EmptyState({
  title,
  body,
  actionLabel,
  actionTo,
}: {
  title?: string;
  body: string;
  actionLabel?: string;
  actionTo?: string;
}) {
  return (
    <div className="pa-card flex flex-col items-start gap-3 p-8 text-left">
      {title ? <h2 className="pa-h2">{title}</h2> : null}
      <p className="text-graphite">{body}</p>
      {actionLabel && actionTo && (
        <Link to={actionTo} className="pa-btn-primary mt-2">
          {actionLabel}
        </Link>
      )}
    </div>
  );
}
