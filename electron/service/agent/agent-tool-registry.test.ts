import { describe, expect, it, vi } from 'vitest';

import type { AgentMediaExtractAudioPreparedActionPublicV1 } from '@/shared/agent/agent.types';
import {
  createAgentToolRegistry,
  hashAgentToolInputForPreparation,
  type AgentToolExecutionContext,
  type AgentToolMainPreparationIdentity,
} from './agent-tool-registry';
import {
  AGENT_SKILL_ACTIVATE_TOOL_NAME,
  AGENT_SKILL_ACTIVATE_TOOL_REGISTRATION_ID,
} from './skills/agent-skill.types';

const PREPARED_TOOL_NAME = 'media.extractAudio';
const PREPARED_TOOL_REGISTRATION_ID = 'media.extractAudio@test';

function hashPreparationInput(input: unknown): string {
  return hashAgentToolInputForPreparation(input);
}

function mainPreparationIdentity(
  toolInput: unknown,
  preparedActionId = 'prepared-action-1',
): AgentToolMainPreparationIdentity {
  return {
    aiDestinationIdentity: `v1:${'a'.repeat(64)}`,
    callId: 'call-1',
    libraryId: 3,
    ownerScope: {
      accountScope: 'user:7',
      backendScope: 'http://localhost:9000',
    },
    ownerWebContentsId: 17,
    preparedActionId,
    runCapabilityIdentity: `v2:${'b'.repeat(64)}`,
    runId: 'run-1',
    sessionId: 'session-1',
    toolInputHash: hashPreparationInput(toolInput),
    toolName: PREPARED_TOOL_NAME,
    toolRegistrationId: PREPARED_TOOL_REGISTRATION_ID,
    toolRunId: 'tool-run-1',
  };
}

function mediaPreparedAction(): AgentMediaExtractAudioPreparedActionPublicV1 {
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
  };
}

describe('Agent Tool registry', () => {
  it('registers and executes only known tools', async () => {
    const registry = createAgentToolRegistry([
      {
        description: 'List the current directory',
        execute: async (input, context) => {
          context.onProgress({ message: '读取目录' });
          return { data: input, ok: true };
        },
        inputSchema: { type: 'object' },
        name: 'file.list',
        risk: 'read',
      },
    ]);
    const controller = new AbortController();
    const result = await registry.execute('file.list', { nodeId: 3 }, {
      appContext: {
        libraryId: 2,
        platform: 'darwin',
        selectedNodeIds: [],
      },
      onProgress: () => undefined,
      signal: controller.signal,
    });

    expect(result).toEqual({ data: { nodeId: 3 }, ok: true });
    expect(registry.list()).toHaveLength(1);
    await expect(registry.execute('media.extractAudio', {}, {
      appContext: { platform: 'darwin', selectedNodeIds: [] },
      onProgress: () => undefined,
      signal: controller.signal,
    })).rejects.toThrow('Agent Tool 不存在');
  });

  it('rejects duplicate names and cancelled executions', async () => {
    const tool = {
      description: 'No-op',
      execute: async () => ({ ok: true }),
      inputSchema: { type: 'object' },
      name: 'file.stat',
      risk: 'read' as const,
    };
    const registry = createAgentToolRegistry([tool]);
    expect(() => registry.register(tool)).toThrow('Agent Tool 已注册');

    const controller = new AbortController();
    controller.abort();
    await expect(registry.execute('file.stat', {}, {
      appContext: { platform: 'unknown', selectedNodeIds: [] },
      onProgress: () => undefined,
      signal: controller.signal,
    })).rejects.toThrow('执行已取消');
  });

  it('reserves agent control protocol names outside the business Tool registry', () => {
    const registry = createAgentToolRegistry();
    expect(() => registry.register({
      description: 'Must not register',
      execute: async () => ({ ok: true }),
      inputSchema: { type: 'object' },
      name: 'agent.plan.set',
      risk: 'read',
    })).toThrow('不能占用控制协议名称');
  });

  it('compiles schemas at registration and rejects invalid schemas without registering them', () => {
    const registry = createAgentToolRegistry();

    expect(() => registry.register({
      description: 'Invalid schema',
      execute: async () => ({ ok: true }),
      inputSchema: { type: 'not-a-json-schema-type' },
      name: 'invalid.schema',
      risk: 'read',
    })).toThrow('Agent Tool 输入约束无效');
    expect(registry.list()).toEqual([]);
  });

  it('rejects provider-incompatible non-object schema roots', () => {
    const registry = createAgentToolRegistry();

    [true, { type: 'string' }, []].forEach((inputSchema, index) => {
      expect(() => registry.register({
        description: 'Provider-incompatible schema',
        execute: async () => ({ ok: true }),
        inputSchema,
        name: `invalid.root-${index}`,
        risk: 'read',
      })).toThrow('Agent Tool 输入约束无效');
    });
    expect(registry.list()).toEqual([]);
  });

  it('keeps the compiled validator and published schema immutable after registration', () => {
    const integerDefinition = { type: 'integer' };
    const inputSchema = {
      additionalProperties: false,
      properties: { count: integerDefinition, retry: integerDefinition },
      required: ['count', 'retry'],
      type: 'object',
    };
    const tool = {
      description: 'Immutable schema',
      execute: async () => ({ ok: true }),
      inputSchema,
      name: 'test.immutable-schema',
      risk: 'read' as const,
    };
    const registry = createAgentToolRegistry([tool]);

    integerDefinition.type = 'string';
    tool.description = 'mutated description';
    const registered = registry.get('test.immutable-schema');
    const registeredSchema = registered?.inputSchema as {
      properties: { count: { type: string } };
    };

    expect(registered?.description).toBe('Immutable schema');
    expect(registeredSchema.properties.count.type).toBe('integer');
    expect(Object.isFrozen(registered)).toBe(true);
    expect(Object.isFrozen(registeredSchema)).toBe(true);
    expect(Object.isFrozen(registeredSchema.properties)).toBe(true);
    expect(Object.isFrozen(registeredSchema.properties.count)).toBe(true);
    expect(() => {
      registeredSchema.properties.count.type = 'number';
    }).toThrow();
    expect(registry.validateInput('test.immutable-schema', { count: 3, retry: 1 }))
      .toEqual({ ok: true });
    expect(registry.validateInput('test.immutable-schema', { count: '3', retry: 1 })).toEqual({
      message: 'Agent Tool 参数不符合输入约束',
      ok: false,
    });
  });

  it('rejects additional properties and coercible values without mutating the input', async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const registry = createAgentToolRegistry([{
      description: 'Strict numeric input',
      execute,
      inputSchema: {
        additionalProperties: false,
        properties: {
          count: { default: 1, type: 'integer' },
        },
        required: ['count'],
        type: 'object',
      },
      name: 'test.strict-input',
      risk: 'read',
    }]);
    const context = {
      appContext: { platform: 'darwin' as const, selectedNodeIds: [] },
      onProgress: () => undefined,
      signal: new AbortController().signal,
    };
    const coercibleInput = { count: '3' };
    const additionalInput = { count: 3, privateValue: 'must-not-appear-in-errors' };
    const missingDefaultInput: Record<string, unknown> = {};

    expect(registry.validateInput('test.strict-input', { count: 3 })).toEqual({ ok: true });
    expect(registry.validateInput('test.strict-input', coercibleInput)).toEqual({
      message: 'Agent Tool 参数不符合输入约束',
      ok: false,
    });
    expect(registry.validateInput('test.strict-input', additionalInput)).toEqual({
      message: 'Agent Tool 参数不符合输入约束',
      ok: false,
    });
    expect(registry.validateInput('test.strict-input', missingDefaultInput)).toEqual({
      message: 'Agent Tool 参数不符合输入约束',
      ok: false,
    });
    expect(coercibleInput).toEqual({ count: '3' });
    expect(additionalInput).toEqual({ count: 3, privateValue: 'must-not-appear-in-errors' });
    expect(missingDefaultInput).toEqual({});
    await expect(registry.execute('test.strict-input', additionalInput, context))
      .rejects.toThrow('Agent Tool 参数不符合输入约束');
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects prototype mutation keys without reflecting keys or values in the error', () => {
    const registry = createAgentToolRegistry([{
      description: 'Prototype-safe input',
      execute: async () => ({ ok: true }),
      inputSchema: { type: 'object' },
      name: 'test.prototype-safe',
      risk: 'read',
    }]);
    const input = JSON.parse(
      '{"nested":{"constructor":{"prototype":{"polluted":"private-value"}}}}',
    );
    const validation = registry.validateInput('test.prototype-safe', input);

    expect(validation).toEqual({
      message: 'Agent Tool 参数不符合输入约束',
      ok: false,
    });
    expect(JSON.stringify(validation)).not.toContain('constructor');
    expect(JSON.stringify(validation)).not.toContain('private-value');
    expect(({} as { polluted?: string }).polluted).toBeUndefined();
  });

  it('assigns a stable registration identity and preserves explicit identities', () => {
    const definition = {
      description: 'Identity test',
      execute: async () => ({ ok: true }),
      inputSchema: {
        properties: { count: { type: 'integer' }, label: { type: 'string' } },
        type: 'object',
      },
      name: 'test.identity',
      risk: 'read' as const,
    };
    const first = createAgentToolRegistry([definition]);
    const second = createAgentToolRegistry([{
      ...definition,
      inputSchema: {
        type: 'object',
        properties: { label: { type: 'string' }, count: { type: 'integer' } },
      },
    }]);

    expect(first.getSnapshot('test.identity')?.registrationId)
      .toBe(second.getSnapshot('test.identity')?.registrationId);

    const explicit = createAgentToolRegistry([{
      ...definition,
      name: 'test.explicit-identity',
      registrationId: 'media.extractAudio@1',
    }]);
    expect(explicit.getSnapshot('test.explicit-identity')?.registrationId)
      .toBe('media.extractAudio@1');
  });

  it('accepts main preparation and rejects mixed or mismatched prepare contracts', () => {
    const prepareMain = vi.fn(async () => {
      throw new Error('not executed');
    });
    const mainRegistry = createAgentToolRegistry([{
      description: 'Main preparation',
      execute: async () => ({ ok: true }),
      inputSchema: { type: 'object' },
      name: 'test.main-preparation',
      prepareMain,
      risk: 'write',
    }]);

    expect(mainRegistry.get('test.main-preparation')?.prepareMain).toBe(prepareMain);
    expect(() => createAgentToolRegistry([{
      description: 'Invalid executor',
      executor: 'worker' as never,
      inputSchema: { type: 'object' },
      name: 'test.invalid-executor',
      prepareMain,
      risk: 'write',
    }])).toThrow('executor 无效');
    expect(() => createAgentToolRegistry([{
      description: 'Main preparation with renderer executor',
      executor: 'renderer',
      inputSchema: { type: 'object' },
      name: 'test.main-preparation-renderer',
      prepareMain,
      risk: 'write',
    }])).toThrow('main prepare 只支持 main executor');
    expect(() => createAgentToolRegistry([{
      createRendererPrepareRequest: () => ({}),
      description: 'Renderer preparation with main executor',
      execute: async () => ({ ok: true }),
      finalizeRendererPreparation: async () => {
        throw new Error('not executed');
      },
      inputSchema: { type: 'object' },
      name: 'test.renderer-preparation-main',
      risk: 'write',
    }])).toThrow('prepare 只支持 Renderer executor');
    expect(() => createAgentToolRegistry([{
      createRendererPrepareRequest: () => ({}),
      description: 'Mixed preparation owners',
      executor: 'renderer',
      finalizeRendererPreparation: async () => {
        throw new Error('not executed');
      },
      inputSchema: { type: 'object' },
      name: 'test.mixed-preparation',
      prepareMain,
      risk: 'write',
    }])).toThrow('prepare 不能同时由 main 与 Renderer 持有');
    expect(() => createAgentToolRegistry([{
      createRendererRequest: () => ({}),
      description: 'Main preparation with renderer execution request',
      execute: async () => ({ ok: true }),
      inputSchema: { type: 'object' },
      name: 'test.main-preparation-renderer-request',
      prepareMain,
      risk: 'write',
    }])).toThrow('main prepare 与 Renderer request 契约不能并存');
    expect(() => createAgentToolRegistry([{
      description: 'Main preparation without execution',
      inputSchema: { type: 'object' },
      name: 'test.main-preparation-without-execution',
      prepareMain,
      risk: 'write',
    }])).toThrow('main prepare 缺少 main executor');
    expect(() => createAgentToolRegistry([{
      assess: () => ({ behavior: 'allow', risk: 'write' }),
      description: 'Main preparation with duplicate assessment',
      execute: async () => ({ ok: true }),
      inputSchema: { type: 'object' },
      name: 'test.main-preparation-with-assess',
      prepareMain,
      risk: 'write',
    }])).toThrow('prepare 与独立 assess 契约不能并存');
  });

  it('includes the main, renderer, or absent preparation mode in derived identities', () => {
    const base = {
      description: 'Preparation identity',
      inputSchema: { type: 'object' },
      name: 'test.preparation-identity',
      risk: 'write' as const,
    };
    const withoutPreparation = createAgentToolRegistry([{
      ...base,
      execute: async () => ({ ok: true }),
    }]).get('test.preparation-identity')?.registrationId;
    const mainPreparation = createAgentToolRegistry([{
      ...base,
      execute: async () => ({ ok: true }),
      prepareMain: async () => {
        throw new Error('not executed');
      },
    }]).get('test.preparation-identity')?.registrationId;
    const rendererPreparation = createAgentToolRegistry([{
      ...base,
      createRendererPrepareRequest: () => ({}),
      executor: 'renderer' as const,
      finalizeRendererPreparation: async () => {
        throw new Error('not executed');
      },
    }]).get('test.preparation-identity')?.registrationId;

    expect(new Set([
      withoutPreparation,
      mainPreparation,
      rendererPreparation,
    ]).size).toBe(3);
  });

  it('seals main prepared bindings behind an opaque capability before execution', async () => {
    const execute = vi.fn(async (
      toolInput: unknown,
      toolContext: AgentToolExecutionContext,
    ) => {
      void toolInput;
      void toolContext;
      return { ok: true };
    });
    const registry = createAgentToolRegistry([{
      description: 'Prepared audio execution',
      execute,
      inputSchema: {
        additionalProperties: false,
        properties: { format: { enum: ['m4a'], type: 'string' } },
        required: ['format'],
        type: 'object',
      },
      name: PREPARED_TOOL_NAME,
      prepareMain: async () => {
        throw new Error('not executed');
      },
      registrationId: PREPARED_TOOL_REGISTRATION_ID,
      risk: 'write',
    }]);
    const snapshot = registry.createSnapshot();
    const toolInput = { format: 'm4a' };
    const baseContext = {
      appContext: { libraryId: 3, platform: 'darwin' as const, selectedNodeIds: [] },
      onProgress: () => undefined,
      signal: new AbortController().signal,
    };
    const sourceBinding = {
      provider: { alias: 'local-minio' },
    };
    const sealed = snapshot.sealMainPreparedExecution(PREPARED_TOOL_NAME, {
      approvalSemantics: {
        behavior: 'ask',
        preview: { description: 'Extract audio', risk: 'write', title: 'Extract' },
        risk: 'write',
      },
      binding: sourceBinding,
      identity: mainPreparationIdentity(toolInput),
      publicAction: mediaPreparedAction(),
      snapshotMaterial: { sourceRevision: 'revision-1' },
    });
    sourceBinding.provider.alias = 'mutated-after-seal';

    await expect(snapshot.execute(PREPARED_TOOL_NAME, toolInput, baseContext))
      .rejects.toThrow('缺少 main prepared execution capability');
    await expect(snapshot.execute(PREPARED_TOOL_NAME, {
      binding: sourceBinding,
      format: 'm4a',
    }, {
      ...baseContext,
      mainPreparationCapability: sealed.capability,
      mainPreparationIdentity: sealed.identity,
    })).rejects.toThrow('参数不符合输入约束');
    await expect(snapshot.execute(PREPARED_TOOL_NAME, toolInput, {
      ...baseContext,
      mainPreparationCapability: sealed.capability,
      mainPreparationIdentity: sealed.identity,
    })).resolves.toEqual({ ok: true });
    expect(execute).toHaveBeenCalledTimes(1);
    const executionContext = execute.mock.calls[0]?.[1];
    expect(executionContext?.preparation).toMatchObject({
      binding: { provider: { alias: 'local-minio' } },
      preparedActionId: 'prepared-action-1',
    });
    expect(Object.isFrozen(executionContext?.preparation)).toBe(true);
    expect(Object.isFrozen(executionContext?.preparation?.binding)).toBe(true);
    expect(Object.isFrozen(executionContext?.preparation?.binding.provider)).toBe(true);
  });

  it('rejects oversized main preparation bindings and snapshot material before hashing', () => {
    const registry = createAgentToolRegistry([{
      description: 'Prepared audio execution',
      execute: async () => ({ ok: true }),
      inputSchema: { additionalProperties: false, type: 'object' },
      name: PREPARED_TOOL_NAME,
      prepareMain: async () => {
        throw new Error('not executed');
      },
      registrationId: PREPARED_TOOL_REGISTRATION_ID,
      risk: 'write',
    }]);
    const snapshot = registry.createSnapshot();
    const seal = (binding: Record<string, unknown>, snapshotMaterial?: unknown) => (
      snapshot.sealMainPreparedExecution(PREPARED_TOOL_NAME, {
        approvalSemantics: { behavior: 'ask', risk: 'write' },
        binding,
        identity: mainPreparationIdentity({}),
        publicAction: mediaPreparedAction(),
        snapshotMaterial,
      })
    );

    expect(() => seal({ value: 'x'.repeat(300_000) }))
      .toThrow('main preparation binding 无效');
    expect(() => seal({}, { value: 'x'.repeat(300_000) }))
      .toThrow('main preparation snapshot material 无效');
    expect(() => seal(
      { first: 'x'.repeat(150_000) },
      { second: 'x'.repeat(150_000) },
    )).toThrow('main preparation seal 无效');
  });

  it('rejects forged, replayed, cross-snapshot, and unexpected main capabilities', async () => {
    const executePrepared = vi.fn(async () => ({ ok: true }));
    const preparedRegistry = createAgentToolRegistry([{
      description: 'Prepared audio execution',
      execute: executePrepared,
      inputSchema: { additionalProperties: false, type: 'object' },
      name: PREPARED_TOOL_NAME,
      prepareMain: async () => {
        throw new Error('not executed');
      },
      registrationId: PREPARED_TOOL_REGISTRATION_ID,
      risk: 'write',
    }]);
    const firstSnapshot = preparedRegistry.createSnapshot();
    const secondSnapshot = preparedRegistry.createSnapshot();
    const toolInput = {};
    const context = {
      appContext: { libraryId: 3, platform: 'darwin' as const, selectedNodeIds: [] },
      onProgress: () => undefined,
      signal: new AbortController().signal,
    };
    const sealed = firstSnapshot.sealMainPreparedExecution(PREPARED_TOOL_NAME, {
      approvalSemantics: { behavior: 'ask', risk: 'write' },
      binding: { providerAlias: 'local-minio' },
      identity: mainPreparationIdentity(toolInput),
      publicAction: mediaPreparedAction(),
    });

    await expect(firstSnapshot.execute(PREPARED_TOOL_NAME, toolInput, {
      ...context,
      mainPreparationCapability: Object.freeze({}) as never,
      mainPreparationIdentity: sealed.identity,
    })).rejects.toThrow('capability 无效或已使用');
    await expect(firstSnapshot.execute(PREPARED_TOOL_NAME, toolInput, {
      ...context,
      mainPreparationCapability: Object.freeze({ ...sealed.capability }) as never,
      mainPreparationIdentity: sealed.identity,
    })).rejects.toThrow('capability 无效或已使用');
    await expect(secondSnapshot.execute(PREPARED_TOOL_NAME, toolInput, {
      ...context,
      mainPreparationCapability: sealed.capability,
      mainPreparationIdentity: sealed.identity,
    })).rejects.toThrow('capability 无效或已使用');

    const ordinaryRegistry = createAgentToolRegistry([{
      description: 'Ordinary main execution',
      execute: async () => ({ ok: true }),
      inputSchema: { type: 'object' },
      name: 'test.ordinary-main',
      risk: 'read',
    }]);
    await expect(ordinaryRegistry.execute('test.ordinary-main', {}, {
      ...context,
      mainPreparationCapability: sealed.capability,
      mainPreparationIdentity: sealed.identity,
    })).rejects.toThrow('不接受 main prepared execution capability');

    await expect(firstSnapshot.execute(PREPARED_TOOL_NAME, toolInput, {
      ...context,
      mainPreparationCapability: sealed.capability,
      mainPreparationIdentity: sealed.identity,
    })).resolves.toEqual({ ok: true });
    await expect(firstSnapshot.execute(PREPARED_TOOL_NAME, toolInput, {
      ...context,
      mainPreparationCapability: sealed.capability,
      mainPreparationIdentity: sealed.identity,
    })).rejects.toThrow('capability 无效或已使用');
    expect(executePrepared).toHaveBeenCalledTimes(1);
  });

  it('binds main capabilities to owner, profile, run, input, and registration identities', async () => {
    const executePrepared = vi.fn(async () => ({ ok: true }));
    const registry = createAgentToolRegistry([{
      description: 'Prepared identity execution',
      execute: executePrepared,
      inputSchema: {
        additionalProperties: false,
        properties: {
          PATH: { type: 'string' },
          Path: { type: 'string' },
          format: { type: 'string' },
        },
        required: ['PATH', 'Path', 'format'],
        type: 'object',
      },
      name: PREPARED_TOOL_NAME,
      prepareMain: async () => {
        throw new Error('not executed');
      },
      registrationId: PREPARED_TOOL_REGISTRATION_ID,
      risk: 'write',
    }]);
    const snapshot = registry.createSnapshot();
    const toolInput = {
      Path: '/prepared/path',
      PATH: '/prepared/PATH',
      format: 'm4a',
    };
    const sealed = snapshot.sealMainPreparedExecution(PREPARED_TOOL_NAME, {
      approvalSemantics: { behavior: 'ask', risk: 'write' },
      binding: { providerAlias: 'local-minio' },
      identity: mainPreparationIdentity(toolInput),
      publicAction: mediaPreparedAction(),
    });
    const context = {
      appContext: { libraryId: 3, platform: 'darwin' as const, selectedNodeIds: [] },
      onProgress: () => undefined,
      signal: new AbortController().signal,
    };
    const mismatchedIdentities: AgentToolMainPreparationIdentity[] = [
      {
        ...sealed.identity,
        ownerScope: {
          ...sealed.identity.ownerScope,
          accountScope: 'user:8',
        },
      },
      { ...sealed.identity, ownerWebContentsId: 18 },
      { ...sealed.identity, aiDestinationIdentity: `v1:${'c'.repeat(64)}` },
      { ...sealed.identity, runId: 'run-2' },
      { ...sealed.identity, runCapabilityIdentity: `v2:${'c'.repeat(64)}` },
    ];

    for (const mismatchedIdentity of mismatchedIdentities) {
      await expect(snapshot.execute(PREPARED_TOOL_NAME, toolInput, {
        ...context,
        mainPreparationCapability: sealed.capability,
        mainPreparationIdentity: mismatchedIdentity,
      })).rejects.toThrow('identity 不匹配');
    }
    await expect(snapshot.execute(PREPARED_TOOL_NAME, toolInput, {
      ...context,
      appContext: { ...context.appContext, libraryId: 4 },
      mainPreparationCapability: sealed.capability,
      mainPreparationIdentity: sealed.identity,
    })).rejects.toThrow('identity 不匹配');
    await expect(snapshot.execute(PREPARED_TOOL_NAME, {
      ...toolInput,
      Path: '/different/path',
    }, {
      ...context,
      mainPreparationCapability: sealed.capability,
      mainPreparationIdentity: sealed.identity,
    })).rejects.toThrow('identity 不匹配');
    await expect(snapshot.execute(PREPARED_TOOL_NAME, toolInput, {
      ...context,
      mainPreparationCapability: sealed.capability,
      mainPreparationIdentity: {
        ...sealed.identity,
        toolRegistrationId: 'media.extractAudio@different',
      },
    })).rejects.toThrow('invalid preparation identity');
    await expect(snapshot.execute(PREPARED_TOOL_NAME, toolInput, {
      ...context,
      mainPreparationCapability: sealed.capability,
      mainPreparationIdentity: sealed.identity,
    }, 'media.extractAudio@different')).rejects.toThrow('registration identity 不匹配');

    await expect(snapshot.execute(PREPARED_TOOL_NAME, toolInput, {
      ...context,
      mainPreparationCapability: sealed.capability,
      mainPreparationIdentity: sealed.identity,
    })).resolves.toEqual({ ok: true });
    expect(executePrepared).toHaveBeenCalledTimes(1);
  });

  it('consumes a main capability before the executor can fail', async () => {
    const executePrepared = vi.fn()
      .mockRejectedValueOnce(new Error('initial executor failure'))
      .mockResolvedValue({ ok: true });
    const registry = createAgentToolRegistry([{
      description: 'Prepared failure execution',
      execute: executePrepared,
      inputSchema: { additionalProperties: false, type: 'object' },
      name: PREPARED_TOOL_NAME,
      prepareMain: async () => {
        throw new Error('not executed');
      },
      registrationId: PREPARED_TOOL_REGISTRATION_ID,
      risk: 'write',
    }]);
    const snapshot = registry.createSnapshot();
    const toolInput = {};
    const sealed = snapshot.sealMainPreparedExecution(PREPARED_TOOL_NAME, {
      approvalSemantics: { behavior: 'ask', risk: 'write' },
      binding: { providerAlias: 'local-minio' },
      identity: mainPreparationIdentity(toolInput),
      publicAction: mediaPreparedAction(),
    });
    const context = {
      appContext: { libraryId: 3, platform: 'darwin' as const, selectedNodeIds: [] },
      mainPreparationCapability: sealed.capability,
      mainPreparationIdentity: sealed.identity,
      onProgress: () => undefined,
      signal: new AbortController().signal,
    };

    await expect(snapshot.execute(PREPARED_TOOL_NAME, toolInput, context))
      .rejects.toThrow('initial executor failure');
    await expect(snapshot.execute(PREPARED_TOOL_NAME, toolInput, context))
      .rejects.toThrow('capability 无效或已使用');
    expect(executePrepared).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['progress', 'progress 不能包含 main-only preparation binding'],
    ['result', 'result 不能包含 main-only preparation binding'],
    ['error', 'error 不能包含 main-only preparation binding'],
  ] as const)('blocks direct private binding references in executor %s', async (
    leakTarget,
    expectedMessage,
  ) => {
    const forwardedProgress = vi.fn();
    const registry = createAgentToolRegistry([{
      description: 'Prepared private binding execution',
      execute: async (_toolInput, toolContext) => {
        const privateBinding = toolContext.preparation?.binding;
        if (!privateBinding) throw new Error('missing private binding');
        if (leakTarget === 'progress') {
          toolContext.onProgress({
            message: 'unsafe progress',
            privateBinding,
          } as never);
          return { ok: true };
        }
        if (leakTarget === 'result') {
          return { data: { privateBinding }, ok: true };
        }
        throw Object.assign(new Error('unsafe executor error'), { privateBinding });
      },
      inputSchema: { additionalProperties: false, type: 'object' },
      name: PREPARED_TOOL_NAME,
      prepareMain: async () => {
        throw new Error('not executed');
      },
      registrationId: PREPARED_TOOL_REGISTRATION_ID,
      risk: 'write',
    }]);
    const snapshot = registry.createSnapshot();
    const toolInput = {};
    const sealed = snapshot.sealMainPreparedExecution(PREPARED_TOOL_NAME, {
      approvalSemantics: { behavior: 'ask', risk: 'write' },
      binding: { provider: { alias: 'private-minio' } },
      identity: mainPreparationIdentity(toolInput),
      publicAction: mediaPreparedAction(),
    });

    await expect(snapshot.execute(PREPARED_TOOL_NAME, toolInput, {
      appContext: { libraryId: 3, platform: 'darwin', selectedNodeIds: [] },
      mainPreparationCapability: sealed.capability,
      mainPreparationIdentity: sealed.identity,
      onProgress: forwardedProgress,
      signal: new AbortController().signal,
    })).rejects.toThrow(expectedMessage);
    expect(forwardedProgress).not.toHaveBeenCalled();
  });

  it('keeps the stability hash independent from only the prepared action identity', () => {
    const registry = createAgentToolRegistry([{
      description: 'Prepared audio execution',
      execute: async () => ({ ok: true }),
      inputSchema: { additionalProperties: false, type: 'object' },
      name: PREPARED_TOOL_NAME,
      prepareMain: async () => {
        throw new Error('not executed');
      },
      registrationId: PREPARED_TOOL_REGISTRATION_ID,
      risk: 'write',
    }]);
    const snapshot = registry.createSnapshot();
    const seal = (preparedActionId: string, privateRevision: string) => (
      snapshot.sealMainPreparedExecution(PREPARED_TOOL_NAME, {
        approvalSemantics: {
          behavior: 'ask',
          preview: { description: 'Extract audio', risk: 'write', title: 'Extract' },
          risk: 'write',
        },
        binding: {
          source: { privateRevision },
        },
        identity: mainPreparationIdentity({}, preparedActionId),
        publicAction: mediaPreparedAction(),
        snapshotMaterial: { executableRevision: 'ffmpeg-v1' },
      })
    );

    const first = seal('prepared-action-1', 'source-v1');
    const rotated = seal('prepared-action-2', 'source-v1');
    const changedBinding = seal('prepared-action-3', 'source-v2');

    expect(first.stabilityHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.snapshotHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(rotated.stabilityHash).toBe(first.stabilityHash);
    expect(rotated.snapshotHash).not.toBe(first.snapshotHash);
    expect(changedBinding.stabilityHash).not.toBe(first.stabilityHash);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('freezes a registry snapshot and rejects a stale registration identity', async () => {
    const execute = vi.fn(async () => ({ message: 'snapshot result', ok: true }));
    const registry = createAgentToolRegistry([{
      description: 'Snapshot test',
      execute,
      inputSchema: { type: 'object' },
      name: 'test.snapshot',
      registrationId: 'test.snapshot@1',
      risk: 'read' as const,
    }]);
    const snapshot = registry.createSnapshot();
    expect(snapshot.revision).toBe(1);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.tools)).toBe(true);

    registry.register({
      description: 'Later tool',
      execute: async () => ({ ok: true }),
      inputSchema: { type: 'object' },
      name: 'test.later',
      risk: 'read',
    });
    expect(snapshot.list().map(tool => tool.name)).toEqual(['test.snapshot']);
    expect(snapshot.get('test.later')).toBeNull();

    const context = {
      appContext: { platform: 'darwin' as const, selectedNodeIds: [] },
      onProgress: () => undefined,
      signal: new AbortController().signal,
    };
    await expect(registry.executeAgainstSnapshot(
      snapshot,
      'test.snapshot',
      {},
      context,
      'test.snapshot@2',
    )).rejects.toThrow('registration identity 不匹配');
    expect(() => registry.validateInput(
      'test.snapshot',
      {},
      'test.snapshot@2',
    )).toThrow('registration identity 不匹配');
    await expect(registry.execute(
      'test.snapshot',
      {},
      context,
      'test.snapshot@2',
    )).rejects.toThrow('registration identity 不匹配');
    await expect(registry.executeAgainstSnapshot(
      snapshot,
      'test.snapshot',
      {},
      context,
      'test.snapshot@1',
    )).resolves.toEqual({ message: 'snapshot result', ok: true });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed explicit registration identities', () => {
    const base = {
      description: 'Invalid identity',
      execute: async () => ({ ok: true }),
      inputSchema: { type: 'object' },
      risk: 'read' as const,
    };
    expect(() => createAgentToolRegistry([{
      ...base,
      name: 'test.bad-control',
      registrationId: `bad${String.fromCharCode(0)}id`,
    }])).toThrow('registration identity 无效');
    expect(() => createAgentToolRegistry([{
      ...base,
      name: 'test.bad-length',
      registrationId: 'x'.repeat(201),
    }])).toThrow('registration identity 无效');

    const registry = createAgentToolRegistry([{
      ...base,
      name: 'test.identity-owner',
      registrationId: 'shared@1',
    }]);
    expect(() => registry.register({
      ...base,
      name: 'test.identity-collision',
      registrationId: 'shared@1',
    })).toThrow('registration identity 已注册');
  });

  it('defaults Tools to business and closes the control classification', () => {
    const registry = createAgentToolRegistry([{
      description: 'Business Tool',
      execute: async () => ({ ok: true }),
      inputSchema: { type: 'object' },
      name: 'test.business-kind',
      risk: 'read',
    }]);
    expect(registry.getSnapshot('test.business-kind')?.kind).toBe('business');
    expect(() => registry.register({
      description: 'Unexpected control Tool',
      execute: async () => ({ ok: true }),
      inputSchema: { type: 'object' },
      kind: 'control',
      name: 'test.unexpected-control',
      risk: 'read',
    })).toThrow('不能注册未声明的控制能力');
    expect(() => registry.register({
      description: 'Reserved Tool',
      execute: async () => ({ ok: true }),
      inputSchema: { type: 'object' },
      name: 'skill.activate',
      risk: 'read',
    })).toThrow('不能以业务分类占用控制协议名称');
  });

  it('freezes Capability policy into the Tool snapshot and derived identity', () => {
    const requiredCapabilities = ['media.ffprobe'];
    const registry = createAgentToolRegistry([{
      availability: { requiredCapabilities },
      description: 'Media metadata',
      execute: async () => ({ ok: true }),
      inputSchema: { type: 'object' },
      name: 'media.inspect-test',
      risk: 'read',
    }]);
    const registered = registry.get('media.inspect-test');
    const identity = registered?.registrationId;
    requiredCapabilities[0] = 'evil.capability';

    expect(registered?.availability).toEqual({
      optionalCapabilities: [],
      requiredCapabilities: ['media.ffprobe'],
    });
    expect(Object.isFrozen(registered?.availability)).toBe(true);
    expect(Object.isFrozen(registered?.availability.requiredCapabilities)).toBe(true);

    const changed = createAgentToolRegistry([{
      availability: { optionalCapabilities: ['media.ffprobe'] },
      description: 'Media metadata',
      execute: async () => ({ ok: true }),
      inputSchema: { type: 'object' },
      name: 'media.inspect-test',
      risk: 'read',
    }]).get('media.inspect-test');
    expect(changed?.registrationId).not.toBe(identity);
  });

  it('rejects malformed, duplicate, and control Tool Capability policies', () => {
    const base = {
      description: 'Capability policy test',
      execute: async () => ({ ok: true }),
      inputSchema: { type: 'object' },
      name: 'test.capability-policy',
      risk: 'read' as const,
    };
    expect(() => createAgentToolRegistry([{
      ...base,
      availability: { requiredCapabilities: ['Not Valid'] },
    }])).toThrow('required Capability');
    expect(() => createAgentToolRegistry([{
      ...base,
      availability: {
        optionalCapabilities: ['media.ffprobe'],
        requiredCapabilities: ['media.ffprobe'],
      },
    }])).toThrow('不能重复');
    expect(() => createAgentToolRegistry([{
      ...base,
      availability: { requiredCapabilities: ['media.ffprobe'] },
      executor: 'main',
      kind: 'control',
      name: AGENT_SKILL_ACTIVATE_TOOL_NAME,
      registrationId: AGENT_SKILL_ACTIVATE_TOOL_REGISTRATION_ID,
    }])).toThrow('控制 Tool 不能声明业务 Capability');
  });
});
