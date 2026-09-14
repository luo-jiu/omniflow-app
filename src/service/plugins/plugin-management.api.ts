import type { PluginCatalog, PluginInstallReview, PluginManagementAction } from '@/shared/plugin-management';
let snapshot: PluginCatalog | null = null; let error = ''; let started = false; let stop: (() => void) | undefined;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
function accept(value: PluginCatalog) { if(snapshot && value.revision<snapshot.revision)return; snapshot=value;error='';emit(); }
const bridge = () => window.electronPluginManagement;
export const pluginManagementApi = {
  available: () => typeof window!=='undefined' && window.electronPluginViewer?.available===true && Boolean(window.electronPluginManagement),
  getSnapshot: () => snapshot,
  getError: () => error,
  subscribe: (listener:()=>void) => {listeners.add(listener);return ()=>{listeners.delete(listener);};},
  start() {if(started||!this.available())return;started=true;stop=bridge().subscribe(accept);void this.refresh();},
  async refresh() {try{accept(await bridge().catalog());}catch{error='无法读取插件状态，请重试。';emit();}},
  choose: ():Promise<PluginInstallReview|null> => bridge().choosePackage(),
  async commit(ticket:string) {accept(await bridge().commit(ticket));},
  discard: (ticket:string) => bridge().discard(ticket),
  async action(id:string,action:PluginManagementAction) {accept(await bridge().action(id,action));},
  async repairSettings() {accept(await bridge().repairSettings());},
  async safeMode(enabled:boolean) {accept(await bridge().safeMode(enabled));},
};
if(import.meta.hot)import.meta.hot.dispose(()=>{stop?.();listeners.clear();});
