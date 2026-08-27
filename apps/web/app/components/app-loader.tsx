"use client";

import { useEffect, useState } from "react";

const MINIMUM_LOADER_DURATION = 560;

export function AppLoader() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const startedAt = performance.now();
    const finish = () => {
      const remaining = Math.max(0, MINIMUM_LOADER_DURATION - (performance.now() - startedAt));
      window.setTimeout(() => setVisible(false), remaining);
    };
    if (document.readyState === "complete") finish();
    else window.addEventListener("load", finish, { once: true });
    return () => window.removeEventListener("load", finish);
  }, []);

  return (
    <div className={`app-loader${visible ? "" : " app-loader--hidden"}`} aria-hidden="true" data-loader-visible={visible ? "true" : "false"}>
      <div className="app-loader__mark">
        <svg viewBox="0 0 108 112" aria-hidden="true">
          <path className="app-loader__stream app-loader__stream--left" d="M7 29c11 3 17 10 25 7 8-3 10-13 7-21" />
          <path className="app-loader__stream app-loader__stream--center" d="M54 5c-5 9-3 18 4 22 7 4 11-5 7-14" />
          <path className="app-loader__stream app-loader__stream--right" d="M101 29c-11 3-17 10-25 7-8-3-10-13-7-21" />
          <path className="app-loader__channel" d="M36 47c-10 4-16 10-16 20v37m16-57c8 4 13 9 18 9s10-5 18-9m0 0c10 4 16 10 16 20v37M45 105V68c0-8 4-13 9-16 5 3 9 8 9 16v37" />
        </svg>
        <img src="/assets/brand/holymedia-mcp-horizontal.svg" alt="" />
      </div>
    </div>
  );
}

export { MINIMUM_LOADER_DURATION };
