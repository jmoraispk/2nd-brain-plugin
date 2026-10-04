# Voice memory and transcripts implementation plan

**Goal:** Give calls João's name, a caring conversational style, compact continuity from saved captures/reflections, and an unchanged speaker-labelled transcript in the draft box.

**Approved design:** The September 14 revision approved October 4 in this task. Calls use current draft, compact Voice Memory, last week's review only, and the current generated review for Review calls. No historical raw logs or project/goal files. Memory updates only after Capture/Save reflection; transcripts remain editable until saved.

**Architecture:** Pure helpers format transcripts and validate dated memory. A serialized vault service maintains `🤖 AI/Voice Memory.md` after explicit saves using the configured text provider. Calls load only bounded memory and exact previous-week review paths. Existing mobile microphone-first setup remains intact.

**Constraints:** Release after v0.19.0, target v0.19.1. Persist only explicit user facts in memory, keep seven days of recent updates, retain ongoing threads until resolved, bound memory to 6,000 characters and call draft/context to 12,000. Failures updating memory never undo captures or reflections. Agent speech is conversation, not evidence of user activity.

## Tasks

- [x] 1. Write failing behavior tests for named sessions, ordered verbatim transcripts, one-time finalization, user-only memory evidence, dated pruning, and bounded output. Implement pure helpers; run targeted tests.
- [x] 2. Write failing vault tests for save-only updates, serialization, malformed-provider recovery, exact previous-week review selection including ISO year boundaries, and call context limits. Implement vault memory service and save/call integrations; run targeted tests.
- [x] 3. Add name/memory settings, warmth in runtime and managed assistant prompts, and transcript-safe review guidance. Preserve custom prompts and existing credentials. Update Vapi assistant; verify its returned configuration without exposing keys.
- [x] 4. Review diff; run full tests and production build. Bump all version files, document usage/release.
- [ ] 5. Commit, fast-forward master, push branch/tag; verify successful workflow and downloadable assets. Set João's name in the existing installation and install verified release files. Report delivery evidence in the final response.

## Review focus

- A call ending twice must append its transcript only once; a cancelled call must preserve its original draft.
- Agent suggestions must never become user facts in memory or review summaries.
- Backdated captures and week/year boundaries must retain real dates and exclude stale weekly reviews.
- Concurrent saves must not overwrite each other's memory; provider failures must preserve prior memory.
- An oversized current review must remain recognizable while total call context stays bounded.

## Progress

Implementation and pre-release verification complete on `codex/voice-memory-transcripts`. Full suite: 101 passed, zero failed. Production TypeScript/build check passed. Managed Vapi assistant updated to schema 3 and fetched system messages exactly match the checked-in configuration; existing voice and assistant ID retained.

Independent review found three edge cases, all corrected with regression tests: strip weekly frontmatter before excerpting; retain unfinished user speech and drain queued finals before one-time transcript finalization; atomically protect manual memory edits made while provider generation is pending. No live mobile call has been tested in this run. Release delivery remains the next workflow step.
