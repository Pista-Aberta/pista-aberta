/**
 * Punto único de renderizado de correos.
 * renderEmail({ muni, locale, kind, data }) → subject/html/text/attachments.
 */
import type { Locale, Municipality } from "@pista-aberta/shared";
import type { EmailKind, RenderedEmail } from "./types.js";
import { renderBookingConfirmed } from "./booking-confirmed.js";
import { renderBookingPending } from "./booking-pending.js";
import { renderBookingApproved } from "./booking-approved.js";
import { renderBookingRejected } from "./booking-rejected.js";
import { renderReminder } from "./reminder.js";
import { renderBookingChanged } from "./booking-changed.js";
import { renderBookingCancelled } from "./booking-cancelled.js";
import { renderFacilityClosure } from "./facility-closure.js";
import { renderWaitlistOffer } from "./waitlist-offer.js";
import { renderNoShowWarning } from "./no-show-warning.js";
import { renderNoShowPause } from "./no-show-pause.js";
import { renderPauseLifted } from "./pause-lifted.js";
import { renderOtp } from "./otp.js";
import { renderMatchCancelled } from "./match-cancelled.js";
import { renderMatchMoved } from "./match-moved.js";
import {
  renderOpenMatchCancelled,
  renderOpenMatchInvite,
  renderOpenMatchJoined,
  renderOpenMatchLeft,
  renderOpenMatchMoved,
} from "./open-match.js";
import {
  renderClubCounter,
  renderSeasonDecision,
} from "./season-decision.js";
import { renderInviteStaff } from "./invite-staff.js";
import { renderInviteDeputacion } from "./invite-deputacion.js";

export type { EmailKind, RenderedEmail } from "./types.js";

export async function renderEmail(opts: {
  muni: Municipality | null;
  locale: Locale;
  kind: EmailKind;
  data: Record<string, unknown>;
}): Promise<RenderedEmail> {
  const { muni, locale, kind, data } = opts;
  const needMuni = (): Municipality => {
    if (!muni) throw new Error(`email_kind_requires_muni:${kind}`);
    return muni;
  };

  switch (kind) {
    case "booking_confirmed":
      return renderBookingConfirmed(
        needMuni(),
        locale,
        data as Parameters<typeof renderBookingConfirmed>[2],
      );
    case "booking_pending":
      return renderBookingPending(
        needMuni(),
        locale,
        data as Parameters<typeof renderBookingPending>[2],
      );
    case "booking_approved":
      return renderBookingApproved(
        needMuni(),
        locale,
        data as Parameters<typeof renderBookingApproved>[2],
      );
    case "booking_rejected":
      return renderBookingRejected(
        needMuni(),
        locale,
        data as Parameters<typeof renderBookingRejected>[2],
      );
    case "reminder":
      return renderReminder(
        needMuni(),
        locale,
        data as Parameters<typeof renderReminder>[2],
      );
    case "booking_changed":
      return renderBookingChanged(
        needMuni(),
        locale,
        data as Parameters<typeof renderBookingChanged>[2],
      );
    case "booking_cancelled":
      return renderBookingCancelled(
        needMuni(),
        locale,
        data as Parameters<typeof renderBookingCancelled>[2],
      );
    case "facility_closure":
      return renderFacilityClosure(
        needMuni(),
        locale,
        data as Parameters<typeof renderFacilityClosure>[2],
      );
    case "waitlist_offer":
      return renderWaitlistOffer(
        needMuni(),
        locale,
        data as Parameters<typeof renderWaitlistOffer>[2],
      );
    case "no_show_warning":
      return renderNoShowWarning(
        needMuni(),
        locale,
        data as Parameters<typeof renderNoShowWarning>[2],
      );
    case "no_show_pause":
      return renderNoShowPause(
        needMuni(),
        locale,
        data as Parameters<typeof renderNoShowPause>[2],
      );
    case "pause_lifted":
      return renderPauseLifted(
        needMuni(),
        locale,
        data as Parameters<typeof renderPauseLifted>[2],
      );
    case "otp":
      return renderOtp(muni, locale, data as Parameters<typeof renderOtp>[2]);
    case "match_cancelled":
      return renderMatchCancelled(
        needMuni(),
        locale,
        data as Parameters<typeof renderMatchCancelled>[2],
      );
    case "match_moved":
      return renderMatchMoved(
        needMuni(),
        locale,
        data as Parameters<typeof renderMatchMoved>[2],
      );
    case "open_match_invite":
      return renderOpenMatchInvite(
        needMuni(),
        locale,
        data as Parameters<typeof renderOpenMatchInvite>[2],
      );
    case "open_match_cancelled":
      return renderOpenMatchCancelled(
        needMuni(),
        locale,
        data as Parameters<typeof renderOpenMatchCancelled>[2],
      );
    case "open_match_moved":
      return renderOpenMatchMoved(
        needMuni(),
        locale,
        data as Parameters<typeof renderOpenMatchMoved>[2],
      );
    case "open_match_joined":
      return renderOpenMatchJoined(
        needMuni(),
        locale,
        data as Parameters<typeof renderOpenMatchJoined>[2],
      );
    case "open_match_left":
      return renderOpenMatchLeft(
        needMuni(),
        locale,
        data as Parameters<typeof renderOpenMatchLeft>[2],
      );
    case "season_approved":
      return renderSeasonDecision(needMuni(), locale, {
        ...(data as Parameters<typeof renderSeasonDecision>[2]),
        approved: true,
      });
    case "season_rejected":
      return renderSeasonDecision(needMuni(), locale, {
        ...(data as Parameters<typeof renderSeasonDecision>[2]),
        approved: false,
      });
    case "club_counter":
      return renderClubCounter(
        needMuni(),
        locale,
        data as Parameters<typeof renderClubCounter>[2],
      );
    case "invite_staff":
      return renderInviteStaff(
        needMuni(),
        locale,
        data as Parameters<typeof renderInviteStaff>[2],
      );
    case "invite_deputacion":
      return renderInviteDeputacion(
        muni,
        locale,
        data as Parameters<typeof renderInviteDeputacion>[2],
      );
    default: {
      const _exhaustive: never = kind;
      throw new Error(`unknown_email_kind:${String(_exhaustive)}`);
    }
  }
}
