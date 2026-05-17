use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
  extract::{Path, Query, State},
  http::{header, HeaderMap, StatusCode},
  response::{IntoResponse, Response},
  routing::{get, post, put},
  Json, Router,
};
use serde::{Deserialize, Serialize};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;

use crate::ai::{self, OpenAiTestResult};
use crate::auth::{self, AuthSession, AuthUserInfo};
use crate::easyapply::{self, AppliedRow, CodeRow, ImportResult};
use crate::paths::AppPaths;

/// Default HTTP port (`WEBSITES_PORT` / `PORT` on Azure and local Docker).
pub const DEFAULT_SERVER_PORT: u16 = 8787;

fn resolve_listen_port() -> u16 {
  for key in ["PORT", "WEBSITES_PORT"] {
    if let Ok(v) = std::env::var(key) {
      if let Ok(p) = v.parse::<u16>() {
        if p > 0 {
          return p;
        }
      }
    }
  }
  DEFAULT_SERVER_PORT
}

#[derive(Clone)]
pub struct AppState {
  pub paths: AppPaths,
}

#[derive(Debug, Serialize)]
struct ErrorBody {
  error: String,
}

fn api_error(status: StatusCode, msg: impl Into<String>) -> Response {
  (status, Json(ErrorBody { error: msg.into() })).into_response()
}

fn token_from_headers(headers: &HeaderMap) -> Option<String> {
  if let Some(v) = headers.get(header::AUTHORIZATION) {
    let s = v.to_str().ok()?;
    let t = s.strip_prefix("Bearer ")?.trim();
    if !t.is_empty() {
      return Some(t.to_string());
    }
  }
  if let Some(v) = headers.get(header::COOKIE) {
    let s = v.to_str().ok()?;
    for part in s.split(';') {
      let part = part.trim();
      if let Some(t) = part.strip_prefix("easyapply_session=") {
        let t = t.trim();
        if !t.is_empty() {
          return Some(t.to_string());
        }
      }
    }
  }
  None
}

fn require_user(state: &AppState, headers: &HeaderMap) -> Result<AuthUserInfo, Response> {
  let token = token_from_headers(headers).ok_or_else(|| {
    api_error(StatusCode::UNAUTHORIZED, "Missing session token")
  })?;
  auth::auth_resume_paths(&state.paths, &token)
    .map(|s| s.user)
    .map_err(|e| api_error(StatusCode::UNAUTHORIZED, e))
}

fn require_auth_admin(user: &AuthUserInfo) -> Result<(), Response> {
  if auth::user_can_manage_auth(user) {
    Ok(())
  } else {
    Err(api_error(StatusCode::FORBIDDEN, "Admin access required"))
  }
}

pub async fn run() -> Result<(), String> {
  tracing_subscriber::fmt::init();

  let paths = AppPaths::from_env()?;
  auth::ensure_auth_db_paths(&paths)?;
  easyapply::ensure_easyapply_db_paths(&paths)?;

  let state = Arc::new(AppState { paths });

  let api = Router::new()
    .route("/health", get(health))
    .route("/api/auth/login", post(auth_login))
    .route("/api/auth/resume", post(auth_resume))
    .route("/api/auth/logout", post(auth_logout))
    .route("/api/auth/whoami", get(auth_whoami))
    .route("/api/auth/users/export.csv", get(auth_users_export))
    .route("/api/auth/users/upsert", post(auth_users_upsert))
    .route("/api/auth/users/bulk", post(auth_users_bulk))
    .route("/api/applied", get(applied_list).post(applied_create))
    .route(
      "/api/applied/{id}",
      put(applied_update).delete(applied_delete),
    )
    .route("/api/applied/export.csv", get(applied_export))
    .route("/api/applied/import", post(applied_import))
    .route("/api/code", get(code_list).post(code_create))
    .route("/api/code/{id}", put(code_update).delete(code_delete))
    .route("/api/code/export.csv", get(code_export))
    .route("/api/code/import", post(code_import))
    .route("/api/ai/openai-profile", get(ai_get_openai_profile))
    .route("/api/ai/openai-key", post(ai_save_openai_key))
    .route("/api/ai/openai-key/test", post(ai_test_openai_key))
    .with_state(state.clone());

  let static_root =
    std::env::var("EASYAPPLY_STATIC_DIR").unwrap_or_else(|_| "dist".to_string());
  let index = format!("{static_root}/index.html");
  let spa = ServeDir::new(&static_root)
    .not_found_service(ServeFile::new(index));

  let app = Router::new()
    .merge(api)
    .fallback_service(spa)
    .layer(TraceLayer::new_for_http());

  let port = resolve_listen_port();
  let addr = SocketAddr::from(([0, 0, 0, 0], port));
  tracing::info!("easyapply-server listening on http://{addr}");
  let listener = tokio::net::TcpListener::bind(addr)
    .await
    .map_err(|e| e.to_string())?;
  axum::serve(listener, app)
    .await
    .map_err(|e| e.to_string())?;
  Ok(())
}

async fn health() -> &'static str {
  "ok"
}

#[derive(Deserialize)]
struct LoginBody {
  username: String,
  password: String,
  #[serde(rename = "rememberMe", default)]
  remember_me: bool,
}

#[derive(Deserialize)]
struct TokenBody {
  token: String,
}

async fn auth_login(
  State(state): State<Arc<AppState>>,
  Json(body): Json<LoginBody>,
) -> Result<Json<AuthSession>, Response> {
  auth::auth_login_paths(
    &state.paths,
    &body.username,
    &body.password,
    body.remember_me,
  )
  .map(Json)
  .map_err(|e| api_error(StatusCode::UNAUTHORIZED, e))
}

async fn auth_resume(
  State(state): State<Arc<AppState>>,
  Json(body): Json<TokenBody>,
) -> Result<Json<AuthSession>, Response> {
  auth::auth_resume_paths(&state.paths, &body.token)
    .map(Json)
    .map_err(|e| api_error(StatusCode::UNAUTHORIZED, e))
}

async fn auth_logout(
  State(state): State<Arc<AppState>>,
  headers: HeaderMap,
  Json(body): Json<TokenBody>,
) -> Result<StatusCode, Response> {
  let token = token_from_headers(&headers).unwrap_or(body.token);
  auth::auth_logout_paths(&state.paths, &token)
    .map(|_| StatusCode::NO_CONTENT)
    .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))
}

async fn auth_whoami(
  State(state): State<Arc<AppState>>,
  headers: HeaderMap,
) -> Result<Json<AuthUserInfo>, Response> {
  require_user(&state, &headers).map(Json)
}

async fn auth_users_export(
  State(state): State<Arc<AppState>>,
  headers: HeaderMap,
) -> Result<Response, Response> {
  let user = require_user(&state, &headers)?;
  require_auth_admin(&user)?;
  let csv = auth::auth_export_users_csv_text_paths(&state.paths)
    .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))?;
  Ok((
    StatusCode::OK,
    [
      (header::CONTENT_TYPE, "text/csv; charset=utf-8"),
      (
        header::CONTENT_DISPOSITION,
        "attachment; filename=\"auth_users.csv\"",
      ),
    ],
    csv,
  )
    .into_response())
}

#[derive(Deserialize)]
struct UpsertUserBody {
  username: String,
  role: String,
}

async fn auth_users_upsert(
  State(state): State<Arc<AppState>>,
  headers: HeaderMap,
  Json(body): Json<UpsertUserBody>,
) -> Result<StatusCode, Response> {
  let user = require_user(&state, &headers)?;
  require_auth_admin(&user)?;
  auth::auth_upsert_user_role_paths(&state.paths, &body.username, &body.role)
    .map(|_| StatusCode::NO_CONTENT)
    .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))
}

#[derive(Deserialize)]
struct BulkQuery {
  #[serde(rename = "dryRun", default)]
  dry_run: bool,
}

async fn auth_users_bulk(
  State(state): State<Arc<AppState>>,
  headers: HeaderMap,
  Query(query): Query<BulkQuery>,
  body: String,
) -> Result<Json<serde_json::Value>, Response> {
  let user = require_user(&state, &headers)?;
  require_auth_admin(&user)?;
  auth::auth_bulk_apply_csv_paths(&state.paths, &body, query.dry_run)
    .map(Json)
    .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))
}

async fn applied_list(
  State(state): State<Arc<AppState>>,
  headers: HeaderMap,
) -> Result<Json<Vec<AppliedRow>>, Response> {
  let user = require_user(&state, &headers)?;
  easyapply::applied_list_paths(&state.paths, user.user_id)
    .map(Json)
    .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e))
}

#[derive(Deserialize)]
struct AppliedBody {
  company: String,
  role: String,
  via: String,
  date: String,
  status: String,
  comments: String,
}

async fn applied_create(
  State(state): State<Arc<AppState>>,
  headers: HeaderMap,
  Json(body): Json<AppliedBody>,
) -> Result<Json<serde_json::Value>, Response> {
  let user = require_user(&state, &headers)?;
  let id = easyapply::applied_create_paths(
    &state.paths,
    user.user_id,
    body.company,
    body.role,
    body.via,
    body.date,
    body.status,
    body.comments,
  )
  .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))?;
  Ok(Json(serde_json::json!({ "id": id })))
}

async fn applied_update(
  State(state): State<Arc<AppState>>,
  headers: HeaderMap,
  Path(id): Path<i64>,
  Json(body): Json<AppliedBody>,
) -> Result<StatusCode, Response> {
  let user = require_user(&state, &headers)?;
  easyapply::applied_update_paths(
    &state.paths,
    user.user_id,
    id,
    body.company,
    body.role,
    body.via,
    body.date,
    body.status,
    body.comments,
  )
  .map(|_| StatusCode::NO_CONTENT)
  .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))
}

async fn applied_delete(
  State(state): State<Arc<AppState>>,
  headers: HeaderMap,
  Path(id): Path<i64>,
) -> Result<StatusCode, Response> {
  let user = require_user(&state, &headers)?;
  easyapply::applied_delete_paths(&state.paths, user.user_id, id)
    .map(|_| StatusCode::NO_CONTENT)
    .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))
}

async fn applied_export(
  State(state): State<Arc<AppState>>,
  headers: HeaderMap,
) -> Result<Response, Response> {
  let user = require_user(&state, &headers)?;
  let bytes = easyapply::applied_export_csv_bytes(&state.paths, user.user_id)
    .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e))?;
  Ok((
    [
      (header::CONTENT_TYPE, "text/csv; charset=utf-8"),
      (
        header::CONTENT_DISPOSITION,
        "attachment; filename=\"applied.csv\"",
      ),
    ],
    bytes,
  )
    .into_response())
}

async fn applied_import(
  State(state): State<Arc<AppState>>,
  headers: HeaderMap,
  body: axum::body::Bytes,
) -> Result<Json<ImportResult>, Response> {
  let user = require_user(&state, &headers)?;
  easyapply::applied_import_csv_bytes(&state.paths, user.user_id, &body)
    .map(Json)
    .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))
}

async fn code_list(
  State(state): State<Arc<AppState>>,
  headers: HeaderMap,
) -> Result<Json<Vec<CodeRow>>, Response> {
  let user = require_user(&state, &headers)?;
  easyapply::code_list_paths(&state.paths, user.user_id)
    .map(Json)
    .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e))
}

#[derive(Deserialize)]
struct CodeBody {
  account: String,
  username: String,
  password: String,
  tel: String,
  email: String,
  comments: String,
}

async fn code_create(
  State(state): State<Arc<AppState>>,
  headers: HeaderMap,
  Json(body): Json<CodeBody>,
) -> Result<Json<serde_json::Value>, Response> {
  let user = require_user(&state, &headers)?;
  let id = easyapply::code_create_paths(
    &state.paths,
    user.user_id,
    body.account,
    body.username,
    body.password,
    body.tel,
    body.email,
    body.comments,
  )
  .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))?;
  Ok(Json(serde_json::json!({ "id": id })))
}

async fn code_update(
  State(state): State<Arc<AppState>>,
  headers: HeaderMap,
  Path(id): Path<i64>,
  Json(body): Json<CodeBody>,
) -> Result<StatusCode, Response> {
  let user = require_user(&state, &headers)?;
  easyapply::code_update_paths(
    &state.paths,
    user.user_id,
    id,
    body.account,
    body.username,
    body.password,
    body.tel,
    body.email,
    body.comments,
  )
  .map(|_| StatusCode::NO_CONTENT)
  .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))
}

async fn code_delete(
  State(state): State<Arc<AppState>>,
  headers: HeaderMap,
  Path(id): Path<i64>,
) -> Result<StatusCode, Response> {
  let user = require_user(&state, &headers)?;
  easyapply::code_delete_paths(&state.paths, user.user_id, id)
    .map(|_| StatusCode::NO_CONTENT)
    .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))
}

async fn code_export(
  State(state): State<Arc<AppState>>,
  headers: HeaderMap,
) -> Result<Response, Response> {
  let user = require_user(&state, &headers)?;
  let bytes = easyapply::code_export_csv_bytes(&state.paths, user.user_id)
    .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e))?;
  Ok((
    [
      (header::CONTENT_TYPE, "text/csv; charset=utf-8"),
      (
        header::CONTENT_DISPOSITION,
        "attachment; filename=\"code.csv\"",
      ),
    ],
    bytes,
  )
    .into_response())
}

async fn code_import(
  State(state): State<Arc<AppState>>,
  headers: HeaderMap,
  body: axum::body::Bytes,
) -> Result<Json<ImportResult>, Response> {
  let user = require_user(&state, &headers)?;
  easyapply::code_import_csv_bytes(&state.paths, user.user_id, &body)
    .map(Json)
    .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))
}

#[derive(Deserialize)]
struct OpenAiKeyBody {
  #[serde(rename = "apiKey")]
  api_key: String,
}

async fn ai_get_openai_profile(
  State(state): State<Arc<AppState>>,
  headers: HeaderMap,
) -> Result<Json<serde_json::Value>, Response> {
  let user = require_user(&state, &headers)?;
  let has = auth::user_has_openai_api_key(&state.paths, user.user_id);
  Ok(Json(serde_json::json!({
    "model": "gpt-5.5",
    "reasoningEffort": "medium",
    "textVerbosity": "low",
    "timeoutSeconds": 90,
    "hasApiKey": has,
  })))
}

async fn ai_save_openai_key(
  State(state): State<Arc<AppState>>,
  headers: HeaderMap,
  Json(body): Json<OpenAiKeyBody>,
) -> Result<StatusCode, Response> {
  let user = require_user(&state, &headers)?;
  auth::save_user_openai_api_key(&state.paths, user.user_id, &body.api_key)
    .map(|_| StatusCode::NO_CONTENT)
    .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))
}

async fn ai_test_openai_key(
  State(state): State<Arc<AppState>>,
  headers: HeaderMap,
) -> Result<Json<OpenAiTestResult>, Response> {
  let _user = require_user(&state, &headers)?;
  let token = token_from_headers(&headers).ok_or_else(|| {
    api_error(StatusCode::UNAUTHORIZED, "Missing session token")
  })?;
  ai::ai_test_openai_api_key_paths(&state.paths, &token)
    .await
    .map(Json)
    .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))
}
