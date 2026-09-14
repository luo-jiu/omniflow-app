const { app, BrowserWindow, ipcMain, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const started = performance.now();
const directory = process.env.OMNIFLOW_BASELINE_RUN_DIR;
if (!directory || !path.isAbsolute(directory)) throw new Error('Isolated run directory required');
app.setPath('userData', path.join(directory, 'user-data'));
app.setPath('sessionData', path.join(directory, 'session-data'));
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('enable-precise-memory-info');
app.commandLine.appendSwitch('js-flags', '--expose-gc');
const preload = path.join(directory, 'preload.cjs');
fs.writeFileSync(preload, "const { contextBridge, ipcRenderer } = require('electron'); contextBridge.exposeInMainWorld('baseline', { cycles: " + (process.env.OMNI_BASELINE_CYCLES === '80' ? 80 : 10) + ", report: value => ipcRenderer.send('baseline:report', value) });");
const samples = [];
const cycles = [];
let phase = 'idle';
let window;
let ready;
let sampleTimer;
const timeout = setTimeout(() => { console.error('Baseline timeout'); app.exit(1); }, 60000);
function metrics() {
  const processes = app.getAppMetrics();
  return { processes: processes.map(item => ({ type: item.type, rssKiB: item.memory.workingSetSize })), phase, elapsedMs: performance.now() - started, processCount: processes.length,
    workingSetKiB: processes.reduce((sum, item) => sum + item.memory.workingSetSize, 0),
    cpuPercent: processes.reduce((sum, item) => sum + item.cpu.percentCPUUsage, 0) };
}
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('file:') && !details.url.startsWith('devtools:') }));
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window = new BrowserWindow({ width: 1120, height: 720, show: false, webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, zoomFactor: 1 } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('render-process-gone', () => app.exit(1));
  ipcMain.on('baseline:report', (event, value) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return;
    if (value.type === 'ready') {
      ready = { ...value, hostToReadyMs: performance.now() - started };
      console.log('BASELINE_READY');
      sampleTimer = setInterval(() => samples.push(metrics()), 1000);
    } else if (value.type === 'measuring') {
      phase = 'measuring';
    } else if (value.type === 'cycle') {
      cycles.push({ cycle: value.cycle, heapBytes: value.heapBytes, ...metrics() });
    } else if (value.type === 'result') {
      clearInterval(sampleTimer);
      clearTimeout(timeout);
      const result = { ready, result: value, samples, cycles, after: metrics(), electron: process.versions.electron, chrome: process.versions.chrome, platform: process.platform, arch: process.arch, viewport: window.getContentSize(), zoom: window.webContents.getZoomFactor(), visible: false };
      fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(result, null, 2));
      window.destroy();
      app.quit();
    } else if (value.type === 'error') { console.error(value.message); app.exit(1); }
  });
  await window.loadFile(process.env.OMNIFLOW_BASELINE_HTML);
}).catch(error => { console.error(error); app.exit(1); });
