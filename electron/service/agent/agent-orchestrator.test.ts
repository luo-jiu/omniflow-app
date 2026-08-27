import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AgentMediaExtractAudioPreparedActionPublicV1,
  AgentToolApprovalSnapshot,
} from '@/shared/agent/agent.types';

const mocks = vi.hoisted(() => ({
  resolveCapabilitySnapshot: vi.fn(),
  streamAgentProviderTurn: vi.fn(),
  streamAIServiceProfile: vi.fn(),
}));

vi.mock('./agent-provider-client', () => ({
  streamAgentProviderTurn: mocks.streamAgentProviderTurn,
}));
vi.mock('../aiServiceClient', () => ({
  streamAIServiceProfile: mocks.streamAIServiceProfile,
}));
vi.mock('./capabilities/agent-capability-runtime', () => ({
  AGENT_CAPABILITY_MEDIA_FFMPEG: 'media.ffmpeg',
  AGENT_CAPABILITY_MEDIA_FFPROBE: 'media.ffprobe',
  createBuiltInAgentCapabilitySnapshot: mocks.resolveCapabilitySnapshot,
}));

import { createAgentOrchestrator } from './agent-orchestrator';
import {
  estimateAgentProviderTurnTokens,
} from './agent-context-projection';
import { buildAgentSystemPrompt } from './agent-prompt-assembler';
import { agentPlanControlTool } from './agent-plan-model';
import { createAgentRunCapabilitySnapshot } from './agent-run-capability-snapshot';
import { createAgentCapabilitySnapshot } from './capabilities/agent-capability-registry';
import { createSQLiteAgentSessionStore, type AgentSessionStore } from './agent-session-store';
import {
  agentToolRegistry,
  createAgentToolRegistry,
  type AgentTool,
} from './agent-tool-registry';
import {
  MINIMUM_AGENT_PROVIDER_TOOL_RESULT_CONTENT,
  projectAgentToolResultForProvider,
} from './agent-tool-result-projection';
import { builtInAgentSkillRegistry } from './skills/agent-skill-runtime';
import { resolveAgentSkillActivationResult } from './skills/skill-activate-tool';
import { createAIServiceRunSessionRegistry } from '../aiServiceRunSession';

const OWNER_SCOPE = {
  accountScope: 'user:7',
  backendScope: 'https://example.com/api',
};

const OTHER_OWNER_SCOPE = {
  accountScope: 'user:8',
  backendScope: 'https://example.com/api',
};

function availableCapabilitySnapshot(capabilityIds = ['media.ffmpeg', 'media.ffprobe']) {
  return createAgentCapabilitySnapshot({
    entries: capabilityIds.map(id => ({
      checkedAt: 1,
      definitionRevision: `test:${id}@1`,
      id,
      scopeIdentity: 'test-machine',
      state: 'available' as const,
    })),
    registryRevision: 2,
  });
}

function sender() {
  return {
    id: 77,
    isDestroyed: () => false,
    send: vi.fn(),
  };
}

function request() {
  return {
    appContext: {
      currentDirectory: { id: 10, name: '视频' },
      libraryId: 3,
      platform: 'darwin' as const,
      selectedNodeIds: [8],
    },
    model: 'test-model',
    ownerScope: OWNER_SCOPE,
    perception: {
      collectedAt: new Date().toISOString(),
      currentDirectory: {
        entries: [{ id: 8, name: 'movie.mp4', type: 'file' as const }],
        entryCount: 1,
        id: 10,
        name: '视频',
      },
      selectedNodes: [{ id: 8, name: 'movie.mp4', type: 'file' as const }],
    },
    profileId: 'profile-1',
    reasoningEffort: 'high' as const,
    userPrompt: '当前目录有什么？',
  };
}

function mediaPreparedAction(
  overrides: Partial<AgentMediaExtractAudioPreparedActionPublicV1> = {},
): AgentMediaExtractAudioPreparedActionPublicV1 {
  return {
    conflictPolicy: 'auto_rename',
    destination: 'library',
    fallbackPolicy: 'prompt_local',
    kind: 'media.extractAudio',
    libraryId: 3,
    outputFileName: 'movie-audio.m4a',
    outputFormat: 'm4a',
    parentId: 10,
    sourceNodeId: 8,
    targetLabel: '视频',
    version: 1,
    ...overrides,
  };
}

function skillPromptCatalog() {
  const snapshot = builtInAgentSkillRegistry.createRunSnapshot();
  return {
    omittedSkillCount: snapshot.omittedSkillCount,
    summaries: snapshot.listSummaries(),
  };
}

describe('Agent orchestrator', () => {
  let store: AgentSessionStore;

  beforeEach(async () => {
    mocks.resolveCapabilitySnapshot.mockReset();
    mocks.resolveCapabilitySnapshot.mockImplementation(async ({ capabilityIds }) => (
      availableCapabilitySnapshot(capabilityIds)
    ));
    mocks.streamAgentProviderTurn.mockReset();
    mocks.streamAIServiceProfile.mockReset();
    store = await createSQLiteAgentSessionStore(':memory:');
  });

  afterEach(async () => {
    await store.close();
  });

  function createOrchestrator() {
    return createAgentOrchestrator({
      getRuntimeProfile: () => ({
        apiKey: 'test-key',
        baseUrl: 'https://ai.example.com/v1',
        providerType: 'openai',
      }),
      getSessionStore: async () => store,
      runSessionRegistry: createAIServiceRunSessionRegistry(),
    });
  }

  async function startPreparedAudioApproval() {
    mocks.streamAgentProviderTurn.mockResolvedValueOnce({
      content: '',
      toolCalls: [{ id: 'call-extract-audio', input: {}, name: 'media.extractAudio' }],
    });
    const webContents = sender();
    const orchestrator = createOrchestrator();
    const started = await orchestrator.start(webContents as never, {
      ...request(),
      userPrompt: '提取当前视频的音频',
    });
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith(
        'agent:chat:event',
        expect.objectContaining({ type: 'tool-prepare-requested' }),
      );
    });
    const preparation = webContents.send.mock.calls
      .map(call => call[1])
      .find(event => event?.type === 'tool-prepare-requested').preparation;
    expect(orchestrator.completeToolPreparation(webContents.id, {
      callId: preparation.callId,
      inputHash: preparation.inputHash,
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      prepareId: preparation.prepareId,
      result: {
        providerBindings: {
          m4a: {
            providerAlias: 'local-minio',
            providerLabel: '本机 MinIO',
          },
        },
      },
      runId: started.runId,
      sessionId: started.sessionId,
      toolRunId: preparation.toolRunId,
    })).toBe(true);
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith(
        'agent:chat:event',
        expect.objectContaining({ type: 'tool-approval-required' }),
      );
    });
    const approval = webContents.send.mock.calls
      .map(call => call[1])
      .find(event => event?.type === 'tool-approval-required').approval as AgentToolApprovalSnapshot;
    return { approval, orchestrator, started, webContents };
  }

  it('filters unavailable media capabilities before provider materialization and persists identity', async () => {
    mocks.resolveCapabilitySnapshot.mockResolvedValueOnce(createAgentCapabilitySnapshot({
      entries: [
        {
          checkedAt: 1,
          definitionRevision: 'test:media.ffmpeg@1',
          id: 'media.ffmpeg',
          reasonCode: 'media.ffmpeg_not_found',
          scopeIdentity: 'test-machine',
          state: 'unavailable',
        },
        {
          checkedAt: 1,
          definitionRevision: 'test:media.ffprobe@1',
          id: 'media.ffprobe',
          scopeIdentity: 'test-machine',
          state: 'available',
        },
      ],
      registryRevision: 2,
    }));
    mocks.streamAgentProviderTurn.mockImplementationOnce(async (_connection, input, onDelta) => {
      const toolNames = input.tools.map((tool: { name: string }) => tool.name);
      expect(toolNames).toContain('media.inspect');
      expect(toolNames).not.toContain('media.extractAudio');
      expect(input.systemPrompt).not.toContain('media-extract-audio');
      onDelta('当前环境没有可用的音频提取能力。');
      return { content: '当前环境没有可用的音频提取能力。', toolCalls: [] };
    });
    const webContents = sender();
    const started = await createOrchestrator().start(webContents as never, request());

    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        type: 'completed',
      }));
    });
    const session = await store.getSession(started.sessionId, OWNER_SCOPE, 3);
    expect(session?.runs[0]).toMatchObject({
      capabilityIdentity: expect.stringMatching(/^v2:[a-f0-9]{64}$/u),
      skillCatalogRevision: expect.any(Number),
      toolCatalogRevision: expect.any(Number),
    });
  });

  it('executes a read tool and persists the complete run', async () => {
    mocks.streamAgentProviderTurn
      .mockImplementationOnce(async (_profileId, input, onDelta) => {
        expect(input.maxOutputTokens).toBe(4_096);
        expect(input.systemPrompt).toContain('调用提供的 Tool');
        expect(input.systemPrompt).not.toContain('movie.mp4');
        expect(input.reasoningEffort).toBe('high');
        onDelta('我先查看目录。');
        return {
          content: '我先查看目录。',
          toolCalls: [{ id: 'call-1', input: {}, name: 'file.list' }],
        };
      })
      .mockImplementationOnce(async (_profileId, input, onDelta) => {
        expect(input.maxOutputTokens).toBe(4_096);
        expect(input.messages.at(-1)).toMatchObject({
          name: 'file.list',
          role: 'tool',
        });
        onDelta('当前目录有一个视频。');
        return { content: '当前目录有一个视频。', toolCalls: [] };
      });
    const webContents = sender();
    const orchestrator = createOrchestrator();

    const started = await orchestrator.start(webContents as never, request());
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        content: '我先查看目录。当前目录有一个视频。',
        runId: started.runId,
        sessionId: started.sessionId,
        type: 'completed',
      }));
    });

    const snapshot = await store.getSession(started.sessionId, OWNER_SCOPE, 3);
    expect(snapshot).toMatchObject({
      id: started.sessionId,
      lastRunStatus: 'completed',
      messageCount: 4,
    });
    expect(snapshot?.messages.map(message => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
    ]);
    expect(snapshot?.messages.map(message => message.content)).toEqual([
      '当前目录有什么？',
      '我先查看目录。',
      '已读取 1 个直属条目',
      '当前目录有一个视频。',
    ]);
    expect(mocks.streamAgentProviderTurn).toHaveBeenCalledTimes(2);
    const startedEvent = webContents.send.mock.calls
      .map(call => call[1])
      .find(event => event?.type === 'started');
    expect(startedEvent).toMatchObject({
      run: {
        id: started.runId,
        status: 'running',
        userPrompt: '当前目录有什么？',
      },
    });
    expect(webContents.send.mock.calls.map(call => call[1])).toEqual(expect.arrayContaining([
      expect.objectContaining({
        run: expect.objectContaining({ currentStep: '执行 file.list', status: 'running' }),
        type: 'run-updated',
      }),
      expect.objectContaining({
        run: expect.objectContaining({ currentStep: '已完成', status: 'completed' }),
        type: 'run-updated',
      }),
    ]));
    expect(webContents.send.mock.calls.map(call => call[1]?.type)).toContain('tool-started');
    expect(webContents.send.mock.calls.map(call => call[1]?.type)).toContain('tool-completed');
    const completedEvent = webContents.send.mock.calls
      .map(call => call[1])
      .find(event => event?.type === 'completed');
    expect(completedEvent.toolActivities).toEqual([
      expect.objectContaining({
        call: expect.objectContaining({ id: 'call-1', name: 'file.list' }),
        ordinal: 1,
        result: expect.objectContaining({ ok: true }),
        status: 'completed',
      }),
    ]);
    expect(completedEvent.run).toMatchObject({
      currentStep: '已完成',
      id: started.runId,
      status: 'completed',
    });
    expect(mocks.streamAIServiceProfile).not.toHaveBeenCalled();
  });

  it('persists a provider plan without creating a fake ToolRun and links real Tools', async () => {
    mocks.streamAgentProviderTurn
      .mockImplementationOnce(async (_connection, input) => {
        expect(input.tools.map((tool: { name: string }) => tool.name)).toContain('agent.plan.set');
        return {
          content: '',
          toolCalls: [
            {
              id: 'call-plan',
              input: {
                steps: [
                  { title: '读取当前目录', toolName: 'file.list' },
                  { title: '检查目标文件', toolName: 'file.stat' },
                ],
                title: '检查目录内容',
              },
              name: 'agent.plan.set',
            },
            { id: 'call-list', input: {}, name: 'file.list' },
          ],
        };
      })
      .mockImplementationOnce(async (_connection, input, onDelta) => {
        const results = input.messages.slice(-2);
        expect(results[0]).toMatchObject({ name: 'agent.plan.set', role: 'tool' });
        expect(JSON.parse(results[0].content)).toMatchObject({
          message: '已记录 2 个计划步骤',
          ok: true,
        });
        expect(results[1]).toMatchObject({ name: 'file.list', role: 'tool' });
        onDelta('目录读取完成。');
        return { content: '目录读取完成。', toolCalls: [] };
      });
    const webContents = sender();
    const orchestrator = createOrchestrator();

    const started = await orchestrator.start(webContents as never, {
      ...request(),
      userPrompt: '先读取目录，再检查目标文件',
    });
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        type: 'completed',
      }));
    });

    const snapshot = await store.getSession(started.sessionId, OWNER_SCOPE, 3);
    expect(snapshot?.runs[0].plan).toMatchObject({
      title: '检查目录内容',
      version: 1,
    });
    expect(snapshot?.runs[0].plan?.steps).toHaveLength(2);
    expect(snapshot?.toolActivities).toHaveLength(1);
    expect(snapshot?.toolActivities[0]).toMatchObject({
      call: { name: 'file.list' },
      planStepId: snapshot?.runs[0].plan?.steps[0].id,
    });
    expect(snapshot?.messages.some(message => message.toolName === 'agent.plan.set')).toBe(false);
    expect(webContents.send.mock.calls
      .map(call => call[1])
      .filter(event => event?.type === 'tool-started'))
      .toHaveLength(1);
    const runEvents = webContents.send.mock.calls
      .map(call => call[1])
      .filter(event => event?.type === 'started' || event?.type === 'run-updated');
    expect(runEvents.map(event => event.run.revision)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(runEvents.find(event => event.run.plan)?.run).toMatchObject({
      id: started.runId,
      plan: expect.objectContaining({ title: '检查目录内容' }),
      revision: 3,
    });
  });

  it('publishes only Skill summaries before activation and narrows Tools from the next turn', async () => {
    mocks.streamAgentProviderTurn
      .mockImplementationOnce(async (_connection, input) => {
        expect(input.systemPrompt).toContain('media-extract-audio');
        expect(input.systemPrompt).toContain('从一个明确的音视频文件中提取音轨');
        expect(input.systemPrompt).not.toContain('只在用户明确要求从一个音视频文件提取音轨时使用本流程');
        expect(input.tools.map((tool: { name: string }) => tool.name)).toEqual(expect.arrayContaining([
          'agent.plan.set',
          'skill.activate',
          'directory.create',
        ]));
        return {
          content: '',
          toolCalls: [{
            id: 'call-activate-audio-skill',
            input: { skillId: 'media-extract-audio' },
            name: 'skill.activate',
          }],
        };
      })
      .mockImplementationOnce(async (_connection, input, onDelta) => {
        const toolNames = input.tools.map((tool: { name: string }) => tool.name);
        expect(toolNames).toEqual([
          'agent.plan.set',
          'file.list',
          'file.stat',
          'interaction.request',
          'media.inspect',
          'media.extractAudio',
          'skill.activate',
        ]);
        expect(toolNames).not.toContain('directory.create');
        const activationResult = JSON.parse(input.messages.at(-1).content);
        expect(activationResult).toMatchObject({
          data: {
            skillId: 'media-extract-audio',
            toolAllowlist: expect.arrayContaining(['media.extractAudio']),
          },
          ok: true,
        });
        expect(activationResult.data.instructions).toContain('重新用 file.list 或 file.stat 感知');
        onDelta('流程已经加载。');
        return { content: '流程已经加载。', toolCalls: [] };
      });
    const webContents = sender();
    const orchestrator = createOrchestrator();

    const started = await orchestrator.start(webContents as never, {
      ...request(),
      userPrompt: '提取当前视频的音频',
    });
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        runId: started.runId,
        type: 'completed',
      }));
    });

    const snapshot = await store.getSession(started.sessionId, OWNER_SCOPE, 3);
    expect(snapshot?.toolActivities).toEqual([
      expect.objectContaining({
        call: expect.objectContaining({ name: 'skill.activate' }),
        result: expect.objectContaining({ ok: true }),
      }),
    ]);
    expect(snapshot?.toolActivities[0]).not.toHaveProperty('planStepId');
    expect(JSON.stringify(snapshot)).toContain(
      '只在用户明确要求从一个音视频文件提取音轨时使用本流程',
    );

    const rendererEvents = JSON.stringify(webContents.send.mock.calls);
    expect(rendererEvents).not.toContain(
      '只在用户明确要求从一个音视频文件提取音轨时使用本流程',
    );
    const completedToolEvent = webContents.send.mock.calls
      .map(call => call[1])
      .find(event => event?.type === 'tool-completed');
    expect(completedToolEvent?.result?.data).toEqual({
      instructionsHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      skillId: 'media-extract-audio',
      version: expect.any(String),
    });
    const restored = await orchestrator.getSession(started.sessionId, OWNER_SCOPE, 3);
    expect(JSON.stringify(restored)).not.toContain(
      '只在用户明确要求从一个音视频文件提取音轨时使用本流程',
    );
  });

  it('rejects an activation mixed with another Tool before creating any ToolRun', async () => {
    mocks.streamAgentProviderTurn
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          {
            id: 'call-mixed-activation',
            input: { skillId: 'media-extract-audio' },
            name: 'skill.activate',
          },
          { id: 'call-mixed-list', input: {}, name: 'file.list' },
        ],
      })
      .mockImplementationOnce(async (_connection, input, onDelta) => {
        const results = input.messages.slice(-2).map((message: { content: string }) => (
          JSON.parse(message.content)
        ));
        expect(results).toEqual([
          expect.objectContaining({ message: expect.stringContaining('必须独占'), ok: false }),
          expect.objectContaining({ message: expect.stringContaining('必须独占'), ok: false }),
        ]);
        expect(input.tools.map((tool: { name: string }) => tool.name)).toContain('directory.create');
        onDelta('我会改为单独激活。');
        return { content: '我会改为单独激活。', toolCalls: [] };
      });
    const webContents = sender();
    const orchestrator = createOrchestrator();

    const started = await orchestrator.start(webContents as never, request());
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        type: 'completed',
      }));
    });

    expect((await store.getSession(started.sessionId, OWNER_SCOPE, 3))?.toolActivities)
      .toEqual([]);
    expect(webContents.send.mock.calls.map(call => call[1]?.type)).not.toContain('tool-started');
  });

  it('does not count skill activation against the business Tool quota and permits a later plan', async () => {
    mocks.streamAgentProviderTurn
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{
          id: 'call-activate-before-plan-and-tools',
          input: { skillId: 'media-extract-audio' },
          name: 'skill.activate',
        }],
      })
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          {
            id: 'call-plan-after-activation',
            input: {
              steps: Array.from({ length: 8 }, (_, index) => ({
                title: `第 ${index + 1} 次读取目录`,
                toolName: 'file.list',
              })),
            },
            name: 'agent.plan.set',
          },
          ...Array.from({ length: 8 }, (_, index) => ({
            id: `call-skilled-list-${index + 1}`,
            input: {},
            name: 'file.list',
          })),
        ],
      })
      .mockImplementationOnce(async (_connection, input, onDelta) => {
        const toolResults = input.messages.filter(
          (message: { role: string }) => message.role === 'tool',
        );
        expect(toolResults.filter((message: { name: string }) => message.name === 'skill.activate'))
          .toHaveLength(1);
        expect(toolResults.filter((message: { name: string }) => message.name === 'agent.plan.set'))
          .toHaveLength(1);
        expect(toolResults.filter((message: { name: string }) => message.name === 'file.list'))
          .toHaveLength(8);
        onDelta('八次读取完成。');
        return { content: '八次读取完成。', toolCalls: [] };
      });
    const webContents = sender();
    const orchestrator = createOrchestrator();

    const started = await orchestrator.start(webContents as never, request());
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        type: 'completed',
      }));
    });

    const snapshot = await store.getSession(started.sessionId, OWNER_SCOPE, 3);
    expect(snapshot?.runs[0].plan).toBeDefined();
    expect(snapshot?.toolActivities).toHaveLength(9);
    expect(snapshot?.toolActivities[0]).toMatchObject({
      call: { name: 'skill.activate' },
    });
    expect(snapshot?.toolActivities[0]).not.toHaveProperty('planStepId');
    expect(snapshot?.toolActivities.slice(1).every(activity => activity.call.name === 'file.list'))
      .toBe(true);
  });

  it('allows Skill activation, eight serial business Tool turns, and a final answer', async () => {
    let providerTurn = 0;
    mocks.streamAgentProviderTurn.mockImplementation(async (_connection, _input, onDelta) => {
      providerTurn += 1;
      if (providerTurn === 1) {
        return {
          content: '',
          toolCalls: [{
            id: 'call-serial-activation',
            input: { skillId: 'media-extract-audio' },
            name: 'skill.activate',
          }],
        };
      }
      if (providerTurn <= 9) {
        return {
          content: '',
          toolCalls: [{
            id: `call-serial-list-${providerTurn - 1}`,
            input: {},
            name: 'file.list',
          }],
        };
      }
      onDelta('串行流程已经完成。');
      return { content: '串行流程已经完成。', toolCalls: [] };
    });
    const webContents = sender();
    const orchestrator = createAgentOrchestrator({
      contextBudget: { contextWindowTokens: 200_000 },
      getRuntimeProfile: () => ({
        apiKey: 'test-key',
        baseUrl: 'https://ai.example.com/v1',
        providerType: 'openai',
      }),
      getSessionStore: async () => store,
      runSessionRegistry: createAIServiceRunSessionRegistry(),
    });

    const started = await orchestrator.start(webContents as never, request());
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        content: '串行流程已经完成。',
        type: 'completed',
      }));
    });

    expect(mocks.streamAgentProviderTurn).toHaveBeenCalledTimes(10);
    const snapshot = await store.getSession(started.sessionId, OWNER_SCOPE, 3);
    expect(snapshot?.toolActivities).toHaveLength(9);
    expect(snapshot?.toolActivities[0].call.name).toBe('skill.activate');
    expect(snapshot?.toolActivities.slice(1).every(activity => activity.call.name === 'file.list'))
      .toBe(true);
  });

  it('applies the provider turn limit even when only a control Tool is called', async () => {
    let providerTurn = 0;
    mocks.streamAgentProviderTurn.mockImplementation(async () => {
      providerTurn += 1;
      return {
        content: '',
        toolCalls: [{
          id: `call-control-turn-${providerTurn}`,
          input: { skillId: 'media-extract-audio' },
          name: 'skill.activate',
        }],
      };
    });
    const webContents = sender();
    const orchestrator = createAgentOrchestrator({
      contextBudget: { contextWindowTokens: 200_000 },
      getRuntimeProfile: () => ({
        apiKey: 'test-key',
        baseUrl: 'https://ai.example.com/v1',
        providerType: 'openai',
      }),
      getSessionStore: async () => store,
      runSessionRegistry: createAIServiceRunSessionRegistry(),
    });

    const started = await orchestrator.start(webContents as never, request());
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        message: expect.stringContaining('Provider 轮数超过安全上限'),
        type: 'error',
      }));
    });

    expect(mocks.streamAgentProviderTurn).toHaveBeenCalledTimes(10);
    expect((await store.getSession(started.sessionId, OWNER_SCOPE, 3))?.toolActivities)
      .toHaveLength(9);
  });

  it('returns an invalid plan to the provider without inventing execution facts', async () => {
    mocks.streamAgentProviderTurn
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{
          id: 'call-invalid-plan',
          input: {
            steps: [
              { status: 'completed', title: '读取目录', toolName: 'file.list' },
              { title: '检查文件', toolName: 'file.stat' },
            ],
          },
          name: 'agent.plan.set',
        }],
      })
      .mockImplementationOnce(async (_connection, input, onDelta) => {
        expect(JSON.parse(input.messages.at(-1).content)).toMatchObject({
          message: expect.stringContaining('不允许的字段：status'),
          ok: false,
        });
        onDelta('我无法记录这份计划。');
        return { content: '我无法记录这份计划。', toolCalls: [] };
      });
    const webContents = sender();
    const orchestrator = createOrchestrator();

    const started = await orchestrator.start(webContents as never, request());
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        type: 'completed',
      }));
    });

    const snapshot = await store.getSession(started.sessionId, OWNER_SCOPE, 3);
    expect(snapshot?.runs[0].plan).toBeUndefined();
    expect(snapshot?.toolActivities).toEqual([]);
    expect(webContents.send.mock.calls.map(call => call[1]?.type)).not.toContain('tool-started');
  });

  it('does not count the provider plan against the business Tool quota', async () => {
    mocks.streamAgentProviderTurn
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          {
            id: 'call-plan-before-eight-tools',
            input: {
              steps: Array.from({ length: 8 }, (_, index) => ({
                title: `第 ${index + 1} 次读取目录`,
                toolName: 'file.list',
              })),
            },
            name: 'agent.plan.set',
          },
          ...Array.from({ length: 8 }, (_, index) => ({
            id: `call-list-${index + 1}`,
            input: {},
            name: 'file.list',
          })),
        ],
      })
      .mockImplementationOnce(async (_connection, input, onDelta) => {
        const toolResults = (input.messages as Array<{ name?: string; role: string }>)
          .filter(message => message.role === 'tool');
        expect(toolResults).toHaveLength(9);
        expect(toolResults.filter(message => message.name === 'agent.plan.set')).toHaveLength(1);
        expect(toolResults.filter(message => message.name === 'file.list')).toHaveLength(8);
        onDelta('八次目录读取均已完成。');
        return { content: '八次目录读取均已完成。', toolCalls: [] };
      });
    const webContents = sender();
    const orchestrator = createOrchestrator();

    const started = await orchestrator.start(webContents as never, request());
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        type: 'completed',
      }));
    });

    const snapshot = await store.getSession(started.sessionId, OWNER_SCOPE, 3);
    expect(snapshot?.runs[0]).toMatchObject({ status: 'completed' });
    expect(snapshot?.toolActivities).toHaveLength(8);
    expect(snapshot?.toolActivities.every(activity => activity.call.name === 'file.list')).toBe(true);
    expect(snapshot?.messages.some(message => message.toolName === 'agent.plan.set')).toBe(false);
  });

  it('rejects an over-quota provider turn before executing any business Tool', async () => {
    const executeMain = vi.fn(async () => ({ message: '不应执行', ok: true }));
    mocks.streamAgentProviderTurn.mockResolvedValueOnce({
      content: '',
      toolCalls: Array.from({ length: 9 }, (_, index) => ({
        id: `call-over-quota-${index + 1}`,
        input: {},
        name: 'file.list',
      })),
    });
    const webContents = sender();
    const orchestrator = createAgentOrchestrator({
      getRuntimeProfile: () => ({
        apiKey: 'test-key',
        baseUrl: 'https://ai.example.com/v1',
        providerType: 'openai',
      }),
      getSessionStore: async () => store,
      runSessionRegistry: createAIServiceRunSessionRegistry(),
      toolBroker: { executeMain } as never,
    });

    const started = await orchestrator.start(webContents as never, request());
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        message: expect.stringContaining('本轮未执行工具'),
        runId: started.runId,
        type: 'error',
      }));
    });

    expect(executeMain).not.toHaveBeenCalled();
    expect((await store.getSession(started.sessionId, OWNER_SCOPE, 3))?.toolActivities)
      .toEqual([]);
  });

  it('rejects a plan that follows the first business Tool in the same provider turn', async () => {
    mocks.streamAgentProviderTurn
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          { id: 'call-list-before-plan', input: {}, name: 'file.list' },
          {
            id: 'call-plan-after-list',
            input: {
              steps: [
                { title: '再次读取目录', toolName: 'file.list' },
                { title: '检查目标文件', toolName: 'file.stat' },
              ],
            },
            name: 'agent.plan.set',
          },
        ],
      })
      .mockImplementationOnce(async (_connection, input, onDelta) => {
        const results = input.messages.slice(-2);
        expect(results[0]).toMatchObject({ name: 'file.list', role: 'tool' });
        expect(results[1]).toMatchObject({ name: 'agent.plan.set', role: 'tool' });
        expect(JSON.parse(results[1].content)).toMatchObject({
          message: expect.stringContaining('首个 Tool 前设置一次'),
          ok: false,
        });
        onDelta('目录已读取，后续计划未被记录。');
        return { content: '目录已读取，后续计划未被记录。', toolCalls: [] };
      });
    const webContents = sender();
    const orchestrator = createOrchestrator();

    const started = await orchestrator.start(webContents as never, request());
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        type: 'completed',
      }));
    });

    const snapshot = await store.getSession(started.sessionId, OWNER_SCOPE, 3);
    expect(snapshot?.runs[0].plan).toBeUndefined();
    expect(snapshot?.toolActivities).toHaveLength(1);
    expect(snapshot?.toolActivities[0].call.name).toBe('file.list');
    expect(webContents.send.mock.calls
      .map(call => call[1])
      .some(event => event?.type === 'run-updated' && event.run?.plan))
      .toBe(false);
  });

  it('keeps the first plan immutable when the provider declares a second plan', async () => {
    mocks.streamAgentProviderTurn
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          {
            id: 'call-plan-first',
            input: {
              steps: [
                { title: '首次读取目录', toolName: 'file.list' },
                { title: '首次检查文件', toolName: 'file.stat' },
              ],
              title: '首次计划',
            },
            name: 'agent.plan.set',
          },
          {
            id: 'call-plan-second',
            input: {
              steps: [
                { title: '再次读取目录', toolName: 'file.list' },
                { title: '再次检查文件', toolName: 'file.stat' },
              ],
              title: '覆盖计划',
            },
            name: 'agent.plan.set',
          },
        ],
      })
      .mockImplementationOnce(async (_connection, input, onDelta) => {
        const results = input.messages.slice(-2);
        expect(JSON.parse(results[0].content)).toMatchObject({ ok: true });
        expect(JSON.parse(results[1].content)).toMatchObject({
          message: expect.stringContaining('首个 Tool 前设置一次'),
          ok: false,
        });
        onDelta('保留首次计划。');
        return { content: '保留首次计划。', toolCalls: [] };
      });
    const webContents = sender();
    const orchestrator = createOrchestrator();

    const started = await orchestrator.start(webContents as never, request());
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        type: 'completed',
      }));
    });

    const snapshot = await store.getSession(started.sessionId, OWNER_SCOPE, 3);
    expect(snapshot?.runs[0].plan).toMatchObject({ title: '首次计划' });
    expect(snapshot?.toolActivities).toEqual([]);
    expect(webContents.send.mock.calls.map(call => call[1]?.type)).not.toContain('tool-started');
    expect(webContents.send.mock.calls
      .map(call => call[1])
      .some(event => event?.run?.plan?.title === '覆盖计划'))
      .toBe(false);
  });

  it('keeps business Tool approval mandatory after accepting a plan', async () => {
    mocks.streamAgentProviderTurn
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          {
            id: 'call-plan-before-write',
            input: {
              steps: [
                { title: '创建目标文件夹', toolName: 'directory.create' },
                { title: '确认目录内容', toolName: 'file.list' },
              ],
            },
            name: 'agent.plan.set',
          },
          {
            id: 'call-create-after-plan',
            input: { name: '测试目录' },
            name: 'directory.create',
          },
        ],
      })
      .mockImplementationOnce(async (_connection, input, onDelta) => {
        expect(JSON.parse(input.messages.at(-1).content)).toMatchObject({
          message: expect.stringContaining('用户取消'),
          ok: false,
        });
        onDelta('文件夹没有创建。');
        return { content: '文件夹没有创建。', toolCalls: [] };
      });
    const webContents = sender();
    const orchestrator = createOrchestrator();

    const started = await orchestrator.start(webContents as never, {
      ...request(),
      userPrompt: '创建测试目录后确认目录内容',
    });
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        type: 'tool-approval-required',
      }));
    });
    const approval = webContents.send.mock.calls
      .map(call => call[1])
      .find(event => event?.type === 'tool-approval-required').approval;
    expect(approval.call.name).toBe('directory.create');
    await orchestrator.resolveToolApproval(webContents.id, {
      approvalId: approval.approvalId,
      approved: false,
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      runId: started.runId,
      sessionId: started.sessionId,
    });
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        type: 'completed',
      }));
    });

    const snapshot = await store.getSession(started.sessionId, OWNER_SCOPE, 3);
    expect(snapshot?.runs[0].plan).toBeDefined();
    expect(snapshot?.toolActivities).toEqual([
      expect.objectContaining({
        call: expect.objectContaining({ name: 'directory.create' }),
        permissionBehavior: 'ask',
        status: 'failed',
      }),
    ]);
    expect(webContents.send.mock.calls.map(call => call[1]?.type))
      .not.toContain('tool-execution-requested');
  });

  it('dispatches read-only media inspection through one authorized renderer execution', async () => {
    mocks.streamAgentProviderTurn
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: 'call-media-inspect', input: {}, name: 'media.inspect' }],
      })
      .mockImplementationOnce(async (_connection, input, onDelta) => {
        expect(input.messages.at(-1)).toMatchObject({
          content: expect.stringContaining('已读取'),
          name: 'media.inspect',
          role: 'tool',
        });
        onDelta('这个文件包含视频流。');
        return { content: '这个文件包含视频流。', toolCalls: [] };
      });
    const inspectMediaSource = vi.fn(async () => ({
      data: { streamCount: 1 },
      message: '已读取“movie.mp4”的媒体信息：1 个媒体流',
      ok: true,
    }));
    const webContents = sender();
    const orchestrator = createAgentOrchestrator({
      getRuntimeProfile: () => ({
        apiKey: 'test-key',
        baseUrl: 'https://ai.example.com/v1',
        providerType: 'openai',
      }),
      getSessionStore: async () => store,
      inspectMediaSource,
      runSessionRegistry: createAIServiceRunSessionRegistry(),
    });
    const started = await orchestrator.start(webContents as never, {
      ...request(),
      userPrompt: '检查当前视频',
    });
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith(
        'agent:chat:event',
        expect.objectContaining({ type: 'tool-execution-requested' }),
      );
    });
    const execution = webContents.send.mock.calls
      .map(call => call[1])
      .find(event => event?.type === 'tool-execution-requested').execution;
    expect(execution).toMatchObject({
      input: { fileName: 'movie.mp4', libraryId: 3, nodeId: 8 },
      ownerScope: OWNER_SCOPE,
      toolName: 'media.inspect',
    });
    expect(JSON.stringify(execution)).not.toContain('signed');

    const inspectionRequest = {
      executionId: execution.executionId,
      fileName: 'movie.mp4',
      libraryId: 3,
      nodeId: 8,
      ownerScope: OWNER_SCOPE,
      runId: started.runId,
      sessionId: started.sessionId,
      sourceUrl: 'https://storage.example/signed?secret=value',
    };
    const result = await orchestrator.inspectMedia(webContents.id, inspectionRequest);
    expect(inspectMediaSource).toHaveBeenCalledWith(expect.objectContaining({
      nodeId: 8,
      sourceUrl: inspectionRequest.sourceUrl,
    }), expect.any(AbortSignal));
    await expect(orchestrator.inspectMedia(webContents.id, inspectionRequest))
      .rejects.toThrow('已经使用');
    orchestrator.completeToolExecution(webContents.id, {
      executionId: execution.executionId,
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      result,
      runId: started.runId,
      sessionId: started.sessionId,
    });

    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        content: '这个文件包含视频流。',
        type: 'completed',
      }));
    });
  });

  it('rejects tampered prepared action discriminators and extra fields before approval', async () => {
    const cases = [
      {
        error: '类型或版本不受支持',
        mutate: (action: AgentMediaExtractAudioPreparedActionPublicV1) => ({
          ...action,
          kind: 'shell.run',
        }),
      },
      {
        error: '类型或版本不受支持',
        mutate: (action: AgentMediaExtractAudioPreparedActionPublicV1) => ({
          ...action,
          version: 2,
        }),
      },
      {
        error: '包含未知字段',
        mutate: (action: AgentMediaExtractAudioPreparedActionPublicV1) => ({
          ...action,
          untrusted: true,
        }),
      },
    ];

    for (const testCase of cases) {
      const { approval, orchestrator, started, webContents } = await startPreparedAudioApproval();
      if (!approval.preparation) throw new Error('expected prepared approval');
      await expect(orchestrator.resolveToolApproval(webContents.id, {
        approvalId: approval.approvalId,
        approved: true,
        libraryId: 3,
        ownerScope: OWNER_SCOPE,
        preparedAction: testCase.mutate(approval.preparation.action) as never,
        preparedActionId: approval.preparation.preparedActionId,
        runId: started.runId,
        sessionId: started.sessionId,
      })).rejects.toThrow(testCase.error);

      expect(await store.getSession(started.sessionId, OWNER_SCOPE, 3)).toMatchObject({
        lastRunStatus: 'awaiting_approval',
        toolActivities: [expect.objectContaining({
          approval: expect.objectContaining({ status: 'pending' }),
          preparation: {
            action: approval.preparation.action,
            preparedActionId: approval.preparation.preparedActionId,
            snapshotHash: approval.preparation.snapshotHash,
          },
          status: 'awaiting_approval',
        })],
      });
      expect(orchestrator.stop(started.sessionId, webContents.id)).toBe(true);
      await vi.waitFor(() => {
        expect(webContents.send.mock.calls.map(call => call[1]?.type)).toContain('cancelled');
      });
    }
  });

  it('rejects a prepared action whose discriminator belongs to another Tool', async () => {
    const mismatchedTool: AgentTool = {
      createRendererPrepareRequest: () => ({}),
      description: '用于验证 prepared action 与 Tool 的绑定',
      executor: 'renderer',
      finalizeRendererPreparation: () => ({
        decision: {
          behavior: 'ask',
          preview: {
            description: '不应展示此确认',
            risk: 'write',
            title: '错误准备动作',
          },
          risk: 'write',
        },
        executionInput: {},
        publicAction: mediaPreparedAction(),
      }),
      inputSchema: {
        additionalProperties: false,
        type: 'object',
      },
      name: 'test.preparedActionMismatch',
      risk: 'write',
    };
    const testRegistry = createAgentToolRegistry([
      ...agentToolRegistry.list(),
      mismatchedTool,
    ]);
    const snapshotSpy = vi.spyOn(agentToolRegistry, 'createSnapshot')
      .mockReturnValue(testRegistry.createSnapshot());

    try {
      mocks.streamAgentProviderTurn
        .mockResolvedValueOnce({
          content: '',
          toolCalls: [{ id: 'call-mismatch', input: {}, name: mismatchedTool.name }],
        })
        .mockImplementationOnce(async (_connection, input, onDelta) => {
          expect(JSON.parse(input.messages.at(-1).content)).toMatchObject({
            message: expect.stringContaining('prepared action 与 Tool 不匹配'),
            ok: false,
          });
          onDelta('准备动作已被拒绝。');
          return { content: '准备动作已被拒绝。', toolCalls: [] };
        });
      const webContents = sender();
      const orchestrator = createOrchestrator();
      const started = await orchestrator.start(webContents as never, request());
      await vi.waitFor(() => {
        expect(webContents.send).toHaveBeenCalledWith(
          'agent:chat:event',
          expect.objectContaining({ type: 'tool-prepare-requested' }),
        );
      });
      const preparation = webContents.send.mock.calls
        .map(call => call[1])
        .find(event => event?.type === 'tool-prepare-requested').preparation;

      expect(orchestrator.completeToolPreparation(webContents.id, {
        callId: preparation.callId,
        inputHash: preparation.inputHash,
        libraryId: 3,
        ownerScope: OWNER_SCOPE,
        prepareId: preparation.prepareId,
        result: {},
        runId: started.runId,
        sessionId: started.sessionId,
        toolRunId: preparation.toolRunId,
      })).toBe(true);
      await vi.waitFor(() => {
        expect(webContents.send).toHaveBeenCalledWith(
          'agent:chat:event',
          expect.objectContaining({ type: 'completed' }),
        );
      });

      expect(webContents.send.mock.calls.map(call => call[1]?.type))
        .not.toContain('tool-approval-required');
      expect(await store.getSession(started.sessionId, OWNER_SCOPE, 3)).toMatchObject({
        lastRunStatus: 'completed',
        toolActivities: [expect.objectContaining({
          call: expect.objectContaining({ name: mismatchedTool.name }),
          result: {
            message: expect.stringContaining('prepared action 与 Tool 不匹配'),
            ok: false,
          },
          status: 'failed',
        })],
      });
    } finally {
      snapshotSpy.mockRestore();
    }
  });

  it('runs approved audio extraction through one exact renderer capability', async () => {
    mocks.streamAgentProviderTurn
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: 'call-extract-audio', input: {}, name: 'media.extractAudio' }],
      })
      .mockImplementationOnce(async (_connection, input, onDelta) => {
        expect(input.messages.at(-1)).toMatchObject({
          content: expect.stringContaining('已提取并上传'),
          name: 'media.extractAudio',
          role: 'tool',
        });
        onDelta('音频已经提取并放回当前目录。');
        return { content: '音频已经提取并放回当前目录。', toolCalls: [] };
      });
    const extractMediaAudio = vi.fn(async (
      _input: unknown,
      _signal: AbortSignal,
      onProgress: (progress: { message: string; percent?: number }) => void,
    ) => {
      onProgress({ message: '音频提取完成，准备上传', percent: 60 });
      return {
        artifactId: 'artifact-1',
        fileName: 'movie-audio.m4a',
        filePath: '/tmp/agent-media/movie-audio.m4a',
        mimeType: 'audio/mp4',
        sizeBytes: 512,
      };
    });
    const mediaArtifactStore = {
      getOwned: vi.fn(() => ({
        artifactId: 'artifact-1',
        directoryPath: '/tmp/agent-media',
        fileName: 'movie-audio.m4a',
        filePath: '/tmp/agent-media/movie-audio.m4a',
        sizeBytes: 512,
      })),
      release: vi.fn(async () => true),
      releaseOwner: vi.fn(async () => undefined),
      releaseRun: vi.fn(async () => undefined),
      touchExecution: vi.fn(async () => true),
    };
    const saveMediaArtifactAs = vi.fn(async () => ({ canceled: true as const }));
    const webContents = sender();
    const orchestrator = createAgentOrchestrator({
      extractMediaAudio: extractMediaAudio as never,
      getRuntimeProfile: () => ({
        apiKey: 'test-key',
        baseUrl: 'https://ai.example.com/v1',
        providerType: 'openai',
      }),
      getSessionStore: async () => store,
      mediaArtifactStore,
      runSessionRegistry: createAIServiceRunSessionRegistry(),
      saveMediaArtifactAs,
    });
    const started = await orchestrator.start(webContents as never, {
      ...request(),
      userPrompt: '提取当前视频的音频',
    });
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith(
        'agent:chat:event',
        expect.objectContaining({ type: 'tool-prepare-requested' }),
      );
    });
    const preparation = webContents.send.mock.calls
      .map(call => call[1])
      .find(event => event?.type === 'tool-prepare-requested').preparation;
    expect(preparation).toMatchObject({
      input: { libraryId: 3, nodeId: 8, outputFormat: 'm4a', parentId: 10 },
      ownerScope: OWNER_SCOPE,
      toolName: 'media.extractAudio',
    });
    expect(orchestrator.completeToolPreparation(webContents.id, {
      callId: preparation.callId,
      inputHash: preparation.inputHash,
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      prepareId: preparation.prepareId,
      result: {
        providerBindings: {
          m4a: {
            providerAlias: 'local-minio',
            providerLabel: '本机 MinIO',
          },
        },
      },
      runId: started.runId,
      sessionId: started.sessionId,
      toolRunId: preparation.toolRunId,
    })).toBe(true);
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith(
        'agent:chat:event',
        expect.objectContaining({ type: 'tool-approval-required' }),
      );
    });
    const approval = webContents.send.mock.calls
      .map(call => call[1])
      .find(event => event?.type === 'tool-approval-required').approval;
    expect(approval.preview).toMatchObject({ risk: 'write', title: '提取音频' });
    expect(approval.preparation).toMatchObject({
      action: {
        destination: 'library',
        kind: 'media.extractAudio',
        outputFileName: 'movie-audio.m4a',
        outputFormat: 'm4a',
        parentId: 10,
        version: 1,
      },
      preparedActionId: expect.any(String),
      snapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });

    const approvalDecision = {
      approvalId: approval.approvalId,
      approved: true,
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      preparedAction: approval.preparation.action,
      preparedActionId: approval.preparation.preparedActionId,
      runId: started.runId,
      sessionId: started.sessionId,
    };
    const resolvingApproval = orchestrator.resolveToolApproval(
      webContents.id,
      approvalDecision,
    );
    await expect(orchestrator.resolveToolApproval(webContents.id, approvalDecision))
      .rejects.toThrow('正在处理');
    const decision = await resolvingApproval;
    if (!decision.approved || !decision.execution) throw new Error('expected renderer execution');
    const execution = decision.execution;
    expect(execution).toMatchObject({
      input: {
        conflictPolicy: 'auto_rename',
        destination: 'library',
        fallbackPolicy: 'prompt_local',
        libraryId: 3,
        nodeId: 8,
        outputFileName: 'movie-audio.m4a',
        outputFormat: 'm4a',
        parentId: 10,
        preparedActionId: expect.any(String),
        snapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        sourceFileName: 'movie.mp4',
        storageProvider: 'local-minio',
      },
      toolName: 'media.extractAudio',
    });

    const extractionRequest = {
      executionId: execution.executionId,
      fileName: 'movie.mp4',
      libraryId: 3,
      nodeId: 8,
      outputFileName: 'movie-audio.m4a',
      outputFormat: 'm4a' as const,
      ownerScope: OWNER_SCOPE,
      runId: started.runId,
      sessionId: started.sessionId,
      sourceUrl: 'https://storage.example/signed?secret=value',
    };
    await expect(orchestrator.extractMediaAudio(88, extractionRequest))
      .rejects.toThrow('无权使用');
    const artifact = await orchestrator.extractMediaAudio(webContents.id, extractionRequest);
    expect(extractMediaAudio).toHaveBeenCalledWith(expect.objectContaining({
      outputFileName: 'movie-audio.m4a',
      sourceUrl: extractionRequest.sourceUrl,
    }), expect.any(AbortSignal), expect.any(Function));
    await expect(orchestrator.extractMediaAudio(webContents.id, extractionRequest))
      .rejects.toThrow('已经使用');
    if (!execution.input || typeof execution.input !== 'object') {
      throw new Error('expected prepared media execution input');
    }
    const preparedInput = execution.input as Record<string, unknown>;
    const saveRequest = {
      artifactId: artifact.artifactId,
      defaultFileName: 'movie-audio.m4a',
      executionId: execution.executionId,
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      preparedActionId: String(preparedInput.preparedActionId),
      purpose: 'upload_fallback' as const,
      runId: started.runId,
      sessionId: started.sessionId,
      snapshotHash: String(preparedInput.snapshotHash),
    };
    await expect(orchestrator.saveMediaArtifact({ ...webContents, id: 88 } as never, saveRequest))
      .rejects.toThrow('无权使用');
    await expect(orchestrator.saveMediaArtifact(webContents as never, saveRequest))
      .resolves.toEqual({ canceled: true });
    await expect(orchestrator.saveMediaArtifact(webContents as never, saveRequest))
      .rejects.toThrow('已经使用');
    expect(mediaArtifactStore.getOwned).toHaveBeenCalledWith('artifact-1', {
      executionId: execution.executionId,
      ownerScope: OWNER_SCOPE,
      ownerWebContentsId: webContents.id,
      runId: started.runId,
      sessionId: started.sessionId,
    });
    expect(saveMediaArtifactAs).toHaveBeenCalledWith(expect.objectContaining({
      defaultFileName: 'movie-audio.m4a',
      sender: webContents,
      signal: expect.any(AbortSignal),
    }));
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        progress: { message: '音频提取完成，准备上传', percent: 60 },
        type: 'tool-progress',
      }));
    });
    expect(orchestrator.reportToolExecutionProgress(webContents.id, {
      executionId: execution.executionId,
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      progress: { message: '正在上传提取后的音频', percent: 65 },
      runId: started.runId,
      sessionId: started.sessionId,
    })).toBe(true);
    expect(mediaArtifactStore.touchExecution).toHaveBeenCalledWith({
      executionId: execution.executionId,
      ownerScope: OWNER_SCOPE,
      ownerWebContentsId: webContents.id,
      runId: started.runId,
      sessionId: started.sessionId,
    });
    expect(orchestrator.markToolExecutionCommitted(webContents.id, {
      executionId: execution.executionId,
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      result: {
        data: {
          createdNodeId: 32,
          destination: 'library',
          format: 'm4a',
          name: 'movie-audio.m4a',
          parentId: 10,
          uploadCommitState: 'committed',
          verified: false,
        },
        message: '已提取并上传“movie-audio.m4a”',
        ok: true,
      },
      runId: started.runId,
      sessionId: started.sessionId,
    })).toBe(true);

    await orchestrator.releaseMediaArtifact(webContents.id, {
      artifactId: artifact.artifactId,
      executionId: execution.executionId,
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      runId: started.runId,
      sessionId: started.sessionId,
    });
    expect(mediaArtifactStore.release).toHaveBeenCalledWith('artifact-1', {
      executionId: execution.executionId,
      ownerScope: OWNER_SCOPE,
      ownerWebContentsId: webContents.id,
      runId: started.runId,
      sessionId: started.sessionId,
    });

    orchestrator.completeToolExecution(webContents.id, {
      executionId: execution.executionId,
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      result: {
        data: {
          createdNodeId: 32,
          destination: 'library',
          format: 'm4a',
          name: 'movie-audio.m4a',
          parentId: 10,
          uploadCommitState: 'committed',
          verified: true,
        },
        message: '已提取并上传“movie-audio.m4a”',
        ok: true,
      },
      runId: started.runId,
      sessionId: started.sessionId,
    });

    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        content: '音频已经提取并放回当前目录。',
        type: 'completed',
      }));
    });
    expect(JSON.stringify(webContents.send.mock.calls)).not.toContain('secret=value');
    expect(JSON.stringify(webContents.send.mock.calls)).not.toContain('/tmp/agent-media');
  });

  it('does not automatically execute a non-read tool', async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    if (!agentToolRegistry.get('test.write')) {
      agentToolRegistry.register({
        description: 'test write',
        execute,
        inputSchema: { type: 'object' },
        name: 'test.write',
        risk: 'write',
      });
    }
    mocks.streamAgentProviderTurn
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: 'call-write', input: {}, name: 'test.write' }],
      })
      .mockImplementationOnce(async (_profileId, input, onDelta) => {
        expect(input.messages.at(-1)?.content).toContain('尚未配置受控执行策略');
        onDelta('当前不能自动执行写操作。');
        return { content: '当前不能自动执行写操作。', toolCalls: [] };
      });
    const webContents = sender();
    const orchestrator = createOrchestrator();

    const started = await orchestrator.start(webContents as never, request());
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        content: '当前不能自动执行写操作。',
        runId: started.runId,
        sessionId: started.sessionId,
        type: 'completed',
      }));
    });

    expect(execute).not.toHaveBeenCalled();
  });

  it('approves directory creation, accepts one renderer result and re-perceives the directory', async () => {
    mocks.streamAgentProviderTurn
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: 'call-create', input: { name: '测试' }, name: 'directory.create' }],
      })
      .mockImplementationOnce(async (_connection, input) => {
        expect(input.messages.at(-1)).toMatchObject({
          name: 'directory.create',
          role: 'tool',
        });
        return {
          content: '',
          toolCalls: [{ id: 'call-list-after-create', input: {}, name: 'file.list' }],
        };
      })
      .mockImplementationOnce(async (_connection, input, onDelta) => {
        expect(input.messages.at(-1)?.content).toContain('测试');
        onDelta('文件夹“测试”已经创建。');
        return { content: '文件夹“测试”已经创建。', toolCalls: [] };
      });
    const webContents = sender();
    const orchestrator = createOrchestrator();
    const started = await orchestrator.start(webContents as never, {
      ...request(),
      userPrompt: '在当前目录创建一个叫测试的文件夹',
    });

    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith(
        'agent:chat:event',
        expect.objectContaining({ type: 'tool-approval-required' }),
      );
    });
    const approvalEvent = webContents.send.mock.calls
      .map(call => call[1])
      .find(event => event?.type === 'tool-approval-required');
    const approval = approvalEvent.approval;
    expect(await store.getSession(started.sessionId, OWNER_SCOPE, 3)).toMatchObject({
      lastRunStatus: 'awaiting_approval',
      toolActivities: [expect.objectContaining({
        approval: expect.objectContaining({
          approvalId: approval.approvalId,
          status: 'pending',
        }),
        status: 'awaiting_approval',
      })],
    });
    await expect(orchestrator.resolveToolApproval(webContents.id, {
      approvalId: approval.approvalId,
      approved: true,
      libraryId: 3,
      ownerScope: OTHER_OWNER_SCOPE,
      runId: started.runId,
      sessionId: started.sessionId,
    })).rejects.toThrow('无权处理');

    const decision = await orchestrator.resolveToolApproval(webContents.id, {
      approvalId: approval.approvalId,
      approved: true,
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      runId: started.runId,
      sessionId: started.sessionId,
    });
    expect(decision).toMatchObject({
      approved: true,
      execution: {
        input: {
          conflictPolicy: 'error',
          libraryId: 3,
          name: '测试',
          parentId: 10,
        },
        toolName: 'directory.create',
      },
    });
    if (!decision.approved) throw new Error('expected approval');
    const execution = decision.execution;
    if (!execution) throw new Error('expected renderer execution');
    expect(() => orchestrator.completeToolExecution(webContents.id, {
      executionId: execution.executionId,
      libraryId: 4,
      ownerScope: OWNER_SCOPE,
      result: { ok: true },
      runId: started.runId,
      sessionId: started.sessionId,
    })).toThrow('无权提交');
    orchestrator.completeToolExecution(webContents.id, {
      executionId: execution.executionId,
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      perception: {
        collectedAt: '2026-08-23T00:00:01.000Z',
        currentDirectory: {
          entries: [
            { id: 8, name: 'movie.mp4', type: 'file' },
            { id: 22, name: '测试', type: 'dir' },
          ],
          entryCount: 2,
          id: 10,
          name: '视频',
        },
        selectedNodes: [],
      },
      result: {
        data: { createdNodeId: 22, name: '测试', parentId: 10, verified: true },
        message: '已创建文件夹“测试”',
        ok: true,
      },
      runId: started.runId,
      sessionId: started.sessionId,
    });

    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        content: '文件夹“测试”已经创建。',
        runId: started.runId,
        type: 'completed',
      }));
    });
    expect((await store.getSession(started.sessionId, OWNER_SCOPE, 3))?.toolActivities[0])
      .toMatchObject({ approval: { status: 'approved' }, status: 'completed' });
    expect(mocks.streamAgentProviderTurn).toHaveBeenCalledTimes(3);
  });

  it('executes an approved main-process tool without creating a renderer request', async () => {
    const execute = vi.fn(async () => ({ message: 'main write completed', ok: true }));
    if (!agentToolRegistry.get('test.main-confirm')) {
      agentToolRegistry.register({
        assess: () => ({
          behavior: 'ask',
          preview: {
            description: '执行测试 main 操作',
            risk: 'write',
            title: '测试 main 操作',
          },
          risk: 'write',
        }),
        description: 'test confirmed main tool',
        execute,
        inputSchema: { type: 'object' },
        name: 'test.main-confirm',
        risk: 'write',
      });
    }
    mocks.streamAgentProviderTurn
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: 'call-main-confirm', input: { value: 1 }, name: 'test.main-confirm' }],
      })
      .mockImplementationOnce(async (_connection, input, onDelta) => {
        expect(input.messages.at(-1)?.content).toContain('main write completed');
        onDelta('main 操作已完成。');
        return { content: 'main 操作已完成。', toolCalls: [] };
      });
    const webContents = sender();
    const orchestrator = createOrchestrator();
    const started = await orchestrator.start(webContents as never, request());
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith(
        'agent:chat:event',
        expect.objectContaining({ type: 'tool-approval-required' }),
      );
    });
    const approval = webContents.send.mock.calls
      .map(call => call[1])
      .find(event => event?.type === 'tool-approval-required').approval;

    await expect(orchestrator.resolveToolApproval(webContents.id, {
      approvalId: approval.approvalId,
      approved: true,
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      runId: started.runId,
      sessionId: started.sessionId,
    })).resolves.toEqual({ approved: true });
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        content: 'main 操作已完成。',
        type: 'completed',
      }));
    });
    expect(execute).toHaveBeenCalledWith(
      { value: 1 },
      expect.objectContaining({ appContext: expect.objectContaining({ libraryId: 3 }) }),
    );
  });

  it('returns a denied directory action to the model without executing it', async () => {
    mocks.streamAgentProviderTurn
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: 'call-create-denied', input: { name: '测试' }, name: 'directory.create' }],
      })
      .mockImplementationOnce(async (_connection, input, onDelta) => {
        expect(input.messages.at(-1)?.content).toContain('用户取消了');
        onDelta('已取消创建文件夹。');
        return { content: '已取消创建文件夹。', toolCalls: [] };
      });
    const webContents = sender();
    const orchestrator = createOrchestrator();
    const started = await orchestrator.start(webContents as never, request());
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith(
        'agent:chat:event',
        expect.objectContaining({ type: 'tool-approval-required' }),
      );
    });
    const approval = webContents.send.mock.calls
      .map(call => call[1])
      .find(event => event?.type === 'tool-approval-required').approval;

    await expect(orchestrator.resolveToolApproval(webContents.id, {
      approvalId: approval.approvalId,
      approved: false,
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      runId: started.runId,
      sessionId: started.sessionId,
    })).resolves.toEqual({ approved: false });
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        content: '已取消创建文件夹。',
        type: 'completed',
      }));
    });
    expect((await store.getSession(started.sessionId, OWNER_SCOPE, 3))?.toolActivities[0])
      .toMatchObject({ approval: { status: 'denied' }, status: 'failed' });
  });

  it('cancels and invalidates an action that is waiting for approval', async () => {
    mocks.streamAgentProviderTurn.mockResolvedValueOnce({
      content: '',
      toolCalls: [{ id: 'call-create-stop', input: { name: '测试' }, name: 'directory.create' }],
    });
    const webContents = sender();
    const orchestrator = createOrchestrator();
    const started = await orchestrator.start(webContents as never, request());
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith(
        'agent:chat:event',
        expect.objectContaining({ type: 'tool-approval-required' }),
      );
    });
    const approval = webContents.send.mock.calls
      .map(call => call[1])
      .find(event => event?.type === 'tool-approval-required').approval;

    expect(orchestrator.stop(started.sessionId, webContents.id)).toBe(true);
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        runId: started.runId,
        type: 'cancelled',
      }));
    });
    await expect(orchestrator.resolveToolApproval(webContents.id, {
      approvalId: approval.approvalId,
      approved: true,
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      runId: started.runId,
      sessionId: started.sessionId,
    })).rejects.toThrow('不存在或已经失效');
    expect((await store.getSession(started.sessionId, OWNER_SCOPE, 3))?.toolActivities[0])
      .toMatchObject({ approval: { status: 'cancelled' }, status: 'cancelled' });
  });

  it('expires an unanswered approval without leaving a resumable action behind', async () => {
    mocks.streamAgentProviderTurn
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: 'call-create-expired', input: { name: '测试' }, name: 'directory.create' }],
      })
      .mockImplementationOnce(async (_connection, input, onDelta) => {
        expect(input.messages.at(-1)?.content).toContain('用户确认已超时');
        onDelta('创建请求已超时，没有执行。');
        return { content: '创建请求已超时，没有执行。', toolCalls: [] };
      });
    const webContents = sender();
    const orchestrator = createAgentOrchestrator({
      approvalTimeoutMs: 5,
      getRuntimeProfile: () => ({
        apiKey: 'test-key',
        baseUrl: 'https://ai.example.com/v1',
        providerType: 'openai',
      }),
      getSessionStore: async () => store,
      runSessionRegistry: createAIServiceRunSessionRegistry(),
    });
    const started = await orchestrator.start(webContents as never, request());

    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        content: '创建请求已超时，没有执行。',
        type: 'completed',
      }));
    });
    expect(await store.getSession(started.sessionId, OWNER_SCOPE, 3)).toMatchObject({
      lastRunStatus: 'completed',
      toolActivities: [expect.objectContaining({
        approval: expect.objectContaining({ status: 'expired' }),
        status: 'failed',
      })],
    });
  });

  it('persists a bounded interaction, authorizes one answer and resumes the model', async () => {
    mocks.streamAgentProviderTurn
      .mockImplementationOnce(async (_connection, _input, onDelta) => {
        onDelta('需要确认输出格式。');
        return {
          content: '需要确认输出格式。',
          toolCalls: [{
            id: 'call-interaction',
            input: {
              kind: 'choice',
              options: [
                { description: '兼容性更好', id: 'mp3', label: 'MP3' },
                { description: '保留无损音频', id: 'wav', label: 'WAV' },
              ],
              prompt: '请选择输出格式',
              title: '输出格式',
            },
            name: 'interaction.request',
          }],
        };
      })
      .mockImplementationOnce(async (_connection, input, onDelta) => {
        expect(input.messages.at(-1)).toMatchObject({
          name: 'interaction.request',
          role: 'tool',
        });
        expect(input.messages.at(-1)?.content).toContain('"selectedOptionIds":["mp3"]');
        onDelta('将使用 MP3 格式。');
        return { content: '将使用 MP3 格式。', toolCalls: [] };
      });
    const webContents = sender();
    const orchestrator = createOrchestrator();
    const started = await orchestrator.start(webContents as never, request());

    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith(
        'agent:chat:event',
        expect.objectContaining({ type: 'tool-interaction-required' }),
      );
    });
    const interactionEvent = webContents.send.mock.calls
      .map(call => call[1])
      .find(event => event?.type === 'tool-interaction-required');
    const interactionId = interactionEvent.interactionId as string;
    const validSubmission = {
      interactionId,
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      response: { kind: 'choice' as const, selectedOptionIds: ['mp3'] },
      runId: started.runId,
      sessionId: started.sessionId,
    };
    expect(await store.getSession(started.sessionId, OWNER_SCOPE, 3)).toMatchObject({
      lastRunStatus: 'awaiting_interaction',
      toolActivities: [expect.objectContaining({
        interaction: expect.objectContaining({ interactionId, status: 'pending' }),
        status: 'awaiting_interaction',
      })],
    });

    await expect(orchestrator.submitInteraction(88, validSubmission))
      .rejects.toThrow('无权提交');
    for (const invalidSubmission of [
      { ...validSubmission, libraryId: 4 },
      { ...validSubmission, ownerScope: OTHER_OWNER_SCOPE },
      { ...validSubmission, runId: 'other-run' },
      { ...validSubmission, sessionId: 'other-session' },
    ]) {
      await expect(orchestrator.submitInteraction(webContents.id, invalidSubmission))
        .rejects.toThrow('无权提交');
    }
    await expect(orchestrator.submitInteraction(webContents.id, {
      ...validSubmission,
      response: { kind: 'choice', selectedOptionIds: ['unknown'] },
    })).rejects.toThrow('选择项无效');

    await expect(orchestrator.submitInteraction(webContents.id, validSubmission))
      .resolves.toMatchObject({
        accepted: true,
        activity: {
          interaction: {
            response: { kind: 'choice', selectedOptionIds: ['mp3'] },
            status: 'submitted',
          },
          status: 'running',
        },
      });
    await expect(orchestrator.submitInteraction(webContents.id, validSubmission))
      .rejects.toThrow('不存在或已经失效');

    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        content: '需要确认输出格式。将使用 MP3 格式。',
        type: 'completed',
      }));
    });
    expect((await store.getSession(started.sessionId, OWNER_SCOPE, 3))?.toolActivities[0])
      .toMatchObject({
        interaction: {
          response: { kind: 'choice', selectedOptionIds: ['mp3'] },
          status: 'submitted',
        },
        status: 'completed',
      });
  });

  it('cancels and invalidates an interaction when the run is stopped', async () => {
    mocks.streamAgentProviderTurn.mockResolvedValueOnce({
      content: '',
      toolCalls: [{
        id: 'call-interaction-stop',
        input: {
          kind: 'choice',
          options: [{ id: 'continue', label: '继续' }, { id: 'cancel', label: '取消' }],
          prompt: '是否继续？',
        },
        name: 'interaction.request',
      }],
    });
    const webContents = sender();
    const orchestrator = createOrchestrator();
    const started = await orchestrator.start(webContents as never, request());
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith(
        'agent:chat:event',
        expect.objectContaining({ type: 'tool-interaction-required' }),
      );
    });
    const interactionId = webContents.send.mock.calls
      .map(call => call[1])
      .find(event => event?.type === 'tool-interaction-required').interactionId;

    expect(orchestrator.stop(started.sessionId, webContents.id)).toBe(true);
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        runId: started.runId,
        type: 'cancelled',
      }));
    });
    await expect(orchestrator.submitInteraction(webContents.id, {
      interactionId,
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      response: { kind: 'choice', selectedOptionIds: ['continue'] },
      runId: started.runId,
      sessionId: started.sessionId,
    })).rejects.toThrow('不存在或已经失效');
    expect((await store.getSession(started.sessionId, OWNER_SCOPE, 3))?.toolActivities[0])
      .toMatchObject({ interaction: { status: 'cancelled' }, status: 'cancelled' });
  });

  it('expires an unanswered interaction and lets the model explain the failure', async () => {
    mocks.streamAgentProviderTurn
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{
          id: 'call-interaction-expired',
          input: {
            kind: 'choice',
            options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
            prompt: '请选择',
          },
          name: 'interaction.request',
        }],
      })
      .mockImplementationOnce(async (_connection, input, onDelta) => {
        expect(input.messages.at(-1)?.content).toContain('用户输入已超时');
        onDelta('输入请求已超时，本次没有采用任何选项。');
        return { content: '输入请求已超时，本次没有采用任何选项。', toolCalls: [] };
      });
    const webContents = sender();
    const orchestrator = createAgentOrchestrator({
      getRuntimeProfile: () => ({
        apiKey: 'test-key',
        baseUrl: 'https://ai.example.com/v1',
        providerType: 'openai',
      }),
      getSessionStore: async () => store,
      interactionTimeoutMs: 5,
      runSessionRegistry: createAIServiceRunSessionRegistry(),
    });
    const started = await orchestrator.start(webContents as never, request());

    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        content: '输入请求已超时，本次没有采用任何选项。',
        type: 'completed',
      }));
    });
    expect(await store.getSession(started.sessionId, OWNER_SCOPE, 3)).toMatchObject({
      lastRunStatus: 'completed',
      toolActivities: [expect.objectContaining({
        interaction: expect.objectContaining({ status: 'expired' }),
        status: 'failed',
      })],
    });
  });

  it('falls back to the bounded snapshot when a local model rejects tool calling', async () => {
    mocks.streamAgentProviderTurn.mockRejectedValueOnce(new Error('model does not support tools'));
    mocks.streamAIServiceProfile.mockImplementationOnce(async (input, onDelta) => {
      expect(input.maxOutputTokens).toBe(1_234);
      expect(input.systemPrompt).not.toContain('movie.mp4');
      expect(input.systemPrompt).toContain('当前模型不支持 Tool Calling');
      expect(JSON.stringify(input.messages)).toContain('低权限只读感知数据');
      expect(JSON.stringify(input.messages)).toContain('movie.mp4');
      expect(input.reasoningEffort).toBe('high');
      onDelta('当前目录有 movie.mp4。');
      return '当前目录有 movie.mp4。';
    });
    const webContents = sender();
    const orchestrator = createAgentOrchestrator({
      contextBudget: { outputReserveTokens: 1_234 },
      getRuntimeProfile: () => ({
        apiKey: 'test-key',
        baseUrl: 'https://ai.example.com/v1',
        providerType: 'openai',
      }),
      getSessionStore: async () => store,
      runSessionRegistry: createAIServiceRunSessionRegistry(),
    });

    const started = await orchestrator.start(webContents as never, request());
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        content: '当前目录有 movie.mp4。',
        runId: started.runId,
        sessionId: started.sessionId,
        type: 'completed',
      }));
    });

    expect(mocks.streamAIServiceProfile).toHaveBeenCalledTimes(1);
  });

  it('projects a large Tool result into a bounded structured provider message', async () => {
    const largeEntries = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      name: `file-${index}-${'x'.repeat(500)}`,
    }));
    const executeMain = vi.fn(async () => ({
      data: { entries: largeEntries, entryCount: largeEntries.length },
      message: '读取完成',
      ok: true,
    }));
    mocks.streamAgentProviderTurn
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: 'call-large-result', input: {}, name: 'file.list' }],
      })
      .mockImplementationOnce(async (_connection, input, onDelta) => {
        const providerResult = JSON.parse(input.messages.at(-1).content);
        expect(providerResult.ok).toBe(true);
        expect(providerResult._omniflowProjection).toMatchObject({
          reason: 'provider_context_budget',
          truncated: true,
        });
        expect(input.messages.at(-1).content.length).toBeLessThan(10_000);
        onDelta('已读取目录。');
        return { content: '已读取目录。', toolCalls: [] };
      });
    const webContents = sender();
    const orchestrator = createAgentOrchestrator({
      getRuntimeProfile: () => ({
        apiKey: 'test-key',
        baseUrl: 'https://ai.example.com/v1',
        providerType: 'openai',
      }),
      getSessionStore: async () => store,
      runSessionRegistry: createAIServiceRunSessionRegistry(),
      toolBroker: { executeMain } as never,
    });

    const started = await orchestrator.start(webContents as never, request());
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith(
        'agent:chat:event',
        expect.objectContaining({ runId: started.runId, type: 'completed' }),
      );
    });

    const snapshot = await store.getSession(started.sessionId, OWNER_SCOPE, 3);
    expect(snapshot?.toolActivities[0].result?.data).toMatchObject({
      entryCount: 100,
      entries: expect.arrayContaining([expect.objectContaining({ id: 100 })]),
    });
  });

  it('sanitizes main Tool progress and canonical results before persistence or events', async () => {
    const executeMain = vi.fn(async (
      _name: string,
      _input: unknown,
      context: { onProgress: (progress: { message: string; percent?: number }) => void },
    ) => {
      context.onProgress({
        message: 'Authorization: Bearer progress-private-token',
        percent: 500,
      });
      return {
        data: {
          authorization: 'Bearer result-private-token',
          url: 'https://example.com/file?X-Amz-Signature=signed-private-value',
        },
        message: 'password=result-private-value',
        ok: true,
      };
    });
    mocks.streamAgentProviderTurn
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: 'call-sensitive-result', input: {}, name: 'file.list' }],
      })
      .mockImplementationOnce(async (_connection, input, onDelta) => {
        const providerHistory = JSON.stringify(input.messages);
        expect(providerHistory).toContain('[REDACTED]');
        expect(providerHistory).not.toContain('result-private');
        expect(providerHistory).not.toContain('signed-private');
        onDelta('结果已安全处理。');
        return { content: '结果已安全处理。', toolCalls: [] };
      });
    const webContents = sender();
    const orchestrator = createAgentOrchestrator({
      getRuntimeProfile: () => ({
        apiKey: 'test-key',
        baseUrl: 'https://ai.example.com/v1',
        providerType: 'openai',
      }),
      getSessionStore: async () => store,
      runSessionRegistry: createAIServiceRunSessionRegistry(),
      toolBroker: { executeMain } as never,
    });

    const started = await orchestrator.start(webContents as never, request());
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith(
        'agent:chat:event',
        expect.objectContaining({ runId: started.runId, type: 'completed' }),
      );
    });

    const snapshot = await store.getSession(started.sessionId, OWNER_SCOPE, 3);
    const serializedSnapshot = JSON.stringify(snapshot);
    const serializedEvents = JSON.stringify(webContents.send.mock.calls);
    expect(snapshot?.toolActivities[0].progress).toEqual({
      message: 'Authorization: [REDACTED]',
      percent: 100,
    });
    expect(snapshot?.toolActivities[0].result).toEqual({
      data: {
        authorization: '[REDACTED]',
        url: 'https://example.com/file?[SIGNED_QUERY_REDACTED]',
      },
      message: 'password=[REDACTED]',
      ok: true,
    });
    expect(serializedSnapshot).not.toContain('private-token');
    expect(serializedSnapshot).not.toContain('private-value');
    expect(serializedEvents).not.toContain('private-token');
    expect(serializedEvents).not.toContain('private-value');
  });

  it('stops before a second provider turn when Tool loop messages exceed the window', async () => {
    const executeMain = vi.fn(async () => ({ message: '不应执行', ok: true }));
    mocks.streamAgentProviderTurn.mockResolvedValueOnce({
      content: 'x'.repeat(60_000),
      toolCalls: [{ id: 'call-overflow', input: {}, name: 'file.list' }],
    });
    const webContents = sender();
    const orchestrator = createAgentOrchestrator({
      getRuntimeProfile: () => ({
        apiKey: 'test-key',
        baseUrl: 'https://ai.example.com/v1',
        providerType: 'openai',
      }),
      getSessionStore: async () => store,
      runSessionRegistry: createAIServiceRunSessionRegistry(),
      toolBroker: { executeMain } as never,
    });

    const started = await orchestrator.start(webContents as never, request());
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        message: expect.stringContaining('本轮未执行工具'),
        runId: started.runId,
        type: 'error',
      }));
    });

    expect(mocks.streamAgentProviderTurn).toHaveBeenCalledTimes(1);
    expect(executeMain).not.toHaveBeenCalled();
  });

  it('preflights every minimum legal Tool result before executing the provider turn', async () => {
    const currentRequest = request();
    const registeredTools = agentToolRegistry.list();
    const providerTools = [agentPlanControlTool, ...registeredTools];
    const toolCalls = [
      { id: 'call-boundary-list', input: {}, name: 'file.list' },
      { id: 'call-boundary-stat', input: { nodeId: 8 }, name: 'file.stat' },
    ];
    const catalog = skillPromptCatalog();
    const systemPrompt = buildAgentSystemPrompt(
      currentRequest.appContext,
      currentRequest.perception,
      registeredTools.map(tool => tool.name),
      catalog.summaries,
      catalog.omittedSkillCount,
    );
    const messages = [
      { content: currentRequest.userPrompt, role: 'user' as const },
      { content: '准备执行。', role: 'assistant' as const, toolCalls },
    ];
    const continuationBaseTokens = estimateAgentProviderTurnTokens({
      messages,
      systemPrompt,
      tools: providerTools,
    });
    const continuationWithMinimumResults = estimateAgentProviderTurnTokens({
      messages: [
        ...messages,
        ...toolCalls.map(call => ({
          content: MINIMUM_AGENT_PROVIDER_TOOL_RESULT_CONTENT,
          name: call.name,
          role: 'tool' as const,
          toolCallId: call.id,
        })),
      ],
      systemPrompt,
      tools: providerTools,
    });
    const outputReserveTokens = 1_000;
    const providerRequestLimit = continuationWithMinimumResults - 1;
    expect(continuationBaseTokens).toBeLessThan(providerRequestLimit);

    const executeMain = vi.fn(async () => ({ message: '不应执行', ok: true }));
    mocks.streamAgentProviderTurn.mockResolvedValueOnce({
      content: '准备执行。',
      toolCalls,
    });
    const webContents = sender();
    const orchestrator = createAgentOrchestrator({
      contextBudget: {
        contextWindowTokens: providerRequestLimit + outputReserveTokens,
        outputReserveTokens,
        recentHistoryTokens: 100,
        summaryReserveTokens: 1,
        toolLoopReserveTokens: 1,
      },
      getRuntimeProfile: () => ({
        apiKey: 'test-key',
        baseUrl: 'https://ai.example.com/v1',
        providerType: 'openai',
      }),
      getSessionStore: async () => store,
      runSessionRegistry: createAIServiceRunSessionRegistry(),
      toolBroker: { executeMain } as never,
    });

    const started = await orchestrator.start(webContents as never, currentRequest);
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        message: expect.stringContaining('本轮未执行工具'),
        runId: started.runId,
        type: 'error',
      }));
    });

    expect(mocks.streamAgentProviderTurn).toHaveBeenCalledTimes(1);
    expect(executeMain).not.toHaveBeenCalled();
    expect((await store.getSession(started.sessionId, OWNER_SCOPE, 3))?.toolActivities)
      .toEqual([]);
  });

  it('reserves a possible post-Tool perception prompt before any side effect', async () => {
    const currentRequest = { ...request(), perception: undefined };
    const registeredTools = agentToolRegistry.list();
    const providerTools = [agentPlanControlTool, ...registeredTools];
    const capabilities = registeredTools.map(tool => tool.name);
    const catalog = skillPromptCatalog();
    const toolCalls = [{ id: 'call-create-boundary', input: { name: '测试' }, name: 'directory.create' }];
    const messages = [
      { content: currentRequest.userPrompt, role: 'user' as const },
      { content: '', role: 'assistant' as const, toolCalls },
      {
        content: MINIMUM_AGENT_PROVIDER_TOOL_RESULT_CONTENT,
        name: 'directory.create',
        role: 'tool' as const,
        toolCallId: 'call-create-boundary',
      },
    ];
    const withoutPerceptionTokens = estimateAgentProviderTurnTokens({
      messages,
      systemPrompt: buildAgentSystemPrompt(
        currentRequest.appContext,
        undefined,
        capabilities,
        catalog.summaries,
        catalog.omittedSkillCount,
      ),
      tools: providerTools,
    });
    const withPerceptionTokens = estimateAgentProviderTurnTokens({
      messages,
      systemPrompt: buildAgentSystemPrompt(currentRequest.appContext, {
        collectedAt: '2026-08-23T00:00:00.000Z',
        selectedNodes: [],
      }, capabilities, catalog.summaries, catalog.omittedSkillCount),
      tools: providerTools,
    });
    expect(withPerceptionTokens).toBeGreaterThan(withoutPerceptionTokens);
    const outputReserveTokens = 1_000;
    const providerRequestLimit = withPerceptionTokens - 1;
    expect(withoutPerceptionTokens).toBeLessThanOrEqual(providerRequestLimit);

    mocks.streamAgentProviderTurn.mockResolvedValueOnce({ content: '', toolCalls });
    const webContents = sender();
    const orchestrator = createAgentOrchestrator({
      contextBudget: {
        contextWindowTokens: providerRequestLimit + outputReserveTokens,
        outputReserveTokens,
        recentHistoryTokens: 100,
        summaryReserveTokens: 1,
        toolLoopReserveTokens: 1,
      },
      getRuntimeProfile: () => ({
        apiKey: 'test-key',
        baseUrl: 'https://ai.example.com/v1',
        providerType: 'openai',
      }),
      getSessionStore: async () => store,
      runSessionRegistry: createAIServiceRunSessionRegistry(),
    });

    const started = await orchestrator.start(webContents as never, currentRequest);
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        message: expect.stringContaining('本轮未执行工具'),
        runId: started.runId,
        type: 'error',
      }));
    });

    expect(webContents.send.mock.calls.map(call => call[1]?.type))
      .not.toContain('tool-approval-required');
    expect((await store.getSession(started.sessionId, OWNER_SCOPE, 3))?.toolActivities)
      .toEqual([]);
  });

  it('reserves exact minimum result space for later Tool calls with asymmetric identities', async () => {
    const currentRequest = request();
    const registeredTools = agentToolRegistry.list();
    const providerTools = [agentPlanControlTool, ...registeredTools];
    const toolCalls = [
      { id: 'a', input: {}, name: 'file.list' },
      { id: `call-${'x'.repeat(123)}`, input: { nodeId: 8 }, name: 'file.stat' },
    ];
    const catalog = skillPromptCatalog();
    const systemPrompt = buildAgentSystemPrompt(
      currentRequest.appContext,
      currentRequest.perception,
      registeredTools.map(tool => tool.name),
      catalog.summaries,
      catalog.omittedSkillCount,
    );
    const messages = [
      { content: currentRequest.userPrompt, role: 'user' as const },
      { content: '', role: 'assistant' as const, toolCalls },
    ];
    const providerRequestLimit = estimateAgentProviderTurnTokens({
      messages: [
        ...messages,
        ...toolCalls.map(call => ({
          content: MINIMUM_AGENT_PROVIDER_TOOL_RESULT_CONTENT,
          name: call.name,
          role: 'tool' as const,
          toolCallId: call.id,
        })),
      ],
      systemPrompt,
      tools: providerTools,
    });
    const outputReserveTokens = 1_000;
    const executeMain = vi.fn(async () => ({
      data: { entries: Array.from({ length: 50 }, () => 'x'.repeat(1_000)) },
      ok: true,
    }));
    mocks.streamAgentProviderTurn
      .mockResolvedValueOnce({ content: '', toolCalls })
      .mockImplementationOnce(async (_connection, input, onDelta) => {
        const results = input.messages.slice(-2);
        expect(results).toEqual([
          expect.objectContaining({ name: 'file.list', role: 'tool' }),
          expect.objectContaining({ name: 'file.stat', role: 'tool' }),
        ]);
        results.forEach((result: { content: string }) => {
          expect(JSON.parse(result.content)._omniflowProjection).toMatchObject({
            reason: 'provider_context_budget',
            truncated: true,
          });
        });
        onDelta('两个工具均已完成。');
        return { content: '两个工具均已完成。', toolCalls: [] };
      });
    const webContents = sender();
    const orchestrator = createAgentOrchestrator({
      contextBudget: {
        contextWindowTokens: providerRequestLimit + outputReserveTokens,
        outputReserveTokens,
        recentHistoryTokens: 100,
        summaryReserveTokens: 1,
        toolLoopReserveTokens: 1,
      },
      getRuntimeProfile: () => ({
        apiKey: 'test-key',
        baseUrl: 'https://ai.example.com/v1',
        providerType: 'openai',
      }),
      getSessionStore: async () => store,
      runSessionRegistry: createAIServiceRunSessionRegistry(),
      toolBroker: { executeMain } as never,
    });

    const started = await orchestrator.start(webContents as never, currentRequest);
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        runId: started.runId,
        type: 'completed',
      }));
    });

    expect(executeMain).toHaveBeenCalledTimes(2);
    const activities = (await store.getSession(started.sessionId, OWNER_SCOPE, 3))?.toolActivities;
    expect(activities).toHaveLength(2);
    activities?.forEach((activity) => {
      expect((activity.result?.data as { entries?: unknown[] })?.entries).toHaveLength(50);
    });
  });

  it('fails an oversized current user message without calling the provider', async () => {
    const webContents = sender();
    const orchestrator = createOrchestrator();
    const createRun = vi.spyOn(store, 'createRun');

    await expect(orchestrator.start(webContents as never, {
      ...request(),
      userPrompt: 'x'.repeat(60_000),
    })).rejects.toThrow('本次不会截断当前消息');

    expect(mocks.streamAgentProviderTurn).not.toHaveBeenCalled();
    expect(createRun).not.toHaveBeenCalled();
    expect((await store.listSessions(OWNER_SCOPE, 3)).total).toBe(0);
    expect(webContents.send).not.toHaveBeenCalled();
  });

  it('fails before the provider when fixed input and reserves exceed a small window', async () => {
    const webContents = sender();
    const createRun = vi.spyOn(store, 'createRun');
    const orchestrator = createAgentOrchestrator({
      contextBudget: {
        contextWindowTokens: 4_000,
        outputReserveTokens: 1_500,
        toolLoopReserveTokens: 1_500,
      },
      getRuntimeProfile: () => ({
        apiKey: 'test-key',
        baseUrl: 'https://ai.example.com/v1',
        providerType: 'openai',
      }),
      getSessionStore: async () => store,
      runSessionRegistry: createAIServiceRunSessionRegistry(),
    });

    await expect(orchestrator.start(webContents as never, request()))
      .rejects.toThrow('固定输入和安全预留超过模型上下文窗口');

    expect(mocks.streamAgentProviderTurn).not.toHaveBeenCalled();
    expect(createRun).not.toHaveBeenCalled();
    expect((await store.listSessions(OWNER_SCOPE, 3)).total).toBe(0);
  });

  it('rejects an output reserve above the provider safety ceiling before creating a Run', async () => {
    const webContents = sender();
    const createRun = vi.spyOn(store, 'createRun');
    const orchestrator = createAgentOrchestrator({
      contextBudget: {
        contextWindowTokens: 2_000_000,
        outputReserveTokens: 1_000_001,
        toolLoopReserveTokens: 1,
      },
      getRuntimeProfile: () => ({
        apiKey: 'test-key',
        baseUrl: 'https://ai.example.com/v1',
        providerType: 'openai',
      }),
      getSessionStore: async () => store,
      runSessionRegistry: createAIServiceRunSessionRegistry(),
    });

    await expect(orchestrator.start(webContents as never, request()))
      .rejects.toThrow('AI 输出 token 上限必须是');
    expect(mocks.streamAgentProviderTurn).not.toHaveBeenCalled();
    expect(createRun).not.toHaveBeenCalled();
  });

  it('supports a configured small context window when the complete request fits', async () => {
    mocks.streamAgentProviderTurn.mockImplementationOnce(async (_connection, input, onDelta) => {
      expect(input.maxOutputTokens).toBe(1_000);
      expect(input.messages.at(-1)?.content).toBe('短请求');
      onDelta('完成。');
      return { content: '完成。', toolCalls: [] };
    });
    const webContents = sender();
    const resolveContextBudget = vi.fn(() => ({ contextWindowTokens: 8_000 }));
    const orchestrator = createAgentOrchestrator({
      contextBudget: {
        outputReserveTokens: 1_000,
        recentHistoryTokens: 1_000,
        summaryReserveTokens: 250,
        toolLoopReserveTokens: 1_000,
      },
      getRuntimeProfile: () => ({
        apiKey: 'test-key',
        baseUrl: 'https://ai.example.com/v1',
        providerType: 'openai',
      }),
      getSessionStore: async () => store,
      resolveContextBudget,
      runSessionRegistry: createAIServiceRunSessionRegistry(),
    });

    const started = await orchestrator.start(webContents as never, {
      ...request(),
      userPrompt: '短请求',
    });
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith(
        'agent:chat:event',
        expect.objectContaining({ runId: started.runId, type: 'completed' }),
      );
    });
    expect(mocks.streamAgentProviderTurn).toHaveBeenCalledTimes(1);
    expect(resolveContextBudget).toHaveBeenCalledWith({
      model: 'test-model',
      providerType: 'openai',
    });
  });

  it('continues an existing session with a new run', async () => {
    mocks.streamAgentProviderTurn
      .mockImplementationOnce(async (_profileId, _input, onDelta) => {
        onDelta('第一轮完成。');
        return { content: '第一轮完成。', toolCalls: [] };
      })
      .mockImplementationOnce(async (_profileId, input, onDelta) => {
        expect(input.messages.map((message: { content: string }) => message.content)).toEqual([
          '当前目录有什么？',
          '第一轮完成。',
          '继续',
        ]);
        onDelta('第二轮完成。');
        return { content: '第二轮完成。', toolCalls: [] };
      });
    const webContents = sender();
    const orchestrator = createOrchestrator();
    const first = await orchestrator.start(webContents as never, request());
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith(
        'agent:chat:event',
        expect.objectContaining({ runId: first.runId, type: 'completed' }),
      );
    });

    const second = await orchestrator.start(webContents as never, {
      ...request(),
      sessionId: first.sessionId,
      userPrompt: '继续',
    });
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith(
        'agent:chat:event',
        expect.objectContaining({ runId: second.runId, type: 'completed' }),
      );
    });

    expect(second.sessionId).toBe(first.sessionId);
    expect(second.runId).not.toBe(first.runId);
    expect((await store.getSession(first.sessionId, OWNER_SCOPE, 3))?.messages).toHaveLength(4);
  });

  it('compacts long terminal Runs before the provider call without changing transcript facts', async () => {
    const sessionId = 'session-long-context';
    const firstOnly = `FIRST_ONLY_SECRET ${'first '.repeat(5_000)}`;
    const recent = `SECOND_RECENT ${'second '.repeat(200)}`;
    await store.createSession({
      appContext: request().appContext,
      id: sessionId,
      now: '2026-08-23T00:00:00.000Z',
      ownerScope: OWNER_SCOPE,
      title: '长会话',
    });
    await store.createRun({
      id: 'run-old-1',
      model: 'test-model',
      now: '2026-08-23T00:00:01.000Z',
      profileId: 'profile-1',
      reasoningEffort: 'auto',
      sessionId,
      userPrompt: firstOnly,
    });
    await store.appendMessage({
      content: firstOnly,
      createdAt: '2026-08-23T00:00:02.000Z',
      id: 'old-assistant-1',
      role: 'assistant',
      runId: 'run-old-1',
      sessionId,
    });
    await store.updateRun('run-old-1', {
      finishedAt: '2026-08-23T00:00:03.000Z',
      status: 'completed',
      updatedAt: '2026-08-23T00:00:03.000Z',
    });
    await store.createRun({
      id: 'run-old-2',
      model: 'test-model',
      now: '2026-08-23T00:00:04.000Z',
      profileId: 'profile-1',
      reasoningEffort: 'auto',
      sessionId,
      userPrompt: recent,
    });
    await store.appendMessage({
      content: recent,
      createdAt: '2026-08-23T00:00:05.000Z',
      id: 'old-assistant-2',
      role: 'assistant',
      runId: 'run-old-2',
      sessionId,
    });
    await store.updateRun('run-old-2', {
      finishedAt: '2026-08-23T00:00:06.000Z',
      status: 'completed',
      updatedAt: '2026-08-23T00:00:06.000Z',
    });

    const summaryPayloads: string[] = [];
    mocks.streamAIServiceProfile.mockImplementation(async (input) => {
      expect(input.systemPrompt).toContain('会话摘要压缩器');
      summaryPayloads.push(input.messages[0].content);
      return JSON.stringify({
        constraintsAndPreferences: [],
        decisionsAndRationale: [],
        goalsAndIntent: ['保留较早会话目标。'],
        taskContext: ['较早会话已经压缩。'],
        unresolvedAndNextSteps: ['继续当前问题。'],
        version: 1,
      });
    });
    mocks.streamAgentProviderTurn.mockImplementationOnce(async (_connection, input, onDelta) => {
      const serializedMessages = JSON.stringify(input.messages);
      expect(serializedMessages).toContain('低权限历史上下文投影');
      expect(serializedMessages).toContain('保留较早会话目标');
      expect(serializedMessages).not.toContain('FIRST_ONLY_SECRET');
      expect(serializedMessages).toContain('SECOND_RECENT');
      expect(serializedMessages).toContain('继续处理');
      onDelta('已经继续。');
      return { content: '已经继续。', toolCalls: [] };
    });

    const webContents = sender();
    const orchestrator = createOrchestrator();
    const started = await orchestrator.start(webContents as never, {
      ...request(),
      sessionId,
      userPrompt: '继续处理',
    });
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith(
        'agent:chat:event',
        expect.objectContaining({ runId: started.runId, type: 'completed' }),
      );
    });

    expect(mocks.streamAIServiceProfile.mock.calls.length).toBeGreaterThan(1);
    expect(mocks.streamAIServiceProfile.mock.calls.length).toBeLessThanOrEqual(4);
    expect(summaryPayloads.join('\n')).toContain('FIRST_ONLY_SECRET');
    expect((await store.readContextCheckpointState(sessionId, OWNER_SCOPE, 3))?.latestCompleted)
      .toMatchObject({ status: 'completed', throughMessageId: 'old-assistant-1' });
    const snapshot = await store.getSession(sessionId, OWNER_SCOPE, 3);
    expect(snapshot?.messages.some(item => item.content.includes('FIRST_ONLY_SECRET'))).toBe(true);
    expect(snapshot?.messages).toHaveLength(6);
  });

  it('freezes the AI service connection and locks its profile for the entire run', async () => {
    const sourceConnection = {
      apiKey: 'secret-a',
      baseUrl: 'https://ai-a.example.com/v1',
      providerType: 'openai' as const,
    };
    const registry = createAIServiceRunSessionRegistry();
    const getRuntimeProfile = vi.fn(() => sourceConnection);
    let finishTurn: () => void = () => undefined;
    mocks.streamAgentProviderTurn.mockImplementationOnce(async (connection, _input, onDelta) => {
      expect(connection).toEqual(sourceConnection);
      await new Promise<void>((resolve) => {
        finishTurn = resolve;
      });
      onDelta('已完成。');
      return { content: '已完成。', toolCalls: [] };
    });
    const webContents = sender();
    const orchestrator = createAgentOrchestrator({
      getRuntimeProfile,
      getSessionStore: async () => store,
      runSessionRegistry: registry,
    });

    const started = await orchestrator.start(webContents as never, request());
    await vi.waitFor(() => expect(mocks.streamAgentProviderTurn).toHaveBeenCalled());
    sourceConnection.apiKey = 'secret-b';
    sourceConnection.baseUrl = 'https://ai-b.example.com/v1';
    expect(mocks.streamAgentProviderTurn.mock.calls[0][0]).toMatchObject({
      apiKey: 'secret-a',
      baseUrl: 'https://ai-a.example.com/v1',
    });
    expect(() => registry.assertProfileUnlocked('profile-1')).toThrow('正在被任务使用');
    finishTurn();

    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith(
        'agent:chat:event',
        expect.objectContaining({ runId: started.runId, type: 'completed' }),
      );
    });
    expect(getRuntimeProfile).toHaveBeenCalledTimes(1);
    expect(() => registry.assertProfileUnlocked('profile-1')).not.toThrow();
  });

  it('includes persisted partial content in provider error events', async () => {
    mocks.streamAgentProviderTurn.mockImplementationOnce(async (_connection, _input, onDelta) => {
      onDelta('已经生成的部分内容');
      throw new Error('Authorization: Bearer provider-private-token');
    });
    const webContents = sender();
    const orchestrator = createOrchestrator();

    const started = await orchestrator.start(webContents as never, request());
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        content: '已经生成的部分内容',
        message: 'Authorization: [REDACTED]',
        messages: expect.arrayContaining([
          expect.objectContaining({ content: '已经生成的部分内容', role: 'assistant' }),
        ]),
        runId: started.runId,
        sessionId: started.sessionId,
        type: 'error',
      }));
    });
    expect((await store.getSession(started.sessionId, OWNER_SCOPE, 3))?.messages.at(-1)?.content)
      .toBe('已经生成的部分内容');
    const snapshot = await store.getSession(started.sessionId, OWNER_SCOPE, 3);
    expect(snapshot?.runs.at(-1)?.error).toBe('Authorization: [REDACTED]');
    expect(JSON.stringify(snapshot)).not.toContain('provider-private-token');
  });

  it('aborts an owner run without allowing the same session to restart before cleanup', async () => {
    const runControl: {
      confirmAbort?: () => void;
      rejectTurn?: () => void;
    } = {};
    const abortObserved = new Promise<void>((resolve) => {
      runControl.confirmAbort = resolve;
    });
    mocks.streamAgentProviderTurn.mockImplementationOnce(async (
      _connection,
      _input,
      _onDelta,
      signal,
    ) => new Promise((_resolve, reject) => {
      const handleAbort = () => {
        runControl.confirmAbort?.();
        runControl.rejectTurn = () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        };
      };
      if (signal.aborted) handleAbort();
      else signal.addEventListener('abort', handleAbort, { once: true });
    }));
    const webContents = sender();
    const orchestrator = createOrchestrator();
    const started = await orchestrator.start(webContents as never, request());

    orchestrator.releaseOwner(webContents.id);
    await abortObserved;
    await expect(orchestrator.start(webContents as never, {
      ...request(),
      sessionId: started.sessionId,
      userPrompt: '不应并行启动',
    })).rejects.toThrow('正在处理上一条消息');

    runControl.rejectTurn?.();
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith(
        'agent:chat:event',
        expect.objectContaining({ runId: started.runId, type: 'cancelled' }),
      );
    });
  });

  it('cancels a start that is still waiting for the session store', async () => {
    const startControl: {
      resolveStore?: (value: AgentSessionStore) => void;
    } = {};
    const delayedStore = new Promise<AgentSessionStore>((resolve) => {
      startControl.resolveStore = resolve;
    });
    const registry = createAIServiceRunSessionRegistry();
    const webContents = sender();
    const orchestrator = createAgentOrchestrator({
      getRuntimeProfile: () => ({
        apiKey: 'test-key',
        baseUrl: 'https://ai.example.com/v1',
        providerType: 'openai',
      }),
      getSessionStore: () => delayedStore,
      runSessionRegistry: registry,
    });

    const startPromise = orchestrator.start(webContents as never, request());
    orchestrator.releaseOwner(webContents.id);
    startControl.resolveStore?.(store);

    await expect(startPromise).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.streamAgentProviderTurn).not.toHaveBeenCalled();
    expect(() => registry.assertProfileUnlocked('profile-1')).not.toThrow();
    expect((await store.listSessions(OWNER_SCOPE, 3)).total).toBe(0);
  });

  it('rejects a high-confidence secret in the user prompt before creating a session or Run', async () => {
    const webContents = sender();
    const orchestrator = createOrchestrator();
    const createRun = vi.spyOn(store, 'createRun');

    await expect(orchestrator.start(webContents as never, {
      ...request(),
      userPrompt: '请使用 API 密钥为 sk-proj-abcdefghijklmnopqrstuvwxyz 继续处理',
    })).rejects.toThrow('请求中包含 API Key、密码、Cookie、令牌、私钥或其他凭据');

    expect(createRun).not.toHaveBeenCalled();
    expect(mocks.streamAgentProviderTurn).not.toHaveBeenCalled();
    expect((await store.listSessions(OWNER_SCOPE, 3)).total).toBe(0);
    expect(webContents.send).not.toHaveBeenCalled();
  });

  it('rejects oversized request identifiers before starting or persisting a Run', async () => {
    const webContents = sender();
    const orchestrator = createOrchestrator();

    await expect(orchestrator.start(webContents as never, {
      ...request(),
      profileId: 'p'.repeat(201),
    })).rejects.toThrow('AI 服务配置 ID 过长');
    await expect(orchestrator.start(webContents as never, {
      ...request(),
      model: 'm'.repeat(201),
    })).rejects.toThrow('模型名称过长');
    await expect(orchestrator.start(webContents as never, {
      ...request(),
      sessionId: 's'.repeat(201),
    })).rejects.toThrow('Agent 会话 ID 过长');

    expect(mocks.streamAgentProviderTurn).not.toHaveBeenCalled();
    expect((await store.listSessions(OWNER_SCOPE, 3)).total).toBe(0);
    expect(webContents.send).not.toHaveBeenCalled();
  });

  it('bounds app context strings and selected node IDs in main', async () => {
    mocks.streamAgentProviderTurn.mockImplementationOnce(async (_connection, input, onDelta) => {
      expect(input.systemPrompt).not.toContain('directory-private-tail');
      onDelta('已完成。');
      return { content: '已完成。', toolCalls: [] };
    });
    const webContents = sender();
    const orchestrator = createOrchestrator();
    const createSession = vi.spyOn(store, 'createSession');
    const started = await orchestrator.start(webContents as never, {
      ...request(),
      appContext: {
        activeToolId: 'a'.repeat(500),
        currentDirectory: {
          id: 10,
          name: `${'d'.repeat(600)}directory-private-tail`,
        },
        libraryId: 3,
        platform: 'darwin',
        selectedNodeIds: Array.from({ length: 1_000 }, (_, index) => index + 1),
      },
    });
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith(
        'agent:chat:event',
        expect.objectContaining({ runId: started.runId, type: 'completed' }),
      );
    });

    const persistedContext = createSession.mock.calls[0]?.[0].appContext;
    expect(persistedContext?.activeToolId).toHaveLength(100);
    expect(persistedContext?.currentDirectory?.name).toHaveLength(500);
    expect(persistedContext?.selectedNodeIds).toHaveLength(200);
  });

  it('sanitizes user-controlled names in approval previews before persistence or events', async () => {
    mocks.streamAgentProviderTurn.mockResolvedValueOnce({
      content: '',
      toolCalls: [{
        id: 'call-safe-preview',
        input: { name: '测试目录' },
        name: 'directory.create',
      }],
    });
    const webContents = sender();
    const orchestrator = createOrchestrator();
    const started = await orchestrator.start(webContents as never, {
      ...request(),
      appContext: {
        ...request().appContext,
        currentDirectory: { id: 10, name: 'password=preview-private-value' },
      },
    });

    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith(
        'agent:chat:event',
        expect.objectContaining({ type: 'tool-approval-required' }),
      );
    });
    const snapshot = await store.getSession(started.sessionId, OWNER_SCOPE, 3);
    const serializedSnapshot = JSON.stringify(snapshot);
    const serializedEvents = JSON.stringify(webContents.send.mock.calls);
    expect(serializedSnapshot).toContain('[REDACTED]');
    expect(serializedSnapshot).not.toContain('preview-private-value');
    expect(serializedEvents).not.toContain('preview-private-value');

    expect(orchestrator.stop(started.sessionId, webContents.id)).toBe(true);
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith(
        'agent:chat:event',
        expect.objectContaining({ runId: started.runId, type: 'cancelled' }),
      );
    });
  });

  it('omits a secret-soliciting interaction before ToolRun persistence or raw event emission', async () => {
    mocks.streamAgentProviderTurn
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{
          id: 'call-secret-interaction',
          input: {
            fields: [{ id: 'a.p.i-k_e_y', label: '连接值', type: 'text' }],
            kind: 'form',
            prompt: '补充连接参数',
          },
          name: 'interaction.request',
        }],
      })
      .mockImplementationOnce(async (_connection, input, onDelta) => {
        const providerHistory = JSON.stringify(input.messages);
        expect(providerHistory).toContain('sensitive interaction request omitted');
        expect(providerHistory).not.toContain('a.p.i-k_e_y');
        expect(providerHistory).not.toContain('补充连接参数');
        onDelta('我不能通过对话索取凭据。');
        return { content: '我不能通过对话索取凭据。', toolCalls: [] };
      });
    const webContents = sender();
    const orchestrator = createOrchestrator();
    const started = await orchestrator.start(webContents as never, request());

    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        content: '我不能通过对话索取凭据。',
        type: 'completed',
      }));
    });
    const snapshot = await store.getSession(started.sessionId, OWNER_SCOPE, 3);
    expect(snapshot?.toolActivities).toEqual([]);
    expect(JSON.stringify(snapshot)).not.toContain('a.p.i-k_e_y');
    expect(JSON.stringify(webContents.send.mock.calls)).not.toContain('a.p.i-k_e_y');
    expect(webContents.send.mock.calls.map(call => call[1]?.type)).not.toContain('tool-started');
    expect(webContents.send.mock.calls.map(call => call[1]?.type))
      .not.toContain('tool-interaction-required');
  });

  it('validates Tool schemas before domain validation, permission checks, or side effects', async () => {
    const validate = vi.fn(() => ({ ok: true as const }));
    const assess = vi.fn(() => ({ behavior: 'allow' as const, risk: 'read' as const }));
    const execute = vi.fn(async () => ({ message: '不应执行', ok: true }));
    agentToolRegistry.register({
      assess,
      description: 'strict schema preflight test',
      execute,
      inputSchema: {
        additionalProperties: false,
        properties: { count: { type: 'integer' } },
        required: ['count'],
        type: 'object',
      },
      name: 'test.schema-preflight',
      risk: 'read',
      validate,
    });
    mocks.streamAgentProviderTurn
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{
          id: 'call-invalid-schema',
          input: { count: '3', privateValue: 'schema-private-value' },
          name: 'test.schema-preflight',
        }],
      })
      .mockImplementationOnce(async (_connection, input, onDelta) => {
        const providerHistory = JSON.stringify(input.messages);
        expect(providerHistory).toContain('invalid Tool input omitted');
        expect(providerHistory).toContain('Agent Tool 参数不符合输入约束');
        expect(providerHistory).not.toContain('schema-private-value');
        onDelta('工具参数无效，未执行。');
        return { content: '工具参数无效，未执行。', toolCalls: [] };
      });
    const webContents = sender();
    const orchestrator = createOrchestrator();
    const started = await orchestrator.start(webContents as never, request());

    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        content: '工具参数无效，未执行。',
        type: 'completed',
      }));
    });

    expect(validate).not.toHaveBeenCalled();
    expect(assess).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    const snapshot = await store.getSession(started.sessionId, OWNER_SCOPE, 3);
    expect(snapshot?.toolActivities).toEqual([]);
    expect(JSON.stringify(snapshot)).not.toContain('schema-private-value');
    expect(JSON.stringify(webContents.send.mock.calls)).not.toContain('schema-private-value');
    expect(webContents.send.mock.calls.map(call => call[1]?.type)).not.toContain('tool-started');
  });

  it('persists and emits only a bounded sanitized projection for an unknown sensitive Tool', async () => {
    const rawSecret = 'sk-proj-abcdefghijklmnopqrstuvwxyz';
    const oversized = 'x'.repeat(20_000);
    mocks.streamAgentProviderTurn
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{
          id: 'call-unknown-sensitive',
          input: {
            apiKey: rawSecret,
            nested: { authorization: 'Bearer abcdefghijklmnop' },
            payload: oversized,
            safe: 'visible',
          },
          name: 'unknown.external',
        }],
      })
      .mockImplementationOnce(async (_connection, input, onDelta) => {
        const providerHistory = JSON.stringify(input.messages);
        expect(providerHistory).toContain('[REDACTED]');
        expect(providerHistory).toContain('visible');
        expect(providerHistory).not.toContain(rawSecret);
        expect(providerHistory).not.toContain('abcdefghijklmnop');
        expect(providerHistory).not.toContain('x'.repeat(1_000));
        onDelta('未知工具没有执行。');
        return { content: '未知工具没有执行。', toolCalls: [] };
      });
    const webContents = sender();
    const orchestrator = createOrchestrator();
    const started = await orchestrator.start(webContents as never, request());

    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        content: '未知工具没有执行。',
        type: 'completed',
      }));
    });
    const snapshot = await store.getSession(started.sessionId, OWNER_SCOPE, 3);
    expect(snapshot?.toolActivities).toHaveLength(1);
    expect(snapshot?.toolActivities[0]).toMatchObject({
      call: { name: 'unknown.external' },
      permissionBehavior: 'deny',
      status: 'failed',
    });
    const persisted = JSON.stringify(snapshot?.toolActivities[0]);
    const emitted = JSON.stringify(webContents.send.mock.calls);
    expect(persisted).toContain('[REDACTED]');
    expect(persisted.length).toBeLessThan(8_000);
    expect(persisted).not.toContain(rawSecret);
    expect(persisted).not.toContain('x'.repeat(1_000));
    expect(emitted).not.toContain(rawSecret);
    expect(emitted).not.toContain('x'.repeat(1_000));
  });

  it('rejects prototype mutation Tool input before Broker execution', async () => {
    const executeMain = vi.fn(async () => ({ message: '不应执行', ok: true }));
    const unsafeInput = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},'
      + '"safe":"visible"}',
    );
    mocks.streamAgentProviderTurn
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: 'call-unsafe-prototype', input: unsafeInput, name: 'file.list' }],
      })
      .mockImplementationOnce(async (_connection, input, onDelta) => {
        const providerHistory = JSON.stringify(input.messages);
        expect(input.messages.at(-1)).toMatchObject({ name: 'file.list', role: 'tool' });
        expect(input.messages.at(-1)?.content).toContain('Agent Tool 参数不符合输入约束');
        expect(providerHistory).toContain('invalid Tool input omitted');
        expect(providerHistory).not.toContain('polluted');
        onDelta('该工具参数已被拒绝。');
        return { content: '该工具参数已被拒绝。', toolCalls: [] };
      });
    const webContents = sender();
    const orchestrator = createAgentOrchestrator({
      getRuntimeProfile: () => ({
        apiKey: 'test-key',
        baseUrl: 'https://ai.example.com/v1',
        providerType: 'openai',
      }),
      getSessionStore: async () => store,
      runSessionRegistry: createAIServiceRunSessionRegistry(),
      toolBroker: { executeMain } as never,
    });

    const started = await orchestrator.start(webContents as never, request());
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        content: '该工具参数已被拒绝。',
        type: 'completed',
      }));
    });

    expect(executeMain).not.toHaveBeenCalled();
    const snapshot = await store.getSession(started.sessionId, OWNER_SCOPE, 3);
    expect(snapshot?.toolActivities).toEqual([]);
    const persisted = JSON.stringify(snapshot);
    const emitted = JSON.stringify(webContents.send.mock.calls);
    expect(persisted).not.toContain('polluted');
    expect(emitted).not.toContain('polluted');
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('fails during streaming before assistant content can exceed the Run-wide limit', async () => {
    let turn = 0;
    mocks.streamAgentProviderTurn.mockImplementation(async (_connection, _input, onDelta) => {
      turn += 1;
      const delta = 'z'.repeat(turn <= 4 ? 15_000 : 5_000);
      onDelta(delta);
      return {
        content: delta,
        toolCalls: turn <= 4
          ? [{ id: `call-list-${turn}`, input: {}, name: 'file.list' }]
          : [],
      };
    });
    const webContents = sender();
    const orchestrator = createAgentOrchestrator({
      contextBudget: { contextWindowTokens: 200_000 },
      getRuntimeProfile: () => ({
        apiKey: 'test-key',
        baseUrl: 'https://ai.example.com/v1',
        providerType: 'openai',
      }),
      getSessionStore: async () => store,
      runSessionRegistry: createAIServiceRunSessionRegistry(),
    });
    const started = await orchestrator.start(webContents as never, request());

    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        message: expect.stringContaining('Agent 单次运行回答超过安全上限'),
        type: 'error',
      }));
    });
    const snapshot = await store.getSession(started.sessionId, OWNER_SCOPE, 3);
    expect(snapshot?.lastRunStatus).toBe('failed');
    expect(snapshot?.messages
      .filter(message => message.role === 'assistant')
      .reduce((total, message) => total + message.content.length, 0)).toBe(60_000);
  });

  it('rejects a Skill whose complete activation result cannot fit the continuation budget', async () => {
    const skillId = 'test.activation-continuation-budget';
    const skillTools = agentToolRegistry.list()
      .filter(tool => tool.kind === 'business')
      .map(tool => tool.name);
    builtInAgentSkillRegistry.register({
      description: '用于验证完整 Skill 激活结果的续接预算边界。',
      id: skillId,
      instructions: 'Follow the registered tools in order and verify every result. '.repeat(45),
      optionalTools: [],
      requiredTools: skillTools,
      source: 'built-in',
      toolAllowlist: skillTools,
      version: '1.0.0',
      whenToUse: '只用于测试 continuation 剩余预算不足时必须在执行前拒绝。',
    });
    const currentRequest = {
      ...request(),
      userPrompt: '激活预算边界测试流程',
    };
    const capabilitySnapshot = createAgentRunCapabilitySnapshot({
      capabilitySnapshot: availableCapabilitySnapshot(),
      skillSnapshot: builtInAgentSkillRegistry.createRunSnapshot(),
      toolSnapshot: agentToolRegistry.createSnapshot(),
    });
    const skillSummaries = capabilitySnapshot.skillSnapshot.listSummaries();
    const omittedSkillCount = capabilitySnapshot.skillSnapshot.omittedSkillCount;
    const initialVisibleTools = capabilitySnapshot.listTools();
    const initialProviderTools = [agentPlanControlTool, ...initialVisibleTools];
    const initialSystemPrompt = buildAgentSystemPrompt(
      currentRequest.appContext,
      currentRequest.perception,
      initialVisibleTools.map(tool => tool.name),
      skillSummaries,
      omittedSkillCount,
    );
    const activationCall = {
      id: 'call-activation-continuation-budget',
      input: { skillId },
      name: 'skill.activate',
    };
    const initialMessages = [{
      content: currentRequest.userPrompt,
      role: 'user' as const,
    }];
    const messagesAfterActivationCall = [
      ...initialMessages,
      {
        content: '',
        role: 'assistant' as const,
        toolCalls: [activationCall],
      },
    ];
    const activatedVisibleTools = capabilitySnapshot.listTools(skillId);
    const activatedProviderTools = [agentPlanControlTool, ...activatedVisibleTools];
    const activatedSystemPrompt = buildAgentSystemPrompt(
      currentRequest.appContext,
      currentRequest.perception,
      activatedVisibleTools.map(tool => tool.name),
      skillSummaries,
      omittedSkillCount,
    );
    const activationResult = resolveAgentSkillActivationResult(activationCall.input, {
      runCapabilitySnapshot: capabilitySnapshot,
    });
    const completeProjection = projectAgentToolResultForProvider(activationResult, 1_024);
    expect(completeProjection.truncated).toBe(false);
    const initialTurnTokens = estimateAgentProviderTurnTokens({
      messages: initialMessages,
      systemPrompt: initialSystemPrompt,
      tools: initialProviderTools,
    });
    const minimumUnactivatedContinuationTokens = estimateAgentProviderTurnTokens({
      messages: [
        ...messagesAfterActivationCall,
        {
          content: MINIMUM_AGENT_PROVIDER_TOOL_RESULT_CONTENT,
          name: activationCall.name,
          role: 'tool' as const,
          toolCallId: activationCall.id,
        },
      ],
      systemPrompt: initialSystemPrompt,
      tools: initialProviderTools,
    });
    const emptyActivatedContinuationTokens = estimateAgentProviderTurnTokens({
      messages: [
        ...messagesAfterActivationCall,
        {
          content: '',
          name: activationCall.name,
          role: 'tool' as const,
          toolCallId: activationCall.id,
        },
      ],
      systemPrompt: activatedSystemPrompt,
      tools: activatedProviderTools,
    });
    const completeActivatedContinuationTokens = estimateAgentProviderTurnTokens({
      messages: [
        ...messagesAfterActivationCall,
        {
          content: completeProjection.content,
          name: activationCall.name,
          role: 'tool' as const,
          toolCallId: activationCall.id,
        },
      ],
      systemPrompt: activatedSystemPrompt,
      tools: activatedProviderTools,
    });
    const providerRequestLimit = completeActivatedContinuationTokens - 1;
    expect(Math.max(
      initialTurnTokens,
      minimumUnactivatedContinuationTokens,
      emptyActivatedContinuationTokens,
    )).toBeLessThanOrEqual(providerRequestLimit);

    mocks.streamAgentProviderTurn.mockResolvedValueOnce({
      content: '',
      toolCalls: [activationCall],
    });
    const createToolRun = vi.spyOn(store, 'createToolRun');
    const outputReserveTokens = 1_000;
    const webContents = sender();
    const orchestrator = createAgentOrchestrator({
      contextBudget: {
        contextWindowTokens: providerRequestLimit + outputReserveTokens,
        outputReserveTokens,
        recentHistoryTokens: 100,
        summaryReserveTokens: 1,
        toolLoopReserveTokens: 1,
      },
      getRuntimeProfile: () => ({
        apiKey: 'test-key',
        baseUrl: 'https://ai.example.com/v1',
        providerType: 'openai',
      }),
      getSessionStore: async () => store,
      runSessionRegistry: createAIServiceRunSessionRegistry(),
    });

    const started = await orchestrator.start(webContents as never, currentRequest);
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        message: expect.stringContaining('完整说明无法放入当前模型上下文'),
        runId: started.runId,
        type: 'error',
      }));
    });

    expect(mocks.streamAgentProviderTurn).toHaveBeenCalledTimes(1);
    expect(createToolRun).not.toHaveBeenCalled();
    expect(await store.getSession(started.sessionId, OWNER_SCOPE, 3)).toMatchObject({
      runs: [expect.objectContaining({
        error: expect.stringContaining('完整说明无法放入当前模型上下文'),
        status: 'failed',
      })],
      toolActivities: [],
    });
    expect(webContents.send.mock.calls.map(call => call[1]?.type)).not.toContain('tool-started');
  });

  it('budgets a valid Skill activation against the narrowed next-turn Tool set', async () => {
    const skillId = 'test.activation-narrowed-budget';
    const paddingToolNames = Array.from(
      { length: 12 },
      (_, index) => `test.activation-budget-padding-${index + 1}`,
    );
    paddingToolNames.forEach((name) => {
      agentToolRegistry.register({
        description: `Only used to make the pre-activation Provider schema larger. ${'detail '.repeat(30)}`,
        execute: vi.fn(async () => ({ message: name, ok: true })),
        inputSchema: {
          additionalProperties: false,
          properties: {
            value: {
              description: 'A deliberately verbose test-only input field. '.repeat(8),
              type: 'string',
            },
          },
          type: 'object',
        },
        name,
        risk: 'read',
      });
    });
    builtInAgentSkillRegistry.register({
      description: '用于验证激活续接预算使用收窄后的 Tool 集。',
      id: skillId,
      instructions: 'Call file.list once, then answer from its authoritative result.',
      optionalTools: [],
      requiredTools: ['file.list'],
      source: 'built-in',
      toolAllowlist: ['file.list'],
      version: '1.0.0',
      whenToUse: '只用于激活前后 Provider Tool schema 大小差异测试。',
    });

    const currentRequest = {
      ...request(),
      userPrompt: '执行收窄预算测试流程',
    };
    const capabilitySnapshot = createAgentRunCapabilitySnapshot({
      capabilitySnapshot: availableCapabilitySnapshot(),
      skillSnapshot: builtInAgentSkillRegistry.createRunSnapshot(),
      toolSnapshot: agentToolRegistry.createSnapshot(),
    });
    const skillSummaries = capabilitySnapshot.skillSnapshot.listSummaries();
    const omittedSkillCount = capabilitySnapshot.skillSnapshot.omittedSkillCount;
    const initialVisibleTools = capabilitySnapshot.listTools();
    const initialProviderTools = [agentPlanControlTool, ...initialVisibleTools];
    const initialSystemPrompt = buildAgentSystemPrompt(
      currentRequest.appContext,
      currentRequest.perception,
      initialVisibleTools.map(tool => tool.name),
      skillSummaries,
      omittedSkillCount,
    );
    const activationCall = {
      id: 'call-activation-narrowed-budget',
      input: { skillId },
      name: 'skill.activate',
    };
    const initialMessages = [{
      content: currentRequest.userPrompt,
      role: 'user' as const,
    }];
    const messagesAfterActivationCall = [
      ...initialMessages,
      {
        content: '',
        role: 'assistant' as const,
        toolCalls: [activationCall],
      },
    ];
    const activatedVisibleTools = capabilitySnapshot.listTools(skillId);
    const activatedProviderTools = [agentPlanControlTool, ...activatedVisibleTools];
    const activatedSystemPrompt = buildAgentSystemPrompt(
      currentRequest.appContext,
      currentRequest.perception,
      activatedVisibleTools.map(tool => tool.name),
      skillSummaries,
      omittedSkillCount,
    );
    const activationResult = resolveAgentSkillActivationResult(activationCall.input, {
      runCapabilitySnapshot: capabilitySnapshot,
    });
    const completeProjection = projectAgentToolResultForProvider(activationResult, 1_024);
    expect(completeProjection.truncated).toBe(false);

    const initialTurnTokens = estimateAgentProviderTurnTokens({
      messages: initialMessages,
      systemPrompt: initialSystemPrompt,
      tools: initialProviderTools,
    });
    const unactivatedMinimumContinuationTokens = estimateAgentProviderTurnTokens({
      messages: [
        ...messagesAfterActivationCall,
        {
          content: MINIMUM_AGENT_PROVIDER_TOOL_RESULT_CONTENT,
          name: activationCall.name,
          role: 'tool' as const,
          toolCallId: activationCall.id,
        },
      ],
      systemPrompt: initialSystemPrompt,
      tools: initialProviderTools,
    });
    const activatedCompleteContinuationTokens = estimateAgentProviderTurnTokens({
      messages: [
        ...messagesAfterActivationCall,
        {
          content: completeProjection.content,
          name: activationCall.name,
          role: 'tool' as const,
          toolCallId: activationCall.id,
        },
      ],
      systemPrompt: activatedSystemPrompt,
      tools: activatedProviderTools,
    });
    const providerRequestLimit = Math.max(
      initialTurnTokens,
      activatedCompleteContinuationTokens,
    );
    expect(unactivatedMinimumContinuationTokens).toBeGreaterThan(providerRequestLimit);

    mocks.streamAgentProviderTurn
      .mockResolvedValueOnce({ content: '', toolCalls: [activationCall] })
      .mockImplementationOnce(async (_connection, input, onDelta) => {
        const visibleToolNames = input.tools.map((tool: { name: string }) => tool.name);
        expect(visibleToolNames).toContain('file.list');
        expect(visibleToolNames).toContain('skill.activate');
        expect(visibleToolNames).not.toContain(paddingToolNames[0]);
        expect(JSON.parse(input.messages.at(-1).content)).toMatchObject({
          data: { skillId },
          ok: true,
        });
        onDelta('收窄后的续接请求已成功。');
        return { content: '收窄后的续接请求已成功。', toolCalls: [] };
      });
    const outputReserveTokens = 1_000;
    const webContents = sender();
    const orchestrator = createAgentOrchestrator({
      contextBudget: {
        contextWindowTokens: providerRequestLimit + outputReserveTokens,
        outputReserveTokens,
        recentHistoryTokens: 100,
        summaryReserveTokens: 1,
        toolLoopReserveTokens: 1,
      },
      getRuntimeProfile: () => ({
        apiKey: 'test-key',
        baseUrl: 'https://ai.example.com/v1',
        providerType: 'openai',
      }),
      getSessionStore: async () => store,
      runSessionRegistry: createAIServiceRunSessionRegistry(),
    });

    const started = await orchestrator.start(webContents as never, currentRequest);
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        content: '收窄后的续接请求已成功。',
        runId: started.runId,
        type: 'completed',
      }));
    });
    expect(mocks.streamAgentProviderTurn).toHaveBeenCalledTimes(2);
    expect((await store.getSession(started.sessionId, OWNER_SCOPE, 3))?.toolActivities)
      .toEqual([expect.objectContaining({
        call: expect.objectContaining({ name: 'skill.activate' }),
        status: 'completed',
      })]);
  });

  it('keeps live Tool and Skill registrations out of an already-started Run', async () => {
    const liveToolName = 'test.live-snapshot-tool';
    const liveSkillId = 'test.live-snapshot-skill';
    mocks.streamAgentProviderTurn
      .mockImplementationOnce(async (_connection, input) => {
        expect(input.tools.map((tool: { name: string }) => tool.name)).not.toContain(liveToolName);
        expect(input.systemPrompt).not.toContain(liveSkillId);
        agentToolRegistry.register({
          description: 'Only registrations created after a Run snapshot can see this Tool.',
          execute: vi.fn(async () => ({ message: '不应被当前 Run 执行', ok: true })),
          inputSchema: {
            additionalProperties: false,
            properties: {},
            type: 'object',
          },
          name: liveToolName,
          risk: 'read',
        });
        builtInAgentSkillRegistry.register({
          description: 'Run 启动后才出现的 Skill 摘要。',
          id: liveSkillId,
          instructions: 'Use only the live snapshot test Tool and verify its result.',
          optionalTools: [],
          requiredTools: [liveToolName],
          source: 'built-in',
          toolAllowlist: [liveToolName],
          version: '1.0.0',
          whenToUse: '只用于验证当前 Run 不读取 live Registry。',
        });
        return {
          content: '',
          toolCalls: [{ id: 'call-before-live-registration', input: {}, name: 'file.list' }],
        };
      })
      .mockImplementationOnce(async (_connection, input, onDelta) => {
        expect(input.tools.map((tool: { name: string }) => tool.name)).not.toContain(liveToolName);
        expect(input.systemPrompt).not.toContain(liveSkillId);
        expect(input.systemPrompt).not.toContain('Run 启动后才出现的 Skill 摘要');
        onDelta('当前 Run 仍使用启动时能力快照。');
        return { content: '当前 Run 仍使用启动时能力快照。', toolCalls: [] };
      });
    const webContents = sender();
    const orchestrator = createAgentOrchestrator({
      contextBudget: { contextWindowTokens: 200_000 },
      getRuntimeProfile: () => ({
        apiKey: 'test-key',
        baseUrl: 'https://ai.example.com/v1',
        providerType: 'openai',
      }),
      getSessionStore: async () => store,
      runSessionRegistry: createAIServiceRunSessionRegistry(),
    });

    const started = await orchestrator.start(webContents as never, request());
    await vi.waitFor(() => {
      expect(webContents.send).toHaveBeenCalledWith('agent:chat:event', expect.objectContaining({
        content: '当前 Run 仍使用启动时能力快照。',
        type: 'completed',
      }));
    });

    expect(agentToolRegistry.get(liveToolName)).not.toBeNull();
    expect(builtInAgentSkillRegistry.get(liveSkillId)).not.toBeNull();
    expect((await store.getSession(started.sessionId, OWNER_SCOPE, 3))?.toolActivities)
      .toEqual([expect.objectContaining({ call: expect.objectContaining({ name: 'file.list' }) })]);
  });

});
