export interface TraceEvent {
  at: string;
  phase: string;
  message: string;
  data?: Record<string, unknown>;
}

export class ObservabilityLog {
  private events: TraceEvent[] = [];

  record(phase: string, message: string, data?: Record<string, unknown>): void {
    this.events.push({ at: new Date().toISOString(), phase, message, data });
  }

  list(): TraceEvent[] {
    return [...this.events];
  }
}
