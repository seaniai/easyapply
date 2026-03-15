// src/auth/AuthManager.tsx
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import en from "../i18n/en.json";
import zh from "../i18n/zh.json";

type ValidationReport = {
  ok: boolean;
  rows: number;
  errors: string[];
  warnings: string[];
};

type ApplyResult = {
  applied: boolean;
  rows: number;
  inserted: number;
  updated: number;
  deleted: number;
  skipped: number;
  warnings: string[];
};

type BulkResponse = ValidationReport | ApplyResult;

// Backend commands (Rust / Tauri)
const CMD_EXPORT = "auth_export_users_csv";
const CMD_UPSERT = "auth_upsert_user_role";
const CMD_BULK = "auth_bulk_apply_csv";

type LanguageKey = "en" | "zh";

const LANGUAGE_STORAGE_KEY = "easyapply-language";

const I18N_BUNDLES = {
  en,
  zh,
} as const;

function isLanguageKey(x: unknown): x is LanguageKey {
  return x === "en" || x === "zh";
}

function readSavedLanguage(): LanguageKey {
  const raw = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return isLanguageKey(raw) ? raw : "en";
}

function getByPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function normaliseRole(s: string) {
  return s.trim().toLowerCase();
}

function isValidationReport(x: any): x is ValidationReport {
  return x && typeof x === "object" && typeof x.ok === "boolean" && Array.isArray(x.errors);
}

function isApplyResult(x: any): x is ApplyResult {
  return x && typeof x === "object" && typeof x.applied === "boolean" && typeof x.inserted === "number";
}

function basename(p: string) {
  const s = p.replaceAll("\\", "/");
  const i = s.lastIndexOf("/");
  return i >= 0 ? s.slice(i + 1) : s;
}

type ConfirmState =
  | null
  | { kind: "export"; payload: { folderPath: string } }
  | { kind: "single"; payload: { username: string; role: string } }
  | { kind: "bulk-validate"; payload: { absPath: string } }
  | { kind: "bulk-apply"; payload: { absPath: string } };

export default function AuthManager(props: { allowedRoles?: string[] }) {
  const [language, setLanguage] = useState<LanguageKey>(() => readSavedLanguage());

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === LANGUAGE_STORAGE_KEY) {
        setLanguage(readSavedLanguage());
      }
    };

    const onFocus = () => {
      setLanguage(readSavedLanguage());
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const messages = I18N_BUNDLES[language];

  const t = useMemo(() => {
    return (key: string, params?: Record<string, string | number>): string => {
      const raw = getByPath(messages, key);
      if (typeof raw !== "string") return key;

      if (!params) return raw;

      return raw.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`));
    };
  }, [messages]);

  const allowedRoles = useMemo(() => {
    const base = props.allowedRoles?.length ? props.allowedRoles : ["Admin", "User"];
    return base;
  }, [props.allowedRoles]);

  const validateRoleInput = (
    roleRaw: string
  ): { ok: boolean; roleNorm: string; err?: string } => {
    const r = normaliseRole(roleRaw);
    if (!r) {
      return {
        ok: false,
        roleNorm: r,
        err: t("auth_manager.messages.role_required"),
      };
    }

    if (r === "delete") return { ok: true, roleNorm: r };

    const allowedNorm = allowedRoles.map((x) => normaliseRole(x));
    if (!allowedNorm.includes(r)) {
      return {
        ok: false,
        roleNorm: r,
        err: t("auth_manager.messages.role_not_allowed", {
          roleRaw,
          allowedRoles: allowedRoles.join(", "),
        }),
      };
    }

    return { ok: true, roleNorm: r };
  };

  const [exportFolder, setExportFolder] = useState("");
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [busyExport, setBusyExport] = useState(false);

  const [username, setUsername] = useState("");
  const [rolePick, setRolePick] = useState<string>("User");
  const [singleMsg, setSingleMsg] = useState<string | null>(null);
  const [busySingle, setBusySingle] = useState(false);

  const [bulkCsvPath, setBulkCsvPath] = useState<string>("");
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [busyBulk, setBusyBulk] = useState(false);
  const [bulkReport, setBulkReport] = useState<ValidationReport | null>(null);
  const [bulkApplyRes, setBulkApplyRes] = useState<ApplyResult | null>(null);

  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const closeConfirm = () => setConfirm(null);

  useEffect(() => {
    if (!confirm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeConfirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirm]);

  const pickExportFolder = async () => {
    setExportMsg(null);

    const picked = await open({
      multiple: false,
      directory: true,
    });

    if (!picked) return;

    const folderPath = Array.isArray(picked) ? picked[0] : picked;
    if (typeof folderPath !== "string" || !folderPath.trim()) {
      setExportMsg(t("auth_manager.messages.invalid_folder_path"));
      return;
    }

    setExportFolder(folderPath);
    setExportMsg(t("auth_manager.messages.folder_selected_export_ready"));
  };

  const requestExport = () => {
    setExportMsg(null);
    const folderPath = exportFolder.trim();
    if (!folderPath) {
      setExportMsg(t("auth_manager.messages.please_select_folder_first"));
      return;
    }
    setConfirm({ kind: "export", payload: { folderPath } });
  };

  const requestSingle = () => {
    setSingleMsg(null);
    const u = username.trim();
    if (!u) {
      setSingleMsg(t("auth_manager.messages.username_required"));
      return;
    }

    const v = validateRoleInput(rolePick);
    if (!v.ok) {
      setSingleMsg(v.err ?? t("auth_manager.messages.role_validation_failed"));
      return;
    }

    setConfirm({ kind: "single", payload: { username: u, role: rolePick } });
  };

  const pickCsvFile = async () => {
    setBulkMsg(null);
    setBulkReport(null);
    setBulkApplyRes(null);

    const picked = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });

    if (!picked) return;

    const absPath = Array.isArray(picked) ? picked[0] : picked;
    if (typeof absPath !== "string" || !absPath.trim()) {
      setBulkMsg(t("auth_manager.messages.invalid_csv_path"));
      return;
    }

    setBulkCsvPath(absPath);
    setBulkMsg(
      t("auth_manager.messages.csv_selected_validate_first", {
        fileName: basename(absPath),
      })
    );
  };

  const requestBulkValidate = () => {
    setBulkMsg(null);
    setBulkReport(null);
    setBulkApplyRes(null);

    const p = bulkCsvPath.trim();
    if (!p) {
      setBulkMsg(t("auth_manager.messages.please_select_csv_first"));
      return;
    }
    setConfirm({ kind: "bulk-validate", payload: { absPath: p } });
  };

  const requestBulkApply = () => {
    setBulkMsg(null);
    setBulkApplyRes(null);

    const p = bulkCsvPath.trim();
    if (!p) {
      setBulkMsg(t("auth_manager.messages.please_select_csv_first"));
      return;
    }
    if (!bulkReport) {
      setBulkMsg(t("auth_manager.messages.please_validate_first"));
      return;
    }
    if (!bulkReport.ok) {
      setBulkMsg(t("auth_manager.messages.validation_failed_fix_before_apply"));
      return;
    }
    setConfirm({ kind: "bulk-apply", payload: { absPath: p } });
  };

  const doConfirm = async () => {
    const c = confirm;
    setConfirm(null);
    if (!c) return;

    if (c.kind === "export") {
      setBusyExport(true);
      setExportMsg(null);
      try {
        const savedPath = await invoke<string>(CMD_EXPORT, {
          folderPath: c.payload.folderPath,
        });
        setExportMsg(
          t("auth_manager.messages.exported", { path: savedPath })
        );
      } catch (e) {
        setExportMsg(
          t("auth_manager.messages.export_failed", { error: String(e) })
        );
      } finally {
        setBusyExport(false);
      }
      return;
    }

    if (c.kind === "single") {
      setBusySingle(true);
      setSingleMsg(null);
      try {
        await invoke(CMD_UPSERT, {
          username: c.payload.username,
          role: c.payload.role,
        });
        setSingleMsg(t("auth_manager.messages.applied_successfully"));
      } catch (e) {
        setSingleMsg(
          t("auth_manager.messages.apply_failed", { error: String(e) })
        );
      } finally {
        setBusySingle(false);
      }
      return;
    }

    if (c.kind === "bulk-validate") {
      setBusyBulk(true);
      setBulkMsg(null);
      setBulkReport(null);
      setBulkApplyRes(null);

      try {
        const res = await invoke<BulkResponse>(CMD_BULK, {
          absPath: c.payload.absPath,
          dryRun: true,
        });

        if (!isValidationReport(res)) {
          setBulkMsg(t("auth_manager.messages.unexpected_dryrun_shape"));
          return;
        }

        setBulkReport(res);

        if (res.ok) {
          const warningsPart = res.warnings?.length
            ? ` Warnings: ${res.warnings.length}.`
            : "";
          setBulkMsg(
            t("auth_manager.messages.validation_ok", {
              rows: res.rows,
              warningsPart,
            })
          );
        } else {
          setBulkMsg(
            t("auth_manager.messages.validation_failed", {
              count: res.errors.length,
            })
          );
        }
      } catch (e) {
        setBulkMsg(
          t("auth_manager.messages.validate_failed", { error: String(e) })
        );
      } finally {
        setBusyBulk(false);
      }
      return;
    }

    if (c.kind === "bulk-apply") {
      setBusyBulk(true);
      setBulkMsg(null);
      setBulkApplyRes(null);

      try {
        const res = await invoke<BulkResponse>(CMD_BULK, {
          absPath: c.payload.absPath,
          dryRun: false,
        });

        if (isApplyResult(res)) {
          setBulkApplyRes(res);
          setBulkMsg(
            t("auth_manager.messages.applied_summary", {
              rows: res.rows,
              inserted: res.inserted,
              updated: res.updated,
              deleted: res.deleted,
              skipped: res.skipped,
            })
          );
        } else if (isValidationReport(res)) {
          setBulkReport(res);
          setBulkMsg(
            t("auth_manager.messages.apply_blocked_by_validation", {
              count: res.errors.length,
            })
          );
        } else {
          setBulkMsg(t("auth_manager.messages.unexpected_apply_shape"));
        }
      } catch (e) {
        setBulkMsg(
          t("auth_manager.messages.apply_failed", { error: String(e) })
        );
      } finally {
        setBusyBulk(false);
      }
      return;
    }
  };

  const confirmTitle = useMemo(() => {
    if (!confirm) return "";
    if (confirm.kind === "export") return t("auth_manager.confirm.titles.export");
    if (confirm.kind === "single") return t("auth_manager.confirm.titles.single");
    if (confirm.kind === "bulk-validate") return t("auth_manager.confirm.titles.bulk_validate");
    return t("auth_manager.confirm.titles.bulk_apply");
  }, [confirm, t]);

  const confirmBody = useMemo(() => {
    if (!confirm) return null;

    if (confirm.kind === "export") {
      return (
        <>
          <div className="settings__hint" style={{ marginTop: 0 }}>
            {t("auth_manager.confirm.body.export_intro")}
          </div>
          <div className="settings__hint">
            <code>{confirm.payload.folderPath}</code>
          </div>
        </>
      );
    }

    if (confirm.kind === "single") {
      const u = confirm.payload.username;
      const r = confirm.payload.role;
      const isDel = normaliseRole(r) === "delete";

      return (
        <>
          <div className="settings__hint" style={{ marginTop: 0 }}>
            {t("auth_manager.confirm.body.single_action", {
              action: isDel ? "DELETE" : "UPSERT",
            })}
          </div>
          <div className="settings__hint">
            {t("auth_manager.confirm.body.username", { username: u })}
          </div>
          <div className="settings__hint">
            {t("auth_manager.confirm.body.role", { role: r })}
          </div>
          <div className="settings__hint">
            {t("auth_manager.confirm.body.default_password")}
          </div>
        </>
      );
    }

    if (confirm.kind === "bulk-validate") {
      return (
        <>
          <div className="settings__hint" style={{ marginTop: 0 }}>
            {t("auth_manager.confirm.body.bulk_validate_intro")}
          </div>
          <div className="settings__hint">
            <code>{confirm.payload.absPath}</code>
          </div>
        </>
      );
    }

    return (
      <>
        <div className="settings__hint" style={{ marginTop: 0 }}>
          {t("auth_manager.confirm.body.bulk_apply_intro")}
        </div>
        <div className="settings__hint">
          <code>{confirm.payload.absPath}</code>
        </div>
        <div className="settings__hint">
          {t("auth_manager.confirm.body.bulk_apply_block")}
        </div>
      </>
    );
  }, [confirm, t]);

  return (
    <div className="settings authm">
      <div className="settings__section">
        <div className="settings__section-title">
          {t("auth_manager.sections.export_users_csv")}
        </div>
        <div className="settings__hint">
          {t("auth_manager.hints.export_users_csv")}
        </div>

        <div className="settings__actions authm__actions-tight">
          <button
            className="btn"
            type="button"
            onClick={() => pickExportFolder().catch((e) => setExportMsg(String(e)))}
            disabled={busyExport}
          >
            {t("auth_manager.actions.select_folder")}
          </button>

          <button
            className="btn btn--primary"
            type="button"
            onClick={requestExport}
            disabled={busyExport || !exportFolder.trim()}
          >
            {t("auth_manager.actions.export_database")}
          </button>
        </div>

        {exportFolder.trim() && (
          <div className="settings__hint authm__msg">
            {t("auth_manager.report.selected")}: <code>{exportFolder}</code>
          </div>
        )}

        {exportMsg && <div className="settings__hint authm__msg">{exportMsg}</div>}
      </div>

      <div className="settings__section">
        <div className="settings__section-title">
          {t("auth_manager.sections.upsert_delete_user")}
        </div>
        <div className="settings__hint">
          {t("auth_manager.hints.upsert_delete_user")}
        </div>

        <div className="settings__row">
          <div className="settings__label">
            {t("auth_manager.fields.username")}
          </div>
          <input
            className="settings__control"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={t("auth_manager.placeholders.username")}
            disabled={busySingle}
          />
        </div>

        <div className="settings__row">
          <div className="settings__label">
            {t("auth_manager.fields.role")}
          </div>
          <select
            className="settings__control"
            value={rolePick}
            onChange={(e) => setRolePick(e.target.value)}
            disabled={busySingle}
          >
            {allowedRoles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
            <option value="Delete">Delete</option>
          </select>
        </div>

        <div className="settings__actions">
          <button
            className="btn btn--primary"
            type="button"
            onClick={requestSingle}
            disabled={busySingle}
          >
            {t("auth_manager.actions.apply")}
          </button>
        </div>

        {singleMsg && <div className="settings__hint authm__msg">{singleMsg}</div>}
      </div>

      <div className="settings__section">
        <div className="settings__section-title">
          {t("auth_manager.sections.bulk_apply_csv")}
        </div>
        <div className="settings__hint">
          {t("auth_manager.hints.bulk_apply_csv")}
        </div>

        <div className="settings__actions authm__actions-tight">
          <button
            className="btn"
            type="button"
            onClick={() => pickCsvFile().catch((e) => setBulkMsg(String(e)))}
            disabled={busyBulk}
          >
            {t("auth_manager.actions.select")}
          </button>

          <button
            className="btn"
            type="button"
            onClick={requestBulkValidate}
            disabled={busyBulk || !bulkCsvPath.trim()}
          >
            {t("auth_manager.actions.validate")}
          </button>

          <button
            className="btn btn--primary"
            type="button"
            onClick={requestBulkApply}
            disabled={busyBulk || !bulkCsvPath.trim() || !bulkReport?.ok}
          >
            {t("auth_manager.actions.apply_csv")}
          </button>
        </div>

        {bulkCsvPath.trim() && (
          <div className="settings__hint authm__msg">
            {t("auth_manager.report.selected")}: <code>{basename(bulkCsvPath)}</code>
          </div>
        )}

        {bulkMsg && <div className="settings__hint authm__msg">{bulkMsg}</div>}

        {bulkReport && (
          <div className="settings__hint authm__msg">
            <div style={{ fontWeight: 650, marginTop: 8 }}>
              {t("auth_manager.report.validation_report")}
            </div>
            <div>
              {t("auth_manager.report.ok")}: {String(bulkReport.ok)}
            </div>
            <div>
              {t("auth_manager.report.rows")}: {bulkReport.rows}
            </div>
            {bulkReport.warnings?.length ? (
              <div>
                {t("auth_manager.report.warnings")}: {bulkReport.warnings.length}
              </div>
            ) : null}
            {bulkReport.errors?.length ? (
              <div>
                {t("auth_manager.report.errors")}: {bulkReport.errors.length}
              </div>
            ) : null}
            {bulkReport.warnings?.length
              ? `\nWarnings:\n- ${bulkReport.warnings.join("\n- ")}`
              : ""}
            {bulkReport.errors?.length
              ? `\n\nErrors:\n- ${bulkReport.errors.join("\n- ")}`
              : ""}
          </div>
        )}

        {bulkApplyRes && (
          <div className="settings__hint authm__msg">
            <div style={{ fontWeight: 650, marginTop: 8 }}>
              {t("auth_manager.report.apply_result")}
            </div>
            <div>
              {t("auth_manager.report.applied")}: {String(bulkApplyRes.applied)}
            </div>
            <div>
              {t("auth_manager.report.rows")}: {bulkApplyRes.rows}
            </div>
            <div>
              {t("auth_manager.report.inserted")}: {bulkApplyRes.inserted}
            </div>
            <div>
              {t("auth_manager.report.updated")}: {bulkApplyRes.updated}
            </div>
            <div>
              {t("auth_manager.report.deleted")}: {bulkApplyRes.deleted}
            </div>
            <div>
              {t("auth_manager.report.skipped")}: {bulkApplyRes.skipped}
            </div>
            {bulkApplyRes.warnings?.length
              ? `\nWarnings:\n- ${bulkApplyRes.warnings.join("\n- ")}`
              : ""}
          </div>
        )}
      </div>

      {confirm && (
        <div
          className="calc__modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={confirmTitle}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeConfirm();
          }}
        >
          <div
            className="calc__modal calc__modal--sm"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="calc__modal-head">
              <h3 className="calc__modal-title">{confirmTitle}</h3>
            </div>

            <div className="calc__modal-body">
              {confirmBody}
              <div className="calc__actions" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={doConfirm}
                >
                  {t("auth_manager.actions.confirm")}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={closeConfirm}
                >
                  {t("auth_manager.actions.back")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}