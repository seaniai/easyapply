use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager};

const OPENAI_MODEL: &str = "gpt-5.5";
const DEFAULT_REASONING_EFFORT: &str = "medium";
const DEFAULT_TEXT_VERBOSITY: &str = "low";
const FIXED_TIMEOUT_SECONDS: u64 = 45;

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

async fn call_openai_structured(
    app: &AppHandle,
    system_instruction: &str,
    user_payload: Value,
    schema_name: &str,
    schema: Value,
    max_output_tokens: Option<u32>,
) -> Result<(Value, OpenAiProfile), String> {
    let profile = read_profile(app)?;
    let api_key = read_api_key(app)?;
    let mut body = json!({
      "model": profile.model,
      "reasoning": { "effort": profile.reasoning_effort },
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

    let body_text = body.to_string();
    let timeout_secs = FIXED_TIMEOUT_SECONDS.to_string();
    let response = Command::new("curl")
        .arg("-sS")
        .arg("-m")
        .arg(&timeout_secs)
        .arg("-X")
        .arg("POST")
        .arg("https://api.openai.com/v1/responses")
        .arg("-H")
        .arg("Content-Type: application/json")
        .arg("-H")
        .arg(format!("Authorization: Bearer {}", api_key))
        .arg("-d")
        .arg(body_text)
        .output()
        .map_err(|e| format!("OpenAI request failed: {}", e))?;

    if !response.status.success() {
        let stderr = String::from_utf8_lossy(&response.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&response.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(format!(
            "OpenAI request failed (curl exit code {:?}): {}",
            response.status.code(),
            detail
        ));
    }

    let response_text = String::from_utf8(response.stdout).map_err(|e| e.to_string())?;

    let response_json: Value = serde_json::from_str(&response_text).map_err(|e| e.to_string())?;
    let structured = extract_structured_output(&response_json)?;
    Ok((structured, profile))
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

fn ensure_keywords_have_values(entries: &[String], field_name: &str) -> Result<(), String> {
    if entries.iter().all(|k| k.trim().is_empty()) {
        return Err(format!(
            "{} must include at least one non-empty value",
            field_name
        ));
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
    let payload = json!({
      "task": "api_key_connectivity_test",
      "requirement": "Return one concise sentence with model name and active parameters."
    });
    let (structured, profile) = call_openai_structured(
        &app,
        "You are a diagnostic assistant. Return one short sentence introducing the model version and active runtime parameters.",
        payload,
        "openai_api_key_test",
        openai_test_response_schema(),
        Some(80),
    )
    .await?;

    let parsed: OpenAiTestModelOutput =
        serde_json::from_value(structured).map_err(|e| e.to_string())?;
    Ok(OpenAiTestResult {
        ok: true,
        intro: parsed.intro,
        model: profile.model,
        reasoning_effort: profile.reasoning_effort,
        text_verbosity: profile.text_verbosity,
        timeout_seconds: profile.timeout_seconds,
    })
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
    ensure_keywords_have_values(
        &request.hard_requirements.technical_skills,
        "hardRequirements.technicalSkills",
    )?;
    ensure_keywords_have_values(
        &request.hard_requirements.behavioural_capabilities,
        "hardRequirements.behaviouralCapabilities",
    )?;

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
        }
    });

    let (structured, profile) = call_openai_structured(
        &app,
        "You generate British-English cover letters. Parse noisy JD text, follow hard requirements first, then prompt constraints. If any hard requirement cannot be grounded by the provided prompt competency map, set status=needs_prompt_update, explain missing requirements, and leave coverLetter empty. Always return JSON matching schema.",
        payload,
        "cover_letter_generation",
        cover_letter_response_schema(),
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
pub async fn ai_update_cover_letter_prompt(
    app: AppHandle,
    request: PromptUpdateRequest,
) -> Result<PromptUpdateResponse, String> {
    ensure_ai_config(&app)?;
    ensure_non_empty(&request.session_id, "sessionId")?;
    ensure_non_empty(&request.previous_prompt_version, "previousPromptVersion")?;
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
        "You update cover-letter prompt files. Convert added content to British English, preserve existing prompt structure, and integrate structured updates for skills/capabilities. If requirements are contradictory or insufficient, set status=rejected and explain via feedbackMessages. Always return JSON matching schema.",
        payload,
        "cover_letter_prompt_update",
        prompt_update_response_schema(),
        None,
    )
    .await?;

    let parsed: PromptUpdateModelOutput =
        serde_json::from_value(structured).map_err(|e| e.to_string())?;
    let has_prompt =
        parsed.status == "updated" && !parsed.updated_prompt_markdown.trim().is_empty();

    Ok(PromptUpdateResponse {
        status: parsed.status,
        updated_prompt_markdown: if has_prompt {
            Some(parsed.updated_prompt_markdown)
        } else {
            None
        },
        feedback_messages: parsed.feedback_messages,
        model: profile.model,
        reasoning_effort: profile.reasoning_effort,
        text_verbosity: profile.text_verbosity,
    })
}
