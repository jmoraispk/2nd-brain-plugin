import { App, TFile } from "obsidian";
import type { SecondBrainSettings } from "./settings";
import type { VoiceCallMode } from "./voiceCallSupport";
import { anchorWeekDates, applyDatePlaceholders, toISO } from "./paths";
import {
  VOICE_MEMORY_PATH, VOICE_MEMORY_PROMPT, extractVoiceMemoryEvidence,
  parseVoiceMemoryResponse, readVoiceMemory, renderVoiceMemory,
} from "./voiceMemory";

type GenerateMemory = (request: { systemPrompt: string; userMessage: string }) => Promise<string>;
const clip = (text: string, budget: number) => text.length <= budget
  ? text : text.slice(0, budget - 22) + "\n[More text omitted]";
const reviewBody = (text: string) => text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "").trim();

/** All saves in this plugin instance share one queue, so concurrent updates merge. */
export class VoiceMemoryStore {
  private pending: Promise<void> = Promise.resolve();
  constructor(private app: App, private generate: GenerateMemory) {}

  remember(savedText: string, entryDate: string, today: string): Promise<void> {
    const evidence = extractVoiceMemoryEvidence(savedText);
    if (!evidence) return Promise.resolve();
    const operation = this.pending.then(async () => {
      const current = await this.read(VOICE_MEMORY_PATH);
      const previous = readVoiceMemory(current, today);
      const response = await this.generate({
        systemPrompt: VOICE_MEMORY_PROMPT,
        userMessage: JSON.stringify({ currentDate: today, savedEntryDate: entryDate,
          existingMemory: previous, savedUserEvidence: clip(evidence, 12_000) }),
      });
      const next = renderVoiceMemory(parseVoiceMemoryResponse(response, today), today);
      const file = this.app.vault.getAbstractFileByPath(VOICE_MEMORY_PATH);
      if (file instanceof TFile) {
        // Compare inside the atomic write: editor/sync changes during the
        // provider request belong to the user, not the stale model snapshot.
        await this.app.vault.process(file, latest => {
          if (latest !== current) throw new Error("Voice Memory changed during the update; preserving your edits.");
          return next;
        });
      }
      else {
        if (current) throw new Error("Voice Memory changed during the update; preserving your edits.");
        if (!this.app.vault.getAbstractFileByPath("🤖 AI")) await this.app.vault.createFolder("🤖 AI");
        await this.app.vault.create(VOICE_MEMORY_PATH, next);
      }
    });
    // A failed response never alters the file and must not poison the next save.
    this.pending = operation.catch(() => {});
    return operation;
  }

  async callContext(input: {
    today: string;
    mode: VoiceCallMode;
    currentReview?: string;
    settings: Pick<SecondBrainSettings, "customCommands" | "voiceMemoryEnabled">;
  }): Promise<string> {
    const parts: string[] = [];
    const hasReview = input.mode === "review" && Boolean(input.currentReview?.trim());
    if (hasReview) parts.push(`## Current review\n\n${clip(input.currentReview!.trim(), 4_500)}`);
    if (input.settings.voiceMemoryEnabled !== false) {
      await this.pending;
      const memory = readVoiceMemory(await this.read(VOICE_MEMORY_PATH), input.today);
      if (memory.threads.length || memory.updates.length) {
        parts.push(`## Saved voice memory\n\n${renderVoiceMemory(memory, input.today, hasReview ? 2_500 : 5_800)}`);
      }
    }
    const week = anchorWeekDates(input.today);
    const previousMonday = new Date(`${week[0]}T12:00:00`);
    previousMonday.setDate(previousMonday.getDate() - 7);
    const anchor = toISO(previousMonday);
    const previousWeek = anchorWeekDates(anchor);
    const template = input.settings.customCommands?.find(command => command.id === "review-last-week")?.outputPath ||
      "🤖 AI/Reviews/Weekly/{ISO_YEAR}-W{WW}.md";
    // A literal custom path cannot prove which week it covers.
    const weeklyPath = applyDatePlaceholders(/\{(?:WW|YYYY-MM-DD)\}/.test(template)
      ? template : "🤖 AI/Reviews/Weekly/{ISO_YEAR}-W{WW}.md", anchor);
    const personalPath = weeklyPath.replace(/^🤖 AI\/Reviews\//, "🧑 Me/Reviews/");
    const weekly = reviewBody(await this.read(weeklyPath));
    const personal = personalPath !== weeklyPath ? reviewBody(await this.read(personalPath)) : "";
    if (weekly.trim() || personal.trim()) {
      const review = [weekly.trim() && `AI summary:\n${clip(weekly.trim(), 1_000)}`,
        personal.trim() && `User reflection:\n${clip(extractVoiceMemoryEvidence(personal), 1_000)}`].filter(Boolean).join("\n\n");
      parts.push(`## Previous week's review (${previousWeek[0]} to ${previousWeek[6]})\n\n${clip(review, 1_900)}`);
    }
    return clip(parts.join("\n\n"), 8_000) || "(No saved voice memory or previous-week review yet.)";
  }

  private async read(path: string): Promise<string> {
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? this.app.vault.read(file) : "";
  }
}
