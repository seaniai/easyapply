import { useEffect, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { confirmAction } from "../utils/confirm";

const LOG = (msg: string, ...args: unknown[]) => console.log("[easyapply]", msg, ...args);

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

type CodeRow = {
  id: number;
  account: string;
  username: string;
  password: string;
  tel: string;
  email: string;
  comments: string;
};

const emptyRow = (): CodeRow => ({
  id: 0,
  account: "",
  username: "",
  password: "",
  tel: "",
  email: "",
  comments: "",
});

const DEFAULT_COL_WIDTHS = [100, 100, 90, 100, 120, 150];
const MIN_COL_WIDTH = 40;

export default function CodeManagementPanel(props: { t: TranslateFn; disabled?: boolean }) {
  const { t, disabled } = props;
  const [rows, setRows] = useState<CodeRow[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState<CodeRow>(emptyRow());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [colWidths, setColWidths] = useState<number[]>(() => DEFAULT_COL_WIDTHS);
  const [resizingCol, setResizingCol] = useState<number | null>(null);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);

  const load = useCallback(async () => {
    try {
      const list = await invoke<CodeRow[]>("code_list");
      setRows(list);
      if (selectedId !== null && !list.some((r) => r.id === selectedId)) {
        setSelectedId(null);
        setForm(emptyRow());
      } else if (selectedId !== null) {
        const r = list.find((x) => x.id === selectedId);
        if (r) setForm({ ...r });
      }
    } catch (e) {
      setMessage(t("app.alerts.load_failed", { error: String(e) }));
    }
  }, [selectedId, t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (resizingCol === null) return;
    const onMove = (e: MouseEvent) => {
      const delta = e.clientX - resizeStartX.current;
      const newW = Math.max(MIN_COL_WIDTH, resizeStartW.current + delta);
      setColWidths((prev) => {
        const next = [...prev];
        next[resizingCol] = newW;
        return next;
      });
    };
    const onUp = () => setResizingCol(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [resizingCol]);

  const startResize = (colIndex: number, e: React.MouseEvent) => {
    e.preventDefault();
    resizeStartX.current = e.clientX;
    resizeStartW.current = colWidths[colIndex];
    setResizingCol(colIndex);
  };

  const select = (r: CodeRow) => {
    setSelectedId(r.id);
    setForm({ ...r });
  };

  const clear = () => {
    setForm(emptyRow());
    setSelectedId(null);
  };

  const save = async () => {
    LOG("save() called", { disabled, busy, formId: form.id });
    if (disabled || busy) return;
    const isUpdate = !!form.id;
    const msg = isUpdate ? t("code_management.update_confirm") : t("code_management.save_confirm");
    const ok = await confirmAction(msg);
    LOG("save: confirm result", ok);
    if (!ok) return;
    setMessage(null);
    setBusy(true);
    try {
      LOG("save: invoking backend", isUpdate ? "update" : "create");
      if (form.id) {
        await invoke("code_update", {
          id: form.id,
          account: form.account,
          username: form.username,
          password: form.password,
          tel: form.tel,
          email: form.email,
          comments: form.comments,
        });
      } else {
        await invoke("code_create", {
          account: form.account,
          username: form.username,
          password: form.password,
          tel: form.tel,
          email: form.email,
          comments: form.comments,
        });
      }
      await load();
      setForm(emptyRow());
      setSelectedId(null);
      LOG("save: done");
    } catch (e) {
      LOG("save: error", e);
      setMessage(t("app.alerts.save_failed", { error: String(e) }));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    LOG("remove() called", { formId: form.id, disabled, busy });
    if (!form.id || disabled || busy) return;
    const ok = await confirmAction(t("code_management.delete_confirm"));
    LOG("remove: confirm result", ok);
    if (!ok) return;
    setBusy(true);
    setMessage(null);
    try {
      LOG("remove: invoking code_delete");
      await invoke("code_delete", { id: form.id });
      await load();
      setForm(emptyRow());
      setSelectedId(null);
      LOG("remove: done");
    } catch (e) {
      LOG("remove: error", e);
      setMessage(t("app.alerts.save_failed", { error: String(e) }));
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    if (disabled || busy) return;
    setMessage(null);
    try {
      const dir = await invoke<string | null>("pick_export_folder");
      if (!dir) return;
      const path = await invoke<string>("code_export_csv", { dir });
      setMessage(t("auth_manager.messages.exported", { path }));
    } catch (e) {
      setMessage(t("app.alerts.export_failed", { error: String(e) }));
    }
  };

  const importCsv = async () => {
    LOG("importCsv() called", { disabled, busy });
    if (disabled || busy) return;
    const ok = await confirmAction(t("code_management.import_confirm"));
    LOG("importCsv: confirm result", ok);
    if (!ok) return;
    setMessage(null);
    try {
      LOG("importCsv: opening file picker");
      const filePath = await invoke<string | null>("pick_file_csv");
      if (!filePath) return;
      LOG("importCsv: invoking code_import_csv");
      const res = await invoke<{ inserted: number }>("code_import_csv", { filePath });
      setMessage(`${t("auth_manager.report.inserted")}: ${res.inserted}`);
      await load();
      LOG("importCsv: done");
    } catch (e) {
      LOG("importCsv: error", e);
      setMessage(t("app.alerts.import_failed", { error: String(e) }));
    }
  };

  const openFolder = async () => {
    if (disabled) return;
    try {
      await invoke("open_last_export_dir", { kind: "code" });
    } catch (e) {
      setMessage(t("app.alerts.open_folder_failed", { error: String(e) }));
    }
  };

  return (
    <div className="settings">
      <div className="settings__section">
        <div className="settings__section-title">{t("code_management.actions.export_database")} / {t("code_management.actions.import_csv")}</div>
        <div className="settings__hint">{t("code_management.hints.export_database_hint")}</div>
        <div className="panel-actions-stack">
          <button type="button" className="btn" onClick={exportCsv} disabled={disabled || busy}>
            {t("code_management.actions.export_database")}
          </button>
          <button type="button" className="btn" onClick={importCsv} disabled={disabled || busy}>
            {t("code_management.actions.import_csv")}
          </button>
          <button type="button" className="btn btn--primary" onClick={openFolder} disabled={disabled}>
            {t("code_management.actions.open_folder")}
          </button>
        </div>
      </div>

      <div className="settings__section">
        <div className="settings__section-title">{t("app.panel.title.code_management")}</div>
        <div className="panel-table-wrap">
          <table className="panel-table panel-table--resizable" style={{ tableLayout: "fixed" }}>
            <colgroup>
              {colWidths.map((w, i) => (
                <col key={i} style={{ width: w, minWidth: MIN_COL_WIDTH }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th style={{ width: colWidths[0], minWidth: MIN_COL_WIDTH }}>
                  <span>{t("code_management.fields.account")}</span>
                  <div className="panel-table-resize" onMouseDown={(e) => startResize(0, e)} aria-hidden />
                </th>
                <th style={{ width: colWidths[1], minWidth: MIN_COL_WIDTH }}>
                  <span>{t("code_management.fields.username")}</span>
                  <div className="panel-table-resize" onMouseDown={(e) => startResize(1, e)} aria-hidden />
                </th>
                <th style={{ width: colWidths[2], minWidth: MIN_COL_WIDTH }}>
                  <span>{t("code_management.fields.password")}</span>
                  <div className="panel-table-resize" onMouseDown={(e) => startResize(2, e)} aria-hidden />
                </th>
                <th style={{ width: colWidths[3], minWidth: MIN_COL_WIDTH }}>
                  <span>{t("code_management.fields.tel")}</span>
                  <div className="panel-table-resize" onMouseDown={(e) => startResize(3, e)} aria-hidden />
                </th>
                <th style={{ width: colWidths[4], minWidth: MIN_COL_WIDTH }}>
                  <span>{t("code_management.fields.email")}</span>
                  <div className="panel-table-resize" onMouseDown={(e) => startResize(4, e)} aria-hidden />
                </th>
                <th style={{ width: colWidths[5], minWidth: MIN_COL_WIDTH }}>
                  <span>{t("code_management.fields.comments")}</span>
                  <div className="panel-table-resize" onMouseDown={(e) => startResize(5, e)} aria-hidden />
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className={selectedId === r.id ? "is-selected" : ""}
                  onClick={() => select(r)}
                >
                  <td title={r.account}>{r.account}</td>
                  <td title={r.username}>{r.username}</td>
                  <td title={r.password || undefined}>{r.password ? "••••" : ""}</td>
                  <td title={r.tel}>{r.tel}</td>
                  <td title={r.email}>{r.email}</td>
                  <td title={r.comments}>{r.comments}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="settings__section-title" style={{ marginTop: 16 }}>Edit</div>
        <div className="settings__row">
          <div className="settings__label">{t("code_management.fields.account")}</div>
          <input
            className="settings__control"
            value={form.account}
            onChange={(e) => setForm((f) => ({ ...f, account: e.target.value }))}
            disabled={disabled}
          />
        </div>
        <div className="settings__row">
          <div className="settings__label">{t("code_management.fields.username")}</div>
          <input
            className="settings__control"
            value={form.username}
            onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            disabled={disabled}
          />
        </div>
        <div
          className="settings__row"
          onMouseEnter={() => setPasswordVisible(true)}
          onMouseLeave={() => setPasswordVisible(false)}
        >
          <div className="settings__label">{t("code_management.fields.password")}</div>
          <input
            className="settings__control"
            type={passwordVisible ? "text" : "password"}
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            disabled={disabled}
          />
        </div>
        <div className="settings__row">
          <div className="settings__label">{t("code_management.fields.tel")}</div>
          <input
            className="settings__control"
            value={form.tel}
            onChange={(e) => setForm((f) => ({ ...f, tel: e.target.value }))}
            disabled={disabled}
          />
        </div>
        <div className="settings__row">
          <div className="settings__label">{t("code_management.fields.email")}</div>
          <input
            className="settings__control"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            disabled={disabled}
          />
        </div>
        <div className="settings__row">
          <div className="settings__label">{t("code_management.fields.comments")}</div>
          <input
            className="settings__control"
            value={form.comments}
            onChange={(e) => setForm((f) => ({ ...f, comments: e.target.value }))}
            disabled={disabled}
          />
        </div>
        <div className="settings__actions" style={{ marginTop: 12 }}>
          <button type="button" className="btn" onClick={clear} disabled={disabled}>
            {t("code_management.actions.clear")}
          </button>
          <button type="button" className="btn btn--primary" onClick={save} disabled={disabled || busy}>
            {form.id ? t("code_management.actions.update") : t("code_management.actions.save")}
          </button>
          {form.id ? (
            <button type="button" className="btn" onClick={remove} disabled={disabled || busy}>
              {t("code_management.actions.delete")}
            </button>
          ) : null}
        </div>
      </div>

      {message ? (
        <div className="settings__hint" style={{ color: "var(--c-primary)", marginTop: 12 }}>
          {message}
        </div>
      ) : null}
    </div>
  );
}
