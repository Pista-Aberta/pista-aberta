import type { TFunction } from "i18next";

export function formatClosureImpactBody(
  t: TFunction,
  counts: { bookings: number; people: number; matches: number },
): string {
  return t("admin.closureImpactBody", {
    count: counts.bookings,
    bookingsLabel: t("count.bookings", { count: counts.bookings }),
    peopleLabel: t("count.people", { count: counts.people }),
    matchesLabel: t("count.matches", { count: counts.matches }),
  });
}

export function formatFixedGroupImpactBody(
  t: TFunction,
  counts: { bookings: number; people: number },
): string {
  return t("admin.fixedGroupImpactBody", {
    count: counts.bookings,
    bookingsLabel: t("count.bookings", { count: counts.bookings }),
    peopleLabel: t("count.people", { count: counts.people }),
  });
}

export function formatFacilityDeactivateImpactBody(
  t: TFunction,
  counts: { bookings: number; people: number; matches: number },
): string {
  return t("admin.facilityDeactivateImpactBody", {
    bookingsLabel: t("count.futureBookings", { count: counts.bookings }),
    peopleLabel: t("count.people", { count: counts.people }),
    matchesLabel: t("count.scheduledMatches", { count: counts.matches }),
  });
}

export function formatDrawConfirmBody(
  t: TFunction,
  counts: { applications: number; places: number },
): string {
  return t("activities.drawConfirm", {
    applicationsLabel: t("count.applications", { count: counts.applications }),
    placesLabel: t("count.places", { count: counts.places }),
  });
}
