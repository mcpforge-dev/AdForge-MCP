export function requestPath(url: string): string {
  return url.split("?", 1)[0] || "/";
}
