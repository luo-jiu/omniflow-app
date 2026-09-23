import { app, type BrowserWindow, type WebContents } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { ThemeSnapshot } from '../../../packages/plugin-sdk/index.js';
import type { PluginWorkspaceDestination, PluginWorkspaceEvent, PluginWorkspaceOpen } from '../../../src/shared/plugins/workspace.types';
import { normalizeAgentOwnerScope } from '../../../src/shared/agent/agent-owner-scope';
import type { PluginManager } from './plugin-manager';
import type { createPluginCommandService } from './plugin-command-service';
import { PluginDevelopmentHost, type IsolatedPluginInstance } from './isolated-view';
import { openLibraryResource } from './library-resource';
import { PluginFault, validateTheme } from './resource-broker';

interface Options {
  manager: PluginManager;
  getMainWindow(): BrowserWindow | null;
  commands(): ReturnType<typeof createPluginCommandService> | undefined;
  apiBaseUrl: string;
  storageOrigins: readonly string[];
  preloadPath?: string;
}
interface Entry {
  input: Omit<PluginWorkspaceOpen, 'token' | 'username'>;
  sender: WebContents;
  pluginId: string;
  fingerprint: string;
  commandId: string;
  fileOutput: boolean;
  controller: AbortController;
  instance?: IsolatedPluginInstance;
  bounds: Electron.Rectangle | null;
  counted: boolean;
  preparing: boolean;
  visible: boolean;
  executionId?: string;
}
const activeStatuses = new Set(['preparing', 'awaiting-approval', 'executing', 'commit-unknown']);
const fault = (code: string): never => { throw new PluginFault(code, 'Workspace request failed'); };
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
function destination(value: unknown): PluginWorkspaceDestination | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) return fault('BAD_REQUEST');
  const input = value as PluginWorkspaceDestination;
  if (Object.keys(input).some(key => key !== 'parentId' && key !== 'fileName') || !positive(input.parentId)
    || typeof input.fileName !== 'string' || !input.fileName.trim() || Buffer.byteLength(input.fileName, 'utf8') > 240
    || /[\p{Cc}\\/]/u.test(input.fileName) || ['.', '..'].includes(input.fileName)) return fault('BAD_REQUEST');
  return { parentId: input.parentId, fileName: input.fileName };
}

/** A workspace owns a visible resource view; all command execution remains in M1. */
export function createPluginWorkspaceService(options: Options) {
  const entries = new Map<string, Entry>();
  const backendScope = normalizeAgentOwnerScope({ accountScope: 'user:1', backendScope: options.apiBaseUrl }).backendScope;
  let host: { parent: BrowserWindow; runtime: PluginDevelopmentHost } | undefined;
  let disposed = false;
  function parentFor(sender: WebContents) {
    const parent = options.getMainWindow();
    if (disposed || !parent || parent.isDestroyed() || sender.isDestroyed() || sender !== parent.webContents) return fault('FORBIDDEN');
    return parent;
  }
  function send(entry: Entry, event: PluginWorkspaceEvent) {
    try { if (!entry.sender.isDestroyed()) entry.sender.send('plugin-workspace:event', event); }
    catch { /* The manual execution record survives a closing renderer. */ }
  }
  function stop(id: string, reason = 'closed') {
    const entry = entries.get(id);
    if (!entry) return;
    entries.delete(id); entry.controller.abort();
    entry.instance?.stop(reason);
    options.manager.stopped(entry.pluginId, reason, entry.counted);
    send(entry, { clientId: id, type: 'stopped', reason });
  }
  function release() { for (const id of [...entries.keys()]) stop(id); }
  const detach = options.manager.attachRuntime(pluginId => {
    for (const [id, entry] of entries) if (!pluginId || pluginId === entry.pluginId) stop(id, 'revoked');
  });
  function current(id: string, entry: Entry) {
    parentFor(entry.sender);
    if (entries.get(id) !== entry || entry.controller.signal.aborted
      || !options.manager.stillWorkspaceAllowed(entry.input.workspaceId, entry.fingerprint)) return fault('FORBIDDEN');
  }
  function pending(entry: Entry) {
    if (entry.preparing) return true;
    if (!entry.executionId) return false;
    const records = options.commands()?.list(entry.sender, { ownerScope: entry.input.ownerScope, libraryId: entry.input.libraryId });
    return records?.some(record => record.id === entry.executionId && activeStatuses.has(record.status)) ?? true;
  }
  function render(entry: Entry) {
    const visible = Boolean(entry.bounds) && !pending(entry);
    entry.instance?.setBounds(visible ? entry.bounds : null);
    if (entry.instance && visible !== entry.visible) { entry.visible = visible; entry.instance.setActive(visible); }
  }
  function requestPreparation(id: string, entry: Entry, parameters: Record<string, unknown>, signal: AbortSignal) {
    current(id, entry); signal.throwIfAborted();
    const commands = options.commands();
    if (!commands) return fault('UNAVAILABLE');
    if (pending(entry)) return fault('CONFLICT');
    const target = entry.fileOutput ? destination(entry.input.destination) : undefined;
    if (entry.fileOutput && !target) return fault('BAD_REQUEST');
    const requestId = randomUUID();
    const input = { ownerScope: entry.input.ownerScope, libraryId: entry.input.libraryId,
      pluginId: entry.pluginId, commandId: entry.commandId, nodeIds: [entry.input.nodeId],
      parameters: structuredClone(parameters), ...(target ? { destination: target } : {}) };
    entry.preparing = true; render(entry);
    send(entry, { clientId: id, type: 'preparing', requestId });
    // A short RPC acknowledgement never claims the asynchronous command has completed.
    // Once M1 creates its execution, closing the view does not erase/cancel that record.
    void Promise.resolve().then(() => {
      current(id, entry);
      return commands.prepare(entry.sender, input, record => {
        entry.executionId = record.id;
        if (entries.get(id) === entry) send(entry, { clientId: id, type: 'execution', requestId, executionId: record.id });
      });
    }).then(record => {
      if (entries.get(id) === entry) send(entry, { clientId: id, type: 'execution', requestId, executionId: record.id });
    }).catch(() => {
      if (entries.get(id) === entry) send(entry, { clientId: id, type: 'error', requestId, code: 'UNAVAILABLE' });
    }).finally(() => { entry.preparing = false; });
    return { requestId };
  }
  return {
    async open(sender: WebContents, raw: PluginWorkspaceOpen): Promise<{ ok: boolean; code?: string }> {
      const parent = parentFor(sender);
      if (!raw || typeof raw !== 'object' || Object.keys(raw).some(key => !['clientId', 'workspaceId', 'libraryId', 'nodeId', 'ownerScope', 'token', 'username', 'theme', 'destination'].includes(key))
        || typeof raw.clientId !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/u.test(raw.clientId) || entries.has(raw.clientId) || entries.size >= 4
        || typeof raw.workspaceId !== 'string' || !positive(raw.nodeId) || !positive(raw.libraryId)
        || typeof raw.token !== 'string' || !raw.token || raw.token.length > 32768 || typeof raw.username !== 'string' || !raw.username || raw.username.length > 256
        || /[\p{Cc}]/u.test(raw.token + raw.username)) return { ok: false, code: 'BAD_REQUEST' };
      let entry: Entry | undefined;
      try {
        const scope = normalizeAgentOwnerScope(raw.ownerScope);
        if (scope.backendScope !== backendScope) return { ok: false, code: 'FORBIDDEN' };
        validateTheme(raw.theme);
        const resolved = options.manager.resolveWorkspace(raw.workspaceId);
        const command = resolved.plugin.commands!.find(item => item.id === resolved.workspace.commandId)!;
        const tool = resolved.plugin.agentTools!.find(item => item.id === command.toolId)!;
        const target = destination(raw.destination);
        if (target && tool.kind !== 'file-output') return { ok: false, code: 'BAD_REQUEST' };
        entry = { input: { clientId: raw.clientId, workspaceId: raw.workspaceId, libraryId: raw.libraryId, nodeId: raw.nodeId, ownerScope: scope,
          theme: structuredClone(raw.theme), ...(target ? { destination: target } : {}) }, sender, pluginId: resolved.plugin.id,
          fingerprint: resolved.plugin.fingerprint, commandId: command.id, fileOutput: tool.kind === 'file-output', controller: new AbortController(),
          bounds: null, counted: false, preparing: false, visible: false };
        entries.set(raw.clientId, entry);
        if (!host || host.parent !== parent) {
          host?.runtime.dispose();
          host = { parent, runtime: new PluginDevelopmentHost(parent, options.preloadPath ?? path.join(process.env.APP_ROOT ?? app.getAppPath(), 'dist-plugins/plugin-preload.cjs')) };
        }
        const bound = entry;
        const resource = await openLibraryResource({ apiBaseUrl: options.apiBaseUrl, storageOrigins: options.storageOrigins,
          libraryId: raw.libraryId, nodeId: raw.nodeId, token: raw.token, username: raw.username, signal: entry.controller.signal });
        // The supplied account must match the server-authenticated user bound by openLibraryResource.
        const resourceAccount = createHash('sha256').update(JSON.stringify([new URL(backendScope + '/').href, Number(scope.accountScope.slice(5))])).digest('hex');
        if (resource.accountScope !== resourceAccount) return fault('FORBIDDEN');
        current(raw.clientId, bound);
        const instance = await host.runtime.load(resolved.directory, resource, raw.theme, true, {
          externalLayout: true, expectedFingerprint: resolved.plugin.fingerprint, signal: bound.controller.signal,
          workspaceExecution: { contribution: resolved.workspace, prepare: (parameters, signal) => requestPreparation(raw.clientId, bound, parameters, signal) },
          onDiagnostic: event => options.manager.requestFailed(bound.pluginId, event),
          onStop: reason => { if (entries.get(raw.clientId) === bound) stop(raw.clientId, reason); },
        });
        if (entries.get(raw.clientId) !== bound || bound.controller.signal.aborted) { instance.stop(); return fault('CANCELLED'); }
        bound.instance = instance; current(raw.clientId, bound);
        bound.counted = true; options.manager.started(bound.pluginId); instance.setTheme(bound.input.theme); render(bound);
        return { ok: true };
      } catch (error) {
        if (entry && entries.get(raw.clientId) === entry) stop(raw.clientId, 'load-failed');
        return { ok: false, code: error instanceof PluginFault ? error.code : 'UNAVAILABLE' };
      }
    },
    close(sender: WebContents, id: string) { parentFor(sender); if (entries.get(id)?.sender === sender) stop(id); },
    release(sender: WebContents) { parentFor(sender); for (const [id, entry] of entries) if (entry.sender === sender) stop(id); },
    releaseOwner(senderId: number) { for (const [id, entry] of entries) if (entry.sender.id === senderId) stop(id); },
    theme(sender: WebContents, id: string, theme: ThemeSnapshot) {
      parentFor(sender); const entry = entries.get(id); if (!entry) return;
      current(id, entry); validateTheme(theme);
      if (theme.revision <= entry.input.theme.revision) return;
      entry.input.theme = structuredClone(theme); entry.instance?.setTheme(theme);
    },
    destination(sender: WebContents, id: string, value: PluginWorkspaceDestination | null) {
      parentFor(sender); const entry = entries.get(id); if (!entry) return;
      current(id, entry);
      if (pending(entry)) return fault('CONFLICT');
      if (!entry.fileOutput && value !== null) return fault('BAD_REQUEST');
      entry.input.destination = destination(value);
    },
    layout(sender: WebContents, id: string, input: Electron.Rectangle | null) {
      const parent = parentFor(sender); const entry = entries.get(id); if (!entry) return;
      current(id, entry);
      if (input && (!['x', 'y', 'width', 'height'].every(key => Number.isFinite(input[key as keyof Electron.Rectangle])) || input.width < 0 || input.height < 0)) return fault('BAD_REQUEST');
      const [width, height] = parent.getContentSize();
      const x = input ? Math.max(0, Math.min(width, Math.round(input.x))) : 0;
      const y = input ? Math.max(0, Math.min(height, Math.round(input.y))) : 0;
      const bounds = input ? { x, y, width: Math.min(Math.round(input.width), width - x), height: Math.min(Math.round(input.height), height - y) } : null;
      entry.bounds = bounds && bounds.width > 0 && bounds.height > 0 ? bounds : null;
      render(entry);
    },
    dispose() { if (disposed) return; release(); detach(); host?.runtime.dispose(); host = undefined; disposed = true; },
  };
}
