# easyapply

A desktop app for managing job applications, account/password records, and application materials (cover letter, template, CV). Built with **Tauri 2** and **React**; data is stored locally in SQLite with CSV export/import.

## Features

- **Job Applied** — CRUD for job records (company, role, via, date, status, comments). Export/import CSV (UTF-8). Resizable preview columns; confirmations for Save, Update, Delete, and Import.
- **Code Management** — CRUD for account/password entries (account, username, password, tel, email, comments). Same CSV workflow; password fields show plain text on hover.
- **Application Material** — Three modules (Cover Letter, Template, CV). Create folder, open last-used folder per module.
- **Settings** — Language (English / 中文), theme (Default / Golden / Black).
- **Account** — Login, logout, change password, optional “remember me”.
- **User Management** — Export users CSV, upsert/delete user, bulk apply CSV (Admin only). Uses same auth DB as login.

Data: **auth.db** for login and user management; **easyapply.db** for job and code data (separate file so the app can coexist with others on the same machine).

## Tech stack

| Layer     | Tech |
|----------|------|
| Frontend | React 19, TypeScript, Vite 7 |
| Desktop  | Tauri 2 (Rust) |
| Plugins  | tauri-plugin-dialog (file/folder picker, confirm) |
| Data     | SQLite (rusqlite), CSV (export/import) |

## Prerequisites

- **Node.js** 18+ and **npm**
- **Rust** (for Tauri): [rustup](https://rustup.rs/)
- **Tauri system deps**: [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS

## Getting started

```bash
# Install dependencies
npm install

# Run in development (opens Tauri window with hot reload)
npx tauri dev

# Build for production
npm run build
npx tauri build
```

Outputs are under `src-tauri/target/release/` (or `debug/` for `tauri dev`).

## Project structure

```
src/                    # Frontend (React + Vite)
├── App.tsx             # Main layout, header, panels
├── main.tsx            # Entry: AuthProvider, Router, App
├── auth/               # AuthProvider, AuthManager
├── panels/             # JobAppliedPanel, CodeManagementPanel, ApplicationMaterialPanel
├── i18n/               # en.json, zh.json
├── style/              # theme.css
├── utils/               # confirm.ts (dialog helper)
└── version.ts          # APP_VERSION

src-tauri/              # Backend (Rust)
├── src/
│   ├── lib.rs          # Tauri setup, pick_export_folder, pick_file_csv
│   ├── auth/           # auth.db, login, user management
│   └── easyapply.rs    # easyapply.db, applied/code CRUD, CSV, app material paths
├── capabilities/       # default.json (permissions)
└── tauri.conf.json

docs/
└── plan.md             # Architecture, DB schema, backend commands
```

## Development & debugging

When a button (Save, Update, Delete, Import CSV) seems to do nothing:

1. **Open DevTools** in the Tauri window: right-click → **Inspect** (or **Inspect Element**). On Windows you can try **F12** if enabled.
2. In the **Console** tab, filter or look for logs starting with **`[easyapply]`**. They show:
   - Whether the click reached the handler (`save() called`, etc.)
   - Whether the confirmation dialog ran or timed out (`confirmAction: start`, `tauri returned` / `timeout` / `tauri failed`)
   - The user’s choice (`confirm result true/false`)
   - Backend calls (`invoking backend`, `done`) or errors (`save: error`, …)
3. If the native confirm dialog never appears, the code falls back to `window.confirm` after 4 seconds; use the browser dialog to continue.
4. Any backend error is also shown in the app’s message area below the panel.

## License

Licensed under the [MIT License](LICENSE).
