import { describe, expect, it } from 'vitest';
import type { AgentToolActivitySnapshot } from '@/shared/agent/agent.types';
import { committedAgentFileParent, committedAgentFileParents, committedPluginRenameItems } from './agent-published-file';

const activity: AgentToolActivitySnapshot = {
  id: 'publish', sessionId: 's', runId: 'r', createdAt: '2026-09-09', ordinal: 1, revision: 1,
  status: 'completed', permissionBehavior: 'allow', call: { id: 'call', name: 'file.publish', input: {} },
  result: { ok: true, data: { uploadCommitState: 'committed', destination: { kind: 'library', nodeId: 32, parentId: 20 } } },
};
describe('committed publication refresh target', () => {
  it('restores both affected directories for completed internal moves', () => {
    const move = { ...activity, call: { ...activity.call, name: 'file.move' } };
    expect(committedAgentFileParents({ ...move, result: { ok: true, data: { mutationCommitState: 'committed', affectedParentIds: [8, 20, 8] } } })).toEqual([8, 20]);
    expect(committedAgentFileParents({ ...move, result: { ok: false, data: { mutationCommitState: 'commit_unknown', affectedParentIds: [8, 20] } } })).toEqual([]);
  });
  it('refreshes a deleted node parent only after confirmed trash commit', () => {
    for (const state of ['committed', 'commit_unknown', 'uncommitted']) {
      expect(committedAgentFileParent({ ...activity, call: { ...activity.call, name: 'file.delete' }, result: { ok: true, data: {
        deleteCommitState: state, destination: { kind: 'library', nodeId: 9, parentId: 8 },
      } } })).toBe(state === 'committed' ? 8 : null);
    }
  });
  it('refreshes direct writes only after an authoritative commit', () => {
    const direct = { ...activity, call: { ...activity.call, name: 'file.write' } };
    for (const state of ['committed', 'commit_unknown', 'uncommitted']) {
      expect(committedAgentFileParent({ ...direct, result: { ok: true, data: {
        writeCommitState: state, destination: { kind: 'library', nodeId: 32, parentId: 20 },
      } } })).toBe(state === 'committed' ? 20 : null);
    }
  });
  it.each(['file.publish', 'file.upload'])('refreshes committed %s destinations', name => {
    expect(committedAgentFileParent({ ...activity, call: { ...activity.call, name } })).toBe(20);
  });
  it.each(['commit_unknown', 'uncommitted'])('does not treat %s as committed', uploadCommitState => {
    expect(committedAgentFileParent({ ...activity, result: { ok: true, data: { ...(activity.result!.data as Record<string, unknown>), uploadCommitState } } })).toBeNull();
  });
  it('ignores local, failed and malformed results', () => {
    expect(committedAgentFileParent({ ...activity, status: 'failed' })).toBeNull();
    expect(committedAgentFileParent({ ...activity, result: { ok: true, data: { uploadCommitState: 'committed', destination: { kind: 'local' } } } })).toBeNull();
    expect(committedAgentFileParent({ ...activity, result: { ok: true, data: { uploadCommitState: 'committed', destination: { kind: 'library', nodeId: 3, parentId: '20' } } } })).toBeNull();
  });
});

function renameActivity(): AgentToolActivitySnapshot {
  const operationId = 'eaf4604e-5779-4a3c-8c3d-3eaf45c9aa68';
  return { ...activity, call: { id: 'rename-call', name: 'example.rename.propose', input: { resources: [11, 13] } },
    pluginSource: { pluginId: 'example.rename', pluginVersion: '0.1.0', packageFingerprint: 'a'.repeat(64), toolId: 'example.rename.propose', registrationId: `plugin-tool:${'b'.repeat(64)}` },
    preparation: { preparedActionId: 'prepared', snapshotHash: 'c'.repeat(64), action: {
      kind: 'plugin.rename', version: 1, libraryId: 3, operationId,
      pluginId: 'example.rename', pluginVersion: '0.1.0', packageFingerprint: 'a'.repeat(64), items: [
        { nodeId: 11, parentId: 10, oldName: 'photo.JPG', newName: '归档-photo.JPG' },
        { nodeId: 13, parentId: 10, oldName: 'README', newName: '归档-README' },
      ],
    } },
    result: { ok: true, data: { mutationCommitState: 'committed', operationId, affectedParentIds: [10], items: [
      { nodeId: 11, parentId: 10, name: '归档-photo', ext: 'JPG' }, { nodeId: 13, parentId: 10, name: '归档-README', ext: '' },
    ] } },
  };
}

describe('committed plugin rename projection', () => {
  it('preserves separate name/extension fields and derives unique parents from the approved committed items', () => {
    const rename = renameActivity();
    expect(committedPluginRenameItems(rename, 3)).toEqual([
      { nodeId: 11, parentId: 10, name: '归档-photo', ext: 'JPG' }, { nodeId: 13, parentId: 10, name: '归档-README', ext: '' },
    ]);
    expect(committedAgentFileParents(rename, 3)).toEqual([10]);
    const untrustedParents = { ...rename, result: { ok: true, data: { ...(rename.result!.data as object), affectedParentIds: [999, '10', 10] } } };
    expect(committedAgentFileParents(untrustedParents, 3)).toEqual([10]);
  });

  it.each(['failed', 'cancelled', 'interrupted', 'running', 'awaiting_approval'] as const)('does not replay names from %s activities', status => {
    const rename = { ...renameActivity(), status };
    expect(committedPluginRenameItems(rename)).toEqual([]); expect(committedAgentFileParents(rename)).toEqual([]);
  });

  it('rejects failed, uncertain, unrelated-operation, incomplete and duplicated receipts as a whole', () => {
    const rename = renameActivity(); const data = rename.result!.data as { items: object[] };
    const variants = [
      { ...rename, result: { ...rename.result!, ok: false } },
      ...['commit_unknown', 'uncommitted'].map(mutationCommitState => ({ ...rename, result: { ok: true, data: { ...data, mutationCommitState } } })),
      ...[{ operationId: '74db06a6-be25-437d-9b13-81307bd3c685' }, { items: [] }, { items: [data.items[0]] },
        { items: [data.items[0], data.items[0]] }, { items: [data.items[0], { ...data.items[1], nodeId: 99 }] },
        { items: [data.items[0], { ...data.items[1], parentId: 99 }] }, { items: [data.items[0], { ...data.items[1], name: 'wrong' }] },
        { items: [data.items[0], { ...data.items[1], ext: 'txt' }] }, { items: [data.items[0], { ...data.items[1], ext: null }] },
      ].map(change => ({ ...rename, result: { ok: true, data: { ...data, ...change } } })),
    ];
    for (const invalid of variants) {
      expect(committedPluginRenameItems(invalid, 3)).toEqual([]); expect(committedAgentFileParents(invalid, 3)).toEqual([]);
    }
  });

  it('binds name synchronization to the host source, prepared library and bounded action', () => {
    const rename = renameActivity();
    const variants = [
      { ...rename, pluginSource: undefined }, { ...rename, preparation: undefined },
      ...[{ pluginId: 'other.plugin' }, { pluginVersion: '2.0.0' }, { packageFingerprint: 'b'.repeat(64) }, { toolId: 'example.rename.other' }]
        .map(change => ({ ...rename, pluginSource: { ...rename.pluginSource!, ...change } })),
    ];
    for (const invalid of variants) expect(committedPluginRenameItems(invalid, 3)).toEqual([]);
    expect(committedPluginRenameItems(rename, 4)).toEqual([]); expect(committedAgentFileParents(rename, 4)).toEqual([]);
    const malformed = structuredClone(rename);
    if (malformed.preparation?.action.kind !== 'plugin.rename') throw new Error('expected rename action');
    malformed.preparation.action.items[0].nodeId = Number.MAX_SAFE_INTEGER + 1;
    expect(committedPluginRenameItems(malformed, 3)).toEqual([]);
  });
});
