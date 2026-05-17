// src/auth/AuthProvider.tsx
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { appInvoke } from "../api/client";
import { isTauri, setAuthToken } from "../api/runtime";

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

export function AuthProvider(props: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    const token = localStorage.getItem("easyapply.auth.token");
    if (!token) {
      setState({ status: "unauth" });
      return;
    }
    appInvoke<{ token: string; user: AuthUserInfo }>("auth_resume", { token })
      .then((res) => setState({ status: "authed", token: res.token, user: res.user }))
      .catch(() => {
        setAuthToken(null);
        setState({ status: "unauth" });
      });
  }, []);

  const login = async (username: string, password: string, rememberMe: boolean) => {
    const res = await appInvoke<{ token: string; user: AuthUserInfo }>("auth_login", {
      username,
      password,
      rememberMe,
    });
    setState({ status: "authed", token: res.token, user: res.user });
    if (rememberMe || !isTauri()) setAuthToken(res.token);
    else setAuthToken(null);
  };

  const logout = async () => {
    if (state.status === "authed") {
      await appInvoke("auth_logout", { token: state.token }).catch(() => { });
    }
    setAuthToken(null);
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