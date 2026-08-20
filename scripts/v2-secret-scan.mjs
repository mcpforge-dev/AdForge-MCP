import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const tracked = execFileSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const ignoredPrefixes = [
  ".agents/",
  ".claude/",
  ".codex/",
  ".impeccable/",
  "packages/database/src/generated/",
];
const files = tracked.filter(
  (file) => !ignoredPrefixes.some((prefix) => file.startsWith(prefix)),
);
const forbiddenPath =
  /(^|\/)(\.env$|\.env\.(?!example$|v2\.example$)[^/]+$|connections\.json|.*\.backup|.*\.bak|.*\.log)$/i;
const forbiddenValue =
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|sk-proj-[A-Za-z0-9_-]{20,}|GOCSPX-[A-Za-z0-9_-]{20,}|EA[A-Za-z0-9_-]{30,}/;
const pathFindings = files.filter((file) => forbiddenPath.test(file));
const findings = [];

for (const file of files) {
  if (pathFindings.includes(file)) continue;
  const content = readFileSync(file, "utf8");
  if (forbiddenValue.test(content)) findings.push(file);
}

if (pathFindings.length || findings.length) {
  console.error(JSON.stringify({ pathFindings, findings }, null, 2));
  process.exit(1);
}

console.log("v2 secret scan passed");
