# Cat Catch 当前迁移摘要

更新时间：2026-08-30

状态：固定目标下的初始迁移已完成。本文只总结已确认事实，逐项状态以 `docs/cat-catch/capability-map.json` 为准；真实宿主和极端场景属于后续地毯式补测。

## 1. 当前版本

| 字段 | 值 |
| --- | --- |
| baseline / observed / target | `2cb981d7c2f4614732edccc167c4b5793d1cb138` |
| upstream description | `2.7.2-22-g2cb981d` |
| reviewedThrough | `2cb981d7c2f4614732edccc167c4b5793d1cb138` |
| portedThrough | `2cb981d7c2f4614732edccc167c4b5793d1cb138` |

当前映射包含 7 个 cutover unit、32 项能力、212 个上游 anchor 和 235 个唯一计划测试 ID；32 项能力均为 `verified`，当前没有 `pending` 或 `ported-unverified` capability。260 个唯一 active test ref 已落成 active pure behavior/contract、fake/real Electron integration 或 loopback redirect test，已落地 target owner 覆盖为 `32/32 = 100%`，固定目标下的初次迁移完成度为 `32/32 = 100%`。7 个 unit 均已完成原子 cutover，初始 legacy cleanup 已校验并删除；HLS/DASH 分片传输由 `TransferEngine` 唯一持有，HLS/DASH session owner 已接入统一 `ProcessingTaskRegistry`，旧 `embeddedBrowserFragmentDownloader` 兼容出口和 DASH renderer parser/planner 已删除。DASH parser/task/live/output adapter、staged output、应用级完成队列和 native download session 均已有 target owner 与定向证据；完成队列具备带年龄上限的版本化 journal，可在 renderer/app 重启后恢复待交付文件并将进行中状态复位为 `pending`，main 启动初始化会在任何 renderer replay 前清理过期、缺失或越界的 handoff 记录，renderer hydration 再以 main handoff 列表对账陈旧项；auth-session clear 会删除 journal、清理非活动排队暂存并隔离旧会话事件；UploadManager 交付具备显式终态分类和冻结 library target 的共享适配。Staged output lease 有意保持 main-only，当前没有需要 renderer 领取 lease 的生产入口，因此不新增 lease IPC；真实 Electron 页面 Cookie/Authorization 捕捉/opaque authority 和 64 MiB 下载/崩溃/replay/保存/清理链已通过，HLS/DASH 多分片写盘背压也已有 bounded 自动化证据，显式协议 smoke 已覆盖总 512 MiB 与总 2 GiB，2 GiB 档的整进程峰值 RSS 为 `225,099,776` bytes、无 swap；production merge/transcode 还通过超过 128 MiB H.264/AAC 与超过 192 MiB PCM 输入验证真实 FFmpeg 大媒体预算；HLS/DASH production live/filesystem append 的 5 分钟真实 timer 档也已通过；公开真实 HLS/DASH 还分别贯穿 production parser、真实媒体分片、production FFmpeg 和 FFprobe。完整资料库交付、完整应用 crash/restart、跨平台宿主、外部网站真实登录流程和更长宿主墙钟仍是第二阶段补测项，不代表初次 port 尚未完成。

## 2. 能力族

本轮当前事实校正：`capability-map.json` 现有 `260` 个唯一 active test ref；应用级 output journal 在 auth-session clear 时会删除 journal 并清理非活动排队暂存，活动交付保留到自身终态；UploadManager 交付终态和冻结 library target 已由共享 adapter 接入；embedded browser session 初始化会主动执行 staged output quarantine/reap，并在 renderer replay 前收口 download handoff journal 的过期/缺失记录，正常应用退出会显式释放仍在进程内的 staged output lease。HLS/DASH live 各有 32 个重叠窗口的 bounded continuity 证据，并以真实 timer 同时运行 production live/filesystem append 5 分钟；静态协议链另有 async sink、写失败不触发网络 retry、HLS 独立分片写盘和 DASH 固定 1 MiB 顺序拼接证据，普通 native output 链还有真实页面 Cookie/Authorization 捕捉/opaque authority 和 64 MiB Electron bounded smoke；协议分片写盘已有总 2 GiB 证据，本地 production FFmpeg merge/transcode 也已有大媒体预算；公开真实 HLS/DASH 网络媒体闭环也已通过。外部网站真实登录流程、完整应用、跨平台和更长宿主墙钟仍待验证。固定 Cat Catch 只在 `m3u8.js` 页面内保存 `recorder`、`recorderLast` 与 `fileStream`，`beforeunload` 会 abort 文件流，因此 active live 跨页面/跨进程续录不是 parity 待办；未来若实现，只作为 OmniFlow 可选增强。Staged lease 不跨 IPC 是安全边界，不是待实现功能。审计中的历史切片条目保留当时计数，当前总数以 capability map 和最新 sync log 为准。

真实宿主证据更新：`npm run cat-catch:smoke-host` 已在 macOS Electron 30.5.1 中使用真实 embedded partition `WebContentsView` 发起带 partition session Cookie 与 Authorization 的媒体请求，production capture runtime 经真实 session `webRequest` 形成只含 `hasCookie/hasAuthorization`、不含 header 值的 renderer 投影，main opaque authority 再兑换两项凭据并重放相同 46 bytes。随后同一 smoke 触发 native 下载，在独立应用 renderer 强制终止后由 replacement renderer replay main journal、通过生产保存 IPC 写出相同字节，并清理 staging 与 journal。`npm run cat-catch:smoke-large-host` 以流式生成的 64 MiB 确定性响应重复同一链，并以文件大小和流式 SHA-256 验证 staging 与最终输出；`npm run cat-catch:smoke-save-dialog` 已在 macOS 真实系统保存框中分别完成取消和确认，并继续验证 production save IPC、同字节输出与 staging/journal 清理。当前“真实 renderer crash/download”缺口特指完整 OmniFlow 登录态窗口、真实资料库和其他平台，不再指基础 Electron boundary、Cookie/Authorization 页面捕捉、系统保存框或 bounded 大文件未运行。

直播墙钟证据更新：`npm run cat-catch:smoke-live-wall-clock` 以真实 timer 同时运行 production `HlsLiveTask` 与 `DashLiveTask + appendDashRepresentationSegments`。5 分钟 macOS 正式档得到 HLS 201 个唯一分片、DASH 301 个唯一分片，所有资源只请求一次；stop 后不再轮询，playlist、轨道字节与 part 清理通过，整进程峰值 RSS `138,690,560` bytes、无 swap。该结果关闭 bounded 5 分钟 production live 墙钟，不冒充外部网站真实登录流程、完整应用、Windows 或更长夜间运行。

宿主取消证据更新：同一 host smoke 先让普通流式输出通过 production `ProcessingTaskRegistry.run`、慢速 loopback HTTP、`StreamingTransfer` 和 `publishStagedOutput` 写出 65,536 bytes partial，再按 `streaming-transfer + tabId` 取消；默认档和 64 MiB 正常下载档均确认只命中一个 task，目标文件不存在、磁盘/内存 lease 与 registry 全部释放。本机存在 FFmpeg 时，harness 再以 realtime lavfi、fragmented MP4 和 production `FfmpegTaskExecutor` 写出 32 bytes partial，取消 tab-scoped outer task，并确认 AbortSignal 传播到真实进程、process tree 等待、target/partial/lease/registry 全部收口；不可发现时明确报告 `supported=false`。随后慢速 64 MiB 真实 `DownloadItem` 也按 `native-download + tabId` 取消，确认单任务命中、`cancelled` 终态、partial staging 删除和 registry 释放，再继续完成正常 download/crash/replay/save/cleanup。file-backed MSE writer 另在 256 MiB copy 的 partial 阶段中断且不发 completion。FFmpeg 调用点审计确认全部 Cat Catch 相关 wrapper 由 tab-scoped owner 启动并透传同一 signal；共享 executor 真实宿主证据加 wrapper contract 已关闭泛化的逐入口缺口。系统保存对话框中的取消和确认已由独立交互 smoke 通过；资料库、完整登录态应用和 Windows 继续独立待验。

协议宿主取消证据更新：默认与 64 MiB 两档 host smoke 都用 production HLS/DASH session owner、task executor、`publishStagedOutput` 和慢速 loopback 分片进入真实 Electron main 链。在各自实际传输 `65,536` bytes 后，按 `hls-task/dash-task + tabId` 取消均只命中一个 task、返回 AbortError、跳过 ffmpeg/track merge，并清理 target、磁盘/内存 lease、workdir、DASH part 与 registry。该结果关闭静态 HLS/DASH 计划分片逐协议宿主取消；live stop/export 和其他 FFmpeg 入口没有由这一 loopback 结果冒充，而是由各自 signal/owner contract 与共享 executor 证据闭合。

MSE merge 宿主取消证据更新：host smoke 用真实 FFmpeg 生成独立 fragmented MP4 音视频轨，并通过两个慢速 loopback HTTP 输入进入 production `mergeEmbeddedBrowserResourceTracks`。默认与 64 MiB 两档都在视频 `30,720` bytes、音频 `512` bytes 后按 outer `streaming-transfer + tabId` 取消，只命中一个 outer task；共享 signal 中止内部真实 FFmpeg，返回 AbortError，并清理 target、磁盘/内存 staged lease 与 registry。该结果关闭手动 MSE 双轨 merge 入口，并与其他 wrapper 的 signal/owner contract 一起支撑共享 FFmpeg 生命周期结论；Windows 仍未验收。

真实页面 probe 证据更新：默认与 64 MiB host smoke 均通过 production `installEmbeddedBrowserResourceProbe` 和 `EmbeddedBrowserCaptureRuntime`，在实际 Chromium `WebContentsView` 中观察到 Deep `fetch`、inline script、`TextDecoder` 投影，并由真实 H.264 `SourceBuffer.appendBuffer` 捕捉 4 bytes MSE 数据；所有资源经 document token 进入当前 tab 的 main store。该证据关闭隔离真实浏览器引擎中的 probe 注入/基础 hook 缺口，不冒充外部网站真实登录、真实播放器状态、资料库交付或完整 OmniFlow 窗口。

下载 fallback 事实校正：长期文档此前把 “Cat Catch native BrowserWindow fallback” 保留为开放 gap，但 capability map 已将 `transfer.downloader-session-lifecycle` 定义为 `platform-substitute`。上游实际只有缺失 `chrome.downloads` 时无法监听终态的 anchor polyfill，以及右键 image-save 在特定 error 后打开隐藏 `downloader.html` 的扩展 tab/session/auto-close 流程；它不是通用媒体下载算法。OmniFlow 的原生下载由 `NativeDownloadSession` 持有，捕获资源重试由 main-owned exact authority 与 embedded session 持有，不在 ambiguous native failure 后自动双写。`js/polyfill.js#if (!chrome.downloads)` 已加入同一 capability 的上游 anchor，故该项关闭但仍可被后续同步发现。

公开网络媒体证据更新：`npm run cat-catch:smoke-real-media` 已同时覆盖 HLS 与 DASH。Mux HLS 贯穿 production parser/plan、3 个真实 TS、local playlist、共享 FFmpeg 与 FFprobe，输出 H.264/AAC、`30.000181s`、`864,407` bytes；Akamai DASH 贯穿 production XML adapter/parser、最低码率 H.264/AAC 选择、两轨 init + 各 3 个真实媒体分片、production task/merge 与 FFprobe，输出 `12.032s`、`411,257` bytes。11 个媒体 URL 均只请求一次，临时目录清理。真实 Electron 页面发现与 Cookie/Authorization opaque authority 由 host smoke 独立覆盖；外部网站真实登录流程或完整交付仍未覆盖。

| 能力族 | 当前实现 | 已知结论 |
| --- | --- | --- |
| network capture | verified target runtime + thin Electron/IPC/settings adapters | `EmbeddedBrowserCaptureRuntime` 是 production 唯一 listener/store/vault owner；Cat Catch 规则和 page policy、OmniFlow 设置、首字节分类、redirect/terminal cleanup、tokenized probe、opaque resource authority、renderer-safe reducer 与 owner lifecycle 均有专项证据。旧 bridge/state/classifier/main DTO 已删除；data/blob、未捕获拖拽与 DASH 分属其他开放 unit |
| deep-search runtime | verified production target + thin page/main adapters | 固定 `findMedia/toUrl` 的 width/depth/cycle、宽松 key、inline M3U8/MPD、data URL 和跨 hook base URL 回放已有 fixture；production installer 覆盖 Worker CSP 回退、bootstrap relay、fetch clone、XHR、JSON、TextDecoder 与 Cat Catch key/string 经验面。page-origin toolkit owner、generated-resource owner、tokenized document ingress、main store 与 bytes readback 已在唯一 document factory 贯通。旧 disabled hooks、manifest heuristic、Worker bootstrap、toolkit state/storage、`probeResources`、混合 core/host 和 compatibility wrapper 已同批删除 |
| MSE runtime | verified target page owner + main spool | `mse/runtime.ts` 持有 MediaSource/SourceBuffer 观察、per-track retention、flush/reset 和 drain；`mse-page.ts` 只负责页面动作与平台转接，并保留 Cat Catch 已开始播放媒体的 bounded auto-restart polling；`MseSpoolStore` 持有 main 临时文件、预算、TTL 和生命周期清理；页面已 flush 的轨道由 main 下载路径逐轨读取；自动完成、周期保存和工具触发的下载现在由 main 侧 `mse-download` task 串行处理，合并 ffmpeg 接收共享 `AbortSignal`，staging/完成事件失败会清理 owned file，并通过现有 download completion/import contract 交付，renderer 不再重复保存。完成下载事件现在由 `CapturedOutputWorkflowCoordinator` 持有应用级队列，library-detail 卸载/重挂载不会丢失待导入文件，失败/取消文件在无挂载页面时也会清理。新增默认关闭的 `saveEveryGigabyte`：每次 flush 后按所有轨道累计总字节跨越 1 GiB 才串行触发 main 输出，成功后清理 page cache 和 spool，下一周期可重新计数；浏览器初始化时会按 24 小时 TTL 清理 download staging root 中上次运行遗留的文件。MSE page/spool/runtime、relay、周期输出阈值、真实双轨输出和 cleanup 证据已关闭该 unit；资料库交付、应用重启恢复、冻结 library target 和 crash quarantine 仍由 output-integration 独立负责。 |
| HLS engine | verified target parser/plan/local/live execution + thin main adapter + main-owned direct/track authority | 固定目标的下载相关 parser/plan、key/MAP/range、manual key、AES-128/256、静态/直播、独立双轨、retry/cancel、authority、force-cache recovery、生命周期和真实 ffmpeg/ffprobe 输出均有同名证据；本地分片通过 async sink 直接写独立文件，pending write 数受 thread 限制且 partial write 会清理；生产与测试直接依赖 shared contract、pure port、`HlsTaskExecutor`、`HlsLiveTask` 和 session owner，旧 renderer model、顶层 downloader/recorder re-export 及 legacy-named handler 已在同一切片删除；未捕获派生 URL 的 embedded-session fallback 是保留的平台 adapter，不是旧 HLS 算法 |
| DASH engine | verified target parser/task + main live/output adapters | `cat-catch-port/dash/parser.ts` 已覆盖 Period/AdaptationSet/Representation SegmentTemplate、SegmentList、SegmentBase 继承、SegmentBase SIDX metadata、BaseURL、模板 token、SegmentTemplate `endNumber`、SegmentList timeline、静态最后一片 duration 修正、有限及 availability-bounded `r=-1`、dynamic duration-only SegmentTemplate 的 client clock offset、同身份静态多 Period 串接、SegmentList range validation 和 DRM 投影；`processing/dash-task.ts` 已收口 SIDX index-range fetch、range、顺序写入、取消和失败清理，并允许带有限当前窗口的 dynamic snapshot 走同一下载/合并路径；分片先由 async sink 写独立 part，再用固定 1 MiB 缓冲顺序拼接，失败的 live append 回滚原长度；`processing/dash-live-task.ts`、`dash-live-adapter.ts` 和 `dash-live-session-owner.ts` 由 main-owned task/adapter/owner 管理受限 MPD XML、snapshot 刷新、按 representation 去重、只追加新分片、停止/取消和 tab/view/退出清理；`integrations/dash-manifest-authority.ts` 要求 live MPD URL 与 captured resource URL 精确一致；DASH 本地轨道输出使用共享 ffmpeg process owner 的 `local-file` 输入模式，静态与动态刷新双轨真实 FFmpeg/FFprobe 证据已加入；DASH live start/stop/discard 已通过独立 main/preload IPC 暴露。无 availability 证据的动态窗口、复杂嵌套 SIDX 和不完整/初始化冲突的多 Period 集合仍是明确 bounded reject，不是未声明的 fallback。|
| transfer engine | `TransferEngine` target + thin platform adapters | transfer unit 的并发、Range、retry、外部 signal、队列取消、有序输出、async sink 背压、streaming memory、native session 和 task registry 已完成 target owner cutover；sink 完成前 worker 不领取下一项，写盘失败进入独立事件而不消耗自动网络 retry。HLS/DASH 生产导入直接使用 `TransferEngine`，旧 `embeddedBrowserFragmentDownloader` 文件与兼容出口已删除。Electron sibling staging / local stream 是 StreamSaver/remote MITM 的平台替代；64 MiB native Electron 下载/handoff/save 与总 2 GiB 协议写盘已通过 bounded smoke，production live/filesystem append 另通过 5 分钟真实 timer 档；完整 output-integration 真实交付和更长宿主运行仍属第二阶段补测，不再保留第二套分片算法 |
| output integration | verified target owners + thin OmniFlow delivery adapters | external-tool、inspection、普通资源下载、已捕获页面拖拽、HLS direct/track 和 HLS/DASH 计划分片传输已接入 main-owned authority；HLS manifest/track、HLS 计划下载、HLS 直播停止导出、DASH local-file merge、captured-resource transcode 和 media-tool operation 已共享可取消 process executor，并统一收集进度、处理 process-tree 终止、清理失败 partial output 和校验零退出后的非空产物；普通直链、已捕获资源、HLS/MPD 直拉、HLS 计划下载、独立轨合并、HLS 直播停止导出、DASH 静态计划、DASH 直播停止导出、手动捕获资源保存和 MSE 资源导出的处理输出已通过 `publishStagedOutput` 写入 main-only lease，再一次性发布到用户目标路径，renderer 继续收到兼容的最终 `outputPath` 或布尔结果；MSE 自动/周期/工具触发的下载任务通过 `ProcessingTaskRegistry` 归属、共享 AbortSignal 和 `stageMseDownloadResource` 维护失败清理，手动 local-save/export 也通过 tab-scoped processing registry 登记，完成事件队列由 `CapturedOutputWorkflowCoordinator` 跨 library-detail listener 重挂载保留；main-side `DownloadHandoffStore` 持久化完成事件并通过 replay/ack IPC 支持 renderer listener 重挂载与 app 重启后恢复，journal 只保存非敏感 metadata，启动初始化会在 renderer replay 前清理不存在、过期或越界的记录；普通 BrowserWindow 下载由 `DownloadHandoff` 薄 adapter 投影到同一应用级队列，download staging root 在浏览器初始化时回收超过 24 小时的遗留文件；固定目标下的 output owner 已完成 cutover 并有契约/集成证据。Lease 路径和 claim token 有意留在 main，不建设 renderer-safe lease IPC；真实 Electron bounded save/download、5 分钟 production live 墙钟和大媒体预算已有证据；真实资料库交付、完整应用 crash/restart、跨平台、更长墙钟及 data/blob/未捕获资源平台 fallback 仍属于第二阶段补测，不是第二套 legacy 算法。active live 跨进程续录不是固定上游能力，不列为 parity gap |

本轮补充：DASH parser/planner 与 timeline/download/merge 两项能力均已达到 `verified`，并删除 renderer parser/planner legacy symbols。静态计划和 live stop/export 通过 `publishStagedOutput` 完成 lease 内下载/合并和单次最终发布；active task 由 `EmbeddedBrowserDashLiveSessionOwner` 负责取消。已完成 output 的重启 handoff 具备 target 证据；冻结 library target 和资料库交付仍需真实宿主确认。

本轮补充：`publishStagedOutput` 发布已有目标时保留旧文件回滚能力。正常同设备路径优先原子替换；目标已存在且平台拒绝覆盖时先移动到同目录临时备份，替换失败恢复原目标；跨设备复制同样经过该替换逻辑。该边界由定向失败测试锁定，避免输出交付错误破坏用户已有文件。

本轮补充：auth-session clear 期间已经开始的 output delivery 不伪造取消，也不再保留旧会话的 pending 队列；其原有 promise 结束后，无论成功、失败还是抛错，都会清理 owned staging 文件并确认 main handoff，避免活动交付失败留下只能等待 TTL 回收的暂存。

本轮继续：DASH live 停止后的冻结轨道合并也通过同一 lease 完成，成功发布后才结束 live session 并清理 workdir；直播轮询期间的 active recorder workdir 由 live session owner 按 tab/view/退出生命周期管理。跨页面或跨进程续录不属于固定 Cat Catch 能力，只有产品明确需要时才作为可选平台增强另行设计；registry 已接线，资料库交付仍需真实宿主确认。

本轮再补充：已捕获资源转码现在也先写入 owner-scoped lease，ffmpeg 成功后才发布到用户目标；转码和 MSE 手动合并均登记到 tab-scoped `ProcessingTaskRegistry`，关闭 tab、view 销毁或 renderer 崩溃会通过共享 `AbortSignal` 终止 ffmpeg 并清理 partial output。转码格式和 renderer 最终 `outputPath` 不变；软件 quarantine 已接入启动流程，真实 crash 宿主证据与资料库交付仍是开放边界。

本轮 MSE 边界：手动音视频合并现在同样先写入 lease，再发布到用户目标；自动完成/周期保存仍写入 download staging root 并通过现有导入事件交付，不与用户最终保存路径混为一谈。

HLS master 现已按固定 level identity 与 resolved URI 合并重复 variant；即使相同 URI 被其他 URI 隔开，parser、download plan 与工具区仍保留完整且有序去重的 AUDIO/SUBTITLES group 集合，单值字段只作为兼容首组。固定 hls.js 的 `MANIFEST_LOADED` 会保留跨 URI 声明，但 Cat Catch 生成选择项所消费的 `MANIFEST_PARSED` 只暴露首 URI；显式相同 `PATHWAY-ID` 时还会把后续 URI 的 group 合到首 URI。OmniFlow 接受数据保留差异：每个 identity/URI 继续独立可选，不增加 fallback 顺序或 failover 执行语义。

固定 hls.js 会先用 `isMediaPlaylist` 选择 master 或 media parser：出现 `EXTINF` / `TARGETDURATION` 后，混入的 `STREAM-INF` / `MEDIA` 不能再生成 variant/rendition。对应 URI 仍由 media URI alternative 物化为 fragment，并贯穿 sequence、MAP、key、implicit IV 与 Cat Catch 下载计划；pure parser 不允许 master-only 分支反向改变已确定的 media 模式。

HLS key 的显式 IV 现按固定 hls.js `AttrList.hexadecimalInteger` 转为字节后再投影到 manifest 和 download plan：奇数位左补零，大写输出归一为小写，无效 `parseInt` 结果沿用 `Uint8Array` 的零值强制转换；缺失或空 IV 继续按 fragment sequence（MAP 为 0）派生。

固定 hls.js 对缺失或空 KEY URI 仍保留 fragment 的 encrypted 状态但不给 decryptdata，空白 URI 则解析为 playlist URL；Cat Catch 随后可能把 ciphertext 当明文或把 manifest 当 key。OmniFlow 保留 encrypted/keyless 投影供任务层判断：无手动 key 时在 fetch 前拒绝，有合法手动 AES-128 key 时恢复媒体 key；MAP-only key 不会把明确明文的媒体误标为加密。

Cat Catch 的 `tsAddArg` 已按原分支顺序迁入 post-parse plan：`null` 保留 fragment URL，空字符串清除原 query，非空字符串替换原 query；key/MAP URL 始终保持。工具区从当前 manifest URL 按固定大小写敏感 `.m3u8?` 正则提供默认草稿，但只有用户显式启用才生效。普通静态计划因此强制走本地 downloader，master 必须先选具体 variant；选择独立音轨时 renderer 只提交 master/video/audio 三个 opaque resource ID 和三态 query，main 重建双 plan 后合并；直播通过显式 IPC 在每轮 snapshot 使用同一设置。任何任务日志和安全投影都不记录参数值。

HLS 带值标签只在固定标签名后紧接冒号且冒号后至少有一个字符时进入 media parser 分支；`KEY-CACHE`、`MAP-FOO`、`MEDIA-SEQUENCE-FOO`、`STREAM-INF-FOO` 等未知扩展保持固定 hls.js 的 fallback，不得清空 key、替换 MAP/range、改写 sequence 或吞掉 media URI。裸 `MAP:` / `BYTERANGE:` / `PLAYLIST-TYPE:` 同样只进入 fallback，既有 init/range/type 状态不变；裸 `DEFINE:` 不会凭空创建名为 `undefined` 的变量，后续引用仍按固定错误拒绝。整数媒体标签继续要求冒号后的首 token 以数字开头：带正负号的 TARGET/MEDIA/VERSION 不进入数值分支，数字后的文本前缀仍被接受；`DISCONTINUITY-SEQUENCE` 未命中整数分支时会落入固定无值前缀行为，因此 parser 分开保留 initial sequence 与 current cc。`BYTERANGE` 的 length/offset 现按固定 hls.js `BaseSegment.setByteRange` 使用无 radix `parseInt`，因此合法整数前缀会进入 manifest 和 plan，省略 offset 继续沿用既有 fragment/MAP 关系。固定 hls.js 对零/负 length、NaN 和负 offset 会保留空或非法 range，Cat Catch 随后生成不可执行 `Range`；OmniFlow 接受稳定拒绝差异，在计划创建前抛错且不退化为整资源下载。

`EXTINF` 继续复刻固定 fast regex 的 decimal-prefix 回扫，而不是改写成宽松 `Number`：`.5` 是合法时长；`-3/+3` 的整段值以及 `3e2/4tail/0x4` 的非十进制 remainder 会被下一轮 URI 分支识别为额外分片，随后真实 URI 再成为一个零时长分片。超长纯十进制被 `parseFloat` 转成 `Infinity` 后会抑制后续 URI，空 duration 不重置该 fragment 状态，直到有效 duration 才恢复。Cat Catch `parseTs` 会把实际物化项加入下载列表，因此 pure manifest 与 plan 同步推进 sequence、AES implicit IV 和总时长。

固定 fast parser 把 `CR`、`LF` 和 `CRLF` 都作为清单行边界。pure parser 不再只接受 LF 系列换行；纯 CR 清单同样保留 media sequence、duration、discontinuity、ENDLIST 与实际下载 URL。

固定 fast parser 的 URI alternative 在检查 `(?!#)` 后才消费 ASCII 空格，因此 ` #EXT-X-MEDIA-SEQUENCE:10` 会成为 URL fragment，而不是 sequence 标签；纯 tab 前缀会被全局 regex 跳过并继续命中 tag。pure parser 保留该不直观顺序，避免预先 `trimStart()` 改变 fragment 数、sequence 和 AES implicit IV；空格前缀的 `EXTM3U` 同样保持缺失格式头错误。

固定 master regex 会把 `EXT-X-STREAM-INF` 与其 URI 之间的 `#` 行吞入同一个 pending match：连续 `STREAM-INF` 保留首声明，夹在中间的 `DEFINE` 不会成为变量 owner；`EXT-X-MEDIA` 则由首轮 master/变量解析完成后的独立扫描继续投影音轨，所以它也能使用后置 `DEFINE`。pure parser 保持该分支顺序，避免异常 master 悄然改变码率、分辨率或变量来源。

固定 `AttrList.bool` 对 master rendition 的 `DEFAULT/AUTOSELECT/FORCED` 使用大小写敏感的 `YES` 判断；pure parser 不再把小写或混合大小写值宽松提升为 true，避免改变音轨和字幕的选择标志。

固定 `AttrList.parseAttrList` 会 trim attribute 名称，但保留未加引号 value 的首尾空格。pure parser 现在直接使用同一正则并把 raw tag payload 交给它：空格污染的 `AES-128/NONE` method 不再错误替换或清除 key，非精确 `YES` 和带空格 rendition type 也不会改变 Cat Catch 的音轨选择。

固定 parser 不把 LL-HLS PART 直接放入 `LevelDetails.fragments`，但会把 PART duration 累加到当前 fragment。常规 EXTINF 会覆盖该累计值；异常顺序中的 URI 会使用累计 duration，非有限 PART duration 会让该 URI 不物化。pure parser 保留这一 duration/URL/sequence 状态，同时仍不下载 PART URL。

固定 hls.js 对变量替换为空的中间 segment URI 仍会物化 `url=""` fragment，并推进 duration 与 sequence；Cat Catch 随后把空 URL 投影到下载列表。pure parser 接受稳定拒绝差异，在 manifest/plan 形成前报错，不能静默漏片并改变后续 sequence、隐式 IV 或 key/MAP context。

固定 hls.js 用 `url-toolkit` 形成的 raw URL 会在 Cat Catch 浏览器 `fetch` 时再次按 WHATWG 规则 canonicalize。pure parser 直接保存该有效网络目标：空格编码、编码 dot segment、反斜杠和越过 origin root 的 parent traversal 与 Cat Catch 最终请求一致，同时能精确命中 main-owned captured resource URL 并保留受保护上下文。raw 中间字符串不同是明确的平台适配，不是待补移植。

固定 AttrList 对 master variant 的整数和浮点质量字段分别使用 radix 10 `parseInt` 与 `parseFloat`：typed projection 接受合法数值前缀、整数截断小数，并且不会把 `0x` 输入按 JavaScript `Number` 的十六进制规则解释。pure parser 保留同样的 BANDWIDTH/AVERAGE-BANDWIDTH/FRAME-RATE 行为，同时保留原始 attributes 供兼容展示和追溯。

file-backed MSE 取消证据更新：`saveEmbeddedBrowserExtractedResourceFile` 已从不可中断的 `copyFile` 切为 signal-aware stream pipeline，base64 write 也接收同一 tab signal；自动 MSE staging 和手动资源导出都不再等待整份 file-backed spool 复制完成才响应取消。256 MiB 定向测试与两档真实 Electron smoke 均在 partial copy 后取消，默认/大文件档分别观察到 `1,245,184`/`1,376,256` bytes，随后 AbortError、单任务命中、不发 completion、partial staging 删除和 registry 释放全部通过。MSE merge 与 HLS/DASH 静态协议传输已有各自独立宿主证据；其他 FFmpeg wrapper 由 signal/owner contract 和共享 executor 真实证据覆盖，不再逐入口重复宿主 smoke。

## 3. 高优先级缺口

1. production network/Deep/HLS 已切换为唯一 target owner；真实网站手工回归仍是环境验证缺口。
2. main-only vault/store 已完成 network unit 收口；DASH 直拉和 MSE/toolkit 投影归其各自 unit，不能重新引入 renderer request-header 真相源。
3. HLS 固定目标的下载相关 parser/pipeline、静态/直播、authority、生命周期和真实输出范围均已完成测试验证与原子 cutover，不再保留旧算法作为备用。
4. DASH unit 已完成固定目标下的 parser、静态/动态有限计划、SIDX、下载、live 和真实 FFmpeg/FFprobe output cutover。无 availability 证据的动态窗口、不完整或初始化冲突集合、复杂嵌套 SIDX 保持显式 bounded reject；它们不是仍在运行的 legacy fallback，也不重新打开已完成的初始 unit。
5. `ProcessingTaskRegistry` 已建立并由共享 ffmpeg executor 使用，应用退出会等待并终止已登记进程；完成下载队列已由 `CapturedOutputWorkflowCoordinator` 提升为应用级并支持 renderer listener 重挂载，main-side `DownloadHandoffStore` 通过 replay/ack IPC 让 MSE/普通下载完成事件跨 renderer 重启恢复，普通 BrowserWindow 下载通过 `DownloadHandoff` 复用该 owner，完成元数据还会在 24 小时内持久化并在重启后恢复，且启动初始化会先剔除过期、缺失或越界记录；auth-session clear 会删除 renderer journal、确认 main handoff 并隔离旧会话事件。HLS/DASH/MSE 协议任务也已登记到共享 registry，跨入口取消、冻结 library target 和 UploadManager/delivery terminal 已有固定目标下的 adapter 合同。隔离 Electron 的 renderer crash/restart 已以 39 字节与 64 MiB 两种 fixture 通过，native、普通 streaming、file-backed MSE、MSE 双轨 merge、HLS/DASH 静态协议传输与一条真实 FFmpeg staged output 的宿主取消也已通过，macOS 系统保存框取消/确认及 production save IPC 也已通过；全部 Cat Catch 相关 FFmpeg wrapper 的 signal/owner contract 已审计闭合。完整登录态宿主、资料库交付和跨平台 smoke 仍待补测。
6. 目前有 260 个唯一 active test ref；逐项名称与来源以 capability map 为准。Network/Deep/MSE/HLS/DASH/transfer/output integration 的固定目标证据已支撑对应 unit cutover；MSE 的纯 runtime、spool 生命周期、relay 合同、synthetic output contract、条件式真实 FFmpeg/FFprobe 双轨合并、merge/transcode 失败 partial output 清理、零退出非空 output 校验、周期保存阈值、完成/清理边界、稀疏缓冲自动跳转、已开始播放媒体的 bounded auto-restart 以及 flush/drain 两条路径的头部裁剪证据已有，并明确覆盖跨音视频轨道的全局累计字节；HLS/DASH live 有 32 个重叠窗口和 5 分钟真实 timer/filesystem append 证据，静态协议链新增 async sink 背压、写失败分类、乱序多分片磁盘输出和总 2 GiB 显式 stress 证据，公开真实 HLS/DASH 均已有 parser-to-FFprobe 证据，普通 native output 链新增 64 MiB 真实 Electron 证据，production merge/transcode 新增大于 128/192 MiB 的真实 FFmpeg 预算。剩余工作属于第二阶段外部网站真实登录/播放器页面、完整应用/跨平台 Electron、资料库交付、真实 crash recovery、更长宿主运行和上游增量验证。

### 3.1 Deep 原子切换边界

`deep-search-runtime` 已完成原子切换。固定目标下的 28 个历史 cleanup 条目已全部落实并从临时台账移除：

| 类别 | 数量 | 当前处置 |
| --- | ---: | --- |
| 保留适配 | 11 | lifecycle/page relay、console prefix、通用 probe template、toolkit 三个 page bridge、generated-resource action/extract bridge；继续作为 OmniFlow platform adapter，bridge contract 已可执行验证 |
| 已删除 legacy | 17 | 12 个纯旧实现与 5 个拆分项的旧 symbol 已与 production dispatch 切换同批删除；后续由唯一 target owner、测试和代码 review 防止回归 |

这里的“保留适配”不是保留第二套算法；它们只生成受控页面调用或维持 tokenized relay/template。新的 page runtime core/host API 仅承载平台 transport 和 MSE 投影，Deep 算法由 `cat-catch-port/deep-search` 唯一持有。MSE 专用 body 只保留 Electron/page 边界行为，MSE runtime unit 已完成固定目标下的 parity 与清理验证。

## 4. 保留、迁移与删除

- 忠实迁移：network classifier/rules、deep search、MSE 经验分支、HLS parser/pipeline、downloader 竞态。
- 平台适配：Electron webRequest、page relay、filesystem、ffmpeg、外部工具、资料库导入。
- 成熟库替代：DASH/MPD parser core，但行为必须用 fixture 验证。
- 保留唯一 owner：tab/view lifecycle、ResourceStateStore、UploadManager。
- 最后收口：`embeddedBrowserMainController.ts` 只保留 orchestration/facade。
- 切换后删除：旧算法、旧 listener/handler、flag、fallback、兼容转发和测试 helper。

## 5. 当前下一步

下一步继续 output-integration 的第二阶段地毯式补测：优先完成真实资料库交付、完整登录态宿主 crash/restart 和跨平台交付；随后补外部网站真实登录流程与更长宿主运行。macOS 系统保存框取消/确认已通过独立交互 smoke；main-side lease quarantine、download handoff replay/ack 与启动清理、应用级完成队列的基本重启恢复、auth-session 隔离、UploadManager 终态分类与冻结 library target 已由共享 owner 落地，协议分片写盘已有总 2 GiB 证据，production FFmpeg merge/transcode 已有大媒体预算，production HLS/DASH live 已有 5 分钟真实 timer/filesystem append，公开真实 HLS/DASH 已有 parser 到 FFprobe 闭环，真实 Electron 页面 Cookie/Authorization capture/opaque authority 也已通过；lease 继续保持 main-only。补测只更新证据和 gap，不再创建新的长期同步框架。DASH dispatch 已切换，后续只在行为差分或真实回归发现问题时增量维护；transfer、MSE、Network、Deep、HLS 同理。
