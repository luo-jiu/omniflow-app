import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateFileOverlayProps, CreateFileResult } from '@/service/overlay/types';
import type { ProviderListResponse } from '@/features/storage-config/services/storage-config.api';
import type { StorageProviderAvailability } from '@/features/resource-monitor/services/storage-provider-health';

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  fetchProviders: vi.fn(),
  start: vi.fn(),
  refresh: vi.fn(),
  subscribe: vi.fn(),
  getState: vi.fn(),
  getProbeStatus: vi.fn(),
  ensureAvailable: vi.fn(),
  create: vi.fn(),
  write: vi.fn(),
  softDelete: vi.fn(),
  hardDelete: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  logWarning: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('@douyinfe/semi-ui', () => ({
  Toast: { success: mocks.success, warning: mocks.warning, error: mocks.error },
}));
vi.mock('@/service/overlay/overlay.api', () => ({ openOverlaySession: mocks.open }));
vi.mock('@/features/storage-config/services/storage-config.api', () => ({ fetchProviders: mocks.fetchProviders }));
vi.mock('@/features/resource-monitor/services/resource-monitor-runtime', () => ({
  resourceMonitorProbeRuntime: {
    start: mocks.start,
    refresh: mocks.refresh,
    subscribe: mocks.subscribe,
    getState: mocks.getState,
  },
}));
vi.mock('@/features/resource-monitor/services/storage-provider-health', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/resource-monitor/services/storage-provider-health')>();
  return {
    ...actual,
    getStorageProviderProbeStatus: mocks.getProbeStatus,
    ensureStorageProviderAvailable: mocks.ensureAvailable,
  };
});
vi.mock('../services/file.api', () => ({
  createNode: mocks.create,
  updateNodeFileContent: mocks.write,
  deleteNodeAndChildren: mocks.softDelete,
  hardDeleteNodeAndChildren: mocks.hardDelete,
}));
vi.mock('@/utils/runtimeLogger', () => ({
  runtimeLogger: { warn: mocks.logWarning, error: mocks.logError },
}));

import { useCreateFileOverlay } from './useCreateFileOverlay';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeSession(props: CreateFileOverlayProps) {
  const result = deferred<CreateFileResult>();
  return {
    props,
    result: result.promise,
    resolve: result.resolve,
    cancel: vi.fn(async () => {
      result.resolve({ type: 'cancel' });
      return true;
    }),
    updateProps: vi.fn<(props: CreateFileOverlayProps) => Promise<boolean>>().mockResolvedValue(true),
  };
}

const providerData: ProviderListResponse = {
  defaultProvider: 'local-minio',
  providers: [{
    alias: 'local-minio',
    type: 'minio',
    endpoint: 'localhost:9000',
    bucket: 'test-fixtures',
    label: 'Local storage',
    useSSL: false,
    region: '',
    accessKey: 'fixture-access-key',
    secretKey: 'fixture-secret-key',
  }],
};
const confirmed: CreateFileResult = { type: 'confirm', name: ' draft.ts ', storageProvider: 'local-minio' };
const available: StorageProviderAvailability = { available: true, message: '', status: 'ok' };
const createdNode = { id: 31, libraryId: 3, parentId: 20, name: 'draft', ext: 'ts', type: 'file' };
const savedNode = { ...createdNode, storageProvider: 'local-minio', fileSize: 0 };
const scopeChanges = [
  { label: 'library', libraryId: 4, accountScope: 'user:7' },
  { label: 'account', libraryId: 3, accountScope: 'user:8' },
];

let renderer: TestRenderer.ReactTestRenderer | undefined;
let show: ReturnType<typeof useCreateFileOverlay>;
let sessions: ReturnType<typeof makeSession>[];
let subscriptions: Array<{ notify: () => void; unsubscribe: ReturnType<typeof vi.fn> }>;

function Probe({ libraryId = 3, accountScope = 'user:7' }: { libraryId?: number; accountScope?: string }) {
  show = useCreateFileOverlay({ libraryId, accountScope });
  return null;
}

function mount() {
  act(() => { renderer = TestRenderer.create(<Probe />); });
}

function begin() {
  let pending!: ReturnType<typeof show>;
  act(() => { pending = show(20); });
  return pending;
}

beforeEach(() => {
  vi.resetAllMocks();
  sessions = [];
  subscriptions = [];
  mocks.open.mockImplementation((_type: string, props: CreateFileOverlayProps) => {
    const session = makeSession(props);
    sessions.push(session);
    return session;
  });
  mocks.subscribe.mockImplementation((notify: () => void) => {
    const unsubscribe = vi.fn();
    subscriptions.push({ notify, unsubscribe });
    return unsubscribe;
  });
  mocks.fetchProviders.mockResolvedValue(providerData);
  mocks.refresh.mockResolvedValue(undefined);
  mocks.getState.mockReturnValue({ snapshot: null });
  mocks.getProbeStatus.mockReturnValue('ok');
  mocks.ensureAvailable.mockResolvedValue(available);
  mocks.create.mockResolvedValue(createdNode);
  mocks.write.mockResolvedValue(savedNode);
  mocks.softDelete.mockResolvedValue(true);
  mocks.hardDelete.mockResolvedValue(true);
});

afterEach(() => {
  act(() => { renderer?.unmount(); });
  renderer = undefined;
  vi.restoreAllMocks();
});

describe('useCreateFileOverlay', () => {
  it('does not update or create after cancellation when providers arrive late, and allows reopening', async () => {
    const providers = deferred<ProviderListResponse>();
    mocks.fetchProviders.mockReturnValueOnce(providers.promise);
    mount();
    const pending = begin();
    expect(sessions[0].props.providerLoading).toBe(true);

    await act(async () => { sessions[0].resolve({ type: 'cancel' }); await pending; });
    expect(subscriptions[0].unsubscribe).toHaveBeenCalledOnce();
    await act(async () => { providers.resolve(providerData); subscriptions[0].notify(); });
    expect(sessions[0].updateProps).not.toHaveBeenCalled();
    expect(mocks.ensureAvailable).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    await expect(pending).resolves.toBeNull();

    const reopened = begin();
    expect(sessions).toHaveLength(2);
    await act(async () => { sessions[1].resolve({ type: 'cancel' }); await reopened; });
  });

  it('keeps repeated requests single-flight through confirmation and the availability check', async () => {
    const health = deferred<StorageProviderAvailability>();
    mocks.ensureAvailable.mockReturnValueOnce(health.promise);
    mount();
    const pending = begin();
    await act(async () => { await expect(show(20)).resolves.toBeNull(); });
    expect(sessions).toHaveLength(1);
    expect(mocks.fetchProviders).toHaveBeenCalledOnce();

    await act(async () => { sessions[0].resolve(confirmed); });
    expect(mocks.ensureAvailable).toHaveBeenCalledWith('local-minio');
    await act(async () => { await expect(show(20)).resolves.toBeNull(); });
    expect(sessions).toHaveLength(1);
    expect(mocks.create).not.toHaveBeenCalled();

    await act(async () => { health.resolve(available); await pending; });
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledWith({
      name: 'draft', ext: 'ts', parentId: 20, libraryId: 3, type: 'file',
    });
    expect(mocks.write).toHaveBeenCalledOnce();
    expect(mocks.write).toHaveBeenCalledWith({
      nodeId: 31, libraryId: 3, content: '', contentType: 'text/plain; charset=utf-8', storageProvider: 'local-minio',
    });
    expect(mocks.success).toHaveBeenCalledOnce();
    await expect(pending).resolves.toEqual(savedNode);
  });

  it('projects live provider health without passing storage credentials to the overlay', async () => {
    mount();
    const pending = begin();
    await act(async () => { await Promise.resolve(); });
    expect(sessions[0].updateProps).toHaveBeenLastCalledWith(expect.objectContaining({
      providerLoading: false,
      defaultProvider: 'local-minio',
      providers: [{
        alias: 'local-minio', type: 'minio', endpoint: 'localhost:9000', bucket: 'test-fixtures',
        label: 'Local storage', useSSL: false, healthStatus: 'ok',
      }],
    }));
    mocks.getProbeStatus.mockReturnValue('error');
    act(() => subscriptions[0].notify());
    expect(sessions[0].updateProps.mock.lastCall?.[0].providers[0].healthStatus).toBe('error');
    await act(async () => { sessions[0].resolve({ type: 'cancel' }); await pending; });
  });

  it('reuses fresh probes for consecutive file creations within one minute', async () => {
    const checkedAt = 2_000_000_000_000;
    let now = checkedAt + 10_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    mocks.getState.mockReturnValue({
      snapshot: { probes: [{ kind: 'object_storage', provider: 'local-minio', status: 'ok', checkedAt: new Date(checkedAt).toISOString() }] },
    });
    mount();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const pending = begin();
      await act(async () => { await Promise.resolve(); });
      expect(mocks.refresh).not.toHaveBeenCalled();
      await act(async () => { sessions[attempt].resolve(confirmed); await pending; });
      await expect(pending).resolves.toEqual(savedNode);
      now += 30_000;
    }
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it.each(['stale', 'missing'])('refreshes %s probes after providers become available', async probeState => {
    const providers = deferred<ProviderListResponse>();
    mocks.fetchProviders.mockReturnValueOnce(providers.promise);
    mocks.getState.mockReturnValue({
      snapshot: { probes: probeState === 'missing' ? [] : [{
        kind: 'object_storage', provider: 'local-minio', status: 'ok', checkedAt: new Date(Date.now() - 61_000).toISOString(),
      }] },
    });
    mount();
    const pending = begin();
    expect(mocks.refresh).not.toHaveBeenCalled();
    await act(async () => { providers.resolve(providerData); });
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.refresh).toHaveBeenCalledWith({ silent: true });
    await act(async () => { sessions[0].resolve({ type: 'cancel' }); await pending; });
  });

  it('reopens with the submitted name and provider after an unavailable storage check and permits retry', async () => {
    mocks.ensureAvailable.mockResolvedValueOnce({ available: false, message: 'Storage is offline', status: 'error' });
    mount();
    const pending = begin();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { sessions[0].resolve(confirmed); });

    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(sessions[1].props).toMatchObject({
      initialName: ' draft.ts ', initialStorageProvider: 'local-minio', errorMessage: 'Storage is offline',
    });
    expect(subscriptions[0].unsubscribe).toHaveBeenCalledOnce();
    await act(async () => { sessions[1].resolve(confirmed); await pending; });
    expect(mocks.ensureAvailable).toHaveBeenCalledTimes(2);
    expect(mocks.create).toHaveBeenCalledOnce();
    await expect(pending).resolves.toEqual(savedNode);
  });

  it.each(['none', 'soft-delete', 'hard-delete'])('cleans up a failed initial write and keeps its draft for retry when cleanup failure is %s', async cleanupFailure => {
    mocks.write.mockRejectedValueOnce(new Error('Initial content write failed'));
    if (cleanupFailure === 'soft-delete') mocks.softDelete.mockRejectedValueOnce(new Error('Soft delete failed'));
    if (cleanupFailure === 'hard-delete') mocks.hardDelete.mockRejectedValueOnce(new Error('Hard delete failed'));
    mount();
    const pending = begin();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { sessions[0].resolve(confirmed); });

    expect(mocks.softDelete).toHaveBeenCalledOnce();
    expect(mocks.softDelete).toHaveBeenCalledWith(31, 3);
    expect(mocks.hardDelete).toHaveBeenCalledOnce();
    expect(mocks.hardDelete).toHaveBeenCalledWith(31, 3);
    expect(mocks.softDelete.mock.invocationCallOrder[0]).toBeLessThan(mocks.hardDelete.mock.invocationCallOrder[0]);
    expect(sessions[1].props).toMatchObject({
      initialName: ' draft.ts ', initialStorageProvider: 'local-minio', errorMessage: 'Initial content write failed',
    });
    expect(mocks.success).not.toHaveBeenCalled();

    await act(async () => { sessions[1].resolve(confirmed); await pending; });
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.write).toHaveBeenCalledTimes(2);
    expect(mocks.success).toHaveBeenCalledOnce();
    await expect(pending).resolves.toEqual(savedNode);
  });

  it.each(scopeChanges)('ignores a late confirmation after changing $label', async scope => {
    mount();
    const pending = begin();
    await act(async () => { await Promise.resolve(); });
    act(() => { renderer?.update(<Probe libraryId={scope.libraryId} accountScope={scope.accountScope} />); });
    expect(sessions[0].cancel).toHaveBeenCalledOnce();
    expect(subscriptions[0].unsubscribe).toHaveBeenCalledOnce();
    await act(async () => { await pending; });
    await expect(pending).resolves.toBeNull();
    sessions[0].updateProps.mockClear();

    await act(async () => { subscriptions[0].notify(); sessions[0].resolve(confirmed); await pending; });
    expect(sessions[0].updateProps).not.toHaveBeenCalled();
    expect(mocks.ensureAvailable).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    await expect(pending).resolves.toBeNull();

    const reopened = begin();
    expect(sessions).toHaveLength(2);
    await act(async () => { sessions[1].resolve({ type: 'cancel' }); await reopened; });
  });

  it.each(scopeChanges)('ignores a late availability result after changing $label', async scope => {
    const health = deferred<StorageProviderAvailability>();
    mocks.ensureAvailable.mockReturnValueOnce(health.promise);
    mount();
    const pending = begin();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { sessions[0].resolve(confirmed); });
    expect(mocks.ensureAvailable).toHaveBeenCalledOnce();
    act(() => { renderer?.update(<Probe libraryId={scope.libraryId} accountScope={scope.accountScope} />); });

    await act(async () => { health.resolve(available); await pending; });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(sessions).toHaveLength(1);
    await expect(pending).resolves.toBeNull();
  });

  it('does not write or compensate with another account after a delayed node creation', async () => {
    const creation = deferred<typeof createdNode>();
    mocks.create.mockReturnValueOnce(creation.promise);
    mount();
    const pending = begin();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { sessions[0].resolve(confirmed); });
    expect(mocks.create).toHaveBeenCalledOnce();
    act(() => { renderer?.update(<Probe accountScope="user:8" />); });

    await act(async () => { creation.resolve(createdNode); await pending; });
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.softDelete).not.toHaveBeenCalled();
    expect(mocks.hardDelete).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(sessions).toHaveLength(1);
    await expect(pending).resolves.toBeNull();
  });

  it('does not start rollback with another account after a delayed failed content write', async () => {
    const write = deferred<typeof savedNode>();
    mocks.write.mockReturnValueOnce(write.promise);
    mount();
    const pending = begin();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { sessions[0].resolve(confirmed); });
    expect(mocks.write).toHaveBeenCalledOnce();
    act(() => { renderer?.update(<Probe accountScope="user:8" />); });

    await act(async () => { write.reject(new Error('Delayed write failure')); await pending; });
    expect(mocks.softDelete).not.toHaveBeenCalled();
    expect(mocks.hardDelete).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(sessions).toHaveLength(1);
    await expect(pending).resolves.toBeNull();
  });

  it('does not continue rollback with another account after a delayed soft delete', async () => {
    const cleanup = deferred<boolean>();
    mocks.write.mockRejectedValueOnce(new Error('Initial content write failed'));
    mocks.softDelete.mockReturnValueOnce(cleanup.promise);
    mount();
    const pending = begin();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { sessions[0].resolve(confirmed); });
    expect(mocks.softDelete).toHaveBeenCalledOnce();
    act(() => { renderer?.update(<Probe accountScope="user:8" />); });

    await act(async () => { cleanup.resolve(true); await pending; });
    expect(mocks.hardDelete).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(sessions).toHaveLength(1);
    await expect(pending).resolves.toBeNull();
  });

  it('unsubscribes on unmount and ignores delayed provider, health and confirmation callbacks', async () => {
    const providers = deferred<ProviderListResponse>();
    mocks.fetchProviders.mockReturnValueOnce(providers.promise);
    mount();
    const pending = begin();
    act(() => { renderer?.unmount(); renderer = undefined; });
    expect(sessions[0].cancel).toHaveBeenCalledOnce();
    expect(subscriptions[0].unsubscribe).toHaveBeenCalledOnce();
    await act(async () => { await pending; });
    await expect(pending).resolves.toBeNull();

    await act(async () => {
      providers.resolve(providerData);
      subscriptions[0].notify();
      sessions[0].resolve(confirmed);
      await pending;
    });
    expect(sessions[0].updateProps).not.toHaveBeenCalled();
    expect(mocks.ensureAvailable).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    await expect(pending).resolves.toBeNull();
  });
});
