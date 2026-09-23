import { EventEmitter } from 'node:events';
import { PluginInstallStore } from './plugin-install-store';
import { PluginSettingsStore } from './plugin-settings-store';
import { loadPluginPackage, type LoadedPluginPackage } from './manifest';
import { createPluginToolSnapshot, isPluginCommandToolAllowed, isPluginToolAllowed, type PluginToolInvocationMode } from './plugin-tool-catalog';
import type { ManagedPlugin, PluginCatalog, PluginInstallReview, PluginManagementAction } from '../../../src/shared/plugin-management';
import { isPluginWorkspaceAllowed } from '../../../src/shared/plugin-management';

export type PluginRuntimeStopReason = 'operation' | 'fault';

export class PluginManager {
  private events = new EventEmitter(); private revision = 0;
  private blocked = new Map<string, string>(); private operating = new Set<string>();
  private bundled?: LoadedPluginPackage; private logs: PluginCatalog['logs'] = [];
  private transitioningSafeMode = false; private storageUnavailable = false;
  private resettingSettings = false; private runtimeUnavailable = false;
  private lastRequestLog = 0;
  private running = new Map<string, number>();
  private runtimes = new Set<(id?: string, reason?: PluginRuntimeStopReason) => void>();
  private failedStops = new Set<string>();
  readonly installs: PluginInstallStore; readonly settings: PluginSettingsStore;
  constructor(root: string, private bundledDirectory: string, private forcedSafeMode = false) { this.installs = new PluginInstallStore(root); this.settings = new PluginSettingsStore(root); }
  async initialize() {
    try { await this.installs.initialize(); await this.settings.initialize(); } catch { this.storageUnavailable = true; this.installs.recoveryReason = '插件存储不可用，已阻止第三方运行。请修复本机插件目录后重启。'; }
    try { this.bundled = await loadPluginPackage(this.bundledDirectory); this.installs.setReservedToolNames((this.bundled.manifest.agentTools ?? []).map(tool => tool.id)); } catch { this.record('bundled','PACKAGE_UNAVAILABLE','example.csv'); }
    for (const item of this.installs.snapshot().plugins) { try { await this.installs.verify(item); } catch { this.blocked.set(item.manifest.id,'完整性或兼容性校验失败'); } }
  }
  attachRuntime(stop: (id?: string, reason?: PluginRuntimeStopReason) => void) { this.runtimes.add(stop); return () => { this.runtimes.delete(stop); }; }
  private stopRuntimes(id?: string, reason: PluginRuntimeStopReason = 'operation') {
    let failed = false;
    for (const stop of [...this.runtimes]) { try { if (reason === 'fault') stop(id, reason); else stop(id); } catch { failed = true; } }
    if (!failed) return;
    if (!id) this.runtimeUnavailable = true;
    for (const pluginId of id ? [id] : this.catalog().plugins.map(plugin => plugin.id)) {
      this.failedStops.add(pluginId);
      this.blocked.set(pluginId, '运行时停止失败，插件已被隔离；请重启应用后检查。');
    }
    this.record('stop', 'RUNTIME_STOP_FAILED', id);
    throw new Error('RUNTIME_STOP_FAILED');
  }
  private async persistStopFailures() {
    for (const id of [...this.failedStops]) {
      try { await this.installs.recordFailure(id, 'runtime-stop-failed'); this.failedStops.delete(id); }
      catch { this.storageUnavailable = true; this.record('quarantine', 'PERSIST_FAILED', id); }
    }
  }
  subscribe(listener: (catalog: PluginCatalog) => void) { this.events.on('change',listener); return () => { this.events.off('change',listener); }; }
  private changed() { this.revision++; this.events.emit('change',this.catalog()); }
  private record(action: string, code: string, pluginId?: string) { this.logs.push({ time:new Date().toISOString(),action,code,pluginId }); if(this.logs.length>128)this.logs.shift(); this.changed(); }
  catalog(): PluginCatalog {
    const state = this.installs.snapshot(); const safeMode = state.safeMode || this.forcedSafeMode || this.transitioningSafeMode || this.storageUnavailable;
    const runtimeBlock = this.runtimeUnavailable ? '运行时停止失败，请重启应用后检查。' : this.resettingSettings ? '正在重置插件设置' : undefined;
    const plugins: ManagedPlugin[] = state.plugins.map(item => ({ id:item.manifest.id,version:item.manifest.version,fingerprint:item.fingerprint,
      enabled:item.enabled,readApproved:item.readApproved,toolApproved:item.toolApproved,renameApproved:item.renameApproved,outputApproved:item.outputApproved,source:'local',installedAt:item.installedAt,previousVersion:item.previous?.manifest.version,
      viewers:item.manifest.viewers,agentTools:item.manifest.agentTools ?? [],commands:item.manifest.commands ?? [],workspaces:item.manifest.workspaces ?? [],permissions:item.manifest.permissions,running:this.running.get(item.manifest.id)??0,
      blockedReason:runtimeBlock??(this.operating.has(item.manifest.id)?'操作进行中':this.blocked.get(item.manifest.id)??(item.failure?'运行异常：'+item.failure:undefined)??(safeMode?'恢复模式阻止第三方运行':undefined)) }));
    if(this.bundled) { const flags=state.bundled??{enabled:true,readApproved:true,toolApproved:false};plugins.unshift({id:this.bundled.manifest.id,version:this.bundled.manifest.version,fingerprint:this.bundled.fingerprint,
      ...flags,toolApproved:flags.toolApproved && flags.toolFingerprint===this.bundled.fingerprint,renameApproved:Boolean(flags.renameApproved && flags.renameFingerprint===this.bundled.fingerprint),outputApproved:Boolean(flags.outputApproved && flags.outputFingerprint===this.bundled.fingerprint),source:'bundled',installedAt:'随应用提供',viewers:this.bundled.manifest.viewers,agentTools:this.bundled.manifest.agentTools ?? [],commands:this.bundled.manifest.commands ?? [],workspaces:this.bundled.manifest.workspaces ?? [],permissions:this.bundled.manifest.permissions,running:this.running.get(this.bundled.manifest.id)??0,
      blockedReason:runtimeBlock??(this.operating.has(this.bundled.manifest.id)?'操作进行中':this.blocked.get(this.bundled.manifest.id)??(flags.failure?'运行异常：'+flags.failure:undefined))}); }
    return { revision:this.revision,safeMode,settingsRecoveryRequired:this.settings.needsRecovery,recoveryReason:this.forcedSafeMode?'启动参数强制禁用第三方，移除参数并重启后才能解除。':this.installs.recoveryReason,plugins,logs:structuredClone(this.logs) };
  }
  resolve(viewerId: string) {
    const plugin=this.catalog().plugins.find(item=>item.viewers.some(viewer=>viewer.id===viewerId));
    if(!plugin||!plugin.enabled||plugin.blockedReason||(plugin.permissions.includes('resource.read')&&!plugin.readApproved)) throw new Error('PLUGIN_BLOCKED');
    return { plugin, directory:plugin.source==='bundled'?this.bundledDirectory:this.installs.directory(plugin.fingerprint) };
  }
  stillAllowed(viewerId: string, fingerprint: string) { try{return this.resolve(viewerId).plugin.fingerprint===fingerprint;}catch{return false;} }
  resolveWorkspace(workspaceId: string, expectedFingerprint?: string) {
    const plugin = this.catalog().plugins.find(item => item.workspaces?.some(workspace => workspace.id === workspaceId));
    const workspace = plugin?.workspaces?.find(item => item.id === workspaceId);
    if (!plugin || !workspace || !isPluginWorkspaceAllowed(plugin, workspace)) throw new Error('PLUGIN_BLOCKED');
    if (expectedFingerprint !== undefined && plugin.fingerprint !== expectedFingerprint) throw new Error('PLUGIN_VERSION_CHANGED');
    return { plugin, workspace, directory:plugin.source === 'bundled' ? this.bundledDirectory : this.installs.directory(plugin.fingerprint) };
  }
  stillWorkspaceAllowed(workspaceId: string, fingerprint: string) { try { return this.resolveWorkspace(workspaceId, fingerprint).plugin.fingerprint === fingerprint; } catch { return false; } }
  toolSnapshot(reservedToolNames: readonly string[] = [], mode: PluginToolInvocationMode = 'agent') { return createPluginToolSnapshot(this.catalog().plugins, reservedToolNames, mode); }
  resolveTool(toolId: string, expectedFingerprint?: string, mode: PluginToolInvocationMode = 'agent') {
    const registration = this.toolSnapshot([], mode).find(item => item.contribution.id === toolId);
    if (!registration) throw new Error('PLUGIN_BLOCKED');
    if (expectedFingerprint !== undefined && registration.fingerprint !== expectedFingerprint) throw new Error('PLUGIN_VERSION_CHANGED');
    const plugin = this.catalog().plugins.find(item => item.id === registration.pluginId)!;
    return { plugin, directory:plugin.source==='bundled'?this.bundledDirectory:this.installs.directory(plugin.fingerprint), tool:registration.contribution, registrationId:registration.registrationId, providerName:registration.providerName };
  }
  stillToolAllowed(toolId: string, fingerprint: string, mode: PluginToolInvocationMode = 'agent') {
    const plugin = this.catalog().plugins.find(item => item.agentTools?.some(tool => tool.id === toolId));
    const contribution = plugin?.agentTools?.find(tool => tool.id === toolId);
    const allowed = mode === 'command' ? isPluginCommandToolAllowed : isPluginToolAllowed;
    return Boolean(plugin && contribution && allowed(plugin, contribution) && plugin.fingerprint === fingerprint);
  }
  async prepare(source: string): Promise<PluginInstallReview> { try {const review=await this.installs.prepare(source);this.record('prepare','OK',review.id);return review;}catch(error){this.record('prepare','PACKAGE_REJECTED');throw error;} }
  discard(ticket:string) {return this.installs.discard(ticket);}
  async commit(ticket:string) {
    const id = this.installs.review(ticket).id;
    if (this.operating.has(id)) throw new Error('PLUGIN_BUSY');
    this.operating.add(id); this.changed();
    try {this.stopRuntimes(id);await this.installs.commit(ticket,value=>this.stopRuntimes(value));this.blocked.delete(id);this.record('install','OK',id);}
    catch(error){await this.persistStopFailures();this.record('install','INSTALL_FAILED',id);throw error;}
    finally{this.operating.delete(id);this.changed();}
    return this.catalog();
  }
  async action(id:string,action:PluginManagementAction) {
    if(this.operating.has(id))throw new Error('PLUGIN_BUSY');this.operating.add(id);this.changed();
    try {
      this.stopRuntimes(id);
      if (action === 'approve-tools') {
        const plugin = this.catalog().plugins.find(item => item.id === id);
        if (!plugin?.permissions.includes('agent.tools') || !plugin.agentTools?.length) throw new Error('CAPABILITY_NOT_DECLARED');
      }
      if (action === 'approve-rename') {
        const plugin = this.catalog().plugins.find(item => item.id === id);
        if (!plugin?.permissions.includes('resource.rename.propose') || !plugin.agentTools?.some(tool => tool.kind === 'rename-proposal')) throw new Error('CAPABILITY_NOT_DECLARED');
      }
      if (action === 'approve-output') {
        const plugin = this.catalog().plugins.find(item => item.id === id);
        if (!plugin?.permissions.includes('resource.output.propose') || !plugin.agentTools?.some(tool => tool.kind === 'file-output')) throw new Error('CAPABILITY_NOT_DECLARED');
      }
      if(action==='clear-data')await this.settings.clearPlugin(id);
      else if(id==='example.csv')await this.installs.setBundled(action,value=>this.stopRuntimes(value),this.bundled?.fingerprint);
      else await this.installs.action(id,action,value=>this.stopRuntimes(value));
      if(action==='enable'||action==='rollback'||action==='uninstall')this.blocked.delete(id);
      this.record(action,'OK',id);
    }catch(error){await this.persistStopFailures();this.record(action,'ACTION_FAILED',id);throw error;}
    finally{this.operating.delete(id);this.changed();}
    return this.catalog();
  }
  async safeMode(enabled:boolean) {
    if(!enabled&&this.forcedSafeMode)throw new Error('STARTUP_SAFE_MODE');
    this.transitioningSafeMode=true;this.changed();
    let failed=false;
    try {
      await this.installs.setSafeMode(enabled,()=>{
        for(const plugin of this.catalog().plugins)if(plugin.source==='local'){try{this.stopRuntimes(plugin.id);}catch{failed=true;}}
        if(failed&&!enabled)throw new Error('RUNTIME_STOP_FAILED');
      });
      if(failed)throw new Error('RUNTIME_STOP_FAILED');
      this.record('safe-mode',enabled?'ENABLED':'DISABLED');
    }catch(error){await this.persistStopFailures();throw error;}
    finally{this.transitioningSafeMode=false;this.changed();}
    return this.catalog();
  }
  requestFailed(pluginId:string,event:{instanceId:string;code?:string;method?:string;requestTag?:string}) {
    if(Date.now()-this.lastRequestLog<1000)return;this.lastRequestLog=Date.now();
    this.logs.push({time:new Date().toISOString(),pluginId,action:event.method??'rpc',code:event.code??'INTERNAL',instanceId:event.instanceId,requestTag:event.requestTag});if(this.logs.length>128)this.logs.shift();this.changed();
  }
  async repairSettings() {
    this.resettingSettings=true;this.changed();
    try{this.stopRuntimes();await this.settings.backupAndReset();this.record('settings-recovery','OK');}
    catch(error){await this.persistStopFailures();throw error;}
    finally{this.resettingSettings=false;this.changed();}
    return this.catalog();
  }
  started(id:string) {this.running.set(id,(this.running.get(id)??0)+1);this.changed();}
  stopped(id:string,reason:string,counted=true) {
    const count = Math.max(0,(this.running.get(id)??0)-(counted?1:0)); if(count)this.running.set(id,count);else this.running.delete(id);
    if(['memory-budget','cpu-budget','heartbeat-timeout','startup-timeout','renderer-gone','child-frame-denied','file-picker-denied','debugger-detached'].includes(reason)){
      this.blocked.set(id,'插件已因运行故障被隔离，请检查日志后重新启用。');
      try{this.stopRuntimes(id, 'fault');}catch{void this.persistStopFailures();}
      void this.installs.recordFailure(id,reason).then(()=>this.changed(),()=>this.record('quarantine','PERSIST_FAILED',id));
    }
    this.record('stopped',reason,id);
  }
}
