# Omniflow App

Omniflow App is the desktop client for browsing, collecting, previewing, and managing resources inside Omniflow.

## Current Resource Capture Status

The embedded browser currently includes a first production-oriented version of resource capture inspired by cat-catch:

- Network resource capture for common media and manifest formats
- Deep capture from `fetch`, `XMLHttpRequest`, `JSON.parse`, and `MediaSource`
- `MSE` audio/video stream collection with in-page preview and export
- Main audio/video track pairing with local `ffmpeg` merge into `mp4`
- Resource filtering and grouped presentation inside the embedded browser panel

### Formats Currently Recognized

- Manifest: `m3u8`, `mpd`
- Media: `mp4`, `m4v`, `m4a`, `m4s`, `mp3`, `aac`, `flac`, `wav`, `ogg`, `webm`, `mkv`, `mov`, `avi`, `ts`, `flv`
- Subtitle: `vtt`, `srt`, `ass`, `ssa`, `ttml`

## Known Limitations

- The current merge path extracts captured `MSE` tracks through page-side `base64`, so very large videos can consume a lot of memory.
- Multi-audio, multi-quality, or more advanced track-selection scenarios are not fully handled yet. The UI currently prioritizes the main playable audio/video pair.
- Manifest parsing, segment reconstruction, key capture, and broader worker-level probing are planned but not complete.

## Attribution

Some embedded-browser resource-capture logic in this project is adapted from cat-catch:

- Project: [cat-catch](https://github.com/xifangczy/cat-catch)
- License: `AGPL-3.0`

Please preserve attribution and review AGPL-3.0 obligations carefully before redistributing derived work.

## Development

```bash
npm install
npm run build
```

分平台构建可使用：

```bash
npm run build:mac
npm run build:win
```

macOS 交叉生成的 Windows 安装包仍需在 Windows 10/11 或 Windows 11 ARM 虚拟机中运行验证。

本地联调默认后端地址是 `http://127.0.0.1:8850/api`。如果需要改成其他地址，请调整 `VITE_API_BASE_URL`。

本机常用启动脚本在 `~/script/omniflow-app.sh`。默认 `dev` 会随代码修改刷新；`stable` 跑已构建的 `dist`，并通过独立 `userData` 目录和 dev 隔离。

## Documentation

Key frontend documents live in the repo and should be treated as part of the development baseline:

- `docs/frontend-architecture-baseline.md`: current renderer / Electron layering, state ownership, and IPC boundary rules
- `docs/desktop-platform-architecture.md`: macOS / Windows host strategy, renderer platform bridge, and platform validation
- `docs/embedded-browser-architecture.md`: embedded browser lifecycle, capture, download, and main/preload responsibilities
- `docs/library-detail-workspace.md`: library detail workspace modes, browser tab ownership, and persistence rules
- `docs/file-explorer-file-viewer-boundary.md`: file tree, file-open flow, viewer tabs, and dispatcher ownership
- `docs/frontend-validation-matrix.md`: manual verification baseline for frontend and Electron changes
- `docs/cat-catch-migration-audit.md`: embedded-browser resource-capture migration status
- `.agent-docs/frontend-review-standard.md`: review gate for frontend and Electron changes
- `.agent-docs/frontend-handoff.md`: maintenance handoff and entry map
