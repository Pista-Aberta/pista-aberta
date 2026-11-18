import type { TFunction } from "i18next";

export const FAMILY_RELATIONS = [
  "fillo",
  "filla",
  "dependente",
  "outro",
] as const;

export type FamilyRelation = (typeof FAMILY_RELATIONS)[number];

export function isFamilyRelation(value: string): value is FamilyRelation {
  return (FAMILY_RELATIONS as readonly string[]).includes(value);
}

export function formatFamilyRelation(
  t: TFunction,
  relation: FamilyRelation,
): string {
  switch (relation) {
    case "fillo":
      return t("account.familyRelation.fillo");
    case "filla":
      return t("account.familyRelation.filla");
    case "dependente":
      return t("account.familyRelation.dependente");
    case "outro":
      return t("account.familyRelation.outro");
    default: {
      const _exhaustive: never = relation;
      return _exhaustive;
    }
  }
}

export function renderFamilyRelationLabel(
  t: TFunction,
  relation: string,
): string {
  return isFamilyRelation(relation) ? formatFamilyRelation(t, relation) : relation;
}
