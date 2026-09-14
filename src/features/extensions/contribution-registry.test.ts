import { describe, expect, it, vi } from 'vitest';
import { ContributionRegistry, isNamespacedContributionId } from './contribution-registry';
import { HostCommandRegistry } from './host-command-registry';

function registry() {
  return new ContributionRegistry<{ id: string; title: string }>((item, owner) => {
    if (!isNamespacedContributionId(item.id) || !item.id.startsWith(`${owner}.`)) throw new Error('Invalid owner');
  });
}
describe('host contribution batches', () => {
  it('publishes one immutable snapshot and does not mutate it when registering another batch', () => {
    const r = registry(); const listener = vi.fn(); r.subscribe(listener);
    const input = { id: 'example.first', title: 'Original' };
    r.registerBatch('example', [input]);
    const previous = r.getSnapshot();
    input.title = 'Changed';
    expect(r.get('example.first')?.title).toBe('Original');
    r.registerBatch('example', [{ id: 'example.second', title: 'Second' }]);
    expect(previous).toHaveLength(1);
    expect(r.getSnapshot()).toHaveLength(2);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(Object.isFrozen(r.getSnapshot())).toBe(true);
  });
  it('rejects a conflicting or invalid batch without partially publishing earlier entries', () => {
    const r = registry(); r.registerBatch('example', [{ id: 'example.existing', title: 'Existing' }]);
    const before = r.getSnapshot();
    for (const bad of ['example.existing', 'foreign.other']) {
      expect(() => r.registerBatch('example', [{ id: 'example.new', title: 'New' }, { id: bad, title: 'Bad' }])).toThrow();
      expect(r.getSnapshot()).toBe(before);
      expect(r.get('example.new')).toBeUndefined();
    }
    expect(() => r.registerBatch('example', [{ id: 'example.same', title: '' }, { id: 'example.same', title: '' }])).toThrow('Duplicate');
  });
  it('does not let repeated old cleanup remove a replacement registration', () => {
    const r = registry();
    const dispose = r.registerBatch('example', [{ id: 'example.tool', title: 'Old' }]);
    dispose();
    r.registerBatch('example', [{ id: 'example.tool', title: 'New' }]);
    dispose();
    expect(r.get('example.tool')?.title).toBe('New');
  });
  it('stops notifying unsubscribed consumers', () => {
    const r = registry(); const listener = vi.fn(); const stop = r.subscribe(listener); stop();
    r.registerBatch('example', [{ id: 'example.tool', title: 'Tool' }]);
    expect(listener).not.toHaveBeenCalled();
  });
});
describe('host command execution', () => {
  it('validates arguments and context again at execution, and never exposes an extension callable', async () => {
    const r = new HostCommandRegistry<{ enabled: boolean }>();
    const run = vi.fn();
    r.registerBatch('example', [{ id: 'example.open', title: 'Open', argumentSchema: 'id', exposure: 'host-only', isEnabled: ctx => ctx.enabled, run }]);
    expect(() => r.executeHost('example.open', '../escape', { enabled: true })).toThrow();
    expect(() => r.executeHost('example.open', 'example.tool', { enabled: false })).toThrow('disabled');
    expect(run).not.toHaveBeenCalled();
    await r.executeHost('example.open', 'example.tool', { enabled: true });
    expect(run).toHaveBeenCalledWith({ enabled: true }, 'example.tool');
    expect(() => r.registerBatch('example', [{ id: 'example.bad', title: 'Bad', argumentSchema: 'none', exposure: 'plugin' as never, isEnabled: () => true, run }])).toThrow();
  });
});
