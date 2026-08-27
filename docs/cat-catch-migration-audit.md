# Cat Catch 当前迁移摘要

更新时间：2026-08-28

状态：初始迁移尚未完成。本文只总结已确认事实，逐项状态以 `docs/cat-catch/capability-map.json` 为准。

## 1. 当前版本

| 字段 | 值 |
| --- | --- |
| baseline / observed / target | `2cb981d7c2f4614732edccc167c4b5793d1cb138` |
| upstream description | `2.7.2-22-g2cb981d` |
| reviewedThrough | 未建立 |
| portedThrough | 未建立 |

当前映射包含 7 个 cutover unit、32 项能力、197 个上游 anchor、106 个 cleanup entry 和 141 个唯一计划测试 ID。9 项能力达到 `ported-unverified`，5 项为 `porting`，其余 18 项仍为 `pending`；95 个唯一计划测试引用已落成 active pure behavior/contract、fake/real Electron integration 或 loopback redirect test，尚无已完成的 cutover unit。

## 2. 能力族

| 能力族 | 当前实现 | 已知结论 |
| --- | --- | --- |
| network capture | target runtime 已在 production controller 实例化，legacy bridge/consumer 仍并存 | Cat Catch 规则与产品 policy 分层、page policy、vault/store、当前/下一 navigation generation 的 tokenized probe routing、renderer-safe reducer、唯一 network/per-view probe composition、owner lifecycle、main-only probe key 解析、context-free stale owner 拒绝和 redirect hop 凭据隔离已有专项测试；资源状态事件、opaque inspection、普通资源下载、probe open/export/read、external-tool dispatch 已接入 production IPC/preload/renderer；已捕获 URL 的页面拖拽会绑定当前 tab 的 opaque resource authority，未捕获、data/blob 和外部拖拽仍走受限 fallback；HLS/DASH 计划下载和旧 catch toolkit 仍待迁移与验证 |
| deep-search runtime | legacy inactive | 深度 hooks 写死关闭，外围 MSE hook 仍运行 |
| MSE runtime | legacy owner | 有增量 spool 思路，但没有专项差分、输出和稳定性测试 |
| HLS engine | pure parser/pipeline slices + legacy pipeline + main-owned direct/track authority | 纯 port 已接管 manifest parse facade，并用 fixture 覆盖 master/media parser 双向模式隔离、master 普通 variant/I-frame/混合未知 codec 过滤与无普通 level 拒绝、`EXT-X-SESSION-KEY` 有序变量错误但不传播到 fragment key、media valued-tag 的冒号/非空 payload 分发、媒体分片继承紧邻前序 BYTERANGE end（含 URI 切换）、MAP 独立 range、MAP 前置独立 BYTERANGE 双重绑定、BYTERANGE 的固定 `parseInt` 数值归一化与无效范围稳定拒绝、缺失/空 URI 拒绝、full-segment AES media sequence/MAP zero effective IV、MAP 声明时 key context 与随后 media key 隔离、固定 full EME build 的 KEYFORMAT 支持/忽略/继承/多 key 选择、正数 `EXT-X-SKIP` delta 稳定拒绝、初始/增量 discontinuity sequence、map/key、LL-HLS PART/完整分片边界、空或 PART-only media playlist 拒绝、缺少格式头/目标时长及重复或晚置关键标签的结构拒绝、`EXT-X-DEFINE` 的定义/查询参数/显式导入/单次替换/首错误拒绝，以及 PNG/JPEG 伪装分片前缀剔除；显式本地 child resolver 复用 master variable list，直播 child 在首次请求前经 main-owned captured master authority 校验归属并缓存变量列表，resolver 与 manifest/segment 共用取消信号；PART 不进入 Cat Catch 等价下载列表，连续 live snapshot 只累计新发布的完整 EXTINF 分片；计划下载和 live 录制的已捕获 manifest/分片/key/map 已优先走当前 tab authority，direct 只接受当前 active snapshot 的精确 opaque resource id，track 会独立兑换 video/audio URL 与 protected headers，未捕捉的所选子 manifest 在 renderer 明确拒绝；HLS inspection 与 live 首次 manifest HTTP 失败会各自执行至多一次同 URL force-cache recovery，MPD、无响应网络错误和后续直播轮询不进入该分支；本地 HLS 分片链已接入可选预处理、有序 processor chain、AES-128 key 长度校验，key/map/media 共用取消信号，key/map 文件按资源去重而 rewritten playlist 会按 MAP key -> MAP -> media key 顺序及 IV/KEYFORMAT 状态轮换，直播 manifest/segment 轮询也可由 discard 主动中止；active direct/track/plan/retry/live-export、retry/live 会话及最多 32 条安全任务投影均由专用 HLS owner 按 tab/request 管理，renderer 先订阅事件再读取只读 snapshot，并以 main 单调 revision 恢复当前 manifest/variant/rendition；导航、关闭、view 销毁/崩溃、controller dispose 和应用退出均经唯一 host lifecycle 取消并等待 active task、清理投影，再删除 workdir/discard recorder；fake handoff smoke 已覆盖 local key/map/media 到 ffmpeg wrapper 且拒绝空输出，真实二进制 integration 已验证 clear、显式 IV AES-128 与非零 sequence 隐式 IV AES-128 local HLS 经唯一 ffmpeg owner 交付为 MP4/AAC/正时长输出；完整 parser 其余语义仍有明确缺口 |
| DASH engine | legacy owner + partial authority transport | 计划下载的已捕获 init/media 分片已优先走当前 tab authority；手写 parser 对负 repeat、多 BaseURL、动态 MPD 等语义仍不完整 |
| transfer engine | multiple owners | 并发/重试代码可复用评估，但没有统一 task/cancel/cleanup owner |
| output integration | mixed: opaque resource authority + legacy DASH/drag/toolkit paths | external-tool、inspection、普通资源下载、已捕获页面拖拽、HLS direct/track 和 HLS/DASH 计划分片传输已接入 main-owned authority；HLS manifest/track 两个 ffmpeg 入口已共享可取消 process runner、独立绑定双轨 headers，并清理失败 partial output；HLS renderer 可恢复 main 任务投影，但资料库交付目标仍是 feature-scoped closure，因此直播在工具卸载时继续 discard 并清理输出目录；data/blob、未捕获资源和多资源 fallback 仍走旧链，另外 4 个 ffmpeg 入口、DASH、派生字幕 URL、process terminal、m3u8dl encoding、staged output lease、本地保存、资料库导入与 application workflow coordinator 仍待迁移 |

HLS master 现已按固定 level identity 与 resolved URI 合并重复 variant；即使相同 URI 被其他 URI 隔开，parser、download plan 与工具区仍保留完整且有序去重的 AUDIO/SUBTITLES group 集合，单值字段只作为兼容首组。固定 hls.js 的 `MANIFEST_LOADED` 会保留跨 URI 声明，但 Cat Catch 生成选择项所消费的 `MANIFEST_PARSED` 只暴露首 URI；显式相同 `PATHWAY-ID` 时还会把后续 URI 的 group 合到首 URI。OmniFlow 接受数据保留差异：每个 identity/URI 继续独立可选，不增加 fallback 顺序或 failover 执行语义。

固定 hls.js 会先用 `isMediaPlaylist` 选择 master 或 media parser：出现 `EXTINF` / `TARGETDURATION` 后，混入的 `STREAM-INF` / `MEDIA` 不能再生成 variant/rendition。对应 URI 仍由 media URI alternative 物化为 fragment，并贯穿 sequence、MAP、key、implicit IV 与 Cat Catch 下载计划；pure parser 不允许 master-only 分支反向改变已确定的 media 模式。

HLS key 的显式 IV 现按固定 hls.js `AttrList.hexadecimalInteger` 转为字节后再投影到 manifest 和 download plan：奇数位左补零，大写输出归一为小写，无效 `parseInt` 结果沿用 `Uint8Array` 的零值强制转换；缺失或空 IV 继续按 fragment sequence（MAP 为 0）派生。

HLS 带值标签只在固定标签名后紧接冒号且冒号后至少有一个字符时进入 media parser 分支；`KEY-CACHE`、`MAP-FOO`、`MEDIA-SEQUENCE-FOO`、`STREAM-INF-FOO` 等未知扩展保持固定 hls.js 的 fallback，不得清空 key、替换 MAP/range、改写 sequence 或吞掉 media URI。裸 `MAP:` / `BYTERANGE:` / `PLAYLIST-TYPE:` 同样只进入 fallback，既有 init/range/type 状态不变；裸 `DEFINE:` 不会凭空创建名为 `undefined` 的变量，后续引用仍按固定错误拒绝。整数媒体标签继续要求冒号后的首 token 以数字开头：带正负号的 TARGET/MEDIA/VERSION 不进入数值分支，数字后的文本前缀仍被接受；`DISCONTINUITY-SEQUENCE` 未命中整数分支时会落入固定无值前缀行为，因此 parser 分开保留 initial sequence 与 current cc。`BYTERANGE` 的 length/offset 现按固定 hls.js `BaseSegment.setByteRange` 使用无 radix `parseInt`，因此合法整数前缀会进入 manifest 和 plan，省略 offset 继续沿用既有 fragment/MAP 关系。固定 hls.js 对零/负 length、NaN 和负 offset 会保留空或非法 range，Cat Catch 随后生成不可执行 `Range`；OmniFlow 接受稳定拒绝差异，在计划创建前抛错且不退化为整资源下载。

`EXTINF` 继续复刻固定 fast regex 的 decimal-prefix 回扫，而不是改写成宽松 `Number`：`.5` 是合法时长；`-3/+3` 的整段值以及 `3e2/4tail/0x4` 的非十进制 remainder 会被下一轮 URI 分支识别为额外分片，随后真实 URI 再成为一个零时长分片。超长纯十进制被 `parseFloat` 转成 `Infinity` 后会抑制后续 URI，空 duration 不重置该 fragment 状态，直到有效 duration 才恢复。Cat Catch `parseTs` 会把实际物化项加入下载列表，因此 pure manifest 与 plan 同步推进 sequence、AES implicit IV 和总时长。

## 3. 高优先级缺口

1. `enableDeepRuntimeHooks = false`。
2. 生产网络捕捉仍为 `onCompleted`；目标 adapter 已实现首字节阶段识别，但在整个 unit 就绪前不能与旧 listener 同时注册。
3. 生产 request context 的新 vault/store 已接入 target runtime；HLS direct/track、HLS/DASH 计划和 HLS live source/selected child 已能通过 authority 恢复或验证上下文，live-start 不再接收 renderer headers/pageUrl；DASH 直拉和 catch toolkit 仍保留过渡 DTO，尚未完成统一清理。
4. TextDecoder inline manifest hook 缺失。
5. JSON 深度/宽度/cycle 语义未与上游对齐。
6. Worker Blob CSP 异步失败回退不等价。
7. HLS master/media parser 双向模式隔离、master 普通 variant/I-frame/未知 codec 过滤与无 level 拒绝、AUDIO/SUBTITLES rendition 投影与 child authority、直播 child 首次 fetch 前归属校验、`EXT-X-SESSION-KEY` 解析但不进入 fragment key、带值标签精确冒号/零字符与 whitespace payload 分发、整数首 token 与 `EXTINF` decimal-prefix 回扫边界、媒体/MAP BYTERANGE offset 与数值归一化、MAP 前置独立 range 双重绑定与缺失/空 URI 拒绝、full-segment AES media/MAP effective IV、独立 MAP/media key context、KEYFORMAT 支持/忽略/继承/多 key 选择、正数 `EXT-X-SKIP` delta 拒绝与同 key URL 下的 playlist 状态轮换、初始/当前 discontinuity sequence 双状态、LL-HLS PART/完整分片边界、空/无效 media playlist 与重复 singleton 标签拒绝、`EXT-X-DEFINE` 变量语义及直播 child 的 main-owned parent variable 恢复、PNG/JPEG 伪装分片剔除和一次性 manifest force-cache recovery 已在 pure/integration tests 中覆盖；local-to-ffmpeg fake handoff 已验证本地 key/map/media 引用与非空输出约束，真实 ffmpeg/ffprobe integration 已验证 clear 与两类 AES-128 encrypted AAC HLS 均可交付为 MP4/AAC/正时长文件；加密 fMP4/video 真实输出组合和更完整 parser 差分仍缺失。
8. MPD `r=-1`、多 BaseURL、动态 timeline/range 不完整。
9. ffmpeg、HLS/DASH、直播、普通下载和 temp 没有应用级统一 task registry；HLS 的导航、tab/view 销毁、render-process loss、controller dispose 和应用退出已通过专用 host lifecycle 取消并等待 active fetch/ffmpeg 与在途 session cleanup，但非 HLS 的 4 个 ffmpeg 入口仍未纳入该 owner。
10. 目前有 95 个唯一 active test ref；main composition、持久化捕捉设置热更新、下一文档 token 路由、main-only probe key 解析与下载、检查、probe 动作、external-tool target consumer、已捕获页面拖拽暂存、HLS direct/track 与 HLS/DASH 计划/live 分片 authority transport，以及 HLS master/media 双向模式隔离、master variant/rendition/session-key 边界、重复 variant group 合并与工具选择、带值标签精确冒号/零字符与 whitespace payload 分发、整数标签与 `EXTINF` token 边界、media/MAP range、BYTERANGE 数值归一化、MAP 前置 range 转交与 URI 拒绝、full-segment AES effective/local-playlist IV、显式 IV 字节归一化、KEYFORMAT 支持与多 key 选择、delta playlist 拒绝、encrypted MAP key/order、LL-PART、空或结构无效 media 与重复 singleton 拒绝、变量替换/直播 parent 与 selected child authority 边界、AES-128 production output、cache fallback/static/live abort/session/active/ffmpeg/lifecycle cleanup、renderer listener/snapshot recovery、直播卸载输出清理和真实 output probe 已有专项证据，普通资源下载和 inspection 已有 production IPC 入口；页面拖拽 fallback、HLS parser 其余完整标签语义、旧 toolkit 及完整 unit cutover 仍无 production cutover 证据。

## 4. 保留、迁移与删除

- 忠实迁移：network classifier/rules、deep search、MSE 经验分支、HLS parser/pipeline、downloader 竞态。
- 平台适配：Electron webRequest、page relay、filesystem、ffmpeg、外部工具、资料库导入。
- 成熟库替代：DASH/MPD parser core，但行为必须用 fixture 验证。
- 保留唯一 owner：tab/view lifecycle、ResourceStateStore、UploadManager。
- 最后收口：`embeddedBrowserMainController.ts` 只保留 orchestration/facade。
- 切换后删除：旧算法、旧 listener/handler、flag、fallback、兼容转发和测试 helper。

## 5. 当前下一步

下一步继续 HLS 完整 parser 标签语义；DASH 直拉与旧 catch toolkit 的过渡 DTO 分别留在 DASH/network unit 收口，非 HLS ffmpeg 的应用级 owner 留在 output-integration unit。证据完整前不进行 hls-engine cutover，也不提前删除旧链。
