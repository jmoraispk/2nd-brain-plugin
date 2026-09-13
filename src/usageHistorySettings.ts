import { App, Modal, Notice } from "obsidian";
import type {
  UsageAccuracy,
  UsageHistoryEntry,
  UsageHistoryState,
  UsageInteractionGroup,
} from "./usageHistory";
import {
  MAX_VISIBLE_USAGE_INTERACTIONS,
  groupUsageInteractions,
  summarizeUsageWindows,
} from "./usageHistory";
import type { VapiReconcileResult } from "./vapiUsage";

interface UsageHistoryPlugin {
  app: App;
  usageHistory: { snapshot(): UsageHistoryState };
  refreshExactUsageCosts(): Promise<VapiReconcileResult>;
  clearUsageHistory(): Promise<void>;
}

export function formatUsageCost(
  knownCostUsd: number | undefined,
  accuracy: UsageAccuracy,
  hasUnpricedComponents: boolean
): string {
  if (knownCostUsd === undefined)
    return accuracy === "pending" ? "Pending" : "Unknown";
  const amount =
    knownCostUsd < 0.01
      ? `$${knownCostUsd.toFixed(4)}`
      : `$${knownCostUsd.toFixed(2)}`;
  return hasUnpricedComponents
    ? `${amount} + pending`
    : accuracy === "exact"
      ? amount
      : `≈${amount}`;
}

export function renderUsageHistory(
  containerEl: HTMLElement,
  plugin: UsageHistoryPlugin,
  statusMessage?: string
): void {
  containerEl.empty();
  const state = plugin.usageHistory.snapshot();
  const now = new Date();
  const summaries = summarizeUsageWindows(state.entries, now);
  const totals = containerEl.createDiv({ cls: "second-brain-history-totals" });

  for (const item of [
    { label: "Today", days: 1, summary: summaries.today },
    { label: "7 days", days: 7, summary: summaries.sevenDays },
    { label: "30 days", days: 30, summary: summaries.thirtyDays },
  ]) {
    const relevant = entriesFromLastDays(state.entries, now, item.days);
    const accuracy = aggregateAccuracy(relevant);
    const knownCost = relevant.some((entry) => entry.costUsd !== undefined)
      ? item.summary.knownCostUsd
      : relevant.length === 0
        ? 0
        : undefined;
    const card = totals.createDiv({ cls: "second-brain-history-total" });
    card.createSpan({ cls: "second-brain-history-total-label", text: item.label });
    card.createSpan({
      cls: "second-brain-history-total-cost",
      text: formatUsageCost(
        knownCost,
        accuracy,
        item.summary.hasUnpricedComponents
      ),
    });
  }

  containerEl.createDiv({
    cls: "second-brain-history-legend",
    text: "Exact · provider charge   Estimated · token-priced   Pending · awaiting desktop Vapi sync",
  });

  const interactions = groupUsageInteractions(state.entries).slice(
    0,
    MAX_VISIBLE_USAGE_INTERACTIONS
  );
  if (interactions.length === 0) {
    containerEl.createDiv({
      cls: "second-brain-muted",
      text: "No AI interactions recorded yet.",
    });
  } else {
    const list = containerEl.createDiv({ cls: "second-brain-history-list" });
    for (const interaction of interactions) renderInteraction(list, interaction);
  }

  const actions = containerEl.createDiv({ cls: "second-brain-history-actions" });
  const refreshButton = actions.createEl("button", {
    text: "Refresh exact costs",
  });
  refreshButton.addEventListener("click", () => {
    refreshButton.setAttribute("disabled", "true");
    void plugin
      .refreshExactUsageCosts()
      .then((result) => renderUsageHistory(containerEl, plugin, result.message))
      .catch(() =>
        renderUsageHistory(
          containerEl,
          plugin,
          "Cost refresh failed. Existing history was left unchanged."
        )
      );
  });

  const clearButton = actions.createEl("button", { text: "Clear history" });
  clearButton.addEventListener("click", () => {
    new ClearUsageHistoryModal(plugin.app, async () => {
      await plugin.clearUsageHistory();
      renderUsageHistory(containerEl, plugin, "History cleared.");
    }).open();
  });

  if (statusMessage) {
    containerEl.createDiv({
      cls: "second-brain-history-status",
      text: statusMessage,
    });
  }
}

export class ClearUsageHistoryModal extends Modal {
  constructor(
    app: App,
    private readonly onConfirm: () => void | Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "Clear usage history" });
    this.contentEl.createEl("p", {
      text: "Remove all locally stored cost metadata? This cannot be undone.",
    });
    const actions = this.contentEl.createDiv({ cls: "second-brain-modal-actions" });
    const cancel = actions.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    const confirm = actions.createEl("button", {
      text: "Clear history",
      cls: "mod-warning",
    });
    confirm.addEventListener("click", () => {
      confirm.setAttribute("disabled", "true");
      void Promise.resolve(this.onConfirm())
        .then(() => {
          new Notice("Usage history cleared.");
          this.close();
        })
        .catch(() => {
          confirm.removeAttribute("disabled");
          new Notice("Couldn't clear usage history.");
        });
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function renderInteraction(
  containerEl: HTMLElement,
  interaction: UsageInteractionGroup
): void {
  const row = containerEl.createEl("details", {
    cls: "second-brain-history-row",
  });
  const head = row.createEl("summary", {
    cls: "second-brain-history-head",
  });
  const identity = head.createDiv({ cls: "second-brain-history-identity" });
  identity.createSpan({
    cls: "second-brain-history-action",
    text: interaction.action,
  });
  identity.createSpan({
    cls: "second-brain-history-when",
    text: [
      formatDateTime(interaction.occurredAt),
      interaction.durationSeconds === undefined
        ? ""
        : formatDuration(interaction.durationSeconds),
    ]
      .filter(Boolean)
      .join(" · "),
  });
  const amount = head.createDiv({ cls: "second-brain-history-amount" });
  amount.createSpan({
    text: formatUsageCost(
      interaction.knownCostUsd,
      interaction.accuracy,
      interaction.hasUnpricedComponents
    ),
  });
  amount.createSpan({
    cls: `second-brain-history-accuracy is-${interaction.accuracy}`,
    text: capitalize(interaction.accuracy),
  });

  const breakdown = row.createDiv({ cls: "second-brain-history-breakdown" });
  for (const entry of interaction.entries) renderComponent(breakdown, entry);
}

function renderComponent(containerEl: HTMLElement, entry: UsageHistoryEntry): void {
  const component = containerEl.createDiv({ cls: "second-brain-history-component" });
  const head = component.createDiv({ cls: "second-brain-history-component-head" });
  head.createSpan({ text: componentLabel(entry) });
  head.createSpan({
    text: formatUsageCost(
      entry.costUsd,
      entry.accuracy,
      entry.costUsd === undefined &&
        (entry.accuracy === "pending" || entry.accuracy === "unknown")
    ),
  });

  if (entry.vapiBreakdown) {
    const labels: Array<[keyof typeof entry.vapiBreakdown, string]> = [
      ["transport", "Transport"],
      ["transcription", "Transcription"],
      ["model", "Model"],
      ["voice", "Voice"],
      ["platform", "Platform"],
    ];
    for (const [field, label] of labels) {
      const value = entry.vapiBreakdown[field];
      if (value === undefined) continue;
      component.createDiv({
        cls: "second-brain-history-detail",
        text: `${label} ${formatUsageCost(value, "exact", false)}`,
      });
    }
  }

  if (entry.usage) {
    const tokenParts = [
      tokenDetail("Input", entry.usage.inputTokens),
      tokenDetail("Cached", entry.usage.cachedInputTokens),
      tokenDetail("Output", entry.usage.outputTokens),
      tokenDetail("Reasoning", entry.usage.reasoningTokens),
    ].filter((part): part is string => Boolean(part));
    if (tokenParts.length) {
      component.createDiv({
        cls: "second-brain-history-detail",
        text: tokenParts.join(" · "),
      });
    }
  }
}

function componentLabel(entry: UsageHistoryEntry): string {
  if (entry.provider === "vapi") return "Vapi call";
  const provider = entry.provider === "openai" ? "OpenAI" : "Anthropic";
  return entry.model ? `${provider} · ${entry.model}` : provider;
}

function tokenDetail(label: string, value: number | undefined): string | undefined {
  return value === undefined ? undefined : `${label} ${value.toLocaleString()}`;
}

function formatDuration(seconds: number): string {
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function entriesFromLastDays(
  entries: UsageHistoryEntry[],
  now: Date,
  days: number
): UsageHistoryEntry[] {
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - (days - 1)
  );
  return entries.filter((entry) => new Date(entry.occurredAt) >= start);
}

function aggregateAccuracy(entries: UsageHistoryEntry[]): UsageAccuracy {
  if (entries.some((entry) => entry.accuracy === "pending")) return "pending";
  if (entries.some((entry) => entry.accuracy === "unknown")) return "unknown";
  if (entries.some((entry) => entry.accuracy === "estimated"))
    return "estimated";
  return "exact";
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
