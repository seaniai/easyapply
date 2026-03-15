// src-tauri/src/auth/csv.rs
//
// CSV read/write + validation + report structs.
// Keep mod.rs focused on command routing + DB transactions.

use serde::Serialize;
use std::{collections::{HashMap, HashSet}, fs, path::Path};

#[derive(Debug, Clone, Serialize)]
pub struct UserRow {
  pub role: String,
  pub id: i64,
  pub username: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ValidationReport {
  pub ok: bool,
  pub rows: usize,
  pub errors: Vec<String>,
  pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApplyResult {
  pub applied: bool,
  pub rows: usize,
  pub inserted: u64,
  pub updated: u64,
  pub deleted: u64,
  pub skipped: u64,
  pub warnings: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct BulkPlan {
  pub rows: Vec<UserRow>,
  pub to_insert: Vec<UserRow>, // new id
  pub to_update: Vec<UserRow>, // existing id (role change)
  pub to_delete: Vec<UserRow>, // delete existing id
}

fn norm(s: &str) -> String {
  s.trim().to_lowercase()
}

// Minimal CSV parser: comma-separated, no quoted commas.
// Header must be exactly: role,id,username (case-insensitive).
pub fn read_users_csv(abs_path: &str) -> Result<Vec<UserRow>, String> {
  let p = Path::new(abs_path);
  if !p.exists() {
    return Err(format!("CSV file not found: {}", abs_path));
  }

  let text = fs::read_to_string(p).map_err(|e| format!("Read CSV failed: {e}"))?;
  parse_users_csv_text(&text)
}

pub fn write_users_csv(abs_path: &str, rows: &[UserRow]) -> Result<(), String> {
  let mut out = String::from("role,id,username\n");
  for r in rows {
    // NOTE: minimal CSV; usernames/roles must not contain commas.
    out.push_str(&format!("{},{},{}\n", r.role, r.id, r.username));
  }
  fs::write(abs_path, out).map_err(|e| format!("Write CSV failed: {e}"))?;
  Ok(())
}

pub fn parse_users_csv_text(text: &str) -> Result<Vec<UserRow>, String> {
  let mut lines: Vec<&str> = text
    .split(|c| c == '\n' || c == '\r')
    .map(|l| l.trim())
    .filter(|l| !l.is_empty())
    .collect();

  if lines.is_empty() {
    return Err("CSV is empty.".to_string());
  }

  let header = lines.remove(0);
  let h: Vec<String> = header.split(',').map(|x| x.trim().to_string()).collect();
  let header_ok = h.len() == 3
    && norm(&h[0]) == "role"
    && norm(&h[1]) == "id"
    && norm(&h[2]) == "username";

  if !header_ok {
    return Err(r#"CSV header must be exactly: "role,id,username" (3 columns)."#.to_string());
  }

  let mut out: Vec<UserRow> = Vec::new();
  for (idx0, line) in lines.iter().enumerate() {
    let line_no = (idx0 + 2) as i64;
    let cols: Vec<String> = line.split(',').map(|x| x.trim().to_string()).collect();
    if cols.len() != 3 {
      return Err(format!("Line {line_no}: must have 3 columns (role,id,username)."));
    }
    let role = cols[0].trim().to_string();
    let id_raw = cols[1].trim();
    let username = cols[2].trim().to_string();

    if role.is_empty() || id_raw.is_empty() || username.is_empty() {
      return Err(format!("Line {line_no}: role/id/username cannot be empty."));
    }

    let id = parse_i64(id_raw).map_err(|_| format!("Line {line_no}: id must be an integer."))?;
    out.push(UserRow { role, id, username });
  }

  Ok(out)
}

fn parse_i64(s: &str) -> Result<i64, ()> {
  let t = s.trim();
  if t.is_empty() { return Err(()); }
  if !t.chars().all(|c| c.is_ascii_digit() || c == '-' || c == '+') {
    return Err(());
  }
  t.parse::<i64>().map_err(|_| ())
}

// Validate rows per the bulk-apply contract.
// - role: case-insensitive; allowed: db roles + "delete"
// - id: integer; unique inside CSV
// - username: unique inside CSV (case-insensitive)
// - Each row: role/id/username non-empty
// - If id exists in DB: username must exactly match DB username
// - If role == delete: id must exist
// - Also guard: username exists in DB but with different id => error (to avoid collisions)
pub fn validate_and_plan(
  rows: Vec<UserRow>,
  allowed_roles: &[String],                // DB roles (e.g. ["Admin","User"])
  db_id_to_username: &HashMap<i64, String>,
  db_username_to_id: &HashMap<String, i64>, // lower(username) -> id
) -> ValidationReportAndPlan {
  let mut errors: Vec<String> = vec![];
  let mut warnings: Vec<String> = vec![];

  let allowed_norm: HashSet<String> = allowed_roles.iter().map(|r| norm(r)).collect();

  let mut seen_ids: HashSet<i64> = HashSet::new();
  let mut seen_unames: HashSet<String> = HashSet::new();

  for (i, r) in rows.iter().enumerate() {
    let line_no = i + 2;

    if r.role.trim().is_empty() || r.username.trim().is_empty() {
      errors.push(format!("Line {line_no}: role/username cannot be empty."));
      continue;
    }

    if !seen_ids.insert(r.id) {
      errors.push(format!("Line {line_no}: duplicate id \"{}\".", r.id));
    }

    let uk = norm(&r.username);
    if !seen_unames.insert(uk.clone()) {
      errors.push(format!("Line {line_no}: duplicate username \"{}\".", r.username));
    }

    let rn = norm(&r.role);
    if rn != "delete" && !allowed_norm.contains(&rn) {
      errors.push(format!(
        "Line {line_no}: role \"{}\" is not allowed. Allowed: {} (or \"delete\").",
        r.role,
        allowed_roles.join(", ")
      ));
    }

    // DB collision checks
    if let Some(existing_id) = db_id_to_username.get(&r.id) {
      // id exists -> username must match DB
      if &r.username != existing_id {
        errors.push(format!(
          "Line {line_no}: id {} exists, username must match DB (expected \"{}\", got \"{}\").",
          r.id, existing_id, r.username
        ));
      }
    }

    // username exists in DB but different id => error
    if let Some(db_id) = db_username_to_id.get(&norm(&r.username)) {
      if *db_id != r.id {
        errors.push(format!(
          "Line {line_no}: username \"{}\" already exists in DB with id {}, but CSV provides id {}.",
          r.username, db_id, r.id
        ));
      }
    }

    // delete requires existing id
    if rn == "delete" && !db_id_to_username.contains_key(&r.id) {
      errors.push(format!("Line {line_no}: delete requested but id {} does not exist in DB.", r.id));
    }
  }

  if rows.is_empty() {
    errors.push("CSV has no data rows.".to_string());
  }

  let ok = errors.is_empty();

  let plan = if ok {
    let mut to_insert = vec![];
    let mut to_update = vec![];
    let mut to_delete = vec![];

    for r in rows.iter().cloned() {
      let rn = norm(&r.role);
      if rn == "delete" {
        to_delete.push(r);
      } else if db_id_to_username.contains_key(&r.id) {
        to_update.push(r);
      } else {
        to_insert.push(r);
      }
    }

    // Optional: warn if a large delete batch etc.
    if to_delete.len() > 0 {
      warnings.push(format!("Bulk contains {} delete rows.", to_delete.len()));
    }

    Some(BulkPlan { rows: rows.clone(), to_insert, to_update, to_delete })
  } else {
    None
  };

  ValidationReportAndPlan {
    report: ValidationReport { ok, rows: rows.len(), errors, warnings },
    plan,
  }
}

pub struct ValidationReportAndPlan {
  pub report: ValidationReport,
  pub plan: Option<BulkPlan>,
}