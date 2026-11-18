import { Navigate, useParams } from "react-router-dom";

/** SIMPLIFICACION 1.3 — mesma lista que `/pavillon`. */
export function WeekendPublicPage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  return <Navigate to={`/c/${slug}/pavillon`} replace />;
}
