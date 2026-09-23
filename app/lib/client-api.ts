export function csrfToken() {
  return document.cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith("csrf="))?.slice(5) ?? "";
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (init.method && init.method !== "GET") headers.set("x-csrf-token", csrfToken());
  const response = await fetch(path, { ...init, headers, credentials: "include", cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data as T;
}

export function formatBytes(bytes: number | string) {
  const value = Number(bytes);
  if (!Number.isFinite(value)) return "--";
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}
