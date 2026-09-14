import { setIcon } from "obsidian";

export interface DashboardUtilityButtonActions {
  onRefresh: () => void;
  onHistory: () => void;
  onSettings: () => void;
}

/** Shared Refresh / History / Settings controls for both dashboard modes. */
export function renderDashboardUtilityButtons(
  parent: HTMLElement,
  actions: DashboardUtilityButtonActions
): void {
  const refresh = utilityButton(parent, "Refresh", "↻");
  refresh.addEventListener("click", actions.onRefresh);

  const history = utilityButton(parent, "Usage history");
  setIcon(history, "book-open");
  history.addEventListener("click", actions.onHistory);

  const settings = utilityButton(parent, "Settings", "⚙");
  settings.addEventListener("click", actions.onSettings);
}

function utilityButton(
  parent: HTMLElement,
  label: string,
  text?: string
): HTMLButtonElement {
  return parent.createEl("button", {
    ...(text === undefined ? {} : { text }),
    cls: "second-brain-iconbtn",
    attr: { title: label, "aria-label": label },
  });
}
