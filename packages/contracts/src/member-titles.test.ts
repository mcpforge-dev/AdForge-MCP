import { describe, expect, it } from "vitest";
import { businessMemberTitleLabel } from "./member-titles.js";

describe("businessMemberTitleLabel", () => {
  it("renders the approved client and specialist titles in both locales", () => {
    expect(businessMemberTitleLabel("CLIENT", "ru")).toBe("Клиент");
    expect(businessMemberTitleLabel("TEAM_LEAD", "en")).toBe("Team lead");
    expect(businessMemberTitleLabel("PPC_SPECIALIST", "ru")).toBe(
      "PPC-специалист",
    );
    expect(businessMemberTitleLabel("BUSINESS_DEVELOPMENT_LEAD", "en")).toBe(
      "Business development lead",
    );
  });

  it("does not expose unknown internal values", () => {
    expect(businessMemberTitleLabel("OWNER", "ru")).toBeNull();
    expect(businessMemberTitleLabel(undefined, "en")).toBeNull();
  });
});
