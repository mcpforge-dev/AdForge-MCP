"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LanguageSwitcher } from "./language-switcher";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

/** Keeps the public legal pages from looking like a logout for signed-in users. */
export function LegalHeader() {
  const [destination, setDestination] = useState<"/" | "/dashboard" | null>(
    null,
  );

  const resolveDestination = useCallback(async (): Promise<
    "/" | "/dashboard"
  > => {
    try {
      const response = await fetch(`${API}/api/v1/workspaces`, {
        credentials: "include",
        cache: "no-store",
      });
      return response.ok ? "/dashboard" : "/";
    } catch {
      return "/";
    }
  }, []);

  useEffect(() => {
    let active = true;
    void resolveDestination().then((nextDestination) => {
      if (active) setDestination(nextDestination);
    });
    return () => {
      active = false;
    };
  }, [resolveDestination]);

  return (
    <header className="legal-header">
      <Link
        className="legal-brand"
        href={destination ?? "/"}
        aria-label="HolyMedia MCP"
        onClick={(event) => {
          if (destination) return;
          event.preventDefault();
          void resolveDestination().then((nextDestination) => {
            window.location.assign(nextDestination);
          });
        }}
      >
        <img
          className="brand-logo"
          src="/assets/brand/holymedia-mcp-horizontal-dark.svg"
          alt=""
        />
      </Link>
      <div className="legal-language">
        <LanguageSwitcher compact />
      </div>
    </header>
  );
}
