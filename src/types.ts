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
  | "yesterday-review"
  | "this-week-logs"
  | "last-week-logs"
  | "last-month-logs"
  | "last-quarter-logs"
  | "last-year-logs"
  | "month-logs"
  | "quarter-logs"
  | "all-logs"
  | "anchor-week-logs"
  | "anchor-month-logs"
  | "anchor-quarter-logs"
  | "anchor-year-logs";

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
  /** Quality / signal tier for display in the Think tab. */
  tier?: "S" | "A" | "B" | "C";
  /** One-line human description; rendered under the title in the Think tab. */
  description?: string;
  /**
   * If set, the runner pops a modal before running the command, asking the
   * user for a topic. The text the user types is appended to the LLM user
   * message (so prompts like Trace and Challenge can scope to a specific
   * belief / idea / project). Use this as the question shown in the modal.
   */
  topicPromptText?: string;
  /**
   * If set, the runner inserts the current period's Kepano question into the
   * user message before the inputs. "year" pulls this week's yearly question;
   * "decade" pulls this month's decade question. Used by weekly + monthly
   * review commands to thread the Kepano reflection into the synthesis.
   */
  kepanoQuestion?: "year" | "decade";
}
