import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  comoChegarHintLine,
  hasComoChegarContent,
  mobileMapUrl,
  osmDirectionsUrl,
} from "@pista-aberta/shared";
import { comoChegarMailBlock } from "../notify/emails/como-chegar-block.js";
import { buildEmailContext } from "../notify/emails/context.js";
import type { Municipality } from "@pista-aberta/shared";

const muni = {
  id: "muni-exemplo",
  slug: "exemplo",
  name: "Concello de Exemplo",
  accentColor: "#00527F",
  locales: ["gl", "es"],
  settings: {},
} as Municipality;

describe("como chegar", () => {
  it("mobileMapUrl: Android geo, iOS Apple, else OSM", () => {
    assert.match(
      mobileMapUrl(42.785, -8.888, "Pádel Exemplo", "Mozilla/5.0 (Linux; Android 14)"),
      /^geo:42\.785,-8\.888\?q=42\.785,-8\.888\(/,
    );
    assert.equal(
      mobileMapUrl(42.785, -8.888, "Pádel", "iPhone"),
      "https://maps.apple.com/?daddr=42.785,-8.888",
    );
    assert.equal(
      mobileMapUrl(42.785, -8.888, "Pádel", "Mozilla/5.0"),
      osmDirectionsUrl(42.785, -8.888),
    );
  });

  it("hint line prefer entrance over parking", () => {
    assert.equal(
      comoChegarHintLine({
        entranceInfo: "Porta principal",
        parkingInfo: "Aparcadoiro",
      }),
      "Entrada: Porta principal",
    );
    assert.equal(
      comoChegarHintLine({ parkingInfo: "Aparcadoiro lateral" }, "es"),
      "Aparcamiento: Aparcadoiro lateral",
    );
    assert.equal(comoChegarHintLine({}), null);
  });

  it("mail block ten botón e liña", () => {
    const ctx = buildEmailContext({ muni, locale: "gl" });
    const { html, textParts } = comoChegarMailBlock(ctx, "gl", {
      facilityName: "Pavillón",
      facilityLat: 42.788,
      facilityLng: -8.885,
      entranceInfo: "Porta principal",
    });
    assert.match(html, /Como chegar/);
    assert.match(html, /openstreetmap\.org\/directions/);
    assert.match(html, /Entrada: Porta principal/);
    assert.ok(textParts.some((p) => p.includes("Entrada")));
  });

  it("hasComoChegarContent con só mapa", () => {
    assert.equal(
      hasComoChegarContent({}, { lat: 42.78, lng: -8.88 }),
      true,
    );
    assert.equal(hasComoChegarContent({}), false);
  });
});
