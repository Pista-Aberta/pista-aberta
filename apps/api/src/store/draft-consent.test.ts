/**
 * Borrador reserva + consentimento nome partidos abertos.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { shortPublicName } from "@pista-aberta/shared";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("draft-consent UI + helpers", () => {
  it("shortPublicName formata Ana D. / Luis D.", () => {
    assert.equal(shortPublicName("Ana Demo"), "Ana D.");
    assert.equal(shortPublicName("Luis Demo López"), "Luis D.");
    assert.equal(shortPublicName("Ana Riveira"), "Ana R.");
    assert.equal(shortPublicName("Luis López"), "Luis L.");
  });

  it("ReservePage: garda borrador antes de acceso e non reserva só ao volver", () => {
    const reserve = readFileSync(
      join(root, "apps/web/src/pages/ReservePage.tsx"),
      "utf8",
    );
    const drafts = readFileSync(
      join(root, "apps/web/src/lib/form-drafts.ts"),
      "utf8",
    );
    assert.match(drafts, /RESERVE_DRAFT_TTL_MS\s*=\s*2\s*\*\s*60\s*\*\s*60/);
    assert.match(drafts, /reserveDraftKey/);
    assert.match(reserve, /saveReserveDraft/);
    assert.match(reserve, /loadReserveDraft/);
    assert.match(reserve, /clearReserveDraft/);
    assert.match(reserve, /draftRecovered|reserve\.draftRecovered/);
    assert.match(reserve, /reserve\.identifySavesDraft|identifySavesDraft/);
    /* Non chamar confirm automaticamente tras restaurar. */
    assert.doesNotMatch(
      reserve,
      /loadReserveDraft[\s\S]{0,800}void confirm\(/,
    );
    assert.match(reserve, /nameDisplayConsent/);
    assert.match(reserve, /openMatch\.nameConsent/);
  });

  it("OpenMatchDetail + BookingConfirm esixen consentimento", () => {
    const detail = readFileSync(
      join(root, "apps/web/src/pages/OpenMatchDetailPage.tsx"),
      "utf8",
    );
    const confirm = readFileSync(
      join(root, "apps/web/src/pages/BookingConfirmPage.tsx"),
      "utf8",
    );
    assert.match(detail, /nameDisplayConsent/);
    assert.match(confirm, /nameDisplayConsent/);
  });

  it("form-drafts: TTL 2 h documentado e helper de frescura", () => {
    const drafts = readFileSync(
      join(root, "apps/web/src/lib/form-drafts.ts"),
      "utf8",
    );
    assert.match(drafts, /export function isReserveDraftFresh/);
    assert.match(drafts, /2 \* 60 \* 60 \* 1000/);
    /* Espello da lógica (sen sessionStorage en Node). */
    const TTL = 2 * 60 * 60 * 1000;
    const fresh = (savedAt: number, now: number) => now - savedAt <= TTL;
    const now = 1_700_000_000_000;
    assert.equal(fresh(now, now), true);
    assert.equal(fresh(now - TTL + 1, now), true);
    assert.equal(fresh(now - TTL - 1, now), false);
  });
});
