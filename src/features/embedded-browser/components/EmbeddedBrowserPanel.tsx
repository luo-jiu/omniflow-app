import React from 'react';
import styled from 'styled-components';

type EmbeddedBrowserPanelProps = {
  initialUrl?: string;
  onUrlChange?: (url: string) => void;
};

export type EmbeddedBrowserHandle = {
  navigate: (url: string) => void;
  reload: () => void;
};

type BrowserEventPayload = {
  details?: string;
  message?: string;
  meta?: string[];
  state?: 'idle' | 'loading' | 'ready' | 'error';
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
`;

const EmbeddedBrowserPanel = React.forwardRef<EmbeddedBrowserHandle, EmbeddedBrowserPanelProps>(
  ({ initialUrl = '', onUrlChange }, ref) => {
    const hostRef = React.useRef<HTMLDivElement | null>(null);
    const initialUrlRef = React.useRef(initialUrl);
    const [statusMessage, setStatusMessage] = React.useState(
      initialUrl ? '正在打开网页...' : '输入网址后回车',
    );
    const [statusDetails, setStatusDetails] = React.useState('');
    const [statusMeta, setStatusMeta] = React.useState<string[]>([]);

    const requestNavigation = React.useCallback(
      async (mode: 'open' | 'navigate', nextUrl: string) => {
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
          if (mode === 'open') {
            await window.electronEmbeddedBrowser.open(normalizedUrl);
            return;
          }
          await window.electronEmbeddedBrowser.navigate(normalizedUrl);
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
      navigate: (nextUrl: string) => {
        void requestNavigation('navigate', nextUrl);
      },
      reload: () => {
        setStatusMessage('正在刷新网页...');
        void window.electronEmbeddedBrowser.reload();
      },
    }), [requestNavigation]);

    React.useEffect(() => {
      const unsubscribe = window.electronEmbeddedBrowser.onStateChange((payload: BrowserEventPayload) => {
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
    }, [onUrlChange]);

    React.useEffect(() => {
      if (!initialUrlRef.current) {
        setStatusMessage('输入网址后回车');
        return;
      }
      void requestNavigation('open', initialUrlRef.current);
    }, [requestNavigation]);

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
        void window.electronEmbeddedBrowser.close();
      };
    }, []);

    return (
      <BrowserSurface>
        <div ref={hostRef} className="embedded-browser-host" />
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
