import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  robots: { index: false, follow: false, noarchive: true },
};

export default function AcceptInvitationLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
