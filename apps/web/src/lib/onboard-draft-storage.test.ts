import assert from "node:assert/strict";
import test from "node:test";
import {
  loadOnboardDraft,
  ONBOARD_DRAFT_KEY,
  removeOnboardDraft,
  saveOnboardDraft,
} from "./onboard-draft-storage";

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

test("onboarding drafts stay in session storage and clear legacy local data", () => {
  const session = new MemoryStorage();
  const local = new MemoryStorage();
  local.setItem(
    ONBOARD_DRAFT_KEY,
    JSON.stringify({ adminEmail: "old@example.test", adminNif: "12345678Z" }),
  );

  saveOnboardDraft(
    { step: 4, adminEmail: "new@example.test", adminNif: "87654321X" },
    session,
  );
  const draft = loadOnboardDraft(
    () => ({ step: 1, adminEmail: "", adminNif: "" }),
    session,
    local,
  );

  assert.deepEqual(draft, {
    step: 4,
    adminEmail: "new@example.test",
    adminNif: "87654321X",
  });
  assert.equal(local.getItem(ONBOARD_DRAFT_KEY), null);
});

test("invalid session data falls back without exposing the legacy draft", () => {
  const session = new MemoryStorage();
  const local = new MemoryStorage();
  session.setItem(ONBOARD_DRAFT_KEY, "{invalid");
  local.setItem(ONBOARD_DRAFT_KEY, JSON.stringify({ adminNif: "12345678Z" }));

  const draft = loadOnboardDraft(
    () => ({ step: 1, adminNif: "" }),
    session,
    local,
  );

  assert.deepEqual(draft, { step: 1, adminNif: "" });
  assert.equal(local.getItem(ONBOARD_DRAFT_KEY), null);
});

test("removeOnboardDraft clears both current and legacy storage", () => {
  const session = new MemoryStorage();
  const local = new MemoryStorage();
  session.setItem(ONBOARD_DRAFT_KEY, "{}");
  local.setItem(ONBOARD_DRAFT_KEY, "{}");

  removeOnboardDraft(session, local);

  assert.equal(session.getItem(ONBOARD_DRAFT_KEY), null);
  assert.equal(local.getItem(ONBOARD_DRAFT_KEY), null);
});
