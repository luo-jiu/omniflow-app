import { EventEmitter } from 'node:events';
import { PluginInstallStore } from './plugin-install-store';
import { PluginSettingsStore } from './plugin-settings-store';
import { loadPluginPackage, type LoadedPluginPackage } from './manifest';
import type { ManagedPlugin, PluginCatalog, PluginInstallReview, PluginManagementAction } from '../../../src/shared/plugin-management';

export class PluginManager {
  private events = new EventEmitter(); private revision = 0;
  private blocked = new Map<string, string>(); private operating = new Set<string>();
  private bundled?: LoadedPluginPackage; private logs: PluginCatalog['logs'] = [];
  private transitioningSafeMode = false; private storageUnavailable = false;
  private lastRequestLog = 0;
  private running = new Map<string, number>();
  private stop: (id?: string) => void = () => undefined;
  readonly installs: PluginInstallStore; readonly settings: PluginSettingsStore;
  constructor(root: string, private bundledDirectory: string, private forcedSafeMode = false) { this.installs = new PluginInstallStore(root); this.settings = new PluginSettingsStore(root); }
  async initialize() {
    try { await this.installs.initialize(); await this.settings.initialize(); } catch { this.storageUnavailable = true; this.installs.recoveryReason = '插件存储不可用，已阻止第三方运行。请修复本机插件目录后重启。'; }
    try { this.bundled = await loadPluginPackage(this.bundledDirectory); } catch { this.record('bundled','PACKAGE_UNAVAILABLE','example.csv'); }
    for (const item of this.installs.snapshot().plugins) { try { await this.installs.verify(item); } catch { this.blocked.set(item.manifest.id,'完整性或兼容性校验失败'); } }
  }
  attachRuntime(stop: (id?: string) => void) { this.stop = stop; }
  subscribe(listener: (catalog: PluginCatalog) => void) { this.events.on('change',listener); return () => { this.events.off('change',listener); }; }
  private changed() { this.revision++; this.events.emit('change',this.catalog()); }
  private record(action: string, code: string, pluginId?: string) { this.logs.push({ time:new Date().toISOString(),action,code,pluginId }); if(this.logs.length>128)this.logs.shift(); this.changed(); }
  catalog(): PluginCatalog {
    const state = this.installs.snapshot(); const safeMode = state.safeMode || this.forcedSafeMode || this.transitioningSafeMode || this.storageUnavailable;
    const plugins: ManagedPlugin[] = state.plugins.map(item => ({ id:item.manifest.id,version:item.manifest.version,fingerprint:item.fingerprint,
      enabled:item.enabled,readApproved:item.readApproved,source:'local',installedAt:item.installedAt,previousVersion:item.previous?.manifest.version,
      viewers:item.manifest.viewers,permissions:item.manifest.permissions,running:this.running.get(item.manifest.id)??0,
      blockedReason:this.operating.has(item.manifest.id)?'操作进行中':this.blocked.get(item.manifest.id)??(item.failure?'运行异常：'+item.failure:undefined)??(safeMode?'恢复模式阻止第三方运行':undefined) }));
    if(this.bundled) { const flags=state.bundled??{enabled:true,readApproved:true};plugins.unshift({id:this.bundled.manifest.id,version:this.bundled.manifest.version,fingerprint:this.bundled.fingerprint,
      ...flags,source:'bundled',installedAt:'随应用提供',viewers:this.bundled.manifest.viewers,permissions:this.bundled.manifest.permissions,running:this.running.get(this.bundled.manifest.id)??0,
      blockedReason:this.operating.has(this.bundled.manifest.id)?'操作进行中':this.blocked.get(this.bundled.manifest.id)??(flags.failure?'运行异常：'+flags.failure:undefined)}); }
    return { revision:this.revision,safeMode,settingsRecoveryRequired:this.settings.needsRecovery,recoveryReason:this.forcedSafeMode?'启动参数强制禁用第三方，移除参数并重启后才能解除。':this.installs.recoveryReason,plugins,logs:structuredClone(this.logs) };
  }
  resolve(viewerId: string) {
    const plugin=this.catalog().plugins.find(item=>item.viewers.some(viewer=>viewer.id===viewerId));
    if(!plugin||!plugin.enabled||plugin.blockedReason||(plugin.permissions.includes('resource.read')&&!plugin.readApproved)) throw new Error('PLUGIN_BLOCKED');
    return { plugin, directory:plugin.source==='bundled'?this.bundledDirectory:this.installs.directory(plugin.fingerprint) };
  }
  stillAllowed(viewerId: string, fingerprint: string) { try{return this.resolve(viewerId).plugin.fingerprint===fingerprint;}catch{return false;} }
  async prepare(source: string): Promise<PluginInstallReview> { try {const review=await this.installs.prepare(source);this.record('prepare','OK',review.id);return review;}catch(error){this.record('prepare','PACKAGE_REJECTED');throw error;} }
  discard(ticket:string) {return this.installs.discard(ticket);}
  async commit(ticket:string) {
    const id = this.installs.review(ticket).id;
    if (this.operating.has(id)) throw new Error('PLUGIN_BUSY');
    this.operating.add(id); this.changed(); this.stop(id);
    try {await this.installs.commit(ticket,id=>this.stop(id));this.blocked.delete(id);this.record('install','OK',id);}
    catch(error){this.record('install','INSTALL_FAILED',id);throw error;}
    finally{this.operating.delete(id);this.changed();}
    return this.catalog();
  }
  async action(id:string,action:PluginManagementAction) {
    if(this.operating.has(id))throw new Error('PLUGIN_BUSY');this.operating.add(id);this.changed();this.stop(id);
    try {
      if(action==='clear-data')await this.settings.clearPlugin(id);
      else if(id==='example.csv')await this.installs.setBundled(action,value=>this.stop(value));
      else await this.installs.action(id,action,value=>this.stop(value));
      if(action==='enable'||action==='rollback'||action==='uninstall')this.blocked.delete(id);
      this.record(action,'OK',id);
    }catch(error){this.record(action,'ACTION_FAILED',id);throw error;}
    finally{this.operating.delete(id);this.changed();}
    return this.catalog();
  }
  async safeMode(enabled:boolean) { if(!enabled&&this.forcedSafeMode)throw new Error('STARTUP_SAFE_MODE');this.transitioningSafeMode=true;this.changed();try{await this.installs.setSafeMode(enabled,()=>{for(const p of this.catalog().plugins)if(p.source==='local')this.stop(p.id);});this.record('safe-mode',enabled?'ENABLED':'DISABLED');}finally{this.transitioningSafeMode=false;this.changed();}return this.catalog(); }
  requestFailed(pluginId:string,event:{instanceId:string;code?:string;method?:string;requestTag?:string}) {
    if(Date.now()-this.lastRequestLog<1000)return;this.lastRequestLog=Date.now();
    this.logs.push({time:new Date().toISOString(),pluginId,action:event.method??'rpc',code:event.code??'INTERNAL',instanceId:event.instanceId,requestTag:event.requestTag});if(this.logs.length>128)this.logs.shift();this.changed();
  }
  async repairSettings() {this.stop();await this.settings.backupAndReset();this.record('settings-recovery','OK');return this.catalog();}
  started(id:string) {this.running.set(id,(this.running.get(id)??0)+1);this.changed();}
  stopped(id:string,reason:string,counted=true) {const count = Math.max(0,(this.running.get(id)??0)-(counted?1:0)); if(count)this.running.set(id,count);else this.running.delete(id);if(['memory-budget','cpu-budget','heartbeat-timeout','startup-timeout','renderer-gone','child-frame-denied','file-picker-denied','debugger-detached'].includes(reason)){this.blocked.set(id,'插件已因运行故障被隔离，请检查日志后重新启用。');this.stop(id);void this.installs.recordFailure(id,reason).then(()=>this.changed(),()=>this.record('quarantine','PERSIST_FAILED',id));}this.record('stopped',reason,id);}
}
