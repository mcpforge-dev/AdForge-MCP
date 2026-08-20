export function assertNoSecret(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (/-----BEGIN|sk-proj-|GOCSPX-|EA[A-Za-z0-9_-]{20,}/i.test(serialized)) {
    throw new Error("Test value contains a secret-like marker.");
  }
}
