import { readFile, readdir, lstat, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { PluginFault } from './resource-broker';
import { LIMITS, type Setting } from '../../../packages/plugin-sdk/index.js';
const MAX_BYTES = 4194304;
type State = Record<string, Record<string, Setting>>;
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
export class PluginSettingsStore {
  private state: State = Object.create(null); private tail: Promise<unknown> = Promise.resolve(); private corrupt = false; private usable = false;
  constructor(private root: string) {}
  async initialize() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const rootStat = await lstat(this.root); if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('INVALID_SETTINGS_ROOT');
    this.usable = true;
    try {
      const file = path.join(this.root, 'settings.json'); const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) throw new Error('Invalid settings');
      const raw = JSON.parse(await readFile(file, 'utf8'));
      if (raw.schemaVersion !== 1 || !raw.entries || typeof raw.entries !== 'object' || Array.isArray(raw.entries) || Object.keys(raw.entries).length > 256) throw new Error('Invalid settings');
      for (const [scope, values] of Object.entries(raw.entries)) {
        const identity=JSON.parse(scope);
        if (!Array.isArray(identity)||identity.length!==3||identity.some(value=>typeof value!=='string')||! /^[a-f0-9]{64}$/.test(identity[1])) throw new Error('Invalid namespace');
        if (scope.length > 512 || !values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length > LIMITS.settingsKeys || Buffer.byteLength(JSON.stringify(values)) > LIMITS.settingsTotalBytes) throw new Error('Invalid settings');
        for (const [key, setting] of Object.entries(values)) {
          if (!/^[a-z][a-z0-9.-]{0,63}$/.test(key) || !setting || !Number.isSafeInteger(setting.revision) || setting.revision < 1 || !Number.isSafeInteger(setting.schemaVersion) || setting.schemaVersion < 1 || Buffer.byteLength(JSON.stringify(setting.value)) > LIMITS.settingBytes) throw new Error('Invalid settings');
        }
      }
      this.state = raw.entries;
    } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) this.corrupt = true; }
  }
  get needsRecovery() { return this.corrupt; }
  async backupAndReset() { return this.serial(async () => {
    if (!this.usable) throw new PluginFault('UNAVAILABLE','Settings unavailable');
    if (!this.corrupt) return;
    if ((await readdir(this.root)).filter(name=>/^settings-corrupt-[a-f0-9-]+\.json$/.test(name)).length >= 3) throw new PluginFault('LIMIT','Backup limit');
    await rename(path.join(this.root,'settings.json'),path.join(this.root,`settings-corrupt-${randomUUID()}.json`));
    await this.save(Object.create(null));this.corrupt=false;
  }); }
  forPackage(id: string, fingerprint: string) {
    const scopeFor = (scope: string) => JSON.stringify([id, fingerprint, scope]);
    return {
      get: async (scope: string, key: string) => { await this.tail; if (this.corrupt || !this.usable) throw new PluginFault('UNAVAILABLE', 'Settings unavailable'); const items = this.state[scopeFor(scope)]; return items && own(items, key) ? structuredClone(items[key]) : null; },
      set: (scope: string, key: string, value: unknown, expectedRevision: number, schemaVersion: number) => this.serial(async () => {
        if (this.corrupt || !this.usable) throw new PluginFault('UNAVAILABLE', 'Settings unavailable');
        const scopeKey = scopeFor(scope); const current = this.state[scopeKey] ?? Object.create(null);
        if ((own(current, key) ? current[key].revision : 0) !== expectedRevision) throw new PluginFault('CONFLICT', 'Setting changed');
        if (Buffer.byteLength(JSON.stringify(value)) > LIMITS.settingBytes || (!own(current,key) && Object.keys(current).length >= LIMITS.settingsKeys)) throw new PluginFault('LIMIT','Settings limit');
        const next = { value: structuredClone(value), revision: expectedRevision + 1, schemaVersion };
        const items = { ...current, [key]: next };
        if (Buffer.byteLength(JSON.stringify(items)) > LIMITS.settingsTotalBytes) throw new PluginFault('LIMIT','Settings limit');
        await this.save({ ...this.state, [scopeKey]: items }); return next;
      }),
    };
  }
  async clearPlugin(id: string) { return this.serial(async () => { if (this.corrupt || !this.usable) throw new PluginFault('UNAVAILABLE', 'Settings unavailable'); const next: State = Object.create(null); for (const [scope, value] of Object.entries(this.state)) if (JSON.parse(scope)[0] !== id) next[scope] = value; await this.save(next); }); }
  private serial<T>(action: () => Promise<T>) { const next = this.tail.then(action, action); this.tail = next.catch(() => undefined); return next; }
  private async save(next: State) {
    const serialized = JSON.stringify({ schemaVersion: 1, entries: next });
    if (Object.keys(next).length > 256 || Buffer.byteLength(serialized) > MAX_BYTES) throw new PluginFault('LIMIT', 'Settings total limit');
    const temp = path.join(this.root, `settings-${randomUUID()}.tmp`);
    try { await writeFile(temp, serialized, { flag:'wx',mode:0o600 }); await rename(temp,path.join(this.root,'settings.json')); this.state = next; }
    finally { await rm(temp,{force:true}); }
  }
}
