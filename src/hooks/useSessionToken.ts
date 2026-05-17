import { useAuth } from "../auth/AuthProvider";

/** Current session token for scoped API / invoke calls. Empty when not logged in. */
export function useSessionToken(): string {
  const { state } = useAuth();
  return state.status === "authed" ? state.token : "";
}
