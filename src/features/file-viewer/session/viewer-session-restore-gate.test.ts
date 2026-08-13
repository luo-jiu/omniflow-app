import { describe, expect, it } from 'vitest';
import { ViewerSessionRestoreGate } from './viewer-session-restore-gate';

describe('ViewerSessionRestoreGate', () => {
  it('accepts Cold only while no higher-priority state or interaction exists', async () => {
    const gate = new ViewerSessionRestoreGate();
    expect(gate.canApplyCold({ hasNewerWarmSnapshot: false })).toBe(true);
    gate.settle('cold');
    await expect(gate.wait()).resolves.toBe('cold');
    expect(gate.canApplyCold({ hasNewerWarmSnapshot: false })).toBe(false);
  });

  it('rejects a late Cold result after user interaction', async () => {
    const gate = new ViewerSessionRestoreGate();
    gate.markInteracted();
    expect(gate.canApplyCold({ hasNewerWarmSnapshot: false })).toBe(false);
    await expect(gate.wait()).resolves.toBe('blocked');
  });

  it('rejects Cold when a newer Warm snapshot appeared', () => {
    const gate = new ViewerSessionRestoreGate();
    expect(gate.canApplyCold({ hasNewerWarmSnapshot: true })).toBe(false);
  });

  it('settles disposed generations without accepting later results', async () => {
    const gate = new ViewerSessionRestoreGate();
    expect(gate.getSettledSource()).toBeNull();
    gate.dispose();
    gate.settle('cold');
    await expect(gate.wait()).resolves.toBe('blocked');
    expect(gate.getSettledSource()).toBe('blocked');
  });
});
