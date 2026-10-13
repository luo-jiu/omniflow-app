import { describe, expect, it } from 'vitest';
import type { AgentToolActivitySnapshot } from '@/shared/agent/agent.types';
import { buildAgentComputerPointerPlans } from './agent-computer-pointer-plan';

const targetId = 'b925b6f7-1fc1-4c4e-916c-303dadf96229';
const observationId = 'a5479517-dc32-4c99-af89-241d876531e8';
const imageId = 'e5256c01-edc3-443c-96f8-4f0f01603436';
const identity = { libraryId: 3, targetId, applicationLabel: 'TextEdit', windowLabel: 'QA' };
function activity(name: string, ordinal: number, action: unknown): AgentToolActivitySnapshot {
  return { id: `tool-${ordinal}`, ordinal, sessionId: 'session', runId: 'run', revision: 1,
    createdAt: '2026-10-13T00:00:00Z', permissionBehavior: 'allow', status: 'completed',
    call: { id: `call-${ordinal}`, name, input: { x: 999, y: 999 } },
    toolMetadata: { kind: 'business', risk: 'write', builtinComputerTool: name.slice(9) as 'observe' },
    preparation: { preparedActionId: 'prepared', snapshotHash: 'a'.repeat(64), action: action as never } };
}
function observation() {
  return { ...activity('computer.observe', 1, { kind: 'computer.observe', version: 2, ...identity, mode: 'both' }),
    result: { ok: true, data: { captureScope: 'window', targetId, observationId, imageId,
      applicationLabel: 'TextEdit', windowLabel: 'QA', screenshotWidth: 673, screenshotHeight: 439 } } };
}
function pointer(operation: 'click' | 'rightClick' | 'doubleClick' | 'drag' = 'drag') {
  return activity(operation === 'click' ? 'computer.click' : 'computer.input', 2, operation === 'click'
    ? { kind: 'computer.click', version: 2, ...identity, observationId, screenshotWidth: 673, screenshotHeight: 439, x: 9, y: 53, button: 'left', clickCount: 1 }
    : { kind: 'computer.input', version: 1, ...identity, observationId, operation, point: { x: 9, y: 53 },
      ...(operation === 'drag' ? { endPoint: { x: 181, y: 53 }, durationMs: 300 } : {}) });
}

describe('computer pointer plans from canonical host facts', () => {
  it.each(['click', 'rightClick', 'doubleClick', 'drag'] as const)('associates %s only with its preceding image', operation => {
    const plan = buildAgentComputerPointerPlans([pointer(operation), observation()], 3).get('tool-1');
    expect(plan).toMatchObject({ operation, point: { x: 9, y: 53 }, attachmentId: imageId,
      width: 673, height: 439, observationToolRunId: 'tool-1', actionToolRunId: 'tool-2' });
    expect(plan?.endPoint).toEqual(operation === 'drag' ? { x: 181, y: 53 } : undefined);
  });
  it('keeps an unknown right-click plan across a presentation group boundary without claiming success', () => {
    const unknown = pointer('rightClick');
    unknown.status = 'failed'; unknown.result = { ok: false, data: { dispatchState: 'unknown' } };
    expect(buildAgentComputerPointerPlans([observation(), unknown], 3).get('tool-1')?.operation).toBe('rightClick');
  });
  it.each(['awaiting_approval', 'running', 'cancelled', 'interrupted'] as const)('displays only historical prepared intent in %s', status => {
    const source = pointer(); source.status = status;
    expect(buildAgentComputerPointerPlans([observation(), source], 3).get('tool-1')?.operation).toBe('drag');
  });
  it.each(['session', 'run', 'library', 'target', 'observation', 'title', 'application', 'width', 'height', 'point', 'endPoint', 'metadata', 'plugin', 'name', 'preparation', 'hash', 'ordinal'] as const)('rejects mismatched %s rather than guessing from call.input', part => {
    const source = pointer(part === 'width' || part === 'height' ? 'click' : 'drag');
    const action = source.preparation!.action as unknown as Record<string, unknown>;
    if (part === 'session') source.sessionId = 'other';
    if (part === 'run') source.runId = 'other';
    if (part === 'library') action.libraryId = 4;
    if (part === 'target') action.targetId = 'f455f376-da4c-49d0-9e5f-f6e3318ea755';
    if (part === 'observation') action.observationId = 'f455f376-da4c-49d0-9e5f-f6e3318ea755';
    if (part === 'title') action.windowLabel = 'other';
    if (part === 'application') action.applicationLabel = 'other';
    if (part === 'width') action.screenshotWidth = 674;
    if (part === 'height') action.screenshotHeight = 440;
    if (part === 'point') action.point = { x: 673, y: 53 };
    if (part === 'endPoint') action.endPoint = { x: 181, y: 439 };
    if (part === 'metadata') source.toolMetadata = undefined;
    if (part === 'name') source.call.name = 'pretend.input';
    if (part === 'preparation') source.preparation = undefined;
    if (part === 'hash') source.preparation!.snapshotHash = 'bad';
    if (part === 'ordinal') source.ordinal = 1;
    const scenario = part === 'plugin' ? { ...source,
      pluginSource: { pluginId: 'x', pluginVersion: '1', packageFingerprint: 'a', toolId: 'computer.input', registrationId: 'builtin:computer.input@1' } } : source;
    expect(buildAgentComputerPointerPlans([observation(), scenario], 3).size).toBe(0);
  });
  it.each(['image', 'scope', 'target', 'width', 'height', 'mode', 'status', 'metadata'] as const)('rejects an invalid source observation: %s', part => {
    const observed = observation();
    const data = observed.result!.data as Record<string, unknown>;
    if (part === 'image') data.imageId = 'unmanaged-url';
    if (part === 'scope') data.captureScope = 'display';
    if (part === 'target') data.targetId = 'other';
    if (part === 'width') data.screenshotWidth = 2049;
    if (part === 'height') data.screenshotHeight = 439.5;
    if (part === 'mode') (observed.preparation!.action as { mode: string }).mode = 'ax';
    if (part === 'status') observed.status = 'failed';
    if (part === 'metadata') observed.toolMetadata = undefined;
    expect(buildAgentComputerPointerPlans([observed, pointer()], 3).size).toBe(0);
  });
  it('does not attach an old plan to a newer image or allow stale observations', () => {
    const next = { ...observation(), id: 'new-observe', ordinal: 3,
      result: { ok: true, data: { ...observation().result!.data, observationId: '8c5a3203-bd32-4389-88c7-6be4d315dd0a', imageId: '19a2db1c-7705-46cf-82d5-c90bf1e0ce4c' } } };
    expect([...buildAgentComputerPointerPlans([observation(), pointer(), next], 3).keys()]).toEqual(['tool-1']);
    const stale = { ...pointer(), id: 'stale', ordinal: 4 };
    expect(buildAgentComputerPointerPlans([observation(), next, stale], 3).size).toBe(0);
  });
  it('does not invent image coordinates for shortcut or AX-only V3 click', () => {
    const shortcut = activity('computer.input', 2, { kind: 'computer.input', version: 1, ...identity, observationId, operation: 'shortcut', shortcut: { key: 'a', modifiers: ['command'] } });
    const semantic = activity('computer.click', 2, { kind: 'computer.click', version: 3, ...identity, observationId,
      elementId: 'cf8f072b-f965-4d73-8f47-04a3bfa03fbb', button: 'left', clickCount: 1 });
    for (const source of [shortcut, semantic]) expect(buildAgentComputerPointerPlans([observation(), source], 3).size).toBe(0);
  });
  it('does not annotate an observation already consumed by another write', () => {
    const text = activity('computer.setText', 2, { kind: 'computer.setText', version: 1, ...identity, observationId,
      elementId: 'cf8f072b-f965-4d73-8f47-04a3bfa03fbb', mode: 'insert', textLength: 0, textBytes: 0 });
    expect(buildAgentComputerPointerPlans([observation(), text, { ...pointer(), ordinal: 3 }], 3).size).toBe(0);
  });
});
