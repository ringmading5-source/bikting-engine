/** Small reusable registry that rejects accidental identifier collisions. */
export class Registry<T extends { id: string }> {
  private entries = new Map<string, T>();

  register(entry: T): T {
    if (this.entries.has(entry.id)) {
      throw new Error(`Registry already contains: ${entry.id}`);
    }
    this.entries.set(entry.id, entry);
    return entry;
  }

  get(id: string): T | undefined {
    return this.entries.get(id);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  list(): T[] {
    return [...this.entries.values()];
  }
}
