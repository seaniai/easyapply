import { useMemo, useState } from "react";
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

function splitLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function nextPromptVersion(current: string): string {
  const match = /^v(\d+)_(\d+)$/i.exec(current.trim());
  if (!match) return "v1_0";
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return "v1_0";
  return `v${major}_${minor + 1}`;
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
        addFeedback({ level: "error", text: "Invalid prompt file path." });
        return;
      }
      const content = await invoke<string>("ai_read_text_file", { path });
      setPromptPath(path);
      setPromptMarkdown(content);

      const fileName = path.replaceAll("\\", "/").split("/").pop() || "";
      const match = /cover_letter_prompt_(v\d+_\d+)\.md/i.exec(fileName);
      if (match?.[1]) setPromptVersion(match[1]);

      addFeedback({ level: "info", text: `Prompt loaded: ${path}` });
    } catch (e) {
      addFeedback({ level: "error", text: `Failed to load prompt file: ${String(e)}` });
    }
  };

  const buildGeneratePayload = (): CoverLetterGeneratePayload => ({
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

  const requestGenerate = async () => {
    if (!canGenerate) return;
    setBusyGenerate(true);
    try {
      const payload = buildGeneratePayload();
      const response = await invoke<CoverLetterGenerateResponse>("ai_generate_cover_letter", { request: payload });

      response.feedbackMessages.forEach((msg) => addFeedback({ level: "info", text: msg }));
      response.missingRequirements.forEach((msg) => addFeedback({ level: "warn", text: msg }));

      if (response.status === "generated" && response.coverLetter) {
        const nextVersion = coverLetterVersion + 1;
        const block = `\n=== Cover Letter v${nextVersion} (${promptVersion}) ===\n${response.coverLetter.trim()}\n`;
        setCoverLetterText((prev) => `${prev}${block}`);
        setCoverLetterVersion(nextVersion);
        const summary = `Generated cover letter v${nextVersion} via ${response.model}`;
        addFeedback({ level: "info", text: summary });
        appendHistory("Generate cover letter", summary, ["cover-letter", "generated"]);
      } else {
        const warnText =
          "Cover letter was not updated because prompt update is required for current hard requirements.";
        addFeedback({ level: "warn", text: warnText });
        appendHistory("Generate cover letter", warnText, ["cover-letter", "needs-prompt-update"]);
      }
    } catch (e) {
      const msg = `Generate failed: ${String(e)}`;
      addFeedback({ level: "error", text: msg });
      appendHistory("Generate cover letter", msg, ["cover-letter", "error"]);
    } finally {
      setBusyGenerate(false);
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
      addFeedback({ level: "error", text: "Prompt save path is not set." });
      return;
    }
    if (!promptMarkdown.trim()) {
      addFeedback({ level: "error", text: "Current prompt content is empty." });
      return;
    }

    const skillErr = validateStructuredEntry(skillUpdate, "Skill update");
    if (skillErr) {
      addFeedback({ level: "error", text: skillErr });
      return;
    }
    const capabilityErr = validateStructuredEntry(capabilityUpdate, "Capability update");
    if (capabilityErr) {
      addFeedback({ level: "error", text: capabilityErr });
      return;
    }

    const skillUpdates = skillUpdate.name.trim() ? [toPatchPayload(skillUpdate)] : [];
    const capabilityUpdates = capabilityUpdate.name.trim() ? [toPatchPayload(capabilityUpdate)] : [];
    const otherUpdatesArray = splitLines(otherUpdates);

    if (skillUpdates.length === 0 && capabilityUpdates.length === 0 && otherUpdatesArray.length === 0) {
      addFeedback({ level: "warn", text: "No prompt updates were provided." });
      return;
    }

    setBusyPromptUpdate(true);
    try {
      const payload: PromptUpdatePayload = {
        sessionId,
        previousPromptVersion: promptVersion,
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

      if (response.status !== "updated" || !response.updatedPromptMarkdown) {
        const text = "Prompt update was rejected. Please review feedback.";
        addFeedback({ level: "warn", text });
        appendHistory("Update prompt", text, ["prompt", "rejected"]);
        return;
      }

      const nextVersion = nextPromptVersion(promptVersion);
      const nextPath = promptPath.replace(/cover_letter_prompt_v\d+_\d+\.md$/i, `cover_letter_prompt_${nextVersion}.md`);
      if (nextPath === promptPath) {
        addFeedback({
          level: "warn",
          text: "Prompt filename does not match expected version naming; using same path for save.",
        });
      }
      const savePath = nextPath === promptPath ? promptPath : nextPath;
      await invoke("ai_write_text_file", { path: savePath, content: response.updatedPromptMarkdown });
      setPromptMarkdown(response.updatedPromptMarkdown);
      setPromptVersion(nextVersion);
      setPromptPath(savePath);

      const okText = `Prompt updated to ${nextVersion} at ${savePath}`;
      addFeedback({ level: "info", text: okText });
      appendHistory("Update prompt", okText, ["prompt", "updated"]);
    } catch (e) {
      const msg = `Prompt update failed: ${String(e)}`;
      addFeedback({ level: "error", text: msg });
      appendHistory("Update prompt", msg, ["prompt", "error"]);
    } finally {
      setBusyPromptUpdate(false);
    }
  };

  const openPromptFolder = async () => {
    if (!promptPath.trim()) {
      addFeedback({ level: "warn", text: "Prompt path is not set." });
      return;
    }
    const normalized = promptPath.replaceAll("\\", "/");
    const idx = normalized.lastIndexOf("/");
    if (idx < 0) {
      addFeedback({ level: "warn", text: "Cannot derive prompt folder from current path." });
      return;
    }
    const folder = normalized.slice(0, idx);
    try {
      await invoke("ai_open_folder", { path: folder });
      addFeedback({ level: "info", text: `Opened prompt folder: ${folder}` });
    } catch (e) {
      addFeedback({ level: "error", text: `Failed to open prompt folder: ${String(e)}` });
    }
  };

  return (
    <div className="clgen">
      <div className="clgen__header">
        <h2 className="clgen__title">Cover Letter Generate</h2>
        <div className="clgen__header-actions">
          <button className="btn" onClick={onBack} disabled={disabled || busyGenerate || busyPromptUpdate}>
            {t("app.panel.actions.back")}
          </button>
        </div>
      </div>

      <div className="clgen__columns">
        <section className="clgen__column">
          <div className="settings__section">
            <div className="settings__section-title">JD Text</div>
            <textarea
              className="clgen__textarea"
              value={jdRawText}
              onChange={(e) => setJdRawText(e.target.value)}
              disabled={disabled || busyGenerate}
              placeholder="Paste full JD page text here. Extra copied noise is acceptable."
            />
          </div>
          <div className="settings__section">
            <div className="settings__section-title">Hard Requirements (Optional)</div>
            <label className="clgen__label">Technical Skills</label>
            <textarea
              className="clgen__textarea clgen__textarea--sm"
              value={hardRequirements.technicalSkills}
              onChange={(e) =>
                setHardRequirements((prev) => ({ ...prev, technicalSkills: e.target.value }))
              }
              disabled={disabled || busyGenerate}
              placeholder="One line per requirement."
            />
            <label className="clgen__label">Behavioural Capabilities</label>
            <textarea
              className="clgen__textarea clgen__textarea--sm"
              value={hardRequirements.behaviouralCapabilities}
              onChange={(e) =>
                setHardRequirements((prev) => ({ ...prev, behaviouralCapabilities: e.target.value }))
              }
              disabled={disabled || busyGenerate}
              placeholder="One line per requirement."
            />
            <label className="clgen__label">Other Requirements</label>
            <textarea
              className="clgen__textarea clgen__textarea--sm"
              value={hardRequirements.otherRequirements}
              onChange={(e) =>
                setHardRequirements((prev) => ({ ...prev, otherRequirements: e.target.value }))
              }
              disabled={disabled || busyGenerate}
              placeholder="One line per requirement."
            />
          </div>
        </section>

        <section className="clgen__column">
          <div className="settings__section">
            <div className="settings__section-title">Cover Letter Output</div>
            <textarea
              className="clgen__textarea clgen__textarea--cover"
              value={coverLetterText}
              readOnly
              placeholder="Generated cover letter versions will be appended here."
            />
            <div className="settings__actions">
              <button className="btn" onClick={requestLoadPrompt} disabled={disabled || busyGenerate}>
                Select Prompt
              </button>
              <button className="btn btn--primary" onClick={requestGenerate} disabled={!canGenerate}>
                {busyGenerate ? "Generating..." : "Generate Cover Letter"}
              </button>
            </div>
          </div>
        </section>

        <section className="clgen__column">
          <div className="settings__section">
            <div className="settings__section-title">Feedback</div>
            <div className="clgen__feedback">
              {feedbackLines.length === 0 ? (
                <div className="settings__hint">No messages yet.</div>
              ) : (
                feedbackLines.map((line) => (
                  <div key={line.id} className={`clgen__feedback-line clgen__feedback-line--${line.level}`}>
                    {line.text}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="settings__section">
            <div className="settings__section-title">Prompt Iteration</div>
            <div className="clgen__prompt-group">
              <div className="clgen__group-title">Skill Update</div>
              <input
                className="settings__control"
                value={skillUpdate.name}
                onChange={(e) => setSkillUpdate((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Name"
                disabled={disabled || busyPromptUpdate}
              />
              <textarea
                className="clgen__textarea clgen__textarea--sm"
                value={skillUpdate.keywords}
                onChange={(e) => setSkillUpdate((prev) => ({ ...prev, keywords: e.target.value }))}
                placeholder="Keywords (one per line)"
                disabled={disabled || busyPromptUpdate}
              />
              <textarea
                className="clgen__textarea clgen__textarea--sm"
                value={skillUpdate.caseContext}
                onChange={(e) => setSkillUpdate((prev) => ({ ...prev, caseContext: e.target.value }))}
                placeholder="Case.Context"
                disabled={disabled || busyPromptUpdate}
              />
              <textarea
                className="clgen__textarea clgen__textarea--sm"
                value={skillUpdate.caseProblemTask}
                onChange={(e) =>
                  setSkillUpdate((prev) => ({ ...prev, caseProblemTask: e.target.value }))
                }
                placeholder="Case.Problem / Task"
                disabled={disabled || busyPromptUpdate}
              />
              <textarea
                className="clgen__textarea clgen__textarea--sm"
                value={skillUpdate.caseMethodAction}
                onChange={(e) =>
                  setSkillUpdate((prev) => ({ ...prev, caseMethodAction: e.target.value }))
                }
                placeholder="Case.Method / Action"
                disabled={disabled || busyPromptUpdate}
              />
              <textarea
                className="clgen__textarea clgen__textarea--sm"
                value={skillUpdate.caseResult}
                onChange={(e) => setSkillUpdate((prev) => ({ ...prev, caseResult: e.target.value }))}
                placeholder="Case.Result"
                disabled={disabled || busyPromptUpdate}
              />
            </div>

            <div className="clgen__prompt-group">
              <div className="clgen__group-title">Capability Update</div>
              <input
                className="settings__control"
                value={capabilityUpdate.name}
                onChange={(e) => setCapabilityUpdate((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Name"
                disabled={disabled || busyPromptUpdate}
              />
              <textarea
                className="clgen__textarea clgen__textarea--sm"
                value={capabilityUpdate.keywords}
                onChange={(e) => setCapabilityUpdate((prev) => ({ ...prev, keywords: e.target.value }))}
                placeholder="Keywords (one per line)"
                disabled={disabled || busyPromptUpdate}
              />
              <textarea
                className="clgen__textarea clgen__textarea--sm"
                value={capabilityUpdate.caseContext}
                onChange={(e) =>
                  setCapabilityUpdate((prev) => ({ ...prev, caseContext: e.target.value }))
                }
                placeholder="Case.Context"
                disabled={disabled || busyPromptUpdate}
              />
              <textarea
                className="clgen__textarea clgen__textarea--sm"
                value={capabilityUpdate.caseProblemTask}
                onChange={(e) =>
                  setCapabilityUpdate((prev) => ({ ...prev, caseProblemTask: e.target.value }))
                }
                placeholder="Case.Problem / Task"
                disabled={disabled || busyPromptUpdate}
              />
              <textarea
                className="clgen__textarea clgen__textarea--sm"
                value={capabilityUpdate.caseMethodAction}
                onChange={(e) =>
                  setCapabilityUpdate((prev) => ({ ...prev, caseMethodAction: e.target.value }))
                }
                placeholder="Case.Method / Action"
                disabled={disabled || busyPromptUpdate}
              />
              <textarea
                className="clgen__textarea clgen__textarea--sm"
                value={capabilityUpdate.caseResult}
                onChange={(e) =>
                  setCapabilityUpdate((prev) => ({ ...prev, caseResult: e.target.value }))
                }
                placeholder="Case.Result"
                disabled={disabled || busyPromptUpdate}
              />
            </div>

            <div className="clgen__prompt-group">
              <div className="clgen__group-title">Other Updates</div>
              <textarea
                className="clgen__textarea clgen__textarea--sm"
                value={otherUpdates}
                onChange={(e) => setOtherUpdates(e.target.value)}
                placeholder="Optional prompt-structure updates (one line per update)."
                disabled={disabled || busyPromptUpdate}
              />
            </div>

            <div className="clgen__prompt-group">
              <div className="clgen__group-title">Prompt Save Path</div>
              <div className="settings__hint" style={{ marginTop: 0 }}>
                {promptPath || "Not selected"}
              </div>
              <div className="settings__actions">
                <button className="btn" onClick={requestLoadPrompt} disabled={disabled || busyPromptUpdate}>
                  Select Prompt
                </button>
                <button
                  className="btn"
                  onClick={openPromptFolder}
                  disabled={disabled || busyPromptUpdate || !promptPath.trim()}
                >
                  Open Folder
                </button>
              </div>
            </div>

            <div className="settings__actions">
              <button
                className="btn btn--primary"
                onClick={requestPromptUpdate}
                disabled={disabled || busyPromptUpdate || !promptPath.trim()}
              >
                {busyPromptUpdate ? "Updating..." : "Update Prompt"}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
