import { isThemeRecord } from './color-theme';

const DIRECTORY_TYPES = ['DEF', 'COMIC', 'ASMR', 'VIDEO', 'AUDIO', 'GALLERY'] as const;
type DirectoryType = typeof DIRECTORY_TYPES[number];
export interface DirectoryIconSemantic {
  readonly key: string;
  readonly expanded: boolean;
  readonly warnings: readonly ('unknown-type' | 'invalid-default-archive')[];
}
export function resolveDirectoryIconSemantic(input: { builtInType?: string; archiveMode?: number; expanded?: boolean }): DirectoryIconSemantic {
  const type = String(input.builtInType || 'DEF').toUpperCase();
  const archived = Number(input.archiveMode ?? 0) === 1;
  const known = DIRECTORY_TYPES.includes(type as DirectoryType);
  const warnings: Array<'unknown-type' | 'invalid-default-archive'> = [];
  if (!known) warnings.push('unknown-type');
  if (type === 'DEF' && archived) warnings.push('invalid-default-archive');
  return Object.freeze({ key: known ? `folder.${type.toLowerCase()}${archived && type !== 'DEF' ? '.archive' : ''}` : 'folder.unknown', expanded: Boolean(input.expanded), warnings: Object.freeze(warnings) });
}

export interface IconAssetPair { readonly closed: string; readonly open?: string }
export interface IconTheme {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly icons: Readonly<Record<string, IconAssetPair>>;
}

// Lexical package-relative path validation only. Installation must still inspect bytes,
// symlinks, MIME, SVG scripts/external references and actual containment on disk.
export function isIconAssetPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 240 || !/^[A-Za-z0-9_./-]+\.(svg|png|webp)$/.test(value)) return false;
  return value.split('/').every(segment => Boolean(segment) && !segment.endsWith('.')
    && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment));
}
export function validateIconTheme(input: unknown): { value: IconTheme | null; errors: readonly string[] } {
  if (!isThemeRecord(input) || input.schemaVersion !== 1 || typeof input.id !== 'string' || input.id.length > 128
    || !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(input.id) || !isThemeRecord(input.icons)
    || Object.keys(input).some(key => !['schemaVersion', 'id', 'icons'].includes(key)) || Object.keys(input.icons).length > 512) return { value: null, errors: ['Invalid icon theme envelope'] };
  const icons: Record<string, IconAssetPair> = Object.create(null);
  const errors: string[] = [];
  for (const [key, pair] of Object.entries(input.icons)) {
    if (key.length > 128 || !/^(folder|file)\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(key) || !isThemeRecord(pair)
      || Object.keys(pair).some(field => field !== 'closed' && field !== 'open') || !isIconAssetPath(pair.closed)
      || (pair.open !== undefined && !isIconAssetPath(pair.open))) {
      errors.push(`Invalid icon entry: ${key.slice(0, 128)}`);
    } else icons[key] = Object.freeze({ closed: pair.closed, ...(pair.open === undefined ? {} : { open: pair.open }) });
  }
  return { value: errors.length ? null : Object.freeze({ schemaVersion: 1, id: input.id, icons: Object.freeze(icons) }), errors: Object.freeze(errors) };
}
export interface IconCandidate {
  readonly source: 'node' | 'association' | 'theme' | 'provider' | 'core';
  readonly packageId: string;
  readonly asset: IconAssetPair;
}
const PRIORITY: readonly IconCandidate['source'][] = ['node', 'association', 'theme', 'provider', 'core'];

// Inputs come from validated packages and host association matching, never a callback per tree node.
// Required decorations are projected from host facts, independently of the chosen asset.
export function selectIconAsset(input: {
  expanded: boolean;
  candidates: readonly IconCandidate[];
  requiredDecorations: readonly ('error' | 'offline' | 'unknown-type' | 'invalid-default-archive')[];
}) {
  for (const source of PRIORITY) {
    const matches = input.candidates.filter(candidate => candidate.source === source);
    if (matches.length > 1) throw new Error(`Ambiguous icon candidates at ${source}`);
    const candidate = matches[0];
    if (!candidate) continue;
    if (!isIconAssetPath(candidate.asset.closed) || (candidate.asset.open !== undefined && !isIconAssetPath(candidate.asset.open))) throw new Error('Unvalidated icon asset');
    return Object.freeze({ packageId: candidate.packageId, source, path: input.expanded ? candidate.asset.open ?? candidate.asset.closed : candidate.asset.closed,
      decorations: Object.freeze([...new Set(input.requiredDecorations)]) });
  }
  return Object.freeze({ packageId: null, source: 'core' as const, path: null, decorations: Object.freeze([...new Set(input.requiredDecorations)]) });
}
