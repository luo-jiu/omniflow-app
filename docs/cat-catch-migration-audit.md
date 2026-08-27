# Cat Catch 当前迁移摘要

更新时间：2026-08-27

状态：初始迁移尚未完成。本文只总结已确认事实，逐项状态以 `docs/cat-catch/capability-map.json` 为准。

## 1. 当前版本

| 字段 | 值 |
| --- | --- |
| baseline / observed / target | `2cb981d7c2f4614732edccc167c4b5793d1cb138` |
| upstream description | `2.7.2-22-g2cb981d` |
| reviewedThrough | 未建立 |
| portedThrough | 未建立 |

当前映射包含 7 个 cutover unit、32 项能力、192 个上游 anchor、106 个本地旧位置和 83 个唯一计划测试 ID。`network-capture` 的 7 项能力均达到 `ported-unverified`，`output.external-tools-dispatch` 为 `porting`，其余 24 项仍为 `pending`；28 个计划测试 ID 已落成 active pure behavior/contract、fake Electron integration 或 loopback redirect test，尚无已完成的 cutover unit。

## 2. 能力族

| 能力族 | 当前实现 | 已知结论 |
| --- | --- | --- |
| network capture | target runtime 已在 production controller 实例化，legacy bridge/consumer 仍并存 | Cat Catch 规则与产品 policy 分层、page policy、vault/store、当前/下一 navigation generation 的 tokenized probe routing、renderer-safe reducer、唯一 network/per-view probe composition、owner lifecycle、main-only probe key 解析、context-free stale owner 拒绝和 redirect hop 凭据隔离已有专项测试；资源状态事件、opaque inspection、普通资源下载、probe open/export/read、external-tool dispatch 已接入 production IPC/preload/renderer；已捕获 URL 的页面拖拽会绑定当前 tab 的 opaque resource authority，未捕获、data/blob 和外部拖拽仍走受限 fallback；HLS/DASH 计划下载和旧 catch toolkit 仍待迁移与验证 |
| deep-search runtime | legacy inactive | 深度 hooks 写死关闭，外围 MSE hook 仍运行 |
| MSE runtime | legacy owner | 有增量 spool 思路，但没有专项差分、输出和稳定性测试 |
| HLS engine | pure parser/pipeline slices + legacy pipeline + partial authority transport | 纯 port 已接管 manifest parse facade，并用 fixture 覆盖同一资源隐式 BYTERANGE offset、初始/增量 discontinuity sequence、map/key，以及 PNG/JPEG 伪装分片前缀剔除；计划下载和 live 录制的已捕获 manifest/分片/key/map 已优先走当前 tab authority；本地 HLS 分片链已接入可选预处理，但一次性 cache fallback、完整 parser 语义和 task owner 仍有明确缺口 |
| DASH engine | legacy owner + partial authority transport | 计划下载的已捕获 init/media 分片已优先走当前 tab authority；手写 parser 对负 repeat、多 BaseURL、动态 MPD 等语义仍不完整 |
| transfer engine | multiple owners | 并发/重试代码可复用评估，但没有统一 task/cancel/cleanup owner |
| output integration | mixed: opaque resource authority + legacy HLS/DASH/drag/toolkit paths | external-tool、inspection、普通资源下载、已捕获页面拖拽和 HLS/DASH 计划分片传输已接入 main-owned authority；data/blob、未捕获资源和多资源 fallback 仍走旧链；HLS/DASH 直拉、派生字幕 URL、process terminal、m3u8dl encoding、本地保存、ffmpeg、资料库导入与统一任务合同仍待迁移 |

## 3. 高优先级缺口

1. `enableDeepRuntimeHooks = false`。
2. 生产网络捕捉仍为 `onCompleted`；目标 adapter 已实现首字节阶段识别，但在整个 unit 就绪前不能与旧 listener 同时注册。
3. 生产 request context 的新 vault/store 已接入 target runtime；HLS/DASH 计划和 HLS live 的已捕获 URL 已能通过 authority 恢复上下文，但 HLS/DASH 直拉、HLS track、未捕获 URL fallback 和 catch toolkit 仍使用旧 request context/富 DTO，尚未完成统一清理。
4. TextDecoder inline manifest hook 缺失。
5. JSON 深度/宽度/cycle 语义未与上游对齐。
6. Worker Blob CSP 异步失败回退不等价。
7. HLS 隐式 BYTERANGE offset、初始 discontinuity sequence 和 PNG/JPEG 伪装分片剔除已在纯 port/fixture 中覆盖，本地分片下载也已接入预处理，但完整 parser/output 差分和一次性 cache fallback 仍缺失。
8. MPD `r=-1`、多 BaseURL、动态 timeline/range 不完整。
9. ffmpeg、HLS/DASH、直播、普通下载和 temp 没有统一 task registry。
10. 目前有 31 个 active pure contract、fixture、fake Electron integration 或 loopback redirect test ID；main composition、持久化捕捉设置热更新、下一文档 token 路由、main-only probe key 解析与下载、检查、probe 动作、external-tool target consumer、已捕获页面拖拽暂存和 HLS/DASH 计划/live 分片 authority transport 已有 owner/opaque authority 证据，普通资源下载和 inspection 已有 production IPC 入口；页面拖拽 fallback、HLS parser 完整标签语义/直拉/track、旧 toolkit 及完整 unit cutover 仍无 production cutover 证据。

## 4. 保留、迁移与删除

- 忠实迁移：network classifier/rules、deep search、MSE 经验分支、HLS parser/pipeline、downloader 竞态。
- 平台适配：Electron webRequest、page relay、filesystem、ffmpeg、外部工具、资料库导入。
- 成熟库替代：DASH/MPD parser core，但行为必须用 fixture 验证。
- 保留唯一 owner：tab/view lifecycle、ResourceStateStore、UploadManager。
- 最后收口：`embeddedBrowserMainController.ts` 只保留 orchestration/facade。
- 切换后删除：旧算法、旧 listener/handler、flag、fallback、兼容转发和测试 helper。

## 5. 当前下一步

下一步补 HLS/DASH 计划 transport 的 production-equivalent integration，并继续把直拉/live/track、catch toolkit 的请求改成同一套 `tabId/resourceId` authority。证据完整后，在唯一 dispatch boundary 原子切换并删除对应旧实现；当前仍保留 data/blob 与未捕获资源的必要 fallback，不提前删除旧链。
