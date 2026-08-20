import { Injectable } from "@nestjs/common";
import type { OnModuleDestroy } from "@nestjs/common";
import { loadConfig } from "@holymedia/config";
import {
  closeDatabase,
  createDatabase,
  type DatabaseHandle,
} from "@holymedia/database";

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  public readonly handle: DatabaseHandle;

  public constructor() {
    this.handle = createDatabase(loadConfig().databaseUrl);
  }

  public get client(): DatabaseHandle["client"] {
    return this.handle.client;
  }

  public async onModuleDestroy(): Promise<void> {
    await closeDatabase(this.handle);
  }
}
