import { invoke } from "@tauri-apps/api/core";
import { apiBase, authToken, isTauri } from "./runtime";

type Json = Record<string, unknown>;

async function apiFetch<T>(
  path: string,
  init: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.auth !== false) {
    const token = authToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${apiBase()}${path}`, { ...init, headers });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const err = (await res.json()) as { error?: string };
      if (err.error) msg = err.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

const REST: Record<string, (args?: Json) => Promise<unknown>> = {
  auth_login: async (args) =>
    apiFetch("/api/auth/login", {
      method: "POST",
      auth: false,
      body: JSON.stringify({
        username: args?.username,
        password: args?.password,
        rememberMe: args?.rememberMe ?? args?.remember_me,
      }),
    }),
  auth_resume: async (args) =>
    apiFetch("/api/auth/resume", {
      method: "POST",
      auth: false,
      body: JSON.stringify({ token: args?.token }),
    }),
  auth_logout: async (args) =>
    apiFetch("/api/auth/logout", {
      method: "POST",
      body: JSON.stringify({ token: args?.token }),
    }),
  auth_whoami: async () => apiFetch("/api/auth/whoami"),
  applied_list: async () => apiFetch("/api/applied"),
  applied_create: async (args) =>
    apiFetch("/api/applied", { method: "POST", body: JSON.stringify(args) }),
  applied_update: async (args) =>
    apiFetch(`/api/applied/${args?.id}`, { method: "PUT", body: JSON.stringify(args) }),
  applied_delete: async (args) =>
    apiFetch(`/api/applied/${args?.id}`, { method: "DELETE" }),
  code_list: async () => apiFetch("/api/code"),
  code_create: async (args) =>
    apiFetch("/api/code", { method: "POST", body: JSON.stringify(args) }),
  code_update: async (args) =>
    apiFetch(`/api/code/${args?.id}`, { method: "PUT", body: JSON.stringify(args) }),
  code_delete: async (args) =>
    apiFetch(`/api/code/${args?.id}`, { method: "DELETE" }),
  ai_get_openai_profile: async () => apiFetch("/api/ai/openai-profile"),
  ai_save_openai_api_key: async (args) => {
    await apiFetch("/api/ai/openai-key", {
      method: "POST",
      body: JSON.stringify({ apiKey: args?.apiKey }),
    });
    return apiFetch("/api/ai/openai-profile");
  },
  ai_test_openai_api_key: async () =>
    apiFetch("/api/ai/openai-key/test", { method: "POST" }),
  auth_export_users_csv: async () => {
    await downloadCsv("/api/auth/users/export.csv", `auth_users_${Date.now()}.csv`);
    return "";
  },
  auth_upsert_user_role: async (args) => {
    await apiFetch("/api/auth/users/upsert", {
      method: "POST",
      body: JSON.stringify({
        username: args?.username,
        role: args?.role,
      }),
    });
  },
  auth_bulk_apply_csv: async (args) => {
    const dryRun = args?.dryRun === true;
    const csvText = String(args?.csvText ?? "");
    return apiFetch(`/api/auth/users/bulk?dryRun=${dryRun ? "true" : "false"}`, {
      method: "POST",
      headers: { "Content-Type": "text/csv" },
      body: csvText,
    });
  },
};

export async function appInvoke<T>(cmd: string, args?: Json): Promise<T> {
  if (isTauri()) {
    return invoke<T>(cmd, args);
  }
  const handler = REST[cmd];
  if (!handler) {
    throw new Error(`Web API not implemented for command: ${cmd}`);
  }
  return (await handler(args)) as T;
}

export async function downloadCsv(path: string, filename: string): Promise<void> {
  const headers = new Headers();
  const token = authToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${apiBase()}${path}`, { headers });
  if (!res.ok) throw new Error(await res.text());
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function uploadCsv(path: string, file: File): Promise<{ inserted: number }> {
  const headers = new Headers();
  const token = authToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const body = await file.arrayBuffer();
  const res = await fetch(`${apiBase()}${path}`, {
    method: "POST",
    headers,
    body,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{ inserted: number }>;
}

export function isWebDataMode(): boolean {
  return !isTauri();
}
