import { describe, expect, it, vi } from 'vitest';
import { filePatchTool } from './tools/file-patch-tool';
import { createAgentToolRegistry, type AgentToolExecutionContext } from './agent-tool-registry';
import { buildAgentProviderRequestBody, consumeAgentProviderStreamEvent,
  createAgentProviderStreamState, finalizeAgentProviderToolCalls } from './agent-provider-model';
import { projectAgentToolResultForProvider } from './agent-tool-result-projection';
import { projectAgentToolAuditInput } from './agent-tool-audit';
import { normalizeAgentFilePatchInput } from '../../../src/shared/agent/agent-file-patch-input';

const revision = 'a'.repeat(64);
const registrationId = 'builtin:file.patch@2';
const input = { scope: 'library', path: '/a.txt', format: 'context-v1', revision, patch: '@@\n-old\n+new\n' };
function context() {
  return { appContext: { libraryId: 3, platform: 'darwin', selectedNodeIds: [] },
    onProgress() {}, signal: new AbortController().signal,
    executeLibraryFileMutation: vi.fn(async () => ({ ok: true })),
    commitSettlement: { begin: vi.fn(), settle: vi.fn() } } satisfies AgentToolExecutionContext;
}
function streamInput(provider: 'openai' | 'claude', serialized: string) {
  const state = createAgentProviderStreamState();
  if (provider === 'claude') consumeAgentProviderStreamEvent(provider, {
    type: 'content_block_start', index: 0,
    content_block: { id: 'call-patch', type: 'tool_use', name: 'file_patch', input: {} },
  }, state);
  for (let index = 0; index < serialized.length; index += 1031) {
    const fragment = serialized.slice(index, index + 1031);
    consumeAgentProviderStreamEvent(provider, provider === 'claude'
      ? { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: fragment } }
      : { choices: [{ delta: { tool_calls: [{ index: 0, ...(index ? {} : { id: 'call-patch' }),
        function: { ...(index ? {} : { name: 'file_patch' }), arguments: fragment } }] } }] }, state);
  }
  return finalizeAgentProviderToolCalls(state, [filePatchTool]);
}
function providerBody(provider: 'openai' | 'claude', messages: Parameters<typeof buildAgentProviderRequestBody>[1]['messages'] = []) {
  return buildAgentProviderRequestBody({ apiKey: 'fixture-key', baseUrl: 'https://fixture.test', providerType: provider },
    { model: 'fixture-model', maxOutputTokens: 1000, systemPrompt: 'fixture', tools: [filePatchTool], messages });
}

describe('file.patch public contract', () => {
  it('compiles in the real strict registry and keeps the historical shape separate from context input', async () => {
    const registry = createAgentToolRegistry([filePatchTool]);
    expect(registry.validateInput('file.patch', input, registrationId)).toEqual({ ok: true });
    for (const invalid of [
      { ...input, revision: undefined },
      { ...input, revision: undefined, expectedRevision: revision },
      { ...input, expectedRevision: revision },
      { ...input, format: undefined, finalNewline: 'preserve' },
      { ...input, format: 'unified-v1', finalNewline: 'ensure' },
    ]) expect(registry.validateInput('file.patch', invalid, registrationId).ok).toBe(false);
    const legacy = { path: '/a.txt', expectedRevision: revision, patch: '@@ -1 +1 @@\n-old\n+new\n' };
    expect(registry.validateInput('file.patch', legacy, registrationId)).toEqual({ ok: true });
    const ctx = context();
    await expect(registry.execute('file.patch', legacy, ctx, registrationId)).resolves.toEqual({ ok: true });
    expect(ctx.executeLibraryFileMutation).toHaveBeenCalledWith(expect.objectContaining({ format: 'unified-v1', revision }), ctx.signal, ctx.commitSettlement);
    await expect(registry.execute('file.patch', input, ctx, registrationId)).resolves.toEqual({ ok: true });
    expect(ctx.executeLibraryFileMutation).toHaveBeenLastCalledWith(expect.objectContaining({ format: 'context-v1', finalNewline: 'preserve' }), ctx.signal, ctx.commitSettlement);
  });

  it('preflights syntax before adapters, reads or commit settlement and keeps structured diagnostics visible', async () => {
    const registry = createAgentToolRegistry([filePatchTool]);
    const ctx = { ...context(), readLibraryText: vi.fn(), readLibraryMetadata: vi.fn() };
    const invalid = { ...input, patch: '@@ -1,1 +1,1 @@\n-old\n+new\n' };
    const result = await registry.execute('file.patch', invalid, ctx, registrationId);
    expect(result).toMatchObject({ ok: false, data: { phase: 'parse', scope: 'library', path: '/a.txt',
      view: 'saved', writeCommitState: 'uncommitted', mutationCommitState: 'uncommitted' } });
    expect(result.data).toHaveProperty('code');
    expect(result.data).toHaveProperty('nextAction');
    expect(ctx.executeLibraryFileMutation).not.toHaveBeenCalled();
    expect(ctx.readLibraryText).not.toHaveBeenCalled();
    expect(ctx.readLibraryMetadata).not.toHaveBeenCalled();
    expect(ctx.commitSettlement.begin).not.toHaveBeenCalled();
    expect(ctx.commitSettlement.settle).not.toHaveBeenCalled();
    const projected = projectAgentToolResultForProvider(result, 1000);
    expect(projected.truncated).toBe(false);
    expect(JSON.parse(projected.content).data).not.toHaveProperty('hunkIndex');
    const diagnostic = Object.fromEntries(Object.entries(result.data as Record<string, unknown>).filter(([, value]) => value !== undefined));
    expect(JSON.parse(projected.content)).toMatchObject({ ok: false, data: diagnostic });
    for (const provider of ['openai', 'claude'] as const) {
      const body = providerBody(provider, [
        { role: 'assistant', content: '', toolCalls: [{ id: 'call-patch', name: 'file.patch', input: invalid }] },
        { role: 'tool', content: projected.content, name: 'file.patch', toolCallId: 'call-patch' },
      ]);
      const messages = body.messages as Array<Record<string, any>>;
      const content = provider === 'openai' ? messages.at(-1)!.content : messages.at(-1)!.content[0].content;
      expect(JSON.parse(content)).toMatchObject({ data: diagnostic });
    }
    const withoutFormat = await registry.execute('file.patch', { path: '/a.txt', revision, patch: input.patch }, ctx, registrationId);
    expect(withoutFormat).toMatchObject({ ok: false, data: { phase: 'parse', mutationCommitState: 'uncommitted' } });
  });

  it.each(['openai', 'claude'] as const)('preserves schema and exact body/JSON budgets through %s streaming', provider => {
    const schema = providerBody(provider).tools as Array<Record<string, any>>;
    expect(provider === 'claude' ? schema[0].input_schema : schema[0].function.parameters).toEqual(filePatchTool.inputSchema);
    const canonical = { ...input, view: 'saved', finalNewline: 'preserve', patch: '@@\n-old\n+' };
    const remaining = 32_000 - canonical.patch.length;
    const baseline = JSON.stringify({ ...canonical, patch: canonical.patch + 'x'.repeat(remaining) }).length;
    const quotes = 64_000 - baseline;
    expect(quotes).toBeGreaterThan(0);
    expect(quotes).toBeLessThan(remaining);
    const boundary = { ...canonical, patch: canonical.patch + '"'.repeat(quotes) + 'x'.repeat(remaining - quotes) };
    expect(boundary.patch).toHaveLength(32_000);
    const serialized = JSON.stringify(boundary);
    expect(serialized).toHaveLength(64_000);
    const calls = streamInput(provider, serialized);
    expect(calls).toEqual([{ id: 'call-patch', name: 'file.patch', input: boundary }]);
    expect(normalizeAgentFilePatchInput(calls[0].input).patch).toBe(boundary.patch);
    expect(projectAgentToolAuditInput(boundary).complete).toBe(true);
    // Replacing one unescaped character with a quote adds one transport character.
    const overflow = { ...boundary, patch: boundary.patch.slice(0, -1) + '"' };
    expect(overflow.patch).toHaveLength(32_000);
    expect(() => streamInput(provider, JSON.stringify(overflow))).toThrow();
    const tooLong = { ...input, patch: '@@\n+' + 'x'.repeat(32_001 - '@@\n+'.length) };
    const streamed = streamInput(provider, JSON.stringify(tooLong))[0].input;
    expect(createAgentToolRegistry([filePatchTool]).validateInput('file.patch', streamed, registrationId).ok).toBe(false);
  });
});
