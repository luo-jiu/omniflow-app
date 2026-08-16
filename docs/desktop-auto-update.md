# 桌面客户端自动更新

更新时间：2026-08-15
适用范围：OmniFlow Electron 客户端的版本检测、更新下载、重启安装、本地更新源验证和后续正式发布。

个人长期签名身份、`0.2.0` bootstrap、证书恢复和日常发布命令见 `docs/local-macos-signing-and-release.md`。

## 1. 当前结论

- 当前只在打包后的 macOS 客户端启用应用内更新；Windows 更新暂未接入。
- 更新能力使用 `electron-updater`，更新状态由 Electron main 的 `AppUpdateService` 单一持有。
- Renderer 只通过 typed preload bridge 读取状态并发起检查、下载、安装，不直接依赖 `electron-updater` 或原始 IPC channel。
- 默认行为是自动检查、手动下载、手动重启安装。客户端启动 15 秒后检查一次，之后每 6 小时检查一次。
- 更新源由打包时的 `VITE_UPDATE_BASE_URL` 注入。正式更新源必须使用 HTTPS；仅本机验证允许 `http://localhost`、`http://127.0.0.1` 或 `http://[::1]`。
- 本机个人发布使用长期自签名身份 `OmniFlow Local Update`；一次性配置命令为 `npm run signing:setup:mac`。使用同类受信任身份已验证 `0.1.0 -> 0.1.1` 的检测、下载、退出、原地替换和 `userData` 保留。公开分发仍必须使用 Developer ID 签名与 notarization。

## 2. 状态与边界

更新状态依次为：

```text
disabled / idle
  -> checking
  -> up-to-date | available | error
  -> downloading
  -> verifying
  -> downloaded
  -> installing
```

关键边界：

- `electron/service/appUpdateService.ts` 持有唯一更新状态、自动检查 timer 和持久日志。
- `electron/service/appUpdateIpc.ts` 只注册更新 IPC，不承担状态编排。
- `electron/preload.ts` 暴露 `electronAppUpdate` typed bridge。
- `src/features/app-update/` 负责 renderer service、类型和设置页交互。
- 持久日志位于 Electron `userData/app-update.log`，超过 1 MiB 时从空文件重新记录。
- 下载开始后不重复发起检查；下载完成后由用户显式触发重启安装。
- macOS 调用 `quitAndInstall` 后必须显式退出 Electron 进程，否则 ShipIt 会持续等待旧进程释放应用包，无法立即执行替换。

## 3. 更新源

更新 feed 是普通静态文件目录，不经过 Go API，也不放在 Mac / Windows 媒体 MinIO 节点。当前国内服务器目录为 `/srv/omniflow/desktop-updates/stable/mac-arm64`，通过 Tailscale Serve 的 `/desktop-updates/stable/mac-arm64/` 暴露；实际 HTTPS 域名只保存在 `.env.local`。

macOS feed 至少包含：

- `latest-mac.yml`
- ZIP 更新产物
- DMG 首次安装产物
- 对应 blockmap

发布时必须先上传不可变的安装包、ZIP 和 blockmap，确认可下载后最后替换 `latest-mac.yml`。旧版本产物需要保留，不能只留下最新清单。

## 4. 本地验证

在 `.env.local` 中临时配置：

```dotenv
VITE_UPDATE_BASE_URL=http://127.0.0.1:8899
```

构建高于已安装版本的 macOS 产物后，从对应 release 目录启动本地 feed：

```bash
npm run update:serve -- release/<version> 8899
```

验证顺序：

1. 手工安装首个包含 updater 的 bootstrap 版本。
2. feed 中放置更高 semver 版本的 `latest-mac.yml`、ZIP / DMG 和 blockmap。
3. 从设置工作区点击“检查更新”，确认显示新版本。
4. 点击“下载更新”，确认进度能够推进并进入 `downloaded`。
5. 配置有效签名后点击“重启并安装”，确认应用退出、替换并以新版本重启。
6. 确认 Electron `userData`、登录态和工作区缓存没有因覆盖安装被删除。

开发模式不会执行应用内更新。不能用 Vite dev server 代替打包应用验证 updater。

## 5. 个人发布

首次配置本机长期签名身份：

```bash
npm run signing:setup:mac
```

证书私钥保存在独立 macOS keychain；加密 `.p12` 备份位于 `~/Library/Application Support/Omniflow/signing/`，备份密码保存在登录 keychain。证书和密码不得进入仓库。

构建但不上传：

```bash
npm run release:mac -- 0.2.0
```

确认本地产物后发布到国内服务器：

```bash
npm run release:mac -- 0.2.0 --publish
```

发布脚本先上传 DMG、ZIP 和 blockmap，最后上传 `latest-mac.yml`。当前旧 `0.1.0` 不具备 updater，需要手工安装一次首个已签名 bootstrap；之后版本才走应用内更新。

已发布版本不可重新签名覆盖；发布脚本会读取远端 manifest，并拒绝相同或更低版本。任何修复都必须提升 semver 后向前发布。

## 6. 发布约束

- 每次发布必须提升 `package.json` 的 semver；相同版本不会触发更新。
- 首个带 updater 的版本仍需手工安装，只有后续版本才能被自动发现。
- 正式发布前必须先在独立 test feed 验证旧版到新版的完整升级。
- 更新失败时通过更高版本向前修复，不使用降级覆盖。
- 更新 feed 不携带账号密码或长期 token；访问控制依赖 tailnet。
- macOS 正式验收必须包含签名校验、notarization、下载、重启安装和 Gatekeeper 行为。

## 7. 维护规则

出现以下变化时更新本文：

- Windows 自动更新启用。
- 更新地址、频道、检查频率或下载策略变化。
- IPC / preload 契约或状态 owner 变化。
- 签名、notarization、发布脚本或服务器静态目录变化。
