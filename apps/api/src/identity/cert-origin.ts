/** Orixe pública do host mTLS (cert.*). Compartida por /api/config e rotas cert. */
export function certOrigin(): string {
  return (
    process.env.CERT_ORIGIN?.trim() ||
    (process.env.CERT_HOST?.trim()
      ? `https://${process.env.CERT_HOST.trim()}`
      : "")
  );
}
