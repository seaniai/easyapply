// src/auth/AuthProvider.tsx
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export type AuthUserInfo = {
  user_id: number;
  username: string;
  roles: string[];
  permissions: string[];
};

type Authed = { status: "authed"; token: string; user: AuthUserInfo };
type Unauth = { status: "unauth" };
type Loading = { status: "loading" };
export type AuthState = Authed | Unauth | Loading;

type AuthCtx = {
  state: AuthState;
  login: (username: string, password: string, rememberMe: boolean) => Promise<void>;
  logout: () => Promise<void>;
  hasPerm: (key: string) => boolean;
};

const Ctx = createContext<AuthCtx | null>(null);

const LS_TOKEN = "easyapply.auth.token";

export function AuthProvider(props: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    const token = localStorage.getItem(LS_TOKEN);
    if (!token) {
      setState({ status: "unauth" });
      return;
    }
    invoke<any>("auth_resume", { token })
      .then((res) => setState({ status: "authed", token: res.token, user: res.user }))
      .catch(() => {
        localStorage.removeItem(LS_TOKEN);
        setState({ status: "unauth" });
      });
  }, []);

  const login = async (username: string, password: string, rememberMe: boolean) => {
    const res = await invoke<any>("auth_login", { username, password, rememberMe });
    setState({ status: "authed", token: res.token, user: res.user });
    if (rememberMe) localStorage.setItem(LS_TOKEN, res.token);
    else localStorage.removeItem(LS_TOKEN);
  };

  const logout = async () => {
    if (state.status === "authed") {
      await invoke("auth_logout", { token: state.token }).catch(() => { });
    }
    localStorage.removeItem(LS_TOKEN);
    setState({ status: "unauth" });
  };

  const hasPerm = (key: string) => {
    if (state.status !== "authed") return false;
    const perms = state.user.permissions || [];
    return perms.includes("*") || perms.includes(key);
  };

  const value = useMemo<AuthCtx>(() => ({ state, login, logout, hasPerm }), [state]);

  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}