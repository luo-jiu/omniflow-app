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

## 2026-08-26: `2cb981d7c2f4614732edccc167c4b5793d1cb138` -> same target (protected request context partial)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；本切片不移动目标。
- reviewedThrough / portedThrough: 均保持 `null`；初始目标的其余能力仍未完成分类和迁移。
- change groups: `platform-adaptation`（Cat Catch 受保护 header 选择、原请求与重放类型范围、tab/URL/purpose scope）与 `security-boundary`（main-only value、opaque projection、TTL/容量、capture generation/page origin、exact URL、Cookie purpose policy、manual redirect）。
- affected capability IDs: `capture.protected-request-context` -> `ported-unverified`。
- fixtures/tests: 无 fixture；新增 `network-context-vault.test.ts#network.sensitive-header-projection`、`#network.context-ttl-purpose-binding` 与 `#network.request-header-rule-scope`，共 12 个专项 case。
- accepted difference: regex 分类把 observed URL 改写为其他 resource URL 时 fail-closed，不继承原请求凭据；目标 URL 必须由 main 重新获得自己的 context。
- unresolved gaps: vault 尚未接 Electron webRequest、ResourceStateStore、IPC 安全投影、下载/检查/页面拖拽/外部工具 consumer；现有 `fileTransfer.ts` 的自动跨域 redirect 不能直接消费兑换后的 header，生产接线前必须禁用自动 redirect 或逐跳重新兑换。
- runtime changes: 新增 main-only `NetworkContextVault` 纯合同；生产入口和旧 DTO 无变化，旧链仍是唯一 owner。
- legacy cleanup: 无；旧 request context Map 和 renderer header DTO 在整个 `network-capture` unit 切换前继续保留，cutover 同片删除。
- validation: 3 个网络测试文件、16 个 Vitest（其中 vault 12 个）、16 个同步校验测试、全量 ESLint、TypeScript、metadata、187 个固定上游 anchor 与 106 个 cleanup entry 检查通过。全量 Vitest 实际有 137 个文件、767 个测试通过，另 1 个测试跳过；命令只因 `node:test` 文件 `tools/cat-catch-sync/validate.test.mjs` 被 Vitest 二次收集后报告无 Vitest suite 而退出 1，该文件已由专用命令 16/16 通过。未运行会覆盖并行 `dist-electron/**` 的 build，也未进行真实页面手工验证。

## 2026-08-26: `2cb981d7c2f4614732edccc167c4b5793d1cb138` -> same target (resource state contract partial)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；本切片不移动目标。
- reviewedThrough / portedThrough: 均保持 `null`；初始目标的其余能力仍未完成分类和迁移。
- change groups: `behavioral`（桌面 10,000 条容量边界、溢出整 tab reset/drop、精确 URL 去重与 500 fingerprint reset）与 `platform-adaptation`（main-owned TTL、opaque id、安全投影、stable probe upsert、navigation/incarnation/revision、context 单 owner 和 lifecycle disposal）。
- affected capability IDs: `capture.resource-state-contract` -> `ported-unverified`。
- fixtures/tests: 无 fixture；`resource-state-store.test.ts#state.capacity-ttl-dedupe` 与 `#state.tab-navigation-close` 共 15 个 pure contract case，覆盖 500/501 边界、旧 fingerprint epoch TTL、容量、稳定 probe、跨导航隔离、context exactly-once、revision/tombstone 与 tab/WebContents/app disposal。
- accepted differences: 资源元数据默认 6 小时 TTL；stable probe 以 navigation generation + page resource key upsert；renderer 只拿 opaque id、revision/incarnation stamp、白名单 metadata 与 header capability，contextRef/resourceKey/page origin/WebContents 和 captured navigation owner facts 留在 main。
- unresolved gaps: Store 尚未接 Electron listener、IPC snapshot/change reducer 或 consumer；autoClear 的 committed/loading/special-page 事件映射仍待 lifecycle adapter 验证。vault 的容量淘汰、TTL sweep 和 redemption 过期必须返回 contextRef 或触发 invalidation callback，再由 adapter 调用 Store 清除 capability，否则不能 cutover。
- runtime changes: 新增 main-only `ResourceStateStore` 纯合同；生产入口、IPC、renderer 和旧资源 Map 均无变化，旧链仍是唯一 owner。
- legacy cleanup: 无；整个 `network-capture` unit 就绪前不删除旧 Map、listener、header DTO 或 classifier/rules。
- validation: 4 个网络测试文件 31/31、Store 15/15、同步校验 16/16、固定上游 metadata/192 anchors/106 cleanup entries、TypeScript、全量 ESLint 与目标文件 diff check 通过。全量 Vitest 实际有 138 个文件、782 个测试通过，另 1 个测试跳过；命令仍只因 `node:test` 文件 `tools/cat-catch-sync/validate.test.mjs` 被 Vitest 二次收集后报告无 Vitest suite 而退出 1，该文件已由专用命令 16/16 通过。未运行会覆盖并行 `dist-electron/**` 的 build，也未进行真实页面手工验证。

## 2026-08-26: same target (vault invalidation contract)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标与 capability state 均不移动。
- change groups: `security-boundary`（retained context 的容量、过期、显式释放、tab/WebContents/app 清理必须让资源投影同步失效）。
- affected capability IDs: `capture.protected-request-context` 与 `capture.resource-state-contract` 保持 `ported-unverified`。
- fixtures/tests: 无 fixture；`network.context-ttl-purpose-binding` 新增 value-free invalidation case，覆盖 `capacity / expired / release / tab-clear / web-contents-clear / vault-clear` 六类原因。
- unresolved gaps: 通知尚未由 Electron adapter 消费；接线时必须同步调用 `Store.invalidateContext()` 并发布其 revisioned upsert change，不能只记录日志或延迟到 renderer 操作失败。
- runtime changes: 仅扩展 main-only `NetworkContextVault` 合同，生产旧链无变化。
- validation: 4 个网络测试文件 32/32、同步校验 16/16、固定上游 metadata/192 anchors/106 cleanup entries、TypeScript、全量 ESLint 与目标文件 diff check 通过。全量 Vitest 实际有 138 个文件、783 个测试通过，另 1 个测试跳过；命令仍只因 `node:test` 同步校验文件被 Vitest 二次收集后报告无 Vitest suite 而退出 1，该文件已由专用命令 16/16 通过。未运行会覆盖并行 `dist-electron/**` 的 build，也未进行真实页面手工验证。

## 2026-08-26: same target (network event lifecycle partial)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；初始目标的其余能力仍未完成分类和迁移。
- change groups: `platform-adaptation`（Electron `onSendHeaders -> onResponseStarted`、请求阶段 regex、首字节分类、逐跳 redirect、终态/dispose 清理、绑定容量）与 `security-boundary`（旧导航拒绝、exact URL context、vault invalidation 同步转 Store change）。
- affected capability IDs: `capture.network-event-lifecycle` -> `ported-unverified`。
- fixtures/tests: 无 fixture；新增 `electron-network.test.ts#network.first-byte-long-response` 与 `#network.context-terminal-cleanup`，共 2 个 fake `webRequest` integration case。
- excluded changes and reasons: 本切片不注册 `MainSupport`、不修改 IPC/renderer consumer，也不删除旧 bridge；Electron 同类 `webRequest` 事件只有最后一个 listener 生效，整个 unit 就绪前不能并行挂载。
- unresolved gaps: revisioned IPC snapshot/change reducer、tab/WebContents owner lifecycle、安全下载/检查/拖拽/外部工具 context consumer、production-equivalent Electron smoke 与 unit cutover。
- runtime changes: 新增未注册 `ElectronNetworkCaptureAdapter`；生产旧 `onCompleted` bridge 仍是唯一 owner。
- legacy cleanup: 无；旧 bridge、request Map、header DTO、classifier/rules 在整个 `network-capture` unit 切换时同片删除。
- validation: 网络相关 Vitest 34/34、同步校验 16/16、固定上游 metadata/192 anchors/106 cleanup entries、TypeScript 与全量 ESLint 通过。全量 Vitest 实际有 139 个文件、785 个测试通过，另 1 个测试跳过；命令仍只因 `node:test` 同步校验文件被 Vitest 二次收集后报告无 Vitest suite 而退出 1，该文件已由专用命令 16/16 通过。未运行会覆盖并行 `dist-electron/**` 的 build，也未进行真实页面手工验证。

## 2026-08-26: same target (cross-process contract partial)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；初始目标的其余能力仍未完成分类和迁移。
- change groups: `omniflow-integration`（共享 resource/snapshot/change DTO、白名单解析）与 `cross-process`（revision/incarnation reducer、乱序忽略、revision gap resync、snapshot/reset barrier、disposed tombstone）。
- affected capability IDs: `capture.cross-process-contract` -> `ported-unverified`。
- fixtures/tests: 无 fixture；新增 `captured-resource.test.ts#contract.resource-dto-single-source` 与 `#contract.renderer-safe-projection`，共 2 个 contract/reducer case。
- excluded changes and reasons: 本切片不修改生产 preload、ambient declaration、renderer hook/API 或 IPC channel；这些旧 DTO 仍服务唯一生产链，只能在 network-capture 原子 cutover 时删除。
- unresolved gaps: owner lifecycle、安全 context consumer、production IPC/preload/renderer 接线、production-equivalent Electron smoke 与 unit cutover。
- runtime changes: `ResourceStateStore` 改为从目标合同导入并兼容 re-export 安全 DTO；生产旧链无变化。
- legacy cleanup: 无；旧 main/preload/ambient/renderer DTO copies 在整个 unit 切换时同片删除。
- validation: 网络/合同相关 Vitest 36/36、同步校验 16/16、固定上游 metadata/192 anchors/106 cleanup entries、TypeScript 与全量 ESLint 通过。全量 Vitest 实际有 140 个文件、787 个测试通过，另 1 个测试跳过；命令仍只因 `node:test` 同步校验文件被 Vitest 二次收集后报告无 Vitest suite 而退出 1，该文件已由专用命令 16/16 通过。未运行会覆盖并行 `dist-electron/**` 的 build，也未进行真实页面手工验证。

## 2026-08-26: same target (owner lifecycle partial)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；初始目标的其余能力仍未完成分类和迁移。
- change groups: `omniflow-integration`（tab/view registration/replacement、显式 clear/retain navigation、closeAll/app disposal）与 `stability/security-boundary`（render crash quarantine/recovery、WebContents spontaneous destruction、stale incarnation callback 拒绝、adapter-first shutdown、tab/WebContents/app vault cleanup）。
- affected capability IDs: `capture.owner-lifecycle` -> `ported-unverified`；`network-capture` 达到 7/7 `ported-unverified`，仍为 0 cutover。
- fixtures/tests: 无 fixture；新增 `embedded-browser-lifecycle.test.ts#lifecycle.navigation-close-exit-crash` 与 `#lifecycle.spontaneous-view-destroy`，使用真实目标 adapter/vault/store/contract 和 fake Electron event source 做 2 个组合 integration case。
- excluded changes and reasons: 本切片不改生产 controller/view lifecycle、MainSupport、IPC/preload/renderer、probe 或 context consumer；同类 Electron `webRequest` listener 不能与旧 bridge 并存。
- unresolved gaps: probe 写入新 Store；下载、检查、页面拖拽和外部工具逐跳兑换；OmniFlow-only image/key/字幕规则；production IPC/preload/renderer projection；network unit 原子 cutover 和旧实现删除。
- runtime changes: 新增未注册 `EmbeddedBrowserLifecycle`；生产旧 bridge/lifecycle 仍是唯一 owner。
- legacy cleanup: 无；整个 `network-capture` unit 的安全 consumer 和 production-equivalent integration 完成后，才在唯一 dispatch boundary 切换并同片执行 cleanup 清单。
- validation: lifecycle 目标测试 2/2、network target chain Vitest 38/38、同步校验 16/16、固定 metadata/192 anchors/106 cleanup entries、TypeScript 与全量 ESLint 通过。排除已由 `node --test` 专门执行的同步校验文件后，全量 Vitest 为 141 files、789 passed、1 skipped。未运行会覆盖并行 `dist-electron/**` 的 build，也未进行真实页面手工验证。

## 2026-08-26: same target (protected resource access partial)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；初始目标的其余能力仍未完成分类和迁移。
- change groups: `security-boundary`（opaque resource authority、固定 purpose、main-owned owner/context 校验、redirect hop 凭据隔离）与 `omniflow-integration`（下载、检查、页面拖拽和外部工具共用 main-only access 边界）。
- affected capability IDs: `capture.protected-request-context` 保持 `ported-unverified`；新增 2 个 active test ID，`network-capture` 仍为 7/7 `ported-unverified`、0 cutover。
- fixtures/tests: 无 fixture；新增 `captured-resource-access.test.ts#network.owned-resource-consumer` 与 `#network.redirect-hop-isolation`，覆盖四类 purpose、错误 tab/resource、导航失效、page-drag captured Cookie 隔离和 loopback 跨 origin redirect。
- accepted difference: 任意 redirect 后不继承上一跳受保护 header，同源也不例外；目标 hop 如需 header，必须拥有独立捕捉 context。page-drag 不回放 vault 中的 Cookie，而由绑定到捕捉 tab Electron session 的 transport 按目标 URL 使用 cookie jar。
- excluded changes and reasons: 本切片只建立可复用 access authority，不接生产四类 consumer、IPC/preload/renderer 或 listener；防止在整个 network unit 就绪前产生半切换或双栈。
- unresolved gaps: production adapter 必须按捕捉 WebContents 解析并注入对应 partition 的 `session.fetch`；四类 consumer 仍需改为只提交 `tabId/resourceId/purpose`；probe、OmniFlow-only capture policy 和原子 cutover 仍未完成。
- runtime changes: 新增未注册 `CapturedResourceAccessService`；生产路径无变化，旧 request Map 与 header-bearing DTO 仍是唯一运行链。
- legacy cleanup: 无；旧 consumer/listener/DTO 只能在 `network-capture` 原子 cutover 时同片删除。
- validation: network target chain Vitest 40/40、同步校验 16/16、固定 metadata/192 anchors/106 cleanup entries、TypeScript、全量 ESLint 和 diff check 通过；排除已由 `node --test` 专门执行的同步校验文件后，全量 Vitest 为 142 files、791 passed、1 skipped。未运行会覆盖其他 Agent `dist-electron/**` 的 build；目标链尚未接生产，因此没有可执行的真实页面手工验证。

## 2026-08-26: same target (OmniFlow policy and probe ingress partial)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本切片只收口 `network-capture` 的产品差异和 probe Store handoff。
- change groups: `omniflow-integration`（image/key/document/expanded-subtitle policy、page probe ingress）与 `security-boundary`（regex blacklist 不可覆盖、document binding、main-owned tab/timestamp、resourceKey 不投影）。
- affected capability IDs: `capture.rules-classification-deduplication` 与 `capture.resource-state-contract` 保持 `ported-unverified`；新增 2 个 active test ID，整个 unit 仍为 0 cutover。
- fixtures/tests: 无 fixture；新增 `omniflow-capture-policy.test.ts#network.omniflow-policy-boundary` 和 `page-probe.test.ts#network.probe-store-handoff`，覆盖 Cat Catch 优先级、产品类型补充、opaque key、stable upsert、deep/off、旧 navigation binding 和新文档 replacement。
- accepted difference: OmniFlow 在 adapter 层捕捉 Cat Catch 默认范围之外的图片、key、PDF 和扩展字幕；不会覆盖 regex blacklist，也不会把 Cat Catch 对非产品媒体类型的 hard reject 改成 capture。probe 捕捉时间由 main 接收时刻决定，不信任页面时间戳。
- excluded changes and reasons: 不修改 page probe runtime、生产 console listener 或 lifecycle 接线；它们与安全 IPC/consumer 一起留到 production-equivalent integration 后原子切换。
- unresolved gaps: 每个安装 probe 的 document 必须携带或解析其 capture binding，避免导航后的迟到 console payload 被新文档接收；生产 IPC/preload/renderer 和四类 consumer 仍未切换。
- runtime changes: 未注册 network adapter 开始使用分层产品 policy；新增未注册 `PageProbeCaptureAdapter`。生产旧 classifier、probe recorder 和 Store 均未改变。
- legacy cleanup: 无；旧 policy/classifier/probe recorder 只在 `network-capture` cutover 同片删除。
- validation: network target chain Vitest 42/42、同步校验 16/16、固定 metadata/192 anchors/106 cleanup entries、TypeScript、全量 ESLint 和 diff check 通过；排除已由 `node --test` 专门执行的同步校验文件后，全量 Vitest 为 144 files、793 passed、1 skipped。未运行会覆盖其他 Agent `dist-electron/**` 的 build；目标链尚未接生产，因此没有可执行的真实页面手工验证。

## 2026-08-26: same target (probe document lifecycle partial)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本切片只组合 target probe ingress 与 owner lifecycle。
- change groups: `stability/security-boundary`（trusted tab/WebContents 绑定、document generation、crash quarantine、replacement/close stale isolation）。
- affected capability IDs: `capture.owner-lifecycle` 保持 `ported-unverified`；新增 `lifecycle.probe-document-binding`，整个 unit 仍为 0 cutover。
- fixtures/tests: 无 fixture；lifecycle fake Electron integration 覆盖首次绑定、导航后旧 ingress 拒绝、新文档重新绑定、崩溃期间拒绝、恢复、view replacement 和 close。
- excluded changes and reasons: 不修改 production probe 安装或 console listener；当前切片先固定 owner contract，避免生产接线反向决定生命周期语义。
- unresolved gaps: production 安装完成时必须保存 lifecycle 签发的 ingress，并把对应 document 的 console payload 路由给它；不得对每条消息查询当前 tab binding，否则旧页面迟到消息会串入新导航。
- runtime changes: `EmbeddedBrowserLifecycle.bindProbeCapture` 签发真实 `PageProbeCaptureAdapter`；生产 controller/view lifecycle 无变化。
- legacy cleanup: 无；旧 probe recorder 在 network unit 原子 cutover 前继续作为唯一 production owner。
- validation: network target chain Vitest 43/43、同步校验 16/16、固定 metadata/192 anchors/106 cleanup entries、TypeScript、全量 ESLint 和 diff check 通过；排除已由 `node --test` 专门执行的同步校验文件后，全量 Vitest 为 144 files、794 passed、1 skipped。未运行会覆盖其他 Agent `dist-electron/**` 的 build；目标链尚未接生产，因此没有可执行的真实页面手工验证。

## 2026-08-26: same target (tokenized probe console routing partial)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本切片只建立 target probe console transport，不切 production install。
- change groups: `security-boundary`（随机 document token、逐消息 binding 复核、旧 token/crash/dispose 隔离）与 `omniflow-integration`（普通 discovery 稳定 key、MSE control/resource 分流）。
- affected capability IDs: `capture.owner-lifecycle` 与 `capture.resource-state-contract` 保持 `ported-unverified`；新增 `network.probe-console-generation-routing`，整个 unit 仍为 0 cutover。
- fixtures/tests: 无 fixture；fake Electron console/lifecycle integration 覆盖基础 prefix 伪造、malformed JSON、当前 token、无 page key discovery、MSE control 白名单/异常隔离、未知 control 拒绝、导航迟到消息、崩溃、恢复和 dispose。
- accepted difference: 普通 probe discovery 未提供 `resourceKey` 时，main 根据 `source/resourceType/url` 派生 document-scoped stable key；页面时间戳、tab 和派生 key均不进入授权事实或 renderer projection。
- excluded changes and reasons: `createEmbeddedBrowserResourceProbeScript` 仅增加可选 prefix，旧无参生产调用保持原行为；production install/listener 不注册新 adapter，避免 network unit 未就绪时出现双 owner。MSE control 仍交给对应后续 unit，不在 Resource Store 中伪装成资源。
- unresolved gaps: production probe 安装必须改用 adapter 返回的脚本/prefix；下载、检查、拖拽、外部工具与安全 IPC/renderer 仍待接线。
- runtime changes: 新增未注册 `ElectronPageProbeEventAdapter`；`PageProbeCaptureAdapter` 补 main-derived stable key。生产行为无变化。
- legacy cleanup: 无；旧 console recorder 在原子 cutover 前仍为唯一 production owner。
- validation: network target chain Vitest 44/44、同步校验 16/16、固定 metadata/192 anchors/106 cleanup entries、TypeScript、全量 ESLint 和 diff check 通过；排除已由 `node --test` 专门执行的同步校验文件后，全量 Vitest 为 145 files、795 passed、1 skipped。未运行会覆盖其他 Agent `dist-electron/**` 的 build；目标链尚未接生产，因此没有可执行的真实页面手工验证。

## 2026-08-26: same target (external-tool authority partial)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本切片只完成 external-tool 的 opaque resource authority，未完成该 output capability 或任何 unit cutover。
- change groups: `security-boundary`（renderer command 只保留 `tabId/resourceId/toolKey`、main-owned URL/metadata/protected header、cross-tab/stale owner 拒绝）与 `omniflow-integration`（目标 authority 到现有 external-tool executor 的未注册 execution port）。
- affected capability IDs: `capture.protected-request-context` 保持 `ported-unverified`；`output.external-tools-dispatch` -> `porting`；active 计划测试 ID 增至 22，所有 unit 仍为 0 cutover。
- fixtures/tests: 无 fixture；新增 `external-tools.test.ts#output.external-tool-auth-boundary`，覆盖 renderer 注入 URL/header/referer 丢弃、main-owned payload、非法 tool、cross-tab、导航迟到资源和 executor 不触发；`network.owned-resource-consumer` 补 context-free probe 资源的导航 owner 失效。
- accepted difference: 无新增；本切片不处理 Cat Catch `m3u8dl` Base64 配置语义。
- excluded changes and reasons: 不修改 production IPC/preload/renderer、旧 external-tool dispatcher 或其他 consumer，避免 network unit 就绪前半切换；不提前宣称 process terminal 或 protocol encoding 已完成。
- unresolved gaps: external-tool process terminal、shell 输入安全、`m3u8dl` protocol encoding、production wiring/cleanup；下载、检查、页面拖拽、probe 安装、安全 IPC/renderer 和 network unit 原子 cutover 仍待完成。
- runtime changes: 新增未注册 `ExternalToolDispatcher`；`CapturedResourceAccessService` 对 context-bearing/context-free 资源统一执行当前 owner 校验。生产旧链无变化。
- legacy cleanup: 无；旧 external-tool dispatcher 和 header-bearing DTO 在安全 IPC 与 network-capture 原子切换前继续作为唯一生产 owner。
- validation: external/access integration Vitest 5/5、network target chain 47/47、同步校验 16/16、固定 metadata/192 anchors/106 cleanup entries、TypeScript 和全量 ESLint 通过；排除已由 `node --test` 专门执行的同步校验文件后，全量 Vitest 为 146 files、798 passed、1 skipped。Cat Catch 作用域 diff check 通过；全仓 diff check 仅命中其他 Agent 已修改的 `dist-electron/main.js` 尾随空格。未运行会覆盖其他 Agent `dist-electron/**` 的 build，目标链尚未接生产，因此没有可执行的真实页面手工验证。

## 2026-08-26: same target (bounded resource inspection partial)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本切片只完成 network resource inspection target consumer，未完成 production wiring 或任何 unit cutover。
- change groups: `security-boundary`（opaque inspection command、main-owned URL/header/byte budget、安全结果投影）与 `stability`（流式预算、超限主动 cancel、无 body、传输异常清理）。
- affected capability IDs: `capture.protected-request-context` 保持 `ported-unverified`；新增 active `network.owned-resource-inspection`，active 计划测试 ID 增至 23，总计划 ID 增至 78；所有 unit 仍为 0 cutover。
- fixtures/tests: 无 fixture；新增 `captured-resource-inspection.test.ts#network.owned-resource-inspection`，覆盖 renderer URL/header/maxBytes 注入丢弃、main-owned credentials、utf8/base64、安全 content-type 投影、响应 header 隔离、空 body、流异常 reader 释放、超限截断/cancel、非法 encoding 和导航迟到资源拒绝。
- accepted difference: 无新增；target inspection 继续采用原始捕捉 URL 作为 renderer-safe resource identity，不向 renderer 暴露 redirect target。
- excluded changes and reasons: 不修改页面管理的 probe/MSE `resourceKey` 提取；它属于 deep/MSE 后续 unit。暂不修改 production 通用 HTTP IPC、manifest renderer parser 或 preload，避免 network unit 就绪前半切换。
- unresolved gaps: production inspection IPC/renderer、下载、页面拖拽、probe 安装、安全 resource projection 和 network unit 原子 cutover；通用 `http:fetch` 的其他非 Cat Catch 调用方不在本切片迁移范围。
- runtime changes: 新增未注册 `CapturedResourceInspectionService`，默认 4 MiB main-owned budget，流式输出 `utf8/base64`，只投影 status/content-type/receivedBytes/truncated 和安全资源事实。生产旧链无变化。
- legacy cleanup: 无；renderer manifest/key inspection 仍经通用 HTTP IPC 提交 URL/header，直到安全 IPC 与 network-capture 原子切换。
- validation: inspection Vitest 4/4、network target chain 51/51、同步校验 16/16、固定 metadata/192 anchors/106 cleanup entries/78 planned IDs、TypeScript 和全量 ESLint 通过；排除已由 `node --test` 专门执行的同步校验文件后，全量 Vitest 为 147 files、802 passed、1 skipped。Cat Catch 作用域 diff check 通过。未运行会覆盖其他 Agent `dist-electron/**` 的 build，目标链尚未接生产，因此没有可执行的真实页面手工验证。

## 2026-08-26: same target (download/page-drag authority partial)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本切片只完成 captured download/page-drag 到 main sink 的目标 consumer，未完成 production wiring、transfer/output task 或任何 unit cutover。
- change groups: `security-boundary`（两类命令只接受 `tabId/resourceId`、忽略 renderer URL/header/redirect/destination 注入、迟到 owner 拒绝）与 `platform-adaptation`（download 回放 main-owned context，page-drag 只通过捕捉 tab session cookie jar 携带 Cookie）。
- affected capability IDs: `capture.protected-request-context` 保持 `ported-unverified`；新增 active `network.owned-resource-transfer-consumers`，active 计划测试 ID 增至 24，总计划 ID 增至 79；所有 unit 仍为 0 cutover。
- fixtures/tests: 无 fixture；新增 `captured-resource-transfer-consumers.test.ts#network.owned-resource-transfer-consumers`，覆盖 download/page-drag 固定 purpose、main-owned URL/header、main-only AbortSignal、page-drag Cookie 隔离、renderer 字段注入丢弃、sink 失败时取消未消费 body，以及 invalid/cross-tab/navigation-stale 请求在 fetch/sink 前拒绝。
- accepted difference: 无新增；沿用已记录的 page-drag Cookie 适配：不回放 vault Cookie header，由捕捉 tab 的 Electron session cookie jar 按目标 URL 发送。
- excluded changes and reasons: 不在本切片实现 direct-download 流式写盘、task registry、staged output lease 或 delivery terminal，它们分别属于 `transfer-engine`/`output-integration`；通用网页 `data:/blob:/URL` 拖拽 fallback 是 OmniFlow 自有输入，不因 captured resource consumer 存在而删除。
- unresolved gaps: production download/page-drag sink 组合、probe 安装、安全 IPC/preload/renderer、四类 consumer production entry、network unit 原子 cutover；旧 direct download 仍一次性 materialize response，留到 transfer unit 解决。
- runtime changes: 新增未注册 `CapturedResourceDownloadService` 与 `CapturedResourcePageDragService`，只把受权 Response 和安全 resource projection 交给注入的 main sink。生产旧链无变化。
- legacy cleanup: 无；旧 direct download、page-drag captured-header enrichment 与 renderer fallback DTO 在 network-capture 原子切换前继续作为唯一生产 owner/OmniFlow integration。
- validation: transfer consumer Vitest 4/4、network target chain 55/55、同步校验 16/16、固定 metadata/192 anchors/106 cleanup entries/79 planned IDs、TypeScript 和全量 ESLint 通过；排除已由 `node --test` 专门执行的同步校验文件后，全量 Vitest 为 148 files、806 passed、1 skipped。Cat Catch 作用域 diff check 通过。未运行会覆盖其他 Agent `dist-electron/**` 的 build，目标链尚未接生产，因此没有可执行的真实页面手工验证。

## 2026-08-26: same target (main capture composition partial)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本切片只建立未注册的 production-equivalent main composition，未完成 production wiring 或任何 unit cutover。
- change groups: `electron-integration`（唯一 session network adapter、每 view 唯一 probe adapter、Store/Vault/lifecycle/access composition）与 `stability/security-boundary`（导航 generation、view replacement、destroy/dispose、deep-only probe ingress）。
- affected capability IDs: `capture.owner-lifecycle` 保持 `ported-unverified`；新增 active `network.production-equivalent-composition`，active 计划测试 ID 增至 25，总计划 ID 增至 80；所有 unit 仍为 0 cutover。
- fixtures/tests: 无 fixture；新增 `embedded-browser-capture-runtime.test.ts#network.production-equivalent-composition`，覆盖单一 network/probe 事件链、first-byte 资源写入、敏感 header 仅 main 兑现、安全 projection、deep-only token 签发、导航迟到 token 拒绝、重新绑定、view replacement、自发 destroy 和完整 listener dispose。
- accepted difference: 无新增；composition 复用同一 embedded browser partition 的 Electron session fetch，后续 production wiring 仍必须从该捕捉 session 注入，不能使用 Node/global fetch。
- excluded changes and reasons: 本切片不实例化 production runtime，不修改旧 listener/probe/IPC/preload/renderer 或四类 consumer 入口；构造 runtime 即会占用 session `webRequest` listener，只允许在 network unit 原子 cutover 时发生。
- unresolved gaps: production probe script 安装、safe resource state IPC/preload/renderer reducer、四类 consumer sink/entry、唯一 MainSupport dispatch 切换和旧 network/request-context/header DTO 清理。
- runtime changes: 新增未注册 `EmbeddedBrowserCaptureRuntime`，组合既有目标模块而不重写分类、状态或 consumer 算法。生产旧链无变化。
- legacy cleanup: 无；旧 bridge/recorder/DTO 继续作为唯一 production owner，等待安全跨进程链完成后同片删除。
- validation: main composition Vitest 1/1、network target chain 56/56、同步校验 16/16、固定 metadata/192 anchors/106 cleanup entries/80 planned IDs、TypeScript、全量 ESLint 和 Cat Catch 作用域 diff check 通过；排除已由 `node --test` 专门执行的同步校验文件后，全量 Vitest 为 149 files、807 passed、1 skipped。未运行会覆盖其他 Agent `dist-electron/**` 的 build；目标链尚未接生产，因此没有可执行的真实页面手工验证。

## 2026-08-26: same target (persisted capture settings adaptation partial)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本切片只让目标 classifier/runtime 消费现有 OmniFlow 用户设置，不切 production owner。
- change groups: `omniflow-integration`（extension、MIME wildcard、regex、domain whitelist/blacklist 编译）与 `electron-integration`（已注册 listener 的原地 policy 热更新）。
- affected capability IDs: `capture.rules-classification-deduplication` 保持 `ported-unverified`；新增 active `network.omniflow-settings-adaptation`，active 计划测试 ID 增至 26，总唯一计划 ID 增至 81；所有 unit 仍为 0 cutover。
- fixtures/tests: 无 fixture；目标 policy 测试覆盖自定义 extension、禁用默认媒体、产品图片开关、regex URL rewrite、domain whitelist 与 blacklist 优先级；runtime fake Electron integration 覆盖设置更新不替换所拥有的 `webRequest` listener，且后续请求使用新规则。
- accepted difference: 现有 OmniFlow 设置只表达启用集合，没有 Cat Catch 的逐规则 size/operator 字段；编译器对启用项使用 `>= 0 KB`，同时保留 Cat Catch classifier 的 extension hard-break、MIME wildcard 和 regex 优先级。
- excluded changes and reasons: 不删除或改写持久化规则 Store/UI；它们是 OmniFlow 产品设置 owner，生产 cutover 时只把读取/更新结果编译后交给 runtime。当前不实例化 production runtime，避免双 `webRequest` listener。
- unresolved gaps: production 设置加载/保存入口仍需调用 runtime 初始编译与热更新；safe resource state IPC/preload/renderer、probe install、四类 consumer entry 和原子 cutover 仍待完成。
- runtime changes: 未注册 `ElectronNetworkCaptureAdapter` 与 `EmbeddedBrowserCaptureRuntime` 新增 compiled settings 输入和原地更新；生产旧 classifier/rules 行为不变。
- legacy cleanup: 无；旧 settings evaluation 只有在 network-capture 原子切换后才删除，持久化、标准化和 UI 继续保留。
- validation: network target chain 15 files/58 tests、同步校验 16/16、固定 metadata/192 anchors/106 cleanup entries/81 unique planned IDs、TypeScript、全量 ESLint 和 Cat Catch 作用域 diff check 通过；排除已由 `node --test` 专门执行的同步校验文件后，全量 Vitest 为 149 files、809 passed、1 skipped。未运行会覆盖其他 Agent `dist-electron/**` 的 build；目标 runtime 尚未接生产，因此没有可执行的真实页面手工验证。

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
