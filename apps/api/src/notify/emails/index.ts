export { renderEmail } from "./layout.js";
export type { EmailKind, RenderedEmail, EmailAttachment } from "./types.js";
export {
  listDemoEmails,
  recordDemoEmail,
  renderedToDemo,
  clearDemoOutbox,
} from "./demo-outbox.js";
export { emailButtonBg, escudoAbsoluteUrl, escudoHash, appBaseUrl } from "./context.js";
export { buildUsageRulesLines } from "@pista-aberta/shared";
