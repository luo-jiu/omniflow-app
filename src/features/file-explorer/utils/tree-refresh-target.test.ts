import { describe, expect, it } from 'vitest';
import { resolveTreeRefreshTargetId } from './tree-refresh-target';

describe('directory refresh target', () => {
  it('maps the empty-area menu to the actual root node', () => {
    expect(resolveTreeRefreshTargetId(null, 15943)).toBe(15943);
    expect(resolveTreeRefreshTargetId({ type: 'dir', id: 15971 }, 15943)).toBe(15971);
  });
  it('does not pretend that an unavailable root or file can be refreshed', () => {
    expect(resolveTreeRefreshTargetId(null, null)).toBeNull();
    expect(resolveTreeRefreshTargetId({ type: 'file', id: 32 }, 15943)).toBeNull();
  });
});
