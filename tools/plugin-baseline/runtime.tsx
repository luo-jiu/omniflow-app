import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Tree } from '@douyinfe/semi-ui';
import CodeMirror from '@uiw/react-codemirror';
import { ThemeProvider } from '../../src/contexts/ThemeContext';
import { useTheme } from '../../src/hooks/useTheme';
import { getDirectoryBuiltInIcon, getFileNodeIcon } from '../../src/features/file-explorer/utils/file-node-icon';
import DirectoryContextMenu from '../../src/features/file-explorer/components/directory-tree/context-menu/DirectoryContextMenu';
import { ViewerSessionRegistry } from '../../src/features/file-viewer/session/viewer-session-registry';
import '@douyinfe/semi-ui/dist/css/semi.min.css';
import '../../src/assets/css/reset.less';

declare global {
  interface Window {
    baseline: { cycles: number; report: (value: unknown) => void };
  }
}

const nodeCount = 1050;
const contents = Array.from({ length: 2000 }, (_, i) => `fixture row ${i + 1}: 合成内容`).join('\n');
const treeData = Array.from({ length: 50 }, (_, folder) => ({
  key: `folder-${folder}`, label: `fixture-${folder}`, icon: getDirectoryBuiltInIcon('DEF', 0, false),
  children: Array.from({ length: 20 }, (_, child) => ({
    key: `file-${folder}-${child}`, label: `sample-${child}.txt`, icon: getFileNodeIcon('txt'),
  })),
}));
const registry = new ViewerSessionRegistry();
const results: Record<string, number[]> = {};
let update!: React.Dispatch<React.SetStateAction<{ expanded: string[]; tab: number | null; menu: boolean }>>;
let setMode!: ReturnType<typeof useTheme>['setTheme'];
export function Fixture() {
  const [state, setState] = React.useState({ expanded: [] as string[], tab: null as number | null, menu: false });
  const theme = useTheme();
  update = setState;
  setMode = theme.setTheme;
  return <div style={{ display: 'flex', height: '100vh', background: 'var(--app-bg)', color: 'var(--app-text)' }}>
    <aside id="fixture-tree" style={{ width: 260, overflow: 'auto', flexShrink: 0 }}>
      <Tree treeData={treeData} expandedKeys={state.expanded} onExpand={keys => setState(s => ({ ...s, expanded: keys as string[] }))} />
    </aside>
    <main style={{ flex: 1, minWidth: 0 }}>
      {state.tab !== null && <CodeMirror key={state.tab} value={contents} readOnly height="680px" theme={theme.resolvedTheme} />}
      {state.menu && <div style={{ position: 'absolute', top: 80, left: 280 }}>
        <DirectoryContextMenu node={{ id: 900099, name: 'fixture', ext: 'txt' }} isFolder={false} onAction={() => { throw new Error('No actions permitted in baseline'); }} />
      </div>}
    </main>
  </div>;
}

const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const heapBytes = () => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;
async function settle() { await frame(); await frame(); }
async function measure(name: string, action: () => void) {
  const start = performance.now();
  flushSync(action);
  await settle();
  (results[name] ??= []).push(performance.now() - start);
}

async function run() {
  const root = createRoot(document.getElementById('root')!);
  flushSync(() => root.render(<ThemeProvider><Fixture /></ThemeProvider>));
  await settle();
  window.baseline.report({ type: 'ready', rendererReadyMs: performance.now() });
  // Fixed idle interval before measuring fixture operations; not shared-app idle.
  await new Promise(resolve => setTimeout(resolve, 5000));
  const heapAtIdle = heapBytes();
  window.baseline.report({ type: 'measuring' });
  for (let cycle = 0; cycle < window.baseline.cycles; cycle += 1) {
    await measure('expand20Folders', () => update(s => ({ ...s, expanded: treeData.slice(0, 20).map(n => n.key) })));
    await measure('scrollTree', () => { document.getElementById('fixture-tree')!.scrollTop = 600; });
    await measure('open2000LineEditor', () => update(s => ({ ...s, tab: cycle * 2 })));
    await measure('switchEditor', () => update(s => ({ ...s, tab: cycle * 2 + 1 })));
    await measure('themeDark', () => setMode('dark'));
    await measure('themeLight', () => setMode('light'));
    await measure('menuMount', () => update(s => ({ ...s, menu: true })));
    await measure('closeViews', () => update({ expanded: [], tab: null, menu: false }));
    if (document.querySelector('.cm-editor')) throw new Error('Editor DOM survived close');
    // Exercise the existing owner with synthetic identities, not a second owner in the app.
    registry.writeSnapshot({ schemaVersion: 1, identity: { accountScope: 'user:900001', libraryId: 900007, resourceIdentity: 'node:900099', viewerKind: 'text' }, contentRevision: 'fixture:v1', savedAt: 1000, payload: { topLine: cycle + 1 } });
    registry.disposeLibrary(900007);
    if (registry.getState().snapshotCount !== 0) throw new Error('Snapshot survived library disposal');
    window.baseline.report({ type: 'cycle', cycle: cycle + 1, heapBytes: heapBytes() });
  }
  root.unmount();
  registry.disposeSession();
  await settle();
  const heapBeforeGc = heapBytes();
  const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
  if (gc) {
    for (let i = 0; i < 3; i += 1) { gc(); await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  window.baseline.report({ type: 'result', nodeCount, textLines: 2000, cycles: window.baseline.cycles, measurementsMs: results,
    finalRegistry: registry.getState(), remainingEditors: document.querySelectorAll('.cm-editor').length,
    heapAtIdle, heapBeforeGc, heapAfterGc: heapBytes(), diagnosticGcAvailable: Boolean(gc) });
}
void run().catch(error => window.baseline.report({ type: 'error', message: String(error) }));
