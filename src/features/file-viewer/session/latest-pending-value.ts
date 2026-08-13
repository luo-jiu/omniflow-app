interface PendingValueRef<TValue> {
  current: TValue | null;
}

export function acknowledgeLatestPendingValue<TValue>(
  pendingRef: PendingValueRef<TValue>,
  completedValue: TValue,
): boolean {
  if (pendingRef.current === completedValue) {
    pendingRef.current = null;
  }
  return pendingRef.current !== null;
}
