import type { AgentAppContext, AgentPerceptionSnapshot, AgentPluginToolSource, AgentPreparedActionPublic, AgentToolCallSnapshot } from '../../../src/shared/agent/agent.types';
import type { AgentLibraryNode, AgentLibraryQuery, AgentLibraryReadResult } from '../../../src/shared/agent/agent-library-query';
import type { AgentLibraryAccessSnapshot } from '../../../src/shared/agent/agent-session-management';
import { normalizeAgentLibraryDirectoryPath } from '../../../src/shared/agent/agent-library-path';
import { normalizeAgentPluginToolSource } from './agent-plugin-source';

export interface AgentAccessApproval {
  title: string;
  description: string;
  write: boolean;
  targets: Array<{ nodeId: number; name: string; write: boolean; descendants: boolean }>;
}
interface Target { nodeId?: number; path?: string; write: boolean; descendants?: boolean; sensitive?: boolean; singleFile?: boolean }
interface Intent { targets: Target[]; opaque?: string; external?: boolean }
type Lookup = Map<string, Promise<AgentLibraryNode>>;
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const id = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : undefined;
const text = (value: unknown) => typeof value === 'string' ? value : undefined;
function renameNodeIds(value: unknown): number[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50
    || Array.from(value).some(nodeId => id(nodeId) === undefined)
    || new Set(value).size !== value.length) throw new Error('插件改名必须提供 1 至 50 个不重复的 resources 文件 ID');
  return [...value];
}
const parentPath = (value: string) => {
  const path = normalizeAgentLibraryDirectoryPath(value);
  if (path === '/') throw new Error('不能将资料库根目录作为新文件');
  return path.slice(0, path.lastIndexOf('/')) || '/';
};

function intentFor(name: string, value: unknown, context: AgentAppContext, action?: AgentPreparedActionPublic,
  pluginTools?: ReadonlyMap<string, AgentPluginToolSource>): Intent {
  const input = record(value);
  if (pluginTools?.has(name)) {
    const resource = record(input.resource);
    if (!Object.prototype.hasOwnProperty.call(input, 'resource')
      || Object.keys(resource).length !== 1 || !Object.prototype.hasOwnProperty.call(resource, 'nodeId')
      || !id(resource.nodeId)) throw new Error('插件 Tool 必须提供明确的 resource.nodeId');
    return { targets: [{ nodeId: id(resource.nodeId), write: false, singleFile: true }] };
  }
  const source = (write: boolean, sensitive = false): Target => ({
    ...(text(input.path) ? { path: text(input.path) } : { nodeId: id(input.nodeId) || id(input.sourceNodeId) || context.selectedNodeIds[0] }), write, sensitive,
  });
  const parent = (): Target => ({ ...(text(input.parentPath) ? { path: text(input.parentPath) }
    : id(input.parentId) ? { nodeId: id(input.parentId) }
      : context.currentDirectory?.id ? { nodeId: context.currentDirectory.id } : { path: '/' }), write: true });
  if (['skill.activate', 'agent.plan.set', 'memory.propose', 'interaction.request', 'operation.verify'].includes(name)
    || ['attachment.read', 'attachment.inspect', 'attachment.view', 'attachment.query'].includes(name)) return { targets: [], external: true };
  if (name === 'shell.run') return { targets: [], external: true };
  if (['file.list', 'file.search', 'file.stat', 'file.resolve', 'file.read', 'file.grep'].includes(name) && input.scope === 'host') return { targets: [], external: true };
  if (name === 'library.batch') {
    if (!Array.isArray(input.actions) || input.actions.length > 50) throw new Error('批量操作参数无效');
    const intents = input.actions.map(item => intentFor(String(record(item).operation), item, context));
    return intents.some(item => item.opaque || item.external) ? { targets: [], opaque: '批量操作包含不能自动确定范围的步骤' }
      : { targets: intents.flatMap(item => item.targets) };
  }
  if (name === 'file.list' || name === 'file.search') return { targets: [{
    ...(text(input.path) ? { path: text(input.path) } : id(input.directoryId) ? { nodeId: id(input.directoryId) }
      : context.currentDirectory?.id ? { nodeId: context.currentDirectory.id } : { path: '/' }), write: false, descendants: true,
  }] };
  if (['file.stat', 'file.resolve', 'file.read', 'file.grep', 'media.inspect', 'library.document.inspect', 'library.document.read', 'library.document.view', 'library.document.query'].includes(name)) return { targets: [source(false)] };
  if (name === 'file.write') return { targets: input.revision ? [source(true)]
    : [{ path: parentPath(String(input.path || '')), write: true }] };
  if (name === 'directory.create') return { targets: [text(input.path) ? { path: parentPath(String(input.path)), write: true } : parent()] };
  if (name === 'file.rename' || name === 'file.delete' || name === 'tag.update') return { targets: [source(true, name !== 'tag.update')] };
  if (name === 'file.move' || name === 'file.copy') return { targets: [source(name === 'file.move', name === 'file.move'), parent()] };
  if (name === 'file.stage') {
    if (action?.kind === 'file.stage') return action.sourceKind === 'library-node'
      ? { targets: [{ nodeId: action.sourceNodeId, write: false }] } : { targets: [], external: true };
    const selected = record(input.source);
    return selected.kind === 'library-node' ? { targets: [{ nodeId: id(selected.nodeId), write: false }] } : { targets: [], external: true };
  }
  if (name === 'file.publish' || name === 'file.upload') {
    if (action?.kind === 'file.publish') return action.destinationKind === 'library'
      ? { targets: [{ nodeId: action.parentId, write: true }] } : { targets: [], external: true };
    if (action?.kind === 'file.upload') return { targets: [{ nodeId: action.parentId, write: true }], opaque: '上传本机文件，需要确认本机来源和资料库目标' };
    const destination = record(input.destination);
    if (!['library', 'library-path'].includes(String(destination.kind))) return { targets: [], external: true };
    return { targets: [{ ...(destination.directoryPath ? { path: String(destination.directoryPath) } : { nodeId: id(destination.parentId) }), write: true }],
      ...(name === 'file.upload' ? { opaque: '上传本机文件，需要确认本机来源和资料库目标' } : {}) };
  }
  if (name === 'media.extractAudio') {
    const prepared = action?.kind === 'media.extractAudio' ? action : undefined;
    const root = prepared || input;
    const targets: Target[] = [{ nodeId: id(root.sourceNodeId) || id(input.nodeId) || context.selectedNodeIds[0], write: false }];
    if (root.destination === 'local') return { targets, opaque: '保存媒体到本机，需要单独确认' };
    targets.push({ nodeId: id(root.parentId) || context.currentDirectory?.id, write: true });
    return { targets };
  }
  return { targets: [], opaque: `${name} 不属于组目录的自动授权操作` };
}

export function createAgentLibraryAccessGuard(options: {
  policy: AgentLibraryAccessSnapshot;
  context: AgentAppContext;
  signal: AbortSignal;
  read: (query: AgentLibraryQuery, signal: AbortSignal) => Promise<AgentLibraryReadResult>;
  approve: (request: AgentAccessApproval) => Promise<boolean>;
  assertCurrent: () => Promise<void>;
  /** Exact host-owned Tool names and provenance captured at the same Run boundary. */
  pluginTools?: ReadonlyMap<string, AgentPluginToolSource>;
  /** Rename declarations are separate from content-reading Tools. */
  pluginRenameTools?: ReadonlyMap<string, AgentPluginToolSource>;
}) {
  const pluginTools = new Map([...options.pluginTools ?? []].map(([name, source]) => [
    name, normalizeAgentPluginToolSource(source, name),
  ]));
  const pluginRenameTools = new Map([...options.pluginRenameTools ?? []].map(([name, source]) => [
    name, normalizeAgentPluginToolSource(source, name),
  ]));
  if ([...pluginRenameTools.keys()].some(name => pluginTools.has(name))) throw new Error('插件 Tool 读取与改名能力不能混用');
  const pluginToolRuns = new Map<string, { name: string; nodeId: number }>();
  const pluginRenameRuns = new Map<string, { name: string; nodeIds: readonly number[] }>();
  const isPluginRun = (key: string) => pluginToolRuns.has(key) || pluginRenameRuns.has(key);
  const grants: Array<{ nodeId: number; write: boolean; descendants: boolean }> = [];
  const operationGrants = new Set<string>();
  const writeGrants = new Set<string>();
  const opaqueGrants = new Set<string>();
  const observed = new Map<number, AgentLibraryNode>();
  const full = options.policy.mode === 'full-access';

  async function resolve(target: Target, lookup?: Lookup): Promise<AgentLibraryNode> {
    options.signal.throwIfAborted();
    if (!target.nodeId && !target.path) throw new Error('请提供明确的文件或目录，才能确认访问范围');
    const key = target.path ? `path:${target.path}` : `id:${target.nodeId}`;
    const validate = (node: AgentLibraryNode): AgentLibraryNode => {
      if (!node || node.libraryId !== Number(options.context.libraryId)) throw new Error('目标不存在或不属于当前资料库');
      if ((target.nodeId && node.id !== target.nodeId) || (target.path && node.path !== normalizeAgentLibraryDirectoryPath(target.path))) throw new Error('目标身份或目录位置已变化');
      if (target.singleFile && node.type !== 'file') throw new Error('插件 Tool 只允许访问普通文件');
      return node;
    };
    if (lookup?.has(key)) return validate(await lookup.get(key)!);
    const pending = options.read(target.path ? { kind: 'resolve', path: target.path } : { kind: 'resolve', nodeId: target.nodeId }, options.signal).then(response => {
      if (response.libraryId !== Number(options.context.libraryId)) throw new Error('目标不存在或不属于当前资料库');
      return validate(response.node!);
    });
    lookup?.set(key, pending);
    const node = await pending;
    lookup?.set(`id:${node.id}`, Promise.resolve(node));
    return node;
  }
  async function ancestors(node: AgentLibraryNode, lookup?: Lookup): Promise<number[]> {
    const chain: number[] = [];
    let current = node;
    while (chain.length < 64) {
      if (chain.includes(current.id) || chain.length >= 64) throw new Error('目录祖先关系无效');
      chain.push(current.id);
      if (!current.parentId) return chain;
      current = await resolve({ nodeId: current.parentId, write: false }, lookup);
      if (current.type !== 'dir') throw new Error('目录祖先身份无效');
    }
    throw new Error('目录祖先关系过深');
  }
  async function covered(target: Target, node: AgentLibraryNode, chain: number[], lookup?: Lookup): Promise<boolean> {
    if (full) return true;
    const changingRoot = target.sensitive && options.policy.directories.some(directory => directory.nodeId === node.id);
    if (options.policy.mode === 'group' && !changingRoot && (!target.write || options.policy.access === 'read-write')) {
      for (const directory of options.policy.directories) {
        if (!chain.includes(directory.nodeId)) continue;
        const root = await resolve({ nodeId: directory.nodeId, write: false }, lookup);
        if (root.type === 'dir' && !(target.sensitive && node.id === root.id)) return true;
      }
    }
    return !target.write && grants.some(grant => !grant.write && (grant.nodeId === node.id || (grant.descendants && chain.includes(grant.nodeId))));
  }
  async function authorizeTargets(targets: Target[], key: string, mayAsk: boolean, operationDescription = '', lookup: Lookup = new Map()) {
    await options.assertCurrent();
    const resolved = [];
    for (const target of targets) {
      const node = await resolve(target, lookup);
      const chain = await ancestors(node, lookup);
      resolved.push({ target, node, chain, covered: await covered(target, node, chain, lookup)
        || (target.write && writeGrants.has(JSON.stringify([key, node.id, chain]))) });
    }
    const identity = JSON.stringify([key, resolved.map(item => [item.target.write, item.node.id,
      item.node.parentId, item.chain])]);
    if (resolved.every(item => item.covered) || operationGrants.has(identity)) {
      for (const item of resolved) observed.set(item.node.id, item.node);
      return;
    }
    if (!mayAsk) throw new Error('目录位置或授权已变化，未继续执行，请重新确认');
    const missing = resolved.filter(item => !item.covered);
    const write = missing.some(item => item.target.write);
    const approved = await options.approve({
      title: write ? '确认文件操作范围' : '确认读取范围', write,
      description: `${operationDescription ? `${operationDescription}\n` : ''}${write ? '仅批准本次文件操作；目标或位置变化后需要重新确认。' : '允许本次执行读取这些文件或目录，停止后失效。目录授权包含子目录。'}`,
      targets: missing.map(({ node, target }) => ({ nodeId: node.id, name: node.path || node.name,
        write: target.write, descendants: !target.write && node.type === 'dir' })),
    });
    options.signal.throwIfAborted();
    if (!approved) throw new Error('用户未批准此次访问');
    for (const item of missing) if (!item.target.write) grants.push({ nodeId: item.node.id, write: false, descendants: item.node.type === 'dir' });
    for (const item of missing) if (item.target.write) writeGrants.add(JSON.stringify([key, item.node.id, item.chain]));
    operationGrants.add(identity);
    await authorizeTargets(targets, key, false);
  }
  async function authorizeRename(nodeIds: number[], toolRunId: string, mayAsk = false) {
    const ids = renameNodeIds(nodeIds);
    const run = pluginRenameRuns.get(toolRunId);
    if (!run || ids.some(nodeId => !run.nodeIds.includes(nodeId))) throw new Error('插件改名文件身份或授权范围不匹配');
    await authorizeTargets(ids.map(nodeId => ({ nodeId, write: true, singleFile: true })), toolRunId, mayAsk,
      `插件 ${pluginRenameTools.get(run.name)!.pluginId} · ${run.name}（仅确认范围，改名提案另行确认）`);
  }
  async function authorizeTool(call: AgentToolCallSnapshot, toolRunId: string, action?: AgentPreparedActionPublic, mayAsk = true): Promise<boolean> {
    const previousRunName = pluginToolRuns.get(toolRunId)?.name ?? pluginRenameRuns.get(toolRunId)?.name;
    if (previousRunName && previousRunName !== call.name) throw new Error('插件 Tool 文件身份已变化');
    if (pluginRenameTools.has(call.name)) {
      const input = record(call.input);
      if (!Object.prototype.hasOwnProperty.call(input, 'resources')) throw new Error('插件改名必须提供明确的 resources');
      const nodeIds = renameNodeIds(input.resources);
      const previous = pluginRenameRuns.get(toolRunId);
      if (previous && (previous.nodeIds.length !== nodeIds.length
        || previous.nodeIds.some((nodeId, index) => nodeId !== nodeIds[index]))) throw new Error('插件改名文件身份已变化');
      pluginRenameRuns.set(toolRunId, { name: call.name, nodeIds });
      opaqueGrants.delete(toolRunId);
      await authorizeRename(nodeIds, toolRunId, mayAsk);
      // A scope approval never replaces the later old-name -> new-name confirmation.
      return false;
    }
    if (pluginTools.has(call.name)) {
      const intent = intentFor(call.name, call.input, options.context, action, pluginTools);
      const nodeId = intent.targets[0]?.nodeId;
      if (!nodeId) throw new Error('插件 Tool 文件身份无效');
      const previous = pluginToolRuns.get(toolRunId);
      if (previous && (previous.name !== call.name || previous.nodeId !== nodeId)) throw new Error('插件 Tool 文件身份已变化');
      pluginToolRuns.set(toolRunId, { name: call.name, nodeId });
      opaqueGrants.delete(toolRunId);
      await authorizeTargets(intent.targets, toolRunId, mayAsk, `插件 ${pluginTools.get(call.name)!.pluginId} · ${call.name}`);
      return true;
    }
    if (full) return false;
    await options.assertCurrent();
    if (opaqueGrants.has(toolRunId)) return false;
    const intent = intentFor(call.name, call.input, options.context, action);
    if (intent.external) return false;
    const input = record(call.input);
    const operationDescription = [call.name, input.path, input.name, record(input.source).path,
      record(input.destination).directoryPath,
      typeof input.content === 'string' ? `正文 ${input.content.length} 字符` : undefined]
      .filter(value => typeof value === 'string').join(' · ').slice(0, 600);
    if (intent.opaque) {
      if (!opaqueGrants.has(toolRunId)) {
        if (!mayAsk || !await options.approve({ title: '确认工具访问', description: `${operationDescription}\n${intent.opaque}`,
          write: !['recycle.list', 'tag.list'].includes(call.name), targets: [] })) throw new Error('用户未批准此次工具访问');
        options.signal.throwIfAborted();
        opaqueGrants.add(toolRunId);
      }
    }
    if (intent.targets.length) await authorizeTargets(intent.targets, toolRunId, mayAsk, operationDescription);
    return !intent.opaque;
  }
  async function authorizeQuery(query: AgentLibraryQuery, mayAsk = true, toolRunId?: string) {
    if (toolRunId && pluginRenameRuns.has(toolRunId)) {
      if (!['resolve', 'stat'].includes(query.kind) || !id(query.nodeId) || query.path !== undefined
        || query.directoryId !== undefined) throw new Error('插件改名仅允许获准文件的元数据查询');
      await authorizeRename([query.nodeId!], toolRunId, mayAsk);
      return;
    }
    if (full) return;
    await options.assertCurrent();
    if (toolRunId && !isPluginRun(toolRunId) && opaqueGrants.has(toolRunId)) return;
    const target: Target = query.path ? { path: query.path, write: false }
      : { nodeId: query.nodeId || query.directoryId || options.context.currentDirectory?.id, write: false };
    if (!target.nodeId && !target.path) target.path = '/';
    await authorizeTargets([target], `query:${JSON.stringify(query)}`, mayAsk);
  }
  async function checkMetadata(data: AgentLibraryReadResult, toolRunId?: string) {
    const renameRun = toolRunId ? pluginRenameRuns.get(toolRunId) : undefined;
    if (renameRun) {
      await options.assertCurrent();
      const nodes = [...(data.entries || []), ...(data.node ? [data.node] : []), ...(data.directory ? [data.directory] : [])];
      const ids = renameNodeIds(nodes.map(node => node.id));
      if (data.libraryId !== Number(options.context.libraryId) || nodes.some(node => node.libraryId !== Number(options.context.libraryId)
        || node.type !== 'file' || !renameRun.nodeIds.includes(node.id))) throw new Error('插件改名元数据返回了未经授权的文件');
      const lookup: Lookup = new Map(nodes.map(node => [`id:${node.id}`, Promise.resolve(node)]));
      await authorizeTargets(ids.map(nodeId => ({ nodeId, write: true, singleFile: true })), toolRunId!, false, '', lookup);
      return;
    }
    if (full) return;
    await options.assertCurrent();
    if (toolRunId && !isPluginRun(toolRunId) && opaqueGrants.has(toolRunId)) return;
    const lookup: Lookup = new Map();
    const nodes = [...(data.entries || []), ...(data.node ? [data.node] : []), ...(data.directory ? [data.directory] : [])];
    for (const node of nodes) lookup.set(`id:${node.id}`, Promise.resolve(node));
    for (const node of nodes) {
      const target = { nodeId: node.id, write: false };
      if (!await covered(target, node, await ancestors(node, lookup), lookup)) throw new Error('查询返回了未经授权的节点');
      observed.set(node.id, node);
    }
  }
  async function initialPerception(input?: AgentPerceptionSnapshot): Promise<AgentPerceptionSnapshot | undefined> {
    if (full) return input;
    const result: AgentPerceptionSnapshot = { collectedAt: new Date().toISOString(), selectedNodes: [] };
    if (options.policy.mode !== 'group' || !options.policy.directories.length) return result;
    const roots: AgentLibraryNode[] = [];
    for (const directory of options.policy.directories) {
      const node = await resolve({ nodeId: directory.nodeId, write: false });
      if (node.type !== 'dir') throw new Error('组的授权根不再是有效目录，请修改会话组设置');
      roots.push(node);
    }
    let root = roots[0];
    if (input?.currentDirectory?.id) {
      try {
        const selected = await resolve({ nodeId: input.currentDirectory.id, write: false });
        if (selected.type === 'dir' && await covered({ nodeId: selected.id, write: false }, selected, await ancestors(selected))) root = selected;
      } catch { options.signal.throwIfAborted(); }
    }
    const listing = await options.read({ kind: 'list', directoryId: root.id, limit: 50 }, options.signal);
    await checkMetadata(listing);
    result.currentDirectory = { id: root.id, name: root.name, entryCount: listing.entries?.length || 0,
      entries: listing.entries || [], truncated: listing.hasMore || false };
    const selectedNodes: AgentLibraryNode[] = [];
    for (const selected of input?.selectedNodes || []) {
      try {
        const node = await resolve({ nodeId: selected.id, write: false });
        if (await covered({ nodeId: node.id, write: false }, node, await ancestors(node))) selectedNodes.push(node);
      } catch { options.signal.throwIfAborted(); }
    }
    result.selectedNodes = selectedNodes;
    result.knownNodes = [...new Map([...roots, root, ...(listing.entries || []), ...selectedNodes].map(node => [node.id, node])).values()];
    return result;
  }
  return { authorizeTool, authorizeQuery, authorizeRename, checkMetadata, initialPerception,
    grantApprovedTool: (toolRunId: string) => { if (!isPluginRun(toolRunId)) opaqueGrants.add(toolRunId); },
    canAutoApproveTool: async (call: AgentToolCallSnapshot, toolRunId: string, action?: AgentPreparedActionPublic) => {
      try { return await authorizeTool(call, toolRunId, action, false); } catch { options.signal.throwIfAborted(); return false; }
    },
    observedNodes: () => [...observed.values()],
    authorizeResource: async (nodeId: number, write: boolean, key: string, mayAsk = true) => {
      await options.assertCurrent();
      if (pluginRenameRuns.has(key)) throw new Error('插件改名不允许正文读取或通用文件写入');
      const pluginRun = pluginToolRuns.get(key);
      if (pluginRun) {
        if (write || nodeId !== pluginRun.nodeId) throw new Error('插件 Tool 文件身份或读取权限不匹配');
        await authorizeTargets([{ nodeId, write: false, singleFile: true }], key, mayAsk);
        return;
      }
      if (!full && !opaqueGrants.has(key)) await authorizeTargets([{ nodeId, write }], key, mayAsk);
    },
    authorizeDirectory: async (path: string, write: boolean, key: string, mayAsk = true) => {
      await options.assertCurrent();
      if (isPluginRun(key)) throw new Error('插件 Tool 不允许目录访问');
      if (!full && !opaqueGrants.has(key)) await authorizeTargets([{ path, write }], key, mayAsk);
    },
  };
}
export type AgentLibraryAccessGuard = ReturnType<typeof createAgentLibraryAccessGuard>;
