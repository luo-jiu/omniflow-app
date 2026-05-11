export function createSystemVideoWindowDataUrl() {
  return `data:text/html;charset=utf-8,${encodeURIComponent(SYSTEM_VIDEO_WINDOW_HTML)}`;
}

const SYSTEM_VIDEO_WINDOW_HTML = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob: http: https:; media-src http: https: blob: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src http: https: blob: data:;" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>视频</title>
  <style>
    html,
    body {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      background: #08090b;
      color: #f6f7fb;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
      user-select: none;
    }
    .shell {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      background: #08090b;
    }
    .header {
      height: 34px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 10px;
      box-sizing: border-box;
      background: rgba(18, 20, 25, 0.96);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      -webkit-app-region: drag;
    }
    .title {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      font-size: 12px;
      font-weight: 650;
      color: rgba(246, 247, 251, 0.9);
    }
    .close {
      width: 24px;
      height: 24px;
      border: 0;
      border-radius: 7px;
      background: rgba(255, 255, 255, 0.08);
      color: rgba(246, 247, 251, 0.9);
      font-size: 16px;
      line-height: 22px;
      cursor: pointer;
      -webkit-app-region: no-drag;
    }
    .close:hover {
      background: rgba(255, 255, 255, 0.16);
    }
    .video-host {
      flex: 1;
      min-height: 0;
      display: flex;
      background: #000;
    }
    video {
      width: 100%;
      height: 100%;
      background: #000;
      outline: none;
    }
  </style>
</head>
<body>
  <div class="shell">
    <div class="header">
      <div class="title" id="title">视频</div>
      <button class="close" id="close" type="button" aria-label="关闭">×</button>
    </div>
    <div class="video-host">
      <video id="video" controls playsinline></video>
    </div>
  </div>
  <script>
    const video = document.getElementById('video');
    const title = document.getElementById('title');
    const closeButton = document.getElementById('close');
    let pendingCurrentTime = null;
    let lastReportAt = 0;

    function report(force = false) {
      const now = Date.now();
      if (!force && now - lastReportAt < 180) return;
      lastReportAt = now;
      window.electronSystemVideoHost?.reportState({
        currentTime: Number.isFinite(video.currentTime) ? video.currentTime : 0,
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        isPlaying: !video.paused && !video.ended,
        volume: Number.isFinite(video.volume) ? video.volume : 1,
        muted: Boolean(video.muted),
        ended: Boolean(video.ended),
      });
    }

    function applyCurrentTime(time) {
      if (!Number.isFinite(time) || time < 0) return;
      if (video.readyState >= 1) {
        video.currentTime = time;
      } else {
        pendingCurrentTime = time;
      }
    }

    window.electronSystemVideoHost?.onInit((payload) => {
      title.textContent = payload.title || '视频';
      title.title = payload.title || '视频';
      document.title = payload.title || '视频';
      video.src = payload.src;
      video.volume = Number.isFinite(payload.volume) ? Math.min(Math.max(payload.volume, 0), 1) : 1;
      video.muted = Boolean(payload.muted);
      applyCurrentTime(payload.currentTime || 0);
      if (payload.isPlaying) {
        video.play().catch(() => undefined);
      }
      report(true);
    });

    window.electronSystemVideoHost?.onCommand((command) => {
      if (command.type === 'play') {
        video.play().catch(() => undefined);
      } else if (command.type === 'pause') {
        video.pause();
      } else if (command.type === 'seek') {
        applyCurrentTime(command.time);
      }
      report(true);
    });

    video.addEventListener('loadedmetadata', () => {
      if (pendingCurrentTime != null) {
        video.currentTime = pendingCurrentTime;
        pendingCurrentTime = null;
      }
      report(true);
    });
    ['play', 'pause', 'ended', 'volumechange', 'seeked'].forEach((eventName) => {
      video.addEventListener(eventName, () => report(true));
    });
    video.addEventListener('timeupdate', () => report(false));
    closeButton.addEventListener('click', () => {
      video.pause();
      report(true);
      window.electronSystemVideoHost?.close();
    });
    window.electronSystemVideoHost?.reportReady();
  </script>
</body>
</html>`;
