/**
 * CORREOS §3.9 — snapshots GL/ES, sen data:/flex, tamaño, baixa, contraste, remitente.
 * REVISION-35 G1/G5/G7 — HTML válido, privacidade, .ics propio.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { contrastRatio, type Municipality } from "@pista-aberta/shared";
import { renderEmail } from "./layout.js";
import { emailButtonBg } from "./context.js";
import { prepareMail } from "../mail.js";

/** Detecta `<tr>` dentro dun `<td>`/`<th>` sen `<table>` intermedio (G1). */
function assertNoBareTrInTd(html: string): void {
  const re = /<\/?([a-zA-Z0-9]+)(?:\s[^>]*)?>/g;
  const stack: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const full = m[0];
    const tag = (m[1] ?? "").toLowerCase();
    if (full.startsWith("</")) {
      const idx = stack.lastIndexOf(tag);
      if (idx >= 0) stack.splice(idx);
      continue;
    }
    if (full.endsWith("/>")) continue;
    if (tag === "tr") {
      for (let i = stack.length - 1; i >= 0; i--) {
        const open = stack[i]!;
        if (open === "table") break;
        if (open === "td" || open === "th") {
          assert.fail(
            `HTML inválido: <tr> dentro de <${open}> sen <table> (offset ${m.index})`,
          );
        }
      }
    }
    if (
      tag === "table" ||
      tag === "thead" ||
      tag === "tbody" ||
      tag === "tfoot" ||
      tag === "tr" ||
      tag === "td" ||
      tag === "th"
    ) {
      stack.push(tag);
    }
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-correos-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-secret-correos-html";
process.env.APP_BASE_URL = "https://demo.pistaaberta.com";
process.env.SMTP_FROM = "noreply@pistaaberta.local";
process.env.PA_DEMO = "1";

const muni: Municipality = {
  id: "muni-exemplo",
  slug: "exemplo",
  name: "Concello de Exemplo",
  accentColor: "#5A4636",
  locales: ["gl", "es"],
  settings: {
    maxHoursPerWeek: 4,
    bookingAntelationDays: 7,
    theme: { brand: "#5A4636", accent: "#C4A574" },
    legal: {
      titular: "Concello de Exemplo",
      address: "Praza do Tapal, 1",
      email: "deportes@exemplo.gal",
      sinatura: "Servizo Municipal de Deportes",
    },
  },
};

/** Concello con brand moi claro → botón cae a marino. */
const muniClaro: Municipality = {
  ...muni,
  id: "muni-claro",
  slug: "claro",
  name: "Concello Claro",
  accentColor: "#EEEEEE",
  settings: {
    ...muni.settings,
    theme: { brand: "#EEEEEE", accent: "#DDDDDD" },
    legal: { ...muni.settings.legal, email: "info@claro.gal" },
  },
};

const bookingData = {
  userName: "Ana",
  sport: "Pádel",
  facilityName: "Pistas de pádel",
  facilityId: "fac-1",
  dayLabel: "mér 28",
  timeLabel: "18:00",
  date: "2026-10-28",
  start: "18:00",
  end: "19:00",
  shortCode: "PA-7K2M",
  qrPayload: "id|2026-10-28|PA-7K2M|sig",
  bookingId: "bk-1",
  icsSequence: 0,
  unsubscribeUrl: "https://demo.pistaaberta.com/api/avisos/baixa?token=abc",
};

const kinds = [
  "booking_confirmed",
  "booking_pending",
  "booking_approved",
  "booking_rejected",
  "reminder",
  "booking_changed",
  "booking_cancelled",
  "facility_closure",
  "waitlist_offer",
  "no_show_warning",
  "no_show_pause",
  "pause_lifted",
  "otp",
  "match_cancelled",
  "match_moved",
  "season_approved",
  "season_rejected",
  "club_counter",
  "invite_staff",
  "invite_deputacion",
] as const;

function dataFor(kind: (typeof kinds)[number]): Record<string, unknown> {
  switch (kind) {
    case "booking_confirmed":
    case "booking_approved":
      return bookingData;
    case "booking_pending":
      return {
        userName: "Ana",
        sport: "Pádel",
        facilityName: "Pistas",
        dayLabel: "mér 28",
        timeLabel: "18:00",
        bookingId: "bk-1",
        unsubscribeUrl: bookingData.unsubscribeUrl,
      };
    case "booking_rejected":
      return {
        userName: "Ana",
        sport: "Pádel",
        facilityName: "Pistas",
        dayLabel: "mér 28",
        timeLabel: "18:00",
        reason: "Horario reservado para escola",
        unsubscribeUrl: bookingData.unsubscribeUrl,
      };
    case "reminder":
      return {
        userName: "Ana",
        facilityName: "Pistas",
        facilityAddress: "Praza do Tapal, 1",
        dayLabel: "mér 28",
        timeLabel: "18:00–19:00",
        date: "2026-10-28",
        start: "18:00",
        end: "19:00",
        bookingId: "bk-1",
        window: "24h",
        antesDeIr: ["Cancela ata 2 h antes"],
        unsubscribeUrl: bookingData.unsubscribeUrl,
      };
    case "booking_changed":
      return {
        userName: "Ana",
        facilityName: "Pistas",
        unitName: "Pista 1",
        facilityAddress: "Praza do Tapal, 1",
        beforeLabel: "mér 28, 17:00",
        afterDayLabel: "mér 28",
        afterTimeLabel: "18:00",
        date: "2026-10-28",
        start: "18:00",
        end: "19:00",
        shortCode: "PA-7K2M",
        bookingId: "bk-1",
        icsSequence: 1,
        unsubscribeUrl: bookingData.unsubscribeUrl,
      };
    case "booking_cancelled":
    case "facility_closure":
      return {
        userName: "Ana",
        sport: "Pádel",
        facilityName: "Pistas",
        facilityId: "fac-1",
        dayLabel: "mér 28",
        timeLabel: "18:00",
        date: "2026-10-28",
        start: "18:00",
        end: "19:00",
        bookingId: "bk-1",
        unsubscribeUrl: bookingData.unsubscribeUrl,
      };
    case "waitlist_offer":
      return {
        userName: "Ana",
        sport: "Pádel",
        facilityName: "Pistas",
        facilityId: "fac-1",
        dayLabel: "mér 28",
        timeLabel: "18:00",
        date: "2026-10-28",
        slotId: "slot-1",
        holdUntilLabel: "18:30",
        declineUrl: "/c/exemplo/reservas?deixar=slot-1",
        unsubscribeUrl: bookingData.unsubscribeUrl,
      };
    case "no_show_warning":
      return {
        userName: "Ana",
        count: 2,
        limit: 3,
        windowDays: 30,
        penaltyDays: 7,
      };
    case "no_show_pause":
      return { userName: "Ana", untilLabel: "12 nov" };
    case "pause_lifted":
      return { userName: "Ana" };
    case "otp":
      return { code: "123456" };
    case "match_cancelled":
      return {
        userName: "Club",
        clubName: "Club Deportivo Exemplo",
        dayLabel: "sáb 1",
        clubId: "club-1",
        unsubscribeUrl: bookingData.unsubscribeUrl,
      };
    case "match_moved":
      return {
        userName: "Club",
        clubName: "Club Deportivo Exemplo",
        clubId: "club-1",
        homeTeam: "CD Exemplo Cadete",
        awayTeam: "CD Visitante A",
        dayLabel: "sáb 14",
        start: "18:00",
        end: "19:30",
        date: "2026-11-14",
        courtName: "pista completa",
        facilityName: "Pavillón",
        matchId: "m5",
        icsSequence: 1,
        unsubscribeUrl: bookingData.unsubscribeUrl,
      };
    case "season_approved":
    case "season_rejected":
      return {
        userName: "Club",
        clubName: "Club Deportivo Exemplo",
        clubId: "club-1",
        reason: "Sen horas libres",
        unsubscribeUrl: bookingData.unsubscribeUrl,
      };
    case "club_counter":
      return {
        userName: "Club",
        clubName: "Club Deportivo Exemplo",
        clubId: "club-1",
        askedLabel: "mércores 20:00–21:30, Pavillón, pista A",
        whenLabel: "venres 10:00–11:30, Pavillón, pista A",
        unsubscribeUrl: bookingData.unsubscribeUrl,
      };
    case "invite_staff":
      return {
        inviterName: "Admin",
        roleLabel: "conserxaría",
        acceptUrl: "/convite/tok",
        expiresLabel: "12 nov 2026",
        nif: "12345678Z",
      };
    case "invite_deputacion":
      return {
        variant: "muni_admin",
        acceptUrl: "/convite/tok",
        expiresLabel: "12 nov 2026",
        nif: "12345678Z",
        concelloName: "Concello de Exemplo",
      };
    default: {
      const _e: never = kind;
      throw new Error(String(_e));
    }
  }
}

describe("CORREOS render", () => {
  before(() => {
    fs.mkdirSync(tmp, { recursive: true });
  });
  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  for (const locale of ["gl", "es"] as const) {
    for (const kind of kinds) {
      it(`${kind} ${locale}: HTML seguro e <100 KB`, async () => {
        const rendered = await renderEmail({
          muni: kind === "otp" ? null : muni,
          locale,
          kind,
          data: dataFor(kind),
        });
        assert.ok(rendered.subject.length > 3);
        assert.ok(rendered.html.includes("<table"));
        assert.ok(rendered.text.length > 10);
        assert.doesNotMatch(rendered.html, /data:/i);
        assert.doesNotMatch(rendered.html, /display\s*:\s*flex/i);
        assert.doesNotMatch(rendered.html, /display\s*:\s*grid/i);
        const bytes = Buffer.byteLength(rendered.html, "utf8");
        assert.ok(bytes < 100_000, `html ${bytes} bytes`);
        assert.match(rendered.html, /max-width:600px/);
        if (rendered.footerKind === "A") {
          assert.ok(
            rendered.html.includes("baixa") ||
              rendered.html.includes("avisos") ||
              rendered.notifyType !== null,
          );
        }
        const abs = rendered.html.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
        for (const u of abs) {
          assert.ok(
            u.startsWith("https://demo.pistaaberta.com") || u.startsWith("cid:"),
            u,
          );
        }
        /* REVISION-35 G1: sen <tr> directo dentro dun <td> sen <table>. */
        assertNoBareTrInTd(rendered.html);
      });
    }
  }

  it("G1: as 18 plantillas teñen táboa interior na tarxeta", async () => {
    for (const kind of kinds) {
      const rendered = await renderEmail({
        muni: kind === "otp" ? null : muni,
        locale: "gl",
        kind,
        data: dataFor(kind),
      });
      assertNoBareTrInTd(rendered.html);
    }
  });

  it("G5: Privacidade apunta a /legal/privacidade", async () => {
    const rendered = await renderEmail({
      muni,
      locale: "gl",
      kind: "booking_confirmed",
      data: dataFor("booking_confirmed"),
    });
    assert.match(
      rendered.html,
      /https:\/\/demo\.pistaaberta\.com\/c\/exemplo\/legal\/privacidade/,
    );
    assert.doesNotMatch(
      rendered.html,
      /\/c\/exemplo\/privacidade["'\s>]/,
    );
  });

  it("G7/G9/I1/I8: calendario /calendario.ics e botón secundario coa cor do concello", async () => {
    const rendered = await renderEmail({
      muni,
      locale: "gl",
      kind: "booking_confirmed",
      data: dataFor("booking_confirmed"),
    });
    assert.match(
      rendered.html,
      /\/api\/c\/exemplo\/reservas\/bk-1\/calendario\.ics\?t=/,
    );
    assert.doesNotMatch(rendered.html, /reservas\/bk-1\.ics/);
    assert.doesNotMatch(rendered.html, /calendar\.google\.com/);
    /* Exemplo brand #5A4636 (contraste OK) → borde/texto do secundario */
    assert.match(rendered.html, /border:2px solid #5A4636/);
  });

  it("G6/I5/I6: convite Deputación — título deseño 13, saúdo, privacidade /legal/", async () => {
    const rendered = await renderEmail({
      muni: {
        ...muni,
        id: "muni-deputacion-platform",
        slug: "_deputacion",
        name: "Deputación (plataforma)",
        settings: { ...muni.settings, deputacionPlatform: true },
      },
      locale: "gl",
      kind: "invite_deputacion",
      data: {
        variant: "deputacion_manager",
        acceptUrl: "/convite/tok",
        expiresLabel: "12 nov 2026",
        concelloName: "Deputación de proba",
        inviteeName: "Carla",
      },
    });
    assert.doesNotMatch(rendered.html, /plataforma/i);
    assert.match(rendered.html, /Deputación de proba/);
    assert.match(rendered.html, /Ola, Carla/);
    assert.match(rendered.html, /Convidámoste á xestión da Deputación de proba/);
    assert.match(
      rendered.html,
      /https:\/\/demo\.pistaaberta\.com\/legal\/privacidade/,
    );
    assert.doesNotMatch(rendered.html, /\/c\/_deputacion\/legal\/privacidade/);
    /* Caducidade na caixa de axuda, non na tarxeta (o preheader oculto pode repetila). */
    assert.doesNotMatch(
      rendered.html,
      /text-transform:uppercase[^<]*Caduca|Caduca<\/td>/i,
    );
    assert.match(rendered.html, /Caduca o 12 nov/);
  });

  it("I5: as 18 plantillas teñen ligazón de privacidade resoluble", async () => {
    for (const kind of kinds) {
      const rendered = await renderEmail({
        muni: kind === "otp" ? null : muni,
        locale: "gl",
        kind,
        data: dataFor(kind),
      });
      assert.match(
        rendered.html,
        /href="https:\/\/demo\.pistaaberta\.com\/(?:c\/exemplo\/)?legal\/privacidade"/,
        `privacidade en ${kind}`,
      );
    }
  });

  it("baixa / List-Unsubscribe só tipo A", async () => {
    const a = await renderEmail({
      muni,
      locale: "gl",
      kind: "booking_confirmed",
      data: dataFor("booking_confirmed"),
    });
    const t = await renderEmail({
      muni: null,
      locale: "gl",
      kind: "otp",
      data: { code: "888888" },
    });
    assert.equal(a.footerKind, "A");
    assert.equal(t.footerKind, "T");
    const prepA = prepareMail({
      to: "a@b.c",
      subject: a.subject,
      text: a.text,
      html: a.html,
      unsubscribeUrl: bookingData.unsubscribeUrl,
      fromName: a.fromName,
      replyTo: a.replyTo,
    });
    assert.ok(prepA.headers["List-Unsubscribe"]);
    const prepT = prepareMail({
      to: "a@b.c",
      subject: t.subject,
      text: t.text,
      html: t.html,
      fromName: t.fromName,
    });
    assert.equal(prepT.headers["List-Unsubscribe"], undefined);
  });

  it("contraste botón: brand claro → marino", () => {
    const bg = emailButtonBg("#EEEEEE");
    assert.equal(bg, "#002B4A");
    assert.ok(contrastRatio(bg, "#FFFFFF") >= 4.5);
    const ok = emailButtonBg("#5A4636");
    assert.equal(ok, "#5A4636");
  });

  it("remitente co nome do concello e Reply-To legal", async () => {
    const rendered = await renderEmail({
      muni,
      locale: "gl",
      kind: "booking_confirmed",
      data: dataFor("booking_confirmed"),
    });
    assert.equal(rendered.fromName, "Concello de Exemplo · Reservas");
    assert.equal(rendered.replyTo, "deportes@exemplo.gal");
    const prep = prepareMail({
      to: "a@b.c",
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      fromName: rendered.fromName,
      replyTo: rendered.replyTo,
    });
    assert.match(prep.from, /Concello de Exemplo · Reservas/);
    assert.equal(prep.replyTo, "deportes@exemplo.gal");
  });

  it("confirmación leva QR CID e ICS", async () => {
    const rendered = await renderEmail({
      muni,
      locale: "gl",
      kind: "booking_confirmed",
      data: {
        ...dataFor("booking_confirmed"),
        unitName: "Pista 1",
        facilityAddress: "Praza do Tapal, 1",
        antesDeIr: ["Cancela ata 2 h antes", "Calzado axeitado"],
      },
    });
    assert.ok(rendered.attachments.some((a) => a.cid === "booking-qr"));
    assert.ok(rendered.attachments.some((a) => a.filename === "reserva.ics"));
    assert.match(rendered.html, /cid:booking-qr/);
    /* E5: sen caixa grande do código (codeBlock); só o do QR. */
    assert.doesNotMatch(rendered.html, /letter-spacing:0\.12em/);
    assert.match(rendered.html, /letter-spacing:0\.14em/);
    assert.doesNotMatch(rendered.html, />Código<\/td>/i);
    assert.match(rendered.html, /Antes de ir/);
    assert.match(rendered.html, /Engadir ao calendario|Añadir al calendario/);
    assert.match(rendered.html, /padding:20px/);
    assert.match(rendered.text, /Pista 1|Praza do Tapal|18:00–19:00/);
  });

  it("pílulas propias (E4)", async () => {
    const changed = await renderEmail({
      muni,
      locale: "gl",
      kind: "booking_changed",
      data: dataFor("booking_changed"),
    });
    assert.match(changed.html, /Cambiada/);
    const otp = await renderEmail({
      muni,
      locale: "gl",
      kind: "otp",
      data: dataFor("otp"),
    });
    assert.match(otp.html, />[\s\S]*Código/);
    const lifted = await renderEmail({
      muni,
      locale: "gl",
      kind: "pause_lifted",
      data: dataFor("pause_lifted"),
    });
    assert.match(lifted.html, /Pausa retirada/);
  });

  it("cancelación leva METHOD:CANCEL", async () => {
    const rendered = await renderEmail({
      muni,
      locale: "gl",
      kind: "booking_cancelled",
      data: dataFor("booking_cancelled"),
    });
    const ics = rendered.attachments.find((a) => a.filename.includes("cancel"));
    assert.ok(ics);
    assert.match(ics!.content.toString("utf8"), /METHOD:CANCEL/);
  });

  it("convite enmascara NIF", async () => {
    const rendered = await renderEmail({
      muni,
      locale: "gl",
      kind: "invite_staff",
      data: dataFor("invite_staff"),
    });
    assert.doesNotMatch(rendered.html, /12345678Z/);
    assert.match(rendered.html, /5678Z|···/);
  });

  it("brand claro usa marino no HTML do botón", async () => {
    const rendered = await renderEmail({
      muni: muniClaro,
      locale: "gl",
      kind: "booking_pending",
      data: dataFor("booking_pending"),
    });
    assert.match(rendered.html, /#002B4A/);
  });
});
