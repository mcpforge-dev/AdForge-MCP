import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Sign in | HolyMedia MCP",
  robots: { index: false, follow: false, noarchive: true },
};

export default function AuthLayout({ children }: { children: ReactNode }) {
  return children;
}
