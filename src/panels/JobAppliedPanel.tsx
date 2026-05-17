import { useEffect, useState, useCallback, useRef } from "react";
import { appInvoke, downloadCsv, isWebDataMode, uploadCsv } from "../api/client";
import PanelRecordSearch from "../components/PanelRecordSearch";
import { usePanelRecordSearch } from "../hooks/usePanelRecordSearch";
import { useSessionToken } from "../hooks/useSessionToken";
import { confirmAction } from "../utils/confirm";

const LOG = (msg: string, ...args: unknown[]) => console.log("[easyapply]", msg, ...args);

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

type AppliedRow = {
  id: number;
  company: string;
  role: string;
  via: string;
  date: string;
  status: string;
  comments: string;
};

const emptyRow = (): AppliedRow => ({
  id: 0,
  company: "",
  role: "",
  via: "",
  date: "",
  status: "",
  comments: "",
});

const DEFAULT_COL_WIDTHS = [120, 120, 80, 100, 90, 200];
const MIN_COL_WIDTH = 40;

export default function JobAppliedPanel(props: { t: TranslateFn; disabled?: boolean }) {
  const { t, disabled } = props;
  const token = useSessionToken();
  const [rows, setRows] = useState<AppliedRow[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState<AppliedRow>(emptyRow());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [colWidths, setColWidths] = useState<number[]>(() => DEFAULT_COL_WIDTHS);
  const [resizingCol, setResizingCol] = useState<number | null>(null);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);
  const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map());

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const list = await appInvoke<AppliedRow[]>("applied_list", { token });
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
  }, [selectedId, t, token]);

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

  const select = (r: AppliedRow) => {
    setSelectedId(r.id);
    setForm({ ...r });
  };

  const search = usePanelRecordSearch(
    rows,
    ["company", "role", "via", "date", "status", "comments"],
    select,
    (id) => rowRefs.current.get(id) ?? null,
  );

  const clear = () => {
    setForm(emptyRow());
    setSelectedId(null);
  };

  const save = async () => {
    LOG("save() called", { disabled, busy, formId: form.id });
    if (disabled || busy) return;
    const isUpdate = !!form.id;
    const msg = isUpdate ? t("job_applied.update_confirm") : t("job_applied.save_confirm");
    const ok = await confirmAction(msg);
    LOG("save: confirm result", ok);
    if (!ok) return;
    setMessage(null);
    setBusy(true);
    try {
      LOG("save: invoking backend", isUpdate ? "update" : "create");
      if (form.id) {
        await appInvoke("applied_update", {
          token,
          id: form.id,
          company: form.company,
          role: form.role,
          via: form.via,
          date: form.date,
          status: form.status,
          comments: form.comments,
        });
      } else {
        await appInvoke("applied_create", {
          token,
          company: form.company,
          role: form.role,
          via: form.via,
          date: form.date,
          status: form.status,
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
    const ok = await confirmAction(t("job_applied.delete_confirm"));
    LOG("remove: confirm result", ok);
    if (!ok) return;
    setBusy(true);
    setMessage(null);
    try {
      LOG("remove: invoking applied_delete");
      await appInvoke("applied_delete", { token, id: form.id });
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
      if (isWebDataMode()) {
        await downloadCsv("/api/applied/export.csv", "job_applied.csv");
        setMessage(t("auth_manager.messages.exported", { path: "job_applied.csv" }));
        return;
      }
      const { invoke } = await import("@tauri-apps/api/core");
      const dir = await invoke<string | null>("pick_export_folder");
      if (!dir) return;
      const path = await invoke<string>("applied_export_csv", { token, dir });
      setMessage(t("auth_manager.messages.exported", { path }));
    } catch (e) {
      setMessage(t("app.alerts.export_failed", { error: String(e) }));
    }
  };

  const importCsv = async () => {
    LOG("importCsv() called", { disabled, busy });
    if (disabled || busy) return;
    const ok = await confirmAction(t("job_applied.import_confirm"));
    LOG("importCsv: confirm result", ok);
    if (!ok) return;
    setMessage(null);
    try {
      if (isWebDataMode()) {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".csv,text/csv";
        const file = await new Promise<File | null>((resolve) => {
          input.onchange = () => resolve(input.files?.[0] ?? null);
          input.click();
        });
        if (!file) return;
        const res = await uploadCsv("/api/applied/import", file);
        setMessage(t("auth_manager.report.inserted", { count: res.inserted }));
        await load();
        return;
      }
      LOG("importCsv: opening file picker");
      const { invoke } = await import("@tauri-apps/api/core");
      const filePath = await invoke<string | null>("pick_file_csv");
      if (!filePath) return;
      LOG("importCsv: invoking applied_import_csv");
      const res = await appInvoke<{ inserted: number }>("applied_import_csv", { token, filePath });
      setMessage(t("auth_manager.report.inserted", { count: res.inserted }) + `: ${res.inserted}`);
      await load();
      LOG("importCsv: done");
    } catch (e) {
      LOG("importCsv: error", e);
      setMessage(t("app.alerts.import_failed", { error: String(e) }));
    }
  };

  const openFolder = async () => {
    if (disabled || isWebDataMode()) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_last_export_dir", { kind: "job" });
    } catch (e) {
      setMessage(t("app.alerts.open_folder_failed", { error: String(e) }));
    }
  };

  return (
    <div className="settings">
      <div className="settings__section">
        <div className="settings__section-title">{t("job_applied.actions.export_database")} / {t("job_applied.actions.import_csv")}</div>
        <div className="settings__hint">{t("job_applied.hints.export_database_hint")}</div>
        <PanelRecordSearch
          query={search.query}
          onQueryChange={search.setQuery}
          matchCount={search.matchIds.length}
          matchIndex={search.matchIndex}
          onPrev={search.goPrev}
          onNext={search.goNext}
          onClear={search.clear}
          disabled={disabled || busy}
          placeholder={t("job_applied.search.placeholder")}
          prevLabel={t("job_applied.search.prev")}
          nextLabel={t("job_applied.search.next")}
          countLabel={t("job_applied.search.count")}
          noResultsLabel={t("job_applied.search.no_results")}
        />
        <div className="panel-actions-stack">
          <button type="button" className="btn" onClick={exportCsv} disabled={disabled || busy}>
            {t("job_applied.actions.export_database")}
          </button>
          <button type="button" className="btn" onClick={importCsv} disabled={disabled || busy}>
            {t("job_applied.actions.import_csv")}
          </button>
          {!isWebDataMode() ? (
            <button type="button" className="btn btn--primary" onClick={openFolder} disabled={disabled}>
              {t("job_applied.actions.open_folder")}
            </button>
          ) : null}
        </div>
      </div>

      <div className="settings__section">
        <div className="settings__section-title">{t("app.panel.title.job_applied")}</div>
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
                  <span>{t("job_applied.fields.company")}</span>
                  <div className="panel-table-resize" onMouseDown={(e) => startResize(0, e)} aria-hidden />
                </th>
                <th style={{ width: colWidths[1], minWidth: MIN_COL_WIDTH }}>
                  <span>{t("job_applied.fields.role")}</span>
                  <div className="panel-table-resize" onMouseDown={(e) => startResize(1, e)} aria-hidden />
                </th>
                <th style={{ width: colWidths[2], minWidth: MIN_COL_WIDTH }}>
                  <span>{t("job_applied.fields.via")}</span>
                  <div className="panel-table-resize" onMouseDown={(e) => startResize(2, e)} aria-hidden />
                </th>
                <th style={{ width: colWidths[3], minWidth: MIN_COL_WIDTH }}>
                  <span>{t("job_applied.fields.date")}</span>
                  <div className="panel-table-resize" onMouseDown={(e) => startResize(3, e)} aria-hidden />
                </th>
                <th style={{ width: colWidths[4], minWidth: MIN_COL_WIDTH }}>
                  <span>{t("job_applied.fields.status")}</span>
                  <div className="panel-table-resize" onMouseDown={(e) => startResize(4, e)} aria-hidden />
                </th>
                <th style={{ width: colWidths[5], minWidth: MIN_COL_WIDTH }}>
                  <span>{t("job_applied.fields.comments")}</span>
                  <div className="panel-table-resize" onMouseDown={(e) => startResize(5, e)} aria-hidden />
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  ref={(el) => {
                    if (el) rowRefs.current.set(r.id, el);
                    else rowRefs.current.delete(r.id);
                  }}
                  className={[
                    selectedId === r.id ? "is-selected" : "",
                    search.activeMatchId === r.id ? "is-search-match" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => select(r)}
                >
                  <td title={r.company}>{r.company}</td>
                  <td title={r.role}>{r.role}</td>
                  <td title={r.via}>{r.via}</td>
                  <td title={r.date}>{r.date}</td>
                  <td title={r.status}>{r.status}</td>
                  <td title={r.comments}>{r.comments}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="settings__section-title" style={{ marginTop: 16 }}>{t("common.edit")}</div>
        <div className="settings__row">
          <div className="settings__label">{t("job_applied.fields.company")}</div>
          <input
            className="settings__control"
            value={form.company}
            onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
            disabled={disabled}
          />
        </div>
        <div className="settings__row">
          <div className="settings__label">{t("job_applied.fields.role")}</div>
          <input
            className="settings__control"
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
            disabled={disabled}
          />
        </div>
        <div className="settings__row">
          <div className="settings__label">{t("job_applied.fields.via")}</div>
          <input
            className="settings__control"
            value={form.via}
            onChange={(e) => setForm((f) => ({ ...f, via: e.target.value }))}
            disabled={disabled}
          />
        </div>
        <div className="settings__row">
          <div className="settings__label">{t("job_applied.fields.date")}</div>
          <input
            className="settings__control"
            value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            disabled={disabled}
          />
        </div>
        <div className="settings__row">
          <div className="settings__label">{t("job_applied.fields.status")}</div>
          <input
            className="settings__control"
            value={form.status}
            onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
            disabled={disabled}
          />
        </div>
        <div className="settings__row">
          <div className="settings__label">{t("job_applied.fields.comments")}</div>
          <input
            className="settings__control"
            value={form.comments}
            onChange={(e) => setForm((f) => ({ ...f, comments: e.target.value }))}
            disabled={disabled}
          />
        </div>
        <div className="settings__actions" style={{ marginTop: 12 }}>
          <button type="button" className="btn" onClick={clear} disabled={disabled}>
            {t("job_applied.actions.clear")}
          </button>
          <button type="button" className="btn btn--primary" onClick={save} disabled={disabled || busy}>
            {form.id ? t("job_applied.actions.update") : t("job_applied.actions.save")}
          </button>
          {form.id ? (
            <button type="button" className="btn" onClick={remove} disabled={disabled || busy}>
              {t("job_applied.actions.delete")}
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
