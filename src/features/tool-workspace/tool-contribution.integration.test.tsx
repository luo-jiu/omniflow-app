import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@douyinfe/semi-icons', () => ({ IconMusic: () => null, IconDoubleChevronLeft: () => null }));
vi.mock('@douyinfe/semi-ui', () => ({ Tooltip: ({ children }: React.PropsWithChildren) => <>{children}</>, Toast: { warning: vi.fn() } }));
vi.mock('./hooks/useToolWorkspaceLayout', () => ({ useToolWorkspaceLayout: () => ({ layout: { navWidth: 208, toolOrder: ['subtitle-translation'] }, saveNavWidth: vi.fn(), saveToolOrder: vi.fn() }) }));
vi.mock('./hooks/useSubtitleTranslation', () => ({ useSubtitleTranslation: () => ({ handlers: {}, resetState: vi.fn() }) }));
vi.mock('@/features/workspace-resource-release', () => ({ isDisposingLibraryWorkspace: () => false }));
vi.mock('./ToolWorkspaceSubtitle', () => ({ default: () => <div>Built-in subtitle view</div> }));
vi.mock('./ToolWorkspaceMedia', () => ({ default: () => null }));
vi.mock('./ToolWorkspaceQQMusicLyrics', () => ({ default: () => null }));
vi.mock('@/features/media-tools/LibraryMediaTool', () => ({ default: () => null }));
vi.mock('@/features/ai-services/AIServiceWorkspace', () => ({ default: () => null }));
vi.mock('@/features/plugin-commands/PluginCommandWorkspace', () => ({ default: ({ request, selectedNodeIds }: { request?: { commandId: string }; selectedNodeIds?: number[] }) => (
  <div data-testid="manual-command-view" data-command={request?.commandId} data-selection={selectedNodeIds?.join(',')} />
) }));
import ToolWorkspace from './index';
import { toolRegistry } from './tool-registry';
import { clearAllToolWorkspaceStates, createDefaultToolWorkspaceState, loadToolWorkspaceState } from './tool-workspace.state';

let renderer: TestRenderer.ReactTestRenderer | undefined;
let dispose: (() => void) | undefined;
afterEach(() => { act(() => { renderer?.unmount(); dispose?.(); }); renderer = undefined; dispose = undefined; clearAllToolWorkspaceStates(); vi.unstubAllGlobals(); });

it('opens the plugin launcher from a captured request while preserving the tree selection', () => {
  act(() => { renderer = TestRenderer.create(<ToolWorkspace libraryId={900009} rootNodeId={null} selectedTreeNode={null}
    selectedNodeIds={[10, 11]} pluginCommandRequest={{ id: 'request-a', commandId: 'example.rename.manual', nodeIds: [10, 11] }} />); });
  expect(renderer!.root.findByProps({ 'data-testid': 'manual-command-view' }).props).toMatchObject({
    'data-command': 'example.rename.manual', 'data-selection': '10,11',
  });
  expect(loadToolWorkspaceState(900009).activeToolId).toBe('omniflow.plugin-commands');
});

it('decodes an unavailable tool id from persisted state without discarding the subtitle draft', () => {
  const state = createDefaultToolWorkspaceState();
  state.activeToolId = 'example.unavailable';
  state.subtitleTranslationDraft.fileName = 'retained-fixture.srt';
  const values = new Map([['tool-workspace-state:v1:900008', JSON.stringify(state)]]);
  vi.stubGlobal('window', { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => { values.delete(key); },
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  } });
  const restored = loadToolWorkspaceState(900008);
  expect(restored.activeToolId).toBe('example.unavailable');
  expect(restored.subtitleTranslationDraft.fileName).toBe('retained-fixture.srt');
});

it('adds, opens, removes and restores a namespaced tool using the unchanged workspace shell', () => {
  const contribution = { id: 'example.inspector' as const, title: 'Example inspector', icon: <span>i</span>, View: ({ libraryId }: { libraryId: number }) => <div data-testid="example-view">{libraryId}</div> };
  act(() => { renderer = TestRenderer.create(<ToolWorkspace libraryId={900007} rootNodeId={null} selectedTreeNode={null} />); });
  act(() => { dispose = toolRegistry.registerBatch('example', [contribution]); });
  act(() => { renderer!.root.findByProps({ 'aria-label': 'Example inspector' }).props.onClick(); });
  expect(renderer!.root.findByProps({ 'data-testid': 'example-view' }).children).toEqual(['900007']);
  expect(loadToolWorkspaceState(900007).activeToolId).toBe('example.inspector');
  act(() => dispose!());
  expect(renderer!.root.findAllByProps({ 'data-testid': 'example-view' })).toHaveLength(0);
  expect(JSON.stringify(renderer!.toJSON())).toContain('此工具当前不可用');
  expect(loadToolWorkspaceState(900007).activeToolId).toBe('example.inspector');
  act(() => { dispose = toolRegistry.registerBatch('example', [contribution]); });
  expect(renderer!.root.findByProps({ 'data-testid': 'example-view' }).children).toEqual(['900007']);
});
