import { describe, expect, it, vi } from 'vitest';

import { createAgentToolRegistry } from './agent-tool-registry';
import {
  AGENT_SKILL_ACTIVATE_TOOL_NAME,
  AGENT_SKILL_ACTIVATE_TOOL_REGISTRATION_ID,
} from './skills/agent-skill.types';

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
