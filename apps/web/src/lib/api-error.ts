import type { TFunction } from "i18next";

type ErrorKeyOverrides = Readonly<Record<string, string>>;

function errorCode(error: unknown): string {
  if (error instanceof Error) return error.message.trim();
  return "";
}

/**
 * Maps API error codes to translated, user-safe messages. Unknown server
 * messages deliberately fall back instead of exposing raw implementation
 * details to the UI.
 */
export function mapApiError(
  t: TFunction,
  error: unknown,
  overrides: ErrorKeyOverrides = {},
): string {
  const code = errorCode(error);
  const key = overrides[code] ?? (code ? `error.${code}` : "");

  if (key) {
    const translated = t(key);
    if (translated !== key) return translated;
  }

  return t("common.error");
}
