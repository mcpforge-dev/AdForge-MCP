import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { loadConfig } from "@holymedia/config";

type CredentialKeyRing = Map<number, Buffer>;

@Injectable()
export class CredentialVaultService {
  private readonly config = loadConfig();
  private readonly keys = parseKeyRing(
    this.config.providerCredentialEncryptionKeys,
  );

  public encrypt(payload: unknown): {
    ciphertext: string;
    encryptionVersion: number;
  } {
    const version = this.config.providerCredentialCurrentKeyVersion;
    const key = this.keys.get(version);
    if (!key) throw new Error("Provider credential key is not configured.");

    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
    const ciphertext = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return {
      ciphertext: [
        "hm1",
        nonce.toString("base64url"),
        tag.toString("base64url"),
        ciphertext.toString("base64url"),
      ].join("."),
      encryptionVersion: version,
    };
  }

  public decrypt<T>(ciphertext: string, encryptionVersion: number): T {
    const key = this.keys.get(encryptionVersion);
    if (!key)
      throw new Error("Provider credential key version is unavailable.");
    const [format, nonceText, tagText, dataText] = ciphertext.split(".");
    if (format !== "hm1" || !nonceText || !tagText || !dataText) {
      throw new Error("Provider credential payload is invalid.");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(nonceText, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(dataText, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(plaintext) as T;
  }

  public reencrypt(
    ciphertext: string,
    encryptionVersion: number,
  ): { ciphertext: string; encryptionVersion: number } {
    return this.encrypt(this.decrypt(ciphertext, encryptionVersion));
  }
}

function parseKeyRing(raw: string | undefined): CredentialKeyRing {
  const keys = new Map<number, Buffer>();
  if (!raw) return keys;
  for (const item of raw.split(",")) {
    const [versionText, encoded] = item.trim().split(":");
    const version = Number(versionText);
    const key = encoded ? Buffer.from(encoded, "base64") : Buffer.alloc(0);
    if (!Number.isInteger(version) || version < 1 || key.length !== 32) {
      throw new Error("Provider credential key ring is invalid.");
    }
    keys.set(version, key);
  }
  return keys;
}
