# Cat Catch 当前迁移摘要

更新时间：2026-08-29

状态：初始迁移尚未完成。本文只总结已确认事实，逐项状态以 `docs/cat-catch/capability-map.json` 为准。

## 1. 当前版本

| 字段 | 值 |
| --- | --- |
| baseline / observed / target | `2cb981d7c2f4614732edccc167c4b5793d1cb138` |
| upstream description | `2.7.2-22-g2cb981d` |
| reviewedThrough | 未建立 |
| portedThrough | 未建立 |

当前映射包含 7 个 cutover unit、32 项能力、211 个上游 anchor、102 个 cleanup entry 和 229 个唯一计划测试 ID。15 项能力达到 `verified`，11 项为 `porting`，1 项为 `ported-unverified`，其余 5 项仍为 `pending`；226 个唯一计划测试引用已落成 active pure behavior/contract、fake/real Electron integration 或 loopback redirect test。`network-capture`、`deep-search-runtime` 与 `hls-engine` 已完成固定目标下的原子 cutover；DASH 的 renderer parser facade、main task、live task、main XML adapter、增量追加 helper、独立 session owner、strict manifest authority 和 output adapter 已接入目标代码，静态双轨、dynamic refresh/append 与有限深度嵌套 SIDX 的真实/任务级证据已有，live start/stop/discard 也已接生产 main/preload IPC（当前没有 renderer UI），并且轮询终止错误会清理 live session/workdir；native `will-download` 现由 `NativeDownloadSession` 负责 staging、进度、终态和 registry 取消，分片 downloader 也由单一外部 signal 收口并发取消；普通直链与已捕获资源下载已进一步通过 `StagedOutputLeaseStore` 和 `publishStagedOutput` 完成处理期隔离、单次 claim 与最终发布，但 HLS/DASH/MSE、local-save、UploadManager handoff、crash quarantine 和 Cat Catch fallback 仍未接入；`dash.parser-planner` 与 `dash.timeline-download-merge` 仍保持 `porting`，其余 3 个 unit 仍开放。

## 2. 能力族

| 能力族 | 当前实现 | 已知结论 |
| --- | --- | --- |
| network capture | verified target runtime + thin Electron/IPC/settings adapters | `EmbeddedBrowserCaptureRuntime` 是 production 唯一 listener/store/vault owner；Cat Catch 规则和 page policy、OmniFlow 设置、首字节分类、redirect/terminal cleanup、tokenized probe、opaque resource authority、renderer-safe reducer 与 owner lifecycle 均有专项证据。旧 bridge/state/classifier/main DTO 已删除；data/blob、未捕获拖拽与 DASH 分属其他开放 unit |
| deep-search runtime | verified production target + thin page/main adapters | 固定 `findMedia/toUrl` 的 width/depth/cycle、宽松 key、inline M3U8/MPD、data URL 和跨 hook base URL 回放已有 fixture；production installer 覆盖 Worker CSP 回退、bootstrap relay、fetch clone、XHR、JSON、TextDecoder 与 Cat Catch key/string 经验面。page-origin toolkit owner、generated-resource owner、tokenized document ingress、main store 与 bytes readback 已在唯一 document factory 贯通。旧 disabled hooks、manifest heuristic、Worker bootstrap、toolkit state/storage、`probeResources`、混合 core/host 和 compatibility wrapper 已同批删除 |
| MSE runtime | target page owner + main spool port, production parity pending | `mse/runtime.ts` 持有 MediaSource/SourceBuffer 观察、per-track retention、flush/reset 和 drain；`mse-page.ts` 只负责页面动作与平台转接；`MseSpoolStore` 持有 main 临时文件、预算、TTL 和生命周期清理；页面已 flush 的轨道由 main 下载路径逐轨读取；自动完成动作在 main 侧优先合并音视频并通过现有 download completion/import contract 交付，renderer 不再重复保存。新增默认关闭的 `saveEveryGigabyte`：每次 flush 后按所有轨道累计总字节跨越 1 GiB 才串行触发 main 输出，成功后清理 page cache 和 spool，下一周期可重新计数。固定上游 parity、生产等价大媒体和真实下载导入仍未验证，不能关闭 unit |
| HLS engine | verified target parser/plan/local/live execution + thin main adapter + main-owned direct/track authority | 固定目标的下载相关 parser/plan、key/MAP/range、manual key、AES-128/256、静态/直播、独立双轨、retry/cancel、authority、force-cache recovery、生命周期和真实 ffmpeg/ffprobe 输出均有同名证据；生产与测试直接依赖 shared contract、pure port、`HlsTaskExecutor`、`HlsLiveTask` 和 session owner，旧 renderer model、顶层 downloader/recorder re-export 及 legacy-named handler 已在同一切片删除；未捕获派生 URL 的 embedded-session fallback 是保留的平台 adapter，不是旧 HLS 算法 |
| DASH engine | target parser/task + main live/output adapters, production dispatch switched | `cat-catch-port/dash/parser.ts` 已覆盖 Period/AdaptationSet/Representation SegmentTemplate、SegmentList、SegmentBase 继承、SegmentBase SIDX metadata、BaseURL、模板 token、SegmentTemplate `endNumber`、SegmentList timeline、静态最后一片 duration 修正、有限及 availability-bounded `r=-1`、dynamic duration-only SegmentTemplate 的 client clock offset、同身份静态多 Period 串接、SegmentList range validation 和 DRM 投影；`processing/dash-task.ts` 已收口 SIDX index-range fetch、range、顺序写入、取消和失败清理，并允许带有限当前窗口的 dynamic snapshot 走同一下载/合并路径；新增 `processing/dash-live-task.ts`、`dash-live-adapter.ts` 和 `dash-live-session-owner.ts`，由 main-owned task/adapter/owner 管理受限 MPD XML、snapshot 刷新、按 representation 去重、只追加新分片、停止/取消和 tab/view/退出清理；`integrations/dash-manifest-authority.ts` 要求 live MPD URL 与 captured resource URL 精确一致，避免无 authority fallback；DASH 本地轨道输出使用共享 ffmpeg process owner 的 `local-file` 输入模式，静态双轨真实 FFmpeg/FFprobe 证据已加入；DASH live start/stop/discard 已通过独立 main/preload IPC 暴露，MPD 计划下载和 live 输出均通过 captured-resource authority 与共享可取消 ffmpeg runner；当前没有 renderer UI。无 availability 证据的动态窗口、复杂嵌套 SIDX、不完整或初始化冲突的多 Period 集合、动态真实媒体输出与完整 unit 关闭仍未完成 |
| transfer engine | multiple owners | 普通直接/捕获资源下载已通过 `StreamingTransfer` 以临时文件流式写盘，并按 tab 登记到 `ProcessingTaskRegistry`；native `will-download` 已由 `NativeDownloadSession` 统一登记、取消和 staging 清理；分片 downloader 已统一外部 signal 并发取消；range terminal race、任务 registry 归属、Cat Catch native BrowserWindow fallback、StreamSaver provenance 和更广泛的统一 owner 仍开放 |
| output integration | mixed: opaque resource authority + legacy DASH/drag/toolkit paths | external-tool、inspection、普通资源下载、已捕获页面拖拽、HLS direct/track 和 HLS/DASH 计划分片传输已接入 main-owned authority；HLS manifest/track、DASH local-file merge、MSE merge、captured-resource transcode 和 media-tool operation 已共享可取消 process executor，并统一收集进度、处理 process-tree 终止、清理失败 partial output 和校验零退出后的非空产物；普通直链与已捕获资源下载的处理输出已通过 `publishStagedOutput` 写入 main-only lease，再一次性发布到用户目标路径，renderer 继续收到兼容的最终 `outputPath`；HLS 仍独立绑定双轨 headers，并在每个 input 前独立声明 HLS protocol/extension 策略；真实加密 fMP4/H264 + AES-128/AAC 双轨输出已有 ffprobe 证据；HLS renderer 可恢复 main 任务投影，但资料库交付目标仍是 feature-scoped closure，因此直播在工具卸载时继续 discard 并清理输出目录；HLS/DASH/MSE、local-save、UploadManager handoff、crash quarantine、data/blob、未捕获资源和多资源 fallback 仍走旧链，ffmpeg 可执行探测、派生字幕 URL 与 application workflow coordinator 仍待迁移 |

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

## 3. 高优先级缺口

1. production network/Deep/HLS 已切换为唯一 target owner；真实网站手工回归仍是环境验证缺口。
2. main-only vault/store 已完成 network unit 收口；DASH 直拉和 MSE/toolkit 投影归其各自 unit，不能重新引入 renderer request-header 真相源。
3. HLS 固定目标的下载相关 parser/pipeline、静态/直播、authority、生命周期和真实输出范围均已完成测试验证与原子 cutover，不再保留旧算法作为备用。
4. MPD 动态任务下载和真实 output 仍不完整；具备 availability 证据的动态 `r=-1` 与 duration-only 窗口已进入 target parser 的有限展开，同身份静态多 Period 已进入串接，但无 availability 证据的动态窗口、不完整/初始化冲突集合、复杂嵌套 SIDX、真实 MPD/ffprobe parity 仍未达到 unit 关闭条件。
5. `ProcessingTaskRegistry` 已建立并由共享 ffmpeg executor 使用，应用退出会等待并终止已登记进程；HLS/DASH/MSE 的协议任务、普通下载、外部工具和 temp 仍未全部登记，跨入口用户取消与 renderer-unmount recovery 仍开放。
6. 目前有 206 个唯一 active test ref；逐项名称与来源以 capability map 为准。Network/Deep/HLS 证据已支撑对应 unit cutover；MSE 的纯 runtime、spool 生命周期、relay 合同、synthetic output contract、条件式真实 FFmpeg/FFprobe 双轨合并、merge/transcode 失败 partial output 清理、零退出非空 output 校验、周期保存阈值、完成/清理边界、稀疏缓冲自动跳转以及 flush/drain 两条路径的头部裁剪证据已有，并明确覆盖跨音视频轨道的全局累计字节；production 大媒体、完整提取/导入与真实网站验证仍未完成；DASH parser-planner 与 timeline-download-merge 已接入生产目标但继续 `porting`，transfer/output 仍按各自开放状态判断。

### 3.1 Deep 原子切换边界

`deep-search-runtime` 已完成原子切换。28 个 cleanup 条目的结果是：

| 类别 | 数量 | 当前处置 |
| --- | ---: | --- |
| 保留适配 | 11 | lifecycle/page relay、console prefix、通用 probe template、toolkit 三个 page bridge、generated-resource action/extract bridge；继续作为 OmniFlow platform adapter，bridge contract 已可执行验证 |
| 已删除 legacy | 17 | 12 个纯旧实现与 5 个拆分项的旧 symbol 已与 production dispatch 切换同批删除；`legacy-cleanup.json` 继续检查它们不得回归 |

这里的“保留适配”不是保留第二套算法；它们只生成受控页面调用或维持 tokenized relay/template。新的 page runtime core/host API 仅承载平台 transport 和 MSE 投影，Deep 算法由 `cat-catch-port/deep-search` 唯一持有。MSE 专用 body 只是保持现有 production 行为，不代表 `mse-runtime` 已完成 Cat Catch parity。

## 4. 保留、迁移与删除

- 忠实迁移：network classifier/rules、deep search、MSE 经验分支、HLS parser/pipeline、downloader 竞态。
- 平台适配：Electron webRequest、page relay、filesystem、ffmpeg、外部工具、资料库导入。
- 成熟库替代：DASH/MPD parser core，但行为必须用 fixture 验证。
- 保留唯一 owner：tab/view lifecycle、ResourceStateStore、UploadManager。
- 最后收口：`embeddedBrowserMainController.ts` 只保留 orchestration/facade。
- 切换后删除：旧算法、旧 listener/handler、flag、fallback、兼容转发和测试 helper。

## 5. 当前下一步

下一步继续收口 `dash-engine`：补动态 MPD 的真实 live fetch/append/ffprobe output 证据、复杂 SIDX 语义和 renderer 工作流接入（若产品需要）；当前 live main/preload IPC、session owner 和增量追加已有自动契约测试，但没有真实网站/真实 MPD 验证，不能关闭 unit。无 availability 证据的动态窗口、复杂多 Period 与真实输出仍开放。DASH dispatch 已切换，静态多 Period 与 availability-bounded parser 行为已有受约束 fixture，后续以行为差分和真实回归决定是否关闭 unit。MSE 只补真实页面与固定上游 parity，Network/Deep/HLS 后续只在真实回归发现问题或上游游标前进时增量维护。
