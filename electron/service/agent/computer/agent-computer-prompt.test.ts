import { describe, expect, it } from 'vitest';
import { agentComputerRoutingPrompt } from './agent-computer-prompt';
import { buildAgentSystemPrompt } from '../agent-prompt-assembler';
import { resolveAgentModelAdapter, restrictAgentToolsForModel } from '../agent-model-adapter';
import { createAgentToolRegistry } from '../agent-tool-registry';
import { buildAgentProviderRequestBody } from '../agent-provider-model';

const computerTools = ['computer.windows', 'computer.observe', 'computer.click', 'computer.setText',
  'computer.scroll', 'computer.input', 'computer.menu', 'computer.hidePointer'];
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
    expect(prompt).toContain('AX 没有可操作 ID 但本次提供 click');
    expect(prompt).toContain('非安全焦点插入');
    expect(prompt).toContain('deltaY 正值向上、负值向下');
    expect(prompt).toContain('每次动作后用 computer_observe 核对');
    expect(prompt).toContain('不能自动重放或换路线再次执行同一动作');
    expect(prompt).toContain('连续动作之间保持箭头');
    expect(prompt).toContain('每次电脑工具调用优先提供可选的 title');
    expect(prompt).toContain('验证关闭按钮');
    expect(prompt).toContain('未填写时界面使用默认操作文案');
    expect(prompt).toContain('不要预先声称操作成功');
    expect(prompt).toContain('scope=menu、mode=ax');
    expect(prompt).toContain('逐级新观察后按 menuOperations');
    expect(prompt).toContain('不扫描其他普通窗口或其他应用');
    expect(prompt).toContain('以原获准窗口为任务锚点');
  });

  it('omits unavailable action guidance from a read-only observation surface', () => {
    const prompt = agentComputerRoutingPrompt(['computer.observe']);
    expect(prompt).toContain('computer_observe');
    expect(prompt.match(/computer_\w+/gu)?.every(name => name === 'computer_observe')).toBe(true);
    expect(prompt).toContain('可选的 title');
    expect(agentComputerRoutingPrompt(['computer.hidePointer'])).not.toContain('可选的 title');
  });

  it('keeps the pointer through observation, thinking and waits until the GUI phase explicitly ends', () => {
    const prompt = buildAgentSystemPrompt(context, undefined, ['file.read', ...computerTools]);
    expect(prompt).toContain('computer_hidePointer 只在明确结束当前界面操作阶段、不再需要箭头时调用');
    expect(prompt).toContain('连续动作之间保持箭头');
    expect(prompt).toContain('观察、思考或等待确认/用户回答时不要仅因暂时停顿而隐藏');
    expect(prompt).toContain('界面阶段已经结束并转为纯文字回答、文件或领域工具工作时，可先隐藏箭头');
    expect(prompt).toContain('不要为了隐藏而提前结束仍需继续的界面阶段');
    expect(prompt).toContain('Run 结束自动清理');
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
    expect(systemPrompt).toContain('title 只用于步骤展示，不影响目标、权限或结果');
  });
});
