# easyapply — Architecture & Design

**Purpose:** Desktop app for managing job applications, account/password records, application materials, and AI-assisted cover letter generation. Built with Tauri 2 + React; data stored in local SQLite + JSON config. This doc is the source of truth for architecture, DB schema, and APIs.

**Parallel track (planned):** A browser-accessible deployment on **Microsoft Azure** with **GitHub Actions CI/CD** to build and push container images automatically. Desktop **v2.1.2+** on `main` remains the primary shipping surface until the cloud track reaches parity; see **§10**.

---

## 1. Product Scope

- **Job Applied:** CRUD for job records (company, role, via, date, status, comments). Export/import CSV; choose export folder; “Open folder” opens last export folder.
- **Code Management:** CRUD for account/password records (account, username, password, tel, email, comments). Same CSV export/import and folder behaviour as Job Applied.
- **Application Material:** Three modules — Cover Letter, Template, CV. Each has “Create folder” (pick path, create dir, persist) and “Open folder” (open last used path).
- **Cover Letter Generate:** Full-page workflow with state machine (`state=0` Stage-0 planning; `state>=1` iterative flow), feedback/iteration history, prompt update tools, and cover letter version output.
- **Settings:** Language (en/zh), theme (Default/Golden/Black). Stored in localStorage; no backend.
- **OpenAI Settings:** API key save/test, profile tuning (reasoning effort, text verbosity), timeout display, raw test feedback.
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
├── App.tsx               # Main UI: header + modules; CLG uses full-page mode
├── version.ts            # APP_VERSION (keep in sync with Cargo.toml / tauri.conf.json)
├── style/                # index.css, theme.css (tokens, layout, panel, settings, main-btn, panel-table)
├── i18n/                 # en.json, zh.json (all UI strings)
├── auth/                 # AuthProvider, AuthManager, auth_manager_types, auth.css
├── server/               # ServerPlugin (placeholder for remote connection)
├── panels/               # JobAppliedPanel, CodeManagementPanel, ApplicationMaterialPanel, CoverLetterGeneratorPage
└── assets/               # Icons (setting, account, document)

src-tauri/
├── src/
│   ├── lib.rs            # Tauri entry, setup (auth + easyapply DB), invoke handler registration
│   ├── main.rs           # run()
│   ├── auth/             # auth.db: users, roles, permissions, sessions; login/logout/CSV/upsert
│   ├── easyapply.rs      # easyapply.db + easyapply.json; applied/code CRUD, CSV, app material paths
│   ├── ai.rs             # OpenAI config/key/test; cover-letter generation; prompt update persistence/versioning
│   └── prompts/          # cover_letter_generation.md, prompt_update.md
├── tauri.conf.json       # Product name, identifier, window, build
└── Cargo.toml            # tauri, rusqlite, csv, serde, tauri-plugin-dialog, tokio, uuid, etc.

docs/
└── plan.md               # This file (includes §10 Azure / CI/CD roadmap)
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

**AI / Cover Letter (ai.rs):**

- `ai_get_openai_profile` / `ai_update_openai_profile` / `ai_save_openai_api_key` / `ai_test_openai_api_key`
- `ai_generate_cover_letter`
  - consumes JD text, prompt markdown, hard constraints, workflow metadata, and session history
  - returns `status`, optional `coverLetter`, feedback messages, and gap requirements
- `ai_update_cover_letter_prompt`
  - receives previous prompt version/path/content + structured update requirements
  - asks model for updated markdown content
  - backend computes next prompt version (current rule: `minor + 1`)
  - backend rewrites version markers in markdown and saves `cover_letter_prompt_v<major>_<minor>.md` in same directory
  - returns `updatedPromptVersion` and `savedPromptPath`
- `ai_read_text_file` / `ai_write_text_file` / `ai_open_folder`

---

## 6. Frontend Architecture

- **Route:** Only `/` → `App`.
- **State:** `AuthProvider` (login state, token, `hasPerm`); panel/full-page mode state in `App`.
- **UI:** Header (title/time/version + Settings/Account/User Management). Main area includes four entries: Job Applied, Code Management, Application Material, Cover Letter Generate.
- **Layout behavior:** Job/Code/Application Material render in the right drawer panel; Cover Letter Generate renders as a dedicated full page.
- **Lock behaviour:** If not logged in, main buttons and Settings/User Management are disabled and the panel is forced to Account until the user signs in.
- **i18n:** localStorage `easyapply-language` (en | zh), `easyapply-theme` (Default | Golden | Black). Translation keys include `cover_letter_generate` in both language packs.

---

## 7. CSV Format

- **Job Applied export/import:** Header row: `Company,Role,Via,Date,Status,Comments`. Same order and names required for import (serde renames in Rust: Company→company, etc.).
- **Code Management export/import:** Header: `Account,Username,Password,Tel,Email,Comments`. Same for import.

---

## 8. Version & Build

- Frontend version in `src/version.ts`; keep in sync with `src-tauri/Cargo.toml` and `tauri.conf.json`.
- Current app version target: `2.1.2`.
- Build: `npm run build` (tsc + vite) → dist; Tauri packs the app. No extra bundle resources.

---

## 9. Next Steps

- **Desktop (ongoing):** Continue releases from `main` with version bumps in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, and `src/version.ts`. Tag stable baselines (e.g. `v2.1.2`) before large parallel work.
- **Online / mobile (Azure track):** Follow **§10** — HTTP service + container + CI/CD; combine **permission management** with TLS, authenticated APIs, and a clear data path (SQLite on persistent storage or managed PostgreSQL). Do not remove Tauri capabilities from `main` while the cloud stack matures on a dedicated branch.

---

## 10. Azure hosting & CI/CD development plan

This section describes how to evolve the repo **without dropping** current desktop behaviour: add a **parallel branch**, container artefacts, and automation so Azure App Service (Linux container) can **pull new images on each merge** to that branch.

### 10.1 Principles

| Principle | Detail |
|-----------|--------|
| **Single repo** | Keep Tauri + React in `main`. Cloud-specific files (`Dockerfile`, `.github/workflows/`, optional `server/` crate) live on a long-lived branch (e.g. `feat/azure-web`) or are merged to `main` once stable **without** breaking `npm run tauri build`. |
| **Baseline tag** | Branch from **`v2.1.2`** (or later release tags) so rollbacks and diffs are obvious. |
| **Desktop unchanged** | `main` continues to produce the Windows (and optional cross-platform) installer. Cloud work adds **new binaries / workflows**, not replacements for `app_lib::run()` until explicitly switched. |
| **Secrets** | OpenAI keys and DB connection strings live in **Azure App settings** or **Key Vault references**, never in the frontend bundle or public GitHub vars. |

### 10.2 Target Azure shape (aligned with current portal setup)

- **Compute:** **Azure App Service**, **Linux**, **single-container** Web App (already provisioned with a placeholder image `mcr.microsoft.com/appsvc/staticsite:latest`).
- **Registry:** **Azure Container Registry (ACR)** — store `easyapply-api:<tag>` images built in CI.
- **Networking:** Public HTTPS (`httpsOnly`), optional custom domain later. **VNet integration** only if private database or internal dependencies require it.
- **SKU:** **Basic B1** (or equivalent) for early API traffic; enable **Always On** and a **health check path** (e.g. `/health`) once the real service ships.
- **Database (phase 1):** Keep **SQLite** only if the file lives on **persistent storage** (e.g. App Service `/home` or mounted **Azure Files**); document path and backup. **Phase 2:** migrate to **Azure Database for PostgreSQL** if multi-instance or stronger backup SLAs are needed.

### 10.3 Application architecture (cloud)

1. **HTTP layer (new)**  
   - Add a **Rust binary** (e.g. `easyapply-server`) using **Axum** (or Actix) that listens on **`0.0.0.0:$PORT`** (`PORT` from Azure).  
   - Expose REST (or JSON-RPC) routes that mirror today’s `invoke` contracts where possible.

2. **Shared logic**  
   - Refactor `auth`, `easyapply`, `ai` modules so core operations can run with an **`AppHandle`-free context** (paths from env or injected config instead of `app.path().app_*_dir()` only). Tauri keeps using `AppHandle`; the server passes explicit base directories.

3. **Frontend**  
   - **Option A (recommended early):** Build Vite to `dist/` and let Axum **serve static files** + API on one origin (simple cookies / CSRF).  
   - **Option B:** Host `dist/` on Azure Static Web Apps or Blob + CDN; configure **CORS** on Axum.  
   - Replace `invoke` with a thin client (`fetch`) behind `import.meta.env.VITE_API_BASE` or build-time flags; keep a **Tauri vs Web** detection guard so one codebase serves both until split is unnecessary.

4. **Desktop-only features**  
   - `tauri-plugin-dialog` (folder pickers, “open in Explorer”) → **web equivalents:** `<input type="file">`, zip download for exports, server-side paths for “last export dir” stored in DB/config instead of native dialogs.

### 10.4 CI/CD (GitHub Actions → ACR → App Service)

**Goals:** On push (or manual `workflow_dispatch`) to the deployment branch, **build Linux amd64 image**, **push to ACR**, **update the Web App to the new tag** (e.g. `:${{ github.sha }}` or `latest` with digest).

**Recommended workflow layout:**

```
.github/workflows/azure-deploy.yml   # or split: build.yml + deploy.yml
```

**Steps (conceptual):**

1. **Checkout** repo (deployment branch).  
2. **Log in to Azure** with **OIDC** (`azure/login`) using a **federated credential** from Entra ID → no long-lived Azure password in GitHub Secrets (use `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` only).  
3. **Log in to ACR** (`az acr login` or `docker login` via token from `az acr login --expose-token`).  
4. **Docker build** multi-stage Dockerfile (Rust release + minimal runtime image).  
5. **Docker push** `acrName.azurecr.io/easyapply-api:<tag>`.  
6. **Update App Service** container settings (`az webapp config container set` or Azure REST) to point at the new image digest; optional **slot swap** later for blue/green.

**Trigger discipline (avoid accidental deploys):**

```yaml
on:
  push:
    branches: [feat/azure-web]   # example only
  workflow_dispatch:             # manual runs for testing
```

Optionally add **`paths`** filters so unrelated `README` edits on `main` do not trigger cloud builds.

**GitHub configuration checklist:**

- Repository **Environments** (e.g. `production`) with **required reviewers** if desired.  
- **OIDC federated identity** in Azure for `repo:ORG/easyapply:ref:refs/heads/feat/azure-web`.  
- ACR **AcrPull** granted to the Web App’s **managed identity** (preferred over admin user password).

### 10.5 Local verification (before Azure)

- **Docker Desktop (Windows):** `docker build -t easyapply-api:local .` then `docker run -p 8080:8080 -e PORT=8080 easyapply-api:local` and hit `http://localhost:8080/health`.  
- Matches **Linux** runtime on App Service; fixes port binding and missing `libssl` issues early.

### 10.6 Security & operations

- **TLS:** Terminated at App Service; keep **`httpsOnly`** enabled.  
- **Auth:** Reuse existing **auth.db semantics** over HTTP (session cookies or short-lived JWT + refresh); or integrate **Microsoft Entra External ID** later and map external `sub` to internal users.  
- **Rate limiting / IP restrictions:** Add at App Service **Access Restrictions** or API Gateway (e.g. Front Door) when exposing beyond personal use.  
- **Observability:** Enable **Application Insights** with **OpenTelemetry** from Rust when ready (code-less agents do not auto-instrument Rust containers).  
- **Backups:** Export SQLite on a schedule or use managed Postgres backups when migrated.

### 10.7 Deliverables checklist (implementation order)

1. `Dockerfile` (multi-stage) + `.dockerignore`.  
2. `easyapply-server` binary + minimal `/health` route.  
3. GitHub workflow with **OIDC** + ACR push + **App Service container update**.  
4. Refactor path/config for server vs Tauri (`AppHandle`).  
5. Frontend **API client** + feature flag / env for web build.  
6. Replace dialog-based flows with web file APIs for CSV and materials.  
7. Document **Azure resource names**, subscription, and **rollback** (`az webapp config container set` to previous tag).

### 10.8 Documentation & versioning

- Keep **§8** version numbers for **desktop releases**.  
- Optionally introduce a **`SERVER_VERSION`** or image tag scheme independent of desktop `APP_VERSION` until release processes unify.
