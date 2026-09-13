# Activity History Access and Review Integration Design

Date: 2026-09-13

## Purpose

Make Activity usage and cost easy to reach, make a successful DayTrace run a file-first workflow instead of an intermediate Capture draft, and guarantee that the saved DayTrace summary table appears unchanged in the generated Review. Correct the GPT-5 connection test without changing the already-working Activity provider integration.

## Existing behavior

- Second Brain v0.18.0 stores metadata-only usage history in plugin data and renders costs under Settings → History.
- Activity provider requests already share one `Activity` interaction ID and record provider-reported token usage and estimated cost.
- A DayTrace run writes sanitized evidence to `🧑 Me/Activity/Daytrace/Evidence/{ISO_YEAR}/Q{Q}/W{WW}/{YYYY-MM-DD}.json` before attempting AI summarization.
- A successful AI run writes the rendered digest to `🤖 AI/Activity/Daytrace/Summaries/{ISO_YEAR}/Q{Q}/W{WW}/{YYYY-MM-DD}.md` and currently also inserts that same Markdown into Capture.
- Simplified Review currently reads only daily-log files, so a saved DayTrace summary is invisible to Review unless the user manually captures it.
- The OpenAI connection test sends `max_tokens`, which GPT-5 rejects in favor of `max_completion_tokens`. Normal text calls and DayTrace OpenAI calls do not send the rejected field.

## Goals

- Put a small book icon beside the Settings button in both Simplified and Complete dashboard top bars.
- Open the plugin Settings directly to an expanded, visible History section from that button.
- Leave the Capture draft untouched after a successful Activity run.
- Include saved DayTrace summaries in the source material for a selected-date Review.
- Copy each saved DayTrace workstream table verbatim into the generated Review file and inline Review display.
- Retain the current deterministic Capture fallback when AI summarization fails and no new AI summary is available.
- Make the GPT-5 connection test use the supported OpenAI completion-limit field.
- Preserve current notification durations.

## Non-goals

- Do not create another usage ledger or a separate History view.
- Do not move or duplicate DayTrace evidence or summary files.
- Do not copy raw ActivityWatch evidence into a Review.
- Do not change ActivityWatch collection, DayTrace sanitization, provider selection, pricing, or usage-history semantics.
- Do not change notification lifetimes. Successful clickable file notices remain at their current five-second default; existing longer failure diagnostics remain unchanged.
- Do not change Complete-dashboard review inputs in this release. The file-first integration applies to the Simplified selected-date Review flow requested here.

## History shortcut

Both dashboard top bars gain a compact `book-open` icon button immediately before the Settings gear. It uses the existing icon-button geometry and has `Usage history` as its tooltip and accessible label.

Clicking the button opens Obsidian Settings, selects the Second Brain tab, expands History, scrolls the History section into view, and initiates the same quiet exact-cost refresh that occurs when History is opened manually. The implementation must call a public plugin/settings-tab boundary rather than query or mutate Obsidian's rendered Settings DOM by label.

The existing Settings gear continues to open the normal Second Brain Settings view without forcing History open.

## Activity completion behavior

On AI success, Activity continues writing both the Human evidence JSON and AI summary Markdown, but does not modify `simplifiedState.captureDraft`. The completion notice continues opening the saved AI summary and uses the existing five-second duration.

On deterministic fallback, Activity writes the Human evidence exactly as it does today and continues merging the deterministic Markdown into Capture. This exception prevents a provider failure from leaving the user with evidence that Review cannot safely consume as an AI summary. Any pre-existing user draft is preserved.

## Review input and exact table copy

The Simplified selected-date Review reads two optional sources for every date in its range:

1. the existing Human daily log;
2. the AI DayTrace summary at the matching date-based summary path.

A date is eligible when at least one of those sources exists and is non-empty. This allows an Activity-only day to be reviewed without forcing a Capture. Each file is fingerprinted independently, so creating or regenerating a DayTrace summary invalidates a cached Review.

The complete DayTrace summary is included in the LLM input under a clearly labeled Activity section, allowing the review model to use the workstream evidence in its synthesis. Before writing the Review, the runner also extracts the contiguous DayTrace Markdown workstream table from each summary. It appends those exact table strings after the model-generated text under:

```markdown
## Activity

### YYYY-MM-DD

| Project / workstream | Apparent achievements | Work and topics |
| --- | --- | --- |
...
```

For multi-day ranges, sections appear in ascending date order. Table rows, cell text, escaping, and ordering are not regenerated by the Review model. If a saved summary is unexpectedly missing its table, it remains available to the LLM as input but no fabricated table is appended.

Because the appended Activity section is part of the persisted Review file, the existing inline Review renderer displays the same copy. A cache hit returns the previously persisted Review, including its Activity section.

## OpenAI connection-test correction

Only the OpenAI branch of `testConnection` changes from `max_tokens: 5` to `max_completion_tokens: 5`. The Anthropic branch retains `max_tokens: 5`, because that is the Anthropic Messages API field. Provider errors remain verbatim and the test interaction remains recorded in History.

## Data and privacy

No new persistent schema is introduced. History remains metadata-only. Review sends the already-sanitized AI DayTrace summary, never the raw evidence JSON, to the configured provider. Existing API-key storage and request boundaries remain unchanged.

## Error handling

- Opening History must still show locally recorded costs if exact Vapi reconciliation is unavailable.
- A missing DayTrace summary is normal and must not block Review when a daily log exists.
- A missing daily log is normal and must not block Simplified Review when a DayTrace summary exists.
- A malformed DayTrace summary must not break Review; the content may inform the model, but an exact copied table is omitted.
- A failed Activity AI request keeps the current deterministic Capture fallback and failure notice.
- Usage-history recording failures remain non-fatal to Activity and Review.

## Testing

Automated coverage will verify:

- both dashboard modes render the book icon beside Settings and invoke the dedicated History-opening callback;
- programmatic History opening expands, reveals, and refreshes the existing section while the normal Settings path does not force it open;
- successful Activity generation leaves an existing Capture draft unchanged;
- deterministic Activity fallback still merges into Capture;
- Simplified Review reads daily logs and matching DayTrace summaries, including Activity-only dates;
- source fingerprints include both files and invalidate the Review cache when Activity changes;
- the exact stored DayTrace table is appended to the generated and cached Review without model rewriting;
- missing or malformed Activity summaries remain non-fatal;
- GPT-5 connection testing sends `max_completion_tokens: 5` and omits `max_tokens` while Anthropic retains its existing field;
- the full test suite and production TypeScript build pass.

## Delivery

Implementation will increment the plugin version, update the README release log, commit and push to `origin/master`, create the matching version tag, wait for the GitHub release workflow, and verify the downloadable `main.js`, `manifest.json`, and `styles.css` assets before completion is reported.
