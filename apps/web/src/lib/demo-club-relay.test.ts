import assert from "node:assert/strict";
import test from "node:test";
import { resolveDemoClubRelayPath } from "./demo-club-relay";

test("club relay: sen clubName vai á listaxe de clubs do concello", () => {
  assert.equal(
    resolveDemoClubRelayPath("costa-demo", null, [
      { id: "club-x", name: "Outro" },
    ]),
    "/c/costa-demo/clubs",
  );
});

test("club relay: con clubName existente vai ao portal dese club", () => {
  assert.equal(
    resolveDemoClubRelayPath(
      "riba-demo",
      "Riba Demo FS",
      [
        { id: "club-abc", name: "Riba Demo FS", shortName: "Riba FS" },
        { id: "club-other", name: "Outro" },
      ],
    ),
    "/c/riba-demo/clubs/club-abc",
  );
});

test("club relay: con clubName sen club creado aínda vai a /clubs", () => {
  assert.equal(
    resolveDemoClubRelayPath("riba-demo", "Riba Demo FS", []),
    "/c/riba-demo/clubs",
  );
});

test("club relay: nunca usa club-basquet por defecto", () => {
  const path = resolveDemoClubRelayPath("x", "Algo", []);
  assert.doesNotMatch(path, /club-basquet/);
});
