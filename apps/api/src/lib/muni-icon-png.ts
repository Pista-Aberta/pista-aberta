/**
 * Iconas PWA 192/512 (maskable) e apple-touch 180.
 * Con logoDataUrl: escudo centrado sobre fondo branco (marxe 20 %).
 * Sen logo: ShieldMark coa inicial (nunca o cadrado de cor + bóla).
 */
import sharp from "sharp";
import { createHash } from "node:crypto";

export type MuniIconSize = 180 | 192 | 512;

function parseDataUrl(dataUrl: string): { mime: string; buf: Buffer } | null {
  const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/i.exec(dataUrl.trim());
  if (!m) return null;
  const mime = (m[1] || "application/octet-stream").toLowerCase();
  const isB64 = !!m[2];
  const payload = m[3] || "";
  try {
    const buf = isB64
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf8");
    return { mime, buf };
  } catch {
    return null;
  }
}

export function muniIconCacheKey(
  logoDataUrl?: string | null,
  brand?: string,
  initial?: string,
): string {
  return createHash("sha1")
    .update((logoDataUrl ?? "") + "|" + (brand ?? "") + "|" + (initial ?? ""))
    .digest("hex")
    .slice(0, 12);
}

/** Mesma silueta ca ShieldMark / escudo-png (viewBox 0 0 40 46). */
function shieldSvg(brandHex: string, letter: string): string {
  const fill = /^#[0-9a-fA-F]{3,8}$/.test(brandHex) ? brandHex : "#002B4A";
  const L = (letter || "?").slice(0, 1).toUpperCase();
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="80" height="92" viewBox="0 0 40 46">
  <path d="M2 2h36v20c0 11-8 19-18 22C10 41 2 33 2 22z" fill="${fill}" stroke="#FFFFFF" stroke-width="2"/>
  <text x="20" y="28" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="700" fill="#FFFFFF">${L}</text>
</svg>`;
}

/**
 * PNG maskable / apple-touch: fondo branco + contido centrado con marxe 20 %.
 * `apple` forza opacidade 1 (sen transparencia) para apple-touch-icon.
 */
export async function buildMunicipalityIconPng(opts: {
  size: MuniIconSize;
  brandHex: string;
  logoDataUrl?: string | null;
  initial?: string;
  /** apple-touch: sen canle alpha. */
  apple?: boolean;
}): Promise<Buffer> {
  const size = opts.size;
  const margin = Math.round(size * 0.2);
  const inner = Math.max(1, size - margin * 2);
  const white = { r: 255, g: 255, b: 255, alpha: 1 };

  const base = sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      background: white,
    },
  });

  let overlay: Buffer | null = null;
  const logo = opts.logoDataUrl?.trim();
  if (logo) {
    const parsed = parseDataUrl(logo);
    if (parsed) {
      try {
        overlay = await sharp(parsed.buf)
          .resize(inner, inner, {
            fit: "contain",
            background: { r: 255, g: 255, b: 255, alpha: 0 },
          })
          .png()
          .toBuffer();
      } catch {
        overlay = null;
      }
    }
  }

  if (!overlay) {
    const svg = Buffer.from(
      shieldSvg(opts.brandHex, opts.initial ?? "?"),
      "utf8",
    );
    overlay = await sharp(svg)
      .resize(inner, inner, {
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 0 },
      })
      .png()
      .toBuffer();
  }

  const composed = await base
    .composite([{ input: overlay, left: margin, top: margin }])
    .png()
    .toBuffer();

  if (opts.apple) {
    /* Sen transparencia: flatten sobre branco. */
    return sharp(composed)
      .flatten({ background: white })
      .png()
      .toBuffer();
  }
  return composed;
}
