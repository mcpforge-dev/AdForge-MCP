import { Injectable } from "@nestjs/common";
import argon2 from "argon2";
import { pbkdf2Sync, timingSafeEqual } from "node:crypto";
import { loadConfig, type AppConfig } from "@holymedia/config";

@Injectable()
export class PasswordService {
  private readonly config: AppConfig = loadConfig();

  public async hash(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: this.config.argon2MemoryKib,
      timeCost: this.config.argon2TimeCost,
      parallelism: this.config.argon2Parallelism,
    });
  }

  public async verify(hash: string, password: string): Promise<boolean> {
    if (hash.startsWith("pbkdf2_sha256$")) {
      return verifyLegacyPbkdf2(hash, password);
    }
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  public needsRehash(hash: string): boolean {
    if (hash.startsWith("pbkdf2_sha256$")) return true;
    if (!hash.startsWith("$argon2")) return true;
    return argon2.needsRehash(hash, {
      memoryCost: this.config.argon2MemoryKib,
      timeCost: this.config.argon2TimeCost,
      parallelism: this.config.argon2Parallelism,
    });
  }
}

function verifyLegacyPbkdf2(encoded: string, password: string): boolean {
  try {
    const [algorithm, iterationsText, saltText, digestText] = encoded.split(
      "$",
      4,
    );
    const iterations = Number(iterationsText);
    if (
      algorithm !== "pbkdf2_sha256" ||
      !Number.isInteger(iterations) ||
      iterations < 100_000 ||
      iterations > 1_000_000 ||
      !saltText ||
      !digestText
    ) {
      return false;
    }
    const salt = Buffer.from(saltText, "base64");
    const expected = Buffer.from(digestText, "base64");
    if (salt.length !== 16 || expected.length !== 32) return false;
    const actual = pbkdf2Sync(
      password,
      salt,
      iterations,
      expected.length,
      "sha256",
    );
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
