const baseUrl = (
  process.env.V2_COMPAT_BASE_URL ?? "http://127.0.0.1:4000"
).replace(/\/$/, "");

const checks = [
  { path: "/health", statuses: [200] },
  { path: "/ready", statuses: [200] },
  { path: "/mcp", statuses: [401] },
  { path: "/.well-known/oauth-protected-resource", statuses: [200] },
  { path: "/.well-known/oauth-authorization-server", statuses: [200] },
  { path: "/api/auth/csrf", statuses: [200] },
  { path: "/api/auth/registration-status", statuses: [200] },
  { path: "/auth/google/start", statuses: [302, 503] },
  { path: "/auth/google/callback?error=access_denied", statuses: [400, 401] },
  {
    path: "/oauth/google/callback?error=access_denied",
    statuses: [302],
    location: "/dashboard?section=connections&oauth=error&provider=google",
  },
  {
    path: "/oauth/meta/callback?error=access_denied",
    statuses: [302],
    location: "/dashboard?section=connections&oauth=error&provider=meta",
  },
  {
    path: "/oauth/yandex/callback?error=access_denied",
    statuses: [302],
    location: "/dashboard?section=connections&oauth=error&provider=yandex",
  },
  {
    path: "/oauth/tiktok/callback?error=access_denied",
    statuses: [302],
    location: "/dashboard?section=connections&oauth=error&provider=tiktok",
  },
  { path: "/api/meta/skills/collect-report", statuses: [401] },
  { path: "/api/mcp-token", statuses: [401] },
];

for (const check of checks) {
  const response = await fetch(`${baseUrl}${check.path}`, {
    redirect: "manual",
  });
  if (!check.statuses.includes(response.status)) {
    throw new Error(
      `${check.path}: expected ${check.statuses.join("/")}, got ${response.status}`,
    );
  }
  if (check.location && response.headers.get("location") !== check.location) {
    throw new Error(
      `${check.path}: expected location ${check.location}, got ${response.headers.get("location") ?? "none"}`,
    );
  }
  console.log(JSON.stringify({ path: check.path, status: response.status }));
}

console.log(
  JSON.stringify({ compatibility: "verified", checked: checks.length }),
);
