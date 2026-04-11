import React from 'react';
import styled from 'styled-components';

type EmbeddedBrowserPanelProps = {
  activeTabId: string | null;
  currentUrl?: string;
  onUrlChange?: (url: string) => void;
  onStateChange?: (payload: BrowserEventPayload) => void;
  onSubmitDraft: (value: string) => void;
};

export type EmbeddedBrowserHandle = {
  navigate: (tabId: string, url: string) => void;
  reload: () => void;
};

type BrowserEventPayload = {
  details?: string;
  message?: string;
  meta?: string[];
  state?: 'idle' | 'loading' | 'ready' | 'error';
  tabId?: string;
  title?: string;
  url?: string;
};

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
    background: #fff;
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
    background: var(--app-bg);
  }

  .embedded-browser-empty-anchor {
    position: absolute;
    top: 33.333%;
    left: 50%;
    width: min(560px, calc(100% - 64px));
    transform: translateX(-50%);
  }

  .embedded-browser-empty-header {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
    transform: translateY(-100%);
  }

  .embedded-browser-empty-title {
    margin: 0;
    color: var(--app-text);
    font-size: 32px;
    font-weight: 700;
    line-height: 1.1;
  }

  .embedded-browser-empty-subtitle {
    margin: 0;
    color: var(--app-text-muted);
    font-size: 13px;
    line-height: 1.4;
  }

  .embedded-browser-empty-form {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 10px;
  }

  .embedded-browser-empty-input {
    flex: 1;
    min-width: 0;
    height: 40px;
    border-radius: 8px;
    border: 1px solid var(--app-border);
    background: var(--app-bg-elevated);
    color: var(--app-text);
    padding: 0 14px;
    outline: none;
    font-size: 14px;
  }

  .embedded-browser-empty-input:focus {
    border-color: var(--semi-color-primary);
  }

  .embedded-browser-empty-submit {
    height: 40px;
    border-radius: 8px;
    border: none;
    background: var(--semi-color-primary);
    color: #fff;
    padding: 0 18px;
    cursor: pointer;
    flex-shrink: 0;
    font-size: 14px;
    font-weight: 600;
  }
`;

const EmbeddedBrowserPanel = React.forwardRef<EmbeddedBrowserHandle, EmbeddedBrowserPanelProps>(
  ({ activeTabId, currentUrl = '', onUrlChange, onStateChange, onSubmitDraft }, ref) => {
    const hostRef = React.useRef<HTMLDivElement | null>(null);
    const emptyInputRef = React.useRef<HTMLInputElement | null>(null);
    const [emptyDraftValue, setEmptyDraftValue] = React.useState('');
    const [statusMessage, setStatusMessage] = React.useState(
      activeTabId ? '正在打开网页...' : '输入网址后回车',
    );
    const [statusDetails, setStatusDetails] = React.useState('');
    const [statusMeta, setStatusMeta] = React.useState<string[]>([]);

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
        setStatusMessage('正在刷新网页...');
        void window.electronEmbeddedBrowser.reload(activeTabId);
      },
    }), [activeTabId, requestNavigation]);

    React.useEffect(() => {
      const unsubscribe = window.electronEmbeddedBrowser.onStateChange((payload: BrowserEventPayload) => {
        onStateChange?.(payload);
        if (payload.tabId && activeTabId && payload.tabId !== activeTabId) {
          return;
        }
        if (payload.url) {
          onUrlChange?.(payload.url);
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
    }, [activeTabId, onStateChange, onUrlChange]);

    React.useEffect(() => {
      if (!activeTabId) {
        setStatusMessage('输入网址后回车');
        setEmptyDraftValue('');
        void window.electronEmbeddedBrowser.deactivate();
        return;
      }
      if (!currentUrl) {
        setStatusDetails('');
        setStatusMeta([]);
        setStatusMessage('');
        setEmptyDraftValue('');
        void window.electronEmbeddedBrowser.deactivate();
        return;
      }
      setEmptyDraftValue('');
      setStatusDetails('');
      setStatusMeta([]);
      setStatusMessage('正在打开网页...');
      void window.electronEmbeddedBrowser.activateTab(activeTabId);
    }, [activeTabId, currentUrl]);

    React.useLayoutEffect(() => {
      const host = hostRef.current;
      if (!host) {
        return;
      }

      let rafId = 0;
      const syncBounds = () => {
        rafId = 0;
        const rect = host.getBoundingClientRect();
        const nextBounds = {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
        void window.electronEmbeddedBrowser.setBounds(nextBounds);
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

    React.useEffect(() => {
      return () => {
        void window.electronEmbeddedBrowser.deactivate();
      };
    }, []);

    const showEmptyState = Boolean(activeTabId) && !currentUrl;

    React.useEffect(() => {
      if (!showEmptyState) {
        return;
      }
      window.requestAnimationFrame(() => {
        emptyInputRef.current?.focus();
      });
    }, [showEmptyState]);

    return (
      <BrowserSurface>
        <div ref={hostRef} className="embedded-browser-host" />
        {showEmptyState ? (
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
                  ref={emptyInputRef}
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
