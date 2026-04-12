import type { SchedulerEvent } from "../types.js";

/**
 * Event source triggered by significant changes to the user's persona.
 * Fires when the persona's domain structure changes significantly
 * (new domain discovered, domain depth crosses a threshold, etc.)
 */
export class PersonaChangeSource {
  private listeners: Array<(event: SchedulerEvent) => void> = [];
  private previousDomainCount = 0;

  onEvent(listener: (event: SchedulerEvent) => void): void {
    this.listeners.push(listener);
  }

  /**
   * Call this after persona updates to check if a significant change occurred.
   */
  checkPersonaUpdate(domainCount: number, newDomains: string[]): void {
    // Trigger if: 2+ new domains discovered, or domain count changed significantly
    const domainDelta = Math.abs(domainCount - this.previousDomainCount);

    if (domainDelta >= 2 || newDomains.length >= 2) {
      const event: SchedulerEvent = {
        type: "persona_change",
        timestamp: Date.now(),
        payload: { newDomains, domainCount },
      };
      for (const listener of this.listeners) {
        listener(event);
      }
    }

    this.previousDomainCount = domainCount;
  }
}
