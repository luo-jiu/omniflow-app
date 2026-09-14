import { afterEach, describe, expect, it, vi } from 'vitest';
import { viewerRegistry, resolveViewerContribution } from './viewer-registry';
import { builtInViewerId } from '@/shared/viewer-contribution-id';
import { readViewerAssociation, saveViewerAssociation } from './viewer-associations';

const disposers: Array<() => void> = [];
const facts = { fileType: 'text' as const, fileName: 'sample.CSV', nodeId: 900099, libraryId: 900007 };
function register(id: string, owner = 'example') {
  disposers.push(viewerRegistry.registerBatch(owner, [{ id, title: id, fileTypes: ['text'], extensions: owner === 'example' ? ['csv'] : undefined, View: () => null }]));
}
afterEach(() => { disposers.splice(0).reverse().forEach(dispose => dispose()); vi.unstubAllGlobals(); });
describe('viewer contribution matching', () => {
  it('replaces only its owned built-in batch during hot updates, keeping duplicate rejection', () => {
    const first = viewerRegistry.installBuiltIns(() => null);
    const replacement = () => null;
    disposers.push(viewerRegistry.installBuiltIns(replacement));
    first();
    expect(viewerRegistry.getSnapshot()).toHaveLength(14);
    expect(viewerRegistry.get(builtInViewerId('text'))?.View).toBe(replacement);
    expect(() => viewerRegistry.registerBatch('omniflow', [{ id: builtInViewerId('text'), title: 'Duplicate', fileTypes: ['text'], View: () => null }])).toThrow('Duplicate');
  });
  it('does not let new registrations take over the built-in default', () => {
    register('example.a'); register('example.b'); register(builtInViewerId('text'), 'omniflow');
    expect(resolveViewerContribution(facts).selected?.id).toBe(builtInViewerId('text'));
    expect(resolveViewerContribution(facts, 'example.b').selected?.id).toBe('example.b');
    expect(resolveViewerContribution(facts, 'missing.viewer').missingRequested).toBe(true);
    expect(resolveViewerContribution(facts, 'missing.viewer').selected?.id).toBe(builtInViewerId('text'));
    expect(facts.fileType).toBe('text');
  });
  it('limits added viewers to matching library resources, not local or media paths', () => {
    register('example.a');
    expect(resolveViewerContribution({ ...facts, libraryId: null }).candidates).toEqual([]);
    expect(resolveViewerContribution({ ...facts, fileName: 'sample.txt' }).candidates).toEqual([]);
    expect(() => viewerRegistry.registerBatch('example', [{ id: 'example.media', title: 'Bad', fileTypes: ['video'], View: () => null }])).toThrow();
  });
  it('preserves missing associations and isolates account, library and format', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    saveViewerAssociation('user:900001', 900007, facts, 'missing.viewer');
    expect(readViewerAssociation('user:900001', 900007, facts)).toBe('missing.viewer');
    expect(readViewerAssociation('user:900002', 900007, facts)).toBeUndefined();
    expect(readViewerAssociation('user:900001', 900008, facts)).toBeUndefined();
    expect(readViewerAssociation('user:900001', 900007, { ...facts, fileName: 'sample.txt' })).toBeUndefined();
  });
});
