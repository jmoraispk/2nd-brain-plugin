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
import { anchorWeekDates, applyDatePlaceholders, todayISO } from "./paths";
import { ReviewTabState } from "./reviewTab";

export type ActivityMetric = "captures" | "words";
export type CalendarMode = "week" | "month";
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
  /** Underlined day; independent of the highlighted review range. */
  captureDate: string;
  calendarMode: CalendarMode;
  weekAnchor: string;
  calendarTap?: { date: string; time: number };
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
    captureDate: today,
    calendarMode: "month",
    weekAnchor: today,
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
  changeWeek: (date: string) => void;
  setCalendarMode: (mode: CalendarMode) => void;
  setCaptureDate: (date: string) => void;
  selectSingleDay: (date: string) => void;
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

  const bounds = calendarBounds(state);
  const months = [...new Set([bounds.start.slice(0, 7), bounds.end.slice(0, 7)])];
  const activity = (await Promise.all(months.map((month) => loadMonthActivity(plugin, month))))
    .flat().filter((day) => day.date >= bounds.start && day.date <= bounds.end);
  renderCapture(body, state, cb);
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
  section.createEl("h2", { text: `Capture · ${shortDateLabel(state.captureDate ?? todayISO())}` });

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
}

/** Route Obsidian's desktop Ctrl+Enter hotkey to the focused Capture box. */
export function submitFocusedSimplifiedCapture(
  document: Document
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
  button.click();
  return true;
}

/** Capture Ctrl+Enter before Obsidian's document-level key routing. */
export function registerSimplifiedCaptureHotkey(
  plugin: Plugin,
  isDesktop = Platform.isDesktopApp
): void {
  if (!isDesktop) return;
  const document = plugin.app.workspace.containerEl.ownerDocument;
  const window = document.defaultView;
  if (!window) return;
  plugin.registerDomEvent(
    window,
    "keydown",
    (event) => {
      if (
        !event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        event.repeat ||
        (event.key !== "Enter" && event.code !== "NumpadEnter")
      ) {
        return;
      }
      if (!submitFocusedSimplifiedCapture(document)) return;
      event.preventDefault();
      event.stopPropagation();
    },
    { capture: true }
  );
}

export function calendarBounds(state: Pick<SimplifiedDashboardState, "month" | "calendarMode" | "weekAnchor">): { start: string; end: string } {
  if (state.calendarMode === "week") {
    const dates = anchorWeekDates(state.weekAnchor);
    return { start: dates[0], end: dates[6] };
  }
  return { start: `${state.month}-01`, end: monthEnd(state.month) };
}

export function selectCalendarDay(state: SimplifiedDashboardState, date: string, both = false): void {
  if (both) {
    state.captureDate = date;
    state.rangeStart = date;
    state.rangeEnd = date;
    state.rangeAnchor = undefined;
  } else if (!state.rangeAnchor) {
    state.rangeStart = date;
    state.rangeEnd = date;
    state.rangeAnchor = date;
  } else {
    state.rangeStart = state.rangeAnchor < date ? state.rangeAnchor : date;
    state.rangeEnd = state.rangeAnchor < date ? date : state.rangeAnchor;
    state.rangeAnchor = undefined;
  }
}

/** Share tap history across renders so the second tap can land on a rebuilt cell. */
export function bindCalendarDayGestures(
  cell: HTMLButtonElement,
  date: string,
  state: Pick<SimplifiedDashboardState, "calendarTap">,
  cb: Pick<SimplifiedDashboardCallbacks, "selectCalendarDate" | "setCaptureDate" | "selectSingleDay">
): void {
  let pointer: number | undefined;
  let origin: { x: number; y: number } | undefined;
  let suppressClick = false;
  let doubleHandled = false;
  const press = createLongPressController(() => {
    suppressClick = true;
    state.calendarTap = undefined;
    cb.setCaptureDate(date);
  });
  const cancel = () => { press.cancel(); pointer = undefined; origin = undefined; };
  cell.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    suppressClick = false;
    doubleHandled = false;
    pointer = event.pointerId;
    origin = { x: event.clientX, y: event.clientY };
    cell.setPointerCapture(pointer);
    press.start();
  });
  cell.addEventListener("pointermove", (event) => {
    if (pointer !== event.pointerId || !origin) return;
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10) {
      suppressClick = true;
      cancel();
    }
  });
  cell.addEventListener("pointerup", (event) => {
    if (pointer !== event.pointerId) return;
    const bounds = cell.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
      suppressClick = true;
    }
    press.finish();
    cancel();
    if (cell.hasPointerCapture(event.pointerId)) cell.releasePointerCapture(event.pointerId);
  });
  cell.addEventListener("pointercancel", () => { suppressClick = true; cancel(); });
  cell.addEventListener("lostpointercapture", cancel);
  cell.addEventListener("contextmenu", (event) => event.preventDefault());
  cell.addEventListener("click", (event) => {
    if (suppressClick) { suppressClick = false; event.preventDefault(); return; }
    const now = Date.now();
    if (event.detail !== 0 && state.calendarTap?.date === date && now - state.calendarTap.time < 400) {
      state.calendarTap = undefined;
      doubleHandled = true;
      cb.selectSingleDay(date);
    } else {
      state.calendarTap = event.detail === 0 ? undefined : { date, time: now };
      cb.selectCalendarDate(date);
    }
  });
  cell.addEventListener("dblclick", (event) => {
    event.preventDefault();
    if (doubleHandled) return;
    state.calendarTap = undefined;
    cb.selectSingleDay(date);
  });
  cell.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      cb.setCaptureDate(date);
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
  renderChoiceControl(header, state.calendarMode ?? "month", [
    ["week", "Week"], ["month", "Month"],
  ], cb.setCalendarMode, "Calendar view", "second-brain-calendar-mode");
  const bounds = calendarBounds(state);
  const isWeek = state.calendarMode === "week";
  const monthNav = header.createDiv({ cls: "second-brain-month-nav" });
  const previous = monthNav.createEl("button", {
    text: "‹",
    cls: "second-brain-month-arrow",
    attr: { title: `Previous ${isWeek ? "week" : "month"}`, "aria-label": `Previous ${isWeek ? "week" : "month"}` },
  });
  previous.addEventListener("click", () => isWeek
    ? cb.changeWeek(shiftDay(state.weekAnchor, -7))
    : cb.changeMonth(shiftMonth(state.month, -1)));

  monthNav.createEl("h2", { text: isWeek ? dateRangeLabel(bounds.start, bounds.end) : monthLabel(state.month) });

  const next = monthNav.createEl("button", {
    text: "›",
    cls: "second-brain-month-arrow",
    attr: { title: `Next ${isWeek ? "week" : "month"}`, "aria-label": `Next ${isWeek ? "week" : "month"}` },
  });
  const currentMonth = todayISO().slice(0, 7);
  if (isWeek ? bounds.end >= todayISO() : state.month >= currentMonth) {
    next.setAttribute("disabled", "true");
  } else {
    next.addEventListener("click", () => isWeek
      ? cb.changeWeek(shiftDay(state.weekAnchor, 7))
      : cb.changeMonth(shiftMonth(state.month, 1)));
  }

  renderActivityMetricControl(header, state.metric, cb.setMetric);
  section.createEl("p", { cls: "second-brain-calendar-hint", text: "Underline: capture day · Highlight: review range. Hold a day to capture; double-tap to select both." });

  const grid = section.createDiv({ cls: "second-brain-month-grid" });
  for (const label of ["M", "T", "W", "T", "F", "S", "S"]) {
    grid.createDiv({ cls: "second-brain-month-weekday", text: label });
  }

  const [year, month] = state.month.split("-").map(Number);
  const firstWeekday = isWeek ? 0 : (new Date(year, month - 1, 1).getDay() + 6) % 7;
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
        day.date === state.captureDate ? "is-capture-day" : "",
        day.date === today ? "is-today" : "",
      ]
        .filter(Boolean)
        .join(" "),
      attr: {
        "data-date": day.date,
        title: `${longDateLabel(day.date)}: ${day.captures} capture${
          day.captures === 1 ? "" : "s"
        }, ${day.words} word${day.words === 1 ? "" : "s"}`,
        "aria-label": `${longDateLabel(day.date)}, ${day.captures} captures, ${day.words} words${day.date === state.captureDate ? ", capture day" : ""}${inRange ? ", selected for review" : ""}. Hold or Shift+Enter to set capture day; double-click to select both.`,
      },
    });
    cell.createSpan({ cls: "second-brain-month-day-number", text: day.date.slice(-2).replace(/^0/, "") });
    cell.createSpan({ cls: "second-brain-month-day-value", text: String(value) });
    if (day.date > today) {
      cell.setAttribute("disabled", "true");
    } else {
      bindCalendarDayGestures(cell, day.date, state, cb);
    }
  }
}

export function renderActivityMetricControl(
  parent: HTMLElement,
  currentMetric: ActivityMetric,
  setMetric: (metric: ActivityMetric) => void
): HTMLButtonElement {
  return renderChoiceControl(parent, currentMetric, [["captures", "Captures"], ["words", "Words"]], setMetric, "Calendar activity metric");
}

function renderChoiceControl<T extends string>(
  parent: HTMLElement,
  current: T,
  choices: readonly (readonly [T, string])[],
  onChange: (value: T) => void,
  label: string,
  extraClass = ""
): HTMLButtonElement {
  const nextValue = () => choices[(choices.findIndex(([value]) => value === current) + 1) % choices.length][0];
  const currentLabel = choices.find(([value]) => value === current)![1];
  const metric = parent.createEl("button", {
    text: currentLabel,
    cls: `second-brain-simple-metric ${extraClass}`.trim(),
    attr: {
      type: "button",
      title: `Click to switch ${label.toLowerCase()}. Hold to choose.`,
      "aria-label": `${label}: ${currentLabel}. Press Enter or Space to switch; press Arrow Down to choose.`,
      "aria-haspopup": "menu",
      "aria-expanded": "false",
    },
  });

  const showMetricMenu = () => {
    if (metric.getAttribute("aria-expanded") === "true") return;
    metric.setAttribute("aria-expanded", "true");

    const menu = new Menu().setNoIcon();
    for (const [value, label] of choices) {
      menu.addItem((item) =>
        item
          .setTitle(label)
          .setChecked(value === current)
          .onClick(() => onChange(value))
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
      onChange(nextValue());
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
      onChange(nextValue());
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
  section.createEl("h2", { text: `Review · ${dateRangeLabel(state.rangeStart, state.rangeEnd)}` });

  const dates = section.createDiv({ cls: "second-brain-simple-range" });
  renderDateInput(dates, "From", state.rangeStart, state, (value) =>
    cb.setRangeStart(value)
  );
  renderDateInput(dates, "To", state.rangeEnd, state, (value) =>
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
  state: SimplifiedDashboardState,
  onChange: (value: string) => void
) {
  const wrap = parent.createEl("label", { cls: "second-brain-simple-date-field" });
  wrap.createSpan({ text: label });
  const input = wrap.createEl("input", { type: "date" });
  input.value = value;
  const bounds = calendarBounds(state);
  input.min = bounds.start;
  input.max = bounds.end > todayISO() ? todayISO() : bounds.end;
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

export function shiftDay(date: string, amount: number): string {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + amount);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function shortDateLabel(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    month: "short", day: "numeric",
    ...(date.slice(0, 4) !== todayISO().slice(0, 4) ? { year: "numeric" } : {}),
  });
}

function dateRangeLabel(start: string, end: string): string {
  return start === end ? shortDateLabel(start) : `${shortDateLabel(start)}–${shortDateLabel(end)}`;
}
