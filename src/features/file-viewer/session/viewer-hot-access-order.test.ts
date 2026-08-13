import { describe, expect, it } from 'vitest';
import { ViewerHotAccessOrderOwner } from './viewer-hot-access-order';

describe('ViewerHotAccessOrderOwner', () => {
  it('tracks access independently from stable render order', () => {
    const owner = new ViewerHotAccessOrderOwner();

    owner.touch('tab-b');
    owner.touch('tab-a');

    expect(owner.snapshot(['tab-a', 'tab-b'])).toEqual([
      { tabId: 'tab-a', lastAccessOrder: 2 },
      { tabId: 'tab-b', lastAccessOrder: 1 },
    ]);
  });

  it('advances repeated access and forgets tabs that no longer exist', () => {
    const owner = new ViewerHotAccessOrderOwner();

    owner.touch('tab-a');
    owner.touch('tab-b');
    expect(owner.touch('tab-a')).toBe(3);
    owner.retain(['tab-a']);

    expect(owner.get('tab-a')).toBe(3);
    expect(owner.get('tab-b')).toBeNull();
  });

  it('rejects empty tab ids at the owner boundary', () => {
    const owner = new ViewerHotAccessOrderOwner();
    expect(() => owner.touch('  ')).toThrow('tabId');
  });

  it('treats tab ids as opaque values instead of rewriting them', () => {
    const owner = new ViewerHotAccessOrderOwner();
    owner.touch(' tab-a ');
    expect(owner.snapshot([' tab-a '])).toEqual([
      { tabId: ' tab-a ', lastAccessOrder: 1 },
    ]);
  });
});
