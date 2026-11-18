import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import {
  buildMunicipalityIconPng,
  muniIconCacheKey,
} from "./muni-icon-png.js";

/** PNG 64×64 verde sólido → data URL. */
async function greenLogoDataUrl(): Promise<string> {
  const buf = await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 3,
      background: { r: 0, g: 200, b: 0 },
    },
  })
    .png()
    .toBuffer();
  return `data:image/png;base64,${buf.toString("base64")}`;
}

async function centerPixel(
  png: Buffer,
): Promise<{ r: number; g: number; b: number }> {
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const x = Math.floor(info.width / 2);
  const y = Math.floor(info.height / 2);
  const i = (y * info.width + x) * info.channels;
  return { r: data[i]!, g: data[i + 1]!, b: data[i + 2]! };
}

describe("muni-icon-png", () => {
  it("con logo 512: o pixel do centro non é o cadrado de cor (é o logo)", async () => {
    const logoDataUrl = await greenLogoDataUrl();
    const png = await buildMunicipalityIconPng({
      size: 512,
      brandHex: "#AA0000",
      logoDataUrl,
      initial: "N",
    });
    assert.ok(png.length > 100);
    assert.equal(png[0], 0x89);
    assert.equal(png[1], 0x50);
    const c = await centerPixel(png);
    /* Logo verde centrado — non vermello de marca nin bóla hash. */
    assert.ok(c.g > 150, `expected green center, got ${JSON.stringify(c)}`);
    assert.ok(c.r < 80, `center should not be brand red: ${JSON.stringify(c)}`);
  });

  it("sen logo: PNG válido (escudo ShieldMark, non cadrado+bóla)", async () => {
    const png = await buildMunicipalityIconPng({
      size: 192,
      brandHex: "#002B4A",
      logoDataUrl: null,
      initial: "N",
    });
    assert.ok(png.length > 100);
    assert.equal(png[0], 0x89);
    assert.equal(png[1], 0x50);
    const meta = await sharp(png).metadata();
    assert.equal(meta.width, 192);
    assert.equal(meta.height, 192);
    assert.equal(meta.format, "png");
    /* O centro pode ser a letra branca; amostra un pouco arriba (corpo do escudo). */
    const { data, info } = await sharp(png)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const x = Math.floor(info.width / 2);
    const y = Math.floor(info.height * 0.35);
    const i = (y * info.width + x) * info.channels;
    const c = { r: data[i]!, g: data[i + 1]!, b: data[i + 2]! };
    assert.ok(
      c.r + c.g + c.b < 400,
      `shield body should be darkish, got ${JSON.stringify(c)}`,
    );
  });

  it("apple-touch 180: PNG opaco (sen alpha útil)", async () => {
    const png = await buildMunicipalityIconPng({
      size: 180,
      brandHex: "#007BC4",
      initial: "P",
      apple: true,
    });
    const meta = await sharp(png).metadata();
    assert.equal(meta.width, 180);
    assert.equal(meta.height, 180);
    /* flatten → tipicamente sen canal alpha ou alpha=255 en todos. */
    assert.ok(meta.hasAlpha !== true || meta.channels === 3);
  });

  it("muniIconCacheKey cambia co logo", () => {
    const a = muniIconCacheKey("data:image/png;base64,aaa", "#001", "N");
    const b = muniIconCacheKey("data:image/png;base64,bbb", "#001", "N");
    assert.notEqual(a, b);
    assert.equal(a.length, 12);
  });
});
