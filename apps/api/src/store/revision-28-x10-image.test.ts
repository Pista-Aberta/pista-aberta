/**
 * REVISION-28 X10 — validación de fotos de instalación.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeFacilityImage,
  parseFacilityImageDataUrl,
} from "./facility-image.js";

/** PNG 1×1 */
const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("REVISION-28 X10 facility image", () => {
  it("rexeita texto que non é imaxe", async () => {
    await assert.rejects(
      () => normalizeFacilityImage("hola mundo"),
      /bad_image/,
    );
    await assert.rejects(
      () => normalizeFacilityImage("data:text/plain;base64,YQ=="),
      /bad_image/,
    );
  });

  it("acepta PNG e devolve data URL parseábel", async () => {
    const out = await normalizeFacilityImage(PNG_1X1);
    assert.match(out, /^data:image\/(jpeg|png);base64,/);
    const parsed = parseFacilityImageDataUrl(out);
    assert.ok(parsed);
    assert.ok(parsed!.body.length > 0);
  });
});
