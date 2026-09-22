import { describe, expect, it } from 'vitest';
import type { AgentToolActivitySnapshot } from '@/shared/agent/agent.types';
import { buildAgentToolPresentation } from './agent-tool-presentation';
import { buildAgentTimelineItemsFromProjection, prepareAgentTimelineProjection } from './agent-timeline';
const source = { pluginId: 'example.csv-tools', pluginVersion: '0.1.0', packageFingerprint: 'a'.repeat(64), toolId: 'example.csv-tools.query', registrationId: 'plugin-tool:' + 'b'.repeat(64) };
function activity(status: AgentToolActivitySnapshot['status'] = 'completed'): AgentToolActivitySnapshot {
  return { id: 'tool', sessionId: 'session', runId: 'run', ordinal: 1, revision: 1, createdAt: '2026-09-22T00:00:00Z',
    call: { id: 'call', name: source.toolId, input: {} }, permissionBehavior: 'allow', status, pluginSource: source,
    toolMetadata: { kind: 'business', risk: 'read', groupKind: 'resource-read', operationKind: 'read' }, result: { ok: status === 'completed', message: 'result' } };
}
describe('plugin Tool source presentation', () => {
  it.each(['completed', 'failed', 'cancelled'] as const)('preserves host-authored source for %s', status => {
    const blocks = buildAgentToolPresentation(activity(status), 3);
    expect(blocks).toContainEqual(expect.objectContaining({ type: 'details', title: '插件来源', entries: expect.arrayContaining([{ label: '插件', value: source.pluginId }, { label: '包指纹', value: source.packageFingerprint }]) }));
  });
  it('does not treat input/result claims as audited source', () => {
    const value = activity(); delete (value as { pluginSource?: unknown }).pluginSource;
    value.call.input = { pluginSource: source }; value.result = { ok: true, data: { pluginSource: source } };
    expect(buildAgentToolPresentation(value, 3).some(block => block.type === 'details' && block.title === '插件来源')).toBe(false);
  });
  it('keeps plugin calls out of built-in read groups', () => {
    const values = [activity(), { ...activity(), id: 'other', ordinal: 2, call: { id: 'other', name: 'file.stat', input: {} }, pluginSource: undefined }];
    const items = buildAgentTimelineItemsFromProjection([], prepareAgentTimelineProjection([], [], values));
    expect(items.some(item => item.type === 'tool-activity' && item.activity.id === 'tool')).toBe(true);
    expect(items.filter(item => item.type === 'tool-group').some(item => item.activities.some(child => child.id === 'tool'))).toBe(false);
  });
});
