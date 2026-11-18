/**
 * REVISION-23 R3 — OTP usa o mesmo transporte SMTP con AUTH que mail.ts.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";

describe("REVISION-23 R3 OTP SMTP auth", () => {
  const prev = { ...process.env };
  let server: net.Server;
  let port = 0;
  let sawAuth = false;
  let mailFromAuth = false;

  before(async () => {
    server = net.createServer((sock) => {
      let buf = "";
      let stage = 0;
      sock.write("220 test-smtp ESMTP\r\n");
      sock.on("data", (d) => {
        buf += d.toString("utf8");
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const u = line.toUpperCase();
          if (u.startsWith("EHLO") || u.startsWith("HELO")) {
            sock.write("250-localhost\r\n250-AUTH LOGIN PLAIN\r\n250 OK\r\n");
          } else if (u.startsWith("AUTH")) {
            sawAuth = true;
            sock.write("235 Authentication successful\r\n");
          } else if (u.startsWith("MAIL FROM")) {
            mailFromAuth = sawAuth;
            if (!sawAuth) {
              sock.write("530 Authentication required\r\n");
            } else {
              sock.write("250 OK\r\n");
            }
          } else if (u.startsWith("RCPT")) {
            sock.write("250 OK\r\n");
          } else if (u.startsWith("DATA")) {
            sock.write("354 End data\r\n");
            stage = 1;
          } else if (stage === 1 && line === ".") {
            sock.write("250 OK\r\n");
            stage = 0;
          } else if (u.startsWith("QUIT")) {
            sock.write("221 Bye\r\n");
            sock.end();
          } else if (u) {
            sock.write("250 OK\r\n");
          }
        }
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") port = addr.port;
        resolve();
      });
    });
  });

  after(async () => {
    process.env = prev;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("buildSmtpTransportOptions inclúe auth e secure en 465", async () => {
    process.env.SMTP_HOST = "smtp.example";
    process.env.SMTP_PORT = "465";
    process.env.SMTP_USER = "user@concello.gal";
    process.env.SMTP_PASS = "secret";
    const { buildSmtpTransportOptions, resetMailTransport } = await import(
      "../notify/mail.js"
    );
    resetMailTransport();
    const opts = buildSmtpTransportOptions();
    assert.ok(opts);
    assert.equal(opts!.secure, true);
    assert.deepEqual(opts!.auth, { user: "user@concello.gal", pass: "secret" });
  });

  it("sendMail autenticase contra SMTP que esixe AUTH", async () => {
    sawAuth = false;
    mailFromAuth = false;
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = String(port);
    process.env.SMTP_USER = "otp-user";
    process.env.SMTP_PASS = "otp-pass";
    process.env.SMTP_FROM = "noreply@test.local";
    process.env.SMTP_SECURE = "0";
    delete process.env.NODE_ENV;
    const { sendMail, resetMailTransport } = await import("../notify/mail.js");
    resetMailTransport();
    const ok = await sendMail({
      to: "persoa@concello.gal",
      subject: "Código de acceso · Pista Aberta",
      text: "O teu código é 123456",
    });
    assert.equal(ok, true);
    assert.equal(sawAuth, true);
    assert.equal(mailFromAuth, true);
  });
});
