import { describe, expect, it } from 'vitest';

import {
  AGENT_PLAN_CONTROL_TOOL_NAME,
  agentPlanControlTool,
  normalizeAgentRunPlan,
  parseStoredAgentRunPlan,
} from './agent-plan-model';

const AVAILABLE_TOOLS = new Set(['file.list', 'file.stat', 'media.inspect']);
const CREATED_AT = '2026-08-23T01:02:03.000Z';

describe('Agent plan model', () => {
  it('normalizes bounded steps and owns plan identity in main', () => {
    let id = 0;
    const plan = normalizeAgentRunPlan({
      steps: [
        { title: ' 读取   当前目录 ', toolName: 'file.list' },
        { title: '检查目标文件', toolName: 'file.stat' },
      ],
      title: ' 整理   文件 ',
    }, AVAILABLE_TOOLS, CREATED_AT, () => `step-${++id}`);

    expect(plan).toEqual({
      createdAt: CREATED_AT,
      steps: [
        { expectedToolName: 'file.list', id: 'step-1', ordinal: 1, title: '读取 当前目录' },
        { expectedToolName: 'file.stat', id: 'step-2', ordinal: 2, title: '检查目标文件' },
      ],
      title: '整理 文件',
      version: 1,
    });
    expect(parseStoredAgentRunPlan(JSON.stringify(plan))).toEqual(plan);
  });

  it('rejects status fields, unavailable Tools and invalid plan sizes', () => {
    expect(() => normalizeAgentRunPlan({
      steps: [
        { status: 'completed', title: '读取目录', toolName: 'file.list' },
        { title: '读取文件', toolName: 'file.stat' },
      ],
    }, AVAILABLE_TOOLS, CREATED_AT)).toThrow('不允许的字段：status');
    expect(() => normalizeAgentRunPlan({
      steps: [
        { title: '读取目录', toolName: 'file.list' },
        { title: '删除文件', toolName: 'file.delete' },
      ],
    }, AVAILABLE_TOOLS, CREATED_AT)).toThrow('本轮不可用的 Tool');
    expect(() => normalizeAgentRunPlan({
      steps: [{ title: '读取目录', toolName: 'file.list' }],
    }, AVAILABLE_TOOLS, CREATED_AT)).toThrow('2 至 8 个步骤');
  });

  it('rejects malformed persisted plans instead of guessing recovery state', () => {
    expect(() => parseStoredAgentRunPlan('{broken')).toThrow('计划记录损坏');
    expect(() => parseStoredAgentRunPlan(JSON.stringify({
      createdAt: CREATED_AT,
      steps: [
        { expectedToolName: 'file.list', id: 'same', ordinal: 1, title: '第一步' },
        { expectedToolName: 'file.stat', id: 'same', ordinal: 2, title: '第二步' },
      ],
      version: 1,
    }))).toThrow('计划记录损坏');
  });

  it('does not persist credentials supplied through provider plan titles', () => {
    expect(() => normalizeAgentRunPlan({
      steps: [
        { title: '读取目录 password=private-value', toolName: 'file.list' },
        { title: '检查文件', toolName: 'file.stat' },
      ],
    }, AVAILABLE_TOOLS, CREATED_AT)).toThrow('不能包含 API Key');
    expect(() => normalizeAgentRunPlan({
      steps: [
        { title: '读取目录', toolName: 'file.list' },
        { title: '检查文件', toolName: 'file.stat' },
      ],
      title: 'https://example.com/file?X-Amz-Signature=private',
    }, AVAILABLE_TOOLS, CREATED_AT)).toThrow('不能包含 API Key');
  });

  it('exposes a provider-only schema without execution metadata', () => {
    expect(agentPlanControlTool.name).toBe(AGENT_PLAN_CONTROL_TOOL_NAME);
    expect(agentPlanControlTool).not.toHaveProperty('execute');
    expect(agentPlanControlTool).not.toHaveProperty('risk');
    expect(agentPlanControlTool.inputSchema).toMatchObject({
      additionalProperties: false,
      properties: {
        steps: { maxItems: 8, minItems: 2 },
      },
    });
  });
});
