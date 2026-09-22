import Ajv from 'ajv';
import { lstat, opendir, open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import schema from '../../../packages/plugin-sdk/manifest.schema.json';
import { LIMITS } from '../../../packages/plugin-sdk/index.js';
import { validateIconSvg } from '../../../src/features/appearance/svg-assets';
import type { PluginToolContribution } from '../../../packages/plugin-sdk/index.js';
import { validateToolContribution } from './tool-schema';
export type { PluginToolContribution, PluginToolSchema } from '../../../packages/plugin-sdk/index.js';

export interface PluginManifest {
  formatVersion: 1 | 2; id: string; version: string; sdkVersion: 1; minHostVersion: string;
  platforms: Array<'darwin' | 'win32' | 'linux'>; entry?: string;
  activation: string[]; permissions: Array<'resource.read' | 'directory.read' | 'agent.tools' | 'resource.rename.propose' | 'resource.output.propose'>;
  viewers: Array<{ id: string; title: string; extensions: string[]; directoryTypes?: Array<'COMIC'> }>;
  agentTools?: PluginToolContribution[];
}
const validate = new Ajv({ allErrors: true }).compile<PluginManifest>(schema);
export function isPackagePath(value: string): boolean {
  return value.length <= 200 && /^[A-Za-z0-9_./-]+$/.test(value) && value.split('/').every(segment =>
    Boolean(segment) && !segment.endsWith('.') && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment));
}
export function parsePluginManifest(input: unknown, platform: string, hostVersion = '0.2.2'): PluginManifest {
  if (!validate(input)) throw new Error('Invalid plugin manifest');
  if (!input.platforms.some(item => item === platform) || (input.entry !== undefined && (!isPackagePath(input.entry) || !input.entry.endsWith('.html')))) throw new Error('Unsupported plugin platform or entry');
  const min = input.minHostVersion.split('.').map(Number); const host = hostVersion.split('.').map(Number);
  const comparison = min.map((value, index) => value - host[index]).find(value => value !== 0) ?? 0;
  if (comparison > 0) throw new Error('Incompatible host version');
  const ids = new Set<string>(); const activation = new Set<string>();
  for (const viewer of input.viewers ?? []) {
    if (!viewer.id.startsWith(`${input.id}.`) || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(viewer.id) || ids.has(viewer.id)) throw new Error('Invalid or duplicate viewer id');
    if (viewer.directoryTypes && (!input.permissions.includes('directory.read') || !input.permissions.includes('resource.read'))) throw new Error('Directory viewer requires read permissions');
    ids.add(viewer.id);
    activation.add(`viewer:${viewer.id}`);
  }
  for (const tool of input.agentTools ?? []) {
    if (!tool.id.startsWith(`${input.id}.`) || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(tool.id) || ids.has(tool.id)) throw new Error('Invalid or duplicate tool id');
    if (!isPackagePath(tool.entry) || !tool.entry.endsWith('.html')) throw new Error('Invalid tool entry');
    if (tool.kind === 'rename-proposal') {
      if (!input.permissions.includes('agent.tools') || !input.permissions.includes('resource.rename.propose')
        || input.permissions.includes('resource.read') || input.permissions.includes('directory.read') || input.viewers?.length) throw new Error('Proposal Tool requires metadata-only permissions');
    } else if (!input.permissions.includes('agent.tools') || !input.permissions.includes('resource.read') || input.permissions.includes('directory.read')) throw new Error('Tool requires single-file read permissions');
    if (tool.kind === 'file-output' && !input.permissions.includes('resource.output.propose')) throw new Error('File output requires independent proposal permission');
    validateToolContribution(tool);
    ids.add(tool.id); activation.add(`tool:${tool.id}`);
  }
  if (input.permissions.includes('agent.tools') && !input.agentTools?.length) throw new Error('Tool permission requires a tool contribution');
  if (input.permissions.includes('resource.rename.propose') && !input.agentTools?.some(tool => tool.kind === 'rename-proposal')) throw new Error('Proposal permission requires a proposal contribution');
  if (input.permissions.includes('resource.output.propose') && !input.agentTools?.some(tool => tool.kind === 'file-output')) throw new Error('Output permission requires an output contribution');
  if (input.activation.length !== activation.size || input.activation.some(event => !activation.has(event))) throw new Error('Invalid activation conditions');
  return { ...structuredClone(input), viewers: structuredClone(input.viewers ?? []) };
}
export interface LoadedPluginPackage { source: string; fingerprint: string; manifest: PluginManifest; assets: ReadonlyMap<string, { bytes: Buffer; mime: string }> }
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
export async function loadPluginPackage(directory: string, platform = process.platform): Promise<LoadedPluginPackage> {
  const root = path.resolve(directory);
  if (!(await lstat(root)).isDirectory() || (await lstat(root)).isSymbolicLink()) throw new Error('Plugin root must be a real directory');
  const assets = new Map<string, { bytes: Buffer; mime: string }>();
  let total = 0; let entries = 0;
  async function boundedRead(file: string, maxBytes: number): Promise<Buffer> {
    if (!((await realpath(file)).startsWith(`${await realpath(root)}${path.sep}`))) throw new Error('Asset escaped package');
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size > maxBytes) throw new Error('Oversized package asset');
      const bytes = Buffer.alloc(maxBytes + 1);
      let size = 0;
      while (size < bytes.length) { const read = await handle.read(bytes, size, bytes.length - size, size); if (!read.bytesRead) break; size += read.bytesRead; }
      const after = await handle.stat();
      if (size > maxBytes || before.size !== size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('Package changed during loading');
      return Buffer.from(bytes.subarray(0, size));
    } finally { await handle.close(); }
  }
  const manifest = parsePluginManifest(JSON.parse((await boundedRead(path.join(root, 'manifest.json'), LIMITS.requestBytes)).toString('utf8')), platform);
  async function visit(relative: string, depth: number): Promise<void> {
    if (depth > 8) throw new Error('Plugin directory depth exceeded');
    for await (const entry of await opendir(path.join(root, relative))) {
      if (++entries > 128) throw new Error('Package entry limit exceeded');
      const name = entry.name;
      const key = relative ? `${relative}/${name}` : name;
      if (!isPackagePath(key)) throw new Error('Invalid package asset path');
      const file = path.join(root, ...key.split('/'));
      const stat = await lstat(file);
      if (stat.isSymbolicLink()) throw new Error('Package symlinks are not permitted');
      if (stat.isDirectory()) { await visit(key, depth + 1); continue; }
      const mime = MIME[path.extname(name)];
      if (!stat.isFile() || !mime || stat.size > LIMITS.packageFileBytes || assets.size >= LIMITS.packageFiles) throw new Error('Unsupported or oversized package asset');
      const bytes = await boundedRead(file, Math.min(LIMITS.packageFileBytes, LIMITS.packageBytes - total));
      total += bytes.length;
      if (bytes.length > LIMITS.packageFileBytes || total > LIMITS.packageBytes) throw new Error('Package byte limit exceeded');
      if (mime === 'image/svg+xml' && !validateIconSvg(bytes.toString('utf8'))) throw new Error('Unsafe SVG asset');
      assets.set(key, { bytes, mime });
    }
  }
  await visit('', 0);
  const manifestBytes = assets.get('manifest.json')?.bytes;
  if (!manifestBytes || manifestBytes.length > LIMITS.requestBytes) throw new Error('Missing or oversized manifest');
  if (JSON.stringify(parsePluginManifest(JSON.parse(manifestBytes.toString('utf8')), platform)) !== JSON.stringify(manifest)) throw new Error('Manifest changed during loading');
  if ((manifest.entry !== undefined && !assets.has(manifest.entry)) || manifest.agentTools?.some(tool => !assets.has(tool.entry))) throw new Error('Plugin entry not found');
  const source = await realpath(root);
  const hash = createHash('sha256').update('omniflow-package-v1\n');
  for (const [key, asset] of [...assets].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    hash.update(JSON.stringify([key, asset.bytes.length])); hash.update('\0'); hash.update(asset.bytes);
  }
  return { source, fingerprint: hash.digest('hex'), manifest, assets };
}
