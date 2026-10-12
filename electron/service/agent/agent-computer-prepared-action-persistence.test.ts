import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { AgentComputerScrollPreparedActionPublicV1, AgentPreparedActionPublic } from '../../../src/shared/agent/agent.types';
import { COMPUTER_ELEMENT_OPERATIONS } from '../../../src/shared/computer-use/computer-use-contract';
import { createSQLiteAgentSessionStore, type AgentSessionStore } from './agent-session-store';

const ownerScope = { accountScope: 'user:7', backendScope: 'https://example.com/api' };
const now = '2026-10-10T02:00:00.000Z';
const observationId = '83fc584b-037d-4c82-8883-a609846ea0d4';
const targetId = '237e3952-2a40-4c7b-b2f4-bec335a79cce';
const elementId = '805f4b48-ec6e-4f78-b45b-e01f10bb247e';
const snapshotHash = 'a'.repeat(64);
const click: AgentPreparedActionPublic = {
  kind: 'computer.click', version: 2, libraryId: 3, targetId,
  applicationLabel: 'Calculator', windowLabel: 'Calculator', observationId,
  screenshotWidth: 800, screenshotHeight: 600, x: 400, y: 300, button: 'left', clickCount: 1,
};
const setText: AgentPreparedActionPublic = {
  kind: 'computer.setText', version: 1, libraryId: 3, targetId,
  applicationLabel: 'OmniFlow', windowLabel: '输入测试', observationId, elementId,
  mode: 'replace', textLength: 3, textBytes: 8,
};
const scroll: AgentComputerScrollPreparedActionPublicV1 = {
  kind: 'computer.scroll', version: 1, libraryId: 3, targetId,
  applicationLabel: 'Finder', windowLabel: '滚动测试', observationId, elementId,
  direction: 'down', unit: 'page',
};
const actions: AgentPreparedActionPublic[] = [
  { kind: 'computer.windows', version: 1, libraryId: 3 },
  { kind: 'computer.windows', version: 1, libraryId: 3, query: '计算', application: 'Calculator' },
  click,
  { ...click, elementId },
  { kind: 'computer.click', version: 3, libraryId: 3, targetId,
    applicationLabel: 'Calculator', windowLabel: 'Calculator', observationId, elementId, button: 'left', clickCount: 1 },
  { kind: 'computer.click', version: 1, libraryId: 3, displayId: '1', displayLabel: '历史屏幕',
    observationId, screenshotWidth: 800, screenshotHeight: 600, x: 400, y: 300, button: 'right', clickCount: 2 },
  { kind: 'computer.observe', version: 2, libraryId: 3, targetId,
    applicationLabel: 'OmniFlow', windowLabel: '历史共享' },
  { kind: 'computer.observe', version: 2, libraryId: 3, targetId,
    applicationLabel: 'OmniFlow', windowLabel: '授权输入和滚动', operations: [...COMPUTER_ELEMENT_OPERATIONS] },
  ...(['ax', 'screenshot', 'both'] as const).map(mode => ({ kind: 'computer.observe' as const, version: 2 as const,
    libraryId: 3, targetId, applicationLabel: 'OmniFlow', windowLabel: '独立观察模式', mode, operations: [...COMPUTER_ELEMENT_OPERATIONS] })),
  setText,
  { ...setText, mode: 'replace', textLength: 0, textBytes: 0 },
  { ...setText, mode: 'insert', textLength: 4096, textBytes: 16384 },
  ...(['up', 'down', 'left', 'right'] as const).flatMap(direction =>
    (['page', 'step', 'fraction'] as const).map(unit => ({ ...scroll, direction, unit }))),
];

describe('computer prepared action persistence', () => {
  const stores = new Set<AgentSessionStore>();
  const directories: string[] = [];
  afterEach(async () => {
    await Promise.all([...stores].map(store => store.close()));
    stores.clear();
    await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
  });

  async function openStore(databasePath = ':memory:') {
    const store = await createSQLiteAgentSessionStore(databasePath);
    stores.add(store);
    return store;
  }

  async function createRun(store: AgentSessionStore) {
    await store.createSession({ id: 'computer-session', ownerScope, now, title: '电脑操作审计',
      appContext: { libraryId: 3, platform: 'darwin', selectedNodeIds: [] } });
    await store.createRun({ id: 'computer-run', sessionId: 'computer-session', now,
      model: 'model-a', profileId: 'profile-a', reasoningEffort: 'auto', userPrompt: '测试窗口观察' });
  }

  function preparation(id: string, action: AgentPreparedActionPublic) {
    return { id, action, approvalId: `approval-${id}`, approvalInputHash: snapshotHash,
      approvalPreview: { title: '电脑操作', description: '验证准备动作', risk: 'read' as const },
      permissionBehavior: 'allow' as const, preparedActionId: `prepared-${id}`, snapshotHash };
  }

  it('restores grants, text counts, scroll actions and historical coordinates without changing schema or storing a text body', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-computer-action-'));
    directories.push(directory);
    const databasePath = path.join(directory, 'session.sqlite3');
    const store = await openStore(databasePath);
    await createRun(store);
    for (const [index, action] of actions.entries()) {
      const id = `computer-tool-${index}`;
      await store.createToolRun({ id, runId: 'computer-run', callId: `call-${index}`, input: {}, now,
        toolName: action.kind, permissionBehavior: 'allow', status: 'preparing' });
      expect(await store.completeToolPreparation(preparation(id, action))).toMatchObject({ preparation: { action } });
      await store.completeToolRun(id, { ok: true, message: '审计完成' }, now);
    }
    await store.updateRun('computer-run', { status: 'completed', finishedAt: now, updatedAt: now });
    await store.close();
    stores.delete(store);
    const restored = await openStore(databasePath);
    const session = await restored.getSession('computer-session', ownerScope, 3);
    expect(session?.toolActivities.map(activity => activity.preparation?.action)).toEqual(actions);
    expect(session?.toolActivities.every(activity => activity.status === 'completed')).toBe(true);
    for (const activity of session?.toolActivities || []) {
      if (activity.preparation?.action.kind !== 'computer.setText') continue;
      expect(activity.preparation.action).not.toHaveProperty('text');
      expect(activity.preparation.action).not.toHaveProperty('textHash');
      expect(activity.call.input).toEqual({});
    }
  });

  it('rejects forged optional identities and discovery fields before creating a stored preparation', async () => {
    const store = await openStore();
    await createRun(store);
    await store.createToolRun({ id: 'computer-tool', runId: 'computer-run', callId: 'call', input: {}, now,
      toolName: 'computer.click', permissionBehavior: 'allow', status: 'preparing' });
    for (const invalid of [{ ...click, elementId: 'AXButton' }, { ...click, elementId: null },
      { ...actions.find(action => action.kind === 'computer.click' && action.version === 1)!, elementId },
      { ...actions[0], query: '' }, { ...actions[0], application: 'x'.repeat(201) },
      { ...actions[0], pid: 42 }, { ...actions[6], operations: [] }, { ...actions[6], operations: ['press', 'press'] },
      { ...setText, text: 'private body' }, { ...setText, textHash: 'a'.repeat(64) },
      { ...setText, mode: 'insert', textLength: 0, textBytes: 0 }, { ...setText, textLength: 4097 },
      { ...setText, textBytes: 13 }, { ...scroll, unit: 'pixel' }, { ...scroll, count: 2 },
      { ...scroll, elementId: null }, { ...scroll, unit: 'fraction', amount: 0.1 },
      { ...scroll, unit: 'fraction', scrollState: { value: 0, minValue: 0, maxValue: 1 } }]) {
      await expect(store.completeToolPreparation(preparation('computer-tool', invalid as AgentPreparedActionPublic))).rejects.toThrow();
    }
    const session = await store.getSession('computer-session', ownerScope, 3);
    expect(session?.toolActivities[0].preparation).toBeUndefined();
    expect(session?.toolActivities[0].status).toBe('preparing');
  });
});
