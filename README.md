# Second Brain — Obsidian plugin

Big-button capture into today's log + one-tap synthesized reviews via the Claude / OpenAI API. Mobile-first.

This is the PWA-equivalent surface for the [2nd-brain](https://github.com/jmoraispk/2nd-brain) framework — same daily loop, running inside Obsidian on your phone.

## Vault structure

The plugin organizes the vault into two authoring zones plus the PARA tier. The AI side mirrors the human side — same hierarchy, same anchors — so the two streams stay legible side-by-side.

| 🧑 Me/ (you write)                       | 🤖 AI/ (AI writes)                              | Cadence            |
| --------------------------------------- | ----------------------------------------------- | ------------------ |
| `Logs/{Y}/Q{q}/W{ww}/<date>.md`         | `Reviews/Daily/{Y}/Q{q}/W{ww}/<date>.md`        | daily              |
| `Reviews/Daily/{Y}/Q{q}/W{ww}/<date>.md`| `Plans/Daily/<tomorrow>.md`                     | daily              |
| `Reviews/Weekly/{Y}-W{ww}.md`           | `Reviews/Weekly/{Y}-W{ww}.md`                   | weekly             |
| `Reviews/Monthly/{Y}-{mm}.md`           | `Reviews/Monthly/{Y}-{mm}.md`                   | monthly            |
| `Reviews/Quarterly/{Y}-Q{q}.md`         | `Reviews/Quarterly/{Y}-Q{q}.md`                 | quarterly          |
| `Reviews/Yearly/{Y}.md`                 | `Reviews/Yearly/{Y}.md`                         | yearly             |
| `Reviews/Qs-Year/<NN>-<slug>.md`        | _(no mirror — pure reflection)_                 | weekly rotation    |
| `Reviews/Qs-Decade/<NN>-<slug>.md`      | _(no mirror — pure reflection)_                 | monthly rotation   |

Alongside Me / AI sit the PARA folders (knowledge organized by topic, not by author):

```
1. 🎯 Projects/     time-bounded outcomes
2. 🌳 Areas/        ongoing standards to maintain
3. 📚 Resources/    topical reference material
4. 🗄️ Archives/    inactive
```

**Write-scope rule:** the AI never writes to `🧑 Me/`, PARA, or any other zone — only `🤖 AI/`. A shared PreToolUse guard in the [framework repo](https://github.com/jmoraispk/2nd-brain) enforces this for coding agents — Claude Code (`.claude/`) and Cursor (`.cursor/hooks.json`); the plugin itself only writes to its configured output paths.

## The daily loop

1. **Capture** throughout the day → appends `[HH:MM] ...` to `🧑 Me/Logs/<today>.md`.
2. **Today's Review** at end of day → AI synthesizes the log into `🤖 AI/Reviews/Daily/<today>.md`.
3. Edit the AI review with your own reflections → saved as a *separate* file at `🧑 Me/Reviews/Daily/<today>.md` (append-only, dated sections — AI never overwrites your text).
4. **Plan Tomorrow** before bed → AI reads your edited review and writes a scaffold at `🤖 AI/Plans/Daily/<tomorrow>.md`.

Weekly: **Week's Review** rolls up the seven daily logs and threads in the current Kepano yearly question. Monthly threads in the current Kepano decade question.

## Cache-busting (v0.7.2+)

Every AI-generated file carries a small `sb-*` frontmatter block recording the plugin version, command id, provider, model, timestamp, and a per-input fingerprint (path + size + SHA-1). On re-run:

- **Inputs unchanged** → no API call, the existing file opens (Notice: `✅ inputs unchanged`).
- **Inputs changed** → regenerate, with a Notice naming *what* drifted (`🔄 regenerated — Logs/2026-05-15.md (+412 bytes), model changed`).

The fingerprint also invalidates on plugin version bump so prompt edits take effect.

## Custom commands (v0.2.0+)

Settings → Second Brain → **Commands** lets you edit any built-in (label / input / output path / prompt) or add your own. Built-ins can be reset; custom commands can be deleted. Provider-agnostic — the same command works against OpenAI or Anthropic.

A command consists of:
- **Label** — button text.
- **Input** — `today's log`, `yesterday's log`, `today's review`, `this week's logs`, `all logs`, anchor-driven variants, etc.
- **Output path** — templated with `{YYYY-MM-DD}`, `{TOMORROW}`, `{ISO_YEAR}`, `{Q}`, `{WW}`, `{REVIEWS_TEMPLATE}` (= settings' daily-review template).
- **System prompt** — instructions for the LLM.

## Install (mobile, recommended)

Use [BRAT](https://github.com/TfTHacker/obsidian42-brat) — Obsidian's standard way to install plugins from GitHub releases, with auto-update on new tags. iOS + Android.

1. Settings → Community plugins → Browse → install **BRAT**, enable it.
2. Settings → BRAT → Add Beta plugin → paste `https://github.com/jmoraispk/2nd-brain-plugin`.
3. Settings → Community plugins → Installed → enable **Second Brain**.
4. Settings → Second Brain → paste your Anthropic or OpenAI API key.

## Install (desktop, manual)

```bash
git clone <this repo> 2nd-brain-plugin
cd 2nd-brain-plugin
npm install
npm run build
mkdir -p "<vault>/.obsidian/plugins/obsidian-second-brain"
cp manifest.json main.js styles.css "<vault>/.obsidian/plugins/obsidian-second-brain/"
```

Then Settings → Community plugins → Installed → enable **Second Brain**.

### Dev loop

```bash
# Symlink the repo into your vault's plugins folder, then:
npm run dev    # esbuild watch — rebuilds main.js in place
```

Reload Obsidian (Cmd/Ctrl-R) after each rebuild.

## Settings

| Setting                          | Default                                                                | Notes                                                          |
| -------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------- |
| Provider                         | `openai`                                                               | `openai` or `anthropic`. Switching preserves both keys.        |
| OpenAI / Anthropic API key       | _empty_                                                                | Sent only to the provider's API.                               |
| Model                            | `gpt-5-mini` / `claude-opus-4-7`                                       | Dropdown of curated models; custom ids also accepted.          |
| Logs folder                      | `🧑 Me/Logs`                                                           | Recursively searched for `<today>.md`.                         |
| Daily log path template          | `🧑 Me/Logs/{ISO_YEAR}/Q{Q}/W{WW}/{YYYY-MM-DD}.md`                     | Used when today's file doesn't exist yet.                      |
| Daily review path template       | `🤖 AI/Reviews/Daily/{ISO_YEAR}/Q{Q}/W{WW}/{YYYY-MM-DD}.md`            | Where Today's Review writes. Cache-busted on re-run.           |

## Privacy / costs

- **BYOK.** The plugin only talks to `api.anthropic.com` or `api.openai.com`. Nothing else is exfiltrated.
- Daily-log content is sent to the configured provider when you press a review command. That's it.
- All vault writes happen client-side via Obsidian's normal API.

## Required Obsidian plugins (v0.8+)

The plugin auto-creates the vault structure on first launch. For habit
heatmaps you also need two community plugins:

| Plugin | Why |
| --- | --- |
| **BRAT** | installs and auto-updates this plugin from GitHub releases |
| **Second Brain** (via BRAT) | this plugin |
| **Heatmap Calendar** | renders per-habit yearly heatmaps in any markdown note |
| **Dataview** | data-source plumbing the Heatmap Calendar plugin reads |

Settings → Community plugins → Browse → install each of the above. Then
enable them under Installed.

## Wheel of Life areas

First launch creates the canonical areas layout (Ali Abdaal's Wheel of
Life — 3 macro × 3 sub):

```
2. 🌳 Areas/
  Health/       Body · Mind · Soul
  Relationships/ Romance · Family · Friends
  Work/         Mission · Money · Growth
```

These are fixed by design — see the [structure-is-the-flexible-part](https://github.com/jmoraispk/2nd-brain/blob/main/blog/2026-05-17-structure-is-the-flexible-part.md)
blog post for the philosophy. Habits link to areas via the `area`
frontmatter field.

## Release log

- v0.9.2 — **Auto-habits + flat-tag areas + emoji chips.** Two built-in habits ship for everyone, evaluated deterministically from vault state (no LLM): **Daily capture** (did you capture today) and **Weekly review** (did you review this week). Heatmap granularity now follows periodicity — weekly habits render week-blocks, not day cells. Areas + projects are now **flat lists** (`areas:` / `projects:` frontmatter, legacy `area:` still read) — an item can belong to many areas or none, and the Wheel counts membership across all of them. Habits & projects lists show **emoji-on-color area chips** (💪 Body, 🎯 Mission, …) instead of folder words; macro color = green/red/blue, tap a tab's ⓘ for the legend.
- v0.9.1 — **Five-tab restructure (the redesign skeleton).** Tabs are now **Home · Habits · Projects · Review · Think**, each shown as a verb with an ⓘ (Act / Track / Build / Reflect / Discover). The old "Life" tab split into **Habits** (List · Stats) and **Projects** (List · Areas/Wheel). Review reminders moved off Home into the **Review** tab. Home's daily action button now toggles **Summarize ↔ View Summary** — fresh (captures unchanged since last summary) opens the file with no LLM call; stale/missing runs it. North-star plan: `docs/v0.10-redesign.md`. (Auto-habits + emoji-color area chips land next in v0.9.2.)
- v0.9.0 — **Projects + TODO proposals + Dashboard restructure.** Project files get a 5-section schema (`Why · Done criteria · Current state · Active TODOs · History`) plus a `pinned:` frontmatter flag. New `🤖 AI/Proposals/<date>.md` store: each daily review extracts TODOs from your captures via a fenced YAML block, matches them to a project from the active list, and merges them in (deduped, append-only across re-runs). Dashboard drops the old `🎯 Projects` list and `Threads in motion` section; in their place: **⏰ Pending AI proposals** (one row per pending TODO with ✓ Accept / ✕ Delete — Accept writes directly into the target project's Active TODOs section, structurally) and **📌 Pinned project TODOs** (live `- [ ]` checkboxes pulled from any project with `pinned: true`). The plugin owns project-file mutations within named-section walls; Claude Code's guard hook stays strict for direct framework writes.
- v0.8.9 — **v0.8 closer: project-as-folder + area↔project/habit connections.** Projects can now be a single `1. 🎯 Projects/<name>.md` _or_ a folder `<name>/` with a folder note (`<name>/<name>.md`) — supporting files inside the folder are project sub-files, not separate projects. Areas sub-tab now shows live counts: each Wheel slice gets a `· N ·` badge for the number of active habits + projects linked to it, and the legend reads `Body (2) · Mind (0) · Soul (1)` style. Marks the end of the v0.8 line; see [`docs/v0.9-scope.md`](https://github.com/jmoraispk/2nd-brain/blob/main/docs/v0.9-scope.md) for what's coming next.
- v0.8.8 — **Year view + habit dropdown + numeric stats.** Stats picks up a third period option, **Year** (52-week × 7-day grid with month labels), and a **habit dropdown** at the top — pick "All habits" for the existing stacked overview, or pick a single habit to drill in. When drilled in, four numeric tiles appear above the grid: 🔥 Current streak · 🏆 Best streak ever · ✅ Pass count (last 365 days) · 📊 Completion rate (last 365 days). Cell shading distinguishes three gray shades: lighter for future days, darker for past days without logs, plus green/amber/red for pass/uncertain/fail.
- v0.8.7 — **Stats: period toggle + Week view + Today badge.** Stats sub-tab now has a Week / Month switcher and ◀ ▶ arrows that step a period back at a time. **Week view** is a Loop Habit-style calendar grid: rows = Sun-Sat, columns = the last 12 weeks, one grid per habit — patterns like "I never run on Mondays" become visible. **Month view** is the existing 30-day strip (now navigable into the past). **Today badge** at the top: `🎯 N/M habits today` showing how many active habits passed in today's review.
- v0.8.6 — **Streaks folded into Stats.** One fewer sub-tab. Each habit's strip in Stats now shows a 🔥 streak badge to the right of the 30-day grid; the count is the current consecutive run of pass/uncertain days (failing or missing-review breaks it). Removed the standalone Streaks sub-tab.
- v0.8.5 — **Projects sub-tab in Life.** New Projects sub-tab alongside Habits / Areas / Stats / Streaks. Lists active projects with their linked area, status, and dates. **+ New Project** button opens a small modal: name + area picker (the 9 Wheel-of-Life sub-areas). On create, writes `1. 🎯 Projects/<name>.md` with a SMART scaffold (Why · Done criteria · Status · Next steps) + frontmatter linking to the chosen area. This ties projects, habits, and the Wheel together: habits can declare `linked-goal: [[project]]`, and projects declare `area: [[wheel-area]]` — so every habit traces up to an area of life.
- v0.8.4 — **Logs moved out of the topbar.** The 🐛 button is gone — topbar is back to just ↻ and ⚙. Logs live at the bottom of Settings now (Settings → Logs → Open). Failure notices point users there.
- v0.8.3 — **In-plugin error log + modal polish + Wheel fixes.** New 🐛 button in the topbar opens a Logs modal showing every error this session (timestamp, command, message, stack) with Copy-all and Clear. Empties to "🎉 No errors". When a run fails the Notice now points you at the 🐛 button. Topic-input modal (Draft Habit, Trace, Challenge, etc.) rebuilt to match the Capture modal: anchored near the top, single-line title next to X, prompt as a muted label below. Empty submissions are now allowed (was a bug — Draft Habit's prompt literally said "leave empty" but the modal refused). Wheel of Life: legend moved above the wheel, Relationships changed to real reds, Work blues spread further apart, extra bottom margin so Obsidian Mobile's tray stops covering the last slice.
- v0.8.2 — **Life tab + Wheel of Life + Habit backfill + unlimited capture-back.** Habits tab renamed to **Life** with four sub-tabs (Habits / Areas / Stats / Streaks). The **Areas** sub-tab now renders an actual SVG Wheel of Life — three macro segments × three sub-segments each — clickable to navigate into the folder. New **📜 Backfill history** button runs a single LLM pass over all historical logs and writes per-habit pass/uncertain/fail data so streaks + heatmaps reflect real history. Dashboard date arrows no longer cap at yesterday — go back as far as you need. Draft Habit button moved below the table so it stops dominating the page.
- v0.8.1 — **Native habit heatmap + Heatmap Calendar integration + Habits-tab rename.** Native 30-day heatmap strip per habit in the Habits → Stats sub-tab (no plugin dep). Daily review now also writes `🤖 AI/Habit-Data/<id>.md` files containing a `dataviewjs` codeblock that the Heatmap Calendar plugin renders — embed those anywhere for yearly heatmaps. Top-level **Goals** tab renamed to **Habits**. Top-level **Qs** tab folded into Think as a sub-tab (cleans up the top nav). Capture modal now triggers a Dashboard re-render on save so the count updates immediately. **Draft Habit** is now a prominent button at the top of the Habits tab.
- v0.8.0 — **Habits + Dashboard navigation + Wheel of Life.** Habit files at `🧑 Me/Habits/<id>.md` with LogLife boost schema (Define / Why / Plan / Environment / Recover). Daily review now infers per-habit status (✅ pass · ⚠️ uncertain · ❌ fail) from the captures — no `#tags` required. New **Goals** tab (Goals · Stats · Streaks) lists active habits with today's status. Dashboard gets `◀ ▶` arrows to navigate today ↔ yesterday; Capture and This Review act on the displayed day. Plan Tomorrow drops off the Dashboard but stays as a runnable command. `/draft-habit` command boosts a habit (or proposes a new one) using LogLife framing. Wheel-of-Life areas auto-created on first load. Hook simplification (legacy `_AI` zone dropped).
- v0.7.2 — Review metadata frontmatter (cache-busting): re-runs skip the LLM call when inputs + model + plugin version match the last run; otherwise the Notice names what drifted. README rewrite around the Me ↔ AI mirror.
- v0.7.1 — Capture modal X-alignment fix on desktop.
- v0.7.0 — Qs tab: Kepano 40 yearly + 40 decade questions, deterministic weekly/monthly rotation, append-only per-question files, auto-updating status index, Kepano question threaded into weekly + monthly review prompts.
- v0.6.x — Edit/Copy split, user reviews append-only, capture-modal polish, Tier-S/A/B Think commands, Test connection button, model picker dropdown.
- v0.5.x — Three tabs (Dashboard / Review / Think), Tier-S Think commands, AI-writable zone renamed `_AI/` → `🤖 AI/`, PARA folders reordered.
- v0.4.x — Last-period reviews, pending-review banner.
- v0.3.0 — Dashboard view.
- v0.2.0 — User-editable commands, Week's Review, settings auto-migration.
- v0.1.x — Commands abstraction, Plan Tomorrow, Year/Quarter/Week folder layout.
- v0.0.2 — Multi-provider (OpenAI + Anthropic).
