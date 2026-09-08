const MAX_LIBRARY_PATH_BYTES = 2_048;
const MAX_LIBRARY_PATH_SEGMENT_BYTES = 512;

const encoder = new TextEncoder();

function utf8Length(value: string): number {
  return encoder.encode(value).byteLength;
}

export function normalizeAgentLibraryDirectoryPath(input: unknown): string {
  if (typeof input !== 'string') throw new Error('资料库目录路径无效');
  const normalized = input.trim();
  if (
    !normalized
    || !normalized.startsWith('/')
    || normalized.includes('\\')
    || utf8Length(normalized) > MAX_LIBRARY_PATH_BYTES
    || Array.from(normalized).some(character => character.charCodeAt(0) < 32)
  ) {
    throw new Error('资料库目录路径无效');
  }
  if (normalized === '/') return normalized;
  const segments = normalized.slice(1).split('/');
  if (segments.some(segment => (
    !segment
    || segment === '.'
    || segment === '..'
    || utf8Length(segment) > MAX_LIBRARY_PATH_SEGMENT_BYTES
  ))) {
    throw new Error('资料库目录路径无效');
  }
  return `/${segments.join('/')}`;
}

export function splitAgentLibraryDirectoryPath(input: unknown): readonly string[] {
  const normalized = normalizeAgentLibraryDirectoryPath(input);
  return normalized === '/' ? Object.freeze([]) : Object.freeze(normalized.slice(1).split('/'));
}

export const AGENT_LIBRARY_DIRECTORY_PATH_MAX_BYTES = MAX_LIBRARY_PATH_BYTES;
