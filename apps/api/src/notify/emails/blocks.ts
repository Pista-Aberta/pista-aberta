/**
 * Bloques HTML para clientes de correo (táboas, estilos en liña, 600 px).
 * Sen flex/grid nin data:.
 */
import type { EmailBlockContext, EmailPill } from "./types.js";
import { emailT } from "./i18n.js";

const PILL: Record<
  EmailPill,
  { fg: string; bg: string; labelKey: string; icon: string }
> = {
  confirmed: { fg: "#0E6B4D", bg: "#EAF7F1", labelKey: "pill.confirmed", icon: "✓" },
  pending: { fg: "#6B4A00", bg: "#FDF3DD", labelKey: "pill.pending", icon: "…" },
  free: { fg: "#0E6B4D", bg: "#EAF7F1", labelKey: "pill.free", icon: "✓" },
  reminder: { fg: "#00527F", bg: "#E6F2FA", labelKey: "pill.reminder", icon: "⏰" },
  invite: { fg: "#00527F", bg: "#E6F2FA", labelKey: "pill.invite", icon: "✉" },
  warning: { fg: "#6B4A00", bg: "#FDF3DD", labelKey: "pill.warning", icon: "!" },
  closure: { fg: "#6B4A00", bg: "#FDF3DD", labelKey: "pill.closure", icon: "!" },
  cancelled: { fg: "#A32020", bg: "#FBECEC", labelKey: "pill.cancelled", icon: "×" },
  pause: { fg: "#A32020", bg: "#FBECEC", labelKey: "pill.pause", icon: "⏸" },
  /* REVISION-34 E4 — pílulas propias */
  changed: { fg: "#00527F", bg: "#E6F2FA", labelKey: "pill.changed", icon: "↔" },
  code: { fg: "#00527F", bg: "#E6F2FA", labelKey: "pill.code", icon: "#" },
  pause_lifted: { fg: "#0E6B4D", bg: "#EAF7F1", labelKey: "pill.pause_lifted", icon: "✓" },
  season_ok: { fg: "#0E6B4D", bg: "#EAF7F1", labelKey: "pill.season_ok", icon: "✓" },
  season_no: { fg: "#A32020", bg: "#FBECEC", labelKey: "pill.season_no", icon: "×" },
};

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function preheaderHidden(text: string): string {
  return `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${esc(text)}${"&nbsp;".repeat(40)}</div>`;
}

export function headerBlock(ctx: EmailBlockContext): string {
  const brand = ctx.isDeputacion || ctx.isPlatform ? "#002B4A" : ctx.brand;
  const accent = ctx.isDeputacion ? "#F2B33D" : ctx.isPlatform ? "#F2B33D" : ctx.accent;
  const name = esc(ctx.concelloName);
  const sub = esc(ctx.headerSubtitle);
  const escudo = ctx.escudoUrl
    ? `<img src="${esc(ctx.escudoUrl)}" width="48" height="48" alt="" style="display:block;border:0;width:48px;height:48px;border-radius:8px" />`
    : `<div style="width:48px;height:48px;border-radius:8px;background:#ffffff;color:${brand};font:800 22px Arial,sans-serif;text-align:center;line-height:48px">${esc(ctx.concelloName.replace(/^Concello de\s+/i, "").charAt(0) || "P")}</div>`;

  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${brand}">
  <tr><td style="padding:20px 24px 16px 24px">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="vertical-align:middle;padding-right:14px">${escudo}</td>
      <td style="vertical-align:middle">
        <div style="font:800 18px Arial,Helvetica,sans-serif;color:#ffffff;line-height:1.2">${name}</div>
        <div style="font:400 14px Arial,Helvetica,sans-serif;color:#E9EEF3;margin-top:2px">${sub}</div>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="height:4px;line-height:4px;font-size:0;background:${accent}">&nbsp;</td></tr>
</table>`;
}

export function pillBlock(ctx: EmailBlockContext, pill: EmailPill): string {
  const p = PILL[pill];
  const label = emailT(ctx.locale, p.labelKey);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 8px 0"><tr>
    <td style="background:${p.bg};color:${p.fg};font:700 13px Arial,Helvetica,sans-serif;padding:6px 12px;border-radius:999px">
      <span aria-hidden="true">${p.icon}</span>&nbsp;${esc(label)}
    </td>
  </tr></table>`;
}

export function titleBlock(title: string, hello?: string): string {
  const h = hello
    ? `<p style="margin:0 0 8px 0;font:400 15px/1.4 Arial,Helvetica,sans-serif;color:#3B4A59">${esc(hello)}</p>`
    : "";
  return `${h}<h1 style="margin:0 0 16px 0;font:800 28px/1.25 Arial,Helvetica,sans-serif;color:#0F1E2C">${esc(title)}</h1>`;
}

export function bodyText(paragraphs: string[]): string {
  return paragraphs
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 14px 0;font:400 17px/1.5 Arial,Helvetica,sans-serif;color:#0F1E2C">${esc(p)}</p>`,
    )
    .join("");
}

export function dataCard(
  ctx: EmailBlockContext,
  rows: { label: string; value: string }[],
): string {
  const inner = rows
    .map(
      (r, i) => `<tr>
      <td style="padding:${i === 0 ? "0" : "10px"} 0 0 0;font:700 12px Arial,Helvetica,sans-serif;color:#3B4A59;text-transform:uppercase;letter-spacing:0.04em">${esc(r.label)}</td>
    </tr>
    <tr>
      <td style="padding:2px 0 ${i === rows.length - 1 ? "0" : "0"} 0;font:700 18px/1.35 Arial,Helvetica,sans-serif;color:#0F1E2C">${esc(r.value)}</td>
    </tr>`,
    )
    .join("");
  /* REVISION-35 G1: táboa interior dentro da cela (nunca <tr> directo nun <td>). */
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:1px solid #D8E3EC;border-radius:12px;margin:0 0 20px 0">
    <tr><td style="padding:20px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${inner}</table>
    </td></tr>
  </table>`;
}

export function codeBlock(code: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0"><tr>
    <td align="center" style="background:#F4F7FA;border:1px solid #D8E3EC;border-radius:12px;padding:18px;font:800 28px/1 Arial,Helvetica,sans-serif;letter-spacing:0.12em;color:#0F1E2C">${esc(code)}</td>
  </tr></table>`;
}

export function beforeAfter(
  ctx: EmailBlockContext,
  before: string,
  after: string,
): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;border:1px solid #D8E3EC;border-radius:12px">
    <tr>
      <td width="50%" style="padding:14px 16px;border-right:1px solid #D8E3EC;vertical-align:top">
        <div style="font:700 12px Arial,Helvetica,sans-serif;color:#3B4A59;text-transform:uppercase">${esc(emailT(ctx.locale, "card.before"))}</div>
        <div style="font:400 15px/1.4 Arial,Helvetica,sans-serif;color:#3B4A59;text-decoration:line-through;margin-top:4px">${esc(before)}</div>
      </td>
      <td width="50%" style="padding:14px 16px;vertical-align:top">
        <div style="font:700 12px Arial,Helvetica,sans-serif;color:#0E6B4D;text-transform:uppercase">${esc(emailT(ctx.locale, "card.now"))}</div>
        <div style="font:700 16px/1.4 Arial,Helvetica,sans-serif;color:#0F1E2C;margin-top:4px">${esc(after)}</div>
      </td>
    </tr>
  </table>`;
}

/** REVISION-37 I7 — unha hora por liña; sublabel («2 pistas») máis pequeno debaixo. */
export function hourChips(
  labels: string[],
  hrefs: string[],
  sublabels?: (string | undefined)[],
): string {
  const rows = labels
    .map((label, i) => {
      const href = hrefs[i] ?? "#";
      const sub = sublabels?.[i]?.trim();
      const inner = sub
        ? `<span style="display:block;font:700 14px Arial,Helvetica,sans-serif;color:#00527F">${esc(label)}</span><span style="display:block;margin-top:2px;font:400 12px Arial,Helvetica,sans-serif;color:#3B4A59">${esc(sub)}</span>`
        : esc(label);
      return `<tr><td style="padding:0 0 8px 0">
        <a href="${esc(href)}" style="display:block;background:#E6F2FA;color:#00527F;font:700 14px Arial,Helvetica,sans-serif;text-decoration:none;padding:10px 12px;border-radius:8px;border:1px solid #D8E3EC">${inner}</a>
      </td></tr>`;
    })
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px 0">${rows}</table>`;
}

export function helpBox(text: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;background:#F4F7FA;border-radius:12px">
    <tr><td style="padding:14px 16px;font:400 15px/1.45 Arial,Helvetica,sans-serif;color:#3B4A59">${esc(text)}</td></tr>
  </table>`;
}

/** REVISION-34 E1 — bloque «Antes de ir» coas normas activas. */
export function antesDeIrBlock(locale: "gl" | "es", lines: string[]): string {
  if (!lines.length) return "";
  const title =
    locale === "es" ? "Antes de ir" : "Antes de ir";
  const items = lines
    .map(
      (l) =>
        `<tr><td style="padding:0 0 8px 0;font:400 15px/1.45 Arial,Helvetica,sans-serif;color:#0F1E2C">· ${esc(l)}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;background:#F4F7FA;border-radius:12px">
    <tr><td style="padding:14px 16px">
      <div style="font:700 13px Arial,Helvetica,sans-serif;color:#3B4A59;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:8px">${esc(title)}</div>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${items}</table>
    </td></tr>
  </table>`;
}

export function primaryButton(
  ctx: EmailBlockContext,
  label: string,
  href: string,
): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px 0"><tr>
    <td bgcolor="${ctx.buttonBg}" style="border-radius:10px;background:${ctx.buttonBg}">
      <a href="${esc(href)}" style="display:inline-block;padding:14px 22px;font:700 16px/20px Arial,Helvetica,sans-serif;color:#ffffff;text-decoration:none;border-radius:10px;min-height:48px;box-sizing:border-box">${esc(label)}</a>
    </td>
  </tr></table>`;
}

/** REVISION-35 G9 / REVISION-37 I8 — secundario coa cor principal do concello. */
export function secondaryButton(
  label: string,
  href: string,
  ctx?: EmailBlockContext,
): string {
  const color = ctx?.buttonBg ?? "#00527F";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px 0"><tr>
    <td style="border-radius:10px;border:2px solid ${color};background:#ffffff">
      <a href="${esc(href)}" style="display:inline-block;padding:12px 20px;font:700 16px/20px Arial,Helvetica,sans-serif;color:${color};text-decoration:none;border-radius:10px;min-height:48px;box-sizing:border-box">${esc(label)}</a>
    </td>
  </tr></table>`;
}

export function secondaryLink(label: string, href: string): string {
  return `<p style="margin:0 0 10px 0;font:700 15px Arial,Helvetica,sans-serif"><a href="${esc(href)}" style="color:#00527F;text-decoration:underline">${esc(label)}</a></p>`;
}

export function qrInline(cid: string, shortCode: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0"><tr>
    <td align="center">
      <img src="cid:${esc(cid)}" width="180" height="180" alt="QR ${esc(shortCode)}" style="display:block;border:0;width:180px;height:180px;background:#ffffff" />
      <div style="margin-top:10px;font:800 22px/1.2 Arial,Helvetica,sans-serif;letter-spacing:0.14em;color:#0F1E2C">${esc(shortCode)}</div>
    </td>
  </tr></table>`;
}

export function stepsList(steps: string[]): string {
  const items = steps
    .map(
      (s, i) =>
        `<tr><td style="padding:0 0 8px 0;font:700 15px Arial,Helvetica,sans-serif;color:#00527F;width:28px;vertical-align:top">${i + 1}.</td>
         <td style="padding:0 0 8px 0;font:400 15px/1.4 Arial,Helvetica,sans-serif;color:#0F1E2C">${esc(s)}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0">${items}</table>`;
}

export function footerBlock(
  ctx: EmailBlockContext,
  footerKind: "A" | "T" | "P",
  opts?: { unsubscribeUrl?: string; privacyUrl?: string },
): string {
  const line1 = [ctx.titular, ctx.sinatura].filter(Boolean).join(" · ");
  const contactBits: string[] = [];
  if (ctx.contactPhone) {
    const telHref = ctx.contactPhone.replace(/[^\d+]/g, "");
    contactBits.push(
      `<a href="tel:${esc(telHref)}" style="color:#3B4A59;text-decoration:underline">${esc(ctx.contactPhone)}</a>`,
    );
  }
  if (ctx.contactEmail || ctx.legalEmail) {
    const em = ctx.contactEmail || ctx.legalEmail;
    contactBits.push(
      `<a href="mailto:${esc(em)}" style="color:#3B4A59;text-decoration:underline">${esc(em)}</a>`,
    );
  }
  const doubts =
    !ctx.contactPhone && ctx.legalEmail
      ? emailT(ctx.locale, "footer.doubts", { email: ctx.legalEmail })
      : "";
  const unsub =
    footerKind === "A" && opts?.unsubscribeUrl
      ? `<p style="margin:12px 0 0 0;font:400 12px/1.4 Arial,Helvetica,sans-serif"><a href="${esc(opts.unsubscribeUrl)}" style="color:#3B4A59">${esc(emailT(ctx.locale, "footer.unsub"))}</a></p>`
      : "";
  const privacy = opts?.privacyUrl
    ? `<a href="${esc(opts.privacyUrl)}" style="color:#3B4A59;text-decoration:underline">${esc(emailT(ctx.locale, "cta.privacy"))}</a>`
    : emailT(ctx.locale, "cta.privacy");

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;border-top:1px solid #D8E3EC">
    <tr><td style="padding:18px 0 0 0;font:400 13px/1.5 Arial,Helvetica,sans-serif;color:#3B4A59">
      ${line1 ? `<div style="font-weight:700;color:#0F1E2C">${esc(line1)}</div>` : ""}
      ${ctx.address ? `<div>${esc(ctx.address)}</div>` : ""}
      ${contactBits.length ? `<div style="margin-top:8px">${contactBits.join(" · ")}</div>` : ""}
      ${doubts ? `<div style="margin-top:8px">${esc(doubts)}</div>` : ""}
      <div style="margin-top:10px">${esc(emailT(ctx.locale, `footer.${footerKind}`))}</div>
      ${unsub}
      <div style="margin-top:12px;font-size:12px">Enviado con Pista Aberta, software libre (EUPL-1.2) · ${privacy}</div>
    </td></tr>
  </table>`;
}

export function wrapEmailDocument(opts: {
  lang: string;
  preheader: string;
  headerHtml: string;
  bodyHtml: string;
  footerHtml: string;
}): string {
  return `<!DOCTYPE html>
<html lang="${esc(opts.lang)}">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title></title>
</head>
<body bgcolor="#E9EEF3" style="margin:0;padding:0;background:#E9EEF3">
${preheaderHidden(opts.preheader)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#E9EEF3" style="background:#E9EEF3">
  <tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden">
      <tr><td>${opts.headerHtml}</td></tr>
      <tr><td style="padding:8px 28px 28px 28px">${opts.bodyHtml}${opts.footerHtml}</td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

/** Texto plano a partir dos mesmos datos. */
export function plainFromParts(parts: string[]): string {
  return parts.filter(Boolean).join("\n\n");
}
