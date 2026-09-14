export function isNamespacedContributionId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 128 && /^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(value);
}

// Host-owned registration infrastructure. Not exposed to plugin code or IPC.
export class ContributionRegistry<T extends { readonly id: string }> {
  private entries = new Map<string, { value: Readonly<T>; batch: symbol }>();
  private snapshot: readonly Readonly<T>[] = Object.freeze([]);
  private listeners = new Set<() => void>();
  constructor(private readonly validate: (value: T, owner: string) => void) {}

  get = (id: string): Readonly<T> | undefined => this.entries.get(id)?.value;
  getSnapshot = (): readonly Readonly<T>[] => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  registerBatch(owner: string, values: readonly T[]): () => void {
    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(owner) || owner.length > 96 || values.length === 0 || values.length > 128 || this.entries.size + values.length > 1024) throw new Error('Invalid contribution batch');
    const seen = new Set<string>();
    const prepared = values.map(value => {
      this.validate(value, owner);
      if (seen.has(value.id) || this.entries.has(value.id)) throw new Error(`Duplicate contribution: ${value.id}`);
      seen.add(value.id);
      return Object.freeze({ ...value });
    });
    const batch = Symbol(owner);
    prepared.forEach(value => this.entries.set(value.id, { value, batch }));
    this.publish();
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      for (const value of prepared) if (this.entries.get(value.id)?.batch === batch) this.entries.delete(value.id);
      this.publish();
    };
  }
  private publish() {
    this.snapshot = Object.freeze([...this.entries.values()].map(entry => entry.value));
    for (const listener of this.listeners) {
      try { listener(); } catch (error) { console.error('Host contribution subscriber failed', error); }
    }
  }
}
