/** Metadatos de demo por slug. */

export function muniBadgeMeta(
  slug: string,
  t: (k: string) => string,
): {
  province: string;
  tag: string | null;
  tagBg: string;
  tagFg: string;
} {
  if (slug === "exemplo") {
    return {
      province: t("home.meta.exemplo"),
      tag: t("home.tag.demo"),
      tagBg: "#FFF4DF",
      tagFg: "#8A5300",
    };
  }
  if (slug === "proba") {
    return {
      province: t("home.meta.proba"),
      tag: t("home.tag.proba"),
      tagBg: "#E6F2FA",
      tagFg: "#005A93",
    };
  }
  return {
    province: t("home.meta.generic"),
    tag: null,
    tagBg: "#E6F2FA",
    tagFg: "#005A93",
  };
}
