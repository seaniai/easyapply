use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{AppHandle, Manager};

const OPENAI_MODEL: &str = "gpt-5.5";
const FALLBACK_OPENAI_MODEL: &str = "gpt-5.4";
const DEFAULT_REASONING_EFFORT: &str = "medium";
const DEFAULT_TEXT_VERBOSITY: &str = "low";
const FIXED_TIMEOUT_SECONDS: u64 = 90;
const COVER_LETTER_GENERATION_SYSTEM_PROMPT: &str =
    include_str!("prompts/cover_letter_generation.md");
const PROMPT_UPDATE_SYSTEM_PROMPT: &str = include_str!("prompts/prompt_update.md");

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OpenAiProfile {
    model: String,
    reasoning_effort: String,
    text_verbosity: String,
    timeout_seconds: u64,
}

impl Default for OpenAiProfile {
    fn default() -> Self {
        Self {
            model: OPENAI_MODEL.to_string(),
            reasoning_effort: DEFAULT_REASONING_EFFORT.to_string(),
            text_verbosity: DEFAULT_TEXT_VERBOSITY.to_string(),
            timeout_seconds: FIXED_TIMEOUT_SECONDS,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiProfileView {
    pub model: String,
    pub reasoning_effort: String,
    pub text_verbosity: String,
    pub timeout_seconds: u64,
    pub has_api_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HardRequirements {
    #[serde(default)]
    pub technical_skills: Vec<String>,
    #[serde(default)]
    pub behavioural_capabilities: Vec<String>,
    #[serde(default)]
    pub other_requirements: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionHistoryTurn {
    pub turn_index: u32,
    pub actor: String,
    pub message: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverLetterGenerateRequest {
    pub session_id: String,
    pub position_key: String,
    pub jd_raw_text: String,
    pub prompt_markdown: String,
    #[serde(default)]
    pub hard_requirements: HardRequirements,
    #[serde(default)]
    pub session_history: Vec<SessionHistoryTurn>,
    #[serde(default)]
    pub iteration_goal: String,
    #[serde(default)]
    pub user_confirmation_notes: String,
    #[serde(default)]
    pub allow_cover_letter: bool,
    #[serde(default)]
    pub workflow_state: u32,
    #[serde(default)]
    pub workflow_phase: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverLetterGenerateResponse {
    pub status: String,
    pub cover_letter: Option<String>,
    pub feedback_messages: Vec<String>,
    pub missing_requirements: Vec<String>,
    pub model: String,
    pub reasoning_effort: String,
    pub text_verbosity: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PromptPatchEntry {
    pub name: String,
    #[serde(default)]
    pub keywords: Vec<String>,
    pub case_context: String,
    pub case_problem_task: String,
    pub case_method_action: String,
    pub case_result: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PromptUpdateRequirements {
    #[serde(default)]
    pub skill_updates: Vec<PromptPatchEntry>,
    #[serde(default)]
    pub capability_updates: Vec<PromptPatchEntry>,
    #[serde(default)]
    pub other_updates: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptUpdateRequest {
    pub session_id: String,
    pub previous_prompt_version: String,
    pub previous_prompt_path: String,
    pub previous_prompt_markdown: String,
    pub update_requirements: PromptUpdateRequirements,
    #[serde(default)]
    pub session_history: Vec<SessionHistoryTurn>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptUpdateResponse {
    pub status: String,
    pub updated_prompt_markdown: Option<String>,
    pub updated_prompt_version: Option<String>,
    pub saved_prompt_path: Option<String>,
    pub feedback_messages: Vec<String>,
    pub model: String,
    pub reasoning_effort: String,
    pub text_verbosity: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiTestResult {
    pub ok: bool,
    pub intro: String,
    pub model: String,
    pub reasoning_effort: String,
    pub text_verbosity: String,
    pub timeout_seconds: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CoverLetterModelOutput {
    status: String,
    #[serde(default)]
    cover_letter: String,
    #[serde(default)]
    feedback_messages: Vec<String>,
    #[serde(default)]
    missing_requirements: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PromptUpdateModelOutput {
    status: String,
    #[serde(default)]
    updated_prompt_markdown: String,
    #[serde(default)]
    feedback_messages: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenAiTestModelOutput {
    intro: String,
}

pub fn ensure_ai_config(app: &AppHandle) -> Result<(), String> {
    let profile_path = openai_profile_path(app)?;
    if !profile_path.exists() {
        write_profile(app, &OpenAiProfile::default())?;
    }
    Ok(())
}

fn app_config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e: tauri::Error| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn openai_profile_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_config_dir(app)?.join("openai_profile.json"))
}

fn openai_api_key_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_config_dir(app)?.join("openai_api_key.secret"))
}

fn read_profile(app: &AppHandle) -> Result<OpenAiProfile, String> {
    let path = openai_profile_path(app)?;
    if !path.exists() {
        let profile = OpenAiProfile::default();
        write_profile(app, &profile)?;
        return Ok(profile);
    }
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut profile: OpenAiProfile = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    profile.model = OPENAI_MODEL.to_string();
    profile.reasoning_effort = normalize_reasoning_effort(&profile.reasoning_effort)?;
    profile.text_verbosity = normalize_text_verbosity(&profile.text_verbosity)?;
    profile.timeout_seconds = FIXED_TIMEOUT_SECONDS;
    Ok(profile)
}

fn write_profile(app: &AppHandle, profile: &OpenAiProfile) -> Result<(), String> {
    let mut normalized = profile.clone();
    normalized.model = OPENAI_MODEL.to_string();
    normalized.reasoning_effort = normalize_reasoning_effort(&normalized.reasoning_effort)?;
    normalized.text_verbosity = normalize_text_verbosity(&normalized.text_verbosity)?;
    normalized.timeout_seconds = FIXED_TIMEOUT_SECONDS;
    let path = openai_profile_path(app)?;
    let text = serde_json::to_string_pretty(&normalized).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| e.to_string())
}

fn normalize_reasoning_effort(raw: &str) -> Result<String, String> {
    let value = raw.trim().to_lowercase();
    match value.as_str() {
        "none" | "low" | "medium" | "high" | "xhigh" => Ok(value),
        _ => Err("reasoning_effort must be one of: none, low, medium, high, xhigh".to_string()),
    }
}

fn normalize_text_verbosity(raw: &str) -> Result<String, String> {
    let value = raw.trim().to_lowercase();
    match value.as_str() {
        "low" | "medium" | "high" => Ok(value),
        _ => Err("text_verbosity must be one of: low, medium, high".to_string()),
    }
}

fn profile_view(profile: OpenAiProfile, has_api_key: bool) -> OpenAiProfileView {
    OpenAiProfileView {
        model: profile.model,
        reasoning_effort: profile.reasoning_effort,
        text_verbosity: profile.text_verbosity,
        timeout_seconds: profile.timeout_seconds,
        has_api_key,
    }
}

fn read_api_key(app: &AppHandle) -> Result<String, String> {
    let path = openai_api_key_path(app)?;
    let key =
        fs::read_to_string(path).map_err(|_| "OpenAI API key is not configured".to_string())?;
    let trimmed = key.trim().to_string();
    if trimmed.is_empty() {
        return Err("OpenAI API key is empty".to_string());
    }
    Ok(trimmed)
}

fn validate_api_key(api_key: &str) -> Result<String, String> {
    let key = api_key.trim();
    if key.is_empty() {
        return Err("OpenAI API key is required".to_string());
    }
    if !key.starts_with("sk-") {
        return Err("OpenAI API key format is invalid (expected prefix: sk-)".to_string());
    }
    Ok(key.to_string())
}

fn write_api_key(app: &AppHandle, api_key: &str) -> Result<(), String> {
    let path = openai_api_key_path(app)?;
    fs::write(&path, api_key).map_err(|e| e.to_string())?;
    set_secret_permissions(&path)?;
    Ok(())
}

#[cfg(unix)]
fn set_secret_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())
}

#[cfg(not(unix))]
fn set_secret_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn parse_json_text(raw: &str) -> Result<Value, String> {
    if let Ok(v) = serde_json::from_str::<Value>(raw.trim()) {
        return Ok(v);
    }
    let mut trimmed = raw.trim().to_string();
    if trimmed.starts_with("```") {
        trimmed = trimmed
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .to_string();
    }
    if trimmed.ends_with("```") {
        trimmed = trimmed.trim_end_matches("```").to_string();
    }
    serde_json::from_str(trimmed.trim())
        .map_err(|_| "Model did not return valid JSON output".to_string())
}

fn extract_structured_output(resp: &Value) -> Result<Value, String> {
    if let Some(items) = resp.get("output").and_then(Value::as_array) {
        for item in items {
            if let Some(content) = item.get("content").and_then(Value::as_array) {
                for part in content {
                    if let Some(v) = part.get("json") {
                        return Ok(v.clone());
                    }
                    if let Some(text) = part.get("text").and_then(Value::as_str) {
                        if let Ok(v) = parse_json_text(text) {
                            return Ok(v);
                        }
                    }
                }
            }
        }
    }
    if let Some(text) = resp.get("output_text").and_then(Value::as_str) {
        return parse_json_text(text);
    }
    Err("Could not parse structured model output".to_string())
}

async fn post_openai_responses(
    api_key: &str,
    timeout_seconds: u64,
    body: &Value,
) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_seconds))
        .build()
        .map_err(|e| format!("OpenAI request failed: {}", e))?;

    let response = client
        .post("https://api.openai.com/v1/responses")
        .header("Content-Type", "application/json")
        .bearer_auth(api_key)
        .json(body)
        .send()
        .await
        .map_err(|e| format!("OpenAI request failed: {}", e))?;

    let status = response.status();
    let response_text = response
        .text()
        .await
        .map_err(|e| format!("OpenAI response read failed: {}", e))?;

    if !status.is_success() {
        return Err(format!(
            "OpenAI request failed (status {}): {}",
            status.as_u16(),
            response_text
        ));
    }

    serde_json::from_str::<Value>(&response_text).map_err(|e| e.to_string())
}

async fn call_openai_structured(
    app: &AppHandle,
    system_instruction: &str,
    user_payload: Value,
    schema_name: &str,
    schema: Value,
    max_output_tokens: Option<u32>,
    model_override: Option<&str>,
    reasoning_override: Option<&str>,
) -> Result<(Value, OpenAiProfile), String> {
    let profile = read_profile(app)?;
    let api_key = read_api_key(app)?;
    let request_model = model_override.unwrap_or(profile.model.as_str());
    let request_reasoning = reasoning_override.unwrap_or(profile.reasoning_effort.as_str());
    let mut body = json!({
      "model": request_model,
      "reasoning": { "effort": request_reasoning },
      "text": {
        "verbosity": profile.text_verbosity,
        "format": {
          "type": "json_schema",
          "name": schema_name,
          "strict": true,
          "schema": schema
        }
      },
      "input": [
        {
          "role": "system",
          "content": [{ "type": "input_text", "text": system_instruction }]
        },
        {
          "role": "user",
          "content": [{ "type": "input_text", "text": user_payload.to_string() }]
        }
      ]
    });

    if let Some(max_tokens) = max_output_tokens {
        body["max_output_tokens"] = json!(max_tokens);
    }

    let response_json = post_openai_responses(&api_key, FIXED_TIMEOUT_SECONDS, &body).await?;
    let structured = extract_structured_output(&response_json)?;
    Ok((structured, profile))
}

async fn call_openai_text(
    app: &AppHandle,
    system_instruction: &str,
    user_payload: Value,
    max_output_tokens: Option<u32>,
    model_override: Option<&str>,
    reasoning_override: Option<&str>,
) -> Result<(String, OpenAiProfile), String> {
    let profile = read_profile(app)?;
    let api_key = read_api_key(app)?;
    let request_model = model_override.unwrap_or(profile.model.as_str());
    let request_reasoning = reasoning_override.unwrap_or(profile.reasoning_effort.as_str());
    let mut body = json!({
      "model": request_model,
      "reasoning": { "effort": request_reasoning },
      "text": {
        "verbosity": profile.text_verbosity
      },
      "input": [
        {
          "role": "system",
          "content": [{ "type": "input_text", "text": system_instruction }]
        },
        {
          "role": "user",
          "content": [{ "type": "input_text", "text": user_payload.to_string() }]
        }
      ]
    });

    if let Some(max_tokens) = max_output_tokens {
        body["max_output_tokens"] = json!(max_tokens);
    }

    let response_json = post_openai_responses(&api_key, FIXED_TIMEOUT_SECONDS, &body).await?;
    if let Some(text) = response_json.get("output_text").and_then(Value::as_str) {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return Ok((trimmed.to_string(), profile));
        }
    }

    if let Some(items) = response_json.get("output").and_then(Value::as_array) {
        for item in items {
            if let Some(content) = item.get("content").and_then(Value::as_array) {
                for part in content {
                    if let Some(text) = part.get("text").and_then(Value::as_str) {
                        let trimmed = text.trim();
                        if !trimmed.is_empty() {
                            return Ok((trimmed.to_string(), profile));
                        }
                    }
                }
            }
        }
    }

    Err("OpenAI returned no text output".to_string())
}

fn cover_letter_response_schema() -> Value {
    json!({
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "status": { "type": "string", "enum": ["generated", "needs_prompt_update"] },
        "coverLetter": { "type": "string" },
        "feedbackMessages": { "type": "array", "items": { "type": "string" } },
        "missingRequirements": { "type": "array", "items": { "type": "string" } }
      },
      "required": ["status", "coverLetter", "feedbackMessages", "missingRequirements"]
    })
}

fn prompt_update_response_schema() -> Value {
    json!({
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "status": { "type": "string", "enum": ["updated", "rejected"] },
        "updatedPromptMarkdown": { "type": "string" },
        "feedbackMessages": { "type": "array", "items": { "type": "string" } }
      },
      "required": ["status", "updatedPromptMarkdown", "feedbackMessages"]
    })
}

fn version_filename_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"cover_letter_prompt_v\d+_\d+\.md").expect("valid regex"))
}

fn version_title_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\(V\d+\.\d+\)").expect("valid regex"))
}

fn parse_prompt_version(raw: &str) -> Result<(u32, u32), String> {
    let trimmed = raw.trim();
    let Some((major, minor)) = trimmed.strip_prefix('v').and_then(|v| v.split_once('_')) else {
        return Err("previousPromptVersion must match v<major>_<minor>".to_string());
    };
    let major_num = major
        .parse::<u32>()
        .map_err(|_| "Invalid prompt major version".to_string())?;
    let minor_num = minor
        .parse::<u32>()
        .map_err(|_| "Invalid prompt minor version".to_string())?;
    Ok((major_num, minor_num))
}

fn bump_minor_version(raw: &str) -> Result<String, String> {
    let (major, minor) = parse_prompt_version(raw)?;
    Ok(format!("v{}_{}", major, minor + 1))
}

fn rewrite_prompt_version_markers(markdown: &str, next_version: &str) -> Result<String, String> {
    let (major, minor) = parse_prompt_version(next_version)?;
    let next_file_name = format!("cover_letter_prompt_{}.md", next_version);
    let next_title = format!("(V{}.{})", major, minor);

    let replaced_filename = version_filename_regex().replace_all(markdown, next_file_name.as_str());
    let replaced_title = version_title_regex().replace_all(replaced_filename.as_ref(), next_title.as_str());
    Ok(replaced_title.into_owned())
}

fn openai_test_response_schema() -> Value {
    json!({
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "intro": { "type": "string" }
      },
      "required": ["intro"]
    })
}

fn ensure_non_empty(value: &str, field_name: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("{} is required", field_name));
    }
    Ok(())
}

fn validate_patch_entries(entries: &[PromptPatchEntry], section_name: &str) -> Result<(), String> {
    for (idx, entry) in entries.iter().enumerate() {
        let prefix = format!("{}[{}]", section_name, idx);
        ensure_non_empty(&entry.name, &format!("{}.name", prefix))?;
        if entry.keywords.iter().all(|k| k.trim().is_empty()) {
            return Err(format!(
                "{}.keywords must include at least one non-empty value",
                prefix
            ));
        }
        ensure_non_empty(&entry.case_context, &format!("{}.caseContext", prefix))?;
        ensure_non_empty(
            &entry.case_problem_task,
            &format!("{}.caseProblemTask", prefix),
        )?;
        ensure_non_empty(
            &entry.case_method_action,
            &format!("{}.caseMethodAction", prefix),
        )?;
        ensure_non_empty(&entry.case_result, &format!("{}.caseResult", prefix))?;
    }
    Ok(())
}

fn validate_prompt_update_requirements(
    requirements: &PromptUpdateRequirements,
) -> Result<(), String> {
    validate_patch_entries(&requirements.skill_updates, "skillUpdates")?;
    validate_patch_entries(&requirements.capability_updates, "capabilityUpdates")?;
    Ok(())
}

fn open_folder_path(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err("Folder does not exist".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let explorer_path = path.to_string_lossy().replace('/', "\\");
        Command::new("explorer")
            .arg(explorer_path)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Opening folder is not supported on this platform".to_string())
}
#[tauri::command]
pub fn ai_get_openai_profile(app: AppHandle) -> Result<OpenAiProfileView, String> {
    ensure_ai_config(&app)?;
    let profile = read_profile(&app)?;
    let has_api_key = read_api_key(&app).is_ok();
    Ok(profile_view(profile, has_api_key))
}

#[tauri::command]
pub fn ai_save_openai_api_key(
    app: AppHandle,
    api_key: String,
) -> Result<OpenAiProfileView, String> {
    ensure_ai_config(&app)?;
    let normalized = validate_api_key(&api_key)?;
    write_api_key(&app, &normalized)?;
    let profile = read_profile(&app)?;
    Ok(profile_view(profile, true))
}

#[tauri::command]
pub fn ai_update_openai_profile(
    app: AppHandle,
    reasoning_effort: Option<String>,
    text_verbosity: Option<String>,
) -> Result<OpenAiProfileView, String> {
    ensure_ai_config(&app)?;
    let mut profile = read_profile(&app)?;
    if let Some(v) = reasoning_effort {
        profile.reasoning_effort = normalize_reasoning_effort(&v)?;
    }
    if let Some(v) = text_verbosity {
        profile.text_verbosity = normalize_text_verbosity(&v)?;
    }
    profile.timeout_seconds = FIXED_TIMEOUT_SECONDS;
    write_profile(&app, &profile)?;
    let has_api_key = read_api_key(&app).is_ok();
    Ok(profile_view(profile, has_api_key))
}

#[tauri::command]
pub async fn ai_test_openai_api_key(app: AppHandle) -> Result<OpenAiTestResult, String> {
    ensure_ai_config(&app)?;
    let profile = read_profile(&app)?;
    let payload = json!({
      "task": "api_key_connectivity_test",
      "requirement": "Return one concise first-person self-introduction sentence with model name/version and active runtime parameters.",
      "expected_fields": ["model", "version", "reasoning_effort", "text_verbosity", "timeout_seconds"],
      "configured_profile": {
        "model": profile.model,
        "reasoning_effort": profile.reasoning_effort,
        "text_verbosity": profile.text_verbosity,
        "timeout_seconds": profile.timeout_seconds
      },
      "example": "I am GPT-5.5, running with reasoning=low, verbosity=medium, timeout=90s."
    });
    let mut errors: Vec<String> = Vec::new();

    for _attempt in 0..2 {
        // 1) primary model structured (force low reasoning for test stability)
        match call_openai_structured(
            &app,
            "You are a diagnostic assistant. Return JSON only in this exact shape: {\"intro\":\"...\"}. The intro must be one short first-person self-introduction sentence and MUST mention model name/version plus active runtime parameters (reasoning_effort, text_verbosity, timeout_seconds).",
            payload.clone(),
            "openai_api_key_test",
            openai_test_response_schema(),
            Some(80),
            None,
            Some("low"),
        )
        .await
        {
            Ok((structured, profile)) => {
                let parsed: OpenAiTestModelOutput =
                    serde_json::from_value(structured).map_err(|e| e.to_string())?;
                return Ok(OpenAiTestResult {
                    ok: true,
                    intro: parsed.intro,
                    model: profile.model,
                    reasoning_effort: "low".to_string(),
                    text_verbosity: profile.text_verbosity,
                    timeout_seconds: profile.timeout_seconds,
                });
            }
            Err(e) => errors.push(e),
        }

        // 2) fallback model structured
        match call_openai_structured(
            &app,
            "You are a diagnostic assistant. Return JSON only in this exact shape: {\"intro\":\"...\"}. The intro must be one short first-person self-introduction sentence and MUST mention model name/version plus active runtime parameters (reasoning_effort, text_verbosity, timeout_seconds).",
            payload.clone(),
            "openai_api_key_test",
            openai_test_response_schema(),
            Some(80),
            Some(FALLBACK_OPENAI_MODEL),
            Some("low"),
        )
        .await
        {
            Ok((structured, profile)) => {
                let parsed: OpenAiTestModelOutput =
                    serde_json::from_value(structured).map_err(|e| e.to_string())?;
                return Ok(OpenAiTestResult {
                    ok: true,
                    intro: parsed.intro,
                    model: profile.model,
                    reasoning_effort: "low".to_string(),
                    text_verbosity: profile.text_verbosity,
                    timeout_seconds: profile.timeout_seconds,
                });
            }
            Err(e) => errors.push(e),
        }

        // 3) primary model plain text
        match call_openai_text(
            &app,
            "You are a diagnostic assistant. Return one short first-person self-introduction sentence and include model name/version plus active runtime parameters (reasoning_effort, text_verbosity, timeout_seconds).",
            payload.clone(),
            Some(80),
            None,
            Some("low"),
        )
        .await
        {
            Ok((intro_text, profile)) => {
                return Ok(OpenAiTestResult {
                    ok: true,
                    intro: intro_text,
                    model: profile.model,
                    reasoning_effort: "low".to_string(),
                    text_verbosity: profile.text_verbosity,
                    timeout_seconds: profile.timeout_seconds,
                });
            }
            Err(e) => errors.push(e),
        }

        // 4) fallback model plain text
        match call_openai_text(
            &app,
            "You are a diagnostic assistant. Return one short first-person self-introduction sentence and include model name/version plus active runtime parameters (reasoning_effort, text_verbosity, timeout_seconds).",
            payload.clone(),
            Some(80),
            Some(FALLBACK_OPENAI_MODEL),
            Some("low"),
        )
        .await
        {
            Ok((intro_text, profile)) => {
                return Ok(OpenAiTestResult {
                    ok: true,
                    intro: intro_text,
                    model: profile.model,
                    reasoning_effort: "low".to_string(),
                    text_verbosity: profile.text_verbosity,
                    timeout_seconds: profile.timeout_seconds,
                });
            }
            Err(e) => errors.push(e),
        }
    }

    Err(
        errors
            .last()
            .cloned()
            .unwrap_or_else(|| "API test failed with unknown error".to_string()),
    )
}

#[tauri::command]
pub async fn ai_generate_cover_letter(
    app: AppHandle,
    request: CoverLetterGenerateRequest,
) -> Result<CoverLetterGenerateResponse, String> {
    ensure_ai_config(&app)?;
    ensure_non_empty(&request.session_id, "sessionId")?;
    ensure_non_empty(&request.position_key, "positionKey")?;
    ensure_non_empty(&request.jd_raw_text, "jdRawText")?;
    ensure_non_empty(&request.prompt_markdown, "promptMarkdown")?;

    ensure_non_empty(&request.iteration_goal, "iterationGoal")?;
    let payload = json!({
        "task": "generate_cover_letter",
        "session": {
            "sessionId": request.session_id,
            "positionKey": request.position_key,
            "history": request.session_history
        },
        "inputs": {
            "jdRawText": request.jd_raw_text,
            "hardRequirements": request.hard_requirements,
            "promptMarkdown": request.prompt_markdown,
            "iterationGoal": request.iteration_goal
        },
        "workflow": {
            "allowCoverLetter": request.allow_cover_letter,
            "userConfirmationNotes": request.user_confirmation_notes,
            "state": request.workflow_state,
            "phase": request.workflow_phase
        }
    });

    let (structured, profile) = call_openai_structured(
        &app,
        COVER_LETTER_GENERATION_SYSTEM_PROMPT,
        payload,
        "cover_letter_generation",
        cover_letter_response_schema(),
        None,
        None,
        None,
    )
    .await?;

    let parsed: CoverLetterModelOutput =
        serde_json::from_value(structured).map_err(|e| e.to_string())?;
    let should_return_letter =
        parsed.status == "generated" && !parsed.cover_letter.trim().is_empty();

    Ok(CoverLetterGenerateResponse {
        status: parsed.status,
        cover_letter: if should_return_letter {
            Some(parsed.cover_letter)
        } else {
            None
        },
        feedback_messages: parsed.feedback_messages,
        missing_requirements: parsed.missing_requirements,
        model: profile.model,
        reasoning_effort: profile.reasoning_effort,
        text_verbosity: profile.text_verbosity,
    })
}

#[tauri::command]
pub fn ai_read_text_file(path: String) -> Result<String, String> {
    ensure_non_empty(&path, "path")?;
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ai_write_text_file(path: String, content: String) -> Result<(), String> {
    ensure_non_empty(&path, "path")?;
    let path_buf = PathBuf::from(path);
    if let Some(parent) = path_buf.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path_buf, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ai_open_folder(path: String) -> Result<(), String> {
    ensure_non_empty(&path, "path")?;
    open_folder_path(Path::new(&path))
}

#[tauri::command]
pub async fn ai_update_cover_letter_prompt(
    app: AppHandle,
    request: PromptUpdateRequest,
) -> Result<PromptUpdateResponse, String> {
    ensure_ai_config(&app)?;
    ensure_non_empty(&request.session_id, "sessionId")?;
    ensure_non_empty(&request.previous_prompt_version, "previousPromptVersion")?;
    ensure_non_empty(&request.previous_prompt_path, "previousPromptPath")?;
    ensure_non_empty(&request.previous_prompt_markdown, "previousPromptMarkdown")?;
    validate_prompt_update_requirements(&request.update_requirements)?;

    let payload = json!({
        "task": "update_prompt",
        "session": {
            "sessionId": request.session_id,
            "history": request.session_history
        },
        "promptUpdate": {
            "previousPromptVersion": request.previous_prompt_version,
            "previousPromptMarkdown": request.previous_prompt_markdown,
            "updateRequirements": request.update_requirements
        }
    });

    let (structured, profile) = call_openai_structured(
        &app,
        PROMPT_UPDATE_SYSTEM_PROMPT,
        payload,
        "cover_letter_prompt_update",
        prompt_update_response_schema(),
        None,
        None,
        None,
    )
    .await?;

    let parsed: PromptUpdateModelOutput =
        serde_json::from_value(structured).map_err(|e| e.to_string())?;
    let has_prompt =
        parsed.status == "updated" && !parsed.updated_prompt_markdown.trim().is_empty();

    let mut updated_prompt_markdown = None;
    let mut updated_prompt_version = None;
    let mut saved_prompt_path = None;

    if has_prompt {
        let next_version = bump_minor_version(&request.previous_prompt_version)?;
        let rewritten_markdown =
            rewrite_prompt_version_markers(&parsed.updated_prompt_markdown, &next_version)?;

        let previous_path = PathBuf::from(&request.previous_prompt_path);
        let parent = previous_path.parent().ok_or_else(|| {
            "previousPromptPath must include a valid parent directory".to_string()
        })?;
        let file_name = format!("cover_letter_prompt_{}.md", next_version);
        let next_path = parent.join(file_name);
        if let Some(folder) = next_path.parent() {
            fs::create_dir_all(folder).map_err(|e| e.to_string())?;
        }
        fs::write(&next_path, &rewritten_markdown).map_err(|e| e.to_string())?;

        updated_prompt_markdown = Some(rewritten_markdown);
        updated_prompt_version = Some(next_version);
        saved_prompt_path = Some(next_path.to_string_lossy().to_string());
    }

    Ok(PromptUpdateResponse {
        status: parsed.status,
        updated_prompt_markdown,
        updated_prompt_version,
        saved_prompt_path,
        feedback_messages: parsed.feedback_messages,
        model: profile.model,
        reasoning_effort: profile.reasoning_effort,
        text_verbosity: profile.text_verbosity,
    })
}
