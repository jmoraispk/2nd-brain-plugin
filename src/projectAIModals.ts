/**
 * Talk-to-create and talk-to-update project modals (v0.9.4).
 *
 * "Speech" is the phone OS dictating into the textarea — we don't do STT.
 * Both reuse the capture-modal chrome (top-anchored, X + title, no 3-line
 * headers). Both call the configured LLM and write section-bounded results.
 */

import { App, Modal, Notice, TFile } from "obsidian";
import SecondBrainPlugin from "../main";
import { callLLM } from "./llm";
import { resolveRoute } from "./modelRoutes";
import { WHEEL_AREAS, Project, createProjectWithBody } from "./projects";
import { replaceSection } from "./projectMutate";

const EDITABLE_SECTIONS = ["Current state", "Active TODOs", "History"] as const;

const CREATE_SYSTEM = `You turn a free-form spoken description of a project into a structured project note.

Return EXACTLY this shape and nothing else:

NAME: <a concise project name, 2–6 words, no quotes>

## Why
<1–3 sentences on why this project matters, in the user's voice>

## Done criteria
<an unambiguous, pass/fail definition of "finished">

## Current state
<where things stand right now, from the description; brief>

## Active TODOs
- [ ] <concrete next action>
- [ ] <...>

## History
<leave empty unless the description mentions things already done; if so, "- [x] <thing>">

Rules:
- Be faithful to the description. Don't invent scope.
- Keep each section tight. Empty is fine if the description doesn't cover it.
- Output only the NAME line + the five H2 sections, in that order.`;

const UPDATE_SYSTEM = `You apply a spoken instruction to an existing project note, editing ONLY these sections: Current state, Active TODOs, History. Never touch Why or Done criteria.

You'll get the project's current sections and an instruction. Return ONLY the sections you changed, each as a full replacement, using H2 headers exactly:

## Current state
<new full content for this section, if changed>

## Active TODOs
- [ ] ...
## History
- [x] 2026-... — ...

Rules:
- Output only the section(s) you actually changed. Omit unchanged sections.
- Active TODOs are \`- [ ]\`; completed items move to History as \`- [x] <date> — <text>\`.
- Preserve existing items unless the instruction says to remove/complete them.
- Be faithful to the instruction; don't invent work.`;

// ── Talk-to-create ────────────────────────────────────────────────────────

export class ProjectTalkCreateModal extends Modal {
  private readonly plugin: SecondBrainPlugin;
  private readonly onCreated: (file: TFile) => void;
  private textarea!: HTMLTextAreaElement;
  private areaSelect!: HTMLSelectElement;

  constructor(
    app: App,
    plugin: SecondBrainPlugin,
    onCreated: (file: TFile) => void
  ) {
    super(app);
    this.plugin = plugin;
    this.onCreated = onCreated;
    this.modalEl.addClass("second-brain-capture-modal");
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    const header = contentEl.createDiv({ cls: "second-brain-capture-header" });
    header.createEl("h2", {
      text: "Describe a project",
      cls: "second-brain-capture-title",
    });
    const close = header.createEl("button", {
      text: "✕",
      cls: "second-brain-capture-close",
      attr: { title: "Close" },
    });
    close.addEventListener("click", () => this.close());

    contentEl.createEl("div", {
      cls: "second-brain-muted",
      text: "Talk freely about the project — what, why, where it stands, next steps. The AI structures it into the project format.",
    });

    this.textarea = contentEl.createEl("textarea", {
      cls: "second-brain-modal-textarea",
      attr: { placeholder: "e.g. I want to ship the plugin to the community store by August; right now habits work, projects are half-done; next I need…" },
    });
    this.textarea.focus();

    const areaRow = contentEl.createDiv({ cls: "second-brain-capture-project-row" });
    areaRow.createEl("label", { text: "Area", cls: "second-brain-picker-label" });
    this.areaSelect = areaRow.createEl("select", { cls: "second-brain-select" });
    const none = this.areaSelect.createEl("option", { text: "— none —" });
    none.value = "";
    let macro = "";
    for (const a of WHEEL_AREAS) {
      if (a.macro !== macro) {
        const sep = this.areaSelect.createEl("option", { text: `— ${a.macro} —` });
        sep.value = "";
        sep.setAttribute("disabled", "true");
        macro = a.macro;
      }
      const opt = this.areaSelect.createEl("option", { text: `  ${a.sub}` });
      opt.value = a.path;
    }

    const actions = contentEl.createDiv({ cls: "second-brain-modal-actions" });
    const go = actions.createEl("button", {
      text: "Structure & create",
      cls: "second-brain-modal-save",
    });
    go.addEventListener("click", () => this.submit(go));
    const cancel = actions.createEl("button", {
      text: "Cancel",
      cls: "second-brain-modal-cancel",
    });
    cancel.addEventListener("click", () => this.close());
  }

  private async submit(btn: HTMLButtonElement) {
    const desc = this.textarea.value.trim();
    if (!desc) {
      new Notice("Describe the project first.");
      return;
    }
    btn.setAttribute("disabled", "true");
    btn.setText("Structuring…");
    try {
      const route = resolveRoute(this.plugin.settings, "project-ai");
      const out = await callLLM(this.plugin.settings, CREATE_SYSTEM, desc, {
        model: route.model,
        effort: route.effort,
      });
      const { name, body } = splitNameAndBody(out);
      const areaPaths = this.areaSelect.value ? [this.areaSelect.value] : [];
      const file = await createProjectWithBody(
        this.app,
        name || "Untitled project",
        areaPaths,
        body
      );
      this.onCreated(file);
      this.close();
      new Notice(`Created project: ${file.path}`);
    } catch (err) {
      this.plugin.errorLog.push("projectTalkCreate", err);
      new Notice(
        `Create failed: ${(err as Error).message}\nSee Settings → Logs for details.`,
        8000
      );
      btn.removeAttribute("disabled");
      btn.setText("Structure & create");
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ── Talk-to-update ────────────────────────────────────────────────────────

export class ProjectEditModal extends Modal {
  private readonly plugin: SecondBrainPlugin;
  private readonly project: Project;
  private readonly onApplied: () => void;
  private textarea!: HTMLTextAreaElement;
  private preview: HTMLElement | null = null;
  private proposed: string | null = null;

  constructor(
    app: App,
    plugin: SecondBrainPlugin,
    project: Project,
    onApplied: () => void
  ) {
    super(app);
    this.plugin = plugin;
    this.project = project;
    this.onApplied = onApplied;
    this.modalEl.addClass("second-brain-capture-modal");
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    const header = contentEl.createDiv({ cls: "second-brain-capture-header" });
    header.createEl("h2", {
      text: `Edit: ${this.project.name}`,
      cls: "second-brain-capture-title",
    });
    const close = header.createEl("button", {
      text: "✕",
      cls: "second-brain-capture-close",
      attr: { title: "Close" },
    });
    close.addEventListener("click", () => this.close());

    contentEl.createEl("div", {
      cls: "second-brain-muted",
      text: "Say what changed — mark milestones/TODOs done, add tasks, update the state. Only Current state / Active TODOs / History are touched; Why & Done criteria stay yours.",
    });

    this.textarea = contentEl.createEl("textarea", {
      cls: "second-brain-modal-textarea",
      attr: { placeholder: "e.g. mark the testbed task done, add a TODO to write the README, and note that the sync bug is fixed" },
    });
    this.textarea.focus();

    const actions = contentEl.createDiv({ cls: "second-brain-modal-actions" });
    const go = actions.createEl("button", {
      text: "Propose edit",
      cls: "second-brain-modal-save",
    });
    go.addEventListener("click", () => this.propose(go));
    const cancel = actions.createEl("button", {
      text: "Cancel",
      cls: "second-brain-modal-cancel",
    });
    cancel.addEventListener("click", () => this.close());

    this.preview = contentEl.createDiv({ cls: "second-brain-edit-preview" });
  }

  private async propose(btn: HTMLButtonElement) {
    const instruction = this.textarea.value.trim();
    if (!instruction) {
      new Notice("Say what to change first.");
      return;
    }
    btn.setAttribute("disabled", "true");
    btn.setText("Thinking…");
    try {
      const current = await this.app.vault.read(this.project.file);
      const ctx = [
        "## Instruction",
        instruction,
        "",
        "## Current project sections",
        sectionsContext(current),
      ].join("\n");
      const route = resolveRoute(this.plugin.settings, "project-ai");
      const out = await callLLM(this.plugin.settings, UPDATE_SYSTEM, ctx, {
        model: route.model,
        effort: route.effort,
      });
      this.proposed = out.trim();
      this.renderPreview(out.trim());
    } catch (err) {
      this.plugin.errorLog.push("projectEdit", err);
      new Notice(
        `Propose failed: ${(err as Error).message}\nSee Settings → Logs for details.`,
        8000
      );
    } finally {
      btn.removeAttribute("disabled");
      btn.setText("Propose edit");
    }
  }

  private renderPreview(out: string) {
    if (!this.preview) return;
    this.preview.empty();
    this.preview.createEl("div", {
      cls: "second-brain-muted",
      text: "Proposed changes (only these sections will be replaced):",
    });
    this.preview.createEl("pre", {
      text: out,
      cls: "second-brain-row-prompt",
    });
    const row = this.preview.createDiv({ cls: "second-brain-modal-actions" });
    const apply = row.createEl("button", {
      text: "Apply",
      cls: "second-brain-modal-save",
    });
    apply.addEventListener("click", () => this.apply());
    const discard = row.createEl("button", {
      text: "Discard",
      cls: "second-brain-modal-cancel",
    });
    discard.addEventListener("click", () => {
      this.proposed = null;
      this.preview?.empty();
    });
  }

  private async apply() {
    if (!this.proposed) return;
    try {
      let content = await this.app.vault.read(this.project.file);
      const sections = parseReturnedSections(this.proposed);
      let applied = 0;
      for (const name of EDITABLE_SECTIONS) {
        const body = sections.get(name);
        if (body !== undefined) {
          content = replaceSection(content, name, body, name === "Active TODOs" ? "History" : undefined);
          applied++;
        }
      }
      if (applied === 0) {
        new Notice("No editable sections found in the proposal.");
        return;
      }
      await this.app.vault.modify(this.project.file, content);
      this.onApplied();
      this.close();
      new Notice(`Updated ${applied} section${applied === 1 ? "" : "s"} in ${this.project.name}.`);
    } catch (err) {
      this.plugin.errorLog.push("projectEditApply", err);
      new Notice(
        `Apply failed: ${(err as Error).message}\nSee Settings → Logs for details.`,
        8000
      );
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

function splitNameAndBody(out: string): { name: string; body: string } {
  const lines = out.split(/\r?\n/);
  let name = "";
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^NAME:\s*(.+?)\s*$/);
    if (m) {
      name = m[1].replace(/^["']|["']$/g, "").trim();
      bodyStart = i + 1;
      break;
    }
  }
  const body = lines.slice(bodyStart).join("\n").replace(/^\s*\n+/, "");
  return { name, body };
}

/** Extract the editable sections from a project file as a context block. */
function sectionsContext(content: string): string {
  const out: string[] = [];
  for (const name of ["Why", "Done criteria", ...EDITABLE_SECTIONS]) {
    out.push(`## ${name}\n${extractSectionBody(content, name)}`);
  }
  return out.join("\n\n");
}

function extractSectionBody(content: string, heading: string): string {
  const esc = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = content.match(new RegExp(`^##\\s+${esc}\\s*$`, "m"));
  if (!m || m.index === undefined) return "(empty)";
  const start = m.index + m[0].length;
  const rest = content.slice(start);
  const next = rest.search(/^##\s+/m);
  const body = (next < 0 ? rest : rest.slice(0, next)).trim();
  return body || "(empty)";
}

/** Parse the H2 sections out of the LLM's returned fragment. */
function parseReturnedSections(out: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /^##\s+(.+?)\s*$/gm;
  const heads: Array<{ name: string; idx: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(out)) !== null) {
    heads.push({ name: m[1].trim(), idx: m.index, end: m.index + m[0].length });
  }
  for (let i = 0; i < heads.length; i++) {
    const bodyStart = heads[i].end;
    const bodyEnd = i + 1 < heads.length ? heads[i + 1].idx : out.length;
    map.set(heads[i].name, out.slice(bodyStart, bodyEnd).replace(/^\s*\n/, "").trimEnd());
  }
  return map;
}
