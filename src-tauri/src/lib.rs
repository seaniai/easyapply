// easyapply: Job Applied, Code Management, Application Material.
// Auth (auth.db) and easyapply data (easyapply.db) live in app_data_dir; config in app_config_dir.

mod auth;
mod easyapply;

#[tauri::command]
async fn pick_export_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
  use tauri_plugin_dialog::{DialogExt, FilePath};
  use tokio::sync::oneshot;

  let (tx, rx) = oneshot::channel::<Option<FilePath>>();
  app.dialog().file().pick_folder(move |fp| {
    let _ = tx.send(fp);
  });

  let picked = rx.await.map_err(|_| "Dialog closed unexpectedly.".to_string())?;
  let Some(fp) = picked else { return Ok(None) };

  match fp {
    FilePath::Path(p) => Ok(Some(p.to_string_lossy().to_string())),
    FilePath::Url(u) => Err(format!("Unsupported folder path (URL): {}", u)),
  }
}

#[tauri::command]
async fn pick_file_csv(app: tauri::AppHandle) -> Result<Option<String>, String> {
  use tauri_plugin_dialog::{DialogExt, FilePath};
  use tokio::sync::oneshot;

  let (tx, rx) = oneshot::channel::<Option<FilePath>>();
  app.dialog().file().pick_file(move |fp| {
    let _ = tx.send(fp);
  });

  let picked = rx.await.map_err(|_| "Dialog closed unexpectedly.".to_string())?;
  let Some(fp) = picked else { return Ok(None) };

  match fp {
    FilePath::Path(p) => Ok(Some(p.to_string_lossy().to_string())),
    FilePath::Url(u) => Err(format!("Unsupported file path (URL): {}", u)),
  }
}

#[tauri::command]
fn auth_login(
  app: tauri::AppHandle,
  username: String,
  password: String,
  remember_me: bool,
) -> Result<auth::AuthSession, String> {
  auth::auth_login(&app, &username, &password, remember_me)
}

#[tauri::command]
fn auth_resume(app: tauri::AppHandle, token: String) -> Result<auth::AuthSession, String> {
  auth::auth_resume(&app, &token)
}

#[tauri::command]
fn auth_logout(app: tauri::AppHandle, token: String) -> Result<(), String> {
  auth::auth_logout(&app, &token)
}

#[tauri::command]
fn auth_whoami(app: tauri::AppHandle, token: String) -> Result<auth::AuthUserInfo, String> {
  auth::auth_whoami(&app, &token)
}

#[tauri::command]
fn auth_change_password(
  app: tauri::AppHandle,
  token: String,
  old_password: String,
  new_password: String,
) -> Result<(), String> {
  auth::auth_change_password(&app, &token, &old_password, &new_password)
}

pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .setup(|app| {
      auth::ensure_auth_db(app.handle()).expect("ensure_auth_db failed");
      easyapply::ensure_easyapply_db(app.handle()).expect("ensure_easyapply_db failed");
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      pick_export_folder,
      pick_file_csv,
      auth_login,
      auth_resume,
      auth_logout,
      auth_whoami,
      auth_change_password,
      auth::auth_export_users_csv,
      auth::auth_upsert_user_role,
      auth::auth_bulk_apply_csv,
      easyapply::applied_list,
      easyapply::applied_create,
      easyapply::applied_update,
      easyapply::applied_delete,
      easyapply::applied_export_csv,
      easyapply::applied_import_csv,
      easyapply::code_list,
      easyapply::code_create,
      easyapply::code_update,
      easyapply::code_delete,
      easyapply::code_export_csv,
      easyapply::code_import_csv,
      easyapply::get_last_export_dir,
      easyapply::open_last_export_dir,
      easyapply::app_material_get_folder,
      easyapply::app_material_set_folder,
      easyapply::app_material_create_folder,
      easyapply::app_material_open_folder,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
