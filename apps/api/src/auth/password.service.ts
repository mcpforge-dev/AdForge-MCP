import { Injectable } from "@nestjs/common";
import argon2 from "argon2";
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
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  public needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, {
      memoryCost: this.config.argon2MemoryKib,
      timeCost: this.config.argon2TimeCost,
      parallelism: this.config.argon2Parallelism,
    });
  }
}
