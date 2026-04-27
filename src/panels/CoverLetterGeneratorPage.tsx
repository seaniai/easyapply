import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

type HardRequirements = {
  technicalSkills: string;
  behaviouralCapabilities: string;
  otherRequirements: string;
};

type SessionHistoryTurn = {
  turnIndex: number;
  actor: "user" | "assistant";
  message: string;
  tags: string[];
};

type CoverLetterGeneratePayload = {
  sessionId: string;
  positionKey: string;
  jdRawText: string;
  promptMarkdown: string;
  hardRequirements: {
    technicalSkills: string[];
    behaviouralCapabilities: string[];
    otherRequirements: string[];
  };
  sessionHistory: SessionHistoryTurn[];
  iterationGoal: string;
  userConfirmationNotes: string;
  allowCoverLetter: boolean;
  workflowState: number;
  workflowPhase: "stage0_planning" | "iterative_generation";
};

type CoverLetterGenerateResponse = {
  status: "generated" | "needs_prompt_update";
  coverLetter: string | null;
  feedbackMessages: string[];
  missingRequirements: string[];
  model: string;
  reasoningEffort: string;
  textVerbosity: string;
};

type PromptPatchEntry = {
  name: string;
  keywords: string;
  caseContext: string;
  caseProblemTask: string;
  caseMethodAction: string;
  caseResult: string;
};

type PromptUpdatePayload = {
  sessionId: string;
  previousPromptVersion: string;
  previousPromptPath: string;
  previousPromptMarkdown: string;
  updateRequirements: {
    skillUpdates: Array<{
      name: string;
      keywords: string[];
      caseContext: string;
      caseProblemTask: string;
      caseMethodAction: string;
      caseResult: string;
    }>;
    capabilityUpdates: Array<{
      name: string;
      keywords: string[];
      caseContext: string;
      caseProblemTask: string;
      caseMethodAction: string;
      caseResult: string;
    }>;
    otherUpdates: string[];
  };
  sessionHistory: SessionHistoryTurn[];
};

type PromptUpdateResponse = {
  status: "updated" | "rejected";
  updatedPromptMarkdown: string | null;
  updatedPromptVersion: string | null;
  savedPromptPath: string | null;
  feedbackMessages: string[];
  model: string;
  reasoningEffort: string;
  textVerbosity: string;
};

type FeedbackLine = {
  id: string;
  level: "info" | "warn" | "error";
  text: string;
};

const DEFAULT_ITERATION_GOAL =
  "Generate a concise and grounded British-English cover letter for this role.";
const PROMPT_PATH_STORAGE_KEY = "easyapply-clg-prompt-path";

function splitLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function toPatchPayload(entry: PromptPatchEntry) {
  return {
    name: entry.name.trim(),
    keywords: splitLines(entry.keywords),
    caseContext: entry.caseContext.trim(),
    caseProblemTask: entry.caseProblemTask.trim(),
    caseMethodAction: entry.caseMethodAction.trim(),
    caseResult: entry.caseResult.trim(),
  };
}

export default function CoverLetterGeneratorPage(props: { t: TranslateFn; disabled?: boolean; onBack: () => void }) {
  const { t, disabled, onBack } = props;

  const [jdRawText, setJdRawText] = useState("");
  const [hardRequirements, setHardRequirements] = useState<HardRequirements>({
    technicalSkills: "",
    behaviouralCapabilities: "",
    otherRequirements: "",
  });

  const [promptPath, setPromptPath] = useState("");
  const [promptVersion, setPromptVersion] = useState("v12_9");
  const [promptMarkdown, setPromptMarkdown] = useState("");

  const [sessionHistory, setSessionHistory] = useState<SessionHistoryTurn[]>([]);
  const [feedbackLines, setFeedbackLines] = useState<FeedbackLine[]>([]);
  const [coverLetterText, setCoverLetterText] = useState("");
  const [coverLetterVersion, setCoverLetterVersion] = useState(0);
  const [busyGenerate, setBusyGenerate] = useState(false);
  const [busyPromptUpdate, setBusyPromptUpdate] = useState(false);
  const [skillUpdateExpanded, setSkillUpdateExpanded] = useState(false);
  const [capabilityUpdateExpanded, setCapabilityUpdateExpanded] = useState(false);
  const [planConfirmationNotes, setPlanConfirmationNotes] = useState("");
  const [generateState, setGenerateState] = useState(0);

  const [skillUpdate, setSkillUpdate] = useState<PromptPatchEntry>({
    name: "",
    keywords: "",
    caseContext: "",
    caseProblemTask: "",
    caseMethodAction: "",
    caseResult: "",
  });
  const [capabilityUpdate, setCapabilityUpdate] = useState<PromptPatchEntry>({
    name: "",
    keywords: "",
    caseContext: "",
    caseProblemTask: "",
    caseMethodAction: "",
    caseResult: "",
  });
  const [otherUpdates, setOtherUpdates] = useState("");

  const addFeedback = (line: Omit<FeedbackLine, "id">) => {
    setFeedbackLines((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        ...line,
      },
    ]);
  };

  const hasPromptLoaded = promptPath.trim().length > 0 && promptMarkdown.trim().length > 0;
  const canGenerate =
    !disabled &&
    !busyGenerate &&
    jdRawText.trim().length > 0 &&
    hasPromptLoaded &&
    promptVersion.trim().length > 0;

  const sessionId = useMemo(() => {
    const base = promptPath.trim() || "cover-letter-session";
    return `session:${base}`;
  }, [promptPath]);

  const positionKey = useMemo(() => {
    const firstLine = jdRawText.split(/\r?\n/).find((l) => l.trim().length > 0) || "unknown-position";
    return firstLine.slice(0, 120);
  }, [jdRawText]);

  const requestLoadPrompt = async () => {
    if (disabled) return;
    try {
      const picked = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!picked) return;
      const path = Array.isArray(picked) ? picked[0] : picked;
      if (typeof path !== "string" || path.trim().length === 0) {
        addFeedback({ level: "error", text: t("cover_letter_generate.messages.invalid_prompt_path") });
        return;
      }
      const content = await invoke<string>("ai_read_text_file", { path });
      setPromptPath(path);
      setPromptMarkdown(content);
      localStorage.setItem(PROMPT_PATH_STORAGE_KEY, path);

      const fileName = path.replaceAll("\\", "/").split("/").pop() || "";
      const match = /cover_letter_prompt_(v\d+_\d+)\.md/i.exec(fileName);
      if (match?.[1]) setPromptVersion(match[1]);

      addFeedback({ level: "info", text: t("cover_letter_generate.hints.prompt_loaded", { path }) });
    } catch (e) {
      addFeedback({
        level: "error",
        text: t("cover_letter_generate.hints.prompt_read_failed", { error: String(e) }),
      });
    }
  };

  useEffect(() => {
    const rememberedPath = localStorage.getItem(PROMPT_PATH_STORAGE_KEY);
    if (!rememberedPath || rememberedPath.trim().length === 0) return;
    void (async () => {
      try {
        const content = await invoke<string>("ai_read_text_file", { path: rememberedPath });
        setPromptPath(rememberedPath);
        setPromptMarkdown(content);
        const fileName = rememberedPath.replaceAll("\\", "/").split("/").pop() || "";
        const match = /cover_letter_prompt_(v\d+_\d+)\.md/i.exec(fileName);
        if (match?.[1]) setPromptVersion(match[1]);
      } catch {
        // Ignore invalid remembered path.
      }
    })();
  }, []);

  const buildGeneratePayload = (nextState: number): CoverLetterGeneratePayload => ({
    sessionId,
    positionKey,
    jdRawText: jdRawText.trim(),
    promptMarkdown,
    hardRequirements: {
      technicalSkills: splitLines(hardRequirements.technicalSkills),
      behaviouralCapabilities: splitLines(hardRequirements.behaviouralCapabilities),
      otherRequirements: splitLines(hardRequirements.otherRequirements),
    },
    sessionHistory,
    iterationGoal: DEFAULT_ITERATION_GOAL,
    userConfirmationNotes: planConfirmationNotes.trim(),
    allowCoverLetter: nextState >= 2,
    workflowState: nextState,
    workflowPhase: nextState <= 1 ? "stage0_planning" : "iterative_generation",
  });

  const appendHistory = (userMessage: string, assistantMessage: string, tags: string[]) => {
    setSessionHistory((prev) => [
      ...prev,
      {
        turnIndex: prev.length + 1,
        actor: "user",
        message: userMessage,
        tags,
      },
      {
        turnIndex: prev.length + 2,
        actor: "assistant",
        message: assistantMessage,
        tags,
      },
    ]);
  };

  useEffect(() => {
    // Reset state machine when JD or Hard Requirements change.
    setGenerateState(0);
  }, [jdRawText, hardRequirements]);

  const stageStatusText = generateState === 0
    ? t("cover_letter_generate.hints.stage0_status_pending")
    : t("cover_letter_generate.hints.stage0_status_iterative");

  const requestGenerate = async () => {
    if (!canGenerate) return;
    setBusyGenerate(true);
    const nextState = generateState + 1;
    const phase = nextState <= 1 ? "stage0_planning" : "iterative_generation";
    try {
      const payload = buildGeneratePayload(nextState);
      const response = await invoke<CoverLetterGenerateResponse>("ai_generate_cover_letter", { request: payload });
      setGenerateState(nextState);

      response.feedbackMessages.forEach((msg) => addFeedback({ level: "info", text: msg }));
      response.missingRequirements.forEach((msg) => {
        const text = msg.includes("[GAP]") ? msg : `[GAP] ${msg}`;
        addFeedback({ level: "warn", text });
      });
      const fullFeedbackText = [...response.feedbackMessages, ...response.missingRequirements]
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .join("\n");
      const hasGap = response.missingRequirements.length > 0 ||
        response.feedbackMessages.some((msg) => msg.includes("[GAP]"));
      const noteText = planConfirmationNotes.trim() || t("cover_letter_generate.hints.no_plan_notes");

      if (response.status === "generated" && response.coverLetter) {
        const nextVersion = coverLetterVersion + 1;
        const block = `\n=== Cover Letter v${nextVersion} (${promptVersion}) ===\n${response.coverLetter.trim()}\n`;
        setCoverLetterText((prev) => `${prev}${block}`);
        setCoverLetterVersion(nextVersion);
      const summary = t("cover_letter_generate.messages.generated_with_model", {
        version: nextVersion,
        model: response.model,
      });
        addFeedback({ level: "info", text: summary });
        appendHistory(
          `[Iteration #${nextState}] ${phase}\nPlan Confirmation / Adjustment:\n${noteText}`,
          [
            `[Iteration #${nextState}] Feedback & Iteration`,
            summary,
            fullFeedbackText,
            `Cover Letter Output: v${nextVersion}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
          ["cover-letter", "generated", `state-${nextState}`]
        );
      } else {
        const warnText = nextState === 1
          ? t("cover_letter_generate.hints.stage0_waiting_confirmation")
          : hasGap
            ? t("cover_letter_generate.hints.iterative_gap_continue")
            : t("cover_letter_generate.hints.iterative_waiting_generation");
        addFeedback({ level: "warn", text: warnText });
        appendHistory(
          `[Iteration #${nextState}] ${phase}\nPlan Confirmation / Adjustment:\n${noteText}`,
          [`[Iteration #${nextState}] Feedback & Iteration`, warnText, fullFeedbackText]
            .filter(Boolean)
            .join("\n\n"),
          hasGap
            ? ["cover-letter", "needs-prompt-update", "gap", `state-${nextState}`]
            : ["cover-letter", "needs-prompt-update", `state-${nextState}`]
        );
      }
    } catch (e) {
      const msg = t("cover_letter_generate.hints.request_failed", { error: String(e) });
      addFeedback({ level: "error", text: msg });
      appendHistory("Generate cover letter", msg, ["cover-letter", "error"]);
    } finally {
      setBusyGenerate(false);
      setPlanConfirmationNotes("");
    }
  };

  function validateStructuredEntry(entry: PromptPatchEntry, label: string): string | null {
    if (!entry.name.trim()) return null;
    if (splitLines(entry.keywords).length === 0) return `${label}: Keywords is required when Name is set.`;
    if (!entry.caseContext.trim()) return `${label}: Case.Context is required when Name is set.`;
    if (!entry.caseProblemTask.trim()) return `${label}: Case.Problem / Task is required when Name is set.`;
    if (!entry.caseMethodAction.trim()) return `${label}: Case.Method / Action is required when Name is set.`;
    if (!entry.caseResult.trim()) return `${label}: Case.Result is required when Name is set.`;
    return null;
  }

  const requestPromptUpdate = async () => {
    if (disabled || busyPromptUpdate) return;
    if (!promptPath.trim()) {
      addFeedback({ level: "error", text: t("cover_letter_generate.hints.prompt_path_required") });
      return;
    }
    if (!promptMarkdown.trim()) {
      addFeedback({ level: "error", text: t("cover_letter_generate.messages.empty_prompt_content") });
      return;
    }

    const skillErr = validateStructuredEntry(skillUpdate, t("cover_letter_generate.actions.append_skill"));
    if (skillErr) {
      addFeedback({ level: "error", text: skillErr });
      return;
    }
    const capabilityErr = validateStructuredEntry(
      capabilityUpdate,
      t("cover_letter_generate.actions.append_capability")
    );
    if (capabilityErr) {
      addFeedback({ level: "error", text: capabilityErr });
      return;
    }

    const skillUpdates = skillUpdate.name.trim() ? [toPatchPayload(skillUpdate)] : [];
    const capabilityUpdates = capabilityUpdate.name.trim() ? [toPatchPayload(capabilityUpdate)] : [];
    const otherUpdatesArray = splitLines(otherUpdates);

    if (skillUpdates.length === 0 && capabilityUpdates.length === 0 && otherUpdatesArray.length === 0) {
      addFeedback({ level: "warn", text: t("cover_letter_generate.messages.no_prompt_updates") });
      return;
    }

    setBusyPromptUpdate(true);
    try {
      const payload: PromptUpdatePayload = {
        sessionId,
        previousPromptVersion: promptVersion,
        previousPromptPath: promptPath,
        previousPromptMarkdown: promptMarkdown,
        updateRequirements: {
          skillUpdates,
          capabilityUpdates,
          otherUpdates: otherUpdatesArray,
        },
        sessionHistory,
      };

      const response = await invoke<PromptUpdateResponse>("ai_update_cover_letter_prompt", { request: payload });
      response.feedbackMessages.forEach((msg) => addFeedback({ level: "info", text: msg }));

      if (response.status !== "updated" || !response.updatedPromptMarkdown || !response.updatedPromptVersion) {
        const text = t("cover_letter_generate.hints.prompt_update_rejected");
        addFeedback({ level: "warn", text });
        appendHistory("Update prompt", text, ["prompt", "rejected"]);
        return;
      }
      setPromptMarkdown(response.updatedPromptMarkdown);
      setPromptVersion(response.updatedPromptVersion);
      if (response.savedPromptPath) {
        setPromptPath(response.savedPromptPath);
        localStorage.setItem(PROMPT_PATH_STORAGE_KEY, response.savedPromptPath);
      }

      const okText = t("cover_letter_generate.messages.prompt_updated_to", {
        version: response.updatedPromptVersion,
        path: response.savedPromptPath ?? promptPath,
      });
      addFeedback({ level: "info", text: okText });
      appendHistory("Update prompt", okText, ["prompt", "updated"]);
    } catch (e) {
      const msg = t("cover_letter_generate.hints.prompt_write_failed", { error: String(e) });
      addFeedback({ level: "error", text: msg });
      appendHistory("Update prompt", msg, ["prompt", "error"]);
    } finally {
      setBusyPromptUpdate(false);
    }
  };

  const openPromptFolder = async () => {
    if (!promptPath.trim()) {
      addFeedback({ level: "warn", text: t("cover_letter_generate.hints.prompt_path_required") });
      return;
    }
    const idx = Math.max(promptPath.lastIndexOf("\\"), promptPath.lastIndexOf("/"));
    if (idx < 0) {
      addFeedback({ level: "warn", text: t("cover_letter_generate.messages.invalid_prompt_folder") });
      return;
    }
    const folder = promptPath.slice(0, idx);
    try {
      await invoke("ai_open_folder", { path: folder });
      addFeedback({ level: "info", text: t("cover_letter_generate.messages.opened_prompt_folder", { folder }) });
    } catch (e) {
      addFeedback({
        level: "error",
        text: t("cover_letter_generate.hints.prompt_open_failed", { error: String(e) }),
      });
    }
  };

  const hardRequirementsHelp = t("cover_letter_generate.hints.hard_requirements_help");
  const promptIterationHelp = t("cover_letter_generate.hints.prompt_iteration_help");

  return (
    <div className="clg">
      <div className="clg__header">
        <h2 className="clg__title">{t("app.main.cover_letter_generate")}</h2>
        <div className="clg__header-actions">
          <button className="btn" onClick={onBack} disabled={disabled || busyGenerate || busyPromptUpdate}>
            {t("cover_letter_generate.actions.back_to_home")}
          </button>
        </div>
      </div>

      <div className="clg__layout">
        <section className="clg__col">
          <div className="settings__section">
            <div className="settings__section-title">{t("cover_letter_generate.fields.jd_text")}</div>
            <textarea
              className="clg__textarea clg__textarea--jd"
              value={jdRawText}
              onChange={(e) => setJdRawText(e.target.value)}
              disabled={disabled || busyGenerate}
              placeholder={t("cover_letter_generate.hints.jd_raw_paste")}
            />
          </div>
          <div className="settings__section clg__section-gap-lg">
            <div className="settings__section-title" title={hardRequirementsHelp}>
              {t("cover_letter_generate.fields.hard_requirements")}
            </div>
            <label className="clg__label">{t("cover_letter_generate.fields.technical_skills")}</label>
            <textarea
              className="clg__textarea clg__textarea--compact"
              value={hardRequirements.technicalSkills}
              onChange={(e) =>
                setHardRequirements((prev) => ({ ...prev, technicalSkills: e.target.value }))
              }
              disabled={disabled || busyGenerate}
              placeholder={t("cover_letter_generate.fields.technical_skills")}
            />
            <label className="clg__label">{t("cover_letter_generate.fields.behavioural_capabilities")}</label>
            <textarea
              className="clg__textarea clg__textarea--compact"
              value={hardRequirements.behaviouralCapabilities}
              onChange={(e) =>
                setHardRequirements((prev) => ({ ...prev, behaviouralCapabilities: e.target.value }))
              }
              disabled={disabled || busyGenerate}
              placeholder={t("cover_letter_generate.fields.behavioural_capabilities")}
            />
            <label className="clg__label">{t("cover_letter_generate.fields.other_requirements")}</label>
            <textarea
              className="clg__textarea clg__textarea--compact"
              value={hardRequirements.otherRequirements}
              onChange={(e) =>
                setHardRequirements((prev) => ({ ...prev, otherRequirements: e.target.value }))
              }
              disabled={disabled || busyGenerate}
              placeholder={t("cover_letter_generate.fields.other_requirements")}
            />
          </div>
        </section>

        <section className="clg__col">
          <div className="settings__section clg__output-section">
            <div className="clg__output-titlebar">
              <div className="settings__section-title clg__output-title">
                {t("cover_letter_generate.sections.cover_letter_output")}
              </div>
              <div className="clg__iteration-card" aria-live="polite">
                <div className="clg__iteration-card-title">{t("cover_letter_generate.fields.iteration_round")}</div>
                <div className="clg__iteration-calendar">
                  <div key={coverLetterVersion} className="clg__iteration-page">
                    <div className="clg__iteration-value">{coverLetterVersion}</div>
                  </div>
                </div>
              </div>
            </div>
            <textarea
              className="clg__body-window clg__body-window--main"
              value={coverLetterText}
              readOnly
              placeholder={t("cover_letter_generate.hints.output_append_only")}
            />
            <div className="settings__actions clg__actions-row">
              <button className="btn" onClick={requestLoadPrompt} disabled={disabled || busyGenerate}>
                {t("cover_letter_generate.actions.browse_prompt_path")}
              </button>
              <button
                className="btn clg__btn-wide"
                onClick={openPromptFolder}
                disabled={disabled || busyGenerate || !promptPath.trim()}
              >
                {t("cover_letter_generate.actions.open_prompt_folder")}
              </button>
            </div>
            <div className="settings__hint">
              {t("cover_letter_generate.hints.stage0_status_label")}: S{generateState} - {stageStatusText}
            </div>
            <div className="clg__block clg__section-gap-lg">
              <div className="clg__label">{t("cover_letter_generate.fields.plan_confirmation_notes")}</div>
              <textarea
                className="clg__textarea"
                value={planConfirmationNotes}
                onChange={(e) => setPlanConfirmationNotes(e.target.value)}
                placeholder={t("cover_letter_generate.hints.plan_confirmation_notes_help")}
                disabled={disabled || busyGenerate}
              />
            </div>
            <div className="settings__actions clg__actions-row">
              <button className="btn btn--primary clg__btn-wide" onClick={requestGenerate} disabled={!canGenerate}>
                {busyGenerate
                  ? t("cover_letter_generate.actions.generating_cover_letter")
                  : t("cover_letter_generate.actions.generate_cover_letter")}
              </button>
            </div>
          </div>
        </section>

        <section className="clg__col clg__col--right">
          <div className="settings__section">
            <div className="settings__section-title">{t("cover_letter_generate.sections.feedback_iteration")}</div>
            <div className="clg__feedback-window">
              {feedbackLines.length === 0 ? (
                <div className="settings__hint">{t("cover_letter_generate.hints.feedback_window_desc")}</div>
              ) : (
                feedbackLines.map((line) => (
                  <div key={line.id} className={`clg__feedback-item clg__feedback-line--${line.level}`}>
                    {line.text}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="settings__section clg__section-gap-lg">
            <div className="settings__section-title" title={promptIterationHelp}>
              {t("cover_letter_generate.sections.prompt_iteration")}
            </div>
            <div className="clg__block">
              <button
                className="btn clg__btn-wide"
                type="button"
                onClick={() => setSkillUpdateExpanded((v) => !v)}
                disabled={disabled || busyPromptUpdate}
              >
                {skillUpdateExpanded
                  ? t("cover_letter_generate.actions.collapse_skill_update")
                  : t("cover_letter_generate.actions.append_skill")}
              </button>
              {skillUpdateExpanded ? (
                <>
                  <input
                    className="settings__control"
                    value={skillUpdate.name}
                    onChange={(e) => setSkillUpdate((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder={t("cover_letter_generate.placeholders.skill_name")}
                    disabled={disabled || busyPromptUpdate}
                  />
                  <textarea
                    className="clg__textarea"
                    value={skillUpdate.keywords}
                    onChange={(e) => setSkillUpdate((prev) => ({ ...prev, keywords: e.target.value }))}
                    placeholder={t("cover_letter_generate.placeholders.skill_keywords")}
                    disabled={disabled || busyPromptUpdate}
                  />
                  <textarea
                    className="clg__textarea"
                    value={skillUpdate.caseContext}
                    onChange={(e) => setSkillUpdate((prev) => ({ ...prev, caseContext: e.target.value }))}
                    placeholder={t("cover_letter_generate.placeholders.case_context")}
                    disabled={disabled || busyPromptUpdate}
                  />
                  <textarea
                    className="clg__textarea"
                    value={skillUpdate.caseProblemTask}
                    onChange={(e) =>
                      setSkillUpdate((prev) => ({ ...prev, caseProblemTask: e.target.value }))
                    }
                    placeholder={t("cover_letter_generate.placeholders.case_problem_task")}
                    disabled={disabled || busyPromptUpdate}
                  />
                  <textarea
                    className="clg__textarea"
                    value={skillUpdate.caseMethodAction}
                    onChange={(e) =>
                      setSkillUpdate((prev) => ({ ...prev, caseMethodAction: e.target.value }))
                    }
                    placeholder={t("cover_letter_generate.placeholders.case_method_action")}
                    disabled={disabled || busyPromptUpdate}
                  />
                  <textarea
                    className="clg__textarea"
                    value={skillUpdate.caseResult}
                    onChange={(e) => setSkillUpdate((prev) => ({ ...prev, caseResult: e.target.value }))}
                    placeholder={t("cover_letter_generate.placeholders.case_result")}
                    disabled={disabled || busyPromptUpdate}
                  />
                </>
              ) : null}
            </div>

            <hr className="clg__section-divider" />
            <div className="clg__block">
              <button
                className="btn clg__btn-wide"
                type="button"
                onClick={() => setCapabilityUpdateExpanded((v) => !v)}
                disabled={disabled || busyPromptUpdate}
              >
                {capabilityUpdateExpanded
                  ? t("cover_letter_generate.actions.collapse_capability_update")
                  : t("cover_letter_generate.actions.append_capability")}
              </button>
              {capabilityUpdateExpanded ? (
                <>
                  <input
                    className="settings__control"
                    value={capabilityUpdate.name}
                    onChange={(e) => setCapabilityUpdate((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder={t("cover_letter_generate.placeholders.skill_name")}
                    disabled={disabled || busyPromptUpdate}
                  />
                  <textarea
                    className="clg__textarea"
                    value={capabilityUpdate.keywords}
                    onChange={(e) => setCapabilityUpdate((prev) => ({ ...prev, keywords: e.target.value }))}
                    placeholder={t("cover_letter_generate.placeholders.skill_keywords")}
                    disabled={disabled || busyPromptUpdate}
                  />
                  <textarea
                    className="clg__textarea"
                    value={capabilityUpdate.caseContext}
                    onChange={(e) =>
                      setCapabilityUpdate((prev) => ({ ...prev, caseContext: e.target.value }))
                    }
                    placeholder={t("cover_letter_generate.placeholders.case_context")}
                    disabled={disabled || busyPromptUpdate}
                  />
                  <textarea
                    className="clg__textarea"
                    value={capabilityUpdate.caseProblemTask}
                    onChange={(e) =>
                      setCapabilityUpdate((prev) => ({ ...prev, caseProblemTask: e.target.value }))
                    }
                    placeholder={t("cover_letter_generate.placeholders.case_problem_task")}
                    disabled={disabled || busyPromptUpdate}
                  />
                  <textarea
                    className="clg__textarea"
                    value={capabilityUpdate.caseMethodAction}
                    onChange={(e) =>
                      setCapabilityUpdate((prev) => ({ ...prev, caseMethodAction: e.target.value }))
                    }
                    placeholder={t("cover_letter_generate.placeholders.case_method_action")}
                    disabled={disabled || busyPromptUpdate}
                  />
                  <textarea
                    className="clg__textarea"
                    value={capabilityUpdate.caseResult}
                    onChange={(e) =>
                      setCapabilityUpdate((prev) => ({ ...prev, caseResult: e.target.value }))
                    }
                    placeholder={t("cover_letter_generate.placeholders.case_result")}
                    disabled={disabled || busyPromptUpdate}
                  />
                </>
              ) : null}
            </div>

            <hr className="clg__section-divider" />
            <div className="clg__block">
              <div className="clg__label">{t("cover_letter_generate.fields.other_requirements")}</div>
              <textarea
                className="clg__textarea"
                value={otherUpdates}
                onChange={(e) => setOtherUpdates(e.target.value)}
                placeholder={t("cover_letter_generate.fields.other_requirements")}
                disabled={disabled || busyPromptUpdate}
              />
            </div>

            <div className="settings__actions">
              <button
                className="btn btn--primary"
                onClick={requestPromptUpdate}
                disabled={disabled || busyPromptUpdate || !promptPath.trim()}
              >
                {busyPromptUpdate
                  ? t("cover_letter_generate.actions.updating_prompt")
                  : t("cover_letter_generate.actions.update_prompt")}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
