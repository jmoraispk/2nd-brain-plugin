import {
  App,
  MarkdownRenderer,
  Component,
  Notice,
  TFile,
  TFolder,
} from "obsidian";
import SecondBrainPlugin from "../main";

/**
 * One entry in the period/anchor dropdown. Each maps to a built-in command
 * id, optionally with an anchor offset (today + offsetDays) or a special
 * "specific day" mode that reveals a date picker.
 */
interface SelectionOption {
  id: string;
  label: string;
  commandId: string;
  anchorOffsetDays?: number;
  needsSpecificDate?: boolean;
}

const SELECTION_OPTIONS: SelectionOption[] = [
  { id: "today", label: "Today's review", commandId: "todays-review" },
  {
    id: "yesterday",
    label: "Yesterday's review",
    commandId: "todays-review",
    anchorOffsetDays: -1,
  },
  {
    id: "specific",
    label: "Review a specific day…",
    commandId: "todays-review",
    needsSpecificDate: true,
  },
  { id: "plan", label: "Plan tomorrow", commandId: "plan-tomorrow" },
  { id: "this-week", label: "This week's review", commandId: "weeks-review" },
  { id: "last-week", label: "Last week's review", commandId: "review-last-week" },
  {
    id: "last-month",
    label: "Last month's review",
    commandId: "review-last-month",
  },
  {
    id: "last-quarter",
    label: "Last quarter's review",
    commandId: "review-last-quarter",
  },
  { id: "last-year", label: "Last year's review", commandId: "review-last-year" },
];

export interface ReviewTabState {
  selectionId: string;
  specificDate?: string;
  resultFile?: TFile;
  resultContent?: string;
  userReview: string;
}

export function defaultReviewTabState(): ReviewTabState {
  return { selectionId: "today", userReview: "" };
}

export interface ReviewTabCallbacks {
  setState: (changes: Partial<ReviewTabState>) => void;
  runSelection: (option: SelectionOption, anchorOverride?: string) => Promise<void>;
  finish: () => Promise<void>;
}

export function renderReview(
  parent: HTMLElement,
  plugin: SecondBrainPlugin,
  state: ReviewTabState,
  cb: ReviewTabCallbacks,
  viewComponent: Component
): void {
  const body = parent.createDiv({ cls: "second-brain-tab-body" });

  renderPicker(body, state, cb);
  if (state.resultContent && state.resultFile) {
    renderInlineResult(body, plugin, state, cb, viewComponent);
  }
  renderRecentReviewsSection(body, plugin);
}

function renderPicker(
  body: HTMLElement,
  state: ReviewTabState,
  cb: ReviewTabCallbacks
) {
  const sec = body.createDiv({ cls: "second-brain-section" });
  sec.createEl("h3", { text: "What to review" });

  const select = sec.createEl("select", { cls: "second-brain-select" });
  for (const opt of SELECTION_OPTIONS) {
    const o = select.createEl("option", { text: opt.label });
    o.value = opt.id;
    if (opt.id === state.selectionId) o.selected = true;
  }
  select.addEventListener("change", () => {
    cb.setState({ selectionId: select.value, resultFile: undefined, resultContent: undefined, userReview: "" });
  });

  const current = SELECTION_OPTIONS.find((o) => o.id === state.selectionId)!;

  // Date picker for "specific day"
  let pickedDate: string | undefined = state.specificDate;
  if (current.needsSpecificDate) {
    const dateInput = sec.createEl("input", {
      type: "date",
      cls: "second-brain-date-input",
    });
    if (state.specificDate) {
      dateInput.value = state.specificDate;
    } else {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      const v = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`;
      dateInput.value = v;
      pickedDate = v;
    }
    dateInput.addEventListener("change", () => {
      cb.setState({ specificDate: dateInput.value });
    });
  }

  const runBtn = sec.createEl("button", {
    text: "Run review",
    cls: "second-brain-button second-brain-button-primary",
  });
  runBtn.addEventListener("click", async () => {
    let anchor: string | undefined;
    if (current.needsSpecificDate) {
      anchor = pickedDate ?? state.specificDate;
      if (!anchor) {
        new Notice("Pick a date first.");
        return;
      }
    } else if (current.anchorOffsetDays !== undefined) {
      const d = new Date();
      d.setDate(d.getDate() + current.anchorOffsetDays);
      anchor = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
    await cb.runSelection(current, anchor);
  });
}

function renderInlineResult(
  body: HTMLElement,
  plugin: SecondBrainPlugin,
  state: ReviewTabState,
  cb: ReviewTabCallbacks,
  viewComponent: Component
) {
  const sec = body.createDiv({ cls: "second-brain-section" });
  sec.createEl("h3", { text: "AI summary" });

  const md = sec.createDiv({ cls: "second-brain-rendered-md" });
  // Cast to keep types happy across MarkdownRenderer API variants.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderer = (MarkdownRenderer as any).render
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (MarkdownRenderer as any).render
    : // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (MarkdownRenderer as any).renderMarkdown;
  renderer(
    plugin.app,
    state.resultContent ?? "",
    md,
    state.resultFile?.path ?? "",
    viewComponent
  );

  const reviewSec = body.createDiv({ cls: "second-brain-section" });
  reviewSec.createEl("h3", { text: "Your review" });
  reviewSec.createEl("p", {
    cls: "second-brain-muted",
    text: "Read the summary above and write your own reflection. Click Finish to append it to the review file under '## My review'.",
  });
  const ta = reviewSec.createEl("textarea", {
    cls: "second-brain-modal-textarea",
    attr: { placeholder: "Your reflection on this period…" },
  });
  ta.value = state.userReview;
  ta.addEventListener("input", () => {
    cb.setState({ userReview: ta.value });
  });

  const finishBtn = reviewSec.createEl("button", {
    text: "Finish & save",
    cls: "second-brain-button second-brain-button-primary",
  });
  finishBtn.addEventListener("click", () => cb.finish());
}

function renderRecentReviewsSection(
  body: HTMLElement,
  plugin: SecondBrainPlugin
) {
  const sec = body.createDiv({ cls: "second-brain-section" });
  sec.createEl("h3", { text: "Recent reviews" });

  const groups: Array<{ folder: string; label: string; limit: number }> = [
    { folder: "🤖 AI/Reviews/Daily", label: "Daily", limit: 5 },
    { folder: "🤖 AI/Reviews/Weekly", label: "Weekly", limit: 3 },
    { folder: "🤖 AI/Reviews/Monthly", label: "Monthly", limit: 2 },
    { folder: "🤖 AI/Reviews/Quarterly", label: "Quarterly", limit: 1 },
    { folder: "🤖 AI/Reviews/Yearly", label: "Yearly", limit: 1 },
  ];

  let any = false;
  const list = sec.createEl("ul", { cls: "second-brain-list" });
  for (const g of groups) {
    const files = filesIn(plugin, g.folder, g.limit);
    for (const f of files) {
      any = true;
      const li = list.createEl("li");
      const link = li.createEl("a", {
        text: `📄 ${g.label} ${f.basename}`,
        cls: "second-brain-link",
      });
      link.addEventListener("click", () =>
        plugin.app.workspace.getLeaf(false).openFile(f)
      );
    }
  }
  if (!any) {
    list.remove();
    sec.createEl("div", {
      cls: "second-brain-muted",
      text: "No reviews yet.",
    });
  }
}

function filesIn(
  plugin: SecondBrainPlugin,
  folderPath: string,
  limit: number
): TFile[] {
  const folder = plugin.app.vault.getAbstractFileByPath(folderPath);
  if (!(folder instanceof TFolder)) return [];
  return folder.children
    .filter((c): c is TFile => c instanceof TFile && c.name.endsWith(".md"))
    .sort((a, b) => b.stat.mtime - a.stat.mtime)
    .slice(0, limit);
}

/**
 * Append the user's review to the same file as the AI summary, under a
 * "## My review" heading. If a previous "My review" section exists, replace
 * it. Returns the file path so the caller can open it.
 */
export async function appendUserReview(
  app: App,
  file: TFile,
  userReview: string
): Promise<void> {
  const existing = await app.vault.read(file);
  const trimmed = userReview.trim();
  const sectionHeading = "## My review";
  const sectionRegex = /\n## My review\b[\s\S]*$/m;
  let next: string;
  const block = `\n\n${sectionHeading}\n\n${trimmed}\n`;
  if (sectionRegex.test(existing)) {
    next = existing.replace(sectionRegex, block);
  } else {
    next = existing.replace(/\s*$/, "") + block;
  }
  await app.vault.modify(file, next);
}

export { SELECTION_OPTIONS };
export type { SelectionOption };
