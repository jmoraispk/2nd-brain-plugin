/**
 * Kepano's 40 year-end + 40 decade questions.
 * Source: https://github.com/kepano/40-questions (MIT-style, attribution preserved).
 *
 * Slugs are 1–3 hyphenated words designed to be:
 *   - short enough to fit cleanly in `01-<slug>.md` filenames
 *   - distinct enough that a glance at the filename hints at the topic
 *
 * Question files: one per question, accumulating answers across years.
 * The file lives forever; new sections are appended as the user re-visits
 * the question in future years.
 */

export interface KepanoQuestion {
  n: number;
  slug: string;
  question: string;
}

export const YEAR_QUESTIONS: readonly KepanoQuestion[] = [
  { n: 1, slug: "never-done", question: "What did you do this year that you'd never done before?" },
  { n: 2, slug: "resolutions", question: "Did you keep your new year's resolutions?" },
  { n: 3, slug: "birth", question: "Did anyone close to you give birth?" },
  { n: 4, slug: "death", question: "Did anyone close to you die?" },
  { n: 5, slug: "places-visited", question: "What cities/states/countries did you visit?" },
  { n: 6, slug: "lacked", question: "What would you like to have next year that you lacked this year?" },
  { n: 7, slug: "etched-dates", question: "What date(s) from this year will remain etched upon your memory, and why?" },
  { n: 8, slug: "achievement", question: "What was your biggest achievement of the year?" },
  { n: 9, slug: "failure", question: "What was your biggest failure?" },
  { n: 10, slug: "hardships", question: "What other hardships did you face?" },
  { n: 11, slug: "illness", question: "Did you suffer illness or injury?" },
  { n: 12, slug: "bought", question: "What was the best thing you bought?" },
  { n: 13, slug: "celebrate", question: "Whose behavior merited celebration?" },
  { n: 14, slug: "appalled", question: "Whose behavior made you appalled?" },
  { n: 15, slug: "money-went", question: "Where did most of your money go?" },
  { n: 16, slug: "excited", question: "What did you get really, really, really excited about?" },
  { n: 17, slug: "song", question: "What song will always remind you of this year?" },
  { n: 18, slug: "compared", question: "Compared to this time last year, are you: happier or sadder? Richer or poorer? Healthier or unhealthier?" },
  { n: 19, slug: "more-of", question: "What do you wish you'd done more of?" },
  { n: 20, slug: "less-of", question: "What do you wish you'd done less of?" },
  { n: 21, slug: "holidays", question: "How are you spending the holidays?" },
  { n: 22, slug: "love", question: "Did you fall in love this year?" },
  { n: 23, slug: "new-hatred", question: "Do you hate anyone now that you didn't hate this time last year?" },
  { n: 24, slug: "show", question: "What was your favorite show?" },
  { n: 25, slug: "book", question: "What was the best book you read?" },
  { n: 26, slug: "music", question: "What was your greatest musical discovery of the year?" },
  { n: 27, slug: "film", question: "What was your favorite film?" },
  { n: 28, slug: "meal", question: "What was your favorite meal?" },
  { n: 29, slug: "wanted-got", question: "What did you want and get?" },
  { n: 30, slug: "wanted-missed", question: "What did you want and not get?" },
  { n: 31, slug: "birthday", question: "What did you do on your birthday?" },
  { n: 32, slug: "satisfaction", question: "What one thing would have made your year immeasurably more satisfying?" },
  { n: 33, slug: "fashion", question: "How would you describe your personal fashion this year?" },
  { n: 34, slug: "sanity", question: "What kept you sane?" },
  { n: 35, slug: "admired", question: "Which celebrity/public figure did you admire the most?" },
  { n: 36, slug: "politics", question: "What political issue stirred you the most?" },
  { n: 37, slug: "missed", question: "Who did you miss?" },
  { n: 38, slug: "new-person", question: "Who was the best new person you met?" },
  { n: 39, slug: "lesson", question: "What valuable life lesson did you learn this year?" },
  { n: 40, slug: "quote", question: "What is a quote that sums up your year?" },
];

export const DECADE_QUESTIONS: readonly KepanoQuestion[] = [
  { n: 1, slug: "six-months", question: "What would you do if you had 6 months to live?" },
  { n: 2, slug: "billion", question: "What would you do if you had a billion dollars?" },
  { n: 3, slug: "advice-past", question: "What advice would you give yourself 10 years ago?" },
  { n: 4, slug: "same-future", question: "What do you hope will be the same 10 years from now?" },
  { n: 5, slug: "different-future", question: "What do you hope will be different 10 years from now?" },
  { n: 6, slug: "happiness", question: "What is your idea of perfect happiness?" },
  { n: 7, slug: "happiest", question: "When and where were you happiest?" },
  { n: 8, slug: "morning-purpose", question: "Why do you get out of bed in the morning?" },
  { n: 9, slug: "misery", question: "What do you consider the lowest depth of misery?" },
  { n: 10, slug: "trait", question: "What is your most marked characteristic?" },
  { n: 11, slug: "fear", question: "What is your greatest fear?" },
  { n: 12, slug: "deplore-self", question: "What is the trait you most deplore in yourself?" },
  { n: 13, slug: "deplore-others", question: "What is the trait you most deplore in others?" },
  { n: 14, slug: "lying", question: "On what occasion do you lie?" },
  { n: 15, slug: "extravagance", question: "What is your greatest extravagance?" },
  { n: 16, slug: "overrated-virtue", question: "What do you consider the most overrated virtue?" },
  { n: 17, slug: "appearance", question: "What do you most dislike about your appearance?" },
  { n: 18, slug: "change-self", question: "If you could change one thing about yourself, what would it be?" },
  { n: 19, slug: "talent", question: "Which talent would you most like to have?" },
  { n: 20, slug: "misunderstood", question: "What do people frequently misunderstand about you?" },
  { n: 21, slug: "quality-man", question: "What is the quality you most like in a man?" },
  { n: 22, slug: "quality-woman", question: "What is the quality you most like in a woman?" },
  { n: 23, slug: "friend-value", question: "What do you most value in your friends?" },
  { n: 24, slug: "greatest-achievement", question: "What do you consider your greatest achievement?" },
  { n: 25, slug: "gift-world", question: "If you could give everyone in the world one gift, what would it be?" },
  { n: 26, slug: "wasted-time", question: "What was your greatest waste of time?" },
  { n: 27, slug: "painful-worthwhile", question: "What do you find painful but worth doing?" },
  { n: 28, slug: "live-where", question: "Where would you most like to live?" },
  { n: 29, slug: "possession", question: "What is your most treasured possession?" },
  { n: 30, slug: "best-friend", question: "Who is your best friend?" },
  { n: 31, slug: "greatest-love", question: "Who or what is the greatest love of your life?" },
  { n: 32, slug: "living-admire", question: "Which living person do you most admire?" },
  { n: 33, slug: "fiction-hero", question: "Who is your hero of fiction?" },
  { n: 34, slug: "historical-identify", question: "Which historical figure do you most identify with?" },
  { n: 35, slug: "regret", question: "What is your greatest regret?" },
  { n: 36, slug: "death-wish", question: "How would you like to die?" },
  { n: 37, slug: "motto", question: "What is your motto?" },
  { n: 38, slug: "compliment", question: "What is the best compliment you ever received?" },
  { n: 39, slug: "luck", question: "What is the luckiest thing that happened to you?" },
  { n: 40, slug: "hopeful", question: "What makes you hopeful?" },
];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function filenameForQuestion(q: KepanoQuestion): string {
  return `${pad2(q.n)}-${q.slug}.md`;
}

/** ISO week math (duplicate of paths.ts helper to keep questions.ts self-contained). */
function isoWeekNumber(d: Date): number {
  const t = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  t.setDate(t.getDate() - dayNr + 3);
  const firstThursday = t.valueOf();
  t.setMonth(0, 1);
  if (t.getDay() !== 4) {
    t.setMonth(0, 1 + ((4 - t.getDay()) + 7) % 7);
  }
  return 1 + Math.ceil((firstThursday - t.valueOf()) / 604800000);
}

function isoYearNumber(d: Date): number {
  const t = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  t.setDate(t.getDate() - dayNr + 3);
  return t.getFullYear();
}

/** Deterministic: the same ISO week always gets the same question. */
export function questionOfWeek(today: Date = new Date()): KepanoQuestion {
  const wk = isoWeekNumber(today);
  const yr = isoYearNumber(today);
  return YEAR_QUESTIONS[(yr * 52 + wk) % 40];
}

/** Deterministic: the same calendar month always gets the same decade question. */
export function questionOfMonth(today: Date = new Date()): KepanoQuestion {
  const m = today.getMonth() + 1;
  const y = today.getFullYear();
  return DECADE_QUESTIONS[(y * 12 + m) % 40];
}

export const QS_YEAR_FOLDER = "🧑 Me/Reviews/Qs-Year";
export const QS_DECADE_FOLDER = "🧑 Me/Reviews/Qs-Decade";
