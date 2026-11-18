/** QR visual (patrón determinista) + código curto lexible — negro sobre branco. */
export function QrPlaceholder({
  shortCode,
  payload,
  size = 168,
  bare = false,
}: {
  shortCode: string;
  payload: string;
  size?: number;
  /** Sen marco externo (para incrustar nun Ticket). */
  bare?: boolean;
}) {
  const cells = 21;
  const bits: boolean[] = [];
  let h = 0;
  for (let i = 0; i < payload.length; i++) h = (h * 31 + payload.charCodeAt(i)) >>> 0;
  for (let i = 0; i < cells * cells; i++) {
    h = (h * 1664525 + 1013904223) >>> 0;
    const r = Math.floor(i / cells);
    const c = i % cells;
    const finder =
      (r < 7 && c < 7) || (r < 7 && c >= cells - 7) || (r >= cells - 7 && c < 7);
    if (finder) {
      const inRing =
        r % (cells - 1) === 0 ||
        c % (cells - 1) === 0 ||
        r === 6 ||
        c === 6 ||
        (r >= cells - 7 && (r === cells - 7 || c === 6)) ||
        (c >= cells - 7 && (c === cells - 7 || r === 6));
      const inCore =
        (r >= 2 && r <= 4 && c >= 2 && c <= 4) ||
        (r >= 2 && r <= 4 && c >= cells - 5 && c <= cells - 3) ||
        (r >= cells - 5 && r <= cells - 3 && c >= 2 && c <= 4);
      bits.push(inRing || inCore);
    } else {
      bits.push(h % 3 !== 0);
    }
  }

  const qr = (
    <svg
      viewBox={`0 0 ${cells} ${cells}`}
      width={size}
      height={size}
      role="img"
      aria-label={`Código QR ${shortCode}`}
      className="bg-white"
    >
      {bits.map((on, i) =>
        on ? (
          <rect key={i} x={i % cells} y={Math.floor(i / cells)} width={1} height={1} fill="#000" />
        ) : null,
      )}
    </svg>
  );

  if (bare) {
    return (
      <div className="inline-flex flex-col items-center gap-3">
        <div className="rounded-xl bg-white p-3">{qr}</div>
        <p className="font-mono text-xl font-extrabold tracking-[0.14em] text-on-dark">{shortCode}</p>
      </div>
    );
  }

  return (
    <div className="inline-flex flex-col items-center gap-4 rounded-card border border-line bg-white p-5 sm:flex-row sm:items-center">
      {qr}
      <div className="text-left">
        <p className="text-sm text-graphite">Código</p>
        <p className="font-mono text-2xl font-bold tracking-widest text-ink">{shortCode}</p>
      </div>
    </div>
  );
}
