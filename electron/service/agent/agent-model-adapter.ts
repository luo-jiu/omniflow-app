import crypto from 'node:crypto';
import type { AIServiceRuntimeConnection } from '../aiServiceClientModel';
import type { AgentModelMetadata } from './agent-model-context';
import type { AgentToolRegistrySnapshot } from './agent-tool-registry';
import type { AgentSkillSnapshotV1 } from './skills/agent-skill.types';
import { findAgentModelProfile } from './agent-model-profiles';

type Effort = 'low' | 'medium' | 'high';
export interface AgentModelAdapter {
  readonly identity: string;
  readonly profileId: string;
  readonly source: 'builtin' | 'protocol-fallback';
  readonly reasoningParameter: 'reasoning_effort' | 'output_config' | 'none';
  readonly reasoningEfforts: readonly Effort[];
  readonly toolCalling: boolean;
  readonly shellTool: boolean;
  readonly parallelToolCalls?: boolean;
  readonly instructions: string;
}

export function resolveAgentModelAdapter(
  connection: Pick<AIServiceRuntimeConnection, 'providerType'>,
  model: string,
  metadata?: AgentModelMetadata,
): AgentModelAdapter {
  const profile = findAgentModelProfile(connection.providerType, model);
  const noEffort = profile && ['openai-standard', 'claude-standard', 'deepseek-chat', 'deepseek-reasoner'].includes(profile.family);
  const reasoningParameter: AgentModelAdapter['reasoningParameter'] = noEffort ? 'none' : connection.providerType === 'claude' ? 'output_config' : 'reasoning_effort';
  const efforts: Effort[] = noEffort ? [] : ['low', 'medium', 'high'];
  const reasoningEfforts = Object.freeze(metadata?.reasoningEfforts === undefined ? efforts
    : efforts.filter(effort => metadata.reasoningEfforts!.includes(effort)));
  // The current message adapter does not round-trip reasoning_content required by this route.
  const toolCalling = profile?.family !== 'deepseek-reasoner' && metadata?.supportsToolCalling !== false;
  const parallelToolCalls = metadata?.supportsParallelToolCalls === false ? false
    : profile?.family === 'openai-reasoning' ? true : undefined;
  const facts = {
    version: 1, profileId: profile?.id || `${connection.providerType}-compatible`,
    source: profile ? 'builtin' as const : 'protocol-fallback' as const,
    reasoningParameter, reasoningEfforts, toolCalling,
    shellTool: toolCalling && metadata?.supportsShellTool !== false, parallelToolCalls,
  } as const;
  const instructions = !toolCalling
    ? '当前连接按纯文本兼容模式运行，未提供执行工具。不得声称已经搜索、读取或修改文件；需要执行的任务应明确说明限制。'
    : !profile ? ''
    : profile?.family === 'openai-reasoning'
      ? '使用已提供的结构化工具定位事实，不输出隐藏推理。可在一次响应提出独立调用，但实际执行、授权和依赖顺序由运行时控制；有数据依赖时先等待结果。'
      : connection.providerType === 'claude'
        ? '只通过提供的工具定义调用操作，工具结果到达后再继续依赖它的步骤，不把 tool_use 或思考内容写成用户可执行代码。'
        : '使用提供的 JSON 工具参数，先等待必要结果再决定下一步；不要把名称相似的模型当作支持未提供的工具协议。';
  const identity = `model-adapter-v1:${crypto.createHash('sha256').update(JSON.stringify({ ...facts, instructions })).digest('hex')}`;
  return Object.freeze({ ...facts, identity, instructions });
}

export function agentModelAdapterPrompt(adapter?: AgentModelAdapter): string {
  if (!adapter) return '';
  if (!adapter.instructions && adapter.shellTool && adapter.parallelToolCalls !== false) return '';
  return `\n\n模型执行适配（不改变业务与权限规则）：\n${adapter.instructions}`
    + (!adapter.shellTool && adapter.toolCalling ? '\n当前连接未提供 Shell 工具，不得用未注册的命令接口替代。' : '')
    + (adapter.parallelToolCalls === false ? '\n本次请求不启用并行工具调用，请一次调用一个工具。' : '');
}

export function resolveAgentAdapterEffort(adapter: AgentModelAdapter, effort?: string): Effort | undefined {
  return adapter.reasoningParameter !== 'none' && adapter.reasoningEfforts.includes(effort as Effort) ? effort as Effort : undefined;
}

export function restrictAgentToolsForModel(snapshot: AgentToolRegistrySnapshot, adapter: AgentModelAdapter): AgentToolRegistrySnapshot {
  const tools = Object.freeze(snapshot.tools.filter(tool => adapter.toolCalling && (adapter.shellTool || tool.name !== 'shell.run')));
  const allowed = new Set(tools.map(tool => tool.name));
  const assertAllowed = (name: string) => { if (!allowed.has(name)) throw new Error('当前模型适配未开放该工具'); };
  return Object.freeze({ ...snapshot, tools,
    list: () => [...tools], get: name => allowed.has(name) ? snapshot.get(name) : null,
    validateInput: (name, ...args) => allowed.has(name) ? snapshot.validateInput(name, ...args) : { ok: false, message: '当前模型适配未开放该工具' },
    execute: async (name, ...args) => { assertAllowed(name); return snapshot.execute(name, ...args); },
    sealMainPreparedExecution: (name, ...args) => { assertAllowed(name); return snapshot.sealMainPreparedExecution(name, ...args); },
  } satisfies AgentToolRegistrySnapshot);
}

export function restrictAgentSkillsForModel(snapshot: AgentSkillSnapshotV1, tools: AgentToolRegistrySnapshot): AgentSkillSnapshotV1 {
  const skills = Object.freeze(snapshot.skills.filter(skill => skill.toolAllowlist.every(name =>
    skill.optionalTools.includes(name) || tools.get(name) !== null)));
  const allowed = new Set(skills.map(skill => skill.id));
  return Object.freeze({ ...snapshot, skills, list: () => skills,
    get: id => allowed.has(id) ? snapshot.get(id) : null,
    getSummary: id => allowed.has(id) ? snapshot.getSummary(id) : null,
    getActivationEnvelope: id => allowed.has(id) ? snapshot.getActivationEnvelope(id) : null,
    listSummaries: () => snapshot.listSummaries().filter(skill => allowed.has(skill.id)),
  } satisfies AgentSkillSnapshotV1);
}
