// easyapply.db: job applications (applied) and code/password records (code).
// Config easyapply.json: last export dirs, application material folder paths.
// DB lives in same dir as auth.db (app_data_dir); filename easyapply.db to avoid conflict with other apps.

use std::fs;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::Command;

use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
  let dir = app.path().app_data_dir().map_err(|e: tauri::Error| e.to_string())?;
  fs::create_dir_all(&dir).map_err(|e: std::io::Error| e.to_string())?;
  Ok(dir)
}

fn easyapply_db_path(app: &AppHandle) -> Result<PathBuf, String> {
  Ok(app_data_dir(app)?.join("easyapply.db"))
}

fn open_in_explorer(dir: &Path) -> Result<(), String> {
  fs::create_dir_all(dir).map_err(|e| e.to_string())?;
  Command::new("explorer")
    .arg(dir.to_string_lossy().to_string())
    .spawn()
    .map_err(|e| e.to_string())?;
  Ok(())
}

// ---- Config (easyapply.json in app_config_dir) ----
fn easyapply_config_path(app: &AppHandle) -> Result<PathBuf, String> {
  let dir = app.path().app_config_dir().map_err(|e: tauri::Error| e.to_string())?;
  fs::create_dir_all(&dir).map_err(|e: std::io::Error| e.to_string())?;
  Ok(dir.join("easyapply.json"))
}

#[derive(serde::Serialize, serde::Deserialize, Default, Clone)]
pub struct EasyapplyConfig {
  pub last_export_dir_job: Option<String>,
  pub last_export_dir_code: Option<String>,
  pub app_material_cover_letter: Option<String>,
  pub app_material_template: Option<String>,
  pub app_material_cv: Option<String>,
}

fn read_easyapply_config(app: &AppHandle) -> Result<EasyapplyConfig, String> {
  let p = easyapply_config_path(app)?;
  if !p.exists() {
    return Ok(EasyapplyConfig::default());
  }
  let s = fs::read_to_string(&p).map_err(|e| e.to_string())?;
  serde_json::from_str(&s).map_err(|e| e.to_string())
}

fn write_easyapply_config(app: &AppHandle, cfg: &EasyapplyConfig) -> Result<(), String> {
  let p = easyapply_config_path(app)?;
  let s = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
  fs::write(&p, s).map_err(|e| e.to_string())
}

// ---- DB schema ----
pub fn ensure_easyapply_db(app: &AppHandle) -> Result<(), String> {
  let db_path = easyapply_db_path(app)?;
  let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;

  conn
    .execute_batch(
      r#"
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS applied (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company    TEXT NOT NULL DEFAULT '',
  role       TEXT NOT NULL DEFAULT '',
  via        TEXT NOT NULL DEFAULT '',
  date       TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT '',
  comments   TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS code (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  account    TEXT NOT NULL DEFAULT '',
  username   TEXT NOT NULL DEFAULT '',
  password   TEXT NOT NULL DEFAULT '',
  tel        TEXT NOT NULL DEFAULT '',
  email      TEXT NOT NULL DEFAULT '',
  comments   TEXT NOT NULL DEFAULT ''
);
"#,
    )
    .map_err(|e| e.to_string())?;

  Ok(())
}

// ---- Applied (Job Applied) ----
#[derive(Debug, Serialize, Deserialize)]
pub struct AppliedRow {
  pub id: i64,
  pub company: String,
  pub role: String,
  pub via: String,
  pub date: String,
  pub status: String,
  pub comments: String,
}

#[tauri::command]
pub fn applied_list(app: AppHandle) -> Result<Vec<AppliedRow>, String> {
  let db_path = easyapply_db_path(&app)?;
  let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;

  let mut stmt = conn
    .prepare("SELECT id, company, role, via, date, status, comments FROM applied ORDER BY id")
    .map_err(|e| e.to_string())?;
  let rows = stmt
    .query_map([], |r| {
      Ok(AppliedRow {
        id: r.get(0)?,
        company: r.get(1)?,
        role: r.get(2)?,
        via: r.get(3)?,
        date: r.get(4)?,
        status: r.get(5)?,
        comments: r.get(6)?,
      })
    })
    .map_err(|e| e.to_string())?;

  let mut out = vec![];
  for row in rows {
    out.push(row.map_err(|e| e.to_string())?);
  }
  Ok(out)
}

#[tauri::command]
pub fn applied_create(
  app: AppHandle,
  company: String,
  role: String,
  via: String,
  date: String,
  status: String,
  comments: String,
) -> Result<i64, String> {
  let db_path = easyapply_db_path(&app)?;
  let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
  conn
    .execute(
      "INSERT INTO applied (company, role, via, date, status, comments) VALUES (?1,?2,?3,?4,?5,?6)",
      params![company, role, via, date, status, comments],
    )
    .map_err(|e| e.to_string())?;
  Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn applied_update(
  app: AppHandle,
  id: i64,
  company: String,
  role: String,
  via: String,
  date: String,
  status: String,
  comments: String,
) -> Result<(), String> {
  let db_path = easyapply_db_path(&app)?;
  let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
  conn
    .execute(
      "UPDATE applied SET company=?1, role=?2, via=?3, date=?4, status=?5, comments=?6 WHERE id=?7",
      params![company, role, via, date, status, comments, id],
    )
    .map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
pub fn applied_delete(app: AppHandle, id: i64) -> Result<(), String> {
  let db_path = easyapply_db_path(&app)?;
  let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
  conn
    .execute("DELETE FROM applied WHERE id=?1", params![id])
    .map_err(|e| e.to_string())?;
  Ok(())
}

/// UTF-8 BOM for Excel "CSV UTF-8 (Comma delimited)"
const UTF8_BOM: &[u8] = &[0xEF, 0xBB, 0xBF];

#[tauri::command]
pub fn applied_export_csv(app: AppHandle, dir: String) -> Result<String, String> {
  let rows = applied_list(app.clone())?;
  let path = PathBuf::from(&dir);
  fs::create_dir_all(&path).map_err(|e| e.to_string())?;
  let file_path = path.join("job_applied.csv");
  let mut file = File::create(&file_path).map_err(|e| e.to_string())?;
  file.write_all(UTF8_BOM).map_err(|e| e.to_string())?;
  let mut w = csv::Writer::from_writer(file);
  w.write_record(["Company", "Role", "Via", "Date", "Status", "Comments"])
    .map_err(|e| e.to_string())?;
  for r in &rows {
    w.write_record([&r.company, &r.role, &r.via, &r.date, &r.status, &r.comments])
      .map_err(|e| e.to_string())?;
  }
  w.flush().map_err(|e| e.to_string())?;
  set_last_export_dir(app, "job", dir)?;
  Ok(file_path.to_string_lossy().to_string())
}

fn csv_reader_strip_bom(path: &Path) -> Result<csv::Reader<File>, String> {
  let mut file = File::open(path).map_err(|e| e.to_string())?;
  let mut bom = [0u8; 3];
  let n = file.read(&mut bom).map_err(|e| e.to_string())?;
  if n == 3 && bom == UTF8_BOM {
    // already past BOM
  } else {
    file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
  }
  Ok(csv::Reader::from_reader(file))
}

#[tauri::command]
pub fn applied_import_csv(app: AppHandle, file_path: String) -> Result<ImportResult, String> {
  let path = PathBuf::from(&file_path);
  let mut rdr = csv_reader_strip_bom(&path)?;
  let db_path = easyapply_db_path(&app)?;
  let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
  conn.execute("DELETE FROM applied", []).map_err(|e| e.to_string())?;

  let mut inserted = 0u32;
  for result in rdr.deserialize() {
    let record: CsvApplied = result.map_err(|e| e.to_string())?;
    conn
      .execute(
        "INSERT INTO applied (company, role, via, date, status, comments) VALUES (?1,?2,?3,?4,?5,?6)",
        params![
          record.company,
          record.role,
          record.via,
          record.date,
          record.status,
          record.comments,
        ],
      )
      .map_err(|e| e.to_string())?;
    inserted += 1;
  }
  Ok(ImportResult { inserted })
}

#[derive(Deserialize)]
struct CsvApplied {
  #[serde(rename = "Company")]
  company: String,
  #[serde(rename = "Role")]
  role: String,
  #[serde(rename = "Via")]
  via: String,
  #[serde(rename = "Date")]
  date: String,
  #[serde(rename = "Status")]
  status: String,
  #[serde(rename = "Comments")]
  comments: String,
}

#[derive(Serialize)]
pub struct ImportResult {
  pub inserted: u32,
}

// ---- Code (Code Management) ----
#[derive(Debug, Serialize, Deserialize)]
pub struct CodeRow {
  pub id: i64,
  pub account: String,
  pub username: String,
  pub password: String,
  pub tel: String,
  pub email: String,
  pub comments: String,
}

#[tauri::command]
pub fn code_list(app: AppHandle) -> Result<Vec<CodeRow>, String> {
  let db_path = easyapply_db_path(&app)?;
  let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;

  let mut stmt = conn
    .prepare("SELECT id, account, username, password, tel, email, comments FROM code ORDER BY id")
    .map_err(|e| e.to_string())?;
  let rows = stmt
    .query_map([], |r| {
      Ok(CodeRow {
        id: r.get(0)?,
        account: r.get(1)?,
        username: r.get(2)?,
        password: r.get(3)?,
        tel: r.get(4)?,
        email: r.get(5)?,
        comments: r.get(6)?,
      })
    })
    .map_err(|e| e.to_string())?;

  let mut out = vec![];
  for row in rows {
    out.push(row.map_err(|e| e.to_string())?);
  }
  Ok(out)
}

#[tauri::command]
pub fn code_create(
  app: AppHandle,
  account: String,
  username: String,
  password: String,
  tel: String,
  email: String,
  comments: String,
) -> Result<i64, String> {
  let db_path = easyapply_db_path(&app)?;
  let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
  conn
    .execute(
      "INSERT INTO code (account, username, password, tel, email, comments) VALUES (?1,?2,?3,?4,?5,?6)",
      params![account, username, password, tel, email, comments],
    )
    .map_err(|e| e.to_string())?;
  Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn code_update(
  app: AppHandle,
  id: i64,
  account: String,
  username: String,
  password: String,
  tel: String,
  email: String,
  comments: String,
) -> Result<(), String> {
  let db_path = easyapply_db_path(&app)?;
  let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
  conn
    .execute(
      "UPDATE code SET account=?1, username=?2, password=?3, tel=?4, email=?5, comments=?6 WHERE id=?7",
      params![account, username, password, tel, email, comments, id],
    )
    .map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
pub fn code_delete(app: AppHandle, id: i64) -> Result<(), String> {
  let db_path = easyapply_db_path(&app)?;
  let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
  conn
    .execute("DELETE FROM code WHERE id=?1", params![id])
    .map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
pub fn code_export_csv(app: AppHandle, dir: String) -> Result<String, String> {
  let rows = code_list(app.clone())?;
  let path = PathBuf::from(&dir);
  fs::create_dir_all(&path).map_err(|e| e.to_string())?;
  let file_path = path.join("code_management.csv");
  let mut file = File::create(&file_path).map_err(|e| e.to_string())?;
  file.write_all(UTF8_BOM).map_err(|e| e.to_string())?;
  let mut w = csv::Writer::from_writer(file);
  w.write_record(["Account", "Username", "Password", "Tel", "Email", "Comments"])
    .map_err(|e| e.to_string())?;
  for r in &rows {
    w.write_record([
      &r.account,
      &r.username,
      &r.password,
      &r.tel,
      &r.email,
      &r.comments,
    ])
    .map_err(|e| e.to_string())?;
  }
  w.flush().map_err(|e| e.to_string())?;
  set_last_export_dir(app, "code", dir)?;
  Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn code_import_csv(app: AppHandle, file_path: String) -> Result<ImportResult, String> {
  let path = PathBuf::from(&file_path);
  let mut rdr = csv_reader_strip_bom(&path)?;
  let db_path = easyapply_db_path(&app)?;
  let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
  conn.execute("DELETE FROM code", []).map_err(|e| e.to_string())?;

  let mut inserted = 0u32;
  for result in rdr.deserialize() {
    let record: CsvCode = result.map_err(|e| e.to_string())?;
    conn
      .execute(
        "INSERT INTO code (account, username, password, tel, email, comments) VALUES (?1,?2,?3,?4,?5,?6)",
        params![
          record.account,
          record.username,
          record.password,
          record.tel,
          record.email,
          record.comments,
        ],
      )
      .map_err(|e| e.to_string())?;
    inserted += 1;
  }
  Ok(ImportResult { inserted })
}

#[derive(Deserialize)]
struct CsvCode {
  #[serde(rename = "Account")]
  account: String,
  #[serde(rename = "Username")]
  username: String,
  #[serde(rename = "Password")]
  password: String,
  #[serde(rename = "Tel")]
  tel: String,
  #[serde(rename = "Email")]
  email: String,
  #[serde(rename = "Comments")]
  comments: String,
}

// ---- Last export dir (persisted in config) ----
#[tauri::command]
pub fn get_last_export_dir(app: AppHandle, kind: String) -> Result<Option<String>, String> {
  let cfg = read_easyapply_config(&app)?;
  Ok(match kind.as_str() {
    "job" => cfg.last_export_dir_job,
    "code" => cfg.last_export_dir_code,
    _ => None,
  })
}

fn set_last_export_dir(app: AppHandle, kind: &str, dir: String) -> Result<(), String> {
  let mut cfg = read_easyapply_config(&app)?;
  match kind {
    "job" => cfg.last_export_dir_job = Some(dir),
    "code" => cfg.last_export_dir_code = Some(dir),
    _ => {}
  }
  write_easyapply_config(&app, &cfg)
}

#[tauri::command]
pub fn open_last_export_dir(app: AppHandle, kind: String) -> Result<(), String> {
  let cfg = read_easyapply_config(&app)?;
  let dir = match kind.as_str() {
    "job" => cfg.last_export_dir_job,
    "code" => cfg.last_export_dir_code,
    _ => return Err("Invalid kind".to_string()),
  };
  let path = dir.ok_or("No export folder set yet")?;
  open_in_explorer(Path::new(&path))
}

// ---- Application Material (cover_letter, template, cv) ----
pub const APP_MATERIAL_COVER_LETTER: &str = "cover_letter";
pub const APP_MATERIAL_TEMPLATE: &str = "template";
pub const APP_MATERIAL_CV: &str = "cv";

#[tauri::command]
pub fn app_material_get_folder(app: AppHandle, kind: String) -> Result<Option<String>, String> {
  let cfg = read_easyapply_config(&app)?;
  Ok(match kind.as_str() {
    APP_MATERIAL_COVER_LETTER => cfg.app_material_cover_letter,
    APP_MATERIAL_TEMPLATE => cfg.app_material_template,
    APP_MATERIAL_CV => cfg.app_material_cv,
    _ => None,
  })
}

#[tauri::command]
pub fn app_material_set_folder(app: AppHandle, kind: String, path: String) -> Result<(), String> {
  let mut cfg = read_easyapply_config(&app)?;
  match kind.as_str() {
    APP_MATERIAL_COVER_LETTER => cfg.app_material_cover_letter = Some(path),
    APP_MATERIAL_TEMPLATE => cfg.app_material_template = Some(path),
    APP_MATERIAL_CV => cfg.app_material_cv = Some(path),
    _ => return Err("Invalid kind".to_string()),
  }
  write_easyapply_config(&app, &cfg)
}

#[tauri::command]
pub fn app_material_create_folder(app: AppHandle, kind: String, path: String) -> Result<String, String> {
  let p = PathBuf::from(&path);
  fs::create_dir_all(&p).map_err(|e| e.to_string())?;
  app_material_set_folder(app, kind, path)?;
  Ok(p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn app_material_open_folder(app: AppHandle, kind: String) -> Result<(), String> {
  let cfg = read_easyapply_config(&app)?;
  let dir = match kind.as_str() {
    APP_MATERIAL_COVER_LETTER => cfg.app_material_cover_letter,
    APP_MATERIAL_TEMPLATE => cfg.app_material_template,
    APP_MATERIAL_CV => cfg.app_material_cv,
    _ => return Err("Invalid kind".to_string()),
  };
  let path = dir.ok_or("Folder not set. Create or select folder first.")?;
  open_in_explorer(Path::new(&path))
}
