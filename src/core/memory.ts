export type MemoryScope = "user" | "project" | "task" | "conversation" | "execution";

export interface MemoryRecord {
  id: string;
  scope: MemoryScope;
  value: unknown;
  createdAt: string;
  metadata?: Record<string, unknown>;
}
