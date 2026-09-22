import { dialog, ipcMain, type BrowserWindow } from 'electron';
import type { PluginManager } from './plugin-manager';
import type { PluginManagementAction } from '../../../src/shared/plugin-management';
export function registerPluginManagementIpc(manager: PluginManager,getMainWindow:()=>BrowserWindow|null) {
  const bind=(name:string,handler:(...args:any[])=>unknown)=>ipcMain.handle(`plugin-management:${name}`,async(event,...args)=>{
    const parent=getMainWindow();if(!parent||event.sender!==parent.webContents||event.senderFrame!==parent.webContents.mainFrame)throw new Error('插件管理来源无效');
    try{return await handler(...args);}catch(error){
      const code=error instanceof Error?error.message:'';
      const messages:Record<string,string>={VERSION_NOT_NEWER:'更新版本必须高于已安装版本。',RESERVED_PLUGIN_ID:'此 ID 由应用保留，不能覆盖。',PREPARATION_EXPIRED:'安装预检已过期，请重新选择文件。',INSTALL_CONFLICT:'插件版本已变化，请重新预检。',BUNDLED_PACKAGE:'随应用提供的包不能卸载或回滚。',PLUGIN_BUSY:'插件操作正在进行，请稍后重试。',STARTUP_SAFE_MODE:'当前启动参数禁止解除恢复模式。',NO_PREVIOUS_VERSION:'没有可回滚的版本。'};
      throw new Error(messages[code]??'插件操作失败：包不兼容、校验失败或本机存储不可用。原有版本和用户文件不会被覆盖。');
    }
  });
  manager.subscribe(catalog=>{const parent=getMainWindow();if(parent&&!parent.isDestroyed())parent.webContents.send('plugin-management:changed',catalog);});
  bind('repair-settings',()=>manager.repairSettings());
  bind('catalog',()=>manager.catalog());
  bind('choose',async()=>{const parent=getMainWindow()!;const result=await dialog.showOpenDialog(parent,{title:'选择 OmniFlow 插件包',properties:['openFile'],filters:[{name:'OmniFlow 插件 ZIP',extensions:['zip']}]});if(result.canceled||result.filePaths.length!==1)return null;return manager.prepare(result.filePaths[0]);});
  bind('commit',(ticket:string)=>manager.commit(ticket));bind('discard',(ticket:string)=>manager.discard(ticket));
  bind('action',(id:string,action:PluginManagementAction)=>{if(typeof id!=='string'||id.length>128||!['enable','disable','approve-read','revoke-read','approve-tools','revoke-tools','approve-rename','revoke-rename','approve-output','revoke-output','uninstall','rollback','clear-data'].includes(action))throw new Error('INVALID_ACTION');return manager.action(id,action);});
  bind('safe-mode',(enabled:boolean)=>{if(typeof enabled!=='boolean')throw new Error('INVALID_INPUT');return manager.safeMode(enabled);});
}
