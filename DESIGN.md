---
version: alpha
name: "Second Brain"
description: "A quiet, mobile-first Obsidian workspace centered on capturing and reviewing personal notes."
omitted:
  - section: colors
    reason: "Obsidian theme variables are the canonical runtime palette in styles.css."
  - section: typography
    reason: "Obsidian font variables are the canonical runtime type system in styles.css."
rounded:
  control: "0.5625rem"
  card: "0.875rem"
spacing:
  dashboard-gap: "1rem"
  card-padding: "1.125rem"
  mobile-card-padding: "0.875rem"
  page-max: "52.5rem"
components:
  simplified-action:
    height: "2.75rem"
    width: "100%"
  simplified-card:
    rounded: "0.875rem"
---

# Second Brain Design System

## Overview

### Creative North Star

A quiet daily notebook laid over Obsidian’s native visual language: the interface should disappear behind the two core actions, Capture and Review.

### Product context and register

- **Audience and primary job:** One owner quickly captures thoughts and later reviews factual summaries of them.
- **Usage scene:** Frequent phone use plus focused laptop review; both contexts retain the same information architecture.
- **Register:** Product UI. Familiarity, density, and low friction take precedence over decoration.
- **Memorable signature:** The single-month activity map makes capture history tangible without adding planning overhead.
- **Restraint:** Native Obsidian colors, fonts, and controls remain recognizable.
- **Anti-references:** Chatty assistant dashboards, proposal queues, and ornate productivity systems that compete with thinking.
- **Token ownership/runtime mapping:** [`styles.css`](styles.css) is canonical. This file mirrors accepted shared dimensions and explains intent; it does not generate runtime tokens.

## Colors

All semantic colors inherit from Obsidian variables such as `--interactive-accent`, `--background-primary`, and `--text-normal`, preserving the active vault theme and its contrast behavior.

## Typography

Text inherits Obsidian’s `--font-text` and theme hierarchy. Controls use concise sentence-case labels; data remains compact and legible.

## Layout

The simplified surface is a single column capped at 840px with 16px section rhythm. Cards use 18px padding on wider surfaces and 14px on narrow screens. Primary Capture, Review, and Save reflection actions span the full card content width at every viewport and retain a stable 44px height. Mobile safe-area clearance remains explicit after the final card.

## Elevation & Depth

Hierarchy comes from Obsidian surface tones and one-pixel theme borders. Static cards do not add decorative shadows or blur.

## Shapes

Cards use a restrained 14px radius; primary controls use 9px. Calendar cells and compact controls use smaller radii to preserve density.

## Components

### Foundational visual states

Native buttons retain Obsidian hover, focus, active, disabled, and accent behavior. Busy labels must not change control geometry.

### Buttons and actions

Capture and Review are equal primary actions. On the simplified dashboard they are full-width, 44px tall, and use consistent type and radius. Save reflection follows the same geometry.

### Navigation and data display

The calendar displays exactly one month. Desktop may use available horizontal space for the seven-day grid; mobile preserves 44px minimum touch targets and the same selection model.

### Forms and overlays

Capture and reflection stay inline. Native date inputs and Obsidian notices remain canonical unless a future requirement needs authored behavior.

### Iconography

Use Obsidian/Lucide-style icons for utility actions. Icon-only controls require accessible labels; core actions keep text labels.

### Motion

Motion communicates state only. Keep transitions brief and preserve reduced-motion behavior inherited from Obsidian.

### Content and data visualization

Copy is factual and direct. Reviews prioritize key progress, lessons, unique events, and evidence-based health statistics.

## Do's and Don'ts

- **Do:** Keep Capture and Review visually equal and reachable on every supported screen.
- **Do:** Reuse Obsidian theme tokens so the plugin belongs in the active vault.
- **Don't:** Add planning, proposals, or assistant chatter to the simplified surface.
- **Don't:** trade mobile safe-area clearance or accessible targets for density.
