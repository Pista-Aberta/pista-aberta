import assert from "node:assert/strict";
import test from "node:test";
import type { TFunction } from "i18next";
import { mapApiError } from "./api-error";

function translator(messages: Record<string, string>): TFunction {
  return ((key: string) => messages[key] ?? key) as TFunction;
}

test("mapApiError translates known API error codes", () => {
  const t = translator({
    "error.activity_closed": "A actividade está pechada",
    "common.error": "Produciuse un erro",
  });

  assert.equal(
    mapApiError(t, new Error("activity_closed")),
    "A actividade está pechada",
  );
});

test("mapApiError never exposes unknown raw server errors", () => {
  const t = translator({ "common.error": "Produciuse un erro" });

  assert.equal(
    mapApiError(t, new Error("SQL constraint users_nif_unique failed")),
    "Produciuse un erro",
  );
  assert.equal(mapApiError(t, "raw failure"), "Produciuse un erro");
});

test("mapApiError supports page-specific translation keys", () => {
  const t = translator({
    "onboard.adminNifRequired": "O NIF é obrigatorio",
    "common.error": "Produciuse un erro",
  });

  assert.equal(
    mapApiError(t, new Error("nif_required"), {
      nif_required: "onboard.adminNifRequired",
    }),
    "O NIF é obrigatorio",
  );
});
