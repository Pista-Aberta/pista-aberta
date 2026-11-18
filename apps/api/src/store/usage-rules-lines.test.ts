/**
 * CORREOS §2b / REVISION-35 G2 — normas xeradas; check-in só se checkInRequired.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildAntesDeIrRuleLines,
  buildUsageRulesLines,
  type UsageRules,
} from "@pista-aberta/shared";
import { DEFAULT_USAGE_RULES } from "./rules.js";

describe("buildUsageRulesLines §2b", () => {
  it("default sen checkInRequired: antelación, activas, horas, cancel; sen checkin", () => {
    const lines = buildUsageRulesLines(DEFAULT_USAGE_RULES, "gl");
    const kinds = lines.map((l) => l.kind);
    assert.ok(kinds.includes("antelation"));
    assert.ok(kinds.includes("maxActive"));
    assert.ok(kinds.includes("cancel"));
    assert.ok(!kinds.includes("checkin"));
    assert.ok(!kinds.includes("noShowRelease"));
    assert.ok(!kinds.includes("penalty"));
    assert.ok(!kinds.includes("price"));
    assert.ok(!kinds.includes("approval"));
  });

  it("sen checkInRequired ignora marxes > 0", () => {
    const rules: UsageRules = {
      ...DEFAULT_USAGE_RULES,
      checkInRequired: false,
      checkInMarginMinutes: 30,
      noShowReleaseMinutes: 30,
    };
    const kinds = buildUsageRulesLines(rules, "es").map((l) => l.kind);
    assert.ok(!kinds.includes("checkin"));
    assert.ok(!kinds.includes("noShowRelease"));
  });

  it("check-in + prezo + aprobación só con checkInRequired", () => {
    const rules: UsageRules = {
      ...DEFAULT_USAGE_RULES,
      checkInRequired: true,
      checkInMarginMinutes: 30,
      noShowReleaseMinutes: 20,
      noShowPenaltyCount: 3,
      noShowPenaltyDays: 7,
      noShowPenaltyWindowDays: 30,
      informativePrice: "3 € / hora",
      approvalRequired: true,
    };
    const lines = buildUsageRulesLines(rules, "gl");
    const kinds = lines.map((l) => l.kind);
    assert.ok(kinds.includes("checkin"));
    assert.ok(kinds.includes("noShowRelease"));
    assert.ok(kinds.includes("penalty"));
    assert.ok(kinds.includes("price"));
    assert.ok(kinds.includes("approval"));
    assert.match(lines.find((l) => l.kind === "price")!.text, /3 €/);
    assert.match(
      lines.find((l) => l.kind === "approval")!.text,
      /aprobación/,
    );
  });

  it("Antes de ir: sen antelación / cupos / horas", () => {
    const rules: UsageRules = {
      ...DEFAULT_USAGE_RULES,
      checkInRequired: true,
      informativePrice: "gratuíta",
      noShowPenaltyCount: 3,
      noShowPenaltyDays: 7,
    };
    const kinds = buildAntesDeIrRuleLines(rules, "gl").map((l) => l.kind);
    assert.ok(kinds.includes("cancel"));
    assert.ok(kinds.includes("checkin"));
    assert.ok(kinds.includes("penalty"));
    assert.ok(kinds.includes("price"));
    assert.ok(!kinds.includes("antelation"));
    assert.ok(!kinds.includes("maxActive"));
    assert.ok(!kinds.includes("maxHours"));
    assert.ok(!kinds.includes("approval"));
  });
});
