# Cat Catch 同步日志

本文件只记录每轮同步的 from/to、分类、能力影响和验证结果。长期架构规则放在执行计划，同步步骤放在维护指南，逐项事实放在 capability map。

## 2026-08-23: initial observation

- observedHead: `2cb981d7c2f4614732edccc167c4b5793d1cb138`
- migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`
- reviewedThrough: `null`
- portedThrough: `null`
- result: 建立 7 个 cutover unit 与 32 项 seed capability；尚未完成目标 snapshot 的初始行为审计。
- fixtures/tests: 记录 70 个唯一计划测试 ID，尚无 active fixture/test。
- runtime changes: 无。
- validation: 仅完成源码调研，不代表行为等价。

## 2026-08-26: initial -> `2cb981d7c2f4614732edccc167c4b5793d1cb138` (classifier partial)

- observedHead: `2cb981d7c2f4614732edccc167c4b5793d1cb138`
- migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`
- reviewedThrough: `null`；仅完成 classifier/rules 直接行为依赖，未宣称初始目标全部分类。
- portedThrough: `null`；其余 capability 与 unit cutover 未完成。
- change groups: `behavioral`（regex 首匹配、extension/MIME/attachment/media 顺序、hard break、size operator、精确 URL 去重）与 `dependency`（`init.js` 默认规则状态和 storage 编译语义）。
- affected capability IDs: `capture.rules-classification-deduplication` -> `ported-unverified`。
- fixtures/tests: 无 fixture；新增 `classifier.test.ts#network.rule-ordering` 和 `#network.mime-extension-dedupe`。
- excluded changes and reasons: 未处理 extension UI、Chrome DNR、request context、Electron listener/state；它们属于其他 capability 或平台 adapter，不在本切片扩张。
- unresolved gaps: 尚未接 Electron `onResponseStarted`、request blacklist handshake、生产 `ResourceStateStore`、IPC 或 lifecycle；OmniFlow-only image/key/expanded-subtitle 规则也要在 adapter 中显式映射，不能 cutover。
- runtime changes: 新增纯 `network/rules.ts` 与 `network/classifier.ts`，生产入口无变化。
- legacy cleanup: 无；旧 classifier/rules 在整个 `network-capture` unit 切换前继续作为唯一生产 owner。
- validation: 2 个专项 Vitest、16 个同步校验测试、metadata/upstream anchor、TypeScript 与全量 ESLint 通过。全量 Vitest 中 133 个文件、748 个测试通过；命令仅因 `node:test` 文件 `tools/cat-catch-sync/validate.test.mjs` 被 Vitest 二次收集后报告无 Vitest suite 而退出 1，该文件已由专用命令 16/16 通过。未运行会覆盖并行 `dist-electron/**` 的 build。

## 2026-08-26: `2cb981d7c2f4614732edccc167c4b5793d1cb138` -> same target (request URL helpers partial)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；本切片不移动目标。
- reviewedThrough / portedThrough: 均保持 `null`；初始目标的其余能力仍未完成分类和迁移。
- change groups: `behavioral`（完整 wildcard URL 匹配、disabled 跳过、默认关闭的强制屏蔽、黑白名单反转与 special-page 判断）。
- affected capability IDs: `capture.request-url-helpers` -> `ported-unverified`。
- fixtures/tests: 无 fixture；新增 `request-url-helpers.test.ts#network.url-filtering-parity` 与 `#network.special-page-parity`。
- classification correction: `setHeaders` / `setRequestHeaders` 只服务上游 downloader、preview 和扩展内部解析页，已连同 `network.request-header-rule-scope` 重分配到仍为 `pending` 的 `capture.protected-request-context`，本切片不生成 Chrome DNR planner。
- unresolved gaps: 当前旧链仍把 Cookie/Authorization 复制到 renderer DTO；helper 不接该链。接生产前必须先建立 main-only、按 tab/URL/purpose/TTL 绑定的 `NetworkContextVault` 和安全投影。
- runtime changes: 新增纯 page URL policy helper；生产入口、IPC 和状态 owner 无变化。
- legacy cleanup: 登记旧 `catCatchDefaultBlockedPagePatterns` 与 `isCatCatchDefaultBlockedPageUrl`，暂不删除；整个 `network-capture` unit 切换后统一清理。
- validation: 2 个专项 Vitest、16 个同步校验测试、全量 ESLint、TypeScript、metadata 与固定上游 anchor 检查通过。未重跑已知会二次收集 `node:test` 文件的全量 Vitest，也未运行会覆盖并行 `dist-electron/**` 的 build；本切片未接生产，因此无手工页面验证。

## Template

```markdown
## YYYY-MM-DD: <from> -> <to>

- observedHead:
- migrationTarget:
- reviewedThrough:
- portedThrough:
- change groups:
- affected capability IDs:
- fixtures/tests:
- excluded changes and reasons:
- unresolved gaps:
- runtime changes:
- legacy cleanup:
- validation:
```
