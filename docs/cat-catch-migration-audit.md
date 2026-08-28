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

当前映射包含 7 个 cutover unit、32 项能力、210 个上游 anchor、106 个 cleanup entry 和 187 个唯一计划测试 ID。11 项能力达到 `verified`，5 项为 `porting`，1 项为 `ported-unverified`，其余 15 项仍为 `pending`；152 个唯一计划测试引用已落成 active pure behavior/contract、fake/real Electron integration 或 loopback redirect test。`network-capture` 与 `hls-engine` 已完成固定目标下的原子 cutover，其余 5 个 unit 仍开放。

## 2. 能力族

| 能力族 | 当前实现 | 已知结论 |
| --- | --- | --- |
| network capture | verified target runtime + thin Electron/IPC/settings adapters | `EmbeddedBrowserCaptureRuntime` 是 production 唯一 listener/store/vault owner；Cat Catch 规则和 page policy、OmniFlow 设置、首字节分类、redirect/terminal cleanup、tokenized probe、opaque resource authority、renderer-safe reducer 与 owner lifecycle 均有专项证据。旧 bridge/state/classifier/main DTO 已删除；data/blob、未捕获拖拽、DASH 与旧 toolkit fallback 分属其他开放 unit |
| deep-search runtime | stateful port + toolkit/page/resource adapters + target-only complete probe + inactive production hooks | 固定 `findMedia/toUrl` 的 width/depth/cycle、宽松 key、inline M3U8/MPD、data URL 和跨 hook base URL 回放已有 fixture；target installer 已覆盖 Worker CSP 回退、bootstrap relay、fetch clone、XHR、JSON、TextDecoder 与 Cat Catch key/string 经验面。toolkit owner 锁定 origin localStorage、`"checked"`、规则验证、重载和 storage failure，并已通过既有 get/update bridge 向 MSE/page actions 同步只读偏好投影；target page adapter 还锁定 XHR/fetch 根字符串顺序、inline scan、Vimeo generated resource 和 nested Worker 回放。generated-resource page owner 已接管 signature/Blob/base64/open/export/read 并委托 MSE key；完整 target probe 已从 main-owned resource key 读回 Cat Catch 归一化 manifest bytes。原子 cutover 与其余 cleanup 尚未完成，production hooks 仍关闭 |
| MSE runtime | legacy owner | 有增量 spool 思路，但没有专项差分、输出和稳定性测试 |
| HLS engine | verified target parser/plan/local/live execution + thin main adapter + main-owned direct/track authority | 固定目标的下载相关 parser/plan、key/MAP/range、manual key、AES-128/256、静态/直播、独立双轨、retry/cancel、authority、force-cache recovery、生命周期和真实 ffmpeg/ffprobe 输出均有同名证据；生产与测试直接依赖 shared contract、pure port、`HlsTaskExecutor`、`HlsLiveTask` 和 session owner，旧 renderer model、顶层 downloader/recorder re-export 及 legacy-named handler 已在同一切片删除；未捕获派生 URL 的 embedded-session fallback 是保留的平台 adapter，不是旧 HLS 算法 |
| DASH engine | legacy owner + partial authority transport | 计划下载的已捕获 init/media 分片已优先走当前 tab authority；手写 parser 对负 repeat、多 BaseURL、动态 MPD 等语义仍不完整 |
| transfer engine | multiple owners | 并发/重试代码可复用评估，但没有统一 task/cancel/cleanup owner |
| output integration | mixed: opaque resource authority + legacy DASH/drag/toolkit paths | external-tool、inspection、普通资源下载、已捕获页面拖拽、HLS direct/track 和 HLS/DASH 计划分片传输已接入 main-owned authority；HLS manifest/track 两个 ffmpeg 入口已共享可取消 process runner、独立绑定双轨 headers，并在每个 input 前独立声明 HLS protocol/extension 策略后清理失败 partial output；真实加密 fMP4/H264 + AES-128/AAC 双轨输出已有 ffprobe 证据；HLS renderer 可恢复 main 任务投影，但资料库交付目标仍是 feature-scoped closure，因此直播在工具卸载时继续 discard 并清理输出目录；data/blob、未捕获资源和多资源 fallback 仍走旧链，另外 4 个 ffmpeg 入口、DASH、派生字幕 URL、process terminal、m3u8dl encoding、staged output lease、本地保存、资料库导入与 application workflow coordinator 仍待迁移 |

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

1. `enableDeepRuntimeHooks = false`。
2. production network capture 已切换为唯一 `onResponseStarted` target owner；真实网站手工回归仍是环境验证缺口。
3. main-only vault/store 已完成 network unit 收口；DASH 直拉和 catch toolkit 的过渡 DTO 归其各自 unit，不能重新引入 renderer request-header 真相源。
4. target TextDecoder inline manifest hook 与 generated adapter 证据已存在，但 production template 尚未接入。
5. JSON 深度/宽度/cycle 的 pure discovery 与 generated page/Worker composition 已对齐；尚未通过 production document-start probe template 接入。
6. target Worker Blob CSP 异步失败采用已记录的安全差异并有回退/cleanup 测试，但 production template 尚未接入。
7. HLS 固定目标的下载相关 parser/pipeline、静态/直播、authority、生命周期和真实输出范围均已完成测试验证与原子 cutover；真实网站手工回归仍是环境验证缺口，不再保留旧算法作为备用。
8. MPD `r=-1`、多 BaseURL、动态 timeline/range 不完整。
9. ffmpeg、HLS/DASH、直播、普通下载和 temp 没有应用级统一 task registry；HLS 的导航、tab/view 销毁、render-process loss、controller dispose 和应用退出已通过专用 host lifecycle 取消并等待 active fetch/ffmpeg 与在途 session cleanup，但非 HLS 的 4 个 ffmpeg 入口仍未纳入该 owner。
10. 目前有 152 个唯一 active test ref；逐项名称与来源以 capability map 为准。Network/HLS 证据已支撑对应 unit cutover；deep/MSE/DASH/transfer/output 仍按各自开放状态判断。

### 3.1 Deep 原子切换边界

`deep-search-runtime` 的 31 个 cleanup 条目已按实际调用方重新审计，不能再按旧文件名整块删除：

| 类别 | 数量 | 当前处置 |
| --- | ---: | --- |
| 保留适配 | 11 | lifecycle/page relay、console prefix、通用 probe template、toolkit 三个 page bridge、generated-resource action/extract bridge；继续作为 OmniFlow platform adapter，bridge contract 已可执行验证 |
| 纯旧实现 | 11 | 旧 production builder/wrapper、disabled deep flag、manifest heuristics、旧 Worker 注入/bootstrap、旧 toolkit state/storage/get/update 和旧 `probeResources`；target dispatch 接管时同批删除 |
| 先拆分再删除 | 9 | 混合 core/hooks/page-actions、三个 MSE catch action、console emitter、global probe API 和 page resource read；先把仍被 MSE 使用的职责迁到明确 owner，再删除旧 symbol |

这里的“保留适配”不是保留第二套算法；它们只生成受控页面调用或维持 tokenized relay/template。`deep.toolkit-page-bridge-contract` 和 `deep.generated-resource-page-bridge-contract` 已锁定精确 payload/resource key 转发、布尔归一和缺失 handler 返回。剩余 20 个 `remove-after-cutover` entry 仍由 `legacy-cleanup.json` 强制检查，不能靠重命名或改分类绕过。

## 4. 保留、迁移与删除

- 忠实迁移：network classifier/rules、deep search、MSE 经验分支、HLS parser/pipeline、downloader 竞态。
- 平台适配：Electron webRequest、page relay、filesystem、ffmpeg、外部工具、资料库导入。
- 成熟库替代：DASH/MPD parser core，但行为必须用 fixture 验证。
- 保留唯一 owner：tab/view lifecycle、ResourceStateStore、UploadManager。
- 最后收口：`embeddedBrowserMainController.ts` 只保留 orchestration/facade。
- 切换后删除：旧算法、旧 listener/handler、flag、fallback、兼容转发和测试 helper。

## 5. 当前下一步

下一步处理 9 个“先拆分再删除”symbol：优先抽出 MSE runtime/action 与通用 console/global API，再让 production document factory 使用 target probe；随后同批删除 11 个纯旧 Deep symbol 和拆分后的旧壳。Network/HLS 后续只在真实回归发现问题或上游游标前进时增量维护。
