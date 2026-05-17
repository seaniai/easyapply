export function isTauri(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as Window & { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown };
  return Boolean(w.__TAURI__ ?? w.__TAURI_INTERNALS__);
}

export function apiBase(): string {
  const base = import.meta.env.VITE_API_BASE as string | undefined;
  return (base ?? "").replace(/\/$/, "");
}

export function authToken(): string | null {
  return localStorage.getItem("easyapply.auth.token");
}

export function setAuthToken(token: string | null): void {
  if (!token) localStorage.removeItem("easyapply.auth.token");
  else localStorage.setItem("easyapply.auth.token", token);
}
