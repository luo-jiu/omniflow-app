# Cat Catch 全面迁移执行计划

更新时间：2026-08-30

状态：生效。当前固定迁移目标为 `2cb981d7c2f4614732edccc167c4b5793d1cb138`，32 项 capability 已完成固定目标下的初次 production cutover；后续进入真实宿主、资料库交付、crash recovery 和长时间稳定性的地毯式补测阶段。

适用范围：OmniFlow 内置浏览器的资源发现、页面深搜、MSE 捕捉、HLS/DASH 解析与下载、请求上下文、任务生命周期、文件处理以及资料库输出集成。

本文是迁移边界和完成定义。版本游标由 `docs/cat-catch/upstream-state.json` 维护，逐项事实由 `docs/cat-catch/capability-map.json` 维护。初始 cutover 的临时清理台账已在固定目标完成后删除，长期只保留仍在工作的实现引用。

## 1.1 执行优先级

初始迁移分为两个阶段，不能把最终验收标准提前套在每个中间切片上：

1. **整体完成度阶段**：优先让所有纳入 capability 进入可工作的 target owner，完成唯一 dispatch boundary 的切换，并把状态推进到 `ported-unverified` 或 `verified`。每个切片只运行能证明当前行为、集成和基本清理的最小测试集；已知但不阻塞后续切片的 parity、长时间稳定性、真实网站和极端异常记录为 gap，暂不展开。
2. **地毯式补测阶段**：所有 capability 都已完成初次 port、`reviewedThrough` 已推进到 target 后，再集中补齐上游差分、异常/取消/重启、输出正确性、资源预算、真实场景和资料库交付，并据此把 `ported-unverified` 收口为 `verified`。

当前切片只有在以下情况之一成立时才允许继续增加可靠性代码：它直接阻塞下一个 capability 的实现、阻塞唯一 owner 切换、或会导致当前 target owner 无法安全运行。单纯提升边界覆盖率但不推进 capability 状态的工作，应延后到第二阶段。

## 1. 目标

OmniFlow 不运行 Cat Catch 浏览器扩展，而是把与产品目标相关的行为和经验分支迁入一个可维护的纯逻辑 port，再通过薄 adapter 接入 Electron 与 OmniFlow。

我们追求的长期结果是：

- 新 Agent 能从明确的上游游标继续同步，不需要重新猜本地历史。
- 上游 source anchor、本地实现、测试和已知差异可以逐项对应。
- Cat Catch 的经验分支由 fixture 和测试保护，不能被“更规范”的重写静默删除。
- 每项生产能力只有一个 owner。
- 每个 cutover unit 切换后，立即删除该 unit 的旧算法、旧 listener、旧 flag、兼容转发和旧测试 helper。
- 后续维护成本主要取决于 Cat Catch 新增了多少行为，而不是 OmniFlow 仓库大小。

## 2. 完成定义

固定目标版本的全面迁移完成，必须同时满足：

1. `upstream-state.json.migrationTarget` 之前的目标范围已全部分类，`reviewedThrough` 等于该 commit。
2. `capability-map.json` 中每项能力均为 `verified` 或有明确理由的 `excluded`。
3. 所有纳入能力都有实际存在的测试；需要结构化输入时再使用 fixture，不能只有计划名称。
4. Cat Catch 来源行为已通过可执行差分、独立规范 expectation 或明确的平台等价测试验证。
5. 每个 cutover unit 已在唯一 dispatch boundary 切换到新 owner。
6. 初始 cutover 的所有 legacy symbol 均已删除；capability map 只保留仍在工作的 OmniFlow adapter/integration 实现引用。
7. 不存在长期双栈、隐藏 fallback、旧 feature flag 或仍指导使用旧实现的活跃文档。
8. TypeScript、lint、相关 Vitest、Electron fixture、输出正确性和资源清理验证通过。
9. `portedThrough` 等于迁移目标，第三方来源与许可证说明准确。

上述初始清理条件已于 2026-08-29 完成：旧 symbol、临时清理台账及其专用 validator 分支均已移除；Git commit/tag 和已发布版本是回滚手段，不在代码中保留无法持续测试的旧运行时。

## 3. 当前事实

### 3.1 上游

| 字段 | 当前值 |
| --- | --- |
| repository | `https://github.com/xifangczy/cat-catch` |
| branch | `master` |
| baseline / observed / migration target | `2cb981d7c2f4614732edccc167c4b5793d1cb138` |
| description | `2.7.2-22-g2cb981d` |
| reviewedThrough | `2cb981d7c2f4614732edccc167c4b5793d1cb138` |
| portedThrough | `2cb981d7c2f4614732edccc167c4b5793d1cb138` |

`observedHead` 只表示最近看到了哪个版本；`reviewedThrough` 表示此前变化已分类；`portedThrough` 表示此前所有纳入变化已实现并验证，或已明确排除。三者不能混用。

### 3.2 当前 OmniFlow

现有资源捕捉实现只能作为 characterization 输入，不能作为正确性 oracle。已确认的事实包括：

- `deep-search-runtime` 已在唯一 production document-start factory 原子切换到固定 `search.js` 的 target owner；旧 disabled flag、Worker bootstrap、manifest heuristic、toolkit state 和 `probeResources` 已删除。
- deep discovery 按固定 `search.js` 锁定 JSON 全 enumerable width、depth 21/22 边界、cycle、宽松 16-number key、inline M3U8/MPD、data URL 与当前/未来 base URL 回放，现已由 production page adapter 持有 document session。
- deep page relay 由随机 document token、tab/WebContents/incarnation/navigation/origin/deep-mode binding、CDP 新文档安装和当前 frame subtree 注入提供平台等价边界；伪造、all-frame 和 production ingress 证据已随 unit 一起 verified。
- deep runtime 覆盖幂等/恢复/重入门禁、Worker Blob CSP 异步探测与回退、bootstrap relay、fetch clone、XHR、JSON、TextDecoder 以及 slice/subarray/base64/fromCharCode/DataView/typed-array/join/escape/indexOf 经验面，并已贯通 tokenized main ingress 和 toolkit round-trip。
- inline script 的 m3u8/mp4/flv 精确 regex、协议补全与重复候选，以及 Vimeo playlist URL gate、base path、track manifest、raw metadata 和 header-only empty master 已迁入可序列化 page-discovery factory。
- production page adapter 按固定 XHR/fetch/TextDecoder/root-string 分支顺序组合 runtime、document session 与 page helper，负责 DOMContentLoaded 调度、generated resource 物化和 nested Worker observation 回放；只有一套 Deep hooks。
- generated-resource page owner 接管 signature 去重、Blob/base64 bytes、文件名和 open/export/read，并把非自身 key 委托给 MSE handler；production probe 能从 main-owned resource key 读回 Cat Catch 归一化 manifest bytes。
- production MSE 已切到 `cat-catch-port/mse/runtime.ts` + `capture/adapters/mse-page.ts` 的唯一 page owner；runtime 持有 MediaSource/SourceBuffer 观察、per-track retention、flush/reset 和 drain，adapter 负责页面动作、文件名/Blob、bounded auto-restart polling 与 probe relay。`processing/mse-spool.ts#MseSpoolStore` 持有 main 临时文件、预算、TTL 和导航/tab/process 生命周期清理；已 flush 的轨道在 main 下载路径中逐轨读取。自动完成动作在 main 侧优先合并音视频，再通过 embedded-browser staging root 发布标准下载完成事件，renderer 不再执行第二次自动保存。纯 runtime、spool lifecycle、relay authorization、synthetic output contract、条件式真实 fragmented-MP4 双轨 ffmpeg/ffprobe output、失败 partial output 清理、零退出非空文件校验和 production probe characterization 均已有证据，MSE unit 已关闭；资料库交付、应用重启恢复和 crash quarantine 仍由 output-integration 独立负责。
- Catch Toolkit 的八项产品偏好由 production page-origin owner 持有，固定 `"checked"`、空字符串删除、selector/regex 验证、重载恢复、新 origin 重置和 storage 被阻止时的内存降级；既有 get/update bridge 使用该 owner，并只向 MSE actions 同步运行投影。
- discovery 已从一次性 helper 收敛为可序列化 document session，跨 JSON/fetch/XHR 观察保留 emitted/base/pending 状态；相对 manifest 可以在后续 hook 才出现媒体 URL 时按新 base 回放，一次性 `discoverResources` 只保留为测试和兼容 facade。
- 网络捕捉由 production `EmbeddedBrowserCaptureRuntime` 唯一注册 `onSendHeaders -> onResponseStarted -> terminal cleanup`，旧 `onCompleted` 识别 bridge 已删除。
- request context 由 main-only bounded vault 持有容量、TTL、owner 和 purpose；renderer 只接收 header capability，不接收 Cookie/Authorization 值。
- HLS 固定目标的下载相关 parser/plan、key/MAP/range、静态/直播执行、retry/cancel、预处理和真实 ffmpeg 输出范围均已由 fixture 或可执行测试覆盖，并已在唯一 dispatch boundary 切换到 target owner；`network-capture`、`deep-search-runtime` 与 `hls-engine` 均已完成原子 cutover。
- 受支持的加密 KEY 缺失、空或空白 URI 时，pure plan 保留固定 hls.js 的 `encrypted=true` 与无可执行 key ref 事实；本地 task 在任何网络请求前要求有效手动 AES-128 key，否则明确拒绝，不能把 ciphertext 当明文继续交付。
- 固定 hls.js fast parser 的行边界语义也已迁入：`CR`、`LF` 和 `CRLF` 清单都会进入同一 media/master 解析与下载计划，纯 CR 不再被本地切行预处理误拒绝。
- 固定 fast parser 的行首 token 优先级已迁入：标签标记前紧邻 ASCII 空格时 URI alternative 先命中，该行会成为零时长 fragment；纯 tab 缩进则跳到 tag alternative。空格前缀的 `EXTM3U` 继续按缺失格式头拒绝，不能被预处理 trim 成合法清单。
- master `STREAM-INF` 的 pending regex 顺序已迁入：URI 前的重复 variant/DEFINE 等注释行不会覆盖首声明或创建变量，而独立 media scan 会在首轮变量收集后再投影 AUDIO/SUBTITLES rendition，因此 MEDIA 也可引用出现在其后的 DEFINE。
- master rendition 的 `DEFAULT/AUTOSELECT/FORCED` 保持固定 AttrList 大小写敏感布尔语义：只有精确 `YES` 为真，小写或混合大小写不能被本地宽松归一化成默认/自动/强制音轨。
- 固定 AttrList 只 trim attribute 名称并保留未加引号 value 的首尾空格；KEY method/clear、rendition type 与 boolean 不能在进入 parser 前被通用 trim 归一化，否则会改变 key 继承和轨道选择。
- LL-HLS PART 不独立进入 Cat Catch 下载列表，但固定 parser 会先把其 duration 累加到当前 fragment；后续 EXTINF 可覆盖，非有限 PART duration 则会抑制紧随 URI。pure parser 必须保留这层 duration/URL/sequence 状态，而不是把 PART 简化为完全无影响的标签。
- segment URI 经变量替换后为空时，固定 parser 会保留中间的空 URL fragment 并推进 duration/sequence；Cat Catch 随后把空 URL 交给下载器。OmniFlow 不得静默删片并前移后续 sequence，而是在 executable plan 形成前稳定拒绝。
- 固定 hls.js `url-toolkit` 的 raw URL 会在 Cat Catch 浏览器 `fetch` 时再次 canonicalize；pure plan 直接保存同一有效网络目标，以便精确兑换 main-owned captured resource authority。不能为了 raw 字符串表面一致而让空格、编码 dot segment 或反斜杠 URL 丢失 Cookie/Authorization 上下文。
- master variant 的 typed BANDWIDTH/AVERAGE-BANDWIDTH/FRAME-RATE 投影使用固定 AttrList 的十进制 `parseInt` / `parseFloat` 语义，保留合法数值前缀并避免 JavaScript `Number` 把 `0x` 输入解释成非上游的十六进制码率；原始 attributes 仍原样保留。
- Cat Catch `tsAddArg` 已作为 post-parse 纯计划能力迁入：关闭时保留原 fragment query，开启且为空时移除 query，非空时替换 query；只修改 media fragment，不修改 key/MAP。工具区草稿是唯一 renderer owner；普通静态任务强制走本地 plan，选择独立音轨时由 main 校验 captured master 与两个 child authority 后生成两条隔离的本地 plan 再合并，直播轮询经显式 IPC 把同一设置交给 main recorder。
- HLS DTO、parser 与 plan projection 已分别收敛到 shared contract、`cat-catch-port/hls/parser.ts` 与 `plan.ts`；main、preload、renderer 和测试均直接依赖 target，旧 renderer compatibility model 已删除。
- HLS 本地 key/map/segment 下载、playlist 重写以及 local -> ffmpeg 阶段序列由 `processing/hls-task.ts#HlsTaskExecutor` 持有，首次计划和失败分片 retry 共用这一执行合同；直播轮询与累计计划由 `processing/hls-live-task.ts#HlsLiveTask` 持有。controller 只保留 authority、保存路径、session、IPC response 与产品日志 adapter；旧顶层 downloader/recorder 兼容出口已删除，plan handler 已改为目标语义命名。
- HLS/DASH live 的 bounded continuity 已有快速自动化证据：各驱动 32 个重叠 manifest/snapshot 窗口，累计 34 个唯一分片，验证重复窗口不重复交付、HLS 规范化本地 playlist/首尾字节以及 stop 后 timer 清理。显式 `cat-catch:smoke-live-wall-clock` 又以真实 timer 同时运行 production HLS/DASH live 与 filesystem append 5 分钟，得到 HLS 201 个唯一分片、DASH 301 个唯一分片，stop、输出、part 清理和 512 MiB RSS 硬预算均通过；`cat-catch:smoke-real-media` 还使用公开 HLS/DASH 网站分别贯穿 production parser、真实媒体分片、production FFmpeg 和 FFprobe；`cat-catch:smoke-host` 已用真实 Electron 页面锁定 Cookie/Authorization 媒体捕捉、无凭据 renderer 投影和 main opaque authority 重放。外部网站真实登录流程、完整应用、跨平台和更长夜间运行仍是第二阶段宿主证据。固定 Cat Catch 的 `recorder`、`recorderLast` 和 `fileStream` 只存在于 `m3u8.js` 页面内，`beforeunload` 还会 abort 文件流，因此页面/进程重启后继续录制不是固定目标 parity；未来若实现 durable recorder，只作为 OmniFlow 可选平台增强单独设计。
- 手动 AES-128 key 会替换已有媒体 key，或在清单完全没有 key 信号时恢复未识别的加密媒体；如果只有 MAP 明确加密，则保持其后的明文媒体不变，避免把 MAP-only override 扩散成错误的媒体解密。
- HLS/DASH 分片失败重试会保持原 URL 与 byte `Range`；`cat-catch-port/processing/transfer-engine.ts#TransferEngine` 接受单一外部 `AbortSignal` 并由自身取消所有并发请求，取消活动 retry 时同时清空待执行队列，只产生一次 aborted 终态，且不再进入 processor、completed 或有序输出。平台 adapter 通过异步 buffer sink 把“写盘完成”纳入 worker 终态：HLS 每个 worker 直接写独立 segment，DASH 每个 worker 先写独立 part，再用固定 1 MiB 缓冲按 manifest 顺序拼接；pending write 数不超过 thread，out-of-order 字节不再由 Promise/closure 无界持有，写盘失败也不会消耗网络 retry。与 Cat Catch 的递增延迟不同，当前 adapter 使用有界立即重排队；range terminal race、队列取消、sink 背压/失败分类和统一 `ProcessingTaskRegistry` 登记已有 target 测试与 production owner 接线。
- HLS 真实输出门禁已覆盖 clear/AES-128 AAC、AES-256 CBC/CTR AAC，以及加密 fMP4/H264 视频与独立 AES-128/AAC 音轨的双本地 playlist 合并；ffmpeg 的 protocol/extension 策略按 input 重复声明，避免第二轨本地 key 被默认扩展名策略拒绝。ffmpeg HLS demuxer 不识别 AES-256 METHOD，因而 AES-256 的 key/MAP/media 先按固定 hls.js Web Crypto 模式在本地工作目录解密，再以 clear playlist 进入同一 ffmpeg owner。CBC 加密 MAP 的 BYTERANGE 还会按固定 FragmentLoader 以明文 length 补齐 cipher request，并在非零 offset 前取一个 ciphertext block 重置 IV；AES-128/256 都会产出精确声明长度的 clear MAP，避免把原始 range 直接交给 ffmpeg。
- DASH target parser/task 已建立继承 BaseURL、Period/AdaptationSet/Representation segment info、模板 token、SegmentTemplate `endNumber`/dynamic client clock offset/SegmentList timeline、SegmentBase SIDX index-range expansion、静态最后一片 duration 修正、有限及 availability-bounded `r=-1`、dynamic duration-only availability window、同身份静态多 Period 串接、SegmentList range、DRM 投影、range-aware transfer、顺序写入、取消和失败清理的纯基座；带有限当前窗口的 dynamic snapshot 已进入同一下载/合并路径；main 侧 `dash-live-adapter` 将受限真实 MPD XML 转为纯 AST/计划；`dash-live-session-owner`、DASH live start/stop/discard IPC 和 `appendDashRepresentationSegments` 已接入生产生命周期。renderer DOM 只保留薄 adapter，DASH parser/planner 与 timeline/download/merge 两项能力均已 verified；复杂嵌套 SIDX、无 availability 证据的动态窗口和不完整/初始化冲突集合保持明确 bounded reject。
- HLS、DASH、MSE merge/transcode 和 media-tool operation 已共享 `processing/ffmpeg-executor.ts#FfmpegTaskExecutor` 的可取消进程、进度、process-tree 终止、partial output 清理和非空产物校验合同；`processing/task-registry.ts#ProcessingTaskRegistry` 维护全局活动任务集合，应用退出由 `main.ts` 调用 registry `dispose()` 等待并终止这些任务。外部命令、native `will-download` session、普通直接/捕获资源流式下载、手动 local-save/MSE resource export 以及自动/周期/工具触发的 MSE output 也已登记到同一 registry；普通直接/捕获、captured-resource transcode、手动 MSE merge、手动捕获资源保存、MSE 资源导出、HLS 计划下载、独立轨合并、HLS 直播停止导出、DASH 静态计划和 DASH 直播停止导出现在通过 `processing/staged-output-publisher.ts#publishStagedOutput` 在 owner-scoped lease 中完成处理，成功 claim 后再发布到用户目标，兼容保留最终 `outputPath` 或布尔结果；MSE 自动 output 由 `processing/mse-download-output.ts#stageMseDownloadResource` 写入 download staging，在写入、取消或完成事件交付失败时清理 owned file，成功后由 main-side `processing/download-handoff-store.ts#DownloadHandoffStore` 持久化完成 metadata，renderer 通过 replay/ack IPC 交给 `CapturedOutputWorkflowCoordinator`，因此 listener 重挂载或 renderer/app 重启不会丢失仍存在的 staging 文件；main 初始化会在 renderer replay 前清理 handoff journal 中过期、缺失或越界的记录，浏览器初始化也会按 24 小时 TTL 清理 download staging root 的遗留文件。DASH 静态计划与 live stop/export active task 由 `EmbeddedBrowserDashLiveSessionOwner` 负责取消，native 下载由 `processing/native-download-session.ts#NativeDownloadSession` 负责 staging、进度、取消和终态清理。`processing/staged-output-lease.ts#StagedOutputLeaseStore` 已建立 owner-scoped path、单次 claim、TTL touch/reap、release 和正常退出 `dispose()` 的 main-only 基座；`configureSession()` 会在首个输出前执行 quarantine/reap，controller 先等待 registry/协议 owner 收口，再释放进程内 lease。Lease path 与 claim token 有意不跨 IPC，当前所有 renderer consumer 只接收最终路径或 domain handoff，因此不新增 renderer lease API。HLS host lifecycle 仍负责入口归属，MSE spool 仍有独立 bounded owner；HLS/DASH active recorder workdir 由各自 session owner 持有并按 tab/view/退出生命周期清理，跨页面或跨进程续录不属于固定目标能力。真实 Electron host smoke 已证明 native `DownloadItem`、普通 streaming output、file-backed MSE output、MSE 双轨 merge、HLS/DASH 静态协议传输和一条 production FFmpeg staged output 的按 tab 用户取消；协议传输会跳过 merge，MSE merge 在两个输入都开始传输后中断，FFmpeg outer signal 会传播到真实进程，各类终态都清理自身 target、partial、lease、workdir/part 与 registry。FFmpeg 调用点审计进一步确认 manifest 单/双轨、HLS 本地轨、DASH 单/双轨、HLS/DASH live stop/export、MSE merge/transcode 均从 tab-scoped owner 取得并原样透传同一 `AbortSignal`；wrapper 的 signal contract 已有定向测试，共享 executor 的真实宿主证据覆盖共同进程底座，不再要求每个薄 wrapper 重复宿主 smoke。`mediaToolFfmpegService` 没有用户取消入口，但 executor 自身仍登记为 `kind=ffmpeg`，应用退出可统一收口；它是独立产品操作，不是 Cat Catch parity 缺口。UploadManager handoff/delivery terminal 的真实资料库确认仍待验证；系统保存对话框中的“取消”是独立交互验收，不由 task registry 证据替代。协议任务已经由对应 HLS/DASH/MSE owner 登记到共享 registry；ffmpeg 可执行探测仍是独立短进程。
- network、Deep 和 MSE page/spool chain 已在 production target chain 形成唯一 owner；data/blob 与未捕获拖拽、DASH 直拉/track 和其他 unit 仍按各自边界迁移，不保留第二套已切换算法。
- 普通 BrowserWindow 下载的完成事件和可选资料库导入已由 `DownloadHandoff` 薄 adapter 接入 `CapturedOutputWorkflowCoordinator`；main-side `DownloadHandoffStore` 负责完成事件 replay/ack，renderer 队列具备一次性清理、失败后待重试、单下载单飞和 24 小时内的 versioned journal 重启恢复定向测试证据。冻结 library target、MSE 自动导入终态和真实生产交付仍属于第二阶段 gap。

因此当前 32 项能力均为 `verified`，7 个 cutover unit 全部完成固定目标下的初次 production cutover；已落地 target owner 覆盖为 `32/32 = 100%`，初次迁移完成度为 `32/32 = 100%`。output-integration 的 main-only lease quarantine/退出释放、download handoff 启动清理/replay/ack、应用级完成队列 journal、auth-session 隔离、UploadManager 终态分类、冻结 library target、共享 FFmpeg owner 和 external-tools dispatcher 均已有固定目标下的契约或集成证据；隔离真实 Electron 的 Cookie/Authorization 页面捕捉/opaque authority、native download、独立应用 renderer 强制终止/replacement、保存 IPC 和终态清理也已通过，同一真实宿主链另以 64 MiB 确定性响应验证流式生成、SHA-256 一致性和终态清理。HLS/DASH live 的多轮增量连续性已由 32 个重叠窗口锁定，5 分钟真实 timer 的 production live/filesystem append 也已通过；协议分片链另用乱序多分片输出验证 async sink 背压、磁盘顺序拼接、写失败分类与取消清理，显式 smoke 已分别覆盖总 512 MiB 和总 2 GiB，其中 2 GiB 档让 HLS/DASH 各处理 `256 x 4 MiB`，整进程峰值 RSS 为 `225,099,776` bytes、无 swap。真实 FFmpeg 大媒体 smoke 还通过 production merge 处理超过 128 MiB 的 H.264/AAC，并通过 production transcode 解码超过 192 MiB 的 PCM 后编码 MP3，峰值 RSS 为 `125,829,120` bytes、无 swap；公开真实 HLS/DASH 也已分别通过 production parser、真实媒体分片、production FFmpeg 与 FFprobe 闭环。完整登录态应用的系统保存对话框、真实资料库交付、跨平台宿主、外部网站真实登录流程和更长宿主墙钟仍进入第二阶段地毯式补测；active live 跨进程续录已确认不是固定上游能力，不再作为 parity 待办，也不阻塞后续上游同步。

补充宿主取消证据：同一 `cat-catch:smoke-host` 和 `cat-catch:smoke-large-host` 会先让普通流式输出通过 production `ProcessingTaskRegistry.run`、慢速 loopback HTTP、`StreamingTransfer` 与 `publishStagedOutput` 写出 partial bytes，再按 tab 取消；两档均验证只命中一个 streaming task，target、partial、磁盘/内存 lease 和 registry 全部清理。本机存在 FFmpeg 时，harness 随后以 realtime lavfi、fragmented MP4 和 production `FfmpegTaskExecutor` 写出 32 bytes partial，再取消 tab-scoped outer task，确认 signal 传播到真实进程并以 AbortError、process-tree 等待和 target/partial/lease/registry 清理收口；FFmpeg 不可发现时显式报告 `supported=false`。最后慢速 64 MiB native `DownloadItem` 同样只命中一个任务、终态为 `cancelled`、partial staging 删除且 registry 释放。加上 file-backed MSE、MSE 双轨 merge、HLS/DASH 协议证据和全部生产 wrapper 的 signal/owner 合同审计，FFmpeg 取消链不再保留泛化的逐入口宿主缺口。当前开放边界特指系统保存对话框取消/确认、资料库交付、完整登录态应用或 Windows 验收；显式 host smoke 继续不写入 capability map 的日常 active test ref。

补充真实页面 probe 证据：两档 host smoke 还通过 production document-start/current-document 注入入口，在实际 Chromium `WebContentsView` 中运行 Deep `fetch`、inline script 和 `TextDecoder` 分支，并以真实 `MediaSource` 创建 H.264 `SourceBuffer`、调用 `appendBuffer` 后从 main 投影确认 4 bytes MSE 数据。该结果关闭隔离真实浏览器引擎里的基础 Deep/MSE hook 与 document token 路由证据；外部网站真实登录/播放器页面和完整产品交付仍是第二阶段环境验收，不能用 loopback fixture 替代。显式宿主结果仍只写同步日志，不增加 capability map active ref。

Cat Catch 下载 fallback 已按平台替代关闭，不再作为第二阶段待办：固定上游的缺失 `chrome.downloads` polyfill 只点击无法观察终态的 `<a download>`；eligible failure fallback 只服务右键 image-save，在特定 native error 后带 referer 打开隐藏 `downloader.html` 并依赖扩展 tab/session/auto-close。OmniFlow 由 main-owned `NativeDownloadSession`、应用级 delivery queue 和 captured-resource exact authority 分别承担原生下载与受保护重试；native failure 后不自动启动可能重复写出的第二条下载。`transfer.downloader-session-lifecycle` 继续以 `platform-substitute` 追踪这些上游 anchor，未来上游变化仍会进入差分审计。

补充 file-backed MSE 取消证据：`saveEmbeddedBrowserExtractedResourceFile` 不再用不可中断的 `copyFile`，而是让 file-backed stream pipeline 和 base64 write 都接收当前 tab 的 AbortSignal；自动 `mse-download` staging 与手动捕获资源输出沿用同一 writer。256 MiB 定向测试在 partial copy 后取消；默认与 64 MiB 两档真实 Electron smoke 又分别在 `1,245,184` 和 `1,376,256` bytes partial 后取消单一 `mse-download` task，确认 AbortError、不发 completion、partial staging 删除和 registry 释放。该结果关闭 file-backed MSE writer 的真实宿主取消；MSE 双轨 merge 由下文独立宿主链覆盖，显式 host smoke 仍不写入 capability map active ref，新增 active ref 只来自 production writer 定向测试。

补充 HLS/DASH 协议传输取消证据：同一默认与 64 MiB 真实 Electron smoke 分别通过 `EmbeddedBrowserHlsSessionOwner + HlsTaskExecutor` 和 `EmbeddedBrowserDashLiveSessionOwner + DashTaskExecutor` 发起慢速 64 MiB loopback 分片。两条链都在实际传输 `65,536` bytes 后按 `kind + tabId` 取消，均只命中一个 task、返回 AbortError、跳过 ffmpeg/track merge，并清理 target、staged lease、workdir、DASH part 与 registry。该结果关闭静态 HLS/DASH 计划分片的逐协议宿主取消；后续 FFmpeg 阶段由同一 owner signal、wrapper contract 和共享 executor 证据覆盖。它不冒充系统保存框、完整登录态资料库、外部网站或 Windows；显式 host smoke 不增加 planned ID 或 active ref。

补充 MSE 双轨 merge 取消证据：当本机可发现 FFmpeg 时，host smoke 先用真实 FFmpeg 生成独立 fragmented MP4 视频/音频轨，再由 loopback server 慢速送给 production `mergeEmbeddedBrowserResourceTracks`。两档都在视频传输 `30,720` bytes、音频传输 `512` bytes 后按 outer `streaming-transfer + tabId` 取消，只命中一个 outer task；共享 signal 中止真实 FFmpeg，终态为 AbortError，target、partial staged lease、内存 lease 和 registry 全部清理。FFmpeg 不可发现时 JSON 显式报告 `supported=false`；该证据关闭手动 MSE 双轨合并入口，并与其他 wrapper 的 signal/owner contract 一起支撑共享 FFmpeg 生命周期结论，不冒充资料库或跨平台验收。

## 4. 长期事实文件

### 4.1 `upstream-state.json`

唯一维护上游版本游标：

- `baselineCursor`：本轮全面迁移最初依据，固定不动。
- `observedHead`：最近 fetch 后看到的 HEAD。
- `migrationTarget`：当前准备完整迁入的固定版本。
- `reviewedThrough`：正式分类已经覆盖到的 commit；当前批不得越过 `migrationTarget`。
- `portedThrough`：最近一个完整实现并验证的 commit；新批次未完成时保留旧值，只有首次迁移前为 `null`。

当前批 capability 是否完成由 `syncState` 和 `syncedThrough === migrationTarget` 一起派生，unit 进度再从成员 capability 派生，不在 state 文件重复维护。选定新 target 后，未受影响的已验证能力也要经过 diff 分类和相关测试再推进 `syncedThrough`；受影响能力保留旧 cursor 并进入 pending/porting。正式分类完成后先把 `reviewedThrough` 推进到 target；全部能力实现、验证并对齐 target 后，才把 `portedThrough` 推进到 target。

### 4.2 `capability-map.json`

长期保存 7 个 cutover unit 与 32 项初始能力：

- 上游 path、anchor 和固定 commit。
- 当前实现位置与计划目标位置。
- 能力与上游的关系、风险提示和已知缺口。
- 计划 test ID、真实 test refs、accepted difference。
- `syncState` 与单项 `syncedThrough`。

允许的 `syncState`：

- `pending`：当前 target 的工作尚未开始；`syncedThrough` 保留最近一次记录的 commit，首次迁移时为 `null`。
- `porting`：正在实现当前 target；`syncedThrough` 保留最近一次记录的 commit。
- `ported-unverified`：当前 target 的代码存在，但行为或集成证据不足；`syncedThrough` 指向 target。
- `verified`：最近记录版本的行为、集成和清理已完成；只有 `syncedThrough` 指向当前 target 才算本批完成。
- `excluded`：最近记录版本确认不属于产品目标，并记录理由和用户影响；只有 `syncedThrough` 指向当前 target 才算本批完成。

如果在没有新上游 commit 的情况下发现漏迁或回归，保持 `migrationTarget`、`portedThrough` 和旧 `syncedThrough` 不变，只把受影响 capability 重新设为 pending/porting。状态打开本身就表示当前完成声明已失效，不伪造更老 cursor，也不新增第二套“reopened”状态。

### 4.3 初始清理状态

初始迁移的临时清理台账已完成使命并删除。后续 capability map 的 `currentImplementationRefs` 只记录仍在工作的 OmniFlow adapter/integration 入口；上游同步不再维护历史删除清单，而是通过 target refs、测试和唯一 owner 事实追踪变更。

### 4.4 文档和测试

- 本文：迁移边界与完成定义。
- `cat-catch-sync-maintenance-guide.md`：下一位 Agent 的同步步骤。
- `cat-catch-migration-audit.md`：当前事实摘要。
- `cat-catch-sync-log.md`：每轮 from/to、分类和验证记录。
- `tools/cat-catch-lab/fixtures/`：真实行为输入和 expectation。
- `electron/service/embedded-browser/cat-catch-port/README.md`：port 依赖边界和来源规则。

## 5. 目标架构

```text
electron/service/embedded-browser/
  contracts/                 # main/preload/renderer 共享契约
  orchestration/             # tab、session、任务编排和 facade
  capture/
    state/                   # ResourceStateStore、context vault
    adapters/                # Electron network 与 page runtime adapter
  cat-catch-port/
    shared/
    network/
    deep-search/
    mse/
    hls/
    dash/
    downloader/
  processing/
    tasks/
    filesystem/
    ffmpeg/
  integrations/
    resource-model/
    external-tools/
```

目录表示依赖边界，不要求先做一次纯搬家。每个能力切片在目标目录实现、测试和切换后，再删除对应旧实现。

### 5.1 依赖规则

- `cat-catch-port` 只能依赖标准 JavaScript/Web API、纯 contracts 和明确引入的协议 parser。
- port 禁止依赖 Electron、React、IPC、资料库、ffmpeg、本地文件系统或 OmniFlow 页面状态。
- adapter 负责把 Electron/page/OmniFlow 输入转成 port 所需的标准输入输出。
- orchestration 负责生命周期和 dispatch，不重复 classifier/parser/downloader 算法。
- processing 负责 task、临时文件、ffmpeg、取消和清理，不反向依赖 renderer。
- renderer 只发起动作并展示安全投影，不持有 main 的资源、凭据和任务真相。
- `embeddedBrowserMainController` 最终只保留 facade/orchestration。

### 5.2 唯一 owner

| 事实 | 目标 owner |
| --- | --- |
| tab/view/session 生命周期 | Electron main lifecycle/orchestration |
| 捕捉资源与去重状态 | main `ResourceStateStore` |
| Cookie/Authorization 等请求上下文 | main context vault |
| 页面 hook 安装 | main page-runtime adapter；port 提供 bundle |
| HLS/DASH/MSE/ffmpeg 长任务 | main task registry |
| HLS/DASH 解析和计划语义 | `cat-catch-port` |
| MSE spool/temp/staged output | main processing/filesystem |
| 资料库上传执行 | 现有 UploadManager |
| processing/delivery 的用户工作流投影 | application-scoped coordinator |

## 6. 纳入与排除

默认纳入：

- 网络请求时机、headers、规则、分类、去重和资源状态。
- Worker、fetch/XHR、JSON、TextDecoder、key、inline manifest 等页面深搜经验。
- MediaSource/SourceBuffer 捕捉、分轨、flush、reset 和清理。
- HLS/DASH parser、plan、range、key、map、track、retry、live 和输出语义。
- 文件名、URL、模板和媒体签名等被上述能力调用的共享经验逻辑。
- Electron 安全、IPC、task、temp、ffmpeg、资料库导入等平台适配。

默认不直接移植：

- popup/options/side panel 的 CSS、翻译和纯视觉状态。
- Chrome action/context menu/alarms/service worker 等扩展产品生命周期。
- 只为浏览器 Blob/下载限制存在、Electron 有更可靠替代的 workaround。
- recorder/WebRTC/JSON viewer/MQTT 等当前产品目标外的外围能力。

排除前仍要检查 HTML 默认值、script 引用、manifest、依赖和 query 参数。文件是 CSS/HTML 或提交标题写“UI”不能代替语义判断。

## 7. 单项迁移协议

每项 capability 按同一流程处理：

1. **Map**：确认 `migrationTarget` 下全部上游 path/anchor 及直接行为依赖。
2. **Characterize**：记录当前 OmniFlow 行为和风险，只用于防回归，不把旧行为当正确答案。
3. **Test/Fixture**：先建立最小可执行失败测试；需要结构化输入和 expected 时再创建 fixture。
4. **Reference**：优先运行固定上游子模块；不适合执行时采用独立规范 expectation，并说明原因。
5. **Port**：在 `cat-catch-port` 忠实实现，保留分支顺序、兼容原因和 source anchor。
6. **Adapt**：通过薄 adapter 接入 Electron/IPC/文件/ffmpeg/资料库。
7. **Verify**：比较行为 trace、结构或输出字节，并覆盖异常、取消和清理。
8. **Cut over**：unit 内相关能力就绪后，在唯一 dispatch boundary 切换。
9. **Clean**：同一切片删除旧算法、旧 listener/handler、旧 flag、fallback 和旧测试 helper。
10. **Record**：更新 capability map、同步日志和版本游标。

不得把目录移动、行为重写、上游同步和 UI 重做混在一个不可审查的改动中。

## 8. Test、Fixture 与验证

### 8.1 计划测试与真实 Fixture

`plannedTestIds` 只是需求种子，可能对应 pure behavior、Electron integration、output 或 stability test。实现时可以拆分、合并或删除不再准确的 seed，但 `verified` 状态下每个保留 ID 都必须由同名 `testRefs` 的 `path#id` 覆盖，且 path 必须是真实 test/spec 文件。测试实际通过后才可计为验证。

需要输入和 expectation 的行为场景使用：

```text
tools/cat-catch-lab/fixtures/<fixture-id>/
  fixture.json
  input...
  expected...
```

`fixture.json` 至少记录 capability IDs、上游 commit、状态、输入和 test refs。不要为计划测试预建空目录；只有真实场景落地时才创建 fixture。

### 8.2 验证层级

| 层级 | 目的 |
| --- | --- |
| Pure behavior | classifier/parser/plan/retry 等确定性行为 |
| Upstream differential | 防止遗漏 Cat Catch 经验分支 |
| Electron integration | document-start、tab/session、IPC、state、task |
| Output correctness | hash、parser、容器结构、ffprobe |
| Stability | timeout、cancel、导航、tab close、退出、内存/temp 预算 |
| Manual smoke | 真实页面补充观察，不作为唯一门禁 |

没有时间慢测时，必须先完成可自动执行的前五层。涉及资料库的手工验证禁止使用第一个资料库，公司环境使用本机 macOS MinIO 上的非第一个资料库。

### 8.3 Oracle 边界

- 固定上游 commit 和所需源码，不运行上游 install/postinstall。
- 页面脚本视为不可信，使用隔离 Electron context、loopback fixture 和资源上限。
- 无法安全执行的子模块使用 recorded/spec-derived expectation，不伪装成 exact oracle。
- normalizer 只能去除时间、随机端口和临时路径，不能忽略数量、顺序、headers、错误或输出内容。

## 9. Cutover 与旧代码删除

初始 cutover units：

1. `network-capture`
2. `deep-search-runtime`
3. `mse-runtime`
4. `hls-engine`
5. `dash-engine`
6. `transfer-engine`
7. `output-integration`

一个 unit 的切换至少要求：

- unit 内能力达到 `ported-unverified`，且生产等价 integration 测试通过。
- dispatch boundary 唯一且可定位。
- 侵入式 page runtime/MSE 不会双安装。
- 新 owner 写入生产状态后，旧 owner 立即不可达。
- 该 unit 对应的旧实现和兼容入口在同一切片删除。
- `retain-or-adapt` 项重新确认仍有真实 OmniFlow 职责。
- 完整 TypeScript、相关测试和最小 Electron smoke 通过。

禁止保留：

- “以防万一”的旧 classifier/parser/downloader。
- 默认关闭但仍可重新启用的旧 feature flag。
- 新旧两套 listener、IPC handler 或 page hook。
- 只转发到新实现、没有兼容期限的 wrapper。
- 已无调用方的类型、helper 和旧使用指南。

如果需要回滚，revert 完整 cutover commit 或回到已知良好版本，不重新启用藏在代码中的旧 owner。

## 10. 当前优先级

推荐顺序：

```text
同步状态与能力映射稳定
  -> network-capture（已关闭）
    -> deep-search runtime
      -> MSE
        -> HLS（已关闭）
          -> DASH
            -> transfer/output integration
```

优先选择能够形成“真实 fixture -> port -> adapter -> production test -> 删除旧实现”的小闭环，不先拆三千行 controller。

## 11. 轻量检查边界

当前 `tools/cat-catch-sync/validate.mjs` 只自动检查：

- state/map 的字段、唯一 ID、游标和引用关系。
- verified 的计划测试 ID 是否绑定到真实 test/spec 文本。
- 已切换能力的 target owner、引用存在性和 unit 原子性。
- 传入上游源码目录时，remote、branch head、commit 祖先、path 和 anchor。

本轮 diff 是否完整分类、`cat-catch-port` 依赖边界、TypeScript、lint、行为测试和 Electron smoke 由同步 Agent/CI 显式执行并记录；当前 validator 不解析全仓 import graph、Git diff 或 sync log，也不把这些步骤伪报成已自动证明。

不再构建全仓 AST 调用图、反向不动点闭包、trusted attestation、report-index、artifact retention、Gate 或 seal 链。那些机制不能直接保护 Cat Catch 行为，且会让维护工具本身成为主要工作量。遇到疑难调用关系时可以使用现成代码搜索、TypeScript 和一次性分析，但不把一次性诊断升级为长期框架。

## 12. 当前下一步

1. 运行轻量 `cat-catch:validate`，确认版本、32 项能力、目标 owner 和测试引用自洽。
2. `mse-runtime` 已关闭。后续只补固定上游差分、生产等价大媒体、外部网站真实播放器页面和真实下载导入等第二阶段证据；不把这些补测缺口倒写成新的 runtime owner 或长期同步框架。
3. `dash-engine` parser-planner 与 timeline-download-merge 已关闭：同身份静态多 Period 串接、availability-bounded `r=-1`、dynamic duration-only 窗口、client clock offset、有限 dynamic snapshot 下载、main XML/fetch adapter、live session owner、增量追加和 start/stop/discard IPC 由契约测试锁定；真实静态与 dynamic-refresh ffprobe output 已通过条件式真实二进制测试，复杂/无界输入保持显式 reject。后续只在上游变化或真实回归时增量维护 DASH。
4. 所有 32 项 capability 均已有 target owner，7 个 cutover unit 均已关闭并标记为 `verified`；transfer unit 的 3 项能力与 `processing.main-task-registry` 由 `cat-catch-port/processing/transfer-engine.ts#TransferEngine`、`processing/native-download-session.ts#NativeDownloadSession`、`processing/streaming-transfer.ts#StreamingTransfer` 和 `processing/task-registry.ts#ProcessingTaskRegistry` 持有。`cat-catch:smoke-host` 已提供隔离真实 Electron 的 Cookie/Authorization 页面捕捉/opaque authority/download/crash/replacement/save/cleanup 证据，`cat-catch:smoke-large-host` 把同一链扩到 64 MiB 并以流式 SHA-256 校验，`cat-catch:smoke-save-dialog` 已在 macOS 真实系统保存框中分别覆盖取消、确认、production save IPC、同字节输出与 staging/journal 清理；HLS/DASH live 已补 32 个重叠窗口的 bounded continuity 与 5 分钟真实 timer/filesystem append，`cat-catch:smoke-protocol-large` 与 `cat-catch:smoke-protocol-multi-gib` 已分别用总 512 MiB 和总 2 GiB 验证 async sink 与磁盘 part 顺序拼接，`cat-catch:smoke-ffmpeg-large` 已补 production merge/transcode 的真实大媒体预算，`cat-catch:smoke-real-media` 已补公开真实 HLS/DASH 的 parser-to-FFprobe 闭环；后续 output-integration 只补完整 OmniFlow 登录态窗口、跨平台宿主、真实资料库交付、外部网站真实登录流程和更长宿主墙钟等第二阶段证据。Staged lease 继续是 main-only 实现边界，不再把 renderer lease IPC 当作待办，也不把宿主证据缺口描述成尚未完成的初次 port。
