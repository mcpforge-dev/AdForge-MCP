import type { Metadata } from "next";
import type { ReactNode } from "react";

const publicBaseUrl =
  process.env.NEXT_PUBLIC_PUBLIC_BASE_URL ?? "https://mcp.holymedia.kz";

export const metadata: Metadata = {
  metadataBase: new URL(publicBaseUrl),
  title: {
    default: "HolyMedia MCP",
    template: "%s | HolyMedia MCP",
  },
  description:
    "Управление рекламными кабинетами и аналитика HolyMedia MCP.",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "HolyMedia MCP",
    title: "HolyMedia MCP",
    description:
      "Управление рекламными кабинетами и аналитика HolyMedia MCP.",
    url: "/",
  },
  robots: { index: true, follow: true },
};

export default function PublicLayout({ children }: { children: ReactNode }) {
  return children;
}
