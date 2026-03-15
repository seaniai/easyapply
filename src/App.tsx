// easyapply: Job Applied, Code Management, Application Material.
// Settings (language, theme), Account (login, server placeholder), User Management (auth only).

import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { APP_VERSION } from "./version";
import settingIcon from "./assets/icon/setting.png";
import accountIcon from "./assets/icon/account.png";
import documentIcon from "./assets/icon/document.png";
import { useAuth } from "./auth/AuthProvider";
import AuthManager from "./auth/AuthManager";
import ServerPlugin from "./server/server";
import en from "./i18n/en.json";
import zh from "./i18n/zh.json";
import JobAppliedPanel from "./panels/JobAppliedPanel";
import CodeManagementPanel from "./panels/CodeManagementPanel";
import ApplicationMaterialPanel from "./panels/ApplicationMaterialPanel";

type LanguageKey = "en" | "zh";
type ThemeKey = "Default" | "Golden" | "Black";

type Drawer =
  | { type: "settings" }
  | { type: "account" }
  | { type: "user_management" }
  | { type: "job_applied" }
  | { type: "code_management" }
  | { type: "application_material" }
  | null;

const THEME_STORAGE_KEY = "easyapply-theme";
const LANGUAGE_STORAGE_KEY = "easyapply-language";
const LANGUAGE_CHANGE_EVENT = "easyapply-language-change";
const PANEL_WIDTH_STORAGE_KEY = "easyapply-panel-width";
const PANEL_WIDTH_MIN = 360;
const PANEL_WIDTH_DEFAULT = 420;
/** Left column (title + meta + buttons) min width so meta right edge aligns with buttons right edge. */
const CONTENT_MIN_WIDTH = 420;

function getPanelMaxWidth(): number {
  if (typeof window === "undefined") return 800;
  return Math.max(PANEL_WIDTH_MIN, window.innerWidth - CONTENT_MIN_WIDTH);
}

const I18N_BUNDLES = { en, zh } as const;

function getByPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function tFromMessages(
  messages: unknown,
  key: string,
  params?: Record<string, string | number>
): string {
  const raw = getByPath(messages, key);
  if (typeof raw !== "string") return key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`));
}

function isLanguageKey(x: unknown): x is LanguageKey {
  return x === "en" || x === "zh";
}

function readSavedLanguage(): LanguageKey {
  const raw = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return isLanguageKey(raw) ? raw : "en";
}

function writeLanguage(lang: LanguageKey) {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  window.dispatchEvent(new CustomEvent(LANGUAGE_CHANGE_EVENT, { detail: lang }));
}

function useI18n() {
  const [language, setLanguageState] = useState<LanguageKey>(() => readSavedLanguage());

  useEffect(() => {
    const onLanguageChange = () => setLanguageState(readSavedLanguage());
    const onStorage = (e: StorageEvent) => {
      if (e.key === LANGUAGE_STORAGE_KEY) setLanguageState(readSavedLanguage());
    };
    window.addEventListener(LANGUAGE_CHANGE_EVENT, onLanguageChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(LANGUAGE_CHANGE_EVENT, onLanguageChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const messages = I18N_BUNDLES[language];
  const t = useCallback(
    (key: string, params?: Record<string, string | number>) =>
      tFromMessages(messages, key, params),
    [messages]
  );
  const setLanguage = useCallback((lang: LanguageKey) => {
    writeLanguage(lang);
    setLanguageState(lang);
  }, []);

  return { language, setLanguage, t };
}

function isThemeKey(x: unknown): x is ThemeKey {
  return x === "Default" || x === "Golden" || x === "Black";
}

function readSavedTheme(): ThemeKey {
  const raw = localStorage.getItem(THEME_STORAGE_KEY);
  return isThemeKey(raw) ? raw : "Default";
}

function applyBodyTheme(tk: ThemeKey) {
  document.body.classList.remove("theme-golden", "theme-black");
  if (tk === "Golden") document.body.classList.add("theme-golden");
  if (tk === "Black") document.body.classList.add("theme-black");
}

function SettingsView(props: { disabled?: boolean }) {
  const { language, setLanguage, t } = useI18n();
  const [theme, setTheme] = useState<ThemeKey>("Default");

  const applyTheme = (tk: ThemeKey) => {
    setTheme(tk);
    applyBodyTheme(tk);
    localStorage.setItem(THEME_STORAGE_KEY, tk);
  };

  useEffect(() => {
    const saved = readSavedTheme();
    setTheme(saved);
    applyBodyTheme(saved);
  }, []);

  return (
    <div className="settings">
      <div className="settings__section">
        <div className="settings__section-title">{t("settings.sections.general")}</div>
        <div className="settings__row">
          <div className="settings__label">{t("settings.fields.language")}</div>
          <select
            className="settings__control"
            value={language}
            onChange={(e) => setLanguage(e.target.value as LanguageKey)}
            disabled={props.disabled}
          >
            <option value="en">{t("settings.options.language_english")}</option>
            <option value="zh">{t("settings.options.language_other")}</option>
          </select>
        </div>
        <div className="settings__row">
          <div className="settings__label">{t("settings.fields.theme")}</div>
          <div className="seg" role="tablist" aria-label={t("settings.fields.theme")}>
            {(["Default", "Golden", "Black"] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={`seg__btn ${theme === k ? "is-on" : ""}`}
                onClick={() => applyTheme(k)}
                role="tab"
                aria-selected={theme === k}
                disabled={props.disabled}
              >
                {k === "Default"
                  ? t("settings.options.theme_default")
                  : k === "Golden"
                    ? t("settings.options.theme_golden")
                    : t("settings.options.theme_black")}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function AccountView(props: { isLocked: boolean }) {
  const { t } = useI18n();
  const { state, login, logout } = useAuth();
  const isAuthed = state.status === "authed";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [pwOpen, setPwOpen] = useState(false);
  const [oldPw, setOldPw] = useState("");
  const [newPw1, setNewPw1] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthed) setUsername(state.user.username);
  }, [isAuthed, state]);

  const resetPwForm = () => {
    setOldPw("");
    setNewPw1("");
    setNewPw2("");
    setPwErr(null);
    setPwOk(null);
  };

  return (
    <div className="settings">
      <div className="settings__section">
        <div className="settings__section-title">
          {isAuthed ? t("account.titles.account") : t("account.titles.log_in")}
        </div>

        {isAuthed ? (
          <>
            <div className="settings__hint">{t("account.hints.signed_in_session_active")}</div>
            <div className="settings__row">
              <div className="settings__label">{t("account.fields.user")}</div>
              <input className="settings__control" value={state.user.username} disabled />
            </div>
            <div className="settings__row">
              <div className="settings__label">{t("account.fields.roles")}</div>
              <input className="settings__control" value={(state.user.roles || []).join(", ")} disabled />
            </div>
            <div className="settings__actions">
              <button
                className="btn btn--primary"
                type="button"
                onClick={async () => {
                  setErr(null);
                  setBusy(true);
                  try {
                    await logout();
                  } catch (e) {
                    setErr(String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
                disabled={busy}
              >
                {t("account.actions.log_out")}
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setPwOpen((v) => !v);
                  resetPwForm();
                }}
                disabled={busy}
              >
                {t("account.actions.change_password")}
              </button>
            </div>

            {pwOpen && (
              <>
                <div className="settings__row" style={{ marginTop: 12 }}>
                  <div className="settings__label">{t("account.fields.old_password")}</div>
                  <input
                    className="settings__control"
                    type="password"
                    value={oldPw}
                    onChange={(e) => setOldPw(e.target.value)}
                    disabled={busy}
                  />
                </div>
                <div className="settings__row">
                  <div className="settings__label">{t("account.fields.new_password")}</div>
                  <input
                    className="settings__control"
                    type="password"
                    value={newPw1}
                    onChange={(e) => setNewPw1(e.target.value)}
                    disabled={busy}
                  />
                </div>
                <div className="settings__row">
                  <div className="settings__label">{t("account.fields.confirm_new")}</div>
                  <input
                    className="settings__control"
                    type="password"
                    value={newPw2}
                    onChange={(e) => setNewPw2(e.target.value)}
                    disabled={busy}
                  />
                </div>
                {pwErr && (
                  <div className="settings__hint" style={{ color: "crimson", marginTop: 8 }}>{pwErr}</div>
                )}
                {pwOk && (
                  <div className="settings__hint" style={{ color: "seagreen", marginTop: 8 }}>{pwOk}</div>
                )}
                <div className="settings__actions" style={{ marginTop: 8 }}>
                  <button
                    className="btn btn--primary"
                    type="button"
                    disabled={
                      busy ||
                      oldPw.length === 0 ||
                      newPw1.trim().length === 0 ||
                      newPw2.trim().length === 0
                    }
                    onClick={async () => {
                      setPwErr(null);
                      setPwOk(null);
                      if (newPw1 !== newPw2) {
                        setPwErr(t("account.messages.new_password_mismatch"));
                        return;
                      }
                      if (newPw1.trim().length === 0) {
                        setPwErr(t("account.messages.new_password_required"));
                        return;
                      }
                      if (state.status !== "authed") {
                        setPwErr(t("account.messages.not_signed_in"));
                        return;
                      }
                      setBusy(true);
                      try {
                        await invoke("auth_change_password", {
                          token: state.token,
                          oldPassword: oldPw,
                          newPassword: newPw1.trim(),
                        });
                        setPwOk(t("account.messages.password_updated"));
                        setOldPw("");
                        setNewPw1("");
                        setNewPw2("");
                      } catch (e) {
                        setPwErr(String(e));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {t("account.actions.apply")}
                  </button>
                  <button className="btn" type="button" disabled={busy} onClick={() => { setPwOpen(false); resetPwForm(); }}>
                    {t("account.actions.cancel")}
                  </button>
                </div>
              </>
            )}
            {err && (
              <div className="settings__hint" style={{ color: "crimson", marginTop: "12px" }}>{err}</div>
            )}
          </>
        ) : (
          <>
            <div className="settings__hint">{t("account.hints.enter_credentials")}</div>
            <div className="settings__row">
              <div className="settings__label">{t("account.fields.username")}</div>
              <input
                className="settings__control"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="settings__row">
              <div className="settings__label">{t("account.fields.password")}</div>
              <input
                className="settings__control"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="settings__row">
              <div className="settings__label">{t("account.fields.remember_me")}</div>
              <button
                type="button"
                className={`switch ${rememberMe ? "is-on" : ""}`}
                onClick={() => setRememberMe((v) => !v)}
                aria-pressed={rememberMe}
                disabled={busy}
              >
                <span className="switch__knob" />
              </button>
            </div>
            {err && (
              <div className="settings__hint" style={{ color: "crimson" }}>{err}</div>
            )}
            <div className="settings__actions">
              <button
                className="btn btn--primary"
                type="button"
                disabled={busy || username.trim().length === 0 || password.length === 0}
                onClick={async () => {
                  setErr(null);
                  setBusy(true);
                  try {
                    await login(username.trim(), password, rememberMe);
                    setPassword("");
                  } catch (e) {
                    setErr(String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t("account.actions.sign_in")}
              </button>
            </div>
          </>
        )}
        {props.isLocked && !isAuthed && (
          <div className="settings__hint" style={{ marginTop: "12px" }}>
            {t("account.hints.navigation_locked")}
          </div>
        )}
      </div>
      <ServerPlugin disabled={busy} t={t} />
    </div>
  );
}

function UserManagementView(_props: { disabled?: boolean }) {
  const { t } = useI18n();
  const { state } = useAuth();
  const isAuthed = state.status === "authed";
  const isAdmin = isAuthed && (state.user.roles || []).includes("Admin");

  return (
    <div className="settings">
      <div className="settings__section">
        <div className="settings__section-title">{t("settings.sections.user_management")}</div>
        {!isAuthed ? (
          <div className="settings__hint">{t("user_management.hints.sign_in_to_view")}</div>
        ) : !isAdmin ? (
          <div className="settings__hint">{t("user_management.hints.admin_required")}</div>
        ) : (
          <AuthManager />
        )}
      </div>
    </div>
  );
}

export default function App() {
  const { t } = useI18n();
  const [timeStr, setTimeStr] = useState("");
  const { state } = useAuth();
  const isLocked = state.status !== "authed";

  useEffect(() => {
    applyBodyTheme(readSavedTheme());
  }, []);

  useEffect(() => {
    const fmt = new Intl.DateTimeFormat("en-NZ", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZoneName: "short",
    });
    const update = () => setTimeStr(fmt.format(new Date()));
    update();
    const id = setInterval(update, 60000);
    return () => clearInterval(id);
  }, []);

  const [drawer, setDrawer] = useState<Drawer>(null);
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    const v = localStorage.getItem(PANEL_WIDTH_STORAGE_KEY);
    const n = v ? parseInt(v, 10) : PANEL_WIDTH_DEFAULT;
    const maxW = getPanelMaxWidth();
    return Number.isFinite(n) ? Math.max(PANEL_WIDTH_MIN, Math.min(maxW, n)) : PANEL_WIDTH_DEFAULT;
  });
  const [resizing, setResizing] = useState(false);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);
  const latestPanelWidth = useRef(panelWidth);

  useEffect(() => {
    if (isLocked) setDrawer({ type: "account" });
  }, [isLocked]);

  latestPanelWidth.current = panelWidth;

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      const delta = resizeStartX.current - e.clientX;
      const maxW = getPanelMaxWidth();
      const newW = Math.max(PANEL_WIDTH_MIN, Math.min(maxW, resizeStartW.current + delta));
      setPanelWidth(newW);
    };
    const onUp = () => {
      setResizing(false);
      localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(latestPanelWidth.current));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [resizing]);

  useEffect(() => {
    const onResize = () => {
      const maxW = getPanelMaxWidth();
      setPanelWidth((w) => (w > maxW ? maxW : w));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizeStartX.current = e.clientX;
    resizeStartW.current = panelWidth;
    setResizing(true);
  }, [panelWidth]);

  const openSettings = () => {
    if (isLocked) return;
    setDrawer({ type: "settings" });
  };
  const openAccount = () => setDrawer({ type: "account" });
  const openUserManagement = () => {
    if (isLocked) return;
    setDrawer({ type: "user_management" });
  };
  const openJobApplied = () => {
    if (isLocked) return;
    setDrawer({ type: "job_applied" });
  };
  const openCodeManagement = () => {
    if (isLocked) return;
    setDrawer({ type: "code_management" });
  };
  const openApplicationMaterial = () => {
    if (isLocked) return;
    setDrawer({ type: "application_material" });
  };

  const onClose = () => {
    if (isLocked) return;
    setDrawer(null);
  };

  const panelTitle = drawer
    ? drawer.type === "settings"
      ? t("app.panel.title.settings")
      : drawer.type === "account"
        ? t("app.panel.title.account")
        : drawer.type === "user_management"
          ? t("app.panel.title.user_management")
          : drawer.type === "job_applied"
            ? t("app.panel.title.job_applied")
            : drawer.type === "code_management"
              ? t("app.panel.title.code_management")
              : t("app.panel.title.application_material")
    : "";

  const panelKicker = drawer
    ? drawer.type === "settings"
      ? t("app.panel.kicker.application")
      : drawer.type === "account"
        ? t("app.panel.kicker.user")
        : drawer.type === "user_management"
          ? t("app.panel.kicker.user_management")
          : t("app.panel.kicker.application")
    : "";

  const panelSummary = drawer
    ? drawer.type === "settings"
      ? t("app.panel.summary.settings")
      : drawer.type === "account"
        ? isLocked
          ? t("app.panel.summary.account_locked")
          : t("app.panel.summary.account_unlocked")
        : drawer.type === "user_management"
          ? t("app.panel.summary.user_management")
          : drawer.type === "job_applied"
            ? t("app.panel.summary.job_applied")
            : drawer.type === "code_management"
              ? t("app.panel.summary.code_management")
              : t("app.panel.summary.application_material")
    : "";

  return (
    <main className="app">
      <div className="app__content">
        <header className="app__header">
          <div className="app__header-main">
            <h1 className="app__title">{t("app.title")}</h1>
            <p className="app__subtitle">{t("app.subtitle")}</p>
          </div>
          <div className="app__utilities">
            <button className="util-btn" type="button" onClick={openSettings} disabled={isLocked} title={t("app.panel.title.settings")}>
              <img src={settingIcon} alt="" />
            </button>
            <button className="util-btn" type="button" onClick={openAccount} title={t("app.panel.title.account")}>
              <img src={accountIcon} alt="" />
            </button>
            <button className="util-btn" type="button" onClick={openUserManagement} disabled={isLocked} title={t("app.panel.title.user_management")}>
              <img src={documentIcon} alt="" />
            </button>
          </div>
        </header>

        <div className="app__meta">
          <div>{t("app.meta.time")}: {timeStr}</div>
          <div>{t("app.meta.version")}: {APP_VERSION}</div>
        </div>

        <section className="app__main">
          <button
            type="button"
            className="main-btn main-btn--primary"
            onClick={openJobApplied}
            disabled={isLocked}
          >
            {t("app.main.job_applied")}
          </button>
          <button
            type="button"
            className="main-btn main-btn--primary"
            onClick={openCodeManagement}
            disabled={isLocked}
          >
            {t("app.main.code_management")}
          </button>
          <button
            type="button"
            className="main-btn main-btn--primary"
            onClick={openApplicationMaterial}
            disabled={isLocked}
          >
            {t("app.main.application_material")}
          </button>
        </section>
      </div>

      {drawer ? (
        <>
          <div
            className="panel-resize-handle"
            role="separator"
            aria-label="Resize panel"
            onMouseDown={onResizeStart}
          />
          <aside className="panel" style={{ width: panelWidth }} aria-hidden={false}>
            <div className="panel__header">
              <div className="panel__kicker">{panelKicker}</div>
              <div className="panel__title">{panelTitle}</div>
              <div className="panel__summary">{panelSummary}</div>
            </div>
            <div className="panel__body">
              {drawer.type === "settings" && <SettingsView disabled={isLocked} />}
              {drawer.type === "account" && <AccountView isLocked={isLocked} />}
              {drawer.type === "user_management" && <UserManagementView disabled={isLocked} />}
              {drawer.type === "job_applied" && <JobAppliedPanel t={t} disabled={isLocked} />}
              {drawer.type === "code_management" && <CodeManagementPanel t={t} disabled={isLocked} />}
              {drawer.type === "application_material" && <ApplicationMaterialPanel t={t} disabled={isLocked} />}
            </div>
            <div className="panel__footer">
              <button className="btn" onClick={onClose} disabled={isLocked}>
                {t("app.panel.actions.back")}
              </button>
            </div>
          </aside>
        </>
      ) : null}
    </main>
  );
}
