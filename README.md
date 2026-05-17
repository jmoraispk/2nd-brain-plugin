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

**Write-scope rule:** the AI never writes to `🧑 Me/`, PARA, or any other zone — only `🤖 AI/`. A PreToolUse hook in the framework repo enforces this for `claude-code`; the plugin only writes to its configured output paths.

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
