import { describe, expect, it } from "vitest";
import { pbkdf2Sync } from "node:crypto";
import { PasswordService } from "./password.service.js";

describe("PasswordService V1 compatibility", () => {
  it("verifies the V1 PBKDF2 hash and marks it for Argon2 rehash", async () => {
    const password = "legacy-password";
    const salt = Buffer.from("1234567890abcdef", "utf8");
    const digest = pbkdf2Sync(password, salt, 240_000, 32, "sha256");
    const encoded = `pbkdf2_sha256$240000$${salt.toString("base64")}$${digest.toString("base64")}`;
    const service = new PasswordService();

    await expect(service.verify(encoded, password)).resolves.toBe(true);
    await expect(service.verify(encoded, "wrong-password")).resolves.toBe(
      false,
    );
    expect(service.needsRehash(encoded)).toBe(true);
  });

  it("rejects malformed legacy hashes without throwing", async () => {
    const service = new PasswordService();
    await expect(
      service.verify("pbkdf2_sha256$10$bad$bad", "password"),
    ).resolves.toBe(false);
  });
});
