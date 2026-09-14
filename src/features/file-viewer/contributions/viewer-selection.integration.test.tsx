import React, { useContext, useMemo, useRef, useState } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@douyinfe/semi-ui', () => ({ Spin: () => <div>Loading</div> }));
vi.mock('@/features/file-explorer/services/file.api', () => ({ getFileLink: vi.fn() }));
vi.mock('@/features/file-viewer/services/global-audio-player', () => ({ globalAudioPlayer: { releaseForTab: vi.fn() } }));
vi.mock('@/features/file-viewer/services/floating-video.service', () => ({ floatingVideoService: { releaseForTab: vi.fn() } }));
vi.mock('@/features/workspace-resource-release', () => ({ isDisposingLibraryWorkspace: () => false }));
vi.mock('@/features/file-viewer/session', () => ({ useViewerAccountScope: () => 'user:900001', disposeViewerSessionOnClose: vi.fn() }));
vi.mock('@/features/file-viewer/session/viewer-session-cold-store', () => ({ viewerSessionColdStore: { readSnapshot: async () => null, writeSnapshot: async (value: unknown) => value, deleteResources: async () => undefined, deleteLibrary: async () => undefined, deleteNodes: async () => undefined } }));
vi.mock('@/features/file-viewer/components/text-viewer', () => ({ default: () => <div data-testid="core-view">Core text</div> }));
vi.mock('@/features/file-viewer/components/image-viewer', () => ({ default: () => null }));
vi.mock('@/features/file-viewer/components/video-viewer', () => ({ default: () => null }));
vi.mock('@/features/file-viewer/components/comic-viewer', () => ({ default: () => null }));
vi.mock('@/features/file-viewer/components/gallery-viewer', () => ({ default: () => null }));
vi.mock('@/features/file-viewer/components/pdf-viewer', () => ({ default: () => null }));
vi.mock('@/features/file-viewer/components/asmr-viewer', () => ({ default: () => null }));
vi.mock('@/features/archive-viewer/components/asmr-archive-viewer', () => ({ default: () => null }));
vi.mock('@/features/archive-viewer/components/comic-archive-viewer', () => ({ default: () => null }));
vi.mock('@/features/archive-viewer/components/gallery-archive-viewer', () => ({ default: () => null }));
vi.mock('@/features/archive-viewer/components/video-archive-viewer', () => ({ default: () => null }));
vi.mock('@/features/audio-viewer/components/unified-audio-viewer', () => ({ default: () => null }));
import FileDispatcher from '../components/file-dispatcher';
import { FileViewerProvider } from '@/contexts/FileViewerContext';
import { FileViewerContext } from '@/contexts/file-viewer.context';
import { viewerRegistry } from './viewer-registry';
import { useViewerSession } from '../session/useViewerSession';
import { viewerSessionRuntime } from '../session/viewer-session-runtime';
import type { FileDispatcherProps } from './viewer.types';
import { disposeViewerSessionOnClose } from '../session';

let owner: NonNullable<React.ContextType<typeof FileViewerContext>>;
let renderer: TestRenderer.ReactTestRenderer | undefined;
const disposers: Array<() => void> = [];
function Probe() {
  owner = useContext(FileViewerContext)!;
  const tab = owner.tabs[0];
  return tab ? <FileDispatcher key={`${tab.id}:${tab.viewerGeneration ?? 0}`} {...tab} tabId={tab.id} accountScope="user:900001" onSelectViewer={(id, remember) => owner.selectViewer(tab.id, id, remember)} /> : null;
}
function ReadingViewer(props: FileDispatcherProps) {
  const [position, setPosition] = useState(0);
  const current = useRef(position); current.current = position;
  const adapter = useMemo(() => ({ capture: () => ({ position: current.current }), restore: (value: { position: number }) => setPosition(value.position), suspend: () => undefined, resume: () => undefined, estimateSnapshotBytes: () => 64, getPinReasons: () => [] }), []);
  useViewerSession({ accountScope: props.accountScope, libraryId: props.libraryId, nodeId: props.nodeId, viewerKind: 'text', tabId: props.tabId, active: true, adapter, schemaVersion: 1, contentRevision: 'fixture:v1', reloadToken: props.reloadToken ?? 0 });
  return <button data-testid="position" onClick={() => setPosition(5)}>{position}</button>;
}
function select(id: string) { renderer!.root.findByProps({ 'aria-label': '查看器打开方式' }).props.onChange({ target: { value: id } }); }
afterEach(() => { act(() => renderer?.unmount()); disposers.splice(0).forEach(dispose => dispose()); viewerSessionRuntime.dispose(); renderer = undefined; });

it('closes a missing contribution through the actual built-in fallback policy', async () => {
  vi.mocked(disposeViewerSessionOnClose).mockClear();
  await act(async () => { renderer = TestRenderer.create(<FileViewerProvider libraryId={900007}><Probe /></FileViewerProvider>); });
  await act(async () => owner.setFileUrl('https://fixture.invalid/image.png', 'image.png', 'image', 900100, { viewerId: 'missing.image' }));
  act(() => owner.closeTab('node:900100'));
  expect(disposeViewerSessionOnClose).toHaveBeenCalledWith(expect.objectContaining({ viewerKind: 'image', viewerId: 'omniflow.viewer.image', nodeId: 900100 }));
});

it('falls back after a contributed view throws without erasing the requested id', async () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    disposers.push(viewerRegistry.registerBatch('example', [{ id: 'example.broken', title: 'Broken', fileTypes: ['text'], View: () => { throw new Error('Synthetic viewer failure'); } }]));
    await act(async () => { renderer = TestRenderer.create(<FileViewerProvider libraryId={900007}><Probe /></FileViewerProvider>); });
    await act(async () => owner.setFileUrl('https://fixture.invalid/sample.txt', 'sample.txt', 'text', 900099, { viewerId: 'example.broken' }));
    expect(renderer!.root.findAllByProps({ 'data-testid': 'core-view' })).toHaveLength(1);
    expect(owner.tabs[0].viewerId).toBe('example.broken');
    expect(JSON.stringify(renderer!.toJSON())).toContain('已回退到内置查看器');
  } finally { consoleError.mockRestore(); }
});

it('switches two matching viewers in one tab, isolates reading state and falls back without losing intent', async () => {
  disposers.push(viewerRegistry.registerBatch('example', [
    { id: 'example.a', title: 'A', fileTypes: ['text'], View: ReadingViewer },
    { id: 'example.b', title: 'B', fileTypes: ['text'], View: ReadingViewer },
  ]));
  viewerSessionRuntime.start();
  await act(async () => { renderer = TestRenderer.create(<FileViewerProvider libraryId={900007}><Probe /></FileViewerProvider>); });
  await act(async () => owner.setFileUrl('https://fixture.invalid/sample.csv', 'sample.csv', 'text', 900099));
  expect(renderer!.root.findAllByProps({ 'data-testid': 'core-view' })).toHaveLength(1);
  await act(async () => select('example.a'));
  act(() => renderer!.root.findByProps({ 'data-testid': 'position' }).props.onClick());
  await act(async () => select('example.b'));
  expect(renderer!.root.findByProps({ 'data-testid': 'position' }).children).toEqual(['0']);
  await act(async () => select('example.a'));
  expect(renderer!.root.findByProps({ 'data-testid': 'position' }).children).toEqual(['5']);
  expect(owner.tabs).toHaveLength(1);
  expect(owner.tabs[0].id).toBe('node:900099');
  expect(owner.tabs[0].fileType).toBe('text');
  expect(owner.tabs[0].viewerGeneration).toBe(3);
  act(() => disposers[0]());
  expect(renderer!.root.findAllByProps({ 'data-testid': 'core-view' })).toHaveLength(1);
  expect(owner.tabs[0].viewerId).toBe('example.a');
  expect(JSON.stringify(renderer!.toJSON())).toContain('已回退到内置查看器');
  await act(async () => { disposers.push(viewerRegistry.registerBatch('example', [{ id: 'example.a', title: 'A', fileTypes: ['text'], View: ReadingViewer }])); });
  expect(renderer!.root.findByProps({ 'data-testid': 'position' }).children).toEqual(['5']);
});
