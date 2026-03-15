# easyapply — Architecture & Design

**Purpose:** Desktop app for managing job applications, account/password records, and application materials (cover letter, template, CV). Built with Tauri 2 + React; data stored in a local SQLite DB and config in JSON. This doc is the single source of truth for architecture, DB schema, and APIs.

---

## 1. Product Scope

- **Job Applied:** CRUD for job records (company, role, via, date, status, comments). Export/import CSV; choose export folder; “Open folder” opens last export folder.
- **Code Management:** CRUD for account/password records (account, username, password, tel, email, comments). Same CSV export/import and folder behaviour as Job Applied.
- **Application Material:** Three modules — Cover Letter, Template, CV. Each has “Create folder” (pick path, create dir, persist) and “Open folder” (open last used path).
- **Settings:** Language (en/zh), theme (Default/Golden/Black). Stored in localStorage; no backend.
- **Account:** Login/logout, change password, optional “remember me”. Remote/server UI is a placeholder.
- **User Management:** Renamed from “Documents”; Path (Modules root) removed. AuthManager (export users CSV, upsert user, bulk apply CSV). Admin-only.

Auth (auth.db) is shared for login and User Management; easyapply uses **easyapply.db** (separate file) for job/code data so it can coexist with other apps on the same machine.

---

## 2. Tech Stack

| Layer   | Tech |
|--------|------|
| Frontend | React 19, React Router 7, Vite 7, TypeScript |
| Desktop  | Tauri 2 (Rust) |
| Plugins  | tauri-plugin-dialog (folder/file picker) |
| DB      | SQLite (rusqlite); CSV (csv crate) for export/import |

---

## 3. Directory Layout

```
src/
├── main.tsx              # Entry: AuthProvider, BrowserRouter, single route "/" → App
├── App.tsx               # Main UI: header (title, Settings/Account/User Management), 3 main buttons, right panel
├── version.ts            # APP_VERSION (keep in sync with Cargo.toml / tauri.conf.json)
├── style/                # index.css, theme.css (tokens, layout, panel, settings, main-btn, panel-table)
├── i18n/                 # en.json, zh.json (all UI strings)
├── auth/                 # AuthProvider, AuthManager, auth_manager_types, auth.css
├── server/               # ServerPlugin (placeholder for remote connection)
├── panels/               # JobAppliedPanel, CodeManagementPanel, ApplicationMaterialPanel
└── assets/               # Icons (setting, account, document)

src-tauri/
├── src/
│   ├── lib.rs            # Tauri entry, setup (auth + easyapply DB), invoke handler registration
│   ├── main.rs           # run()
│   ├── auth/             # auth.db: users, roles, permissions, sessions; login/logout/CSV/upsert
│   └── easyapply.rs      # easyapply.db + easyapply.json; applied/code CRUD, CSV, app material paths
├── tauri.conf.json       # Product name, identifier, window, build
└── Cargo.toml            # tauri, rusqlite, csv, serde, tauri-plugin-dialog, tokio, uuid, etc.

docs/
└── plan.md               # This file
```

---

## 4. Database & Config

**Location:** Same as auth: `app_data_dir()` from Tauri.  
**Files:**

- **auth.db** — Unchanged (users, roles, permissions, user_roles, role_permissions, sessions, audit_log). Used for login and User Management.
- **easyapply.db** — Applied and code tables; same directory as auth.db, different filename to avoid conflict with other apps.

**easyapply.db schema:**

- **applied** (Job Applied)  
  - `id` INTEGER PRIMARY KEY AUTOINCREMENT  
  - `company` TEXT NOT NULL DEFAULT ''  
  - `role` TEXT NOT NULL DEFAULT ''  
  - `via` TEXT NOT NULL DEFAULT ''  
  - `date` TEXT NOT NULL DEFAULT ''  
  - `status` TEXT NOT NULL DEFAULT ''  
  - `comments` TEXT NOT NULL DEFAULT ''

- **code** (Code Management)  
  - `id` INTEGER PRIMARY KEY AUTOINCREMENT  
  - `account` TEXT NOT NULL DEFAULT ''  
  - `username` TEXT NOT NULL DEFAULT ''  
  - `password` TEXT NOT NULL DEFAULT ''  
  - `tel` TEXT NOT NULL DEFAULT ''  
  - `email` TEXT NOT NULL DEFAULT ''  
  - `comments` TEXT NOT NULL DEFAULT ''

**easyapply.json** (in `app_config_dir()`):

- `last_export_dir_job` — Last folder used for Job Applied CSV export.
- `last_export_dir_code` — Last folder used for Code Management CSV export.
- `app_material_cover_letter`, `app_material_template`, `app_material_cv` — Persisted folder paths for the three Application Material modules.

---

## 5. Backend (Tauri) Commands

**Folder / file pickers (lib.rs):**

- `pick_export_folder` → `Option<String>` (folder path).
- `pick_file_csv` → `Option<String>` (file path; used for CSV import).

**Auth (auth/):**  
`auth_login`, `auth_resume`, `auth_logout`, `auth_whoami`, `auth_change_password`, `auth_export_users_csv`, `auth_upsert_user_role`, `auth_bulk_apply_csv` — unchanged.

**Easyapply (easyapply.rs):**

- **Applied:**  
  - `applied_list` → `Vec<AppliedRow>`  
  - `applied_create(company, role, via, date, status, comments)` → `i64` (new id)  
  - `applied_update(id, company, role, via, date, status, comments)` → `()`  
  - `applied_delete(id)` → `()`  
  - `applied_export_csv(dir)` → writes `job_applied.csv` under `dir`, updates `last_export_dir_job`, returns file path.  
  - `applied_import_csv(file_path)` → `ImportResult { inserted }`.

- **Code:**  
  - `code_list` → `Vec<CodeRow>`  
  - `code_create(account, username, password, tel, email, comments)` → `i64`  
  - `code_update(id, ...)` → `()`  
  - `code_delete(id)` → `()`  
  - `code_export_csv(dir)` → writes `code_management.csv`, updates `last_export_dir_code`, returns file path.  
  - `code_import_csv(file_path)` → `ImportResult { inserted }`.

- **Last export dir:**  
  - `get_last_export_dir(kind: "job" | "code")` → `Option<String>`  
  - `open_last_export_dir(kind)` → opens that folder in explorer (errors if not set).

- **Application Material:**  
  - `app_material_get_folder(kind: "cover_letter" | "template" | "cv")` → `Option<String>`  
  - `app_material_set_folder(kind, path)` → `()`  
  - `app_material_create_folder(kind, path)` → creates dir at `path`, sets and returns path.  
  - `app_material_open_folder(kind)` → opens stored path in explorer (errors if not set).

---

## 6. Frontend Architecture

- **Route:** Only `/` → `App`.
- **State:** `AuthProvider` (login state, token, `hasPerm`); panel open state in `App` (`drawer`: settings | account | user_management | job_applied | code_management | application_material | null).
- **UI:** Header (title “easyapply”, subtitle, time, version, Settings / Account / User Management icons). Main area: three buttons (Job Applied, Code Management, Application Material). Right panel (same style as before) shows content for the selected drawer; all interactions (forms, tables, export/import, open folder) are in the panel.
- **Lock behaviour:** If not logged in, main buttons and Settings/User Management are disabled and the panel is forced to Account until the user signs in.
- **i18n:** localStorage `easyapply-language` (en | zh), `easyapply-theme` (Default | Golden | Black). Body class `theme-golden` / `theme-black` for themes. Translation keys in en.json / zh.json under `app`, `settings`, `account`, `user_management`, `auth_manager`, `job_applied`, `code_management`, `application_material`.

---

## 7. CSV Format

- **Job Applied export/import:** Header row: `Company,Role,Via,Date,Status,Comments`. Same order and names required for import (serde renames in Rust: Company→company, etc.).
- **Code Management export/import:** Header: `Account,Username,Password,Tel,Email,Comments`. Same for import.

---

## 8. Version & Build

- Frontend version in `src/version.ts`; keep in sync with `src-tauri/Cargo.toml` and `tauri.conf.json` if needed.
- Build: `npm run build` (tsc + vite) → dist; Tauri packs the app. No extra bundle resources.

---

## 9. Next Steps

- **Online / mobile version:** Build a web-based version of easyapply that is accessible from mobile devices, combining **permission management** and **security/encryption** (e.g. TLS, secure auth, encrypted data at rest or in transit). The database would be hosted on a **private server** instead of local SQLite.

