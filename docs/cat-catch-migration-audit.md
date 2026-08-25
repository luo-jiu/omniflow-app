# Cat Catch 全面重构现状摘要

更新时间：2026-08-23

状态：临时人工摘要；`G0` 完成后应由声明性 ledger 与 capability-state/Gate reports 联合生成。

完成标准、目标架构和状态机以 `docs/cat-catch-full-migration-execution-plan.md` 为唯一权威。本文只回答“目前明确知道什么”，不定义项目是否完成。

## 1. 状态规则

- 不再使用“已夺舍”“部分夺舍”或迁移百分比。
- 代码存在但没有等价证据，统一记为 `implemented-unverified`。
- 页面或生产链路没有实际启用的能力，不能因为源码存在而算可用。
- Cat Catch 上游是行为参考；旧 OmniFlow 只能用于 characterization。
- 本表不是能力穷举。未完成初始依赖闭包扫描前，不能推断没有列出的能力已经被覆盖。

## 2. 当前上游

| 字段 | 值 |
| --- | --- |
| baseline / observed HEAD | `2cb981d7c2f4614732edccc167c4b5793d1cb138` |
| description | `2.7.2-22-g2cb981d` |
| latest commit date | 2026-08-14 |
| auditedThrough | 未建立 |
| verifiedThrough | 未建立 |
| releaseCursor | 未确定 |

## 3. 当前能力族摘要

| 能力族 | 派生摘要 | 当前部署 | 已知结论 |
| --- | --- | --- | --- |
| network capture | `implemented-unverified` | legacy owner | Electron tab 归属可保留；事件阶段、context、headers、规则语义需重迁和验真 |
| deep-search runtime | `implemented-unverified` | `legacy-inactive` | 深度 hooks 写死关闭，只有外围 MSE hook 运行；不能视为产品能力 |
| MSE runtime | `implemented-unverified` | legacy owner | 已有增量 spool 思路，没有专项差分、输出和稳定性证据 |
| HLS engine | `implemented-unverified` | legacy owner | 已有 parser/downloader，但存在 BYTERANGE、cache fallback、伪装分片等明确缺口 |
| DASH engine | `implemented-unverified` | legacy owner | 手写 parser 对负 repeat 等语义处理错误，应改用成熟 parser 并验真 |
| transfer engine | `implemented-unverified` | multiple local owners | 并发/重试代码可复用评估，但缺统一 task/cancel/cleanup owner |
| output integration | `implemented-unverified` | legacy owners | 本地保存、ffmpeg、资料库导入和外部工具已有实现，应作为 adapter/integration 保留并补证据 |

## 4. 已确认的高优先级 seed gaps

以下只用于启动 capability ledger，不是最终完成清单：

1. `embeddedBrowserResourceProbeRuntimeHooks.ts` 的 `enableDeepRuntimeHooks = false`。
2. 网络捕捉使用 `onCompleted`，Cat Catch 使用首字节阶段的 `onResponseStarted`。
3. request context 无明确容量/TTL，鉴权 header 规则落后于上游；当前 public resource DTO 还会把 Cookie/Authorization 值发到 renderer，目标必须改成 main-owned opaque ref。
4. Cat Catch `TextDecoder.decode` inline manifest hook 本地缺失。
5. Cat Catch JSON 搜索深度与本地深度/宽度截断不同，尚无 accepted difference。
6. Worker Blob CSP 异步失败回退不等价。
7. HLS 隐式 BYTERANGE offset、一次性 manifest cache fallback、PNG/JPEG 伪装分片缺失。
8. MPD `r="-1"`、多 BaseURL、动态时间和 range 等语义不完整。
9. ffmpeg、HLS/MPD、直播、普通下载和 temp 目录没有统一 task registry。
10. 资源捕捉主链没有专项自动化测试和 Cat Catch differential oracle。

## 5. 保留、替换与适配方向

| 处置 | 当前模块或能力 |
| --- | --- |
| 记录并默认保持契约 | IPC/preload 黑盒行为、资源模型、renderer snapshot；protected request context 是已确认的安全迁移例外，敏感 header 值必须移出 public DTO |
| 保留 owner | main 的 tab/view lifecycle 与 `ResourceStateStore`，除非独立决策证明必须迁移 |
| 忠实重迁 | network classifier/rules、deep-search、MSE 经验分支、HLS parser/pipeline、downloader 竞态逻辑 |
| 成熟库替换 | DASH/MPD parser core |
| 降级为 adapter | Electron webRequest、page relay、filesystem、ffmpeg、外部工具和资料库导入 |
| 最后拆分 | `embeddedBrowserMainController.ts` |

## 6. 状态更新规则

- capability 未进入 ledger 前，不得从本文推断它已完成。
- fixture 就绪只能让 validator 派生 `evidence.fixture=ready`，不能直接把行为设为通过。
- Cat Catch oracle 差分或批准的独立 spec expectation 通过后，report 才能派生 `evidence.behavior=pass`。
- 切换前的 production-equivalent harness 与切换后的真实 dispatch 分别产生 candidate/active integration/soak evidence，不能互相代替。
- 切换 production owner 且 local closure 证明旧路径删除后，report 才能派生 `legacy-removed`。
- 上游或本地 owner 发生相关行为改动时，派生状态必须自动变为 `stale` 并重新验证；pass/artifact binding/`verifiedThrough` 不写回声明性 ledger。

## 7. 维护方式

`G0` 建立机器 ledger 后：

- 本文只保留由声明性 ledger 与 capability-state/Gate report 生成的汇总和关键阻塞项。
- 不手工维护逐函数、逐网站或逐提交流水账。
- source anchor/hash、fixture/test ref、disposition 与 accepted difference 进入 ledger；pass/stale/freshness、artifact binding 和 `verifiedThrough` 只进入派生 report。
- 任何人工说明与机器产物冲突时，按全面重构执行契约的事实 owner 和 validator 结果处理，冲突本身阻止 Gate。
