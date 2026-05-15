import {
  App,
  MarkdownRenderer,
  Component,
  Notice,
  TFile,
  TFolder,
} from "obsidian";
import SecondBrainPlugin from "../main";

export type Timeframe = "day" | "week" | "month" | "quarter" | "year";
export type PeriodMode = "current" | "last" | "specific" | "plan";

export interface ReviewTabState {
  timeframe: Timeframe;
  period: PeriodMode;
  specificDate?: string;
  resultFile?: TFile;
  resultContent?: string;
  userReview: string;
}

export function defaultReviewTabState(): ReviewTabState {
  return {
    timeframe: "day",
    period: "current",
    userReview: "",
  };
}

/** Period modes available for each timeframe. */
const PERIOD_MODES: Record<Timeframe, PeriodMode[]> = {
  day: ["current", "last", "specific", "plan"],
  week: ["current", "last", "specific"],
  month: ["last", "specific"],
  quarter: ["last", "specific"],
  year: ["last", "specific"],
};

function periodModeLabel(timeframe: Timeframe, mode: PeriodMode): string {
  if (mode === "specific") return "Specific date…";
  if (mode === "plan") return "Plan tomorrow";
  if (mode === "current") {
    return timeframe === "day" ? "Today" : "This week";
  }
  if (mode === "last") {
    return timeframe === "day"
      ? "Yesterday"
      : timeframe === "week"
      ? "Last week"
      : timeframe === "month"
      ? "Last month"
      : timeframe === "quarter"
      ? "Last quarter"
      : "Last year";
  }
  return mode;
}

/**
 * Translate (timeframe, period, specificDate) into the built-in command id
 * + optional anchor override that runs it. Returns null for invalid combos.
 */
export function resolveSelection(
  state: Pick<ReviewTabState, "timeframe" | "period" | "specificDate">
): { commandId: string; anchorOverride?: string } | null {
  const { timeframe, period, specificDate } = state;
  const todayISO = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const yesterdayISO = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();

  if (timeframe === "day") {
    if (period === "current") return { commandId: "todays-review" };
    if (period === "last")
      return { commandId: "todays-review", anchorOverride: yesterdayISO };
    if (period === "plan") return { commandId: "plan-tomorrow" };
    if (period === "specific" && specificDate)
      return { commandId: "todays-review", anchorOverride: specificDate };
    return null;
  }
  if (timeframe === "week") {
    if (period === "current") return { commandId: "weeks-review" };
    if (period === "last") return { commandId: "review-last-week" };
    if (period === "specific" && specificDate)
      return { commandId: "review-anchor-week", anchorOverride: specificDate };
    return null;
  }
  if (timeframe === "month") {
    if (period === "last") return { commandId: "review-last-month" };
    if (period === "specific" && specificDate)
      return { commandId: "review-anchor-month", anchorOverride: specificDate };
    return null;
  }
  if (timeframe === "quarter") {
    if (period === "last") return { commandId: "review-last-quarter" };
    if (period === "specific" && specificDate)
      return {
        commandId: "review-anchor-quarter",
        anchorOverride: specificDate,
      };
    return null;
  }
  if (timeframe === "year") {
    if (period === "last") return { commandId: "review-last-year" };
    if (period === "specific" && specificDate)
      return { commandId: "review-anchor-year", anchorOverride: specificDate };
    return null;
  }
  return null;
}

export interface ReviewTabCallbacks {
  setState: (changes: Partial<ReviewTabState>) => void;
  /** Updates state.userReview WITHOUT triggering a re-render — preserves focus on typing. */
  setUserReview: (text: string) => void;
  runSelection: (commandId: string, anchorOverride?: string) => Promise<void>;
  finish: () => Promise<void>;
  /** Returns true if a file at `path` exists in the vault. Used for the "already reviewed" warning. */
  fileExists: (path: string) => boolean;
  /** Returns the resolved target path for the current picker selection (or null). */
  targetPathForSelection: (
    commandId: string,
    anchorOverride?: string
  ) => string | null;
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

  // Timeframe dropdown.
  const tfRow = sec.createDiv({ cls: "second-brain-picker-row" });
  tfRow.createEl("label", {
    text: "Timeframe",
    cls: "second-brain-picker-label",
  });
  const tfSelect = tfRow.createEl("select", { cls: "second-brain-select" });
  for (const tf of ["day", "week", "month", "quarter", "year"] as Timeframe[]) {
    const o = tfSelect.createEl("option", { text: tf[0].toUpperCase() + tf.slice(1) });
    o.value = tf;
    if (tf === state.timeframe) o.selected = true;
  }
  tfSelect.addEventListener("change", () => {
    const next = tfSelect.value as Timeframe;
    const validModes = PERIOD_MODES[next];
    const nextPeriod = validModes.includes(state.period)
      ? state.period
      : validModes[0];
    cb.setState({
      timeframe: next,
      period: nextPeriod,
      resultFile: undefined,
      resultContent: undefined,
      userReview: "",
    });
  });

  // Period dropdown — varies by timeframe.
  const pRow = sec.createDiv({ cls: "second-brain-picker-row" });
  pRow.createEl("label", {
    text: "Period",
    cls: "second-brain-picker-label",
  });
  const pSelect = pRow.createEl("select", { cls: "second-brain-select" });
  for (const mode of PERIOD_MODES[state.timeframe]) {
    const o = pSelect.createEl("option", {
      text: periodModeLabel(state.timeframe, mode),
    });
    o.value = mode;
    if (mode === state.period) o.selected = true;
  }
  pSelect.addEventListener("change", () => {
    cb.setState({
      period: pSelect.value as PeriodMode,
      resultFile: undefined,
      resultContent: undefined,
      userReview: "",
    });
  });

  // Date picker — visible only for "specific".
  if (state.period === "specific") {
    const dateInput = sec.createEl("input", {
      type: "date",
      cls: "second-brain-date-input",
    });
    if (state.specificDate) {
      dateInput.value = state.specificDate;
    } else {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      dateInput.value = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`;
      cb.setState({ specificDate: dateInput.value });
    }
    dateInput.addEventListener("change", () => {
      cb.setState({ specificDate: dateInput.value });
    });
  }

  // Warning when the AI review file already exists at the target.
  const resolvedNow = resolveSelection(state);
  if (resolvedNow) {
    const targetPath = cb.targetPathForSelection(
      resolvedNow.commandId,
      resolvedNow.anchorOverride
    );
    if (targetPath && cb.fileExists(targetPath)) {
      const warn = sec.createDiv({ cls: "second-brain-warning" });
      warn.setText(
        "⚠ Review already exists. Rerunning overwrites the AI summary and appends to your reflection."
      );
    }
  }

  const runBtn = sec.createEl("button", {
    text: "Run review",
    cls: "second-brain-button second-brain-button-primary",
  });
  runBtn.addEventListener("click", async () => {
    const resolved = resolveSelection(state);
    if (!resolved) {
      new Notice("Pick a date for 'Specific' first.");
      return;
    }
    await cb.runSelection(resolved.commandId, resolved.anchorOverride);
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
    cls: "second-brain-review-textarea",
    attr: { placeholder: "Your reflection on this period…", rows: "6" },
  });
  ta.value = state.userReview;
  // No-render write to avoid focus loss on every keystroke (Enter included).
  ta.addEventListener("input", () => cb.setUserReview(ta.value));

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
  // Walk recursively — daily reviews are nested under year/quarter/week from v0.6.4.
  const all: TFile[] = [];
  collectMarkdownFilesRecursively(folder, all);
  return all
    .sort((a, b) => b.stat.mtime - a.stat.mtime)
    .slice(0, limit);
}

function collectMarkdownFilesRecursively(folder: TFolder, out: TFile[]) {
  for (const child of folder.children) {
    if (child instanceof TFolder) {
      collectMarkdownFilesRecursively(child, out);
    } else if (child instanceof TFile && child.name.endsWith(".md")) {
      out.push(child);
    }
  }
}

/**
 * Derive the user-review file path from the AI review file path. The user
 * lives outside `🤖 AI/` so re-running the AI review never touches it.
 *
 * Mapping: `🤖 AI/Reviews/<rest>` → `Reviews/<rest>`. Reviews/ is a new
 * top-level user-owned folder mirroring the AI structure.
 */
export function userReviewPathFor(aiPath: string): string {
  const m = aiPath.match(/^🤖 AI\/Reviews\/(.+)$/);
  if (m) return `0. 🧑 Me/Reviews/${m[1]}`;
  // Fallback for any non-conforming AI path: keep filename, prefix Me/Reviews/
  return `0. 🧑 Me/Reviews/${aiPath.split("/").pop()}`;
}

/**
 * Write the user's reflection to its OWN file at the user-review path. Never
 * touches the AI review file — that one stays freely overwritable. If a
 * previous user review exists at the target path, it's replaced (whole file).
 */
/**
 * APPEND the user's review to their own file. Never overwrites existing
 * content — each Finish & save adds a new dated session block. This
 * upholds the invariant: AI never deletes from human files, only adds.
 */
export async function writeUserReview(
  app: App,
  aiFile: TFile,
  userReview: string,
  anchorDate: string,
  todayDate: string
): Promise<TFile> {
  const userPath = userReviewPathFor(aiFile.path);
  const dirPath = userPath.split("/").slice(0, -1).join("/");
  if (dirPath && !app.vault.getAbstractFileByPath(dirPath)) {
    await app.vault.createFolder(dirPath);
  }

  const session = `\n### Reviewed on ${todayDate}\n\n${userReview.trim()}\n`;
  const existing = app.vault.getAbstractFileByPath(userPath);

  if (existing instanceof TFile) {
    // Append a new dated session block; leave everything else intact.
    const current = await app.vault.read(existing);
    const next = current.replace(/\s*$/, "") + "\n" + session;
    await app.vault.modify(existing, next);
    return existing;
  }

  // Brand new user-review file. Frontmatter + an H1 + first session.
  const header = `---\nperiod-anchor: ${anchorDate}\nfirst-reviewed-on: ${todayDate}\nai-summary: "[[${aiFile.path}|AI summary]]"\n---\n\n# My Review — ${anchorDate}\n\n_File owned by you. The plugin only appends a new dated section on each Finish & save — it never overwrites or removes prior content._\n${session}`;
  return await app.vault.create(userPath, header);
}

/**
 * Map a built-in command id + optional anchor → Review-tab state, so the
 * Dashboard's pending-reviews banner can forward into the Review tab
 * pre-configured.
 */
export function mapCommandToReviewState(
  commandId: string,
  anchorOverride?: string
): Partial<ReviewTabState> | null {
  const yISO = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  switch (commandId) {
    case "todays-review":
      if (!anchorOverride) return { timeframe: "day", period: "current" };
      if (anchorOverride === yISO) return { timeframe: "day", period: "last" };
      return {
        timeframe: "day",
        period: "specific",
        specificDate: anchorOverride,
      };
    case "plan-tomorrow":
      return { timeframe: "day", period: "plan" };
    case "weeks-review":
      return { timeframe: "week", period: "current" };
    case "review-last-week":
      return { timeframe: "week", period: "last" };
    case "review-last-month":
      return { timeframe: "month", period: "last" };
    case "review-last-quarter":
      return { timeframe: "quarter", period: "last" };
    case "review-last-year":
      return { timeframe: "year", period: "last" };
    default:
      return null;
  }
}
