import { describe, expect, it } from 'vitest';
import { isIconAssetPath, resolveDirectoryIconSemantic, selectIconAsset, validateIconTheme, type IconCandidate } from './icon-theme';

describe('directory icon contract', () => {
  it.each(['COMIC', 'ASMR', 'VIDEO', 'AUDIO', 'GALLERY'])('preserves %s archive semantics independently of expansion', builtInType => {
    const input = { builtInType, archiveMode: 1, expanded: false };
    const closed = resolveDirectoryIconSemantic(input);
    const open = resolveDirectoryIconSemantic({ ...input, expanded: true });
    expect(open.key).toBe(`folder.${builtInType.toLowerCase()}.archive`);
    expect(closed.key).toBe(open.key);
    expect(open.expanded).toBe(true);
    expect(input.expanded).toBe(false);
  });
  it('reports unsupported facts without rewriting the node', () => {
    expect(resolveDirectoryIconSemantic({ builtInType: 'FUTURE' }).warnings).toEqual(['unknown-type']);
    expect(resolveDirectoryIconSemantic({ builtInType: 'DEF', archiveMode: 1 }).warnings).toEqual(['invalid-default-archive']);
  });
  it.each(['/absolute.svg', '../escape.svg', 'a/../escape.svg', 'a//icon.svg', 'a\\icon.svg', 'https://x/a.svg', '%2e%2e/icon.svg', 'a.svg?q=x', 'a.svg#icon', 'icon.html', 'assets/CON.svg', '.../a.svg', 'assets./a.svg'])('rejects untrusted asset path %s', input => {
    expect(isIconAssetPath(input)).toBe(false);
  });
  it('validates pairs atomically, detaches inputs and permits closed-only fallback', () => {
    const input = { schemaVersion: 1, id: 'example.icons', icons: { 'folder.def': { closed: 'assets/folder.svg' } } };
    const parsed = validateIconTheme(input);
    expect(parsed.errors).toEqual([]);
    input.icons['folder.def'].closed = 'assets/changed.svg';
    expect(parsed.value!.icons['folder.def'].closed).toBe('assets/folder.svg');
    expect(validateIconTheme({ ...input, icons: { ...input.icons, 'file.text': { closed: '../escape.svg' } } }).value).toBeNull();
  });
  it('selects priority independently of array order and keeps host decorations', () => {
    const candidates: IconCandidate[] = [
      { source: 'core', packageId: 'omniflow.core', asset: { closed: 'core.svg', open: 'core-open.svg' } },
      { source: 'theme', packageId: 'example.icons', asset: { closed: 'theme.svg', open: 'theme-open.svg' } },
      { source: 'node', packageId: 'example.custom', asset: { closed: 'custom.svg' } },
    ];
    const result = selectIconAsset({ expanded: true, candidates, requiredDecorations: ['offline', 'error', 'offline'] });
    expect(result.source).toBe('node');
    expect(result.path).toBe('custom.svg');
    expect(result.decorations).toEqual(['offline', 'error']);
    expect(selectIconAsset({ expanded: true, candidates: [...candidates].reverse(), requiredDecorations: ['offline', 'error'] })).toEqual(result);
  });
  it('does not choose between ambiguous matches using installation order', () => {
    const candidate: IconCandidate = { source: 'association', packageId: 'example.icons', asset: { closed: 'x.svg' } };
    expect(() => selectIconAsset({ expanded: false, candidates: [candidate, candidate], requiredDecorations: [] })).toThrow('Ambiguous');
  });
  it('returns a host fallback without discarding required warnings', () => {
    expect(selectIconAsset({ expanded: false, candidates: [], requiredDecorations: ['unknown-type'] })).toEqual({ packageId: null, source: 'core', path: null, decorations: ['unknown-type'] });
  });
});
