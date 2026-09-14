import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/legacy-v1.json';
import { normalizeToolWorkspaceLayout } from '../../src/features/tool-workspace/tool-workspace.layout';
import { clearAllToolWorkspaceStates, loadToolWorkspaceState } from '../../src/features/tool-workspace/tool-workspace.state';
import { parseUserPreferencesFromExt } from '../../src/features/user/preferences/user-preferences';
import { updateExistingFileViewerTabResource } from '../../src/contexts/file-viewer-tab-resource';
import type { FileViewerTab } from '../../src/contexts/file-viewer.context';
import { isViewerResourceKey, serializeViewerResourceKey } from '../../src/features/file-viewer/session/viewer-session-identity';
import { ViewerSessionRegistry } from '../../src/features/file-viewer/session/viewer-session-registry';
import { ViewerSessionColdStore, type ViewerSessionColdPersistence } from '../../src/features/file-viewer/session/viewer-session-cold-store';
import { ViewerDraftStore, type ViewerDraftPersistence } from '../../src/features/file-viewer/session/viewer-draft-store';

// Frozen pre-plugin records: never regenerate these using the current serializers.
// All identifiers and contents are synthetic; no backend or browser storage is used.
function memoryPersistence(records: Map<string, unknown>) {
  return {
    get: async (key: string) => structuredClone(records.get(key)),
    delete: async (key: string) => { records.delete(key); },
    deleteMany: async (keys: string[]) => { keys.forEach(key => records.delete(key)); },
    getAllByAccount: async () => [],
    getAllByLibrary: async () => [],
    put: vi.fn(async () => undefined),
  } satisfies ViewerDraftPersistence & ViewerSessionColdPersistence;
}

afterEach(() => {
  clearAllToolWorkspaceStates();
  vi.unstubAllGlobals();
});

describe('pre-plugin compatibility fixtures', () => {
  it('keeps the saved theme and tool order', () => {
    expect(parseUserPreferencesFromExt(fixture.themeExt).theme).toBe('dark');
    expect(normalizeToolWorkspaceLayout(fixture.layout)).toEqual(fixture.layout);
  });

  it('restores saved subtitle contents without reviving an in-flight translation', () => {
    const values = new Map([[
      'tool-workspace-state:v1:900007', JSON.stringify(fixture.toolState),
    ]]);
    vi.stubGlobal('window', { localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => { values.delete(key); },
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size; },
    } });
    const state = loadToolWorkspaceState(900007);
    expect(state.activeToolId).toBe('subtitle-translation');
    expect(state.subtitleTranslationDraft.rows[0]).toMatchObject({
      sourceText: 'Synthetic subtitle', translatedText: '合成字幕', status: 'idle',
    });
  });

  it('refreshes an old tab URL without changing its identity or opening a new tab', () => {
    const tab = fixture.tab as FileViewerTab;
    const result = updateExistingFileViewerTabResource([tab], tab.id, {
      expectedNodeId: tab.nodeId, fileUrl: 'https://fixture.invalid/refreshed.txt', contentRevision: 'fixture:v2',
    });
    expect(result?.tabs).toHaveLength(1);
    expect(result?.updatedTab).toEqual({ ...tab, fileUrl: 'https://fixture.invalid/refreshed.txt', contentRevision: 'fixture:v2' });
    expect(tab.contentRevision).toBe('fixture:v1');
  });

  it('reads the original resource key and Warm snapshot in the owning account only', () => {
    const identity = fixture.snapshot.identity;
    if (!isViewerResourceKey(identity)) throw new Error('Legacy identity no longer readable');
    expect(serializeViewerResourceKey(identity)).toBe(fixture.resourceKey);
    const registry = new ViewerSessionRegistry();
    registry.writeSnapshot({ ...fixture.snapshot, identity });
    expect(registry.readSnapshot(identity)?.payload).toEqual(fixture.snapshot.payload);
    expect(registry.readSnapshot({ ...identity, accountScope: 'user:900002' })).toBeNull();
  });

  it('reads the frozen Cold record without rewriting it, and rejects a different library', async () => {
    const identity = fixture.snapshot.identity;
    if (!isViewerResourceKey(identity)) throw new Error('Legacy identity no longer readable');
    const persistence = memoryPersistence(new Map([[fixture.resourceKey, fixture.coldRecord]]));
    const store = new ViewerSessionColdStore({ persistence, now: () => fixture.fixtureNow });
    expect(await store.readSnapshot(identity, { schemaVersion: 1, contentRevision: 'fixture:v1' })).toEqual(fixture.snapshot);
    expect(await store.readSnapshot({ ...identity, libraryId: 900008 })).toBeNull();
    expect(persistence.put).not.toHaveBeenCalled();
  });

  it('preserves an unsaved draft and its original revision across store recreation', async () => {
    const identity = fixture.snapshot.identity;
    if (!isViewerResourceKey(identity)) throw new Error('Legacy identity no longer readable');
    const records = new Map([[fixture.resourceKey, fixture.draftRecord]]);
    const persistence = memoryPersistence(records);
    for (let restart = 0; restart < 2; restart += 1) {
      const store = new ViewerDraftStore({ persistence, now: () => fixture.fixtureNow });
      const draft = await store.readLatest(identity);
      expect(draft?.content).toBe(fixture.draftRecord.content);
      expect(draft?.key.contentRevision).toBe('fixture:v1');
      expect(await store.readLatest({ ...identity, accountScope: 'user:900002' })).toBeNull();
    }
    expect(records.get(fixture.resourceKey)).toEqual(fixture.draftRecord);
    expect(persistence.put).not.toHaveBeenCalled();
  });
});
