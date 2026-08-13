export const AMBIGUOUS_EXTENSIONS = new Set([
  'ts',
  'm4a',
  'ass',
  'h',
  's',
  'bin',
  'dat',
]);

export function isAmbiguousExtension(ext?: string | null): boolean {
  return AMBIGUOUS_EXTENSIONS.has(String(ext || '').trim().toLowerCase().replace(/^\./, ''));
}
