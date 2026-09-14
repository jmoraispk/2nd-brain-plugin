export type DaytraceRangeStatus =
  | "generated"
  | "unchanged"
  | "fallback"
  | "failed";

export type DaytraceRangeEntry<T> =
  | { date: string; status: Exclude<DaytraceRangeStatus, "failed">; result: T }
  | { date: string; status: "failed"; error: Error };

/** Return every ISO date in the inclusive selected range. */
export function daytraceDatesInRange(start: string, end: string): string[] {
  if (start > end) return [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const dates: string[] = [];
  while (cursor.toISOString().slice(0, 10) <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/** Process selected days one at a time and retain per-day failures. */
export async function processDaytraceRange<
  T extends { summaryStatus: Exclude<DaytraceRangeStatus, "failed"> },
>(
  dates: string[],
  processDay: (date: string, index: number, total: number) => Promise<T>,
  onDayStart?: (date: string, index: number, total: number) => void
): Promise<DaytraceRangeEntry<T>[]> {
  const entries: DaytraceRangeEntry<T>[] = [];
  for (let index = 0; index < dates.length; index += 1) {
    const date = dates[index];
    try {
      onDayStart?.(date, index, dates.length);
      const result = await processDay(date, index, dates.length);
      entries.push({ date, status: result.summaryStatus, result });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "name" in error &&
        error.name === "AbortError"
      ) {
        throw error;
      }
      entries.push({
        date,
        status: "failed",
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }
  return entries;
}
