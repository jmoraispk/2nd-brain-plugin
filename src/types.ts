/**
 * Command abstraction. A command is one button in the plugin view that:
 *   1. gathers one or more file inputs from the vault,
 *   2. calls the configured LLM with a system prompt,
 *   3. writes the result to a templated output path.
 *
 * v0.1.0 ships built-in commands only. v0.2.0+ will expose this for
 * user-editable commands via the settings UI — same shape, different source.
 */

export type CommandInputKind =
  | "today-log"
  | "yesterday-log"
  | "today-review"
  | "yesterday-review";

export interface CommandInput {
  kind: CommandInputKind;
  /** Label used to header this input section in the user message sent to the LLM. */
  label?: string;
}

export interface Command {
  id: string;
  /** Button label shown in the plugin view. */
  label: string;
  inputs: CommandInput[];
  /**
   * Output path template. Placeholders supported:
   *   {YYYY-MM-DD}            today's date
   *   {TOMORROW}              today + 1 day
   *   {YESTERDAY}             today − 1 day
   *   {YYYY} {MM} {DD}        today's parts
   *   {WEEK_NUM_2DIGIT}       today's ISO week, zero-padded
   *   {REVIEWS_TEMPLATE}      replaced with settings.reviewsPathTemplate (then placeholders resolved)
   */
  outputPath: string;
  systemPrompt: string;
}
