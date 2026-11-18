import assert from "node:assert/strict";
import test from "node:test";
import {
  detectInstallAppState,
  isInstallDismissed,
} from "./install-app-detect";

test("detector: installed por display-mode standalone", () => {
  assert.equal(
    detectInstallAppState({
      userAgent: "Mozilla/5.0",
      displayMode: "standalone",
    }),
    "installed",
  );
});

test("detector: installed por navigator.standalone (iOS)", () => {
  assert.equal(
    detectInstallAppState({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      iosStandalone: true,
    }),
    "installed",
  );
});

test("detector: prompt cando hai beforeinstallprompt", () => {
  assert.equal(
    detectInstallAppState({
      userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/120",
      hasInstallPrompt: true,
    }),
    "prompt",
  );
});

test("detector: ios Safari sen prompt", () => {
  assert.equal(
    detectInstallAppState({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    }),
    "ios",
  );
});

test("detector: inapp Instagram", () => {
  assert.equal(
    detectInstallAppState({
      userAgent: "Mozilla/5.0 Instagram 300.0.0",
      hasInstallPrompt: true,
    }),
    "inapp",
  );
});

test("detector: none en escritorio sen prompt", () => {
  assert.equal(
    detectInstallAppState({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/120",
    }),
    "none",
  );
});

test("dismiss 30 días", () => {
  const now = 1_700_000_000_000;
  assert.equal(isInstallDismissed(now, null), false);
  assert.equal(isInstallDismissed(now, now + 1000), true);
  assert.equal(isInstallDismissed(now, now - 1), false);
});
