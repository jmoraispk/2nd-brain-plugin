/**
 * In-plugin error log (v0.8.3). Errors that previously got swallowed into a
 * Notice (which auto-dismisses) now also push into this ring buffer so the
 * user can open a logs panel later and copy the full message + stack to
 * report it. The buffer is in-memory only — cleared on plugin reload.
 */

import { App, Modal, Notice } from "obsidian";

export interface ErrorLogEntry {
  ts: string;
  tag: string;
  message: string;
  stack?: string;
}

export class ErrorLog {
  private entries: ErrorLogEntry[] = [];
  private readonly maxEntries = 100;
  private listeners: Array<() => void> = [];

  push(tag: string, err: unknown) {
    const e =
      err instanceof Error
        ? err
        : new Error(typeof err === "string" ? err : JSON.stringify(err));
    const entry: ErrorLogEntry = {
      ts: new Date().toISOString(),
      tag,
      message: e.message,
      stack: e.stack,
    };
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) this.entries.shift();
    // Mirror to console for `developer tools` users.
    // eslint-disable-next-line no-console
    console.error(`[sb:${tag}]`, err);
    for (const l of this.listeners) l();
  }

  clear() {
    this.entries = [];
    for (const l of this.listeners) l();
  }

  count(): number {
    return this.entries.length;
  }

  /** Newest-first copy of all entries. */
  all(): ErrorLogEntry[] {
    return [...this.entries].reverse();
  }

  onChange(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }
}

/**
 * Modal that lists the error log entries with Copy-all and Clear actions.
 * Reuses the capture-modal class so it's anchored near the top of the
 * screen on mobile.
 */
export class LogsModal extends Modal {
  private readonly log: ErrorLog;

  constructor(app: App, log: ErrorLog) {
    super(app);
    this.log = log;
    this.modalEl.addClass("second-brain-capture-modal");
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    const header = contentEl.createDiv({ cls: "second-brain-capture-header" });
    header.createEl("h2", {
      text: "Logs",
      cls: "second-brain-capture-title",
    });
    const closeBtn = header.createEl("button", {
      text: "✕",
      cls: "second-brain-capture-close",
      attr: { title: "Close" },
    });
    closeBtn.addEventListener("click", () => this.close());

    const entries = this.log.all();
    if (entries.length === 0) {
      contentEl.createEl("div", {
        cls: "second-brain-muted",
        text: "No errors logged this session. 🎉",
      });
      return;
    }

    contentEl.createEl("div", {
      cls: "second-brain-muted",
      text: `${entries.length} entr${entries.length === 1 ? "y" : "ies"} (newest first). Cleared on plugin reload.`,
    });

    const list = contentEl.createEl("div", { cls: "second-brain-logs-list" });
    for (const e of entries) {
      const item = list.createEl("div", { cls: "second-brain-logs-item" });
      const head = item.createDiv({ cls: "second-brain-logs-head" });
      head.createEl("span", {
        text: shortTimestamp(e.ts),
        cls: "second-brain-logs-ts",
      });
      head.createEl("span", { text: e.tag, cls: "second-brain-logs-tag" });
      item.createEl("div", { text: e.message, cls: "second-brain-logs-msg" });
      if (e.stack) {
        const detail = item.createEl("details");
        detail.createEl("summary", { text: "stack" });
        detail.createEl("pre", {
          text: e.stack,
          cls: "second-brain-logs-stack",
        });
      }
    }

    const actions = contentEl.createDiv({ cls: "second-brain-modal-actions" });

    const copyBtn = actions.createEl("button", {
      text: "Copy all",
      cls: "second-brain-modal-save",
    });
    copyBtn.addEventListener("click", async () => {
      const txt = entries
        .map((e) => `[${e.ts}] ${e.tag}: ${e.message}${e.stack ? "\n" + e.stack : ""}`)
        .join("\n\n");
      await navigator.clipboard.writeText(txt);
      new Notice("Copied logs to clipboard.");
    });

    const clearBtn = actions.createEl("button", {
      text: "Clear",
      cls: "second-brain-modal-cancel",
    });
    clearBtn.addEventListener("click", () => {
      this.log.clear();
      this.close();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

function shortTimestamp(iso: string): string {
  // 2026-05-17T13:57:48.123Z → 13:57:48
  const m = iso.match(/T(\d{2}:\d{2}:\d{2})/);
  return m ? m[1] : iso;
}
