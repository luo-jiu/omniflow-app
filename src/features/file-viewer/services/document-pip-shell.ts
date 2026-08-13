export interface DocumentPipShellControls {
  hide: () => void;
  softClose: () => void;
  togglePlay: () => void;
}

export interface DocumentPipShellState {
  title: string;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
}

export interface DocumentPipShell {
  host: HTMLDivElement;
  update: (state: DocumentPipShellState) => void;
}

export function createDocumentPipShell(
  pipWindow: Window,
  controls: DocumentPipShellControls,
  initialState: DocumentPipShellState,
): DocumentPipShell {
  const doc = pipWindow.document;
  doc.title = initialState.title || '视频';
  doc.body.innerHTML = '';

  const style = doc.createElement('style');
  style.textContent = DOCUMENT_PIP_STYLE;
  doc.head.appendChild(style);

  const root = doc.createElement('div');
  root.className = 'omniflow-pip';

  const header = doc.createElement('div');
  header.className = 'omniflow-pip__header';
  const title = doc.createElement('span');
  title.className = 'omniflow-pip__title';

  const hideButton = doc.createElement('button');
  hideButton.className = 'omniflow-pip__button';
  hideButton.type = 'button';
  hideButton.textContent = '收起';
  hideButton.onclick = controls.hide;

  const closeButton = doc.createElement('button');
  closeButton.className = 'omniflow-pip__button';
  closeButton.type = 'button';
  closeButton.textContent = '×';
  closeButton.onclick = controls.softClose;
  header.append(title, hideButton, closeButton);

  const host = doc.createElement('div');
  host.className = 'omniflow-pip__host';

  const footer = doc.createElement('div');
  footer.className = 'omniflow-pip__footer';
  const playButton = doc.createElement('button');
  playButton.className = 'omniflow-pip__button omniflow-pip__button--primary';
  playButton.type = 'button';
  playButton.onclick = controls.togglePlay;
  const time = doc.createElement('span');
  time.className = 'omniflow-pip__time';
  footer.append(playButton, time);
  root.append(header, host, footer);
  doc.body.appendChild(root);

  const update = (state: DocumentPipShellState) => {
    const nextTitle = state.title || '视频';
    doc.title = nextTitle;
    title.textContent = nextTitle;
    title.title = nextTitle;
    playButton.textContent = state.isPlaying ? '暂停' : '播放';
    time.textContent = `${formatPipTime(state.currentTime)} / ${formatPipTime(state.duration)}`;
  };
  update(initialState);

  return { host, update };
}

function formatPipTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return '00:00';
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = Math.floor(value % 60);
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

const DOCUMENT_PIP_STYLE = `
  html,
  body {
    width: 100%;
    height: 100%;
    margin: 0;
    overflow: hidden;
    background: #08090b;
    color: #f6f7fb;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
  }
  .omniflow-pip {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: #08090b;
  }
  .omniflow-pip__header,
  .omniflow-pip__footer {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 34px;
    padding: 6px 9px;
    box-sizing: border-box;
    background: rgba(18, 20, 25, 0.94);
    border-color: rgba(255, 255, 255, 0.09);
  }
  .omniflow-pip__header {
    border-bottom: 1px solid rgba(255, 255, 255, 0.09);
  }
  .omniflow-pip__footer {
    border-top: 1px solid rgba(255, 255, 255, 0.09);
  }
  .omniflow-pip__title,
  .omniflow-pip__time {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 12px;
    line-height: 1.3;
  }
  .omniflow-pip__title {
    flex: 1;
    font-weight: 650;
  }
  .omniflow-pip__time {
    flex: 1;
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: rgba(246, 247, 251, 0.72);
  }
  .omniflow-pip__host {
    flex: 1;
    min-height: 0;
    display: flex;
    background: #000;
  }
  .omniflow-pip__button {
    border: 0;
    border-radius: 7px;
    height: 24px;
    min-width: 28px;
    padding: 0 9px;
    background: rgba(255, 255, 255, 0.1);
    color: #f6f7fb;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .omniflow-pip__button:hover {
    background: rgba(255, 255, 255, 0.18);
  }
  .omniflow-pip__button--primary {
    background: rgba(73, 140, 255, 0.88);
  }
  .omniflow-pip__button--primary:hover {
    background: rgba(90, 152, 255, 0.98);
  }
`;
