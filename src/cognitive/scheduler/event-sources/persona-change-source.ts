import type { SchedulerEvent } from "../types.js";

const PERSONA_CHANGE_DEBOUNCE_MS = 5 * 60 * 1000;

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
      payload: { newDomains: trulyNew, domainCount: currentDomains.length },
    };
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
