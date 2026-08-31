# Cat Catch 总览与迁移地图

更新时间：2026-08-30

适用范围：帮助不熟悉 Cat Catch、媒体格式和 OmniFlow 内置浏览器捕捉链路的开发者建立全局视角。

状态：概念导览。本文不记录完成度；全面重构以 `docs/cat-catch-full-migration-execution-plan.md` 为权威，逐项状态以 `docs/cat-catch/capability-map.json` 为准，当前事实摘要见 `docs/cat-catch-migration-audit.md`。

## 1. 核心模型

Cat Catch 的价值不是某个按钮，而是多年积累的一条资源处理链：

```text
页面或网络出现资源
  -> 发现候选
    -> 判断类型与上下文
      -> 解析播放计划
        -> 下载、重试、解密或合并
          -> 交付文件
```

它的经验主要集中在：

- 何时观察网络请求，以及哪些 headers、URL 和 tab 状态必须一起保留。
- 如何从 Worker、fetch/XHR、JSON、TextDecoder、内联文本和 MSE 中发现资源。
- 如何识别 HLS、DASH、直链和页内缓存流。
- 如何处理 key、map、BYTERANGE、variant、track、live、retry 和异常分片。
- 如何在导航、取消、关闭 tab、进程退出和失败时回收任务与临时资源。

OmniFlow 的目标不是运行浏览器扩展，也不是逐文件照搬，而是忠实迁移这些与产品相关的行为，再用 Electron 的主进程、文件系统、ffmpeg 和 UploadManager 做平台等价适配。

## 2. 常见资源类型

### 2.1 HLS / m3u8

`m3u8` 是播放清单，通常引用媒体分片，也可能包含：

- master playlist 与多清晰度 variant。
- 独立音轨或字幕 rendition。
- AES key。
- `EXT-X-MAP` 初始化片段。
- `BYTERANGE` 字节范围。
- live playlist 与持续新增的分片。

正确实现不只是“能解析文本”，还包括 URL 解析、隐式 offset、下载顺序、重试、解密、伪装分片预处理、取消和输出字节语义。

### 2.2 DASH / MPD

`mpd` 是另一种播放计划，常把视频、音频、初始化片段和媒体片段分开描述。重点边界包括多层 `BaseURL`、`SegmentTemplate`、`SegmentTimeline`、负 repeat、动态 MPD、range、轨道选择和 DRM 拒绝语义。

### 2.3 MSE

MSE 页面通过 `MediaSource` / `SourceBuffer.appendBuffer()` 增量喂入媒体。稳定 URL 可能不存在，因此需要在页面运行时观察 append、区分音视频、控制页面内存、增量写入 main spool，并在 reset、end-of-stream、导航和关闭时正确收口。

### 2.4 直链资源

直链资源有稳定 HTTP(S) URL，看似简单，但仍需要处理请求上下文、Range、大响应内存、失败 fallback、文件名、取消、临时文件与最终交付。

## 3. Cat Catch 能力族

### 3.1 网络捕捉

- 请求发送、首字节、失败、重定向和终态清理。
- request headers 与受保护上下文。
- URL、MIME、扩展名、regex、黑白名单和去重规则。
- tab/navigation 归属与资源状态。

### 3.2 页面深搜

- document-start 注入与 all-frame 语义。
- Worker、fetch、XHR、JSON、TextDecoder 和内联 manifest/key 发现。
- 页面事件到 main 的可信 relay。
- 页面工具设置、重载和缓存重置。

### 3.3 MSE 捕捉

- MediaSource/SourceBuffer hook。
- 音视频分轨、append 可观察性和 flush。
- 页面缓冲预算、main spool、恢复和清理。

### 3.4 HLS 与 DASH

- parser 与下载计划。
- key、map、range、variant、rendition、track 和 timeline。
- 分片并发、重试、abort、顺序输出和 merge。
- live、动态清单、异常格式和明确拒绝。

### 3.5 传输与输出

- downloader session、内存预算、临时目录和 task registry。
- ffmpeg 进程、取消、退出和终态。
- 本地保存、普通下载、外部工具与资料库导入。
- staged output lease 和 processing/delivery 的单一状态 owner。

扩展 popup、options、side panel 的 CSS、翻译和纯视觉行为默认不迁。扩展 service worker、Chrome action、context menu、Blob 下载限制 workaround 等实现方式也不直接照搬；但排除前必须检查它们是否携带行为默认值、依赖或脚本入口。

## 4. Cat Catch 与 OmniFlow 的边界差异

| 维度 | Cat Catch | OmniFlow |
| --- | --- | --- |
| 运行环境 | 浏览器扩展 | Electron 桌面客户端 |
| 页面承载 | 浏览器 tab | main-owned `WebContentsView` |
| 平台通信 | extension message | preload / IPC / isolated page relay |
| 重处理 | 扩展页与浏览器下载能力 | Electron main、文件系统与 ffmpeg |
| 输出 | 浏览器下载或外部工具 | 本地保存、外部工具或 UploadManager |
| 回收边界 | 扩展 tab/page 生命周期 | tab、view、task、temp、进程和应用退出 |

因此迁移时应区分两类内容：

- `cat-catch-port`：协议、识别、解析、计划、重试等纯行为与经验分支。
- OmniFlow adapter/integration：Electron 网络事件、页面注入、IPC、安全、文件、ffmpeg、资料库和用户工作流。

## 5. 目标分层

```text
renderer
  -> preload / typed contracts
    -> orchestration
      -> Electron network/page adapters
        -> cat-catch-port pure behavior
      -> task / filesystem / ffmpeg processing
        -> local save / external tools / UploadManager integration
```

`cat-catch-port` 不依赖 Electron、React、IPC、Node 文件系统、ffmpeg 或资料库。平台层负责输入适配和生命周期，不应重新实现 classifier、parser 或 downloader 算法。

## 6. 七个 Cutover Unit

| 顺序 | unit | 范围 |
| --- | --- | --- |
| 1 | `network-capture` | 请求时机、context、规则、分类、去重、资源状态和跨进程合同 |
| 2 | `deep-search-runtime` | document-start、Worker/fetch/XHR/JSON/TextDecoder、manifest/key 与安全 relay |
| 3 | `mse-runtime` | page capture、main spool、预算、reset、finalize 和清理 |
| 4 | `hls-engine` | parser、plan、key/map/range、分片、live、retry 和预处理 |
| 5 | `dash-engine` | parser、BaseURL、timeline、track、range、下载和 merge |
| 6 | `transfer-engine` | 并发、重试、abort、顺序、session、内存预算和 task registry |
| 7 | `output-integration` | staged output、ffmpeg、本地保存、资料库、普通下载、外部工具和工作流投影 |

unit 是生产切换与删除旧实现的最小边界。可以在 unit 内逐项开发和测试，但不能让新旧 listener、hook、parser 或 downloader 在生产中长期并存。

## 7. 当前状态怎么判断

当前固定目标为 Cat Catch `2cb981d7c2f4614732edccc167c4b5793d1cb138`。当前映射包含 7 个 unit 和 32 项 capability、260 个唯一 active 测试引用、235 个计划测试 ID，均以 capability map 为准；32 项 capability 均为 `verified`，7 个 unit 已完成固定目标下的 target owner cutover。旧深搜/网络/HLS/DASH renderer 算法和 `embeddedBrowserFragmentDownloader` 兼容出口已删除；DASH parser、下载/直播任务、主进程 XML adapter、SIDX、authority、IPC、staged output 和真实 FFmpeg/FFprobe 输出均已有 target 证据。output integration 的应用级完成队列 journal、启动清理/重启复位、auth-session 隔离、UploadManager 终态分类和冻结 target 已有固定目标下的契约证据；staged lease 有意保持 main-only，不需要新增 renderer IPC。真实宿主交付、资料库 smoke、冻结 target 的宿主确认、renderer crash/restart 和大媒体长时间运行属于第二阶段补测。data/blob、未捕获派生 URL 等明确平台 fallback 不代表第二套已切换 owner 仍在运行。

截至 2026-08-30，capability map 的最新统计为 260 个唯一 active 测试引用、235 个计划测试 ID；初始迁移的临时 cleanup 台账已完成校验并删除。普通直链、已捕获资源、HLS/MPD 直拉、HLS 计划下载、独立轨合并、HLS 直播停止导出、DASH 静态计划、DASH 直播停止导出和手动 MSE 合并已接入 staged output lease。HLS/DASH live 各自通过 32 个重叠窗口验证多轮增量去重和停止清理，并以真实 timer 同时运行 production live/filesystem append 5 分钟，得到 HLS 201 个唯一分片和 DASH 301 个唯一分片；stop、输出、part 清理和 RSS 预算均通过。静态 HLS/DASH 分片链通过 async sink 把写盘纳入 transfer worker 终态，HLS 不再保留无界 pending write，DASH 通过独立 part 文件和固定 1 MiB 缓冲顺序拼接。显式协议 smoke 已覆盖总 512 MiB 和总 2 GiB；后者让两条链各处理 1 GiB，整进程峰值 RSS 为 `225,099,776` bytes、无 swap。显式 FFmpeg smoke 还通过 production merge/transcode 验证超过 128 MiB 的 H.264/AAC 合并与超过 192 MiB 的 PCM 解码/MP3 编码，峰值 RSS `125,829,120` bytes、无 swap；显式真实媒体 smoke 使用 Mux HLS 与 Akamai DASH，分别解析 production manifest、下载真实音视频分片并得到 H.264/AAC 的 30 秒与 12 秒 MP4。`ProcessingTaskTerminal` 把处理终态、暂存就绪和交付终态拆开记录；应用级完成队列新增 versioned journal、重启恢复、auth-session 隔离和单下载单飞交付保护；main 初始化会在 renderer replay 前清理无效 handoff，session 初始化会主动清理 lease 崩溃残留，正常退出会释放进程内 lease。隔离 Electron 已通过真实页面 Cookie/Authorization 捕捉/opaque authority、renderer crash/restart 和 64 MiB bounded output；真实资料库交付、完整应用/跨平台宿主、外部网站真实登录流程和更长宿主墙钟继续作为第二阶段补测。

隔离的真实 Electron boundary smoke 已可重复执行：`npm run cat-catch:smoke-host` 使用实际 embedded partition `WebContentsView`，先验证带 partition session Cookie 与 Authorization 的页面媒体请求经 production capture 形成无凭据 renderer 投影并由 main opaque authority 重放相同 46 bytes，再经 native `DownloadItem`、main handoff、强制应用 renderer 终止、replacement renderer 与生产文件 IPC 验证同字节保存和终态清理；`npm run cat-catch:smoke-large-host` 用流式生成的 64 MiB 响应重复该链，并以文件大小和流式 SHA-256 校验字节。`npm run cat-catch:smoke-save-dialog` 还已在 macOS 真实系统保存框中先取消、再确认隔离临时目标，并继续通过 production save IPC、字节一致和 staging/journal 清理。第二阶段剩余“真实交付/renderer crash”现在指完整登录态应用、非第一个资料库与跨平台宿主；协议分片、本地 FFmpeg 大媒体、5 分钟 production live 墙钟、公开真实 HLS/DASH parser-to-FFprobe、Cookie/Authorization 页面捕捉和 macOS 系统保存框已有显式证据，外部网站真实登录流程和更长宿主运行仍独立待验。

同一真实 Electron smoke 还会依次验证七条 production task registry 用户取消路径：普通流式输出写出至少 64 KiB partial 后清理 target/lease；256 MiB file-backed MSE copy 在 partial 出现后中断且不发 completion；HLS 与 DASH 各自在慢速分片实际传输 64 KiB 后按协议 owner 取消、跳过 ffmpeg/track merge，并清理 target、lease、workdir 与 DASH part；本机存在 FFmpeg 时，以 realtime lavfi/fragmented MP4 验证 signal 传播到真实进程和 process tree，再以两个慢速 fragmented MP4 HTTP 输入验证 production MSE 双轨 merge 在视频 `30,720` bytes、音频 `512` bytes 后取消并清理 staged output；不可发现时两项都报告 `supported=false`；慢速 64 MiB `DownloadItem` 则到达 `cancelled` 终态并删除 partial staging。每条 registry filter 都只命中一个 task，终态 registry 归零。全部 Cat Catch 相关 FFmpeg wrapper 另由定向 signal contract 与 production owner 审计覆盖，共享 executor 的真实宿主证据不再按薄 wrapper 重复。系统保存框取消/确认由独立交互 smoke 验收；这些隔离 smoke 仍不替代完整登录态资料库或 Windows 验收，也不进入 capability map 的日常 active test ref。

真实页面 probe 也已进入同一 smoke：production document-start/current-document 注入在实际 Chromium `WebContentsView` 中覆盖 Deep `fetch`、inline script、`TextDecoder`，以及真实 H.264 `SourceBuffer.appendBuffer` 的 4 bytes MSE 捕捉，main store 收到 document-token-scoped media/manifest/MSE 投影。这是隔离浏览器引擎证据，不是外部网站或真实登录播放器证据；后者继续独立待验。

Cat Catch 的下载 fallback 已确认是扩展平台分支，不是仍缺失的媒体算法：缺失 `chrome.downloads` 时只退回不可观察终态的 anchor click；特定 native error fallback 只针对右键 image-save，并依赖隐藏 downloader tab、扩展 session 和 auto-close。OmniFlow 用 `NativeDownloadSession + DownloadHandoff` 持有原生下载终态，用 main-owned captured-resource authority 持有受保护重试；不复制隐藏页，也不在 ambiguous native failure 后自动发起可能重复的下载。该差异保留在 `transfer.downloader-session-lifecycle` 的 upstream anchor/accepted difference 中，后续上游变化仍可追溯。

本轮已关闭 `dash-engine`：renderer 仅保留 `parseEmbeddedBrowserMpdDocument` DOM adapter，解析和计划语义由 `cat-catch-port/dash` 唯一持有；静态 MPD 计划的分片下载和单/双轨 ffmpeg 合并只写入 main-only lease，成功后才发布到最终 `outputPath`，DASH active task 由 DASH session owner 负责取消。DASH live recorder 的工作目录和停止导出已有独立生命周期测试；已完成 output 的重启 handoff 归 output integration 且已有 target 证据，active recorder 跨进程续录不属于固定目标能力。

DASH live 的停止导出现在也遵守同一 lease 规则：冻结轨道先在暂存路径合并，发布成功后才结束 session 并删除 workdir。固定 Cat Catch 的 live recorder 只持有页面内存状态，页面卸载时会 abort 流，因此 OmniFlow 的 active HLS/DASH session 同样按当前 tab/view/进程生命周期收口；durable 跨卸载/跨进程续录只作为未来可选平台增强，不属于迁移缺口。

已捕获资源转码同样经过 main-only staged lease，处理失败不会覆盖用户已有目标；它仍使用现有 ffmpeg executor，并按 tab 登记到共享 task registry。native `DownloadItem`、普通 streaming output、file-backed MSE output、MSE 双轨 merge、HLS/DASH 静态协议传输与一条真实 FFmpeg staged output 的 registry 用户取消已经验证；manifest 单/双轨、HLS 本地轨、DASH 单/双轨、live stop/export、MSE merge/transcode 的 wrapper 均已确认透传 owner signal，因此 FFmpeg 取消链不再有泛化的逐入口缺口。macOS 系统保存框取消/确认也已通过；最终资料库交付、完整登录态应用和 Windows 仍待环境验收。

MSE 手动音视频合并现在也经过 staged lease；MSE 自动完成和周期保存沿用 download staging root + download/import 事件链，capture/spool unit 已关闭，交付终态仍归 output-integration owner。

旧代码中存在网络捕捉、MSE、HLS、DASH、下载、ffmpeg 和资料库导入入口，只能说明有 characterization 输入，不能据此宣称已经迁移。完成一项能力至少需要：

1. 固定上游来源和行为依赖。
2. 建立能失败的真实 fixture/test。
3. 在纯 port 或明确的 adapter 中实现。
4. 通过行为、集成、输出和清理验证。
5. 在 unit 的唯一 dispatch boundary 切换 owner。
6. 同一切片删除对应旧实现与兼容分支。

具体状态查询：

- 版本游标：`docs/cat-catch/upstream-state.json`。
- 能力、来源、目标和测试：`docs/cat-catch/capability-map.json`。
- 当前实现引用：`docs/cat-catch/capability-map.json` 中各 capability 的 `currentImplementationRefs`；已删除的历史实现不再单独建账。
- 当前已确认缺口：`docs/cat-catch-migration-audit.md`。
- 每次上游同步：`docs/cat-catch-sync-log.md`。

file-backed MSE writer 也已进入同一 smoke：production `mse-download` registry、`stageMseDownloadResource` 与 signal-aware `saveEmbeddedBrowserExtractedResourceFile` 用 256 MiB source 启动真实复制，只有观察到 partial 后才按 tab 取消；默认/64 MiB 两档分别在 `1,245,184`/`1,376,256` bytes 停止，且 completion 未发出、partial staging 与 registry 均清理。手动 captured-resource 输出复用同一个 writer/signal。MSE 双轨 merge 另用两个真实 fragmented MP4 慢速输入和 production merge service 验证中途取消；其他 FFmpeg wrapper 由 signal/owner contract 与共享 executor 证据覆盖，不再重复逐入口宿主 smoke。

## 8. 阅读顺序

- 想理解概念和边界：本文。
- 想实施迁移：`docs/cat-catch-full-migration-execution-plan.md`。
- 想同步新上游：`docs/cat-catch-sync-maintenance-guide.md`。
- 想理解现有 Electron 生产链：`docs/embedded-browser-architecture.md`。
- 想理解处理结果如何进入资源库：`docs/captured-resource-flow-plan.md`。
- 想实现纯 port：`electron/service/embedded-browser/cat-catch-port/README.md`。

## 9. 保留原则

需要长期保留的是可执行行为、必要的平台集成、来源映射和测试，不是历史实现本身。每个 unit 验证切换后删除旧算法、旧 listener/handler、flag、fallback、无期限 wrapper 和旧 helper；固定目标下的全部 unit 已完成初始清理，后续不再维护历史删除清单。回滚依靠 Git commit 或发布版本。
