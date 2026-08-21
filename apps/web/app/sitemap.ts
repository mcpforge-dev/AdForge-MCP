import type { MetadataRoute } from "next";

const baseUrl = (
  process.env.NEXT_PUBLIC_PUBLIC_BASE_URL ?? "https://mcp.holymedia.kz"
).replace(/\/$/, "");

export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/privacy", "/terms"].map((path, index) => ({
    url: `${baseUrl}${path}`,
    changeFrequency: index === 0 ? "weekly" : "yearly",
    priority: index === 0 ? 1 : 0.3,
  }));
}
