import {
  Component,
  MarkdownRenderer,
  Menu,
  Platform,
  setIcon,
  TFile,
  TFolder,
  type Plugin,
} from "obsidian";
import SecondBrainPlugin from "../main";
import { loadDaytraceReviewSource } from "./daytraceReview";
import { applyDatePlaceholders, todayISO } from "./paths";
import { ReviewTabState } from "./reviewTab";

export type ActivityMetric = "captures" | "words";
export type SimplifiedOperation = "activity" | "review";

export function nextActivityMetric(metric: ActivityMetric): ActivityMetric {
  return metric === "captures" ? "words" : "captures";
}

export type MetricPressResult = "short" | "long" | "none";

export interface LongPressController {
  start: () => void;
  finish: () => MetricPressResult;
  cancel: () => void;
}

export function createLongPressController(
  onLongPress: () => void,
  delay = 500
): LongPressController {
  let state: "idle" | "pressing" | "long" = "idle";
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clearTimer = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };

  return {
    start: () => {
      clearTimer();
      state = "pressing";
      timer = setTimeout(() => {
        timer = undefined;
        state = "long";
        onLongPress();
      }, delay);
    },
    finish: () => {
      if (state === "idle") return "none";
      const result = state === "long" ? "long" : "short";
      clearTimer();
      state = "idle";
      return result;
    },
    cancel: () => {
      clearTimer();
      state = "idle";
    },
  };
}

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
  fetchActivity: () => Promise<void>;
  startCaptureCall: () => void;
  changeMonth: (month: string) => void;
  selectCalendarDate: (date: string) => void;
  setRangeStart: (date: string) => void;
  setRangeEnd: (date: string) => void;
  setMetric: (metric: ActivityMetric) => void;
  runReview: () => Promise<void>;
  setUserReview: (value: string) => void;
  finishReview: () => Promise<void>;
  startReviewCall: () => void;
  openResult: (file: TFile) => void;
}

interface DayActivity {
  date: string;
  captures: number;
  words: number;
  hasActivitySummary: boolean;
}

export async function renderSimplifiedDashboard(
  parent: HTMLElement,
  plugin: SecondBrainPlugin,
  state: SimplifiedDashboardState,
  reviewState: ReviewTabState,
  cb: SimplifiedDashboardCallbacks,
  viewComponent: Component,
  activeOperation?: SimplifiedOperation
): Promise<void> {
  const body = parent.createDiv({ cls: "second-brain-simple" });
  renderCapture(body, state, cb);

  const activity = await loadMonthActivity(plugin, state.month);
  renderMonthMap(body, state, activity, cb);
  renderRangeReview(
    body,
    state,
    activity,
    reviewState,
    cb,
    plugin,
    viewComponent,
    activeOperation
  );
  body.createDiv({
    cls: "second-brain-simple-bottom-gap",
    attr: { "aria-hidden": "true" },
  });
}

export function renderCapture(
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
    cls: "second-brain-button second-brain-button-primary second-brain-simple-capture-submit",
  });
  renderCallButton(actions, "Talk through a capture", cb.startCaptureCall);
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

/** Route Obsidian's desktop Ctrl+Enter hotkey to the focused Capture box. */
export function submitFocusedSimplifiedCapture(
  document: Document,
  checking = false
): boolean {
  const Textarea = document.defaultView?.HTMLTextAreaElement;
  const active = document.activeElement;
  if (
    !Textarea ||
    !(active instanceof Textarea) ||
    !active.classList.contains("second-brain-simple-capture-input") ||
    !active.value.trim()
  ) {
    return false;
  }
  const button = active
    .closest(".second-brain-simple-capture")
    ?.querySelector<HTMLButtonElement>(".second-brain-simple-capture-submit");
  if (!button || button.hasAttribute("disabled")) return false;
  if (!checking) button.click();
  return true;
}

/** Register the Obsidian-level shortcut that survives desktop key routing. */
export function registerSimplifiedCaptureHotkey(
  plugin: Plugin,
  isDesktop = Platform.isDesktopApp
): void {
  if (!isDesktop) return;
  plugin.addCommand({
    id: "submit-focused-capture",
    name: "Submit focused capture",
    hotkeys: [{ modifiers: ["Ctrl"], key: "Enter" }],
    checkCallback: (checking) =>
      submitFocusedSimplifiedCapture(
        plugin.app.workspace.containerEl.ownerDocument,
        checking
      ),
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
  const monthNav = header.createDiv({ cls: "second-brain-month-nav" });
  const previous = monthNav.createEl("button", {
    text: "‹",
    cls: "second-brain-month-arrow",
    attr: { title: "Previous month", "aria-label": "Previous month" },
  });
  previous.addEventListener("click", () => cb.changeMonth(shiftMonth(state.month, -1)));

  monthNav.createEl("h2", { text: monthLabel(state.month) });

  const next = monthNav.createEl("button", {
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

  renderActivityMetricControl(header, state.metric, cb.setMetric);

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

export function renderActivityMetricControl(
  parent: HTMLElement,
  currentMetric: ActivityMetric,
  setMetric: (metric: ActivityMetric) => void
): HTMLButtonElement {
  const metric = parent.createEl("button", {
    text: currentMetric === "captures" ? "Captures" : "Words",
    cls: "second-brain-simple-metric",
    attr: {
      type: "button",
      title: "Click to switch metric. Hold to choose.",
      "aria-label": `Calendar activity metric: ${
        currentMetric === "captures" ? "Captures" : "Words"
      }. Press Enter or Space to switch; press Arrow Down to choose.`,
      "aria-haspopup": "menu",
      "aria-expanded": "false",
    },
  });

  const showMetricMenu = () => {
    if (metric.getAttribute("aria-expanded") === "true") return;
    metric.setAttribute("aria-expanded", "true");

    const menu = new Menu().setNoIcon();
    for (const [value, label] of [
      ["captures", "Captures"],
      ["words", "Words"],
    ] as const) {
      menu.addItem((item) =>
        item
          .setTitle(label)
          .setChecked(value === currentMetric)
          .onClick(() => setMetric(value))
      );
    }
    menu.onHide(() => {
      if (!metric.isConnected) return;
      metric.setAttribute("aria-expanded", "false");
      metric.focus();
    });

    const bounds = metric.getBoundingClientRect();
    menu.showAtPosition(
      { x: bounds.left, y: bounds.bottom + 4, width: bounds.width, overlap: true },
      metric.ownerDocument
    );
  };

  const press = createLongPressController(showMetricMenu);
  let activePointerId: number | undefined;
  let pressOrigin: { x: number; y: number } | undefined;
  let suppressPostLongPressClick = false;

  const cancelPress = () => {
    activePointerId = undefined;
    pressOrigin = undefined;
    press.cancel();
  };

  metric.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    activePointerId = event.pointerId;
    pressOrigin = { x: event.clientX, y: event.clientY };
    metric.setPointerCapture(event.pointerId);
    press.start();
  });
  metric.addEventListener("pointermove", (event) => {
    if (event.pointerId !== activePointerId || !pressOrigin) return;
    if (Math.hypot(event.clientX - pressOrigin.x, event.clientY - pressOrigin.y) <= 10) {
      return;
    }
    const pointerId = activePointerId;
    cancelPress();
    if (pointerId !== undefined && metric.hasPointerCapture(pointerId)) {
      metric.releasePointerCapture(pointerId);
    }
  });
  metric.addEventListener("pointerup", (event) => {
    if (event.pointerId !== activePointerId) return;
    const bounds = metric.getBoundingClientRect();
    const releasedInside =
      event.clientX >= bounds.left &&
      event.clientX <= bounds.right &&
      event.clientY >= bounds.top &&
      event.clientY <= bounds.bottom;
    activePointerId = undefined;
    pressOrigin = undefined;
    if (metric.hasPointerCapture(event.pointerId)) {
      metric.releasePointerCapture(event.pointerId);
    }
    if (!releasedInside) {
      press.cancel();
      return;
    }
    const result = press.finish();
    if (result === "long") {
      suppressPostLongPressClick = true;
      setTimeout(() => {
        suppressPostLongPressClick = false;
      }, 0);
    } else if (result === "short") {
      setMetric(nextActivityMetric(currentMetric));
    }
  });
  metric.addEventListener("pointercancel", (event) => {
    if (event.pointerId !== activePointerId) return;
    cancelPress();
  });
  metric.addEventListener("lostpointercapture", (event) => {
    if (event.pointerId !== activePointerId) return;
    cancelPress();
  });
  metric.addEventListener("click", (event) => {
    if (suppressPostLongPressClick) {
      suppressPostLongPressClick = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.detail === 0) {
      setMetric(nextActivityMetric(currentMetric));
    }
  });
  metric.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    showMetricMenu();
  });
  metric.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  return metric;
}

function renderRangeReview(
  body: HTMLElement,
  state: SimplifiedDashboardState,
  activity: DayActivity[],
  reviewState: ReviewTabState,
  cb: SimplifiedDashboardCallbacks,
  plugin: SecondBrainPlugin,
  viewComponent: Component,
  activeOperation?: SimplifiedOperation
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
  const hasReviewSources =
    captures > 0 || selected.some((day) => day.hasActivitySummary);
  section.createEl("p", {
    cls: "second-brain-simple-range-summary",
    text: `${captures} capture${captures === 1 ? "" : "s"} · ${words} word${
      words === 1 ? "" : "s"
    } selected`,
  });

  const reviewActions = section.createDiv({ cls: "second-brain-simple-actions" });
  const activityButton = createActivityButton(reviewActions);
  const run = reviewActions.createEl("button", {
    text: "Review",
    cls: "second-brain-button second-brain-button-primary second-brain-simple-review-button second-brain-simple-review-run",
  });
  if (!hasReviewSources || activeOperation) run.setAttribute("disabled", "true");
  if (activeOperation === "review") run.setText("Reviewing…");
  if (activeOperation) activityButton?.setAttribute("disabled", "true");
  if (activeOperation === "activity" && activityButton) {
    activityButton.setAttribute("aria-busy", "true");
    activityButton.classList.add("is-loading");
    setIcon(activityButton, "loader-circle");
  }
  let operationRunning = Boolean(activeOperation);
  activityButton?.addEventListener("click", async () => {
    if (operationRunning) return;
    operationRunning = true;
    activityButton.setAttribute("disabled", "true");
    activityButton.setAttribute("aria-busy", "true");
    activityButton.classList.add("is-loading");
    setIcon(activityButton, "loader-circle");
    run.setAttribute("disabled", "true");
    try {
      await cb.fetchActivity();
    } finally {
      operationRunning = false;
      activityButton.removeAttribute("disabled");
      activityButton.removeAttribute("aria-busy");
      activityButton.classList.remove("is-loading");
      setIcon(activityButton, "activity");
      if (hasReviewSources) run.removeAttribute("disabled");
    }
  });
  run.addEventListener("click", async () => {
    if (operationRunning || run.hasAttribute("disabled")) return;
    operationRunning = true;
    run.setAttribute("disabled", "true");
    activityButton?.setAttribute("disabled", "true");
    run.setText("Reviewing…");
    try {
      await cb.runReview();
    } finally {
      operationRunning = false;
      run.removeAttribute("disabled");
      activityButton?.removeAttribute("disabled");
      run.setText("Review");
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

  const reflectionActions = section.createDiv({ cls: "second-brain-simple-actions" });
  const finish = reflectionActions.createEl("button", {
    text: "Save reflection",
    cls: "second-brain-button second-brain-button-primary second-brain-simple-review-button",
  });
  finish.addEventListener("click", () => void cb.finishReview());
  renderCallButton(reflectionActions, "Talk through this review", cb.startReviewCall);
}

function createActivityButton(parent: HTMLElement): HTMLButtonElement | undefined {
  if (!Platform.isDesktopApp) return undefined;
  const activity = parent.createEl("button", {
    cls: "second-brain-simple-activity-button",
    attr: {
      type: "button",
      "data-action": "activity",
      title: "Fetch ActivityWatch for the selected dates",
      "aria-label": "Fetch ActivityWatch for the selected dates",
    },
  });
  setIcon(activity, "activity");
  return activity;
}

function renderCallButton(
  parent: HTMLElement,
  label: string,
  startCall: () => void
) {
  const button = parent.createEl("button", {
    cls: "second-brain-simple-call-button",
    attr: { type: "button", title: label, "aria-label": label },
  });
  setIcon(button, "phone");
  button.addEventListener("click", startCall);
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
    const activitySummary = await loadDaytraceReviewSource(plugin.app, date);
    const templatePath = applyDatePlaceholders(
      plugin.settings.dailyLogPathTemplate,
      date
    );
    const templateFile = plugin.app.vault.getAbstractFileByPath(templatePath);
    const file = filesByDate.get(date) ?? templateFile;
    if (!(file instanceof TFile)) {
      activity.push({
        date,
        captures: 0,
        words: 0,
        hasActivitySummary: Boolean(activitySummary),
      });
      continue;
    }
    const content = await plugin.app.vault.cachedRead(file);
    activity.push({
      date,
      ...captureStats(content),
      hasActivitySummary: Boolean(activitySummary),
    });
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
  return new Date(year, monthNumber - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function longDateLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}
