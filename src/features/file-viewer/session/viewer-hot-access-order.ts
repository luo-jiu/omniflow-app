function normalizeTabId(tabId: string): string {
  const normalized = String(tabId || '');
  if (!normalized.trim()) {
    throw new TypeError('viewer hot access tabId must not be empty');
  }
  return normalized;
}

/**
 * Owns Hot LRU access metadata only. Render order remains owned by AppMain.
 */
export class ViewerHotAccessOrderOwner {
  private readonly accessOrders = new Map<string, number>();
  private sequence = 0;

  touch(tabId: string): number {
    const normalizedTabId = normalizeTabId(tabId);
    this.sequence += 1;
    this.accessOrders.set(normalizedTabId, this.sequence);
    return this.sequence;
  }

  retain(tabIds: string[]): void {
    const retained = new Set(tabIds.map(normalizeTabId));
    Array.from(this.accessOrders.keys()).forEach((tabId) => {
      if (!retained.has(tabId)) {
        this.accessOrders.delete(tabId);
      }
    });
  }

  get(tabId: string): number | null {
    return this.accessOrders.get(normalizeTabId(tabId)) ?? null;
  }

  snapshot(tabIds: string[]): Array<{ tabId: string; lastAccessOrder: number | null }> {
    return tabIds.map((tabId) => {
      const normalizedTabId = normalizeTabId(tabId);
      return {
        tabId: normalizedTabId,
        lastAccessOrder: this.accessOrders.get(normalizedTabId) ?? null,
      };
    });
  }
}
