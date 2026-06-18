/**
 * Areas of life — the fixed Wheel (Ali Abdaal layout) + the shared visual
 * language (emoji per sub-area, color per macro) + flat-tag parsing.
 *
 * Decided in the v0.10 redesign: areas/projects are flat *lists*, never
 * ranked. An item belongs to a set of areas; filtering is set membership.
 */

export interface AreaDef {
  macro: "Health" | "Relationships" | "Work";
  sub: string;
  path: string;
  emoji: string;
  /** HSL hue for the macro group. */
  hue: number;
}

/** Macro → base hue (green / red / blue, matching the Wheel SVG). */
export const MACRO_HUE: Record<AreaDef["macro"], number> = {
  Health: 135,
  Relationships: 0,
  Work: 215,
};

export const AREAS: AreaDef[] = [
  { macro: "Health", sub: "Body", path: "2. 🌳 Areas/Health/Body", emoji: "💪", hue: 135 },
  { macro: "Health", sub: "Mind", path: "2. 🌳 Areas/Health/Mind", emoji: "🧠", hue: 135 },
  { macro: "Health", sub: "Soul", path: "2. 🌳 Areas/Health/Soul", emoji: "🧘", hue: 135 },
  { macro: "Relationships", sub: "Romance", path: "2. 🌳 Areas/Relationships/Romance", emoji: "❤️", hue: 0 },
  { macro: "Relationships", sub: "Family", path: "2. 🌳 Areas/Relationships/Family", emoji: "👨‍👩‍👧", hue: 0 },
  { macro: "Relationships", sub: "Friends", path: "2. 🌳 Areas/Relationships/Friends", emoji: "🤝", hue: 0 },
  { macro: "Work", sub: "Mission", path: "2. 🌳 Areas/Work/Mission", emoji: "🎯", hue: 215 },
  { macro: "Work", sub: "Money", path: "2. 🌳 Areas/Work/Money", emoji: "💰", hue: 215 },
  { macro: "Work", sub: "Growth", path: "2. 🌳 Areas/Work/Growth", emoji: "🌱", hue: 215 },
];

/** Strip `[[ ]]` and surrounding quotes from a frontmatter area value. */
export function normalizeAreaPath(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let s = raw.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1);
  }
  s = s.replace(/^\[\[/, "").replace(/\]\]$/, "").trim();
  // Wikilinks may carry a display alias: [[path|alias]] — keep the path.
  const pipe = s.indexOf("|");
  if (pipe >= 0) s = s.slice(0, pipe).trim();
  return s.length > 0 ? s : undefined;
}

/**
 * Resolve an area path to its definition. Tolerant: matches by full path,
 * by trailing "Macro/Sub", or by bare sub-area name (case-insensitive).
 */
export function areaFor(path: string | undefined): AreaDef | undefined {
  const norm = normalizeAreaPath(path);
  if (!norm) return undefined;
  const lower = norm.toLowerCase();
  // Exact path.
  let hit = AREAS.find((a) => a.path.toLowerCase() === lower);
  if (hit) return hit;
  // Endswith Macro/Sub or /Sub.
  hit = AREAS.find(
    (a) =>
      lower.endsWith(`/${a.macro}/${a.sub}`.toLowerCase()) ||
      lower.endsWith(`/${a.sub}`.toLowerCase())
  );
  if (hit) return hit;
  // Bare sub name.
  return AREAS.find((a) => a.sub.toLowerCase() === lower);
}

/**
 * Parse a frontmatter field that may be:
 *   - a single scalar: `area: "[[…/Body]]"`
 *   - an inline list:  `areas: ["[[…/Body]]", "[[…/Mind]]"]`
 *   - a block list:    handled by the caller passing joined values
 * Returns the list of normalized paths.
 *
 * `scalarOrList` is whatever the frontmatter parser produced (string or
 * string[]). We also accept a legacy single `area` alongside a new `areas`.
 */
export function parseAreaList(value: unknown): string[] {
  if (value == null) return [];
  const out: string[] = [];
  const push = (v: unknown) => {
    const n = normalizeAreaPath(typeof v === "string" ? v : String(v));
    if (n) out.push(n);
  };
  if (Array.isArray(value)) {
    value.forEach(push);
  } else if (typeof value === "string" && value.trim().startsWith("[")) {
    // Inline-array string from a frontmatter parser that didn't split it:
    // `["[[a]]", "[[b]]"]`. Split on commas outside the brackets.
    const inner = value.trim().replace(/^\[/, "").replace(/\]$/, "");
    for (const part of inner.split(/,(?![^[]*\]\])/)) {
      const t = part.trim();
      if (t) push(t);
    }
  } else {
    push(value);
  }
  return out;
}

/**
 * Render an emoji-on-color chip for an area into `parent`. The chip
 * *background* carries the macro color; the emoji glyph keeps its own colors.
 * Falls back to a neutral chip with a "?" for unrecognized areas.
 */
export function renderAreaChip(parent: HTMLElement, path: string): HTMLElement {
  const area = areaFor(path);
  const chip = parent.createSpan({ cls: "second-brain-area-chip" });
  if (area) {
    chip.style.backgroundColor = `hsla(${area.hue}, 55%, 45%, 0.22)`;
    chip.style.borderColor = `hsla(${area.hue}, 55%, 45%, 0.55)`;
    chip.setText(area.emoji);
    chip.setAttribute("title", `${area.macro} · ${area.sub}`);
  } else {
    const label = normalizeAreaPath(path) ?? "?";
    chip.setText("•");
    chip.setAttribute("title", label);
  }
  return chip;
}

/** Render a row of chips for a list of area paths. */
export function renderAreaChips(parent: HTMLElement, paths: string[]): void {
  const wrap = parent.createSpan({ cls: "second-brain-area-chips" });
  for (const p of paths) renderAreaChip(wrap, p);
}
