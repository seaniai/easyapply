// src/server/server.tsx
import { useState } from "react";

type TranslateFn = (
  key: string,
  params?: Record<string, string | number>
) => string;

type ServerPluginProps = {
  disabled?: boolean;
  t: TranslateFn;
};

export default function ServerPlugin(props: ServerPluginProps) {
  const { t, disabled } = props;
  const [serviceEnabled, setServiceEnabled] = useState(true);

  return (
    <div className="settings__section">
      <div className="settings__section-title">{t("account.sections.server")}</div>

      <div className="settings__hint">{t("account.hints.server_placeholder")}</div>

      <div className="settings__row">
        <div className="settings__label">{t("account.fields.enable_background_services")}</div>
        <button
          type="button"
          className={`switch ${serviceEnabled ? "is-on" : ""}`}
          onClick={() => setServiceEnabled((v) => !v)}
          aria-pressed={serviceEnabled}
          disabled={disabled}
        >
          <span className="switch__knob" />
        </button>
      </div>

      <div className="settings__row">
        <div className="settings__label">{t("account.fields.server_host")}</div>
        <input className="settings__control" value="127.0.0.1" disabled />
      </div>

      <div className="settings__row">
        <div className="settings__label">{t("account.fields.server_port")}</div>
        <input className="settings__control" value="5002" disabled />
      </div>

      <div className="settings__actions">
        <button className="btn" type="button" disabled>
          {t("account.actions.test_connection")}
        </button>
        <button className="btn btn--primary" type="button" disabled>
          {t("account.actions.apply_server_config")}
        </button>
      </div>
    </div>
  );
}