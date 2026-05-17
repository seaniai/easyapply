# easyapply — Architecture & Design

**Purpose:** Desktop app for managing job applications, account/password records, application materials, and AI-assisted cover letter generation. Built with Tauri 2 + React; data stored in local SQLite + JSON config. This doc is the source of truth for architecture, DB schema, and APIs.

**Parallel track (planned):** A browser-accessible deployment on **Microsoft Azure** with **GitHub Actions CI/CD** to build and push container images automatically. Desktop **v2.1.2+** on `main` remains the primary shipping surface until the cloud track reaches parity; see **§10**.

---

## 1. Product Scope

- **Job Applied:** CRUD for job records (company, role, via, date, status, comments). Export/import CSV; choose export folder; “Open folder” opens last export folder. **Planned:** sticky panel search with next/previous match (see **§6.1**).
- **Code Management:** CRUD for account/password records (account, username, password, tel, email, comments). Same CSV export/import and folder behaviour as Job Applied. **Planned:** same panel search pattern as Job Applied (see **§6.1**).
- **Application Material:** Three modules — Cover Letter, Template, CV. Each has “Create folder” (pick path, create dir, persist) and “Open folder” (open last used path). **Cloud:** replaced by upload/download or server-side storage per **§6.4**.
- **Cover Letter Generate:** Full-page workflow with state machine (`state=0` Stage-0 planning; `state>=1` iterative flow), feedback/iteration history, prompt update tools, and cover letter version output.
- **Settings:** Language (en/zh), theme (Default/Golden/Black). Stored in localStorage; no backend.
- **OpenAI Settings:** API key save/test, profile tuning (reasoning effort, text verbosity), timeout display, raw test feedback. **Cloud:** key is **per-user** in `auth.db` (§4, §6.2); **desktop:** may still use local `.secret` until unified.
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
└── plan.md               # §6.1 search, §6.2 API key, §6.3 mobile layout, §6.4 file actions, §10 Azure
```

---

## 4. Database & Config

**Location:** Same as auth: `app_data_dir()` from Tauri.  
**Files:**

- **auth.db** — Users, roles, permissions, user_roles, role_permissions, sessions, audit_log; also **per-user OpenAI API key** (encrypted, see below). Used for login and User Management.
- **easyapply.db** — Applied and code tables; same directory as auth.db, different filename to avoid conflict with other apps.

**auth.db — `users` table extension (per-user OpenAI API key, approach A):**

Chosen design: extend **`users`**, not a separate secrets table.

| Column | Type | Notes |
|--------|------|--------|
| `openai_api_key_encrypted` | TEXT or BLOB, nullable | AES (or equivalent) ciphertext; **never** plaintext at rest |
| `openai_api_key_updated_at_ms` | INTEGER, nullable | Last save/update from API Key Test |

- **Migration:** idempotent `ALTER TABLE` (or recreate-on-upgrade path in `ensure_auth_db`) when column missing; existing rows start with `NULL` → `hasApiKey = false`.
- **Desktop (current):** may continue using `app_config_dir()/openai_api_key.secret` until unified; **cloud** reads/writes **only** the logged-in user’s row.
- **Encryption key:** server-side **master key** from env e.g. `EASYAPPLY_SECRET_ENCRYPTION_KEY` (production: **Key Vault** reference on App Service). Do **not** derive from user password.

**Runtime behaviour (product rule):**

1. User logs in → opens **API Key Test** → enters or updates key → save runs validation + optional test call → **encrypt and store on that `user_id`**.
2. **Re-login later:** key **remains**; OpenAI calls load decrypt for **current session’s `user_id`** — **no re-entry** required.
3. **Logout:** session revoked only; **encrypted key stays** on the user row.
4. **Update:** new save **overwrites** ciphertext for the same user.
5. APIs/UI return **`hasApiKey`** only; **never** return full key to the client after save.
6. **Not** stored in Azure **`OPENAI_API_KEY`** app setting (that remains optional platform-wide fallback only, if ever used).

**easyapply.db schema:**

- **applied** (Job Applied) — **scoped by `user_id`** (session); users only see/edit their own rows.  
  - `id` INTEGER PRIMARY KEY AUTOINCREMENT  
  - `user_id` INTEGER NOT NULL — owner (`users.id` in `auth.db`)  
  - `company` TEXT NOT NULL DEFAULT ''  
  - `role` TEXT NOT NULL DEFAULT ''  
  - `via` TEXT NOT NULL DEFAULT ''  
  - `date` TEXT NOT NULL DEFAULT ''  
  - `status` TEXT NOT NULL DEFAULT ''  
  - `comments` TEXT NOT NULL DEFAULT ''

- **code** (Code Management) — **scoped by `user_id`** (same rules as `applied`).  
  - `id` INTEGER PRIMARY KEY AUTOINCREMENT  
  - `user_id` INTEGER NOT NULL  
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

### 6.1 Panel record search (Job Applied & Code Management)

**Goal:** Replace reliance on browser/WebView **Ctrl+F** (page find) with an in-panel search that selects a row and fills the existing **Edit** area—especially important for **mobile / Azure Web**, where Ctrl+F is unavailable or awkward.

**Scope:** One independent search bar per panel (`JobAppliedPanel`, `CodeManagementPanel`). Do not share a single search across both modules in v1.

#### Layout (top of each panel)

Vertical order inside the drawer panel:

1. **Search toolbar (sticky)** — input + Previous / Next + match counter (e.g. `2 / 7`). Stays visible at the top of the panel scroll area (`position: sticky; top: 0`) so users can advance matches after the table scrolls.
2. **Export Database / Import CSV / Open folder** — existing action block (unchanged order relative to table).
3. **Table** — `panel-table-wrap` (scrollable).
4. **Edit** — existing form bound to `selectedId` / `form` state.

#### Matching rules (v1)

- **Case-insensitive** substring match: compare `field.toLowerCase().includes(query.trim().toLowerCase())`.
- **“Fuzzy” in v1** means **contains**, not typo-tolerance or phonetic match (defer advanced fuzzy to a later version).
- **Job Applied fields:** `company`, `role`, `via`, `date`, `status`, `comments`.
- **Code Management fields:** `account`, `username`, `password`, `tel`, `email`, `comments`.
- **One row = one match slot:** if multiple columns on the same row match, it still counts once in the result list. **Next / Previous** cycle over **row ids** in table order, not per-cell hits.
- **Debounce** input (~300 ms) before recomputing matches.

#### Navigation behaviour

1. On query change, compute `matchIds[]` from the panel’s loaded `rows` (desktop: `applied_list` / `code_list`; cloud: same data via API list endpoint).
2. Show **0 / N** when no matches; disable Previous / Next when `N === 0`.
3. **Next:** `index = (index + 1) % N` (or stop at last—pick one behaviour in implementation; default: wrap).
4. **Previous:** `index = (index - 1 + N) % N`.
5. For the current match row, call the same logic as a row click: **`select(row)`** → updates `selectedId` and **Edit** fields (no separate “jump then click” step).
6. **Scroll:** `scrollIntoView({ block: "nearest" })` on the matching `<tr>` inside `panel-table-wrap` so the row is visible even when only the table body scrolls.
7. Optional: CSS class on the active match row (e.g. search highlight) in addition to `is-selected`.
8. **Clear search:** remove highlight; optional—keep last selected row or clear selection (document choice in UI copy).
9. **Keyboard (desktop):** optional `Enter` → next match, `Shift+Enter` → previous.

#### Rationale vs Ctrl+F

| Ctrl+F / find-in-page | Panel record search |
|----------------------|---------------------|
| Highlights DOM text on the current view | Operates on **all loaded records** in that module |
| Does not select row or populate Edit | **Select + Edit** via existing `select()` |
| Poor on mobile browsers | Search box + buttons are touch-friendly |

#### Cloud / Azure notes

- Same UX on **Web**; list data comes from the server copy of `easyapply.db` (not the desktop `data\` folder).
- Search in v1 runs on **client-loaded rows**; if lists are paginated later, add `GET /api/...?q=` but keep the same sticky toolbar and next/prev behaviour.
- **Auth:** search does not bypass permissions; Code Management search still requires the same login and server-side checks as list APIs.

#### Implementation touchpoints (when coding)

- `src/panels/JobAppliedPanel.tsx` — search state, match list, sticky toolbar above export section, `select` + `scrollIntoView`.
- `src/panels/CodeManagementPanel.tsx` — parallel implementation.
- `src/i18n/en.json` / `zh.json` — labels for search placeholder, prev/next, no results, match count.
- `src/style/theme.css` — sticky toolbar and optional row highlight.

### 6.2 Per-user OpenAI API key (approach A — `users` table)

**Decision:** Store each user’s API key on the **`users`** row (`openai_api_key_encrypted`, `openai_api_key_updated_at_ms`). See **§4** for schema.

#### Who can read/write

- **Save / update / test:** authenticated user may write **only their own** `user_id` (from session).
- **Use on AI routes:** after `auth_resume`-style check, `read_api_key_for_user(user_id)` → decrypt → call OpenAI.
- **Admin / User Management:** must **not** export or display other users’ keys (CSV and UI show username/role only).

#### HTTP surface (cloud; mirror desktop commands)

| Action | Behaviour |
|--------|-----------|
| Get profile | `hasApiKey`, model, reasoning, verbosity, timeout — **no** key material |
| Save + test | Body: `apiKey` once over HTTPS → validate `sk-` → encrypt → UPDATE `users` → optional test request |
| Generate cover letter / prompt update | Server uses **requesting user’s** decrypted key |

#### Frontend (web)

- Reuse **API Key Test** UI; `fetch` instead of `invoke`.
- Do **not** persist key in `localStorage` on web (remove or gate `easyapply-api-key-input` for web builds).
- Show masked state: “configured (hidden)” when `hasApiKey === true`.

#### Azure configuration

| Setting | Purpose |
|---------|---------|
| `EASYAPPLY_SECRET_ENCRYPTION_KEY` | Master key for encrypt/decrypt user API keys (Key Vault in production) |
| `OPENAI_API_KEY` (optional) | Platform default only if product allows users without personal keys; **not** per-user storage |

#### Implementation touchpoints (when coding)

- `src-tauri/src/auth/mod.rs` — migration, encrypt/decrypt helpers, `save_user_openai_key`, `user_has_openai_key`, `read_openai_key_for_user`.
- `src-tauri/src/ai.rs` — cloud path: resolve key by `user_id` instead of `openai_api_key_path(app)` only.
- `src/App.tsx` (Settings) — web vs desktop key persistence behaviour.
- `docs/plan.md` §4 — schema source of truth.

#### Security checklist

- Ciphertext at rest; TLS in transit.
- No key in logs, error messages, or GitHub Actions logs.
- Rate-limit save/test endpoints on public deployment.

### 6.3 Mobile & responsive layout (cloud / phone)

**Decision:** Do **not** ship the current desktop layout unchanged to mobile browsers. The existing UI is optimized for wide screens and Tauri; Azure Web on a phone needs explicit responsive behaviour.

#### Current desktop pain points (as-is on a phone browser)

| Area | Current behaviour | Phone impact |
|------|-----------------|--------------|
| **Home + side panel** | Left column (~420px min) + right **Panel** (≥360px) side-by-side; mouse resize handle | Total width often **780px+** → horizontal scroll or cramped columns |
| **Cover Letter Generate** | `.clg { min-width: 1280px }`, three-column grid | Strong horizontal scroll; poor in portrait |
| **Job / Code tables** | Six columns, ~220px scroll region, column resize via mouse | Hard to read and tap; Edit section far below |
| **Panel resize** | `panel-resize-handle` + `mousemove` | Not usable on touch |

#### Acceptable without layout work

- **Account** login, **Settings** (simple forms).
- **Home** main module buttons (stacked, max-width ~320px).

#### Required UX changes for cloud / mobile (target)

1. **Breakpoint:** e.g. `@media (max-width: 768px)` (tune in implementation).
2. **Panel:** full-screen **drawer or route** over home content—not permanent side-by-side with fixed min widths.
3. **Cover Letter:** single-column **stack** (JD → requirements → output / feedback); remove **`min-width: 1280px`** on web build.
4. **Job / Code lists:** prefer **card list** or fewer visible columns + detail view; keep **§6.1** sticky search as primary lookup on phone.
5. **Touch:** larger tap targets; no dependency on hover-only affordances.
6. **Detect runtime:** `window.__TAURI__` (or build flag)—apply mobile CSS only for **web** if desktop Tauri should keep current wide layout.

#### Implementation touchpoints (when coding)

- `src/style/theme.css` — responsive rules, CLG breakpoint layout.
- `src/App.tsx` — panel presentation mode (overlay vs split) by viewport.
- `src/panels/CoverLetterGeneratorPage.tsx` — optional simplified mobile sections.

### 6.4 File & folder actions: desktop vs cloud

Desktop uses **Tauri native dialogs** and **OS folder paths** (`pick_export_folder`, `pick_file_csv`, `explorer` / `open`). These **cannot** run identically in a phone browser or on Azure Linux. Cloud delivers the **same business outcome** via **HTTP upload/download** and **server-side paths** (per user), not the same controls.

#### Mapping table

| Desktop UI / command | Desktop behaviour | Cloud + phone equivalent | Same click behaviour? |
|----------------------|-----------------|---------------------------|------------------------|
| **Export Database** (Job / Code) | `pick_export_folder` → write CSV to chosen **local** dir | `GET /api/.../export.csv` → **download** file to phone (or show link) | **No** — download, not pick folder |
| **Import CSV** | `pick_file_csv` → read **local** path → import into DB | `<input type="file" accept=".csv">` → **upload** → server parses into DB | **No** — upload; **yes** for import result |
| **Open folder** (last export dir) | `open_last_export_dir` → **Windows explorer** | Show last export **filename/time** + **Download again**; no OS folder | **No** |
| **Create folder** (Application Material) | `pick_export_folder` → `mkdir` on **local** path → save in `easyapply.json` | Server directory or blob prefix per user + module; UI: **“Upload files”** / material list | **No** |
| **Open folder** (Application Material) | Open stored **local** path in explorer | **List + download** (or in-app preview) for files under user’s server storage | **No** |
| **Browse prompt** (Cover Letter) | `tauri-plugin-dialog` `open` → local `.md` path | **Upload** `.md` or pick from **saved prompts list** on server | **No** |
| `ai_open_folder` | `explorer` / `open` / `xdg-open` on path | N/A on phone; use download links for generated artefacts | **No** |

#### Server-side notes

- Do **not** call `explorer` on Azure Linux for end-user “open folder”.
- Persist export/material paths as **server paths or storage keys** in config (per user), not `C:\Users\...` strings from the client.
- **Import** may keep “replace table from CSV” semantics but must accept **multipart upload**, not a client filesystem path.
- Optional later: integrate **OneDrive / Google Drive**—out of scope for v1.

#### Frontend (web) pattern

- Shared helper: `isTauri()` → `invoke(...)` vs `fetch(...)` + file input / `download` attribute.
- Hide or relabel buttons on web: e.g. “Export Database” → **“Download CSV”**; “Open folder” → **“Download”** or remove.

#### Implementation touchpoints (when coding)

- `src/panels/JobAppliedPanel.tsx`, `CodeManagementPanel.tsx` — web export/import.
- `src/panels/ApplicationMaterialPanel.tsx` — upload/list instead of create/open folder.
- `src/panels/CoverLetterGeneratorPage.tsx` — prompt upload / server picker.
- `src-tauri/src/easyapply.rs`, `lib.rs`, `ai.rs` — HTTP counterparts; keep Tauri commands for desktop.
- `docs/plan.md` §10.3 — dual entry (invoke vs REST).

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
- **Panel search (desktop + web):** Implement **§6.1** in Job Applied and Code Management panels; ship on `main` when ready (benefits desktop immediately and Azure Web without Ctrl+F).
- **Mobile layout (cloud):** Implement **§6.3** before treating phone browsers as a supported target (responsive panel, CLG single-column, touch-friendly lists).
- **File actions (cloud):** Implement **§6.4** mapping (download/upload vs folder pickers); relabel UI on web builds.
- **Online / mobile (Azure track):** Follow **§10** (step-by-step ladder in **§10.9**) — HTTP service + container + CI/CD; combine **permission management** with TLS, authenticated APIs, and a clear data path (SQLite on persistent storage or managed PostgreSQL). Do not remove Tauri capabilities from `main` while the cloud stack matures on a dedicated branch.

---

## 10. Azure hosting & CI/CD development plan

This section describes how to evolve the repo **without dropping** current desktop behaviour: add a **parallel branch**, container artefacts, and automation so Azure App Service (Linux container) can **pull new images on each merge** to that branch. **§10.9** is the ordered runbook from today’s branch state to a **phone-accessible HTTPS URL**.

### 10.1 Principles

| Principle | Detail |
|-----------|--------|
| **Single repo** | Keep Tauri + React in `main`. Cloud-specific files (`Dockerfile`, `.github/workflows/`, optional `server/` crate) live on **`feat/azure-cicd`** (or another long-lived cloud branch) until stable enough to merge to `main` **without** breaking `npm run tauri build`. |
| **Baseline tag** | Branch from **`v2.1.2`** (or later release tags) so rollbacks and diffs are obvious. |
| **Desktop unchanged** | `main` continues to produce the Windows (and optional cross-platform) installer. Cloud work adds **new binaries / workflows**, not replacements for `app_lib::run()` until explicitly switched. |
| **Secrets** | **Per-user OpenAI keys** live encrypted in **`auth.db`** (§4, §6.2). **Encryption master key** in App settings / Key Vault (`EASYAPPLY_SECRET_ENCRYPTION_KEY`). Optional platform `OPENAI_API_KEY` is not a substitute for per-user keys. Never in frontend or Git. |

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
   - `tauri-plugin-dialog` (folder pickers, “open in Explorer”) → **web equivalents** per **§6.4** (download CSV, upload CSV, server-side material storage, prompt upload). See **§6.3** for layout differences on phone.

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
    branches: [feat/azure-cicd]
  workflow_dispatch:             # manual runs for testing
```

Optionally add **`paths`** filters so unrelated `README` edits on `main` do not trigger cloud builds.

**GitHub configuration checklist:**

- Repository **Environments** (e.g. `production`) with **required reviewers** if desired.  
- **OIDC federated identity** in Azure for `repo:ORG/easyapply:ref:refs/heads/feat/azure-cicd`.  
- ACR **AcrPull** granted to the Web App’s **managed identity** (preferred over admin user password).

### 10.5 Local verification (before Azure)

- **Docker Desktop (Windows):** `docker build -t easyapply-api:local .` then `docker run -p 8787:8787 -e PORT=8787 easyapply-api:local` and hit `http://localhost:8787/health`.  
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

### 10.9 Execution sequence: `feat/azure-cicd` → mobile browser–accessible system

Follow **in order**. Each phase assumes the previous one is done and verified. Branch: **`feat/azure-cicd`** (contains §10 doc; implementation commits stack here until merge policy allows `main`).

#### Phase 0 — Azure resources (one-time / portal)

1. **Confirm Web App** exists: Linux, container, public access, `httpsOnly` on; note **default hostname** (`https://<app>.<region>.azurewebsites.net`).  
2. **Create Azure Container Registry (ACR)** in the same or nearby region; choose **Basic** SKU for dev if cost-sensitive.  
3. **Enable admin user** *or* plan **Managed identity** for Web App → **AcrPull** on ACR (preferred before production).  
4. **App Service → Configuration → Application settings** (prepare keys; values added after secrets exist):  
   - `EASYAPPLY_SECRET_ENCRYPTION_KEY` — master key for per-user API key encryption (Key Vault reference in production).  
   - `EASYAPPLY_DATA_DIR=/home/site/wwwroot/data` (example) — `auth.db` / `easyapply.db` on persistent storage (see §10.2).  
   - `OPENAI_API_KEY` — **optional** platform default only (§6.2); end users’ keys are set in **API Key Test**, not here.  
5. **General settings:** turn **Always On** on (if SKU allows); set **Health check path** to `/health` once the server exposes it.  
6. **Save** configuration; optional **Restart** Web App after first real deploy.

#### Phase 1 — Repository: runnable HTTP server in a container (local first)

7. Add **`Dockerfile`** (multi-stage: build Rust server + slim runtime; `EXPOSE 8787`; `CMD` runs server).  
8. Add **`.dockerignore`** (exclude `target/`, `node_modules/`, local `data/`, `.git`, secrets).  
9. Add **`easyapply-server`** (or equivalent) binary: **Axum**, bind **`0.0.0.0`**, read **`PORT`** from env (Azure injects).  
10. Implement **`GET /health`** → `200 OK` (plain text or JSON).  
11. Introduce **config from env**: `EASYAPPLY_DATA_DIR` for `auth.db`, `easyapply.db`, `easyapply.json`; `EASYAPPLY_SECRET_ENCRYPTION_KEY` for user key encryption. Resolve OpenAI key via **logged-in `user_id`** → `users.openai_api_key_encrypted` (§6.2), not a global file. **Do not** read repo `data\` in production.  
12. **Local:** `docker build -t easyapply-api:local .` then run the container with a **mounted host folder** for data, e.g.  
    `docker run --rm -p 8787:8787 -e PORT=8787 -e EASYAPPLY_DATA_DIR=/data -v <host-abs-path-to-data>:/data easyapply-api:local`
    Verify **`http://localhost:8787/health`** (or HTTPS if you terminate TLS locally).

#### Phase 2 — Persist data & secrets behaviour (before exposing widely)

13. Ensure server **creates** `EASYAPPLY_DATA_DIR` if missing and opens SQLite there (same schema as desktop).  
14. **Smoke test:** stop container, start again with same `-v` mount; confirm DB changes **survive** (simulates Azure `/home` persistence pattern).  
15. Confirm **no API key** in image layers (`docker history` / build args); only env at runtime.

#### Phase 3 — API parity (incremental)

16. Expose HTTP routes matching priority **invoke** flows (auth login/session first, then read-only lists, then mutations).  
17. Add **CORS** only if SPA is separate origin; prefer **single origin** (Axum serves `dist/`) early.  
18. **Web auth:** session cookie or JWT; **HTTPS** only for cookies (`Secure`).

#### Phase 4 — Frontend usable in mobile browser

19. **Vite build** static assets; either embed in server image (**Option A §10.3**) or host separately with API base URL.  
20. Add **runtime detection** (`window.__TAURI__` or build flag): web build uses `fetch`, desktop keeps `invoke`.  
21. Replace **folder/file pickers** with `<input type="file">` / download endpoints for CSV and materials (per §10.3).  
22. **Panel record search (§6.1):** sticky search + next/prev in Job Applied and Code Management—primary mobile-friendly lookup (replaces Ctrl+F workflow).  
23. **Responsive layout (§6.3):** full-screen panel on narrow viewports; CLG without 1280px min-width; touch-friendly lists.  
24. **File actions (§6.4):** wire download/upload endpoints; hide or replace “open folder” on web.  
25. **Local mobile test:** phone on same Wi‑Fi or cellular → open **computer’s LAN IP + port** only for dev; for real mobile test use Phase 5 URL.

#### Phase 5 — GitHub Actions → ACR → App Service (automated updates)

25. In **Entra ID**: create **App registration** (or use existing) + **Federated credential** for GitHub OIDC (`repo:ORG/easyapply:environment:production` or branch ref `refs/heads/feat/azure-cicd`).  
26. Grant that identity **AcrPush** on ACR and **Website Contributor** (or narrower) on the resource group / Web App.  
27. In GitHub: add secrets **`AZURE_CLIENT_ID`**, **`AZURE_TENANT_ID`**, **`AZURE_SUBSCRIPTION_ID`**; optional Environment **`production`** with protection rules.  
28. Add **`.github/workflows/azure-deploy.yml`**: on `push` to `feat/azure-cicd` (and/or `workflow_dispatch`): checkout → `azure/login` (OIDC) → build → push `acr.azurecr.io/easyapply-api:<git_sha>` → `az webapp config container set` (or `az webapp create` if recreating) to point Web App at new image + registry credentials / MI.  
29. **First CI run:** use **`workflow_dispatch`** manually; watch Actions logs; confirm ACR shows new tag.  
30. **Portal:** Web App **Deployment Center** / **Container** blade should show new image; **Browse** site.

#### Phase 6 — Mobile production check

31. On phone browser, open **`https://<default-hostname>/`** (must be **HTTPS**). Confirm login + one CRUD path + one AI path if enabled.  
32. **Layout on phone:** verify **§6.3** (panel full-screen, CLG usable in portrait, no forced 1280px scroll).  
33. **Search on phone:** **§6.1** search in Job Applied / Code Management.  
34. **Files on phone:** **§6.4** — download CSV export, upload CSV import; no broken “open folder” actions.  
35. **Trigger a second deploy** (empty commit or small change) via CI; confirm **data still present** (SQLite under `/home`, secrets still in App settings).

#### Phase 7 — Hardening (before broader audience)

36. **Custom domain** + managed certificate (optional).  
37. **Access restrictions** or Front Door if limiting who can hit the site.  
38. **Backups:** script export of `/home/data` or migrate to **PostgreSQL** (§10.2 phase 2).  
39. **Application Insights** + OpenTelemetry when stable.

#### Rollback

- **Bad image:** Portal → Container → set image tag to previous digest **or** run last good workflow from GitHub **Actions** re-run; app data under `/home` remains if unchanged.  
- **Bad migration:** restore SQLite from backup taken before migration.

---

**Outcome:** A **HTTPS URL** works on **mobile Safari/Chrome**; **SQLite + JSON** live under **persistent `/home` (or mounted storage)**; **OpenAI key** stays in **Azure configuration**; **new container images** from CI **replace only code**, not user data or secrets.
