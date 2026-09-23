import { describe, expect, it } from 'vitest';
import type { PluginCommandExecution } from '@/shared/plugins/manual-command.types';
import { commandCommittedMutation, mergeCommandProjection } from './command-projection';

const execution: PluginCommandExecution = {
  id: 'execution', libraryId: 3, ownerScope: { accountScope: 'user:7', backendScope: 'https://example.test/api' },
  revision: 3, commandId: 'example.rename.run', title: '改名', status: 'completed', createdAt: '2026-09-23', updatedAt: '2026-09-23',
  source: { pluginId: 'example.rename', pluginVersion: '1.0.0', packageFingerprint: 'a'.repeat(64), toolId: 'example.rename.tool', registrationId: 'registration' },
  action: { kind: 'plugin.rename', version: 1, libraryId: 3, operationId: '12345678-1234-4567-89ab-123456789abc', pluginId: 'example.rename', pluginVersion: '1.0.0', packageFingerprint: 'a'.repeat(64),
    items: [{ nodeId: 12, parentId: 9, oldName: 'old.txt', newName: 'new.txt' }] },
  result: { ok: true, data: { mutationCommitState: 'committed', operationId: '12345678-1234-4567-89ab-123456789abc', items: [{ nodeId: 12, parentId: 9, name: 'new', ext: 'txt' }] } },
};
describe('manual execution projection', () => {
  it('accepts only a higher main revision without losing later status', () => {
    expect(mergeCommandProjection([execution], { ...execution, revision: 2, status: 'executing' })).toEqual([execution]);
  });
  it('publishes committed rename names only for a live, matching receipt', () => {
    expect(commandCommittedMutation(execution)).toEqual({ parentIds: [9], renamed: [{ nodeId: 12, parentId: 9, name: 'new', ext: 'txt' }] });
    expect(commandCommittedMutation({ ...execution, status: 'commit-unknown' })).toBeNull();
    expect(commandCommittedMutation({ ...execution, source: { ...execution.source, packageFingerprint: 'b'.repeat(64) } })).toBeNull();
  });
  it('refreshes directories after historical reconciliation without broadcasting stale filenames', () => {
    expect(commandCommittedMutation({ ...execution, receiptChecks: [{ checkedAt: 'later', state: 'committed' }] })).toEqual({ parentIds: [9], renamed: [] });
  });
});
