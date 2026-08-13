import { describe, expect, it } from 'vitest';
import { acknowledgeLatestPendingValue } from './latest-pending-value';

describe('acknowledgeLatestPendingValue', () => {
  it('clears the value that just completed', () => {
    const completed = { position: 10 };
    const pendingRef = { current: completed };

    expect(acknowledgeLatestPendingValue(pendingRef, completed)).toBe(false);
    expect(pendingRef.current).toBeNull();
  });

  it('preserves a newer value queued while the previous value was in flight', () => {
    const completed = { position: 10 };
    const latest = { position: 20 };
    const pendingRef = { current: latest };

    expect(acknowledgeLatestPendingValue(pendingRef, completed)).toBe(true);
    expect(pendingRef.current).toBe(latest);
  });
});
