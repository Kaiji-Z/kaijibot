import type { SchedulerEvent } from "../types.js";

const PERSONA_CHANGE_DEBOUNCE_MS = 5 * 60 * 1000;

/** Payload of a `persona_change` event: whose domains moved, and how. */
export type PersonaChangePayload = {
  /** The user whose persona changed. The event concerns them alone: its new
   *  domains become insight targets, so it must not reach other users. */
  userId: string;
  newDomains: string[];
  domainCount: number;
};

/**
 * Hand one scheduler event to the known (agent, user) entries.
 *
 * Most events are broadcasts. A persona change is not: its payload names the
 * domains one user just picked up and those become insight targets, so sending
 * it to everybody would aim that user's new topics at people who never
 * mentioned them. Such an event reaches only the user it concerns, and is
 * dropped when the payload does not name one.
 */
export async function dispatchSchedulerEvent(
  event: SchedulerEvent,
  entries: ReadonlyArray<{ agentId: string; userId: string }>,
  processEntry: (entry: { agentId: string; userId: string }) => Promise<void>,
): Promise<void> {
  let targetUserId: string | null = null;
  if (event.type === "persona_change") {
    const payload = event.payload as Partial<PersonaChangePayload> | undefined;
    targetUserId = typeof payload?.userId === "string" && payload.userId ? payload.userId : null;
    if (!targetUserId) {
      return;
    }
  }
  for (const entry of entries) {
    if (targetUserId !== null && entry.userId !== targetUserId) {
      continue;
    }
    await processEntry(entry);
  }
}

/**
 * Event source triggered by significant changes to the user's persona.
 * Fires when the persona's domain structure changes significantly
 * (2+ new domains discovered, or domain count changes by 2+).
 *
 * Per-user tracking prevents cross-user interference. First call per user
 * establishes a baseline without firing (prevents mass-trigger on restart).
 * A 5-minute per-user debounce prevents feedback loops where savePersona →
 * persona_change → processEvent → _finalizeDelivery → savePersona cycles.
 */
export class PersonaChangeSource {
  private listeners: Array<(event: SchedulerEvent) => void> = [];
  private previousDomainsByUser = new Map<string, Set<string>>();
  private lastFiredByUser = new Map<string, number>();

  onEvent(listener: (event: SchedulerEvent) => void): void {
    this.listeners.push(listener);
  }

  checkPersonaUpdate(userId: string, currentDomains: string[]): void {
    const current = new Set(currentDomains);
    const previous = this.previousDomainsByUser.get(userId);

    if (!previous) {
      this.previousDomainsByUser.set(userId, current);
      return;
    }

    const trulyNew = currentDomains.filter((d) => !previous.has(d));
    const removed = [...previous].filter((d) => !current.has(d));
    const domainDelta = trulyNew.length + removed.length;

    this.previousDomainsByUser.set(userId, current);

    if (domainDelta < 2 && trulyNew.length < 2) {
      return;
    }

    const now = Date.now();
    const lastFired = this.lastFiredByUser.get(userId) ?? 0;
    if (now - lastFired < PERSONA_CHANGE_DEBOUNCE_MS) {
      return;
    }
    this.lastFiredByUser.set(userId, now);

    const event: SchedulerEvent = {
      type: "persona_change",
      timestamp: now,
      payload: {
        userId,
        newDomains: trulyNew,
        domainCount: currentDomains.length,
      } satisfies PersonaChangePayload,
    };
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
