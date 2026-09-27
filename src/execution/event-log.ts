import { ExecutionEvent, ExecutionEventType } from "./events";

export interface AppendExecutionEvent {
  type: ExecutionEventType;
  projectId: string;
  data?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  taskId?: string;
  providerId?: string;
  causationId?: string;
}

/** Deterministic, append-only event collector for shadow orchestration. */
export class InMemoryExecutionEventLog {
  private readonly events: ExecutionEvent[] = [];
  constructor(readonly runId: string, private readonly clock: (sequence: number) => string = () => "1970-01-01T00:00:00.000Z") {}

  append(input: AppendExecutionEvent): ExecutionEvent {
    const sequence = this.events.length + 1;
    const event = deepFreeze({ ...structuredClone(input), id: `${this.runId}:${sequence}`, runId: this.runId, correlationId: this.runId, sequence, occurredAt: this.clock(sequence) });
    this.events.push(event);
    return event;
  }

  list(): ExecutionEvent[] { return this.events.map((event) => structuredClone(event)); }
}

function deepFreeze<T>(value: T): T { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item); return Object.freeze(value); }
