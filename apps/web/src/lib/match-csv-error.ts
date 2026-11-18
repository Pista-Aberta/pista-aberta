import type { TFunction } from "i18next";

export const MATCH_CSV_ERROR_CODES = [
  "ambiguous_club",
  "bad_date",
  "bad_end",
  "bad_range",
  "bad_start",
  "missing_away",
  "missing_club",
  "missing_headers",
  "missing_home",
  "no_facility",
  "unknown_club",
  "unknown_unit",
] as const;

export type MatchCsvErrorCode = (typeof MATCH_CSV_ERROR_CODES)[number];

export function isMatchCsvErrorCode(value: string): value is MatchCsvErrorCode {
  return (MATCH_CSV_ERROR_CODES as readonly string[]).includes(value);
}

export function formatMatchCsvErrorCode(
  t: TFunction,
  code: MatchCsvErrorCode,
): string {
  switch (code) {
    case "ambiguous_club":
      return t("admin.csvErr.ambiguous_club");
    case "bad_date":
      return t("admin.csvErr.bad_date");
    case "bad_end":
      return t("admin.csvErr.bad_end");
    case "bad_range":
      return t("admin.csvErr.bad_range");
    case "bad_start":
      return t("admin.csvErr.bad_start");
    case "missing_away":
      return t("admin.csvErr.missing_away");
    case "missing_club":
      return t("admin.csvErr.missing_club");
    case "missing_headers":
      return t("admin.csvErr.missing_headers");
    case "missing_home":
      return t("admin.csvErr.missing_home");
    case "no_facility":
      return t("admin.csvErr.no_facility");
    case "unknown_club":
      return t("admin.csvErr.unknown_club");
    case "unknown_unit":
      return t("admin.csvErr.unknown_unit");
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}

export function renderMatchCsvErrorLabel(
  t: TFunction,
  rawCode: string,
): string {
  const head = rawCode.split(":")[0] ?? rawCode;
  if (isMatchCsvErrorCode(head)) {
    return formatMatchCsvErrorCode(t, head);
  }
  const key = `admin.csvErr.${head}`;
  const translated = t(key);
  return translated === key ? rawCode : translated;
}
