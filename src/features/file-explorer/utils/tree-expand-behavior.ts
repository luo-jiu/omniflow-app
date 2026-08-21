export interface TreeExpandDoubleClickEvent {
  preventDefault: () => void;
  stopPropagation: () => void;
  nativeEvent?: {
    stopImmediatePropagation?: () => void;
  };
}

export type PendingTreeExpandDecision = 'wait' | 'expand' | 'cancel';

export function containTreeExpandDoubleClick(event: TreeExpandDoubleClickEvent): void {
  event.preventDefault();
  event.stopPropagation();
  event.nativeEvent?.stopImmediatePropagation?.();
}

export function resolvePendingTreeExpandDecision(options: {
  pendingRepositoryId: string;
  selectedRepositoryId: string;
  nodeExists: boolean;
  nodeType?: string;
  nodeLoaded?: boolean;
}): PendingTreeExpandDecision {
  if (options.pendingRepositoryId !== options.selectedRepositoryId) {
    return 'cancel';
  }
  if (!options.nodeExists || options.nodeType !== 'dir') {
    return 'cancel';
  }
  return options.nodeLoaded === true ? 'expand' : 'wait';
}
