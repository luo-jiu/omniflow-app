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

当前映射包含 7 个 cutover unit、32 项能力、192 个上游 anchor、106 个本地旧位置和 71 个唯一计划测试 ID。network classifier/rules、page URL policy、main-only request context vault 与 main-owned resource state contract 已达到 `ported-unverified`，其余 28 项仍为 `pending`；9 个计划测试 ID 已落成 active pure behavior/contract test，尚无 production-equivalent integration 或已完成的 cutover unit。

## 2. 能力族

| 能力族 | 当前实现 | 已知结论 |
| --- | --- | --- |
| network capture | legacy production owner + pure classifier/helper/context/state contract | 规则顺序、默认值、大小判断、去重、页面 URL policy、main-only context vault 与 revisioned ResourceStateStore 已有专项测试；listener、vault 淘汰通知、IPC/reducer、安全 consumer、逐跳 redirect 与生产 cutover 仍待迁移和验证 |
| deep-search runtime | legacy inactive | 深度 hooks 写死关闭，外围 MSE hook 仍运行 |
| MSE runtime | legacy owner | 有增量 spool 思路，但没有专项差分、输出和稳定性测试 |
| HLS engine | legacy owner | parser/downloader 存在，BYTERANGE、cache fallback、伪装分片有明确缺口 |
| DASH engine | legacy owner | 手写 parser 对负 repeat、多 BaseURL、动态 MPD 等语义不完整 |
| transfer engine | multiple owners | 并发/重试代码可复用评估，但没有统一 task/cancel/cleanup owner |
| output integration | legacy + OmniFlow owners | 本地保存、ffmpeg、资料库导入和外部工具应保留为 adapter/integration，并补任务合同 |

## 3. 高优先级缺口

1. `enableDeepRuntimeHooks = false`。
2. 网络捕捉为 `onCompleted`，而不是 Cat Catch 的首字节阶段识别。
3. 生产 request context 仍无容量/TTL，敏感 header 值仍进入 renderer DTO；新 vault/store 尚未接线，vault 淘汰也还不能通知 store 清除已失效 capability。
4. TextDecoder inline manifest hook 缺失。
5. JSON 深度/宽度/cycle 语义未与上游对齐。
6. Worker Blob CSP 异步失败回退不等价。
7. HLS 隐式 BYTERANGE、一次性 cache fallback、PNG/JPEG 伪装分片缺失。
8. MPD `r=-1`、多 BaseURL、动态 timeline/range 不完整。
9. ffmpeg、HLS/DASH、直播、普通下载和 temp 没有统一 task registry。
10. 目前只有 classifier/rules、page URL policy、request context 与 resource state 的 9 个 pure behavior/contract test ref；其余网络能力及后续 unit 仍无实际 fixture、differential 或 production-equivalent integration test。

## 4. 保留、迁移与删除

- 忠实迁移：network classifier/rules、deep search、MSE 经验分支、HLS parser/pipeline、downloader 竞态。
- 平台适配：Electron webRequest、page relay、filesystem、ffmpeg、外部工具、资料库导入。
- 成熟库替代：DASH/MPD parser core，但行为必须用 fixture 验证。
- 保留唯一 owner：tab/view lifecycle、ResourceStateStore、UploadManager。
- 最后收口：`embeddedBrowserMainController.ts` 只保留 orchestration/facade。
- 切换后删除：旧算法、旧 listener/handler、flag、fallback、兼容转发和测试 helper。

## 5. 当前下一步

下一步优先建立唯一 Electron network adapter：按 `onSendHeaders -> onResponseStarted` 把 vault 与 ResourceStateStore 接起来，并让 vault 容量/TTL 淘汰精确失效 store capability；随后实现 revisioned IPC snapshot/change reducer，以及禁用自动 redirect 或逐跳重新兑换的下载、检查、拖拽和外部工具 consumer。整个 unit 通过 production-equivalent integration 后，再在唯一入口切换并删除对应旧实现；当前 pure contract 不接生产，也不提前删除旧链。
