# Omniflow App

Omniflow App is the desktop client for browsing, collecting, previewing, and managing resources inside Omniflow.

## Current Resource Capture Status

The embedded browser has an existing Cat Catch-inspired capture implementation, but its behavioral parity is being re-baselined before a full rearchitecture:

- Electron network capture, resource filtering, and grouped presentation exist but are not yet parity-verified
- The current deep `Worker` / `fetch` / `XMLHttpRequest` / `JSON.parse` hooks are disabled; the surrounding `MediaSource` hook remains active
- `MSE` collection, local `ffmpeg`, HLS/DASH processing, and library import paths exist as legacy characterization inputs; the migration map remains pending until behavior tests and cutover pass
- The authoritative completion contract is `docs/cat-catch-full-migration-execution-plan.md`

### Formats Currently Recognized

- Manifest: `m3u8`, `mpd`
- Media: `mp4`, `m4v`, `m4a`, `m4s`, `mp3`, `aac`, `flac`, `wav`, `ogg`, `webm`, `mkv`, `mov`, `avi`, `ts`, `flv`
- Subtitle: `vtt`, `srt`, `ass`, `ssa`, `ttml`

## Known Limitations

- The current capture core has no dedicated Cat Catch differential test suite.
- Deep runtime capture is not currently active beyond the surrounding `MSE` hooks.
- Manifest parsing, downloader behavior, cancellation, cleanup, and large-media budgets still require behavior fixtures and integration tests.

## Attribution

Some embedded-browser resource-capture logic in this project is adapted from cat-catch:

- Project: [cat-catch](https://github.com/xifangczy/cat-catch)
- License: `GPL-3.0-only`

See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for source, usage, and license details.

## Development

```bash
npm install
npm run build
```

`npm run build` 只执行 TypeScript、renderer、Electron main/preload 编译，不调用平台打包或代码签名。

生成分平台安装包时使用：

```bash
npm run build:mac
npm run build:win
```

`build:mac` 是底层打包入口，会进入 macOS 代码签名；正式 macOS 发版应使用 `npm run release:mac -- <version> [--publish]`，由发布脚本自动解锁独立签名钥匙串。

macOS 交叉生成的 Windows 安装包仍需在 Windows 10/11 或 Windows 11 ARM 虚拟机中运行验证。

开发模式会通过受版本控制的 `.env.development` 默认连接本机 `http://127.0.0.1:8850/api`，不依赖云端 Tailscale。生产构建继续读取未提交的 `.env.local`，其中可以配置云端 Go；使用 Tailscale Serve 时填写 `https://<machine>.<tailnet>.ts.net/api`，宿主系统需要登录对应 tailnet。未配置任何环境变量时，后端地址也回退为本机地址。

多 MinIO 节点的 renderer CSP 允许列表由 `VITE_STORAGE_ORIGINS` 提供，支持空格或逗号分隔，例如：

```dotenv
VITE_API_BASE_URL=https://<machine>.<tailnet>.ts.net/api
VITE_STORAGE_ORIGINS="http://<windows-minio>:9000 http://<mac-minio>:9000"
```

`vite.config.ts` 会把 API、WebSocket 和存储 origin 同时写入 dev server CSP 与构建后的 HTML；修改网络地址时不要直接手改 `index.html` 中的固定主机名。

本机常用启动脚本在 `~/script/omniflow-app.sh`。默认 `dev` 会随代码修改刷新；`stable` 跑已构建的 `dist`，并通过独立 `userData` 目录和 dev 隔离。

## Documentation

Key frontend documents live in the repo and should be treated as part of the development baseline:

- `docs/frontend-architecture-baseline.md`: current renderer / Electron layering, state ownership, and IPC boundary rules
- `docs/desktop-platform-architecture.md`: macOS / Windows host strategy, renderer platform bridge, and platform validation
- `docs/embedded-browser-architecture.md`: embedded browser lifecycle, capture, download, and main/preload responsibilities
- `docs/cat-catch-full-migration-execution-plan.md`: authoritative Cat Catch rearchitecture and completion contract
- `docs/library-detail-workspace.md`: library detail workspace modes, browser tab ownership, and persistence rules
- `docs/file-explorer-file-viewer-boundary.md`: file tree, file-open flow, viewer tabs, and dispatcher ownership
- `docs/frontend-validation-matrix.md`: manual verification baseline for frontend and Electron changes
- `docs/cat-catch-migration-audit.md`: current verified facts and gaps for the Cat Catch migration
- `THIRD_PARTY_NOTICES.md`: attribution and license information for incorporated third-party work
- `.agent-docs/frontend-review-standard.md`: review gate for frontend and Electron changes
- `.agent-docs/frontend-handoff.md`: maintenance handoff and entry map
