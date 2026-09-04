export const BUSINESS_MEMBER_TITLES = [
  "CLIENT",
  "TEAM_LEAD",
  "PPC_SPECIALIST",
  "BUSINESS_DEVELOPMENT_LEAD",
] as const;

export type BusinessMemberTitle = (typeof BUSINESS_MEMBER_TITLES)[number];
export type BusinessMemberTitleLanguage = "ru" | "en";

const BUSINESS_MEMBER_TITLE_LABELS: Record<
  BusinessMemberTitle,
  Record<BusinessMemberTitleLanguage, string>
> = {
  CLIENT: { ru: "Клиент", en: "Client" },
  TEAM_LEAD: { ru: "Руководитель", en: "Team lead" },
  PPC_SPECIALIST: { ru: "PPC-специалист", en: "PPC specialist" },
  BUSINESS_DEVELOPMENT_LEAD: {
    ru: "Руководитель по развитию бизнеса",
    en: "Business development lead",
  },
};

export function businessMemberTitleLabel(
  title: string | null | undefined,
  language: BusinessMemberTitleLanguage = "ru",
): string | null {
  if (!title || !BUSINESS_MEMBER_TITLES.includes(title as BusinessMemberTitle))
    return null;
  return BUSINESS_MEMBER_TITLE_LABELS[title as BusinessMemberTitle][language];
}
