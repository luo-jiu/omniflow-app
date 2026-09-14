import { createElement, type ComponentType } from 'react';
import { viewerRegistry } from './viewer-registry';
import type { FileDispatcherProps } from './viewer.types';
import { pluginManagementApi } from '@/service/plugins/plugin-management.api';
export function installManagedViewerContributions(View:ComponentType<FileDispatcherProps>) {
  const installed=new Map<string,{signature:string;release:()=>void}>();
  const sync=()=>{
    const catalog=pluginManagementApi.getSnapshot();if(!catalog)return;
    const enabled=catalog.plugins.filter(item=>item.enabled&&!item.blockedReason&&(!item.permissions.includes('resource.read')||item.readApproved));
    for(const [id,item] of installed)if(!enabled.some(plugin=>plugin.id===id)){item.release();installed.delete(id);}
    for(const plugin of enabled){
      const signature=JSON.stringify([plugin.fingerprint,plugin.viewers]);if(installed.get(plugin.id)?.signature===signature)continue;
      installed.get(plugin.id)?.release();
      // 包改变时更换组件类型，让旧实例卸载；不能沿用旧的逐文件授权。
      const ManagedView=(props:FileDispatcherProps)=>createElement(View,props);
      const release=viewerRegistry.registerBatch(plugin.id,plugin.viewers.map(viewer=>({...viewer,title: `${viewer.title.slice(0,60)} · ${plugin.source === 'bundled' ? '随应用' : plugin.id.slice(0,60)}`,fileTypes:['text','image','pdf','other'],View:ManagedView})));
      installed.set(plugin.id,{signature,release});
    }
  };
  const unsubscribe=pluginManagementApi.subscribe(sync);pluginManagementApi.start();sync();
  return ()=>{unsubscribe();for(const item of installed.values())item.release();installed.clear();};
}
