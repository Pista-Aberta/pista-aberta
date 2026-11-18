import { Navigate, useParams } from "react-router-dom";

/** B9/B12 — o informe mensual unificouse en Indicadores. */
export function AdminMonthlyReportPage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  return <Navigate to={`/c/${slug}/admin/indicadores`} replace />;
}
