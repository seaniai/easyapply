import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

const MODULES = [
  { kind: "cover_letter", labelKey: "application_material.modules.cover_letter" },
  { kind: "template", labelKey: "application_material.modules.template" },
  { kind: "cv", labelKey: "application_material.modules.cv" },
] as const;

export default function ApplicationMaterialPanel(props: { t: TranslateFn; disabled?: boolean }) {
  const { t, disabled } = props;
  const [paths, setPaths] = useState<Record<string, string | null>>({
    cover_letter: null,
    template: null,
    cv: null,
  });
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    try {
      const cover = await invoke<string | null>("app_material_get_folder", { kind: "cover_letter" });
      const template = await invoke<string | null>("app_material_get_folder", { kind: "template" });
      const cv = await invoke<string | null>("app_material_get_folder", { kind: "cv" });
      setPaths({
        cover_letter: cover,
        template,
        cv,
      });
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    load();
  }, []);

  const createFolder = async (kind: string) => {
    if (disabled) return;
    setMessage(null);
    try {
      const dir = await invoke<string | null>("pick_export_folder");
      if (!dir) return;
      await invoke("app_material_create_folder", { kind, path: dir });
      await load();
    } catch (e) {
      setMessage(t("app.alerts.create_folder_failed", { error: String(e) }));
    }
  };

  const openFolder = async (kind: string) => {
    if (disabled) return;
    setMessage(null);
    try {
      await invoke("app_material_open_folder", { kind });
    } catch (e) {
      setMessage(t("app.alerts.open_folder_failed", { error: String(e) }));
    }
  };

  return (
    <div className="settings">
      <div className="settings__section">
        <div className="settings__section-title">{t("app.panel.title.application_material")}</div>
        <div className="settings__hint">{t("application_material.hints.folder_not_set")}</div>

        {MODULES.map(({ kind, labelKey }) => (
          <div key={kind} className="settings__section" style={{ marginTop: 12 }}>
            <div className="settings__section-title">{t(labelKey)}</div>
            {paths[kind] ? (
              <div className="settings__hint" style={{ wordBreak: "break-all" }}>{paths[kind]}</div>
            ) : null}
            <div className="panel-actions-stack" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="btn"
                onClick={() => createFolder(kind)}
                disabled={disabled}
              >
                {t("application_material.actions.create_folder")}
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => openFolder(kind)}
                disabled={disabled}
              >
                {t("application_material.actions.open_folder")}
              </button>
            </div>
          </div>
        ))}
      </div>

      {message ? (
        <div className="settings__hint" style={{ color: "crimson", marginTop: 12 }}>
          {message}
        </div>
      ) : null}
    </div>
  );
}
