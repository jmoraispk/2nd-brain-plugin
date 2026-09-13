import type { ProviderUsageEvent } from "./usageHistory";

export type UsageEventSink = (
  event: ProviderUsageEvent
) => void | Promise<void>;

let sink: UsageEventSink | undefined;

export function configureUsageEventSink(next?: UsageEventSink): void {
  sink = next;
}

export async function emitUsageEvent(event: ProviderUsageEvent): Promise<void> {
  try {
    await sink?.(event);
  } catch {
    // Usage bookkeeping must never fail the user's AI action.
  }
}
