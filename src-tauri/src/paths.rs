use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

/// Shared filesystem layout for desktop (Tauri) and cloud (Axum) runtimes.
#[derive(Debug, Clone)]
pub struct AppPaths {
  pub data_dir: PathBuf,
  pub config_dir: PathBuf,
}

impl AppPaths {
  pub fn from_tauri(app: &AppHandle) -> Result<Self, String> {
    let data_dir = app
      .path()
      .app_data_dir()
      .map_err(|e: tauri::Error| e.to_string())?;
    let config_dir = app
      .path()
      .app_config_dir()
      .map_err(|e: tauri::Error| e.to_string())?;
    Self::ensure_dirs(&data_dir, &config_dir)?;
    Ok(Self { data_dir, config_dir })
  }

  pub fn from_env() -> Result<Self, String> {
    let base = std::env::var("EASYAPPLY_DATA_DIR")
      .map(PathBuf::from)
      .unwrap_or_else(|_| PathBuf::from("/home/site/wwwroot/data"));
    let data_dir = base.clone();
    let config_dir = std::env::var("EASYAPPLY_CONFIG_DIR")
      .map(PathBuf::from)
      .unwrap_or(base);
    Self::ensure_dirs(&data_dir, &config_dir)?;
    Ok(Self { data_dir, config_dir })
  }

  fn ensure_dirs(data_dir: &PathBuf, config_dir: &PathBuf) -> Result<(), String> {
    fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(config_dir).map_err(|e| e.to_string())?;
    Ok(())
  }

  pub fn auth_db(&self) -> PathBuf {
    self.data_dir.join("auth.db")
  }

  pub fn easyapply_db(&self) -> PathBuf {
    self.data_dir.join("easyapply.db")
  }

  pub fn easyapply_config(&self) -> PathBuf {
    self.config_dir.join("easyapply.json")
  }

  pub fn openai_profile(&self) -> PathBuf {
    self.config_dir.join("openai_profile.json")
  }

  pub fn openai_api_key_file(&self) -> PathBuf {
    self.config_dir.join("openai_api_key.secret")
  }
}
