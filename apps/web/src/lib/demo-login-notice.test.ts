import assert from "node:assert/strict";
import test from "node:test";
import i18next from "i18next";
import gl from "../i18n/gl.json" with { type: "json" };
import es from "../i18n/es.json" with { type: "json" };
import {
  formatDemoLoginNotice,
  isDemoLoginNoticeCode,
} from "./demo-login-notice";

async function makeT(lng: "gl" | "es") {
  const inst = i18next.createInstance();
  await inst.init({
    lng,
    fallbackLng: "gl",
    interpolation: { escapeValue: false },
    resources: {
      gl: { translation: gl },
      es: { translation: es },
    },
  });
  return inst.getFixedT(lng);
}

test("DEMO_USERS_FILE avisos gl/es para concello_non_creado e club_non_creado", async () => {
  assert.equal(isDemoLoginNoticeCode("concello_non_creado"), true);
  assert.equal(isDemoLoginNoticeCode("club_non_creado"), true);
  assert.equal(isDemoLoginNoticeCode("outro"), false);

  const tGl = await makeT("gl");
  const tEs = await makeT("es");

  assert.match(
    formatDemoLoginNotice(tGl, "concello_non_creado").toLowerCase(),
    /o concello aínda non está creado/,
  );
  assert.match(
    formatDemoLoginNotice(tEs, "concello_non_creado").toLowerCase(),
    /concello aún no está creado/,
  );

  assert.match(
    formatDemoLoginNotice(tGl, "club_non_creado").toLowerCase(),
    /o club aínda non está creado/,
  );
  assert.match(
    formatDemoLoginNotice(tEs, "club_non_creado").toLowerCase(),
    /club aún no está creado/,
  );
});
