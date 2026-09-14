import { app, BrowserWindow, Menu } from 'electron';
import { PluginDevelopmentHost, registerPluginScheme } from '../../electron/service/extensions/isolated-view.ts';
import path from 'node:path';
const work = process.env.OMNIFLOW_LAB_WORK;
app.setPath('userData', path.join(work, 'profile'));
registerPluginScheme();
void app.whenReady().then(async () => {
  const parent = new BrowserWindow({ title: 'OmniFlow C1 隔离实验', width: 1000, height: 720, webPreferences: { sandbox: true, contextIsolation: true } });
  await parent.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<body style="font:16px system-ui;background:#e8edf4;color:#142033"><h2>OmniFlow C1 隔离实验 · 仅合成数据</h2><p>从菜单「实验」授权、切换主题、暂停、重载和停止。此窗口不连接资料库。</p></body>'));
  const host = new PluginDevelopmentHost(parent, path.join(work, 'preload.cjs'));
  const bytes = Buffer.from('名称,内容\r\n主题测试,中文可读性\r\n安全文本,"<b>不会执行 HTML</b>"\r\n公式,=1+1\r\n');
  const resource = { accountScope: 'synthetic', libraryId: 3, nodeId: 999999, name: '合成样板.csv', size: bytes.length, revision: 'v1', authorize: async () => true, currentRevision: async () => 'v1', readRange: async (offset, length) => bytes.subarray(offset, offset + length) };
  let theme = { schemaVersion: 1, revision: 1, mode: 'light', colors: { 'surface.app': '#ffffff', 'text.primary': '#222222' } };
  let granted = false; let instance; let overlay;
  const load = async () => { instance?.stop('reload'); instance = await host.load(process.env.OMNIFLOW_LAB_SAMPLE, resource, theme, granted); };
  const safely = action => () => Promise.resolve().then(action).catch(error => console.error(String(error)));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'OmniFlow C1', submenu: [{ role: 'quit' }] },
    { label: '实验', submenu: [
      { label: '授权 / 撤销读取', click: () => { granted = !granted; instance?.broker.setReadGrant(granted); instance?.setActive(true); } },
      { label: '亮色 / 暗色', click: () => { const dark = theme.mode !== 'dark'; theme = { ...theme, revision: theme.revision + 1, mode: dark ? 'dark' : 'light', colors: { 'surface.app': dark ? '#17212f' : '#ffffff', 'text.primary': dark ? '#eeeeee' : '#222222' } }; instance?.setTheme(theme); } },
      { label: '暂停', click: () => instance?.setActive(false) }, { label: '恢复', click: () => instance?.setActive(true) },
      { label: '重新加载', click: safely(load) }, { label: '停止实例', click: () => instance?.stop('developer-stop') },
      { label: '宿主浮层实验', click: safely(async () => {
        overlay?.destroy();
        overlay = new BrowserWindow({ parent, modal: true, width: 500, height: 280, webPreferences: { sandbox: true, contextIsolation: true } });
        const currentOverlay = overlay;
        currentOverlay.webContents.on('before-input-event', (event, input) => {
          if (input.type === 'keyDown' && input.key === 'Escape') { event.preventDefault(); currentOverlay.close(); }
        });
        currentOverlay.once('closed', () => {
          if (parent.isDestroyed()) return;
          parent.focus();
          if (instance?.broker.alive && !instance.view.webContents.isDestroyed()) instance.view.webContents.focus();
        });
        await overlay.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<body style="font:18px system-ui;padding:20px"><h2>宿主浮层覆盖原生插件 View</h2><details><summary>展开嵌套内容</summary><input placeholder="输入并测试键盘焦点"></details><p>关闭此窗口返回插件。</p></body>'));
      }) },
      { label: '输出有界诊断', click: () => console.log(JSON.stringify(host.diagnostics)) },
    ] }, { label: '编辑', submenu: [{ role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
  ]));
  await load();
  parent.on('closed', () => app.quit());
});
