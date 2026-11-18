import type { TFunction } from "i18next";

export const DEMO_LOGIN_NOTICE_CODES = [
  "concello_non_creado",
  "club_non_creado",
] as const;

export type DemoLoginNoticeCode = (typeof DEMO_LOGIN_NOTICE_CODES)[number];

export function isDemoLoginNoticeCode(
  value: string | null | undefined,
): value is DemoLoginNoticeCode {
  if (!value) return false;
  return (DEMO_LOGIN_NOTICE_CODES as readonly string[]).includes(value);
}

export function formatDemoLoginNotice(
  t: TFunction,
  code: DemoLoginNoticeCode,
): string {
  switch (code) {
    case "concello_non_creado":
      return t("login.erroConcelloNonCreado");
    case "club_non_creado":
      return t("demo.clubNonCreado");
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}
