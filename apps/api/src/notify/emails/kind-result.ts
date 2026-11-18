import type { EmailAttachment, EmailFooterKind, EmailPill, RenderedEmail } from "./types.js";
import type { EmailBlockContext } from "./types.js";
import type { NotifyType } from "../prefs.js";
import {
  bodyText,
  footerBlock,
  headerBlock,
  pillBlock,
  titleBlock,
  wrapEmailDocument,
  plainFromParts,
} from "./blocks.js";
import { emailT } from "./i18n.js";
import { fromNameFor } from "./context.js";

export type KindDraft = {
  subject: string;
  preheader: string;
  title: string;
  pill: EmailPill;
  helloName?: string;
  /** REVISION-41 O9: «Ola!» sen nome/correo. */
  helloBare?: boolean;
  bodyHtml: string;
  textParts: string[];
  footerKind: EmailFooterKind;
  notifyType: NotifyType | null;
  attachments?: EmailAttachment[];
  headerMode?: "reservas" | "clubs" | "panel" | "platform" | "deputacion";
  unsubscribeUrl?: string;
};

export function finalizeKind(
  ctx: EmailBlockContext,
  draft: KindDraft,
): RenderedEmail {
  const hello = draft.helloBare
    ? emailT(ctx.locale, "helloBare")
    : draft.helloName
      ? emailT(ctx.locale, "hello", { name: draft.helloName })
      : undefined;
  const bodyInner =
    pillBlock(ctx, draft.pill) +
    titleBlock(draft.title, hello) +
    draft.bodyHtml;

  /* REVISION-35 G5 / REVISION-37 I5 — concello: /c/{slug}/…; plataforma/Deputación: /legal/… */
  const privacyUrl =
    ctx.muni &&
    !ctx.isPlatform &&
    !ctx.isDeputacion &&
    ctx.muni.slug !== "_deputacion"
      ? `${ctx.baseUrl}/c/${ctx.muni.slug}/legal/privacidade`
      : `${ctx.baseUrl}/legal/privacidade`;

  const html = wrapEmailDocument({
    lang: ctx.locale === "es" ? "es" : "gl",
    preheader: draft.preheader,
    headerHtml: headerBlock(ctx),
    bodyHtml: bodyInner,
    footerHtml: footerBlock(ctx, draft.footerKind, {
      unsubscribeUrl: draft.unsubscribeUrl,
      privacyUrl,
    }),
  });

  const text = plainFromParts([
    draft.subject,
    draft.preheader,
    hello ?? "",
    draft.title,
    ...draft.textParts,
    ctx.titular && ctx.sinatura
      ? `${ctx.titular} · ${ctx.sinatura}`
      : ctx.titular || "",
    ctx.address,
    draft.unsubscribeUrl
      ? `${emailT(ctx.locale, "footer.unsub")}: ${draft.unsubscribeUrl}`
      : "",
  ]);

  return {
    subject: draft.subject,
    preheader: draft.preheader,
    html,
    text,
    attachments: draft.attachments ?? [],
    footerKind: draft.footerKind,
    fromName: fromNameFor(ctx.muni),
    replyTo: ctx.legalEmail || undefined,
    notifyType: draft.notifyType,
  };
}

export { bodyText };
