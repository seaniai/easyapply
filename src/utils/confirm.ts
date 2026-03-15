/**
 * Show a confirmation dialog. Uses Tauri native dialog when available;
 * if it times out or throws, falls back to window.confirm.
 * Logs to console with [easyapply] prefix when debugging (see README Development section).
 */
import { confirm as tauriConfirm } from "@tauri-apps/plugin-dialog";

const CONFIRM_TIMEOUT_MS = 4000;
const LOG = (msg: string, ...args: unknown[]) => console.log("[easyapply]", msg, ...args);

export async function confirmAction(message: string, options?: { title?: string }): Promise<boolean> {
  const title = options?.title ?? "easyapply";
  LOG("confirmAction: start", { message: message.slice(0, 50) + "..." });

  const tauriPromise = tauriConfirm(message, { title, kind: "warning" });
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("confirm_timeout")), CONFIRM_TIMEOUT_MS)
  );

  let result: boolean;
  try {
    result = await Promise.race([tauriPromise, timeoutPromise]);
    LOG("confirmAction: tauri returned", result);
  } catch (e) {
    const isTimeout = e instanceof Error && e.message === "confirm_timeout";
    LOG(isTimeout ? "confirmAction: timeout, fallback to window.confirm" : "confirmAction: tauri failed", e);
    result = window.confirm(message);
    LOG("confirmAction: fallback result", result);
  }

  LOG("confirmAction: result", result);
  return result;
}
