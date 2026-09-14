import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const started = performance.now();
const directory = process.env.OMNI_BASELINE_DIR;
if (!directory || !path.isAbsolute(directory)) throw new Error('Isolated appData is required');
app.setPath('appData', directory);
const samples = [];
let recorded = false;
const timeout = setTimeout(() => app.exit(1), 60000);
app.on('web-contents-created', (_event, contents) => {
  contents.on('did-finish-load', () => {
    if (recorded || !new URL(contents.getURL()).pathname.endsWith('/index.html')) return;
    recorded = true;
    const readyMs = performance.now() - started;
    const timer = setInterval(() => {
      samples.push(app.getAppMetrics().map(item => ({ type: item.type, rssKiB: item.memory.workingSetSize, cpu: item.cpu.percentCPUUsage })));
      if (samples.length === 5) {
        clearInterval(timer);
        clearTimeout(timeout);
        fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify({ readyMs, samples, electron: process.versions.electron,
          scope: 'Actual compiled application, fresh appData/userData, logged-out document load. Excludes process spawn and is not an interactive-ready measurement. No login or library access.' }));
        app.quit();
      }
    }, 1000);
  });
});
// ESM top-level await prevents Electron becoming ready before scheme registration.
await import(process.env.OMNI_MAIN_ENTRY).catch(error => { console.error(error); app.exit(1); });
