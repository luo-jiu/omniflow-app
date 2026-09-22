import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const work = await mkdtemp(path.join(tmpdir(), 'omniflow-plugin-rename-lab-'));
const sample = JSON.parse(execFileSync(process.execPath, ['tools/plugin-isolation/build-independent.mjs', 'batch-rename'], { cwd: root, encoding: 'utf8' }));
execFileSync(process.execPath, ['pack.mjs'], { cwd: path.dirname(sample.packageDirectory), stdio: 'pipe' });
const entry = path.join(root, 'dist-electron', `rename-lab-${process.pid}.mjs`);
const bootstrap = path.join(work, 'bootstrap.cjs');
await build({ entryPoints: [path.join(root, 'tools/plugin-isolation/rename-lab.ts')], outfile: entry, bundle: true, platform: 'node', format: 'esm', packages: 'external', tsconfig: path.join(root, 'tsconfig.json'),
  banner: { js: "import { createRequire as createLabRequire } from 'node:module'; const require = createLabRequire(import.meta.url);" } });
await build({ entryPoints: [path.join(root, 'electron/service/extensions/plugin-preload.ts')], outfile: path.join(work, 'plugin-preload.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
await writeFile(bootstrap, `const {app,protocol}=require('electron');app.setName('OmniFlow Plugin Rename Lab');app.setPath('userData',${JSON.stringify(path.join(work, 'profile'))});protocol.registerSchemesAsPrivileged([{scheme:'omniflow-extension',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);import(${JSON.stringify(pathToFileURL(entry).href)}).catch(error=>{console.error('RENAME_RESULT='+JSON.stringify({passed:false,error:String(error.message).slice(0,500)}));app.exit(1)});`);
const selectedCases = process.argv.find(argument => argument.startsWith('--cases='))?.slice('--cases='.length);
const env = { ...process.env, OMNIFLOW_RENAME_WORK: work, OMNIFLOW_RENAME_PACKAGE: path.join(path.dirname(sample.packageDirectory), 'plugin.zip'),
  ...(selectedCases ? { OMNIFLOW_RENAME_CASES: selectedCases } : {}) };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(createRequire(import.meta.url)('electron'), [bootstrap], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
const timer = setTimeout(() => child.kill('SIGTERM'), 150000);
const code = await new Promise(resolve => child.once('exit', resolve)); clearTimeout(timer);
await writeFile(path.join(work, 'run.log'), output); await rm(entry, { force: true });
const results = output.split('\n').filter(line => line.startsWith('RENAME_RESULT='));
results.forEach(line => console.log(line)); console.log(JSON.stringify({ work, sampleWork: sample.work, code }));
process.exitCode = code === 0 && results.some(line => JSON.parse(line.slice('RENAME_RESULT='.length)).passed === true) ? 0 : 1;
