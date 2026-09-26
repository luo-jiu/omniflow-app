import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { pluginViewerApi } from '@/service/plugins/plugin-viewer.api';
import { AppearanceViewContext } from '@/features/appearance/appearance.context';
import { toPluginThemeSnapshot } from '@/features/appearance/plugin-theme';
import { useViewerSession } from '../../session/useViewerSession';
import { builtInViewerId } from '@/shared/viewer-contribution-id';
import type { FileDispatcherProps } from '../../contributions/viewer.types';
import type { PluginViewerSnapshot } from '@/shared/plugin-viewer';
export function PluginViewer(props: FileDispatcherProps) {
  const directory = props.fileType === 'comic';
  const appearance = useContext(AppearanceViewContext);
  const scopeKey = JSON.stringify([props.accountScope, props.libraryId, props.nodeId, props.viewerId, props.contentRevision]);
  const [grantScope, setGrantScope] = useState<string | null>(null);
  const granted = grantScope === scopeKey; const [retry, setRetry] = useState(0);
  const [status, setStatus] = useState(''); const [fatal, setFatal] = useState(false);
  const container = useRef<HTMLDivElement>(null); const clientId = useRef<string | null>(null);
  const snapshot = useRef<PluginViewerSnapshot | null>(null); const active = props.active !== false;
  const snapshotScope = useRef(scopeKey);
  if (snapshotScope.current !== scopeKey) { snapshotScope.current = scopeKey; snapshot.current = null; }
  const activeRef = useRef(active); activeRef.current = active;
  const themeRevision = useRef(1);
  const theme = useMemo(() => toPluginThemeSnapshot(appearance, ++themeRevision.current), [appearance]);
  const latestTheme = useRef(theme); latestTheme.current = theme;
  const adapter = useMemo(() => ({ capture: () => snapshot.current, restore: (value: PluginViewerSnapshot) => { snapshot.current = value; },
    suspend: () => undefined, resume: () => undefined, estimateSnapshotBytes: () => JSON.stringify(snapshot.current).length * 2,
    getPinReasons: (): ('active')[] => activeRef.current ? ['active'] : [] }), []);
  const session = useViewerSession({ accountScope: props.accountScope, libraryId: props.libraryId, nodeId: props.nodeId,
    tabId: props.tabId, viewerKind: props.fileType ?? 'other', schemaVersion: 1, contentRevision: props.contentRevision,
    reloadToken: props.reloadToken ?? 0, active, adapter });
  const waitForInitialRestore = session.waitForInitialRestore;
  const capture = useRef(session.capture); capture.current = session.capture;
  useEffect(() => {
    if (!granted || !active || !props.nodeId || !props.libraryId || !props.viewerId) return;
    const id = crypto.randomUUID(); clientId.current = id; let cancelled = false;
    setStatus('正在授权并加载查看器…');
    const unsubscribe = pluginViewerApi.subscribe(event => {
      if (cancelled || event.clientId !== id) return;
      if (event.type === 'state') { snapshot.current = event.snapshot; capture.current(); }
      else if (event.reason !== 'closed') setFatal(true);
    });
    const layout = () => { if (cancelled || !container.current) return; const rect = container.current.getBoundingClientRect();
      void pluginViewerApi.layout(id, { x: rect.x, y: rect.y, width: rect.width, height: rect.height }); };
    const observer = new ResizeObserver(layout); if (container.current) observer.observe(container.current);
    window.addEventListener('resize', layout); window.addEventListener('scroll', layout, true);
    void waitForInitialRestore().then(async () => {
      if (cancelled) return;
      const result = await pluginViewerApi.open({ clientId: id, viewerId: props.viewerId!, libraryId: props.libraryId!, nodeId: props.nodeId!, theme: latestTheme.current, snapshot: snapshot.current });
      if (cancelled) { void pluginViewerApi.close(id); return; }
      if (!result.ok) console.info('plugin.viewer.failure', result);
      if (!result.ok) setStatus(result.code === 'FORBIDDEN' ? '当前文件读取被拒绝，请检查账号和资料库权限。' : result.code === 'CONTENT_CHANGED' ? '文件已变化，请重新打开。' : '插件查看器暂不可用，请重试或切回内置查看器。');
      else { setStatus(''); layout(); }
    }).catch(() => { if (!cancelled) setStatus('无法启动插件查看器，请重试。'); });
    return () => { cancelled = true; observer.disconnect(); window.removeEventListener('resize', layout); window.removeEventListener('scroll', layout, true); unsubscribe(); capture.current(); void pluginViewerApi.close(id); if (clientId.current === id) clientId.current = null; };
  }, [granted, active, retry, props.accountScope, props.libraryId, props.nodeId, props.viewerId, props.reloadToken, props.contentRevision, waitForInitialRestore]);
  useEffect(() => { if (clientId.current) void pluginViewerApi.theme(clientId.current, theme); }, [theme]);
  if (fatal) throw new Error('Isolated viewer stopped');
  return <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
    <div style={{ display: 'flex', gap: 8, padding: 8, alignItems: 'center', fontSize: 12 }}>
      <span>插件只读查看器 · {directory ? '当前目录直属图片' : '仅当前文件'}</span>
      <button onClick={() => setGrantScope(granted ? null : scopeKey)}>{granted ? '撤销读取授权' : directory ? '允许读取此目录图片' : '允许读取此文件'}</button>
      {granted && <button onClick={() => setRetry(value => value + 1)}>重新加载</button>}
      <button onClick={() => props.onSelectViewer?.(builtInViewerId(props.fileType ?? 'other'))}>切回内置查看器</button>
      <span role="status">{granted ? status : '授权后才能读取正文。'}</span>
    </div>
    <div ref={container} style={{ flex: 1, minHeight: 0 }} />
  </div>;
}
