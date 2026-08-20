import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    service: "holymedia-mcp-v2-web",
    version: "foundation-1",
  });
}
