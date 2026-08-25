import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { AccountSelectionBatchDto } from "./provider.dto.js";

describe("AccountSelectionBatchDto", () => {
  it("accepts migrated UUIDv5 provider-account IDs", async () => {
    const dto = new AccountSelectionBatchDto();
    dto.accountIds = ["123e4567-e89b-52d3-a456-426614174000"];

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it("still rejects malformed provider-account IDs", async () => {
    const dto = new AccountSelectionBatchDto();
    dto.accountIds = ["not-an-account-id"];

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.property).toBe("accountIds");
  });
});
