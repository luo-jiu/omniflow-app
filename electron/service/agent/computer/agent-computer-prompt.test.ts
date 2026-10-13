import { describe, expect, it } from 'vitest';
import { agentComputerRoutingPrompt } from './agent-computer-prompt';
import { buildAgentSystemPrompt } from '../agent-prompt-assembler';
import { resolveAgentModelAdapter, restrictAgentToolsForModel } from '../agent-model-adapter';
import { createAgentToolRegistry } from '../agent-tool-registry';
import { buildAgentProviderRequestBody } from '../agent-provider-model';

const computerTools = ['computer.windows', 'computer.observe', 'computer.click', 'computer.setText',
  'computer.scroll', 'computer.input', 'computer.hidePointer'];
const context = { platform: 'darwin' as const, libraryId: 3, selectedNodeIds: [] };

describe('computer routing in the effective model prompt', () => {
  it('balances direct resource work with proactive UI work and evidence-based actions', () => {
    const prompt = buildAgentSystemPrompt(context, undefined, ['file.read', 'shell.run', ...computerTools]);
    expect(prompt).toContain('普通问答无需查看电脑');
    expect(prompt).toContain('直接工具不能等价完成时，主动使用电脑工具');
    expect(prompt).toContain('读取磁盘文件不能替代查看未保存窗口');
    expect(prompt).toContain('首次观察必须显式传入刚核对的 windowRef');
    expect(prompt).toContain('之后同一共享窗口的刷新可省略 selector');
    expect(prompt).toContain('通常显式选择 mode=ax');
    expect(prompt).toContain('需要外观判断、AX 信息不足');
    expect(prompt).toContain('也不是任意像素点击');
    expect(prompt).toContain('inputReady 与对应 availableInputOperations 必须支持');
    expect(prompt).toContain('每次动作后用 computer_observe 核对');
    expect(prompt).toContain('不能自动重放或换路线再次执行同一动作');
    expect(prompt).toContain('连续动作之间保持箭头');
  });

  it('omits unavailable action guidance from a read-only observation surface', () => {
    const prompt = agentComputerRoutingPrompt(['computer.observe']);
    expect(prompt).toContain('computer_observe');
    expect(prompt.match(/computer_\w+/gu)?.every(name => name === 'computer_observe')).toBe(true);
  });

  it('does not introduce computer routing into Runs without computer tools', () => {
    expect(agentComputerRoutingPrompt(['file.read', 'shell.run'])).toBe('');
    expect(buildAgentSystemPrompt({ ...context, platform: 'win32' }, undefined, ['file.read']))
      .not.toContain('当前电脑操作选择');
  });

  it('uses the model-filtered capability surface and does not imply GUI access for a nonvisual model', () => {
    const original = createAgentToolRegistry(computerTools.map(name => ({ name, description: name,
      risk: 'read' as const, inputSchema: { type: 'object' }, execute: async () => ({ ok: true }) }))).createSnapshot();
    const adapter = resolveAgentModelAdapter({ providerType: 'openai' }, 'gpt-5.5', { supportsImages: false });
    const restricted = restrictAgentToolsForModel(original, adapter);
    const prompt = buildAgentSystemPrompt(context, undefined, restricted.list().map(tool => tool.name), [], 0, adapter);
    expect(prompt).toContain('未提供界面观察');
    expect(prompt).toContain('computer_windows');
    expect(prompt).not.toContain('computer_observe');
    expect(prompt).not.toContain('computer_click');
    expect(prompt).not.toContain('主动使用电脑工具');
    expect(original.list()).toHaveLength(computerTools.length);
  });

  it('does not insert routing into text-only fallback even if the caller supplied stale capabilities', () => {
    const adapter = resolveAgentModelAdapter({ providerType: 'openai' }, 'gpt-5.5', { supportsToolCalling: false });
    const prompt = buildAgentSystemPrompt(context, undefined, computerTools, [], 0, adapter);
    expect(prompt).not.toContain('当前电脑操作选择');
    expect(prompt).toContain('无工具兼容模式');
  });

  it('delivers the guidance and descriptions to the Provider without forcing a mouse call', () => {
    const systemPrompt = buildAgentSystemPrompt(context, undefined, ['computer.windows']);
    const body = buildAgentProviderRequestBody({ baseUrl: 'https://example.invalid',
      apiKey: 'test-only', providerType: 'openai' }, {
      model: 'gpt-5.5', maxOutputTokens: 1024, systemPrompt,
      messages: [{ role: 'user', content: '看看文本编辑里的测试窗口现在是什么内容。' }],
      tools: [{ name: 'computer.windows', description: '按应用名发现窗口', inputSchema: { type: 'object' } }],
    });
    expect(body.messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'system', content: systemPrompt })]));
    expect(body.tools).toEqual([expect.objectContaining({ function: expect.objectContaining({
      name: 'computer_windows', description: '按应用名发现窗口',
    }) })]);
    expect(body).not.toHaveProperty('tool_choice');
  });
});
