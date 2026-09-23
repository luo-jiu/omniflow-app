import { ipcMain, type BrowserWindow } from 'electron';
import type { PluginCommandsBridge } from '../../../src/shared/plugins/manual-command.types';
import { createPluginCommandService } from './plugin-command-service';
import { PluginCommandStore } from './plugin-command-store';
import type { PluginManager } from './plugin-manager';

const API_BASE = typeof __OMNIFLOW_API_BASE_URL__ === 'string' ? __OMNIFLOW_API_BASE_URL__ : 'http://127.0.0.1:8850/api';
let service: ReturnType<typeof createPluginCommandService> | undefined;
const SAFE_ERRORS = new Set([
  '插件命令账号或资料库无效', '插件命令窗口已关闭', '插件命令记录已变化，请刷新后重试',
  '插件提案已经失效，请重新准备', '此操作尚不能查询回执', '当前登录凭据无效',
  '插件命令不存在', '请选择此命令支持的文件数量', '插件命令参数无效',
  '请选择输出目录和文件名', '正在执行的插件命令过多，请稍后再试',
  '操作记录已经变化', '当前窗口无权提交该 Agent 资料库文件授权',
]);
export function registerPluginCommandIpc(manager: PluginManager, getMainWindow: () => BrowserWindow | null, storePath: string) {
  try {
    service = createPluginCommandService({ manager, getMainWindow, store: new PluginCommandStore(storePath), apiBaseUrl: API_BASE });
  } catch {
    // A corrupt audit cannot be silently reset, nor disable the rest of the desktop.
    console.warn('[plugin-commands] history unavailable; manual execution disabled');
  }
  const tracked = new Set<number>();
  const bind = <K extends Exclude<keyof PluginCommandsBridge, 'subscribe' | 'onFileAuthorityRequest'>>(name: K, channel: string) => {
    ipcMain.handle(`plugin-commands:${channel}`, async (event, input: Parameters<PluginCommandsBridge[K]>[0]) => {
      const parent = getMainWindow();
      if (!parent || event.sender !== parent.webContents || event.senderFrame !== parent.webContents.mainFrame) throw new Error('插件命令来源无效');
      if (!service) throw new Error('插件命令历史存储不可用，已暂停手动执行；请检查本机存储后重启。');
      if (!tracked.has(event.sender.id)) {
        tracked.add(event.sender.id); const senderId = event.sender.id;
        event.sender.once('destroyed', () => { service?.releaseOwner(senderId); tracked.delete(senderId); });
        event.sender.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
          if (isMainFrame && !isInPlace) service?.releaseOwner(senderId);
        });
      }
      try {
        return await (service[name] as (sender: Electron.WebContents, input: unknown) => unknown)(event.sender, input);
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        throw new Error(SAFE_ERRORS.has(message) ? message : '插件命令操作失败，请检查文件、参数、登录状态和本机存储后重试；已提交的操作请查询原回执。');
      }
    });
  };
  bind('prepare', 'prepare'); bind('approve', 'approve'); bind('cancel', 'cancel'); bind('list', 'list');
  bind('reconcile', 'reconcile'); bind('release', 'release'); bind('completeFileAuthority', 'file-authority:complete');
}
export function disposePluginCommandService() { service?.dispose(); service = undefined; }
