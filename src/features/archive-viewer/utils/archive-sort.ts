export interface ArchiveSortableItem {
  no?: unknown;
  sortOrder?: unknown;
  sort_order?: unknown;
}

function toFiniteNumberOrNull(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function resolveArchiveSortOrder(item: ArchiveSortableItem): number | null {
  return (
    toFiniteNumberOrNull(item.no)
    ?? toFiniteNumberOrNull(item.sortOrder)
    ?? toFiniteNumberOrNull(item.sort_order)
  );
}

export function sortArchiveItemsByOrder<T extends ArchiveSortableItem>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index, order: resolveArchiveSortOrder(item) }))
    .sort((a, b) => {
      const aHasOrder = a.order !== null;
      const bHasOrder = b.order !== null;
      if (aHasOrder && bHasOrder && a.order !== b.order) {
        return (a.order as number) - (b.order as number);
      }
      if (aHasOrder !== bHasOrder) {
        return aHasOrder ? -1 : 1;
      }
      // 稳定保序：当缺少排序字段时保持后端返回顺序。
      return a.index - b.index;
    })
    .map(entry => entry.item);
}
