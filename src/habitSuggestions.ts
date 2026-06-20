/**
 * Habit suggestion library (v0.13.1) — the categorized palette (HelloHabit-
 * inspired). Picking a chip opens the AI habit-designer pre-seeded with that
 * idea, so the designer still does the boosting (cue, minimum, recovery, …);
 * the library is just a fast cold-start, not a bypass.
 */

import { App, Modal } from "obsidian";

interface SuggestionCategory {
  label: string;
  /** Each item: the chip text + the seed phrase fed to the designer. */
  items: Array<{ chip: string; seed: string }>;
}

const plain = (s: string) => ({ chip: s, seed: s });

export const SUGGESTION_CATEGORIES: SuggestionCategory[] = [
  {
    label: "🏃 Fitness",
    items: ["Exercise", "Run", "Cardio", "Lift Weights", "Work Out", "Stretch", "Yoga", "Dance", "Play Sport", "Bike", "Swim", "Pilates"].map(plain),
  },
  {
    label: "🥗 Health",
    items: ["Drink Water", "Wake Up Early", "Sleep Early", "Cook", "Brush Teeth", "Floss", "Eat Fruits", "Eat Veggies", "Eat Breakfast", "Shower", "Take Vitamins"].map(plain),
  },
  {
    label: "🧠 Mind",
    items: ["Read", "Study", "Learn", "Meditate", "Practice Language", "Journal", "Practice Piano", "Practice Guitar", "Pray", "Deep Breathing"].map(plain),
  },
  {
    label: "🧹 Chores",
    items: ["Clean", "Wash Dishes", "Laundry", "Vacuum", "Make Bed", "Grocery Shop", "Pay Bills", "Water Plants", "Feed Pet", "Take Out Trash"].map(plain),
  },
  {
    label: "📉 Reduce",
    items: ["Less Smoking", "Less Drinking", "Less Sweets", "Less Coffee", "Less Junk Food", "Less Fast Food", "Less Eating Out", "Less Soda", "Less TV", "Less Shopping"].map(plain),
  },
  {
    label: "🚫 Quit",
    items: ["Quit Smoking", "Quit Drinking", "Quit Social Media", "Quit Nail Biting", "Quit Coffee", "Quit Sugar", "Quit Junk Food", "Quit Gambling"].map((s) => ({
      chip: s,
      seed: `${s} — track abstinence with a running clock`,
    })),
  },
  {
    label: "😀 Mood & Body",
    items: [
      { chip: "Mood", seed: "Track my mood 1–5 each day" },
      { chip: "Body Weight", seed: "Track my body weight" },
    ],
  },
];

export class HabitSuggestionsModal extends Modal {
  private readonly onPick: (seed: string) => void;

  constructor(app: App, onPick: (seed: string) => void) {
    super(app);
    this.onPick = onPick;
    this.modalEl.addClass("second-brain-capture-modal");
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    const header = contentEl.createDiv({ cls: "second-brain-capture-header" });
    header.createEl("h2", { text: "Habit suggestions", cls: "second-brain-capture-title" });
    const close = header.createEl("button", {
      text: "✕",
      cls: "second-brain-capture-close",
      attr: { title: "Close" },
    });
    close.addEventListener("click", () => this.close());

    contentEl.createEl("div", {
      cls: "second-brain-muted",
      text: "Pick one to start — the AI then designs it properly (cue, minimum dose, recovery).",
    });

    for (const cat of SUGGESTION_CATEGORIES) {
      const sec = contentEl.createDiv({ cls: "second-brain-suggest-cat" });
      sec.createEl("div", { text: cat.label, cls: "second-brain-suggest-cat-label" });
      const wrap = sec.createDiv({ cls: "second-brain-suggest-chips" });
      for (const it of cat.items) {
        const chip = wrap.createEl("button", {
          text: it.chip,
          cls: "second-brain-suggest-chip",
        });
        chip.addEventListener("click", () => {
          this.close();
          this.onPick(it.seed);
        });
      }
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
