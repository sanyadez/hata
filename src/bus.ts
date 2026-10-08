/** In-process pub/sub. Subscribers are the SSE connections of the web UI. */

export interface BusEvent {
  type: string;
  ts: number;
  [key: string]: unknown;
}

type Listener = (event: BusEvent) => void;

export class Bus {
  private listeners = new Set<Listener>();

  publish(type: string, data: Record<string, unknown> = {}): void {
    const event: BusEvent = { type, ts: Date.now(), ...data };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // a dead subscriber must not break delivery to the others
      }
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get subscriberCount(): number {
    return this.listeners.size;
  }
}

export const bus = new Bus();
