import React from 'react';
import { Toast } from '@douyinfe/semi-ui';
import styled from 'styled-components';

type EmbeddedBrowserPanelProps = {
  activeTabId: string | null;
  boundsSyncDurationMs?: number;
  boundsSyncSignal?: number;
  currentUrl?: string;
  onStateChange?: (payload: BrowserEventPayload) => void;
  onPendingFileOpenHandled?: (tabId: string) => void;
  onSubmitDraft: (value: string) => void;
  pendingFileOpen?: {
    fileName: string;
    sourceUrl: string;
  } | null;
  suspendNativeView?: boolean;
};

export type EmbeddedBrowserHandle = {
  navigate: (tabId: string, url: string) => void;
  reload: () => void;
};

type BrowserEventPayload = {
  canGoBack?: boolean;
  canGoForward?: boolean;
  details?: string;
  iconSourceUrl?: string;
  iconUrl?: string;
  message?: string;
  meta?: string[];
  state?: 'idle' | 'loading' | 'ready' | 'error';
  tabId?: string;
  title?: string;
  url?: string;
};

type EmbeddedBrowserPanelMode = 'idle' | 'blank' | 'attached';

const EMBEDDED_BROWSER_EMPTY_VISUAL_OFFSET_PX = -100;

function syncEmbeddedBrowserBounds(host: HTMLElement) {
  const rect = host.getBoundingClientRect();
  void window.electronEmbeddedBrowser.setBounds({
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  });
}

const BrowserSurface = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  position: relative;
  overflow: hidden;
  background: var(--app-bg);

  .embedded-browser-host {
    flex: 1;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    position: relative;
    background: var(--app-bg);
  }

  .embedded-browser-status {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: var(--app-bg);
    color: var(--app-text-muted);
    font-size: 14px;
    text-align: center;
    pointer-events: none;
  }

  .embedded-browser-empty {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: var(--app-bg);
  }

  .embedded-browser-empty-anchor {
    width: min(576px, 100%);
    display: flex;
    flex-direction: column;
    align-items: center;
    transform: translateY(var(--embedded-browser-empty-offset));
  }

  .embedded-browser-empty-header {
    width: 100%;
    min-height: 102px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 9px;
    margin-bottom: 13px;
    text-align: center;
  }

  .embedded-browser-empty-title {
    margin: 0;
    color: var(--app-text);
    font-size: 40px;
    font-weight: 700;
    line-height: 1.1;
  }

  .embedded-browser-empty-subtitle {
    margin: 0;
    color: var(--app-text-muted);
    font-size: 13px;
    line-height: 1.6;
  }

  .embedded-browser-empty-form {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .embedded-browser-empty-input {
    flex: 1;
    min-width: 0;
    height: 38px;
    border-radius: 8px;
    border: 1px solid var(--app-border);
    background: var(--app-bg-elevated);
    color: var(--app-text);
    padding: 0 11px;
    outline: none;
    font-size: 11px;
  }

  .embedded-browser-empty-input:focus {
    border-color: var(--semi-color-primary);
  }

  .embedded-browser-empty-submit {
    height: 31px;
    border-radius: 8px;
    border: none;
    background: var(--semi-color-primary);
    color: #fff;
    padding: 0 13px;
    cursor: pointer;
    flex-shrink: 0;
    font-size: 11px;
    font-weight: 600;
  }
`;

const EmbeddedBrowserPanel = React.forwardRef<EmbeddedBrowserHandle, EmbeddedBrowserPanelProps>(
  ({
    activeTabId,
    boundsSyncDurationMs = 0,
    boundsSyncSignal = 0,
    currentUrl = '',
    onStateChange,
    onPendingFileOpenHandled,
    onSubmitDraft,
    pendingFileOpen = null,
    suspendNativeView = false,
  }, ref) => {
    const hostRef = React.useRef<HTMLDivElement | null>(null);
    const lastNativeAttachRef = React.useRef<{
      pendingKey: string | null;
      tabId: string | null;
    }>({
      pendingKey: null,
      tabId: null,
    });
    const [emptyDraftValue, setEmptyDraftValue] = React.useState('');
    const [statusMessage, setStatusMessage] = React.useState(
      activeTabId ? '正在打开网页...' : '输入网址后回车',
    );
    const [statusDetails, setStatusDetails] = React.useState('');
    const [statusMeta, setStatusMeta] = React.useState<string[]>([]);
    const panelMode: EmbeddedBrowserPanelMode = !activeTabId
      ? 'idle'
      : currentUrl
        ? 'attached'
        : 'blank';

    const requestNavigation = React.useCallback(
      async (nextTabId: string, nextUrl: string) => {
        const normalizedUrl = String(nextUrl || '').trim();
        if (!normalizedUrl) {
          setStatusDetails('');
          setStatusMeta([]);
          setStatusMessage('输入网址后回车');
          return;
        }

        setStatusDetails('');
        setStatusMeta([]);
        setStatusMessage('正在打开网页...');

        try {
          await window.electronEmbeddedBrowser.navigate(nextTabId, normalizedUrl);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message.includes('ERR_ABORTED')) {
            return;
          }
          setStatusMessage('页面加载失败');
          setStatusDetails(message);
          setStatusMeta([]);
        }
      },
      [],
    );

    React.useImperativeHandle(ref, () => ({
      navigate: (nextTabId: string, nextUrl: string) => {
        void requestNavigation(nextTabId, nextUrl);
      },
      reload: () => {
        if (!activeTabId) {
          return;
        }
        if (!String(currentUrl || '').trim()) {
          setEmptyDraftValue('');
          setStatusDetails('');
          setStatusMeta([]);
          setStatusMessage('');
          void window.electronEmbeddedBrowser.deactivate();
          return;
        }
        setStatusMessage('正在刷新网页...');
        void window.electronEmbeddedBrowser.reload(activeTabId);
      },
    }), [activeTabId, currentUrl, requestNavigation]);

    React.useEffect(() => {
      const unsubscribe = window.electronEmbeddedBrowser.onStateChange((payload: BrowserEventPayload) => {
        onStateChange?.(payload);
        if (payload.tabId && activeTabId && payload.tabId !== activeTabId) {
          return;
        }
        if (payload.state === 'idle') {
          setStatusDetails('');
          setStatusMeta([]);
          setStatusMessage('输入网址后回车');
          return;
        }
        if (payload.state === 'ready') {
          setStatusDetails(payload.message || '');
          setStatusMeta(payload.meta || []);
          setStatusMessage('');
          return;
        }
        if (payload.state === 'error') {
          setStatusDetails(payload.details || '');
          setStatusMeta(payload.meta || []);
          setStatusMessage(payload.message || '页面加载失败');
          return;
        }
        if (payload.state === 'loading') {
          setStatusDetails(payload.details || '');
          setStatusMeta(payload.meta || []);
          setStatusMessage(payload.message || '正在打开网页...');
        }
      });
      return unsubscribe;
    }, [activeTabId, onStateChange]);

    React.useEffect(() => {
      return window.electronEmbeddedBrowser.onLibraryFileDropResult((payload) => {
        if (payload.tabId !== activeTabId) return;
        if (payload.status === 'preparing') {
          Toast.info(`正在准备 ${payload.fileName}`);
          return;
        }
        if (payload.status === 'delivered') {
          Toast.success(`已将 ${payload.fileName} 交给网页`);
          return;
        }
        Toast.error(payload.error || `无法将 ${payload.fileName} 交给网页`);
      });
    }, [activeTabId]);

    React.useEffect(() => {
      if (suspendNativeView) {
        lastNativeAttachRef.current = {
          pendingKey: null,
          tabId: null,
        };
        void window.electronEmbeddedBrowser.deactivate();
        return;
      }
      if (panelMode === 'idle') {
        setStatusMessage('输入网址后回车');
        setEmptyDraftValue('');
        lastNativeAttachRef.current = {
          pendingKey: null,
          tabId: null,
        };
        void window.electronEmbeddedBrowser.deactivate();
        return;
      }
      if (panelMode === 'blank') {
        setStatusDetails('');
        setStatusMeta([]);
        setStatusMessage('');
        setEmptyDraftValue('');
        lastNativeAttachRef.current = {
          pendingKey: null,
          tabId: null,
        };
        void window.electronEmbeddedBrowser.deactivate();
        return;
      }
      setEmptyDraftValue('');
      setStatusDetails('');
      setStatusMeta([]);
      setStatusMessage('正在打开网页...');
      if (!activeTabId) {
        return;
      }
      const pendingKey = pendingFileOpen
        ? `${activeTabId}::${currentUrl}::${pendingFileOpen.sourceUrl}::${pendingFileOpen.fileName}`
        : null;
      const needsPendingDispatch = pendingKey !== null && lastNativeAttachRef.current.pendingKey !== pendingKey;
      const needsTabAttach = lastNativeAttachRef.current.tabId !== activeTabId;
      if (!needsPendingDispatch && !needsTabAttach) {
        return;
      }
      const openCurrentTab = async () => {
        try {
          if (pendingFileOpen) {
            await window.electronEmbeddedBrowser.openMappedFile(
              activeTabId,
              currentUrl,
              pendingFileOpen.sourceUrl,
              pendingFileOpen.fileName,
            );
          } else {
            await window.electronEmbeddedBrowser.openTab(activeTabId, currentUrl);
          }
          lastNativeAttachRef.current = {
            pendingKey,
            tabId: activeTabId,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setStatusMessage('页面加载失败');
          setStatusDetails(message);
          setStatusMeta([]);
        } finally {
          if (pendingFileOpen) {
            onPendingFileOpenHandled?.(activeTabId);
          }
        }
      };

      void openCurrentTab();
    }, [activeTabId, currentUrl, onPendingFileOpenHandled, panelMode, pendingFileOpen, suspendNativeView]);

    React.useLayoutEffect(() => {
      const host = hostRef.current;
      if (!host) {
        return;
      }

      let rafId = 0;
      const syncBounds = () => {
        rafId = 0;
        syncEmbeddedBrowserBounds(host);
      };

      const requestSync = () => {
        if (rafId) {
          return;
        }
        rafId = window.requestAnimationFrame(syncBounds);
      };

      const resizeObserver = new ResizeObserver(() => {
        requestSync();
      });
      resizeObserver.observe(host);
      window.addEventListener('resize', requestSync);
      requestSync();

      return () => {
        resizeObserver.disconnect();
        window.removeEventListener('resize', requestSync);
        if (rafId) {
          window.cancelAnimationFrame(rafId);
        }
      };
    }, []);

    React.useLayoutEffect(() => {
      if (!boundsSyncSignal) {
        return;
      }

      const host = hostRef.current;
      if (!host) {
        return;
      }

      let rafId = 0;
      const startedAt = window.performance.now();
      const syncUntil = startedAt + Math.max(0, boundsSyncDurationMs) + 80;

      const syncFrame = () => {
        syncEmbeddedBrowserBounds(host);
        if (window.performance.now() < syncUntil) {
          rafId = window.requestAnimationFrame(syncFrame);
          return;
        }
        rafId = 0;
      };

      rafId = window.requestAnimationFrame(syncFrame);

      return () => {
        if (rafId) {
          window.cancelAnimationFrame(rafId);
        }
      };
    }, [boundsSyncDurationMs, boundsSyncSignal]);

    React.useEffect(() => {
      return () => {
        void window.electronEmbeddedBrowser.deactivate();
      };
    }, []);

    return (
      <BrowserSurface
        style={
          {
            ['--embedded-browser-empty-offset' as string]: `${EMBEDDED_BROWSER_EMPTY_VISUAL_OFFSET_PX}px`,
          } as React.CSSProperties
        }
      >
        <div ref={hostRef} className="embedded-browser-host" />
        {panelMode === 'blank' ? (
          <div className="embedded-browser-empty">
            <div className="embedded-browser-empty-anchor">
              <div className="embedded-browser-empty-header">
                <h1 className="embedded-browser-empty-title">Omniflow</h1>
                <p className="embedded-browser-empty-subtitle">输入网址或关键词开始</p>
              </div>
              <form
                className="embedded-browser-empty-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  onSubmitDraft(emptyDraftValue);
                }}
              >
                <input
                  className="embedded-browser-empty-input"
                  value={emptyDraftValue}
                  onChange={(event) => setEmptyDraftValue(event.target.value)}
                  placeholder="输入网址或关键词"
                />
                <button type="submit" className="embedded-browser-empty-submit">
                  进入
                </button>
              </form>
            </div>
          </div>
        ) : null}
        {statusMessage ? (
          <div className="embedded-browser-status">
            <div>
              <div>{statusMessage}</div>
              {statusDetails ? (
                <div style={{ marginTop: 8, fontSize: 12, opacity: 0.72 }}>{statusDetails}</div>
              ) : null}
              {statusMeta.length ? (
                <div style={{ marginTop: 8, fontSize: 12, opacity: 0.72, whiteSpace: 'pre-wrap' }}>
                  {statusMeta.join('\n')}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </BrowserSurface>
    );
  },
);

EmbeddedBrowserPanel.displayName = 'EmbeddedBrowserPanel';

export default EmbeddedBrowserPanel;
