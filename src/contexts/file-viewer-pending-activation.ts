// 跨路由"待激活 tab"协调器。
// 用于：MediaHub 在非资料库路由下点 entry 跳转 → 先 setPendingActivation(libraryId, tabId)，
// 再 navigate 到 /libraries/:id；FileViewerProvider 重 mount 或同库内重复触发时，
// 根据匹配的 libraryId 取走 pending 并 setActiveTabId。
//
// 详见 docs/media-hub-contract.md。

let pending: { libraryId: number; tabId: string } | null = null;
const listeners = new Set<() => void>();

export function setPendingActivation(libraryId: number, tabId: string): void {
  pending = { libraryId, tabId };
  listeners.forEach((fn) => fn());
}

// peek：读但不清。Provider 在 setActiveTabId 成功后调 commit 清空。
// 拆 peek+commit 是为了在 StrictMode 双 mount / 或 setState reducer 内 tab 不存在时，
// pending 还能保留给下一次 effect / emit 重试，不至于一次取空就丢。
export function peekPendingActivation(libraryId: number): string | null {
  if (!pending || pending.libraryId !== libraryId) return null;
  return pending.tabId;
}

export function commitPendingActivation(libraryId: number, tabId: string): void {
  if (!pending) return;
  if (pending.libraryId === libraryId && pending.tabId === tabId) {
    pending = null;
  }
}

export function subscribePendingActivation(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
