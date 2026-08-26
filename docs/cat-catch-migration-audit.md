# Cat Catch 当前迁移摘要

更新时间：2026-08-26

状态：初始迁移尚未完成。本文只总结已确认事实，逐项状态以 `docs/cat-catch/capability-map.json` 为准。

## 1. 当前版本

| 字段 | 值 |
| --- | --- |
| baseline / observed / target | `2cb981d7c2f4614732edccc167c4b5793d1cb138` |
| upstream description | `2.7.2-22-g2cb981d` |
| reviewedThrough | 未建立 |
| portedThrough | 未建立 |

当前映射包含 7 个 cutover unit、32 项能力、192 个上游 anchor、106 个本地旧位置和 78 个唯一计划测试 ID。`network-capture` 的 7 项能力均达到 `ported-unverified`，`output.external-tools-dispatch` 为 `porting`，其余 24 项仍为 `pending`；23 个计划测试 ID 已落成 active pure behavior/contract、fake Electron integration 或 loopback redirect test，尚无已完成的 cutover unit。

## 2. 能力族

| 能力族 | 当前实现 | 已知结论 |
| --- | --- | --- |
| network capture | legacy production owner + unregistered target adapters/contracts/lifecycle/access consumers | Cat Catch 规则与产品 policy 分层、page policy、vault/store、tokenized document-bound probe routing、renderer-safe reducer、owner lifecycle、opaque resource authority、bounded inspection、context-free stale owner 拒绝和 redirect hop 凭据隔离已有专项测试；production probe install、四类旧 consumer 的生产入口、IPC/preload/renderer 与 cutover 仍待迁移和验证 |
| deep-search runtime | legacy inactive | 深度 hooks 写死关闭，外围 MSE hook 仍运行 |
| MSE runtime | legacy owner | 有增量 spool 思路，但没有专项差分、输出和稳定性测试 |
| HLS engine | legacy owner | parser/downloader 存在，BYTERANGE、cache fallback、伪装分片有明确缺口 |
| DASH engine | legacy owner | 手写 parser 对负 repeat、多 BaseURL、动态 MPD 等语义不完整 |
| transfer engine | multiple owners | 并发/重试代码可复用评估，但没有统一 task/cancel/cleanup owner |
| output integration | legacy production owner + unregistered external-tool target consumer + OmniFlow owners | external-tool target consumer 已改为 main-owned opaque resource authority；生产 IPC 仍信任 renderer URL/header，且 process terminal、m3u8dl encoding、本地保存、ffmpeg、资料库导入与统一任务合同仍待迁移 |

## 3. 高优先级缺口

1. `enableDeepRuntimeHooks = false`。
2. 生产网络捕捉仍为 `onCompleted`；目标 adapter 已实现首字节阶段识别，但在整个 unit 就绪前不能与旧 listener 同时注册。
3. 生产 request context 仍无容量/TTL，敏感 header 值仍进入 renderer DTO；新 adapter/vault/store 只在未注册目标链与测试中接线，尚未替换生产 DTO 和 consumer。
4. TextDecoder inline manifest hook 缺失。
5. JSON 深度/宽度/cycle 语义未与上游对齐。
6. Worker Blob CSP 异步失败回退不等价。
7. HLS 隐式 BYTERANGE、一次性 cache fallback、PNG/JPEG 伪装分片缺失。
8. MPD `r=-1`、多 BaseURL、动态 timeline/range 不完整。
9. ffmpeg、HLS/DASH、直播、普通下载和 temp 没有统一 task registry。
10. 目前有 23 个 active pure contract、fake Electron integration 或 loopback redirect test ID；external-tool/inspection target consumer 已有 opaque authority 证据，但 production probe install、四类旧 consumer 的生产入口、IPC/preload/renderer 及所有 unit 仍无 production cutover 证据。

## 4. 保留、迁移与删除

- 忠实迁移：network classifier/rules、deep search、MSE 经验分支、HLS parser/pipeline、downloader 竞态。
- 平台适配：Electron webRequest、page relay、filesystem、ffmpeg、外部工具、资料库导入。
- 成熟库替代：DASH/MPD parser core，但行为必须用 fixture 验证。
- 保留唯一 owner：tab/view lifecycle、ResourceStateStore、UploadManager。
- 最后收口：`embeddedBrowserMainController.ts` 只保留 orchestration/facade。
- 切换后删除：旧算法、旧 listener/handler、flag、fallback、兼容转发和测试 helper。

## 5. 当前下一步

下一步把目标 access consumer 接入下载和拖拽，并让 production probe 安装使用 tokenized document ingress；随后把已完成的 inspection/external-tool target consumer 与安全合同一起接入 production IPC/preload/renderer，建立 cutover integration。证据完整后，在唯一 dispatch boundary 原子切换并删除对应旧实现；当前目标链不接生产，也不提前删除旧链。
