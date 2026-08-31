# Cat Catch Electron Host Smoke

更新时间：2026-08-30

该目录提供一个显式运行的真实 Electron 宿主验证，不进入普通 `npm test`：

```bash
npm run cat-catch:smoke-host
```

macOS 上需要显式验证真实系统保存对话框时运行：

```bash
npm run cat-catch:smoke-save-dialog
```

该模式会显示应用窗口并依次打开两个系统保存对话框。第一个必须取消，第二个使用预填的隔离临时路径确认；脚本随后通过生产 `fs:save-staged-download-file` IPC 写出文件并校验字节。对话框结果或目标路径不符合预期时 smoke 失败。默认命令不弹窗，CI 和普通回归仍可无人值守运行。

需要显式验证 bounded 大文件宿主链时运行：

```bash
npm run cat-catch:smoke-large-host
```

该模式从 loopback server 流式生成 64 MiB 确定性响应，经真实 `DownloadItem`、main staging、renderer crash/replacement、生产保存 IPC 和终态清理完成交付；服务端不构造完整 64 MiB Buffer，校验端以文件大小和流式 SHA-256 验证字节。它用于补充真实宿主的大文件证据，不代表多 GiB、真实媒体解码或长墙钟验收。

脚本会在隔离的临时 `userData` 中启动隐藏应用 BrowserWindow 和使用 `persist:omniflow-embedded-browser` partition 的 `WebContentsView`，只访问随机 loopback server，并直接组合生产实现：

- `EmbeddedBrowserCaptureRuntime` / `CapturedResourceAccessService`
- `initializeEmbeddedBrowserDownloadBridge`
- `NativeDownloadSession` / `ProcessingTaskRegistry`
- `StreamingTransfer` / `StagedOutputLeaseStore` / `publishStagedOutput`
- `DownloadHandoffStore`
- `registerFileIpc` 的 `fs:save-staged-download-file`

file-backed MSE 取消还会复用 production `mse-download` registry、`stageMseDownloadResource` 与 `saveEmbeddedBrowserExtractedResourceFile`。脚本创建 256 MiB source，只有观察到实际 partial copy 后才按 tab 取消，并要求 AbortError、单任务命中、未发 completion、partial staging 删除和 registry 释放；这证明 file-backed MSE writer 的真实宿主取消，不代表 MSE merge 或所有协议入口已经逐条验收。

验证流程先通过 production document-start/current-document 注入入口安装页面 probe，在真实 Chromium 页面里让 Deep 的 `fetch`、inline script 和 `TextDecoder` 分支分别发现媒体/manifest，并让真实 `MediaSource` 创建 H.264 `SourceBuffer`、执行 `appendBuffer`，确认 4 bytes MSE 数据经 document token 进入 main 资源投影。随后页面发起带 partition session Cookie 与 Authorization 的媒体请求，确认 production network capture 只向 renderer 投影凭据能力而不泄露 header 值，并由 main-owned opaque resource ID 兑换 Cookie/Authorization、重放同字节响应。接着让 main 通过共享 `ProcessingTaskRegistry.run`、`StreamingTransfer` 和 staged publisher 下载慢速 64 MiB loopback response，确认 partial bytes 已落盘后按 `streaming-transfer + tabId` 取消，验证 target、partial、磁盘/内存 lease 和 registry 全部清理；如果本机存在 FFmpeg，再由同一 registry/staged publisher 启动 production `FfmpegTaskExecutor` 的 realtime lavfi fragmented MP4，观察到 partial 后按 tab 取消 outer task，确认 AbortSignal 传播到真实进程并清理 process tree、target、partial、lease 和 registry；最后启动慢速 64 MiB 真实 `DownloadItem`，按 `native-download + tabId` 取消并验证同样只命中一个任务、终态为 `cancelled`、partial staging 已删除且 registry 已释放。随后正常 native 下载完成 metadata 写入 main journal，强制终止独立应用 renderer，创建 replacement renderer，从新 store replay handoff，经真实 renderer IPC 保存同字节文件，最后确认 staging 与 journal 均已删除。所有临时目录在进程结束后清理。

该 smoke 不连接真实网站、账号、MinIO 或资料库。它证明隔离真实 Electron/Chromium 页面的 production Deep/MSE 注入和捕捉、真实网络事件、Cookie/Authorization authority，以及 native、普通 streaming 和一条真实 FFmpeg staged output 的 task registry 用户取消。FFmpeg 存在时结果包含 `supported: true`、实际 partial bytes、单一 outer task 命中和完整清理；不可发现时显式报告 `supported: false`，不伪造通过。该结果不证明外部网站的真实登录/媒体流程，也不把任务取消等同于用户在系统保存对话框中点击“取消”。完整 OmniFlow 登录态窗口、非第一个资料库交付、长媒体、MSE/协议输出逐入口宿主取消、其他 FFmpeg 调用入口与跨平台行为仍需独立验证；系统保存对话框取消/确认只由显式交互命令验收。
