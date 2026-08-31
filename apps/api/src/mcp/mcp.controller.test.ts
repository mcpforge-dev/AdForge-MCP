import { describe, expect, it, vi } from "vitest";
import { McpController } from "./mcp.controller.js";

function controller(authenticate = vi.fn().mockResolvedValue(null)) {
  return new McpController(
    { tools: () => [], call: vi.fn() } as never,
    { authenticate } as never,
    { consumeMcpRequest: vi.fn() } as never,
    { record: vi.fn() } as never,
  );
}

describe("MCP bearer authentication", () => {
  it("accepts a case-insensitive Bearer scheme", async () => {
    const authenticate = vi
      .fn()
      .mockResolvedValue({ workspaceId: "workspace" });
    const result = await controller(authenticate).post({
      headers: { authorization: "bearer hmst_valid" },
      body: { jsonrpc: "2.0", id: 1, method: "initialize" },
    } as never);

    expect(authenticate).toHaveBeenCalledWith("hmst_valid");
    expect(result).toMatchObject({ result: { protocolVersion: "2025-03-26" } });
  });

  it("rejects missing, malformed, and invalid service tokens", async () => {
    await expect(
      controller().post({
        headers: {},
        body: { method: "initialize" },
      } as never),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      controller().post({
        headers: { authorization: "Bearer Bearer hmst_invalid" },
        body: { method: "initialize" },
      } as never),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      controller().post({
        headers: { authorization: "Bearer hmst_invalid" },
        body: { method: "initialize" },
      } as never),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("authenticates a GET transport probe before returning the optional SSE response", async () => {
    const authenticate = vi
      .fn()
      .mockResolvedValue({ workspaceId: "workspace" });

    await expect(
      controller(authenticate).get({
        headers: { authorization: "Bearer hmst_valid" },
      } as never),
    ).rejects.toMatchObject({ status: 405 });
    expect(authenticate).toHaveBeenCalledWith("hmst_valid");
  });
});
