export function publicAppUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function invitationUrl(origin: string, token: string): string {
  const url = new URL("/register", origin);
  url.searchParams.set("invite", token);
  return url.toString();
}
