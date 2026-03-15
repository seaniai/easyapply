// src-tauri/src/auth/mod.rs
//
// Owns the local auth database schema and seed data.
// Provides ensure_auth_db(app) which is safe to call on every app start.
// Adds commands for user management (export/upsert/bulk apply).

use std::{fs, path::PathBuf};
use rusqlite::{params, Connection, OptionalExtension};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

mod csv;

pub const ROLE_ADMIN: &str = "Admin";
pub const ROLE_USER: &str = "User";

// Permission keys are treated as stable interface strings across UI and backend.
pub const PERM_ALL: &str = "*";
pub const PERM_FILE_MANAGE: &str = "file.manage";
pub const PERM_TRAINING_OPEN_FOLDER: &str = "training.open_folder";
pub const PERM_MODULE_OPEN_TEMPLATE: &str = "module.open_template";
pub const PERM_MODULE_OPEN_LESSONS: &str = "module.open_lessons";
pub const PERM_AUTH_MANAGE: &str = "auth.manage";

const DEFAULT_NEW_USER_PASSWORD: &str = "88888888";

pub fn auth_db_path(app: &AppHandle) -> Result<PathBuf, String> {
  let dir = app
    .path()
    .app_data_dir()
    .map_err(|e: tauri::Error| e.to_string())?;

  fs::create_dir_all(&dir).map_err(|e: std::io::Error| e.to_string())?;
  Ok(dir.join("auth.db"))
}

pub fn ensure_auth_db(app: &AppHandle) -> Result<(), String> {
  let db_path = auth_db_path(app)?;
  let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

  // Base schema (newest layout).
  conn
    .execute_batch(
      r#"
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at_ms INTEGER NOT NULL,
  last_login_ms INTEGER
);

CREATE TABLE IF NOT EXISTS roles (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS permissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id INTEGER NOT NULL,
  role_id INTEGER NOT NULL,
  PRIMARY KEY (user_id, role_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);

-- Newest mapping table: role_id -> permission_id (+ optional scope)
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id        INTEGER NOT NULL,
  permission_id  INTEGER NOT NULL,
  resource_scope TEXT NOT NULL DEFAULT '*',
  PRIMARY KEY (role_id, permission_id, resource_scope),
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,
  token         TEXT NOT NULL UNIQUE,
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER,
  revoked       INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts_ms     INTEGER NOT NULL,
  user_id   INTEGER,
  action    TEXT NOT NULL,
  resource  TEXT,
  result    TEXT NOT NULL,
  detail    TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts_ms);
"#,
    )
    .map_err(|e| e.to_string())?;

  // If an older schema exists (role_permissions has permission_key), migrate it to permissions + role_permissions(permission_id).
  migrate_role_permissions_if_needed(&conn)?;

  // Seed roles (idempotent).
  conn
    .execute("INSERT OR IGNORE INTO roles(name) VALUES (?)", params![ROLE_ADMIN])
    .map_err(|e| e.to_string())?;
  conn
    .execute("INSERT OR IGNORE INTO roles(name) VALUES (?)", params![ROLE_USER])
    .map_err(|e| e.to_string())?;

  // Seed permissions (idempotent).
  seed_permissions(&conn)?;

  // Seed role->permission assignments (idempotent).
  seed_role_permissions(&conn)?;

  // Ensure at least one admin user exists and is bound to Admin role.
  let admin_role_id = role_id(&conn, ROLE_ADMIN)?;
  ensure_default_admin(&conn, admin_role_id)?;

  Ok(())
}

fn seed_permissions(conn: &Connection) -> Result<(), String> {
  // Minimal set for current UI gating. Extend here when adding new features.
  let items: [(&str, &str); 6] = [
    (PERM_ALL, "Full access wildcard"),
    (PERM_AUTH_MANAGE, "Allow managing RBAC configuration"),
    (PERM_FILE_MANAGE, "Access file management features"),
    (PERM_TRAINING_OPEN_FOLDER, "Allow opening training folders in the OS"),
    (PERM_MODULE_OPEN_TEMPLATE, "Allow opening module template folders in the OS"),
    (PERM_MODULE_OPEN_LESSONS, "Allow opening lessons folders in the OS"),
  ];

  for (key, desc) in items {
    conn
      .execute(
        "INSERT OR IGNORE INTO permissions(key, description) VALUES (?, ?)",
        params![key, desc],
      )
      .map_err(|e| e.to_string())?;
  }

  Ok(())
}

fn seed_role_permissions(conn: &Connection) -> Result<(), String> {
  let admin_role_id = role_id(conn, ROLE_ADMIN)?;
  let user_role_id = role_id(conn, ROLE_USER)?;

  // Admin: wildcard permission.
  let perm_all_id = permission_id(conn, PERM_ALL)?;
  conn
    .execute(
      "INSERT OR IGNORE INTO role_permissions(role_id, permission_id, resource_scope) VALUES (?, ?, ?)",
      params![admin_role_id, perm_all_id, "*"],
    )
    .map_err(|e| e.to_string())?;

  // User: allow module template/lessons opening; deny file.manage and training.open_folder by default.
  for key in [PERM_MODULE_OPEN_TEMPLATE, PERM_MODULE_OPEN_LESSONS] {
    let pid = permission_id(conn, key)?;
    conn
      .execute(
        "INSERT OR IGNORE INTO role_permissions(role_id, permission_id, resource_scope) VALUES (?, ?, ?)",
        params![user_role_id, pid, "*"],
      )
      .map_err(|e| e.to_string())?;
  }

  Ok(())
}

fn migrate_role_permissions_if_needed(conn: &Connection) -> Result<(), String> {
  // Detect legacy column: role_permissions.permission_key
  if !table_exists(conn, "role_permissions")? {
    return Ok(());
  }

  if !table_has_column(conn, "role_permissions", "permission_key")? {
    // Already in newest format or not the legacy table.
    return Ok(());
  }

  // Ensure permissions table exists before migration.
  conn
    .execute_batch(
      r#"
CREATE TABLE IF NOT EXISTS permissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT NOT NULL UNIQUE,
  description TEXT
);
"#,
    )
    .map_err(|e| e.to_string())?;

  // Backfill permissions from legacy role_permissions.permission_key
  conn
    .execute_batch(
      r#"
INSERT OR IGNORE INTO permissions(key)
SELECT DISTINCT permission_key
FROM role_permissions
WHERE permission_key IS NOT NULL AND permission_key <> '';
"#,
    )
    .map_err(|e| e.to_string())?;

  // Create a new mapping table using permission_id.
  conn
    .execute_batch(
      r#"
CREATE TABLE IF NOT EXISTS role_permissions_new (
  role_id        INTEGER NOT NULL,
  permission_id  INTEGER NOT NULL,
  resource_scope TEXT NOT NULL DEFAULT '*',
  PRIMARY KEY (role_id, permission_id, resource_scope),
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO role_permissions_new(role_id, permission_id, resource_scope)
SELECT rp.role_id, p.id, rp.resource_scope
FROM role_permissions rp
JOIN permissions p ON p.key = rp.permission_key;

DROP TABLE role_permissions;
ALTER TABLE role_permissions_new RENAME TO role_permissions;
"#,
    )
    .map_err(|e| e.to_string())?;

  Ok(())
}

fn role_id(conn: &Connection, role_name: &str) -> Result<i64, String> {
  conn
    .query_row(
      "SELECT id FROM roles WHERE name = ?",
      params![role_name],
      |row| row.get::<_, i64>(0),
    )
    .map_err(|e| e.to_string())
}

fn role_id_case_insensitive(conn: &Connection, role_name_raw: &str) -> Result<i64, String> {
  let rn = role_name_raw.trim();
  if rn.is_empty() {
    return Err("Role is required.".to_string());
  }
  conn
    .query_row(
      "SELECT id FROM roles WHERE lower(name) = lower(?)",
      params![rn],
      |row| row.get::<_, i64>(0),
    )
    .map_err(|_| format!("Role \"{}\" does not exist in DB roles table.", role_name_raw))
}

fn permission_id(conn: &Connection, key: &str) -> Result<i64, String> {
  conn
    .query_row(
      "SELECT id FROM permissions WHERE key = ?",
      params![key],
      |row| row.get::<_, i64>(0),
    )
    .map_err(|e| e.to_string())
}

fn ensure_default_admin(conn: &Connection, admin_role_id: i64) -> Result<(), String> {
  let admin_count: i64 = conn
    .query_row(
      r#"
SELECT COUNT(1)
FROM users u
JOIN user_roles ur ON ur.user_id = u.id
WHERE ur.role_id = ?
"#,
      params![admin_role_id],
      |row| row.get::<_, i64>(0),
    )
    .map_err(|e| e.to_string())?;

  if admin_count > 0 {
    return Ok(());
  }

  let now_ms = now_ms();

  // Placeholder password storage; replace with a real hash when implementing auth_login.
  conn
    .execute(
      "INSERT OR IGNORE INTO users(username, password_hash, is_active, created_at_ms) VALUES (?, ?, 1, ?)",
      params!["admin", "admin123", now_ms],
    )
    .map_err(|e| e.to_string())?;

  let admin_user_id: i64 = conn
    .query_row(
      "SELECT id FROM users WHERE username = ?",
      params!["admin"],
      |row| row.get::<_, i64>(0),
    )
    .map_err(|e| e.to_string())?;

  conn
    .execute(
      "INSERT OR IGNORE INTO user_roles(user_id, role_id) VALUES (?, ?)",
      params![admin_user_id, admin_role_id],
    )
    .map_err(|e| e.to_string())?;

  Ok(())
}

fn table_exists(conn: &Connection, table: &str) -> Result<bool, String> {
  let n: i64 = conn
    .query_row(
      "SELECT COUNT(1) FROM sqlite_master WHERE type='table' AND name=?",
      params![table],
      |row| row.get::<_, i64>(0),
    )
    .map_err(|e| e.to_string())?;
  Ok(n > 0)
}

fn table_has_column(conn: &Connection, table: &str, col: &str) -> Result<bool, String> {
  let mut stmt = conn
    .prepare(&format!("PRAGMA table_info({})", table))
    .map_err(|e| e.to_string())?;

  let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
  while let Some(row) = rows.next().map_err(|e| e.to_string())? {
    let name: String = row.get(1).map_err(|e| e.to_string())?;
    if name == col {
      return Ok(true);
    }
  }
  Ok(false)
}

fn now_ms() -> i64 {
  use std::time::{SystemTime, UNIX_EPOCH};
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_millis() as i64
}

#[derive(serde::Serialize)]
pub struct AuthUserInfo {
  pub user_id: i64,
  pub username: String,
  pub roles: Vec<String>,
  pub permissions: Vec<String>,
}

#[derive(serde::Serialize)]
pub struct AuthSession {
  pub token: String,
  pub user: AuthUserInfo,
}

pub fn auth_login(app: &AppHandle, username: &str, password: &str, remember_me: bool) -> Result<AuthSession, String> {
  let db_path = auth_db_path(app)?;
  let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

  let (user_id, stored_pw, is_active): (i64, String, i64) = conn
    .query_row(
      "SELECT id, password_hash, is_active FROM users WHERE username = ?",
      params![username],
      |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .map_err(|_| "Invalid username or password".to_string())?;

  if is_active != 1 {
    return Err("User is inactive".to_string());
  }
  if stored_pw != password {
    return Err("Invalid username or password".to_string());
  }

  let now = now_ms();
  conn
    .execute("UPDATE users SET last_login_ms = ? WHERE id = ?", params![now, user_id])
    .map_err(|e| e.to_string())?;

  let token = Uuid::new_v4().to_string();
  let expires_at_ms: Option<i64> = if remember_me {
    Some(now + 30_i64 * 24 * 3600 * 1000) // 30 days
  } else {
    None
  };

  conn
    .execute(
      "INSERT INTO sessions(user_id, token, created_at_ms, expires_at_ms, revoked) VALUES (?, ?, ?, ?, 0)",
      params![user_id, token, now, expires_at_ms],
    )
    .map_err(|e| e.to_string())?;

  let user = build_user_info(&conn, user_id)?;
  Ok(AuthSession { token, user })
}

pub fn auth_resume(app: &AppHandle, token: &str) -> Result<AuthSession, String> {
  let db_path = auth_db_path(app)?;
  let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

  let (user_id, revoked, expires_at_ms): (i64, i64, Option<i64>) = conn
    .query_row(
      "SELECT user_id, revoked, expires_at_ms FROM sessions WHERE token = ?",
      params![token],
      |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .map_err(|_| "Invalid session".to_string())?;

  if revoked != 0 {
    return Err("Session revoked".to_string());
  }
  if let Some(exp) = expires_at_ms {
    if now_ms() > exp {
      return Err("Session expired".to_string());
    }
  }

  let user = build_user_info(&conn, user_id)?;
  Ok(AuthSession { token: token.to_string(), user })
}

pub fn auth_logout(app: &AppHandle, token: &str) -> Result<(), String> {
  let db_path = auth_db_path(app)?;
  let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
  conn
    .execute("UPDATE sessions SET revoked = 1 WHERE token = ?", params![token])
    .map_err(|e| e.to_string())?;
  Ok(())
}

pub fn auth_whoami(app: &AppHandle, token: &str) -> Result<AuthUserInfo, String> {
  let s = auth_resume(app, token)?;
  Ok(s.user)
}

pub fn auth_change_password(
  app: &AppHandle,
  token: &str,
  old_password: &str,
  new_password: &str,
) -> Result<(), String> {
  let db_path = auth_db_path(app)?;
  let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

  let oldp = old_password;
  let newp = new_password.trim();

  if newp.is_empty() {
    return Err("New password is required".to_string());
  }

  // Resolve session -> user_id, check revoked/expiry (reuse same logic style as auth_resume)
  let (user_id, revoked, expires_at_ms): (i64, i64, Option<i64>) = conn
    .query_row(
      "SELECT user_id, revoked, expires_at_ms FROM sessions WHERE token = ?",
      params![token],
      |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .map_err(|_| "Invalid session".to_string())?;

  if revoked != 0 {
    return Err("Session revoked".to_string());
  }
  if let Some(exp) = expires_at_ms {
    if now_ms() > exp {
      return Err("Session expired".to_string());
    }
  }

  // Verify old password
  let stored_pw: String = conn
    .query_row(
      "SELECT password_hash FROM users WHERE id = ?",
      params![user_id],
      |row| row.get(0),
    )
    .map_err(|e| e.to_string())?;

  if stored_pw != oldp {
    return Err("Old password is incorrect".to_string());
  }

  // Update password (current scheme is plaintext-in-password_hash)
  conn
    .execute(
      "UPDATE users SET password_hash = ? WHERE id = ?",
      params![newp, user_id],
    )
    .map_err(|e| e.to_string())?;

  Ok(())
}

fn build_user_info(conn: &Connection, user_id: i64) -> Result<AuthUserInfo, String> {
  let username: String = conn
    .query_row("SELECT username FROM users WHERE id = ?", params![user_id], |r| r.get(0))
    .map_err(|e| e.to_string())?;

  let roles: Vec<String> = {
    let mut stmt = conn
      .prepare(
        r#"
SELECT r.name
FROM user_roles ur
JOIN roles r ON r.id = ur.role_id
WHERE ur.user_id = ?
"#,
      )
      .map_err(|e| e.to_string())?;
    let it = stmt
      .query_map(params![user_id], |r| r.get::<_, String>(0))
      .map_err(|e| e.to_string())?;
    let mut out = vec![];
    for x in it {
      out.push(x.map_err(|e| e.to_string())?);
    }
    out
  };

  let mut permissions: Vec<String> = {
    let mut stmt = conn
      .prepare(
        r#"
SELECT DISTINCT p.key
FROM user_roles ur
JOIN role_permissions rp ON rp.role_id = ur.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE ur.user_id = ?
"#,
      )
      .map_err(|e| e.to_string())?;
    let it = stmt
      .query_map(params![user_id], |r| r.get::<_, String>(0))
      .map_err(|e| e.to_string())?;
    let mut out = vec![];
    for x in it {
      out.push(x.map_err(|e| e.to_string())?);
    }
    out
  };

  if permissions.iter().any(|k| k == PERM_ALL) {
    // Wildcard present: treat as allow-all in gating logic.
  } else {
    permissions.sort();
  }

  Ok(AuthUserInfo { user_id, username, roles, permissions })
}

// ==============================
// User Management Commands
// ==============================

fn list_db_roles(conn: &Connection) -> Result<Vec<String>, String> {
  let mut stmt = conn
    .prepare("SELECT name FROM roles ORDER BY name ASC")
    .map_err(|e| e.to_string())?;
  let it = stmt
    .query_map([], |r| r.get::<_, String>(0))
    .map_err(|e| e.to_string())?;
  let mut out = vec![];
  for x in it {
    out.push(x.map_err(|e| e.to_string())?);
  }
  Ok(out)
}

// Export CSV (role,id,username) into folderPath, return saved file path.
// Contract: one user id should map to exactly one role; if multiple, return error.
#[tauri::command]
pub fn auth_export_users_csv(app: AppHandle, folder_path: String) -> Result<String, String> {
  ensure_auth_db(&app)?;

  let db_path = auth_db_path(&app)?;
  let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

  let folder = folder_path.trim();
  if folder.is_empty() {
    return Err("folderPath is required.".to_string());
  }
  let dir = PathBuf::from(folder);
  fs::create_dir_all(&dir).map_err(|e| format!("Create folder failed: {e}"))?;

  // Detect users with multiple roles (violates invariant)
  let multi_cnt: i64 = conn
    .query_row(
      r#"
SELECT COUNT(1) FROM (
  SELECT ur.user_id, COUNT(1) c
  FROM user_roles ur
  GROUP BY ur.user_id
  HAVING c > 1
) t
"#,
      [],
      |r| r.get(0),
    )
    .map_err(|e| e.to_string())?;

  if multi_cnt > 0 {
    return Err(format!(
      "Export blocked: found {multi_cnt} users with multiple roles. Fix user_roles invariant first."
    ));
  }

  // Export: users that have a role; if a user has no role row, treat role as empty (still export).
  let mut stmt = conn
    .prepare(
      r#"
SELECT
  COALESCE(r.name, '') AS role,
  u.id,
  u.username
FROM users u
LEFT JOIN user_roles ur ON ur.user_id = u.id
LEFT JOIN roles r ON r.id = ur.role_id
ORDER BY u.id ASC
"#,
    )
    .map_err(|e| e.to_string())?;

  let it = stmt
    .query_map([], |row| {
      Ok(csv::UserRow {
        role: row.get::<_, String>(0)?,
        id: row.get::<_, i64>(1)?,
        username: row.get::<_, String>(2)?,
      })
    })
    .map_err(|e| e.to_string())?;

  let mut rows: Vec<csv::UserRow> = vec![];
  for x in it {
    rows.push(x.map_err(|e| e.to_string())?);
  }

  let ts = now_ms();
  let file_name = format!("auth_users_{ts}.csv");
  let abs_path = dir.join(file_name);

  csv::write_users_csv(abs_path.to_string_lossy().as_ref(), &rows)?;
  Ok(abs_path.to_string_lossy().to_string())
}

// Upsert user by username with role, or delete when role == "delete" (case-insensitive).
// - If user exists: reassign to exactly one role.
// - If user doesn't exist: create with default password "88888888" and bind role.
// - Delete requires existing user (else error).
#[tauri::command]
pub fn auth_upsert_user_role(app: AppHandle, username: String, role: String) -> Result<(), String> {
  ensure_auth_db(&app)?;

  let u = username.trim();
  if u.is_empty() {
    return Err("username is required.".to_string());
  }

  let r_norm = role.trim().to_lowercase();
  let db_path = auth_db_path(&app)?;
  let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

  let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

  // Find user if exists
  let user_id_opt: Option<i64> = tx
    .query_row(
      "SELECT id FROM users WHERE username = ?",
      params![u],
      |row| row.get::<_, i64>(0),
    )
    .optional()
    .map_err(|e| e.to_string())?;

  if r_norm == "delete" {
    let user_id = user_id_opt.ok_or_else(|| format!("Delete failed: user \"{}\" does not exist.", u))?;
    tx.execute("DELETE FROM users WHERE id = ?", params![user_id])
      .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    return Ok(());
  }

  // role must exist (case-insensitive)
  let role_id = role_id_case_insensitive(&tx, &role)?;

  let now = now_ms();

  let user_id = if let Some(uid) = user_id_opt {
    uid
  } else {
    // Create user with default password (plaintext in current scheme)
    tx.execute(
      "INSERT INTO users(username, password_hash, is_active, created_at_ms) VALUES (?, ?, 1, ?)",
      params![u, DEFAULT_NEW_USER_PASSWORD, now],
    )
    .map_err(|e| e.to_string())?;

    tx.query_row(
      "SELECT id FROM users WHERE username = ?",
      params![u],
      |row| row.get::<_, i64>(0),
    )
    .map_err(|e| e.to_string())?
  };

  // Enforce exactly one role: clear then insert
  tx.execute("DELETE FROM user_roles WHERE user_id = ?", params![user_id])
    .map_err(|e| e.to_string())?;
  tx.execute(
    "INSERT OR IGNORE INTO user_roles(user_id, role_id) VALUES (?, ?)",
    params![user_id, role_id],
  )
  .map_err(|e| e.to_string())?;

  tx.commit().map_err(|e| e.to_string())?;
  Ok(())
}

// Bulk apply from CSV file path.
// - dryRun=true  => return ValidationReport
// - dryRun=false => apply transaction + return ApplyResult
//
// Validation rules (CSV bulk apply):
// - CSV header: role,id,username
// - role: case-insensitive; must exist in roles table; additionally allow "delete"
// - id: integer; unique in CSV
// - username: unique in CSV (case-insensitive)
// - each row non-empty
// - if id exists in DB: username must match DB username exactly
// - if username exists in DB but with different id => error
// - delete requires id exists
#[tauri::command]
pub fn auth_bulk_apply_csv(app: AppHandle, abs_path: String, dry_run: bool) -> Result<serde_json::Value, String> {
  ensure_auth_db(&app)?;

  let path = abs_path.trim();
  if path.is_empty() {
    return Err("absPath is required.".to_string());
  }

  let db_path = auth_db_path(&app)?;
  let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

  // Load CSV rows
  let rows = csv::read_users_csv(path)?;

  // Read DB mappings for validation
  let (id_to_username, username_to_id) = load_user_maps(&conn)?;
  let roles = list_db_roles(&conn)?;

  let v = csv::validate_and_plan(rows, &roles, &id_to_username, &username_to_id);

  if dry_run {
    return Ok(serde_json::to_value(&v.report).map_err(|e| e.to_string())?);
  }

  if !v.report.ok {
    return Ok(serde_json::to_value(&v.report).map_err(|e| e.to_string())?);
  }

  let plan = v.plan.ok_or_else(|| "Internal error: validation ok but plan missing.".to_string())?;

  // Apply in a single transaction
  let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

  let mut inserted: u64 = 0;
  let mut updated: u64 = 0;
  let mut deleted: u64 = 0;
  let mut skipped: u64 = 0;
  let warnings: Vec<String> = v.report.warnings.clone();

  let now = now_ms();

  // Deletes
  for r in plan.to_delete.iter() {
    let n = tx
      .execute("DELETE FROM users WHERE id = ?", params![r.id])
      .map_err(|e| e.to_string())?;
    if n == 1 { deleted += 1; } else { skipped += 1; }
  }

  // Updates (existing id; username already validated to match)
  for r in plan.to_update.iter() {
    let role_id = role_id_case_insensitive(&tx, &r.role)?;
    // enforce single role
    tx.execute("DELETE FROM user_roles WHERE user_id = ?", params![r.id])
      .map_err(|e| e.to_string())?;
    tx.execute(
      "INSERT OR IGNORE INTO user_roles(user_id, role_id) VALUES (?, ?)",
      params![r.id, role_id],
    )
    .map_err(|e| e.to_string())?;
    updated += 1;
  }

  // Inserts (new id)
  for r in plan.to_insert.iter() {
    let role_id = role_id_case_insensitive(&tx, &r.role)?;

    // Insert user with explicit id (allowed by SQLite for INTEGER PRIMARY KEY)
    tx.execute(
      "INSERT INTO users(id, username, password_hash, is_active, created_at_ms) VALUES (?, ?, ?, 1, ?)",
      params![r.id, r.username, DEFAULT_NEW_USER_PASSWORD, now],
    )
    .map_err(|e| e.to_string())?;

    // Single role mapping
    tx.execute(
      "INSERT OR IGNORE INTO user_roles(user_id, role_id) VALUES (?, ?)",
      params![r.id, role_id],
    )
    .map_err(|e| e.to_string())?;

    inserted += 1;
  }

  tx.commit().map_err(|e| e.to_string())?;

  let res = csv::ApplyResult {
    applied: true,
    rows: plan.rows.len(),
    inserted,
    updated,
    deleted,
    skipped,
    warnings,
  };

  Ok(serde_json::to_value(&res).map_err(|e| e.to_string())?)
}

fn load_user_maps(conn: &Connection) -> Result<(std::collections::HashMap<i64, String>, std::collections::HashMap<String, i64>), String> {
  use std::collections::HashMap;

  let mut id_to_username: HashMap<i64, String> = HashMap::new();
  let mut username_to_id: HashMap<String, i64> = HashMap::new();

  let mut stmt = conn
    .prepare("SELECT id, username FROM users")
    .map_err(|e| e.to_string())?;
  let it = stmt
    .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
    .map_err(|e| e.to_string())?;

  for x in it {
    let (id, username) = x.map_err(|e| e.to_string())?;
    id_to_username.insert(id, username.clone());
    username_to_id.insert(username.trim().to_lowercase(), id);
  }

  Ok((id_to_username, username_to_id))
}
