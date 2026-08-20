import { describe, expect, it } from "vitest";
import { createDatabase } from "./index.js";

describe("database foundation", () => {
  it("creates a Prisma-backed database handle without connecting eagerly", async () => {
    const database = createDatabase(
      "postgresql://holymedia:change-me@localhost:5433/holymedia_v2",
    );
    expect(database.client).toBeDefined();
    expect(database.pool).toBeDefined();
    await database.client.$disconnect();
    await database.pool.end();
  });
});
