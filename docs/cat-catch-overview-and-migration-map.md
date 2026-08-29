# Cat Catch 总览与迁移地图

更新时间：2026-08-29

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

当前固定目标为 Cat Catch `2cb981d7c2f4614732edccc167c4b5793d1cb138`。当前映射包含 7 个 unit 和 32 项 capability，184 个唯一计划测试引用已落成真实 pure behavior/contract、fake/real Electron integration 或 loopback redirect test。`network-capture`、`deep-search-runtime` 与 `hls-engine` 已全部验证并完成原子 cutover；Deep 的 production document factory 现在直接组合 stateful discovery、experience hooks、inline/Vimeo page helper、page-origin toolkit state、generated-resource owner 和 tokenized main ingress。旧 disabled hooks、manifest heuristic、Worker bootstrap、toolkit state、`probeResources` 及混合 host 已删除；11 个平台适配保留，17 个 `remove-after-cutover` 条目作为删除门禁继续由 validator 检查。MSE 已形成 page/spool 唯一 owner 但固定上游 parity 仍开放；DASH parser、`DashTaskExecutor`、`DashLiveTask`、main XML adapter 和 output adapter 已建立纯处理基座并接入现有 MPD 分析与生产 dispatch，Period/AdaptationSet/Representation SegmentTemplate、SegmentList、SegmentBase 继承、SegmentBase SIDX expansion、SegmentTemplate `endNumber`、SegmentTemplate dynamic client clock offset、SegmentList timeline、静态最后一片 duration 修正、同身份静态多 Period 串接、具备 availability 证据的动态有限 `r=-1` 展开和动态 duration-only 模板窗口已加入；带有限当前窗口的 dynamic snapshot 现可执行，持续 refresh/live IPC/output、复杂嵌套 SIDX、不完整或初始化冲突的多 Period 集合和真实媒体输出仍开放。其余 unit 仍开放；data/blob、未捕获派生 URL 等明确平台 fallback 不代表第二套已切换 owner 仍在运行。

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
- 迁移期间的旧位置：`docs/cat-catch/legacy-cleanup.json`。
- 当前已确认缺口：`docs/cat-catch-migration-audit.md`。
- 每次上游同步：`docs/cat-catch-sync-log.md`。

## 8. 阅读顺序

- 想理解概念和边界：本文。
- 想实施迁移：`docs/cat-catch-full-migration-execution-plan.md`。
- 想同步新上游：`docs/cat-catch-sync-maintenance-guide.md`。
- 想理解现有 Electron 生产链：`docs/embedded-browser-architecture.md`。
- 想理解处理结果如何进入资源库：`docs/captured-resource-flow-plan.md`。
- 想实现纯 port：`electron/service/embedded-browser/cat-catch-port/README.md`。

## 9. 保留原则

需要长期保留的是可执行行为、必要的平台集成、来源映射和测试，不是历史实现本身。每个 unit 验证切换后删除旧算法、旧 listener/handler、flag、fallback、无期限 wrapper 和旧 helper；全部 unit 完成后先带清理表通过最终校验，再同时删除临时 `legacy-cleanup.json`、legacy refs 及其专用校验分支/测试。回滚依靠 Git commit 或发布版本。
