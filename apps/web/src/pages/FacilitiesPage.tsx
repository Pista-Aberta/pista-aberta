import { Navigate, useParams, useSearchParams } from "react-router-dom";

/** SIMPLIFICACION 1.1 — `/instalacions` → `/reservar` (mesma lista). */
export function FacilitiesPage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const [params] = useSearchParams();
  const q = params.toString();
  return <Navigate to={`/c/${slug}/reservar${q ? `?${q}` : ""}`} replace />;
}
