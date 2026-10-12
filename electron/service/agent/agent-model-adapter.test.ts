import { describe, expect, it, vi } from 'vitest';
import { parseAgentModelMetadata, resolveAgentModelContextBudget } from './agent-model-context';
import { resolveAgentAdapterEffort, resolveAgentModelAdapter, restrictAgentToolsForModel, restrictAgentSkillsForModel, agentModelAdapterPrompt } from './agent-model-adapter';
import { buildAgentProviderRequestBody } from './agent-provider-model';
import { createAgentToolRegistry } from './agent-tool-registry';
import { createAgentSkillRegistry } from './skills/agent-skill-registry';
import { createAgentRunCapabilitySnapshot } from './agent-run-capability-snapshot';

describe('trusted model adaptation', () => {
  const openai = { providerType: 'openai' as const, baseUrl: 'https://fixture.test/v1', apiKey: 'fixture' };
  const input = { model: 'gpt-5.5', maxOutputTokens: 2000, systemPrompt: 'business policy', messages: [], reasoningEffort: 'high' as const,
    tools: [{ name: 'file.read', description: 'read', inputSchema: { type: 'object', properties: {} } }] };
  it('matches exact provider/model identities and explicit dated variants, not arbitrary prefixes', () => {
    expect(resolveAgentModelAdapter(openai, 'gpt-6-astra').source).toBe('builtin');
    expect(resolveAgentModelAdapter(openai, 'gpt-5.5-2026-09-01').profileId).toBe('gpt-5.5');
    expect(resolveAgentModelAdapter(openai, 'gpt-5.5-custom').source).toBe('protocol-fallback');
    expect(resolveAgentModelAdapter({ providerType: 'local' }, 'gpt-5.5').source).toBe('protocol-fallback');
    expect(resolveAgentModelContextBudget({ ...openai, model: 'gpt-6-astra' })).toMatchObject({ contextWindowTokens: 1_050_000, maxContextWindowTokens: 1_050_000, source: 'catalog' });
  });
  it('uses provider wire formats and omits unsupported effort fields', () => {
    expect(buildAgentProviderRequestBody(openai, input)).toMatchObject({ reasoning_effort: 'high', parallel_tool_calls: true });
    expect(buildAgentProviderRequestBody(openai, { ...input, model: 'gpt-4o' })).not.toHaveProperty('reasoning_effort');
    const claude = { ...openai, providerType: 'claude' as const };
    expect(buildAgentProviderRequestBody(claude, { ...input, model: 'claude-sonnet-4-6' })).toMatchObject({ output_config: { effort: 'high' } });
    expect(buildAgentProviderRequestBody(claude, { ...input, model: 'claude-3-7-sonnet-20250219' })).not.toHaveProperty('output_config');
    expect(buildAgentProviderRequestBody({ ...openai, providerType: 'deepseek' }, { ...input, model: 'deepseek-chat' })).not.toHaveProperty('reasoning_effort');
  });
  it('parses only bounded capability fields and never imports remote prompts or tool definitions', () => {
    const metadata = parseAgentModelMetadata({ models: [{ slug: 'gpt-5.5', supports_tool_calling: false,
      supports_parallel_tool_calls: false, shell_type: 'disabled', supported_reasoning_levels: [{ effort: 'low' }],
      base_instructions: 'REMOTE_INJECTION', model_messages: { instructions_template: 'REMOTE_INJECTION' }, tools: ['unsafe'] }] }).get('gpt-5.5');
    expect(metadata).toMatchObject({ supportsToolCalling: false, supportsShellTool: false, reasoningEfforts: ['low'] });
    const adapter = resolveAgentModelAdapter(openai, input.model, metadata);
    expect(adapter).toMatchObject({ toolCalling: false, shellTool: false, parallelToolCalls: false });
    expect(resolveAgentAdapterEffort(adapter, 'high')).toBeUndefined();
    expect(agentModelAdapterPrompt(adapter)).not.toContain('REMOTE_INJECTION');
    expect(Object.isFrozen(adapter)).toBe(true);
    expect(Object.isFrozen(adapter.reasoningEfforts)).toBe(true);
    expect(adapter.identity).not.toBe(resolveAgentModelAdapter(openai, input.model).identity);
  });
  it('prevents metadata from enabling an unimplemented protocol', () => {
    const adapter = resolveAgentModelAdapter({ providerType: 'deepseek' }, 'deepseek-reasoner', { supportsToolCalling: true });
    expect(adapter.toolCalling).toBe(false);
    expect(() => buildAgentProviderRequestBody({ ...openai, providerType: 'deepseek' }, { ...input, model: 'deepseek-reasoner', modelAdapter: adapter })).toThrow('未开放');
  });
  it('filters snapshots without mutating global tools and denies execution of filtered calls', async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const original = createAgentToolRegistry(['file.read', 'shell.run'].map(name => ({ name, description: name, risk: 'read' as const,
      inputSchema: { type: 'object', properties: {} }, execute }))).createSnapshot();
    const restricted = restrictAgentToolsForModel(original, resolveAgentModelAdapter(openai, input.model, { supportsShellTool: false }));
    expect(restricted.list().map(tool => tool.name)).toEqual(['file.read']);
    expect(original.list()).toHaveLength(2);
    expect(restricted.get('shell.run')).toBeNull();
    expect(restricted.validateInput('shell.run', {}).ok).toBe(false);
    await expect(restricted.execute('shell.run', {}, {} as never)).rejects.toThrow('未开放');
    expect(execute).not.toHaveBeenCalled();
  });
  it('keeps parallel restrictions in the actual request body', () => {
    const adapter = resolveAgentModelAdapter(openai, input.model, { supportsParallelToolCalls: false });
    expect(buildAgentProviderRequestBody(openai, { ...input, modelAdapter: adapter })).toMatchObject({ parallel_tool_calls: false });
  });

  it('hides desktop observation and clicks together when the frozen model cannot see images', async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const names = ['file.read', 'shell.run', 'attachment.view', 'computer.windows', 'computer.observe', 'computer.click', 'computer.setText', 'computer.scroll'];
    const original = createAgentToolRegistry(names.map(name => ({ name, description: name, risk: 'read' as const,
      inputSchema: { type: 'object' }, execute }))).createSnapshot();
    const restricted = restrictAgentToolsForModel(original, resolveAgentModelAdapter(openai, input.model, { supportsImages: false }));
    expect(restricted.list().map(tool => tool.name)).toEqual(['file.read', 'shell.run', 'computer.windows']);
    for (const name of ['attachment.view', 'computer.observe', 'computer.click', 'computer.setText', 'computer.scroll']) {
      expect(restricted.get(name)).toBeNull();
      expect(restricted.validateInput(name, {}).ok).toBe(false);
      await expect(restricted.execute(name, {}, {} as never)).rejects.toThrow('未开放');
      expect(() => restricted.sealMainPreparedExecution(name, {} as never)).toThrow('未开放');
    }
    expect(execute).not.toHaveBeenCalled();
    expect(original.list().map(tool => tool.name)).toEqual(names);
    const visual = restrictAgentToolsForModel(original, resolveAgentModelAdapter(openai, input.model, { supportsImages: true, supportsShellTool: false }));
    expect(visual.list().map(tool => tool.name)).toEqual(names.filter(name => name !== 'shell.run'));
  });

  it('keeps optional-dependent Skills while model restrictions still block Tool execution after activation', async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const originalTools = createAgentToolRegistry(['file.read', 'shell.run'].map(name => ({
      name, description: name, risk: 'read' as const, inputSchema: { type: 'object' }, execute,
    }))).createSnapshot();
    const registry = createAgentSkillRegistry();
    registry.register({
      id: 'read-with-shell-fallback', version: '1.0.0', source: 'built-in',
      description: '读取内容', whenToUse: '需要读取内容时', instructions: '优先使用文件读取。',
      requiredTools: ['file.read'], optionalTools: ['shell.run'],
    });
    registry.register({
      id: 'shell-required', version: '1.0.0', source: 'built-in',
      description: '执行命令', whenToUse: '需要命令时', instructions: '使用 Shell。',
      requiredTools: ['shell.run'], optionalTools: [],
    });
    const originalSkills = registry.createRunSnapshot();
    const noShell = restrictAgentToolsForModel(originalTools, resolveAgentModelAdapter(openai, input.model, { supportsShellTool: false }));
    const skills = restrictAgentSkillsForModel(originalSkills, noShell);
    expect(skills.listSummaries().map(item => item.id)).toEqual(['read-with-shell-fallback']);
    expect(skills.getActivationEnvelope('shell-required')).toBeNull();
    const run = createAgentRunCapabilitySnapshot({ toolSnapshot: noShell, skillSnapshot: skills });
    const context = {
      appContext: { platform: 'darwin' as const, selectedNodeIds: [] },
      onProgress: () => undefined, signal: new AbortController().signal,
    };
    expect(run.getSkillReadiness('read-with-shell-fallback')?.state).toBe('degraded');
    expect(run.listTools('read-with-shell-fallback').map(item => item.name)).toEqual(['file.read']);
    expect(() => run.validateInput('shell.run', {}, 'read-with-shell-fallback')).toThrow('未被 Run capability');
    expect(() => run.execute('shell.run', {}, context, 'read-with-shell-fallback')).toThrow('未被 Run capability');
    await expect(run.execute('file.read', {}, context, 'read-with-shell-fallback')).resolves.toEqual({ ok: true });
    expect(execute).toHaveBeenCalledTimes(1);
    const textOnly = restrictAgentToolsForModel(originalTools, resolveAgentModelAdapter(openai, input.model, { supportsToolCalling: false }));
    expect(restrictAgentSkillsForModel(originalSkills, textOnly).list()).toEqual([]);
    expect(originalSkills.list()).toHaveLength(2);
  });
});
