import { mkdir, readFile, writeFile, rename, rm, lstat, readdir, chmod } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { extractPluginZip } from './plugin-zip';
import { loadPluginPackage, parsePluginManifest, type PluginManifest, type LoadedPluginPackage } from './manifest';
import { assertPluginToolNames } from './plugin-tool-catalog';
import type { PluginInstallReview, PluginManagementAction } from '../../../src/shared/plugin-management';

type Version = { manifest: PluginManifest; fingerprint: string };
export type InstalledPlugin = Version & { enabled: boolean; readApproved: boolean; toolApproved: boolean; renameApproved: boolean; outputApproved: boolean; installedAt: string; failure?: string; previous?: Version };
type Index = { schemaVersion: 1; safeMode: boolean; recoveryPackages?: string[]; bundled?: { enabled: boolean; readApproved: boolean; toolApproved: boolean; toolFingerprint?: string; renameApproved?: boolean; renameFingerprint?: string; outputApproved?: boolean; outputFingerprint?: string; failure?: string }; plugins: InstalledPlugin[] };
const MAX_INDEX_BYTES = 2 * 1024 * 1024;
const empty = (): Index => ({ schemaVersion: 1, safeMode: false, plugins: [] });
const fingerprintValid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function newer(a: string, b: string) { return a.split('.').map((part, index) => Number(part) - Number(b.split('.')[index])).find(delta => delta !== 0) ?? 0; }
function assertCommandIds(manifests: readonly PluginManifest[], reservedToolNames: readonly string[] = []) {
  const ids = new Set(['example.csv.table', ...reservedToolNames, ...manifests.flatMap(manifest => [
    ...manifest.viewers.map(viewer => viewer.id), ...(manifest.agentTools ?? []).map(tool => tool.id),
  ])]);
  for (const command of manifests.flatMap(manifest => manifest.commands ?? [])) {
    if (ids.has(command.id)) throw new Error('DUPLICATE_COMMAND_ID');
    ids.add(command.id);
  }
  for (const workspace of manifests.flatMap(manifest => manifest.workspaces ?? [])) {
    if (ids.has(workspace.id)) throw new Error('DUPLICATE_WORKSPACE_ID');
    ids.add(workspace.id);
  }
}
export class PluginInstallStore {
  private state = empty(); private ready = false;
  private pending = new Map<string, { root: string; package: LoadedPluginPackage; expected: string | null; expires: number; review: PluginInstallReview }>();
  private reservedToolNames: readonly string[] = [];
  private tail: Promise<unknown> = Promise.resolve();
  recoveryReason: string | undefined;
  constructor(readonly root: string, private platform = process.platform, private replaceIndex: typeof rename = rename) {}
  async initialize() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    if ((await lstat(this.root)).isSymbolicLink()) throw new Error('INVALID_INSTALL_ROOT');
    await mkdir(path.join(this.root, 'packages'), { recursive: true, mode: 0o700 });
    await mkdir(path.join(this.root, 'staging'), { recursive: true, mode: 0o700 });
    for (const name of ['packages', 'staging']) { const stat = await lstat(path.join(this.root,name)); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('INVALID_INSTALL_ROOT'); }
    // 每个 staging 都由本宿主生成 UUID；正常启动清理中断的准备事务。
    for (const name of await readdir(path.join(this.root, 'staging'))) if (/^[a-f0-9-]{36}$/.test(name)) await rm(path.join(this.root, 'staging', name), { recursive: true, force: true });
    try {
      const file = path.join(this.root, 'index.json'); const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_INDEX_BYTES) throw new Error('INVALID_INDEX');
      const input = JSON.parse(await readFile(file, 'utf8')) as Index;
      if (input.schemaVersion !== 1 || typeof input.safeMode !== 'boolean' || !Array.isArray(input.plugins) || input.plugins.length > 32) throw new Error('INVALID_INDEX');
      if (input.bundled && (typeof input.bundled.enabled !== 'boolean' || typeof input.bundled.readApproved !== 'boolean' || (input.bundled.toolApproved !== undefined && typeof input.bundled.toolApproved !== 'boolean') || (input.bundled.toolFingerprint !== undefined && !fingerprintValid(input.bundled.toolFingerprint)) || (input.bundled.renameApproved !== undefined && typeof input.bundled.renameApproved !== 'boolean') || (input.bundled.renameFingerprint !== undefined && !fingerprintValid(input.bundled.renameFingerprint)) || (input.bundled.outputApproved !== undefined && typeof input.bundled.outputApproved !== 'boolean') || (input.bundled.outputFingerprint !== undefined && !fingerprintValid(input.bundled.outputFingerprint)))) throw new Error('INVALID_INDEX');
      if (input.recoveryPackages && (!Array.isArray(input.recoveryPackages) || input.recoveryPackages.length > 66 || input.recoveryPackages.some(value => !fingerprintValid(value)))) throw new Error('INVALID_INDEX');
      if (input.bundled) { input.bundled.toolApproved ??= false; input.bundled.renameApproved ??= false; input.bundled.outputApproved ??= false; }
      const ids = new Set<string>(); const viewerIds = new Set<string>(['example.csv.table']);
      for (const item of input.plugins) {
        item.manifest = parsePluginManifest(item.manifest, this.platform);
        if (ids.has(item.manifest.id) || (item.manifest.id === 'example.csv' || item.manifest.id === 'omniflow' || item.manifest.id.startsWith('omniflow.')) || !fingerprintValid(item.fingerprint) || typeof item.enabled !== 'boolean' || typeof item.readApproved !== 'boolean' || (item.toolApproved !== undefined && typeof item.toolApproved !== 'boolean') || (item.renameApproved !== undefined && typeof item.renameApproved !== 'boolean') || (item.outputApproved !== undefined && typeof item.outputApproved !== 'boolean') || typeof item.installedAt !== 'string') throw new Error('INVALID_INDEX');
        item.toolApproved ??= false; item.renameApproved ??= false; item.outputApproved ??= false;
        ids.add(item.manifest.id);
        for(const viewer of item.manifest.viewers){if(viewerIds.has(viewer.id))throw new Error('DUPLICATE_VIEWER_ID');viewerIds.add(viewer.id);}
        if (item.previous) {
          item.previous.manifest = parsePluginManifest(item.previous.manifest, this.platform);
          if (!fingerprintValid(item.previous.fingerprint) || item.previous.manifest.id !== item.manifest.id) throw new Error('INVALID_INDEX');
        }
      }
      assertPluginToolNames(input.plugins.flatMap(item => item.manifest.agentTools ?? []));
      assertCommandIds(input.plugins.map(item => item.manifest));
      this.state = input;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) { this.state = { ...empty(), safeMode: true, recoveryPackages: (await readdir(path.join(this.root,'packages'))).filter(fingerprintValid).slice(0,66) }; this.recoveryReason = '安装记录损坏，已阻止第三方运行。原包和数据保留，可重新安装。'; }
    }
    this.ready = true;
  }
  setReservedToolNames(names: readonly string[]) { this.reservedToolNames = [...names]; }
  review(ticket: string) { const item = this.pending.get(ticket); if (!item || item.expires < Date.now()) throw new Error('PREPARATION_EXPIRED'); return structuredClone(item.review); }
  snapshot() { return structuredClone(this.state); }
  directory(fingerprint: string) { if (!fingerprintValid(fingerprint)) throw new Error('INVALID_FINGERPRINT'); return path.join(this.root, 'packages', fingerprint); }
  private checkContributionIds(manifest: PluginManifest) { const ids = new Set(['example.csv.table', ...this.state.plugins.filter(item => item.manifest.id !== manifest.id).flatMap(item => item.manifest.viewers.map(viewer => viewer.id))]); if(manifest.viewers.some(viewer => ids.has(viewer.id)))throw new Error('DUPLICATE_VIEWER_ID');
    assertPluginToolNames([...this.state.plugins.filter(item => item.manifest.id !== manifest.id).flatMap(item => item.manifest.agentTools ?? []), ...(manifest.agentTools ?? [])], this.reservedToolNames);
    assertCommandIds([...this.state.plugins.filter(item => item.manifest.id !== manifest.id).map(item => item.manifest), manifest], this.reservedToolNames);
  }
  async verify(item: Version) { const loaded = await loadPluginPackage(this.directory(item.fingerprint), this.platform); if (loaded.fingerprint !== item.fingerprint || JSON.stringify(loaded.manifest) !== JSON.stringify(item.manifest)) throw new Error('INTEGRITY_FAILED'); return loaded; }
  private serial<T>(action: () => Promise<T>): Promise<T> { if (!this.ready) return Promise.reject(new Error('STORE_UNAVAILABLE')); const next = this.tail.then(action, action); this.tail = next.catch(() => undefined); return next; }
  private async save(next: Index) {
    const serialized = JSON.stringify(next);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_INDEX_BYTES) throw new Error('INSTALL_INDEX_LIMIT');
    const temporary = path.join(this.root, `index-${randomUUID()}.tmp`);
    try { await writeFile(temporary, serialized, { flag: 'wx', mode: 0o600 }); await this.replaceIndex(temporary, path.join(this.root, 'index.json')); this.state = next; }
    finally { await rm(temporary, { force: true }); }
  }
  async prepare(source: string): Promise<PluginInstallReview> { return this.serial(async () => {
    for (const [id, item] of this.pending) if (item.expires < Date.now()) await this.discardUnlocked(id);
    if (this.pending.size >= 2) throw new Error('PREPARATION_LIMIT');
    const ticket = randomUUID(); const root = path.join(this.root, 'staging', ticket);
    await mkdir(root, { mode: 0o700 });
    try {
      await extractPluginZip(source, root);
      const loaded = await loadPluginPackage(root, this.platform);
      if (loaded.manifest.id === 'example.csv' || loaded.manifest.id === 'omniflow' || loaded.manifest.id.startsWith('omniflow.')) throw new Error('RESERVED_PLUGIN_ID');
      this.checkContributionIds(loaded.manifest);
      const existing = this.state.plugins.find(item => item.manifest.id === loaded.manifest.id);
      if (existing && newer(loaded.manifest.version, existing.manifest.version) <= 0) throw new Error('VERSION_NOT_NEWER');
      if (!existing && this.state.plugins.length >= 32) throw new Error('INSTALL_LIMIT');
      const review: PluginInstallReview = { ticket, id: loaded.manifest.id, version: loaded.manifest.version, fingerprint: loaded.fingerprint, previousVersion: existing?.manifest.version,
        permissions: loaded.manifest.permissions, addedPermissions: loaded.manifest.permissions.filter(value => !existing?.manifest.permissions.includes(value)), fileName: path.basename(source).slice(0,128) };
      this.pending.set(ticket, { root, package: loaded, expected: existing?.fingerprint ?? null, expires: Date.now() + 300000, review }); return review;
    } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
  }); }
  discard(ticket: string) { return this.serial(() => this.discardUnlocked(ticket)); }
  private async discardUnlocked(ticket: string) { const pending = this.pending.get(ticket); if (!pending) return; this.pending.delete(ticket); await rm(pending.root, { recursive: true, force: true }); }
  async commit(ticket: string, stop: (id: string) => void): Promise<void> { return this.serial(async () => {
    const pending = this.pending.get(ticket); if (!pending || pending.expires < Date.now()) throw new Error('PREPARATION_EXPIRED');
    const loaded = await loadPluginPackage(pending.root, this.platform);
    if (loaded.fingerprint !== pending.package.fingerprint) throw new Error('STAGING_CHANGED');
    this.checkContributionIds(loaded.manifest);
    const current = this.state.plugins.find(item => item.manifest.id === loaded.manifest.id);
    if ((current?.fingerprint ?? null) !== pending.expected) throw new Error('INSTALL_CONFLICT');
    const existingPackages = await readdir(path.join(this.root, 'packages'));
    if (existingPackages.length >= 66 && !existingPackages.includes(loaded.fingerprint)) throw new Error('PACKAGE_STORAGE_LIMIT');
    stop(loaded.manifest.id);
    const destination = this.directory(loaded.fingerprint);
    try { await rename(pending.root, destination); }
    catch (error) { if (!(error instanceof Error && 'code' in error && ['EEXIST','ENOTEMPTY'].includes(String(error.code)))) throw error; await this.verify({ manifest: loaded.manifest, fingerprint: loaded.fingerprint }); }
    for (const name of loaded.assets.keys()) await chmod(path.join(destination, name), 0o400);
    const nextItem: InstalledPlugin = { manifest: loaded.manifest, fingerprint: loaded.fingerprint, installedAt: new Date().toISOString(), enabled: false, readApproved: false, toolApproved: false, renameApproved: false, outputApproved: false,
      ...(current ? { previous: { manifest: current.manifest, fingerprint: current.fingerprint } } : {}) };
    await this.save({ ...this.state, plugins: [...this.state.plugins.filter(item => item.manifest.id !== loaded.manifest.id), nextItem] });
    await this.discardUnlocked(ticket).catch(() => undefined);
    await this.collectUnused().catch(() => undefined);
  }); }
  async action(id: string, action: PluginManagementAction, stop: (id: string) => void) { return this.serial(async () => {
    const current = this.state.plugins.find(item => item.manifest.id === id); if (!current) throw new Error('PLUGIN_NOT_INSTALLED');
    const next = structuredClone(this.state); const item = next.plugins.find(value => value.manifest.id === id)!;
    stop(id);
    if (action === 'uninstall') next.plugins = next.plugins.filter(value => value.manifest.id !== id);
    else if (action === 'enable') { await this.verify(item); item.enabled = true; delete item.failure; }
    else if (action === 'disable') item.enabled = false;
    else if (action === 'approve-read') { if (!item.manifest.permissions.includes('resource.read')) throw new Error('CAPABILITY_NOT_DECLARED'); item.readApproved = true; }
    else if (action === 'revoke-read') item.readApproved = false;
    else if (action === 'approve-tools') { if (!item.manifest.permissions.includes('agent.tools') || !item.manifest.agentTools?.length) throw new Error('CAPABILITY_NOT_DECLARED'); item.toolApproved = true; }
    else if (action === 'revoke-tools') item.toolApproved = false;
    else if (action === 'approve-rename') { if (!item.manifest.permissions.includes('resource.rename.propose') || !item.manifest.agentTools?.some(tool => tool.kind === 'rename-proposal')) throw new Error('CAPABILITY_NOT_DECLARED'); item.renameApproved = true; }
    else if (action === 'revoke-rename') item.renameApproved = false;
    else if (action === 'approve-output') { if (!item.manifest.permissions.includes('resource.output.propose') || !item.manifest.agentTools?.some(tool => tool.kind === 'file-output')) throw new Error('CAPABILITY_NOT_DECLARED'); item.outputApproved = true; }
    else if (action === 'revoke-output') item.outputApproved = false;
    else if (action === 'rollback') {
      if (!item.previous) throw new Error('NO_PREVIOUS_VERSION'); this.checkContributionIds(item.previous.manifest); await this.verify(item.previous);
      const previous = item.previous; item.previous = { manifest: item.manifest, fingerprint: item.fingerprint }; item.manifest = previous.manifest; item.fingerprint = previous.fingerprint; item.enabled = false; item.readApproved = false; item.toolApproved = false; item.renameApproved = false; item.outputApproved = false; delete item.failure;
    } else throw new Error('INVALID_ACTION');
    await this.save(next); await this.collectUnused().catch(() => undefined);
  }); }
  async recordFailure(id: string, failure: string) { return this.serial(async () => {
    const next = structuredClone(this.state);
    if (id === 'example.csv') next.bundled = { ...(next.bundled ?? { readApproved:true, toolApproved:false }), enabled:false, failure };
    else { const item = next.plugins.find(value => value.manifest.id === id); if(!item)return; item.enabled=false;item.failure=failure; }
    await this.save(next);
  }); }
  async setBundled(action: PluginManagementAction, stop: (id: string) => void, fingerprint?: string) { return this.serial(async () => {
    const flags = { ...(this.state.bundled ?? { enabled: true, readApproved: true, toolApproved: false }) }; stop('example.csv');
    if (action === 'enable') { flags.enabled = true; delete flags.failure; } else if (action === 'disable') flags.enabled = false; else if (action === 'approve-read') flags.readApproved = true; else if (action === 'revoke-read') flags.readApproved = false; else if (action === 'approve-tools') { if (!fingerprintValid(fingerprint)) throw new Error('INVALID_FINGERPRINT'); flags.toolApproved = true; flags.toolFingerprint = fingerprint; } else if (action === 'revoke-tools') flags.toolApproved = false; else if (action === 'approve-rename') { if (!fingerprintValid(fingerprint)) throw new Error('INVALID_FINGERPRINT'); flags.renameApproved = true; flags.renameFingerprint = fingerprint; } else if (action === 'revoke-rename') flags.renameApproved = false; else if (action === 'approve-output') { if (!fingerprintValid(fingerprint)) throw new Error('INVALID_FINGERPRINT'); flags.outputApproved = true; flags.outputFingerprint = fingerprint; } else if (action === 'revoke-output') flags.outputApproved = false; else throw new Error('BUNDLED_PACKAGE');
    await this.save({ ...this.state, bundled: flags });
  }); }
  async setSafeMode(enabled: boolean, stopAll: () => void) { return this.serial(async () => { stopAll(); await this.save({ ...this.state, safeMode: enabled }); }); }
  private async collectUnused() {
    if (this.recoveryReason) return;
    const retained = new Set([...this.state.plugins.flatMap(item => [item.fingerprint, item.previous?.fingerprint]), ...(this.state.recoveryPackages ?? [])]);
    for (const name of await readdir(path.join(this.root, 'packages'))) if (fingerprintValid(name) && !retained.has(name)) await rm(this.directory(name), { recursive: true, force: true });
  }
}
