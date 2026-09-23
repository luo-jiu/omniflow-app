import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  current: true, active: true, event: undefined as ((value: any) => void) | undefined,
  authority: undefined as ((value: any) => void) | undefined, dispose: undefined as (() => void) | undefined,
  notify: vi.fn(), resolve: vi.fn(), complete: vi.fn(),
}));
vi.mock('@/service/auth-session-release', () => ({ registerAuthSessionRuntime: (input: { dispose: () => void }) => { mocks.dispose = input.dispose; return () => undefined; } }));
vi.mock('@/service/plugins/plugin-command.api', () => ({ pluginCommandApi: {
  available: () => true, isActiveScope: () => mocks.active, isCurrentScope: () => mocks.current,
  subscribe: (callback: (value: any) => void) => { mocks.event = callback; return () => { mocks.event = undefined; }; },
  onFileAuthorityRequest: (callback: (value: any) => void) => { mocks.authority = callback; return () => { mocks.authority = undefined; }; },
  completeFileAuthority: mocks.complete,
} }));
vi.mock('@/features/agent/services/agent-file-authority', () => ({ resolveAgentFileAuthority: mocks.resolve }));
vi.mock('@/features/file-explorer/services/node-mutation-events', () => ({ notifyLibraryNodesMutated: mocks.notify }));
vi.mock('./command-projection', () => ({ commandCommittedMutation: () => ({ parentIds: [9], renamed: [{ nodeId: 12, parentId: 9, name: 'new', ext: 'txt' }] }) }));
import { startPluginCommandRuntime } from './command-runtime';

beforeEach(() => { vi.clearAllMocks(); mocks.current = true; mocks.active = true; mocks.complete.mockResolvedValue(true); });
afterEach(() => mocks.dispose?.());
describe('manual command runtime outside the tool panel', () => {
  it('publishes a completion once without a mounted workspace and rejects stale revisions', () => {
    startPluginCommandRuntime();
    mocks.active = false;
    const event = { id: 'execution', revision: 3, libraryId: 3, ownerScope: { accountScope: 'user:7', backendScope: 'https://example.test/api' } };
    mocks.event?.(event); mocks.event?.(event); mocks.event?.({ ...event, revision: 2 });
    expect(mocks.notify).toHaveBeenCalledOnce();
    expect(mocks.notify).toHaveBeenCalledWith({ ...event.ownerScope, libraryId: 3, nodeId: 12, parentId: 9, name: 'new', ext: 'txt', type: 'file', affectedParentIds: [9] });
  });
  it('does not return credentials after the command scope is released during resolution', async () => {
    let resolve!: (value: unknown) => void;
    mocks.resolve.mockImplementation(() => new Promise(done => { resolve = done; }));
    startPluginCommandRuntime();
    mocks.authority?.({ authorityId: 'authority', libraryId: 3, ownerScope: { accountScope: 'user:7', backendScope: 'https://example.test/api' }, runId: 'manual:1', sessionId: 'manual:1', toolRunId: 'manual:1' });
    mocks.active = false;
    resolve({ credentials: { token: 'test-token', username: 'test-user' } });
    await Promise.resolve(); await Promise.resolve();
    expect(mocks.complete).not.toHaveBeenCalled();
  });
});
