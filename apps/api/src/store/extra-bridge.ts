import { onBookingCancelled } from "./db.js";
export {
  acceptWaitlistOffer,
  addFamilyMember,
  removeFamilyMember,
  audit,
  ensureExtraSeed,
  getConsent,
  inviteClubMember,
  listAudit,
  listClubMembers,
  listFamily,
  listNotices,
  listUnreadNotices,
  listSeasonSlots,
  listWaitlist,
  markNoticeRead,
  offerWaitlistOnCancel,
  setConsent,
} from "./extra.js";

export function onBookingCancelledBridge(
  fn: (slotId: string, municipalityId: string) => void | Promise<void>,
) {
  onBookingCancelled(fn);
}
