import { Component, MarkdownRenderer, TFile, TFolder } from "obsidian";
import SecondBrainPlugin from "../main";
import { applyDatePlaceholders, todayISO } from "./paths";
import { ReviewTabState } from "./reviewTab";

export type ActivityMetric = "captures" | "words";

export interface SimplifiedDashboardState {
  captureDraft: string;
  month: string;
  rangeStart: string;
  rangeEnd: string;
  /** First click in a two-click calendar range selection. */
  rangeAnchor?: string;
  metric: ActivityMetric;
}

export function defaultSimplifiedDashboardState(): SimplifiedDashboardState {
  const today = todayISO();
  return {
    captureDraft: "",
    month: today.slice(0, 7),
    rangeStart: today,
    rangeEnd: today,
    metric: "captures",
  };
}

export interface SimplifiedDashboardCallbacks {
  setCaptureDraft: (value: string) => void;
  saveCapture: (value: string) => Promise<void>;
  changeMonth: (month: string) => void;
  selectCalendarDate: (date: string) => void;
  setRangeStart: (date: string) => void;
  setRangeEnd: (date: string) => void;
  setMetric: (metric: ActivityMetric) => void;
  runReview: () => Promise<void>;
  setUserReview: (value: string) => void;
  finishReview: () => Promise<void>;
  openResult: (file: TFile) => void;
}

interface DayActivity {
  date: string;
  captures: number;
  words: number;
}

export async function renderSimplifiedDashboard(
  parent: HTMLElement,
  plugin: SecondBrainPlugin,
  state: SimplifiedDashboardState,
  reviewState: ReviewTabState,
  cb: SimplifiedDashboardCallbacks,
  viewComponent: Component
): Promise<void> {
  const body = parent.createDiv({ cls: "second-brain-simple" });
  renderCapture(body, state, cb);

  const activity = await loadMonthActivity(plugin, state.month);
  renderMonthMap(body, state, activity, cb);
  renderRangeReview(body, state, activity, reviewState, cb, plugin, viewComponent);
}

function renderCapture(
  body: HTMLElement,
  state: SimplifiedDashboardState,
  cb: SimplifiedDashboardCallbacks
) {
  const section = body.createDiv({
    cls: "second-brain-simple-card second-brain-simple-capture",
  });
  section.createEl("h2", { text: "Capture" });

  const textarea = section.createEl("textarea", {
    cls: "second-brain-simple-capture-input",
    attr: {
      placeholder: "What's on your mind?",
      rows: "5",
      "aria-label": "Capture note",
    },
  });
  textarea.value = state.captureDraft;
  textarea.addEventListener("input", () => cb.setCaptureDraft(textarea.value));

  const actions = section.createDiv({ cls: "second-brain-simple-actions" });
  const save = actions.createEl("button", {
    text: "Capture",
    cls: "second-brain-button second-brain-button-primary",
  });
  const submit = async () => {
    const content = textarea.value.trim();
    if (!content || save.hasAttribute("disabled")) return;
    save.setAttribute("disabled", "true");
    save.setText("Saving…");
    try {
      await cb.saveCapture(content);
    } finally {
      save.removeAttribute("disabled");
      save.setText("Capture");
    }
  };
  save.addEventListener("click", submit);
  textarea.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void submit();
    }
  });
}

function renderMonthMap(
  body: HTMLElement,
  state: SimplifiedDashboardState,
  activity: DayActivity[],
  cb: SimplifiedDashboardCallbacks
) {
  const section = body.createDiv({
    cls: "second-brain-simple-card second-brain-month-card",
  });

  const header = section.createDiv({ cls: "second-brain-month-header" });
  const previous = header.createEl("button", {
    text: "‹",
    cls: "second-brain-month-arrow",
    attr: { title: "Previous month", "aria-label": "Previous month" },
  });
  previous.addEventListener("click", () => cb.changeMonth(shiftMonth(state.month, -1)));

  header.createEl("h2", { text: monthLabel(state.month) });

  const metric = header.createEl("select", {
    cls: "second-brain-simple-metric",
    attr: {
      title: "Calendar activity metric",
      "aria-label": "Calendar activity metric",
    },
  });
  const capturesOption = metric.createEl("option", { text: "Captures" });
  capturesOption.value = "captures";
  const wordsOption = metric.createEl("option", { text: "Words" });
  wordsOption.value = "words";
  metric.value = state.metric;
  metric.addEventListener("change", () => cb.setMetric(metric.value as ActivityMetric));

  const next = header.createEl("button", {
    text: "›",
    cls: "second-brain-month-arrow",
    attr: { title: "Next month", "aria-label": "Next month" },
  });
  const currentMonth = todayISO().slice(0, 7);
  if (state.month >= currentMonth) {
    next.setAttribute("disabled", "true");
  } else {
    next.addEventListener("click", () => cb.changeMonth(shiftMonth(state.month, 1)));
  }

  const grid = section.createDiv({ cls: "second-brain-month-grid" });
  for (const label of ["M", "T", "W", "T", "F", "S", "S"]) {
    grid.createDiv({ cls: "second-brain-month-weekday", text: label });
  }

  const [year, month] = state.month.split("-").map(Number);
  const firstWeekday = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  for (let i = 0; i < firstWeekday; i++) {
    grid.createDiv({ cls: "second-brain-month-blank" });
  }

  const maxValue = Math.max(1, ...activity.map((day) => day[state.metric]));
  const today = todayISO();
  for (const day of activity) {
    const value = day[state.metric];
    const level = value === 0 ? 0 : Math.max(1, Math.ceil((value / maxValue) * 6));
    const inRange = day.date >= state.rangeStart && day.date <= state.rangeEnd;
    const cell = grid.createEl("button", {
      cls: [
        "second-brain-month-day",
        `level-${level}`,
        inRange ? "is-selected" : "",
        day.date === today ? "is-today" : "",
      ]
        .filter(Boolean)
        .join(" "),
      attr: {
        title: `${longDateLabel(day.date)}: ${day.captures} capture${
          day.captures === 1 ? "" : "s"
        }, ${day.words} word${day.words === 1 ? "" : "s"}`,
        "aria-label": `${longDateLabel(day.date)}, ${day.captures} captures, ${day.words} words`,
      },
    });
    cell.createSpan({ cls: "second-brain-month-day-number", text: day.date.slice(-2).replace(/^0/, "") });
    cell.createSpan({ cls: "second-brain-month-day-value", text: String(value) });
    if (day.date > today) {
      cell.setAttribute("disabled", "true");
    } else {
      cell.addEventListener("click", () => cb.selectCalendarDate(day.date));
    }
  }
}

function renderRangeReview(
  body: HTMLElement,
  state: SimplifiedDashboardState,
  activity: DayActivity[],
  reviewState: ReviewTabState,
  cb: SimplifiedDashboardCallbacks,
  plugin: SecondBrainPlugin,
  viewComponent: Component
) {
  const section = body.createDiv({
    cls: "second-brain-simple-card second-brain-simple-review",
  });
  section.createEl("h2", { text: "Review" });

  const dates = section.createDiv({ cls: "second-brain-simple-range" });
  renderDateInput(dates, "From", state.rangeStart, state.month, (value) =>
    cb.setRangeStart(value)
  );
  renderDateInput(dates, "To", state.rangeEnd, state.month, (value) =>
    cb.setRangeEnd(value)
  );

  const selected = activity.filter(
    (day) => day.date >= state.rangeStart && day.date <= state.rangeEnd
  );
  const captures = selected.reduce((sum, day) => sum + day.captures, 0);
  const words = selected.reduce((sum, day) => sum + day.words, 0);
  section.createEl("p", {
    cls: "second-brain-simple-range-summary",
    text: `${captures} capture${captures === 1 ? "" : "s"} · ${words} word${
      words === 1 ? "" : "s"
    } selected`,
  });

  const run = section.createEl("button", {
    text: "Review selected captures",
    cls: "second-brain-button second-brain-button-primary second-brain-simple-review-button",
  });
  if (captures === 0) run.setAttribute("disabled", "true");
  run.addEventListener("click", async () => {
    if (run.hasAttribute("disabled")) return;
    run.setAttribute("disabled", "true");
    run.setText("Reviewing…");
    try {
      await cb.runReview();
    } finally {
      run.removeAttribute("disabled");
      run.setText("Review selected captures");
    }
  });

  if (!reviewState.resultContent || !reviewState.resultFile) return;

  const resultHeader = section.createDiv({ cls: "second-brain-simple-result-header" });
  resultHeader.createEl("h3", { text: "Summary" });
  const open = resultHeader.createEl("button", {
    text: "Open note",
    cls: "second-brain-simple-open",
  });
  open.addEventListener("click", () => cb.openResult(reviewState.resultFile!));

  const markdown = section.createDiv({ cls: "second-brain-rendered-md second-brain-simple-result" });
  // Obsidian renamed renderMarkdown to render in newer releases; support both.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderer = (MarkdownRenderer as any).render
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (MarkdownRenderer as any).render
    : // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (MarkdownRenderer as any).renderMarkdown;
  renderer(
    plugin.app,
    reviewState.resultContent,
    markdown,
    reviewState.resultFile.path,
    viewComponent
  );

  section.createEl("h3", { text: "Your reflection" });
  const reflection = section.createEl("textarea", {
    cls: "second-brain-review-textarea",
    attr: { placeholder: "What do you notice after reading this?", rows: "6" },
  });
  reflection.value = reviewState.userReview;
  reflection.addEventListener("input", () => cb.setUserReview(reflection.value));

  const finish = section.createEl("button", {
    text: "Finish & save reflection",
    cls: "second-brain-button second-brain-button-primary second-brain-simple-review-button",
  });
  finish.addEventListener("click", () => void cb.finishReview());
}

function renderDateInput(
  parent: HTMLElement,
  label: string,
  value: string,
  month: string,
  onChange: (value: string) => void
) {
  const wrap = parent.createEl("label", { cls: "second-brain-simple-date-field" });
  wrap.createSpan({ text: label });
  const input = wrap.createEl("input", { type: "date" });
  input.value = value;
  input.min = `${month}-01`;
  input.max = month === todayISO().slice(0, 7) ? todayISO() : monthEnd(month);
  input.addEventListener("change", () => onChange(input.value));
}

async function loadMonthActivity(
  plugin: SecondBrainPlugin,
  month: string
): Promise<DayActivity[]> {
  const [year, monthNumber] = month.split("-").map(Number);
  const days = new Date(year, monthNumber, 0).getDate();
  const filesByDate = new Map<string, TFile>();
  const root = plugin.app.vault.getAbstractFileByPath(plugin.settings.logsFolder);
  if (root instanceof TFolder) {
    indexDailyFiles(root, month, filesByDate);
  }
  const activity: DayActivity[] = [];
  for (let day = 1; day <= days; day++) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const templatePath = applyDatePlaceholders(
      plugin.settings.dailyLogPathTemplate,
      date
    );
    const templateFile = plugin.app.vault.getAbstractFileByPath(templatePath);
    const file = filesByDate.get(date) ?? templateFile;
    if (!(file instanceof TFile)) {
      activity.push({ date, captures: 0, words: 0 });
      continue;
    }
    const content = await plugin.app.vault.cachedRead(file);
    activity.push({ date, ...captureStats(content) });
  }
  return activity;
}

function indexDailyFiles(
  folder: TFolder,
  month: string,
  filesByDate: Map<string, TFile>
) {
  for (const child of folder.children) {
    if (child instanceof TFolder) {
      indexDailyFiles(child, month, filesByDate);
    } else if (
      child instanceof TFile &&
      child.basename.startsWith(`${month}-`) &&
      /^\d{4}-\d{2}-\d{2}$/.test(child.basename) &&
      !filesByDate.has(child.basename)
    ) {
      filesByDate.set(child.basename, child);
    }
  }
}

function captureStats(content: string): Pick<DayActivity, "captures" | "words"> {
  const captures = [...content.matchAll(/^\[\d{2}:\d{2}\]\s*/gm)].length;
  const withoutStamps = content.replace(/^\[\d{2}:\d{2}\]\s*/gm, "");
  const words = withoutStamps.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)?.length ?? 0;
  return { captures, words };
}

function shiftMonth(month: string, amount: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(year, monthNumber - 1 + amount, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthEnd(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const day = new Date(year, monthNumber, 0).getDate();
  return `${month}-${String(day).padStart(2, "0")}`;
}

function monthLabel(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const shortMonth = new Date(year, monthNumber - 1, 1).toLocaleDateString(
    "en-US",
    { month: "short" }
  );
  return `${shortMonth} ’${String(year).slice(-2)}`;
}

function longDateLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}
