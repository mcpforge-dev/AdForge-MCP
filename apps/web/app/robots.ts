import type { MetadataRoute } from "next";

const baseUrl =
  process.env.NEXT_PUBLIC_PUBLIC_BASE_URL ?? "https://mcp.holymedia.kz";

export default function robots(): MetadataRoute.Robots {
  const productionHost = new URL(baseUrl).hostname === "mcp.holymedia.kz";
  return {
    rules: productionHost
      ? [
          {
            userAgent: "*",
            allow: "/",
            disallow: ["/dashboard", "/app", "/auth"],
          },
        ]
      : [{ userAgent: "*", disallow: "/" }],
    sitemap: productionHost ? `${baseUrl}/sitemap.xml` : undefined,
    host: productionHost ? baseUrl : undefined,
  };
}
