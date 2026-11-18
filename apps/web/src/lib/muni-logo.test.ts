import assert from "node:assert/strict";
import test from "node:test";
import { municipalityCrestSrc } from "./muni-logo";

test("municipalityCrestSrc: prefire logoUrl público a logoDataUrl", () => {
  assert.equal(
    municipalityCrestSrc({
      settings: {
        logoUrl: "/api/c/exemplo/logo?v=abc",
        logoDataUrl: "data:image/png;base64,xxx",
      },
    }),
    "/api/c/exemplo/logo?v=abc",
  );
});

test("municipalityCrestSrc: sen logo devolve null (sen inventar slug primario)", () => {
  assert.equal(municipalityCrestSrc({ settings: {} }), null);
  assert.equal(municipalityCrestSrc({ settings: { logoUrl: null } }), null);
  assert.equal(municipalityCrestSrc({ settings: { logoUrl: "  " } }), null);
  assert.equal(municipalityCrestSrc({}), null);
});

test("municipalityCrestSrc: usa logoDataUrl se non hai logoUrl", () => {
  assert.equal(
    municipalityCrestSrc({
      settings: { logoDataUrl: "data:image/svg+xml;base64,abc" },
    }),
    "data:image/svg+xml;base64,abc",
  );
});
