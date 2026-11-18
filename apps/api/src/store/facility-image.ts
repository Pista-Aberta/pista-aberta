/**
 * REVISION-28 X10 — validar e redimensionar fotos de instalación.
 */
const MAX_CHARS = 700_000;
const MAX_EDGE = 1600;

function magicOk(buf: Buffer, kind: string): boolean {
  if (kind === "jpeg") return buf[0] === 0xff && buf[1] === 0xd8;
  if (kind === "png")
    return (
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47
    );
  if (kind === "webp")
    return (
      buf.toString("ascii", 0, 4) === "RIFF" &&
      buf.toString("ascii", 8, 12) === "WEBP"
    );
  return false;
}

/** data:image/jpeg|png|webp → data URL (≤1600 px se sharp está dispoñíbel). */
export async function normalizeFacilityImage(input: string): Promise<string> {
  const trimmed = input.trim();
  const m = trimmed.match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!m) throw new Error("bad_image");
  if (trimmed.length > MAX_CHARS) throw new Error("photo_too_big");
  const kind = m[1]!.toLowerCase() === "jpg" ? "jpeg" : m[1]!.toLowerCase();
  const b64 = m[2]!.replace(/\s+/g, "");
  const buf = Buffer.from(b64, "base64");
  if (!buf.length || !magicOk(buf, kind)) throw new Error("bad_image");

  try {
    const sharp = (await import("sharp")).default;
    /* REVISION-46 D3: recorte 16:9, máx 1600 de ancho; sharp reencode quita EXIF/GPS. */
    const out = await sharp(buf)
      .rotate()
      .resize({
        width: MAX_EDGE,
        height: Math.round((MAX_EDGE * 9) / 16),
        fit: "cover",
        position: "centre",
        withoutEnlargement: false,
      })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    return `data:image/jpeg;base64,${out.toString("base64")}`;
  } catch {
    return `data:image/${kind};base64,${b64}`;
  }
}

export function parseFacilityImageDataUrl(
  dataUrl: string,
): { mime: string; body: Buffer } | null {
  const m = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/i);
  if (!m) return null;
  return { mime: m[1]!.toLowerCase(), body: Buffer.from(m[2]!, "base64") };
}
