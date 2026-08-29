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

## 2026-08-26: same target (opaque probe resource resolution partial)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本切片只完成 main-only probe/MSE key 的安全解析边界，未完成 production wiring 或任何 unit cutover。
- change groups: `security-boundary`（renderer 只提交 opaque `tabId/resourceId`）与 `stability`（当前 incarnation/navigation/page origin/WebContents owner 复核）。
- affected capability IDs: `capture.resource-state-contract` 保持 `ported-unverified`；新增 active `network.opaque-probe-resource-resolution`，active 计划测试 ID 增至 27，总唯一计划 ID 增至 82；所有 unit 仍为 0 cutover。
- fixtures/tests: 无 fixture；`embedded-browser-capture-runtime.test.ts#network.opaque-probe-resource-resolution` 覆盖当前 probe resource key 解析、cross-tab 拒绝、保留资源在导航后失效和 runtime dispose 后拒绝。
- accepted difference: 无新增；probe/MSE page key 继续是 main-only owner fact，不进入 renderer-safe resource projection。
- excluded changes and reasons: 不在本切片接入 production MSE/probe command IPC；该入口必须与 safe state contract、production runtime 和旧 DTO 清理一起切换，避免 renderer 在过渡态重新获得私有 key。
- unresolved gaps: production composition 实例化、probe install、safe IPC/preload/renderer reducer、四类 consumer entry 和 network unit 原子 cutover。
- runtime changes: 未注册 `EmbeddedBrowserCaptureRuntime` 新增 opaque resource id 到当前 probe page key 的受控解析；网络资源、跨 tab、过期 document owner 和已 dispose runtime 均返回空。
- legacy cleanup: 无；旧 renderer `resourceKey` DTO 在 network-capture 原子切换前仍由旧链使用。
- validation: network target chain 15 files/59 tests、同步校验 16/16、固定 metadata/192 anchors/106 cleanup entries/82 unique planned IDs、TypeScript、全量 ESLint 和 Cat Catch 作用域 diff check 通过；排除已由 `node --test` 专门执行的同步校验文件后，全量 Vitest 为 149 files、810 passed、1 skipped。未运行会覆盖其他 Agent `dist-electron/**` 的 build；目标 runtime 尚未接生产，因此没有可执行的真实页面手工验证。

## 2026-08-26: same target (next-document probe routing partial)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本切片修复 production probe 接线前发现的 document-start token/generation 缺口，未完成 production wiring 或任何 unit cutover。
- change groups: `security-boundary`（上一文档 token 拒绝）与 `electron-integration`（预签下一 navigation generation 的 document-start route）。
- affected capability IDs: `capture.owner-lifecycle` 保持 `ported-unverified`；新增 active `network.probe-next-document-routing`，active 计划测试 ID 增至 28，总唯一计划 ID 增至 83；所有 unit 仍为 0 cutover。
- fixtures/tests: 无 fixture；`electron-page-probe.test.ts#network.probe-next-document-routing` 覆盖当前/下一 token 分离、导航后无需 dom-ready 重新签发即可接收 document-start payload、旧 token 拒绝和下一 route 提升复用。
- accepted difference: 无新增；下一 route 只预签 token 和期望 owner stamp，直到 binding 真实前进后才由 main 获取 capture authority。
- excluded changes and reasons: 不修改 production CDP probe installer；本切片先让 target adapter 能正确表达当前脚本与下一 document-start 脚本，接线时再一次替换旧无 token installer。
- unresolved gaps: production composition 实例化、CDP installer 使用 current/next scripts、safe IPC/preload/renderer reducer、四类 consumer entry 和 network unit 原子 cutover。
- runtime changes: `ElectronPageProbeEventAdapter` 增加单个 bounded next route；`EmbeddedBrowserCaptureRuntime` 只在 deep mode 暴露下一文档脚本。导航、崩溃、replacement 和 dispose 的原有 owner 规则不变。
- legacy cleanup: 无；旧无 token production probe listener/installer 仍等待 network-capture 原子切换。
- validation: network target chain 15 files/60 tests、同步校验 16/16、固定 metadata/192 anchors/106 cleanup entries/83 unique planned IDs、TypeScript、全量 ESLint 和 Cat Catch 作用域 diff check 通过；排除已由 `node --test` 专门执行的同步校验文件后，全量 Vitest 为 149 files、811 passed、1 skipped。未运行会覆盖其他 Agent `dist-electron/**` 的 build；目标 runtime 尚未接生产，因此没有可执行的真实页面手工验证。

## 2026-08-27: same target (captured page-drag authority partial)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本切片只把已捕获 URL 的页面拖拽暂存接入 main-owned authority，未完成 network unit cutover。
- change groups: `security-boundary`（拖拽来源按当前 tab/URL 绑定 opaque resource id，authority 恢复 URL 与 context）与 `platform-adaptation`（授权 Response 注入既有暂存 sink，保留 data/blob/未捕获 fallback）。
- affected capability IDs: `capture.protected-request-context` 保持 `ported-unverified`；已有 `network.owned-resource-transfer-consumers` 测试扩展，所有 unit 仍为 0 cutover。
- fixtures/tests: 无 fixture；扩展 `embeddedBrowserPageDragService.test.ts` 覆盖 authority URL/header/body 与 legacy session fetch 隔离，扩展 `resource-state-store.test.ts` 覆盖 URL lookup 的当前 generation/TTL 约束，`embedded-browser-capture-runtime.test.ts` 覆盖 runtime URL 到 opaque id 解析。
- accepted difference: 页面拖拽的 data/blob、未捕获 URL 和多资源 fallback 仍是 OmniFlow 自有路径，不强行伪装成 captured resource；已捕获 HTTP(S) 不再使用 renderer 提供的 URL 或 header。
- excluded changes and reasons: 不在本切片迁移 HLS/DASH plan、旧 catch toolkit、transfer task registry 或 staging lease；它们继续等待各自 unit 的 production-equivalent 证据。
- unresolved gaps: 多资源 drag fallback、production smoke、完整 network-capture 原子切换、旧 request context/富 DTO 清理。
- runtime changes: `ResourceStateStore.getOwnedResourceByUrl` 与 `EmbeddedBrowserCaptureRuntime.resolveResourceIdByUrl` 新增当前 owner 约束；page-drag source 在 main 侧按 URL 绑定 id，staging service 对绑定资源调用 `CapturedResourceAccessService`。
- legacy cleanup: 无新增；legacy page-drag fallback 保留至 network-capture/output unit 收口。
- validation: TypeScript、page-drag/resource-store/runtime 27 项定向测试通过；同步校验 16/16。未运行会覆盖其他 Agent `dist-electron/**` 的 build，也未做真实页面手工验证。

## 2026-08-27: same target (HLS/DASH plan transport authority partial)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本切片只为 HLS/DASH 本地计划和 HLS live 录制注入 main-owned fetch transport，未完成 parser、直拉/live/track 的完整切换或任何 unit cutover。
- change groups: `security-boundary`（计划 payload 增加 opaque `resourceId`，HTTP manifest authority 过期/跨 tab 时拒绝）与 `platform-adaptation`（分片、init segment、map、key 和 live manifest 优先按当前 tab/URL 走 `CapturedResourceAccessService`，未捕获 URL 保留 embedded session fallback；Range 只作为受控附加参数）。
- affected capability IDs: `hls.segment-pipeline`、`dash.timeline-download-merge` 增加 authority transport 证据；`capture.protected-request-context` 继续为 `ported-unverified`，所有 unit 仍为 0 cutover。
- fixtures/tests: 新增 `electron/service/embeddedBrowserFragmentDownloader.test.ts#hls.plan-authority-fetch`，覆盖注入 fetch 和 byte range；扩展 `captured-resource-access.test.ts` 覆盖 authority range header；TypeScript 通过。
- accepted difference: 解析不到当前 tab 已捕获记录的 URL 时，继续使用 embedded browser session 传输，以保留 inline/blob 或捕捉规则未记录分片的现有行为；renderer plan 的结构和未捕获 fallback 尚未删除。
- excluded changes and reasons: 不在本切片迁移 Cat Catch HLS parser、DASH timeline 语义、cache fallback/伪装分片、ffmpeg/task registry、direct-manifest/live/track 的完整 authority 或旧 catch toolkit。
- unresolved gaps: HLS/DASH 计划的 production-equivalent smoke、redirect/Range 输出、全量 task/cancel/cleanup、直拉/live/track nested request authority、完整 network-capture 原子切换。
- runtime changes: `EmbeddedBrowserFragmentDownloader`、HLS local/live 和 MPD local downloader 支持注入 fetch；main controller 按 `tabId + URL` 解析 opaque resource，使用 `resource-download` purpose 恢复 context，并让 `resourceId` 随 HLS/MPD plan IPC 传递。
- legacy cleanup: 无；旧 direct manifest、renderer plan DTO、未捕获 session fallback 和 catch toolkit 路径继续保留。
- validation: TypeScript、5 个相关 Vitest 文件 27/27、同步校验 16/16、目标文件 `git diff --check` 通过；未运行会覆盖其他 Agent `dist-electron/**` 的 build，也未做真实页面手工验证。

## 2026-08-27: same target (HLS live manifest authority partial)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本切片把 HLS live start 的 manifest owner 校验和 authority-aware fetch 绑定到轮询、增量分片和本地 playlist 链，未完成 live task/cleanup 或任何 unit cutover。
- change groups: `security-boundary`（录制 payload 传递 opaque `resourceId`，当前 tab/manifest owner 失效时拒绝）与 `platform-adaptation`（captured manifest/segment/key/map 优先由 `CapturedResourceAccessService` 恢复上下文，未捕获 URL 仍走 embedded session fallback）。
- affected capability IDs: `hls.live-recording` 增加 authority transport 事实；`capture.protected-request-context` 继续为 `ported-unverified`，所有 unit 仍为 0 cutover。
- fixtures/tests: 复用 `embeddedBrowserFragmentDownloader.test.ts#hls.plan-authority-fetch` 和 `captured-resource-access.test.ts#network.redirect-hop-isolation` 的传输/Range/owner 证据；未新增 live fixture，真实直播页面仍未验证。
- accepted difference: live manifest 仍由现有 controller Map 持有，未引入统一 task registry；解析不到 captured URL 时保留 session fallback。
- excluded changes and reasons: 不在本切片迁移 HLS live 轮询节奏、累计 playlist 语义、ffmpeg 输出、取消/崩溃清理、HLS track merge 或 direct-manifest ffmpeg 请求。
- unresolved gaps: live task/cleanup owner、redirect/Range 输出 smoke、direct/live/track 的完整 nested request authority、完整 network-capture 原子切换。
- runtime changes: `startHlsRecording` 增加 `resourceId` IPC 字段；main 校验 exact/seed resource grant，使用 authority URL/context 初始化 `EmbeddedBrowserHlsLiveRecorder`，并复用前一切片的 injected fetch。
- legacy cleanup: 无；旧 live controller Map、renderer DTO 和未捕获 fallback 继续保留。
- validation: TypeScript、定向 lint、5 个相关 Vitest 文件 27/27、同步校验 16/16、目标文件 `git diff --check` 通过；未运行会覆盖其他 Agent `dist-electron/**` 的 build，也未做真实页面手工验证。

## 2026-08-27: same target (HLS parser vertical slice)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`; 游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本切片只完成纯 HLS manifest parser 的第一段行为迁移，未完成 hls-engine cutover。
- change groups: `behavioral`（`EXT-X-BYTERANGE` 隐式 offset 继承）与 `platform-adaptation`（renderer 模型通过兼容 facade 调用纯 port）。
- affected capability IDs: `hls.parser-planner` 改为 `ported-unverified`，`syncedThrough` 记录到 migration target；所有 unit 仍为 0 cutover。
- fixtures/tests: 新增 active fixture `hls-byterange-implicit-offset`，覆盖 parser core、map/key/discontinuity 和连续 range；该步最初把跨 URI 省略 offset 误记为按资源重置，后续由固定 vendor executable oracle 修正为继承紧邻前一个 fragment。
- accepted difference: 仍保留现有 OmniFlow manifest/download-plan DTO；仅把 manifest parse owner 移到纯 port，尚未迁移 hls.js 全部 parser 事件、cache fallback、伪装分片和 track merge。
- excluded changes and reasons: 不在本切片接入 task/ffmpeg/filesystem，也不删除 renderer plan builder 或旧 downloader；这些需要后续 pipeline/output 证据。
- unresolved gaps: HLS parser 完整标签语义、cache fallback/预处理、direct/live/track nested authority、统一 task/cleanup 和 production-equivalent smoke。
- runtime changes: `electron/service/embedded-browser/cat-catch-port/hls/parser.ts#parseHlsManifest` 成为 parse path owner；`parseEmbeddedBrowserHlsManifest` 仅保留 renderer 兼容 facade。
- legacy cleanup: 无；`parseEmbeddedBrowserHlsManifest` 与 download-plan builder 在 hls-engine cutover 前继续保留为兼容入口。
- validation: parser fixture 2/2、HLS 相关 Vitest 3/3、TypeScript、定向 lint、`cat-catch:validate` 和同步校验 16/16 通过；未运行会覆盖其他 Agent `dist-electron/**` 的 build，也未做真实页面验证。

## 2026-08-27: same target (HLS discontinuity sequence)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本步补齐 parser 对 `EXT-X-DISCONTINUITY-SEQUENCE` 初始值的处理，仍未完成 hls-engine cutover。
- change groups: `behavioral`（固定版 hls.js 的初始 discontinuity sequence 及其与增量 tag 的顺序）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`，继续指向同一 migration target。
- fixtures/tests: 扩展 active fixture `hls-byterange-implicit-offset`，期望 sequence `3 -> 4`，parser 测试保持 2/2。
- accepted difference: 无新增；renderer facade、download-plan projection 和旧 pipeline 仍保留。
- excluded changes and reasons: 不在本步迁移 live playlist refresh、cache fallback、伪装分片或 task/output。
- unresolved gaps: HLS 完整标签差分、direct/live/track nested authority、统一 task/cleanup 和 production-equivalent smoke。
- runtime changes: `parseHlsManifest` 在普通 `DISCONTINUITY` 前处理 `DISCONTINUITY-SEQUENCE`，避免前缀匹配把初始值误算成一次增量。
- legacy cleanup: 无。
- validation: 失败 fixture 先复现 `1/2`，实现后 parser fixture 2/2、HLS 相关 Vitest 3/3、TypeScript、定向 lint、`cat-catch:validate` 和同步校验 16/16 通过；未运行会覆盖其他 Agent `dist-electron/**` 的 build，也未做真实页面验证。

## 2026-08-27: same target (HLS disguised-fragment preprocessing)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本步只完成纯 preprocessing port，未接入下载 pipeline 或 hls-engine cutover。
- change groups: `behavioral`（`dataPreprocessing` 对 PNG/JPEG 前缀、完整结束标记和异常回退的处理）。
- affected capability IDs: `hls.cache-fallback-disguised-fragments` 改为 `porting`，`hls.decrypt-preprocess-order` 仍待实现。
- fixtures/tests: 新增 active fixture `hls-disguised-fragment-preprocess`，覆盖 PNG、JPEG、缺失结束标记、普通媒体和短输入。
- accepted difference: 纯函数保持 ArrayBuffer 输入和原始 buffer 回退；是否启用预处理仍由后续 application/pipeline adapter 决定。
- excluded changes and reasons: 不在本步实现一次性 manifest cache fallback、解密顺序、下载器 wiring 或生产 output 变更。
- unresolved gaps: cache fallback、preprocess/decrypt 顺序、pipeline integration、HLS 统一 task/cleanup 和 production-equivalent smoke。
- runtime changes: 新增 `electron/service/embedded-browser/cat-catch-port/hls/pipeline.ts#preprocessFragment`，只移除已确认完整的图片前缀，否则原样返回。
- legacy cleanup: 无；`embeddedBrowserHlsLocalDownloaderService` 继续是生产 owner，直到 pipeline 证据完成。
- validation: preprocessing fixture 1/1、TypeScript、定向 lint、`cat-catch:validate` 和同步校验 16/16 通过；未运行会覆盖其他 Agent `dist-electron/**` 的 build，也未做真实页面验证。

## 2026-08-27: same target (HLS fragment preprocessing pipeline wiring)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本步把纯预处理接入本地 HLS 分片下载生命周期，仍未完成 hls-engine cutover。
- change groups: `platform-adaptation`（下载器注入可选 buffer processor，保留 rawBuffer 原始事件并在顺序输出前处理）。
- affected capability IDs: `hls.cache-fallback-disguised-fragments` 保持 `porting`；`hls.decrypt-preprocess-order` 仍待实现。
- fixtures/tests: 扩展 `embeddedBrowserFragmentDownloader.test.ts#raw-bytes-before-processed-output`，覆盖原始字节事件与顺序输出字节的边界；纯 preprocessing fixture 继续有效。
- accepted difference: `preprocessFragments` 默认关闭；当前 local-plan、failed-fragment retry 和 live recorder 路径显式开启，直拉 ffmpeg 路径不变。
- excluded changes and reasons: 不在本步实现一次性 manifest cache fallback、AES 解密顺序、统一 task/cleanup 或旧 downloader 删除。
- unresolved gaps: cache fallback 入口的完整语义、preprocess/decrypt 顺序、HLS output smoke、统一 task/cleanup 和 production-equivalent page validation。
- runtime changes: `EmbeddedBrowserFragmentDownloader` 新增可选异步 `bufferProcessor`；`downloadEmbeddedBrowserHlsToLocalWorkDirectory` 增加 `preprocessFragments`，在 rawBuffer 之后调用 `preprocessFragment`，写盘和 sequentialPush 使用处理后 buffer。
- legacy cleanup: 无；现有 downloader 仍是生产 owner，尚未切换或删除旧实现。
- validation: 定向 Vitest 5/5、TypeScript、定向 ESLint、`cat-catch:validate` 和同步校验 16/16 通过；未运行会覆盖其他 Agent `dist-electron/**` 的 build，也未做真实页面手工验证。

## 2026-08-27: same target (ordered HLS processor chain)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本步补齐 Cat Catch `Downloader.use` 的有序异步处理边界，仍未完成 hls-engine cutover。
- change groups: `behavioral`（多处理步骤按声明顺序执行，并在每步后暴露处理结果）。
- affected capability IDs: `hls.segment-pipeline` 改为 `porting`；`hls.cache-fallback-disguised-fragments` 继续复用该边界，仍为 `porting`。
- fixtures/tests: `embeddedBrowserFragmentDownloader.test.ts` 新增 processor chain 顺序和 `processedBuffer` 事件测试；`embeddedBrowserHlsLocalDownloaderService.test.ts` 覆盖预处理写盘与默认 raw path；定向测试覆盖 7/7。
- accepted difference: 旧单 processor 选项继续兼容；未引入 Cat Catch UI 中的 processor 名称或扩展页状态。
- excluded changes and reasons: 不在本步实现 AES 解密、mux/transcode、统一 task/cancel owner 或旧 downloader 删除。
- unresolved gaps: 解密实现及其与预处理的顺序证据、HLS output smoke、一次性 cache fallback、统一 task/cleanup 和 production-equivalent page validation。
- runtime changes: `EmbeddedBrowserFragmentDownloader` 支持 `bufferProcessors` 有序异步链，每步发出 `processedBuffer`；HLS 本地预处理改用单元素 processor chain。
- legacy cleanup: 无；现有 downloader 仍是生产 owner，尚未切换或删除旧实现。
- validation: 定向 Vitest 7/7、TypeScript、定向 ESLint、`cat-catch:validate` 和同步校验 16/16 通过；完整 build 仍因其他 Agent 的 `dist-electron/**` 修改未运行。

## 2026-08-27: same target (HLS AES-128 primitive and ordering evidence)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本步新增纯 Web Crypto AES-128-CBC 解密原语和默认 IV 生成，仍未完成 hls-engine cutover。
- change groups: `behavioral`（Cat Catch HLS AES-128 解密、PKCS#7 去 padding、manifest IV / sequence 默认 IV）与 `platform-adaptation`（使用标准 Web Crypto，不携带扩展页 AES bundle）。
- affected capability IDs: `hls.segment-pipeline` 与 `hls.cache-fallback-disguised-fragments` 保持 `porting`。
- fixtures/tests: `hls/decrypt.test.ts` 覆盖 AES-128 round-trip、sequence-derived IV、非法输入和 `hls.decrypt-preprocess-order`（图片前缀先剥除再解密）。
- accepted difference: 原语要求完整 16-byte ciphertext block，并依赖 Web Crypto 对 PKCS#7 做严格校验；上游 bundle 对异常 padding 的行为未作为正常媒体路径保留。
- excluded changes and reasons: 不在本步把解密接入本地 playlist/ffmpeg、实现 key cache、统一 task/cancel owner 或删除旧 downloader。
- unresolved gaps: production HLS decrypt adapter、key 生命周期与 authority、完整 output smoke、一次性 cache fallback、统一 task/cleanup 和 page validation。
- runtime changes: 新增 `cat-catch-port/hls/decrypt.ts`，导出 `decryptHlsAes128` 与 `createHlsDefaultIv`；处理器链已可承接该异步步骤。
- legacy cleanup: 无；现有 ffmpeg/playlist 解密路径继续承担生产职责。
- validation: 定向 decrypt 测试 4/4；待本步提交前重跑 HLS 全集、TypeScript、定向 ESLint、`cat-catch:validate`、同步校验和 diff 检查；完整 build 仍因其他 Agent 的 `dist-electron/**` 修改未运行。

## 2026-08-27: same target (HLS AES-128 key length guard)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本步补齐上游 key fetch 对 AES-128 16-byte 内容的前置约束，仍未完成 hls-engine cutover。
- change groups: `behavioral`（key 内容长度校验失败时停止准备，不继续下载媒体分片）。
- affected capability IDs: `hls.segment-pipeline` 继续为 `porting`。
- fixtures/tests: `embeddedBrowserHlsLocalDownloaderService.test.ts#hls.key-length-validation` 使用 3-byte key，断言在 key 请求后立即失败且媒体 URL 未被请求。
- accepted difference: 手动输入 key 在已有 base64/16-byte 规范化阶段校验；本步只覆盖网络 key，非 AES 方法仍按原有 playlist 兼容路径保留。
- excluded changes and reasons: 不在本步实现 key 解密、key cache 生命周期、统一 task/cancel owner 或旧 downloader 删除。
- unresolved gaps: production decrypt adapter、key authority/redirect 语义、完整 output smoke、一次性 cache fallback、统一 task/cleanup 和 page validation。
- runtime changes: 抽出 `fetchStaticResourceBuffer`，网络 AES-128 key 写盘前严格要求 16 字节；map 与普通静态资源继续复用同一读取路径。
- legacy cleanup: 无；现有 ffmpeg/playlist 解密路径继续承担生产职责。
- validation: HLS 相关 Vitest 11/11、TypeScript、定向 ESLint、`cat-catch:validate` 和同步校验 16/16 通过；完整 build 未运行，原因仍是其他 Agent 修改了 `dist-electron/**`。

## 2026-08-27: same target (HLS local cancellation and cleanup)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本步补齐本地 HLS 下载取消的终态通知、AbortSignal 接入和 downloader 清理，仍未完成 hls-engine cutover。
- change groups: `behavioral`（取消不再永久等待）与 `platform-adaptation`（local service 的 Promise、临时写盘和 downloader 生命周期绑定）。
- affected capability IDs: `hls.segment-pipeline` 继续为 `porting`。
- fixtures/tests: `embeddedBrowserFragmentDownloader.test.ts#hls.retry-cancel-range` 覆盖下载器 aborted 事件；`embeddedBrowserHlsLocalDownloaderService.test.ts#hls.cancel-aborts-local-download` 覆盖 service 取消拒绝和请求中断。
- accepted difference: AbortSignal 是 OmniFlow adapter 合同，不改变 Cat Catch 扩展页面 API；未新增 renderer 取消状态源。
- excluded changes and reasons: 不在本步接入 IPC 取消按钮、统一 task registry、临时目录 TTL 或旧 downloader 删除。
- unresolved gaps: IPC/task owner 取消传播、key authority/redirect 语义、完整 output smoke、一次性 cache fallback、统一 task/cleanup 和 page validation。
- runtime changes: `EmbeddedBrowserFragmentDownloader.stop()` 对活跃任务发出一次 `aborted`；HLS local request 支持 `signal`，所有下载终态移除监听并销毁 downloader。
- legacy cleanup: 无；现有 ffmpeg/playlist 解密路径继续承担生产职责。
- validation: HLS 相关 Vitest 14/14、定向 ESLint、`cat-catch:validate` 和同步校验 16/16 通过；全局 TypeScript 仍被其他 agent 的 `agent-local-storage-quota-manager.ts` 两处错误阻断，完整 build 未运行。

## 2026-08-27: same target (HLS fragment retry evidence)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本步补齐 Cat Catch downloader 的失败 attempt 重试证据，仍未完成 hls-engine cutover。
- change groups: `behavioral`（HTTP 失败按 maxRetries 重新排队，成功后恢复 allCompleted 终态）。
- affected capability IDs: `hls.segment-pipeline` 继续为 `porting`。
- fixtures/tests: `embeddedBrowserFragmentDownloader.test.ts#hls.failed-fragment-retry` 首次返回 503、第二次成功，断言两次请求、attempt=1 错误事件和最终 success=1。
- accepted difference: 重试不引入上游 UI 的 retry button 或延迟文案；当前 adapter 保持立即重新排队，取消仍由 AbortSignal 控制。
- excluded changes and reasons: 不在本步调整 retry delay/backoff、统一 task registry、临时目录 TTL 或旧 downloader 删除。
- unresolved gaps: retry backoff/全 task cancel 语义、key authority/redirect、完整 output smoke、一次性 cache fallback、统一 task/cleanup 和 page validation。
- runtime changes: 无新增生产逻辑；以现有有序 processor chain 和 downloader retry 实现建立可执行回归证据。
- legacy cleanup: 无；现有 ffmpeg/playlist 解密路径继续承担生产职责。
- validation: 定向 HLS downloader 测试 5/5 通过；待本步提交前重跑全 HLS 集合、lint、Cat Catch validator、同步校验和 diff 检查；全局 TypeScript 仍受其他 agent storage 改动阻断。

## 2026-08-27: same target (HLS static reference Range contract)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本步锁定 key、EXT-X-MAP 和媒体分片的静态资源 Range 请求契约，仍未完成 hls-engine cutover。
- change groups: `platform-adaptation`（统一 fetch/authority 入口和字节范围转换）。
- affected capability IDs: `hls.segment-pipeline` 继续为 `porting`。
- fixtures/tests: `embeddedBrowserHlsLocalDownloaderService.test.ts#hls.static-ref-range` 断言 key 无 Range、map `bytes=1-2`、媒体 `bytes=5-7`，并验证请求顺序。
- accepted difference: Range 只在首跳由 `CapturedResourceAccessService` 携带，重定向目标不复用敏感上下文；本测试只验证 local adapter 发出的首跳请求。
- excluded changes and reasons: 不在本步调整 redirect、缓存、并发、统一 task registry 或旧 downloader 删除。
- unresolved gaps: redirect/Range output smoke、一次性 cache fallback、key 生命周期与解密 adapter、统一 task/cleanup 和 page validation。
- runtime changes: 无新增生产逻辑；现有 `downloadStaticResource` 与 fragment downloader 的 Range 计算得到独立回归证据。
- legacy cleanup: 无；现有 ffmpeg/playlist 解密路径继续承担生产职责。
- validation: local HLS 测试 4/4 通过；待本步提交前重跑全 HLS 集合、lint、Cat Catch validator、同步校验和 diff 检查；全局 TypeScript 仍受其他 agent storage 改动阻断。

## 2026-08-27: same target (HLS static/live abort propagation)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本步闭合 key/map/media 与 live manifest/segment 的取消传播，仍未完成 hls-engine cutover。
- change groups: `behavioral`（discard/stop 主动中止在途直播请求）与 `platform-adaptation`（navigation/tab/view/crash/controller dispose 触发 retry/live 清理）。
- affected capability IDs: `hls.segment-pipeline` 继续为 `porting`；`hls.live-recording` 从 `pending` 进入 `porting`。
- fixtures/tests: `embeddedBrowserHlsLocalDownloaderService.test.ts#hls.cancel-aborts-static-refs` 覆盖 key 准备阶段取消；`embeddedBrowserHlsLiveRecorder.test.ts#hls.live-terminal` 覆盖直播本地 playlist/segment 终态；同文件 `#hls.live-discard-abort` 覆盖在途直播分片被 discard 中止。
- accepted difference: Cat Catch 通过扩展 tab/Downloader stop 管理录制；OmniFlow 使用 recorder-owned AbortController，并把宿主 lifecycle 映射到 discard，不引入 renderer 状态 owner。
- excluded changes and reasons: 不在本步实现 active plan/ffmpeg 进程取消、统一 task registry、应用退出等待全部异步清理、一次性 manifest cache fallback 或旧 downloader 删除。
- unresolved gaps: 完整 output smoke、active plan/retry/live/ffmpeg/workdir 单一 owner、awaited app-exit cleanup、生产 lifecycle integration、一次性 cache fallback、完整 parser 和解密责任。
- runtime changes: 静态 key/map fetch 继承 local request AbortSignal；live recorder 的 manifest 与 segment 请求共用 AbortController，stop/discard 可终止在途请求；navigation、tab/view 销毁、render-process loss 和 controller dispose 会删除匹配 session 并发起清理。
- legacy cleanup: 无；现有 controller Maps、ffmpeg/playlist 解密与旧输出链继续承担生产职责。
- validation: 完整 HLS 集合 19/19、仓库级 lint、全局 TypeScript、`cat-catch:validate`、同步校验 16/16 和 scoped diff 检查通过。全量 Vitest 共 914 条，895 通过、1 skipped、18 失败：16 条为当前沙箱禁止 loopback `listen 127.0.0.1`，另 2 条来自并行开发中的 Agent SQLite/approval 改动，均不在 Cat Catch 路径；完整 build 因共享工作区的 `dist-electron/**` 改动不运行。

## 2026-08-27: same target (HLS local-to-ffmpeg output handoff)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本步建立 local playlist 到 ffmpeg wrapper 的可执行交付证据，仍未完成 hls-engine cutover。
- change groups: `platform-adaptation`（本地 key/map/media/playlist 到 ffmpeg 输入与目标文件交付合同）。
- affected capability IDs: `hls.segment-pipeline` 继续为 `porting`。
- fixtures/tests: `embeddedBrowserHlsOutput.test.ts#hls.local-output-smoke` 下载 key、map 和媒体分片，核对 rewritten playlist 与落盘字节，断言 ffmpeg `-i` 使用本地 playlist、progress 可投影且非空目标文件被交付；同文件覆盖 ffmpeg 零退出但没有输出时必须失败。
- accepted difference: 自动化使用受控 fake child 锁定 OmniFlow process wrapper 合同，不把它描述为真实 ffmpeg 容器正确性；真实 ffmpeg/ffprobe fixture 仍是独立缺口。
- excluded changes and reasons: 不在本步实现真实媒体转封装 fixture、ffmpeg 取消、统一 task owner、生产解密或旧输出链删除。
- unresolved gaps: 真实 ffmpeg/ffprobe output、active plan/retry/live/ffmpeg/workdir 单一 owner、一次性 cache fallback、完整 parser 与 decrypt responsibility。
- runtime changes: manifest/track ffmpeg wrapper 在零退出后检查目标必须为非空普通文件，否则返回明确交付错误；HLS controller 仍调用同一 wrapper。
- legacy cleanup: 无；现有 controller orchestration 和旧输出路径继续保留。
- validation: 完整 HLS 集合 21/21、仓库级 lint、TypeScript、`cat-catch:validate`、同步校验 16/16 和 scoped diff 检查通过；未重复运行上一切片已记录为环境/并行模块失败的全量 Vitest，完整 build 仍因共享工作区的 `dist-electron/**` 改动不运行。

## 2026-08-27: same target (HLS retry/live session owner)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本步只收敛 HLS retry/live 会话状态和清理责任，仍未完成 hls-engine cutover。
- change groups: `platform-adaptation`（Electron tab/request 复合身份、recorder discard 与本地 workdir 生命周期）。
- affected capability IDs: `hls.segment-pipeline`、`hls.live-recording` 均保持 `porting`。
- fixtures/tests: `hls.session-owner-tab-cleanup` 覆盖按 tab 同时清理 retry/live 且不影响另一 tab；`hls.session-owner-dispose` 覆盖全量 discard/workdir 清理；另有跨 tab 相同 renderer request ID 隔离和 terminal ownership transfer 回归。
- accepted difference: Cat Catch 通过扩展 tab/downloader 状态管理任务；OmniFlow 使用 main-only、`tabId + requestId` 复合标识的专用 HLS owner，不向 renderer 增加第二份状态源。
- excluded changes and reasons: 不在本步把 active plan、ffmpeg child process 或 renderer listener 纳入 owner，也不进行 hls-engine dispatch cutover 或删除旧 downloader/recorder。
- unresolved gaps: active plan/ffmpeg 取消、awaited app-exit cleanup、production lifecycle integration、真实 ffmpeg/ffprobe output、一次性 cache fallback、完整 parser 与 decrypt responsibility。
- runtime changes: controller 内两张 retry/live Map 由 `EmbeddedBrowserHlsSessionOwner` 替代；owner 在异步 discard/workdir 删除前先释放匹配状态，所有查找和终态 transfer 都校验 tab/request 复合身份。
- legacy cleanup: 删除已不存在的两张 legacy controller Map 记录，新增 `hls-session-owner.ts#retrySessions` 与 `#liveSessions` 两项 `omniflow-integration / retain-or-adapt` 事实；其余 HLS legacy task/downloader/recorder 条目不变。
- validation: 完整 HLS Vitest 25/25、仓库级 lint、TypeScript、`cat-catch:validate`、同步校验 16/16 和 scoped diff check 通过。全量 Vitest 为 906 passed / 1 skipped / 16 loopback sandbox failures，相关 4 个 loopback 文件在允许监听本机端口的环境复跑 20/20 通过；另有既有 `tools/cat-catch-sync/validate.test.mjs` 被 Vitest 扫描后报告 no suite。完整 build 未运行，避免覆盖其他 Agent 正在修改的 `dist-electron/**`。

## 2026-08-27: same target (HLS active-task and ffmpeg cancellation)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本步闭合 active HLS fetch/ffmpeg 的宿主取消传播，仍未完成 hls-engine 或 output-integration cutover。
- change groups: `platform-adaptation`（main-only active-task ownership、跨平台 ffmpeg process-tree 终止和 partial output 清理）。
- affected capability IDs: `hls.segment-pipeline`、`hls.live-recording` 保持 `porting`；`output.ffmpeg-process-owner` 保持 `pending`，本步只闭合其 HLS 子路径。
- fixtures/tests: `hls.active-task-tab-cancel` 覆盖只中止匹配 tab 并等待 settlement；扩展 `hls.session-owner-dispose` 锁定 active task 完成前不得删除 retry/live workdir；`output.ffmpeg-cancel-exit` 覆盖 AbortSignal 到进程树终止与 partial output 删除；`output.ffmpeg-process-cleanup` 覆盖非零退出清理。
- accepted difference: Cat Catch 由扩展 downloader tab/unload 管理任务；OmniFlow 让专用 HLS owner 持有 `AbortController + settled Promise`，不实现通用 scheduler、持久化任务中心或第二份 renderer 状态。
- excluded changes and reasons: 不在本步迁移 ffmpeg path probe、resource merge/transcode、MPD merge，也不修改其他 Agent 正在接入的应用 graceful-shutdown 代码。
- unresolved gaps: controller/view lifecycle production integration test、应用退出 await controller dispose、ffmpeg path probe 取消、真实 ffmpeg/ffprobe output、一次性 cache fallback、完整 parser 与 decrypt responsibility。
- runtime changes: HLS direct manifest、track merge、local plan、failed-fragment retry 和 live export 都注册 active task；navigation、tab/view destroy、render-process loss、discard 和 controller dispose 会先 abort/await active task，再清理 retry/live/workdir。manifest 与 track ffmpeg 入口共享一个有界 TERM/KILL runner，取消和非零退出会删除 partial output。
- legacy cleanup: 新增 `hls-session-owner.ts#activeTasks` 的 `omniflow-integration / retain-or-adapt` 事实；6 个现有 ffmpeg 入口仍保留 `remove-after-cutover`，没有提前删除旧 output owner。
- validation: 完整 HLS Vitest 29/29、仓库级 lint、TypeScript、`cat-catch:validate`、同步校验 16/16 和 scoped diff check 通过；本切片未重复运行紧邻上一提交已完成的全量 Vitest，完整 build 仍未运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`。

## 2026-08-27: same target (real HLS container output)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本步只补真实二进制输出证据，仍未完成 hls-engine 或 output-integration cutover。
- change groups: `verification`（生产 manifest ffmpeg wrapper 的真实容器与音轨交付检查）。
- affected capability IDs: `hls.segment-pipeline` 保持 `porting`；`output.ffmpeg-process-owner` 保持 `pending`，本步只补其 HLS 子路径证据。
- fixtures/tests: `embeddedBrowserHlsRealOutput.test.ts#hls.real-ffmpeg-ffprobe-output` 运行时生成 0.5 秒 AAC HLS，调用生产 wrapper，并用 ffprobe 断言输出为非空 MP4、包含 AAC 音轨且时长为正；本机缺少 ffmpeg/ffprobe 时明确 skip。
- accepted difference: 测试不提交二进制 fixture；使用本机已解析的桌面媒体二进制生成临时输入，测试结束删除全部临时文件。
- excluded changes and reasons: 不在本步覆盖视频、加密 HLS、应用退出等待、一次性 cache fallback、完整 parser 或生产 decrypt 接入。
- unresolved gaps: production lifecycle integration、awaited app-exit cleanup、视频/加密 output、一次性 cache fallback、完整 parser 与 decrypt responsibility。
- runtime changes: 无；只为现有生产 ffmpeg wrapper 增加真实二进制 integration 证据。
- legacy cleanup: 无；旧 output 路径继续保留到 cutover 证据完整。
- validation: 真实输出测试 1/1、完整 HLS Vitest 30/30、仓库级 lint、TypeScript、`cat-catch:validate`、同步校验 16/16 和 scoped diff check 通过；完整 build 未运行，避免覆盖其他 Agent 正在修改的 `dist-electron/**`。

## 2026-08-27: same target (production HLS host lifecycle)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本步闭合 HLS 宿主生命周期和应用退出等待，仍未完成 hls-engine cutover。
- change groups: `platform-adaptation`（Electron view/controller/app 生命周期到 main-only HLS owner）。
- affected capability IDs: `hls.segment-pipeline`、`hls.live-recording` 保持 `porting`；`output.ffmpeg-process-owner` 保持 `pending`，因为非 HLS 的 4 个 ffmpeg 入口仍未统一。
- fixtures/tests: `hls.live-tab-close-exit` 逐项覆盖 navigation、tab close、view destroyed 和 render-process-gone 到 active task AbortSignal；owner disposal 测试补充“先前事件已取走的 live session cleanup 仍必须被退出等待”。
- accepted difference: Cat Catch 由扩展 tab/downloader unload 管理；OmniFlow 使用 controller-owned host lifecycle，并让 close/close-all IPC 与 graceful shutdown 返回/等待异步清理，不增加 renderer task owner。
- excluded changes and reasons: 不在本步创建应用级通用 task registry，也不迁移 MPD、resource merge/transcode、ffmpeg probe 或旧 toolkit。
- unresolved gaps: 一次性 manifest cache fallback、直拉/track authority、完整 parser、生产 decrypt、renderer listener recovery 和非 HLS ffmpeg owner。
- runtime changes: HLS owner 新增统一 clear 与在途 session cleanup 跟踪；生产 navigation、tab close、view destroyed、render-process-gone 和 controller dispose 统一进入 host lifecycle；main graceful shutdown 显式 await controller dispose。
- legacy cleanup: 无；旧 HLS dispatch/downloader/recorder 仍保留到 cutover 证据完整。
- validation: 定向 HLS/shutdown Vitest 37/37、仓库级 lint、TypeScript、`cat-catch:validate`、同步校验 16/16 和 scoped diff check 通过；完整 build 未运行，避免覆盖其他 Agent 正在修改的 `dist-electron/**`。

## 2026-08-27: same target (one-shot HLS manifest cache fallback)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本步完成 cache/disguised-fragment 能力的代码证据，但 hls-engine unit 仍未 cutover。
- change groups: `behavioral`（首次 HLS manifest HTTP 失败后同 URL `force-cache` 一次）与 `platform-adaptation`（opaque authority / Electron Session fetch）。
- affected capability IDs: `hls.cache-fallback-disguised-fragments` 从 `porting` 进入 `ported-unverified`；`hls.live-recording` 保持 `porting`。
- fixtures/tests: `hls.manifest-force-cache-fallback` 覆盖 captured inspection 的 403 -> force-cache 200、main-owned header 保留、cached failure 不循环、response-less network error 与 MPD 不回退；`hls.live-manifest-force-cache-fallback` 覆盖只有 live 初次 manifest 请求回退，分片请求不携带 cache mode。
- accepted difference: Cat Catch 通过 content script 使用页面缓存；OmniFlow 通过 captured tab 的 Electron Session 与 main-owned authority 请求相同资源，不把 URL、headers 或 cache policy 交给 renderer。
- excluded changes and reasons: 不拦截 ffmpeg 内部的网络直拉，也不对 MPD、分片、后续 live poll 或无响应网络异常增加重试。
- unresolved gaps: 真实网站手工验证、直拉/track authority、完整 parser、生产 decrypt、renderer listener recovery 和非 HLS ffmpeg owner。
- runtime changes: 新增固定语义的 HLS cache fallback port；captured-resource access 可接收 main-only cache mode；inspection 自动识别 HLS，live recorder 只在 initial poll 启用一次，fallback 失败保留原 HTTP 结果。
- legacy cleanup: 无；旧 HLS dispatch/downloader/recorder 仍保留到 cutover 证据完整。
- validation: 完整相关 HLS/inspection Vitest 42/42、access redirect Vitest 3/3（允许 loopback 的环境）、TypeScript、scoped ESLint、`cat-catch:validate`、同步校验 16/16、台账计数和 scoped diff check 通过。最终全仓 lint 仅被其他 Agent 正在编辑的 `agent-orchestrator.test.ts` 两个未使用参数阻断，本切片实现完成后曾通过全仓 lint；完整 build 不运行，避免覆盖其他 Agent 正在修改的 `dist-electron/**`。

## 2026-08-27: same target (HLS direct/track opaque authority)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本步只收口 HLS direct/track 的跨进程资源权限，仍未完成 hls-engine cutover。
- change groups: `security-boundary`（renderer URL/header 不再进入 HLS direct/track 执行输入）与 `platform-adaptation`（两个 ffmpeg input 独立兑换 main-owned authority）。
- affected capability IDs: `hls.segment-pipeline` 保持 `porting`；能力状态仍为 9 `ported-unverified`、5 `porting`、18 `pending`，7 个 unit 均未 cutover。
- fixtures/tests: `hls.direct-manifest-authority` 覆盖恶意 renderer URL/header 无法覆盖 main 兑换结果、cross-tab 和导航后 stale 拒绝；`hls.track-independent-authority` 覆盖 video/audio 独立 URL/header grant 且任一缺失即拒绝；`hls.renderer-exact-manifest-authority` 与 `hls.renderer-requires-both-track-authorities` 覆盖当前 active snapshot 的精确 URL→ID 映射；`hls.track-input-header-isolation` 锁定两个 ffmpeg input 不串用 headers。
- accepted difference: Cat Catch 扩展页可直接持有 URL/header；OmniFlow renderer 只提交 opaque resource id。所选 variant/rendition 尚未被当前页面实际捕捉时，当前明确提示先播放对应清晰度/音轨，而不是复用父 manifest 的 protected headers 或静默执行无权限直拉。
- excluded changes and reasons: 本步不改变 HLS live 的过渡 fallback、DASH 直拉、local-plan 未捕捉 URL 的 embedded-session fallback、完整 parser/decrypt 或非 HLS ffmpeg owner。
- unresolved gaps: HLS 完整 parser 标签差分、生产 decrypt responsibility、renderer listener recovery、HLS live 过渡 DTO、真实网站手工验证和最终 hls-engine cutover。
- runtime changes: direct HLS IPC/preload/renderer contract 只接受一个精确 `resourceId`；track contract 只接受 `videoResourceId / audioResourceId`。renderer 在发起动作前读取当前 safe snapshot，main 再按当前 tab/document owner 独立 redeem；cross-tab、过期或缺失 authority 在保存对话框/ffmpeg 前失败。track ffmpeg 参数分别绑定 video/audio headers。
- legacy cleanup: 无；旧 HLS parser/downloader/recorder 和过渡 live/DASH/toolkit 路径仍保留到对应 unit 证据完整，未新增双 owner 或 fallback。
- validation: 完整 HLS Vitest 47/47、全量 ESLint、TypeScript、`cat-catch:validate`、同步校验 16/16、固定 metadata 7 units/32 capabilities/192 anchors/106 cleanup entries/101 unique planned IDs/55 active refs，以及本切片 scoped diff check 通过。全量 Vitest 为 931 passed / 1 skipped / 16 loopback sandbox failures；4 个相关 loopback 文件在允许监听本机端口的环境复跑 20/20，通过后折算全部可执行测试为 947 passed / 1 skipped。`tools/cat-catch-sync/validate.test.mjs` 由 Node test runner 16/16 通过，被 Vitest 扫描时仅报告 no suite。完整 build 不运行，避免覆盖其他 Agent 正在修改的 `dist-electron/**`；全仓 diff check 也只被该生成文件既有尾随空格阻断。

## 2026-08-27: same target (LL-HLS complete-fragment parity)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本步补齐 LL-HLS PART 与完整下载分片的一个 parser/live 行为切片，仍未完成 hls-engine cutover。
- change groups: `behavioral`（PART 不再与随后完整 EXTINF 分片重复下载或计时）与 `verification`（连续 live snapshot 累计）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`；`hls.live-recording` 保持 `porting`。
- fixtures/tests: source-derived fixture `hls-low-latency-parts` 依据固定版 hls.js 的独立 `partList` 与 Cat Catch `parseTs(data.fragments)` 记录两个连续 LL-HLS media playlist；`hls.ll-parts-fragment-parity` 锁定 parser/download-plan 的完整分片、序号、时长和 `partCount=0`；`hls.live-ll-parts-cumulative-parity` 锁定第二轮只下载新完成的 EXTINF 分片，PART 与 PRELOAD-HINT 都不进入累计。
- accepted difference: 现有 OmniFlow DTO 暂时保留 `part` / `partCount` 兼容字段，但 Cat Catch 等价计划不把原始 PART tag 作为下载项或额外状态源，因此该路径固定为 `false` / `0`。
- excluded changes and reasons: 本步不实现独立 LL-HLS part 下载器，也不扩展 UI 展示原始 partList；固定 Cat Catch 下载路径本身不消费该列表。
- unresolved gaps: HLS 其余 parser 标签差分、生产 decrypt responsibility、renderer listener recovery、HLS live 过渡 DTO、真实网站手工验证和最终 hls-engine cutover。
- runtime changes: pure parser 显式跳过 `EXT-X-PART` 与 `EXT-X-PART-INF`；完整 `EXTINF` 分片保留连续 media sequence，计划时长和直播累计只由这些完整分片组成。
- legacy cleanup: 无；旧 HLS 链继续保留到 hls-engine 原子 cutover。
- validation: 完整 HLS Vitest 51/51（含真实 ffmpeg/ffprobe output）、定向 ESLint、`cat-catch:validate`（含固定上游源码）、同步校验 16/16、metadata 计数和 scoped diff check 通过。全量 Vitest 为 929 passed / 1 skipped / 20 failed：其中 16 条 sandbox-only loopback 失败在允许监听本机端口的环境复跑相关 4 文件 20/20 通过，折算后仍有并行内置 Agent 改动导致的 4 条失败；全局 TypeScript 与全仓 lint 同样只被 `electron/service/agent/**` 的在途修改阻断。完整 build 未运行，避免覆盖其他 Agent 正在修改的 `dist-electron/**`；暂无可用真实网站和手工测试场景。

## 2026-08-27: same target (production AES-128 output owner)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本步闭合 production AES-128 local-output 责任证据，仍未完成 hls-engine cutover。
- change groups: `verification`（真实加密 HLS 端到端输出）与 `platform-adaptation`（明确唯一 production decrypt owner）。
- affected capability IDs: `hls.segment-pipeline` 保持 `porting`。
- fixtures/tests: `embeddedBrowserHlsRealOutput.test.ts#hls.real-aes128-local-output` 运行时生成 AES-128 encrypted AAC HLS，经生产 parser/download-plan、本地 key/密文下载与 playlist 重写、可取消 ffmpeg wrapper，再由 ffprobe 断言 MP4/AAC/正时长；本机缺少 ffmpeg/ffprobe 时与既有真实输出测试一致地明确 skip。
- accepted difference: Cat Catch 在 JavaScript downloader 内解密；OmniFlow 保留纯 Web Crypto port 作为行为参考和 processor boundary，但生产本地主链只让同一个 ffmpeg owner 按重写 playlist 的 key/IV 解密并 remux，避免双解密和第二个任务 owner。
- excluded changes and reasons: 不把纯 `decryptHlsAes128` 强行接入 production processor chain；不在本步覆盖视频+AES、SAMPLE-AES/DRM 或非 HLS ffmpeg 入口。
- unresolved gaps: HLS 其余 parser 标签差分、renderer listener recovery、HLS live 过渡 DTO、视频+AES 真实输出、真实网站手工验证和最终 hls-engine cutover。
- runtime changes: 无；现有 production local downloader/ffmpeg 链直接通过真实 AES-128 输出证据，只补充责任注释和长期台账。
- legacy cleanup: 无；旧 HLS 链继续保留到 hls-engine 原子 cutover。
- validation: 完整 HLS Vitest 52/52（clear 与 AES-128 真实 ffmpeg/ffprobe output 均实际执行）、定向 ESLint、`cat-catch:validate`（含固定上游源码）、同步校验 16/16、metadata 7 units/32 capabilities/104 planned IDs/58 active refs 和 scoped diff check 通过。全局 TypeScript 与全仓 lint 仍只被其他 Agent 正在修改的 `electron/service/agent/**` 阻断；本片只有条件式 integration、注释和台账变化，未重复运行紧邻上一提交已完成的全量 Vitest。完整 build 未运行，避免覆盖其他 Agent 正在修改的 `dist-electron/**`；暂无可用真实网站和手工测试场景。

## 2026-08-27: same target (HLS EXT-X-DEFINE variable substitution)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本步补齐固定 hls.js 1.6.16 的变量替换切片，仍未完成 hls-engine cutover。
- change groups: `behavioral`（定义、查询参数、导入、单次引用替换与首错误语义）与 `dependency`（Cat Catch 固定 vendor `lib/hls.min.js` 的 parser 行为）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`。
- fixtures/tests: source-derived fixture `hls-variable-substitution` 覆盖 master `NAME/VALUE`、`QUERYPARAM`、variant/I-frame/rendition，media `IMPORT`、key/map/segment URI、quoted/hexadecimal attribute 与 URL query decode；`hls.variable-substitution` 锁定结果，附加测试锁定重复定义、缺失 query/import/reference、非 quoted 普通属性不替换和非递归单次替换。
- accepted difference: 固定 hls.js 在 playlist 上记录第一条 `playlistParsingError`，evented loader 随后拒绝；同步 OmniFlow facade 没有 loader event 边界，因此抛出相同第一条错误。
- excluded changes and reasons: 本步不把 renderer variable list 作为可信执行输入传给 main，也不顺带建设新的 live/task IPC；生产直播 child 需要后续从 main-owned master authority 派生 parent variable list。
- unresolved gaps: live child `IMPORT` 的 main-owned parent variable 恢复、HLS 其余 parser 标签差分、renderer listener recovery、HLS live 过渡 DTO、真实网站手工验证和最终 hls-engine cutover。
- runtime changes: pure parser 新增 variable list，并只在显式 `IMPORT` 时把 parent variable 引入 media playlist；renderer compatibility facade 与手动 key 的 master→media 本地计划 resolver 传递该列表。没有新增 listener、任务 owner 或 fallback。
- legacy cleanup: 无；旧 HLS 链继续保留到 hls-engine 原子 cutover。
- validation: 失败证据先为 parser `2/6` 失败，实现与 review 修正后 parser 7/7、完整 HLS Vitest 54/54（clear 与 AES-128 真实 ffmpeg/ffprobe output 均实际执行）、固定上游 validator、同步校验 16/16、定向 ESLint、metadata 7 units/32 capabilities/105 planned IDs/59 active refs 和 scoped diff check 通过。全量 Vitest 为 943 passed / 1 skipped / 16 sandbox-only loopback failures，另有同步 validator 的 `node:test` 文件被 Vitest 收集后报告 no suite；全仓 lint 只被其他 Agent 正在编辑的 `agent-orchestrator.ts` 一个 `prefer-const` 阻断，全局 TypeScript 也只被该并行模块 5 个错误阻断。完整 build 不运行，避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-27: same target (live HLS master variable authority)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本步闭合 selected live child 的 `EXT-X-DEFINE:IMPORT` production adapter，仍未完成 hls-engine cutover。
- change groups: `platform-adaptation`（captured master authority 到 parent variable list）与 `stability/security-boundary`（child 归属校验、renderer 不提供变量、resolver 取消传播）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`；`hls.live-recording` 保持 `porting`。
- fixtures/tests: 扩展 `hls-variable-substitution` fixture 的 live media playlist；`hls.live-parent-variable-authority` 验证 master protected headers、变量派生、hostile child 拒绝与同资源短路；`hls.live-import-variable-recording` 验证 recorder 下载替换后的分片 URL；`hls.live-parent-variable-abort` 验证 discard 中止在途 resolver。
- accepted difference: Cat Catch 的 hls.js loader 在内存中把 multivariant variable list 传给 level parser；OmniFlow 直播由 main 使用原始 opaque captured resource id 重新读取 master，只在 child 明确 `IMPORT` 时派生，并校验 selected child 属于该 master。renderer 不传变量值或 protected headers。
- excluded changes and reasons: 不新增 IPC 字段、renderer task owner 或通用 manifest cache；没有 `IMPORT` 的直播 child 不额外请求 master。
- unresolved gaps: HLS 其余 parser 标签差分、renderer listener recovery、HLS live 未捕获 URL 过渡 DTO、真实网站手工验证和最终 hls-engine cutover。
- runtime changes: `hls-manifest-authority` 新增可取消的 parent variable resolver；live recorder 延迟调用并缓存结果，后续 manifest poll 复用同一 parent list；controller 只绑定 main-owned access、source resource id、selected URL 和既有 recorder signal。
- legacy cleanup: 无；旧 HLS 链继续保留到 hls-engine 原子 cutover。
- validation: 两层失败证据分别为 authority `1/3` 与 recorder `1/5` 失败；实现和 review 修正后 authority/recorder/lifecycle 20/20、完整 HLS Vitest 57/57、TypeScript、全仓 ESLint、固定上游 validator、同步校验 16/16、metadata 7 units/32 capabilities/192 anchors/106 cleanup entries/108 unique planned IDs/62 active refs 和 scoped diff check 通过。全量 Vitest 为 951 passed / 1 skipped / 17 failed：16 条为 sandbox-only loopback 监听失败，其中本切片相关 redirect isolation 在允许监听本机端口的环境复跑 3/3 通过；另 1 条为其他 Agent 正在修改的 `agent-orchestrator.test.ts` 断言失败，Node 专用同步 validator 文件被 Vitest 收集后另报告 no suite。完整 build 不运行以避免覆盖其他 Agent 的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-27: same target (empty HLS media rejection)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本步补齐固定 hls.js 的空 media loader 拒绝语义，仍未完成 hls-engine cutover。
- change groups: `behavioral`（没有完整 fragment 的 media playlist 不进入 Cat Catch `LEVEL_LOADED -> parseTs`）与 `verification`（固定 vendor executable oracle）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`。
- fixtures/tests: 新增 upstream-executable fixture `hls-empty-media-playlist`；`hls.empty-media-rejection` 覆盖普通空 playlist 与只有 LL-HLS PART、没有完整 EXTINF fragment 的 playlist。
- accepted difference: 固定 hls.js 先发 `MANIFEST_LOADED`，随后发 `levelEmptyError / No Segments found in Playlist`；同步 OmniFlow facade 没有 evented loader 边界，因此在创建 download plan 前抛出同一错误。
- excluded changes and reasons: 不把 master playlist 自身没有媒体分片视为错误；本步不迁移其他 loader event、renderer listener recovery 或 live 过渡 DTO。
- unresolved gaps: HLS 其余 parser 标签差分、renderer listener recovery、HLS live 未捕获 URL 过渡 DTO、真实网站手工验证和最终 hls-engine cutover。
- runtime changes: `parseHlsManifest` 在 variable parsing error 之后拒绝 `variants.length === 0 && segments.length === 0`；master variant 解析和既有第一错误优先级不变。
- legacy cleanup: 无；旧 HLS 链继续保留到 hls-engine 原子 cutover。
- validation: 固定 vendor 对两个输入均执行得到 `levelEmptyError / No Segments found in Playlist`；失败证据为 parser 7/8，实现后 parser 8/8、完整 HLS Vitest 58/58、TypeScript、全仓 ESLint、固定上游 validator、同步校验 16/16、metadata 7 units/32 capabilities/192 anchors/106 cleanup entries/109 unique planned IDs/63 active refs 和 scoped diff check 通过。全量 Vitest 为 958 passed / 1 skipped / 16 sandbox-only loopback failures，Node 专用同步 validator 文件被 Vitest 收集后另报告 no suite；本切片不涉及 loopback。完整 build 不运行以避免覆盖其他 Agent 的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-27: same target (HLS renderer task recovery)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本步闭合 HLS renderer listener 重挂恢复，仍未完成 hls-engine cutover。
- change groups: `platform-adaptation`（main-owned 有界任务投影与只读 snapshot IPC）和 `lifecycle/state-ownership`（单调 revision、subscribe-before-snapshot、直播卸载时保持既有 discard 并补输出目录清理）。
- affected capability IDs: `hls.segment-pipeline` 与 `hls.live-recording` 保持 `porting`。
- fixtures/tests: `hls.renderer-task-listener-recovery` 覆盖旧 snapshot 不覆盖更新实时事件以及普通任务重挂恢复终态；`hls.live-unmount-output-cleanup` 锁定直播卸载时 discard、等待 main 收口后清理冻结输出目录，并拒绝重挂组件接管清理期间短暂残留的 live snapshot；`hls.renderer-task-snapshot-ipc` 锁定只读 IPC 委托；owner 测试覆盖事件合并、同 request ID 跨 tab 隔离、navigation/tab close/view destroyed/render-process-gone 清理和最多 32 条投影上限。
- accepted difference: Cat Catch 的 extension downloader page 自身承载任务 UI；OmniFlow 的 renderer 工具组件可以卸载，因此 main 保留当前宿主生命周期内的最新安全投影，并通过 revision 恢复普通任务 UI。它不持久化任务、凭据或完整日志，也不产生 renderer task owner；直播的资料库交付目标仍是 feature-scoped closure，所以在 application workflow coordinator 落地前继续随工具卸载 discard。
- excluded changes and reasons: 不建设通用 task registry，不扩张到 MPD、其他 ffmpeg 或 application output coordinator；后者仍属于 output-integration unit，不能用仅恢复 UI 投影替代。不改变 HLS parser/downloader 行为，不进行 cutover 或删除旧链。
- unresolved gaps: HLS 其余 parser 标签差分、live 未捕获 URL 过渡 DTO、视频+AES 真实组合、真实网站手工验证和最终 hls-engine cutover。
- runtime changes: `EmbeddedBrowserHlsSessionOwner` 在 emit 前合并每个 tab/request 的最新安全投影并分配全局单调 revision，最多保留 32 条；navigation/tab/view/controller 生命周期与 dispose 清理投影。preload 暴露只读 snapshot，renderer 先订阅事件再读取当前 tab，并只接受当前 manifest/variant/rendition 且 revision 更新的结果；切换另一 HLS request 或卸载工具组件仍 discard 上一 live session，且 discard 收口后清理对应输出目录。
- legacy cleanup: 无；旧 HLS 执行链继续保留到 hls-engine 原子 cutover。
- validation: 失败证据为 owner 11/17 通过且 6 条投影/生命周期测试失败、renderer selector 模块缺失；实现、测试环境与输出交付边界修正后新增 owner/selector/hook/IPC 定向测试 24/24、完整 HLS Vitest 73/73（clear 与 AES-128 真实 ffmpeg/ffprobe output 均实际执行）、TypeScript、全仓 ESLint、固定上游 validator、同步校验 16/16、metadata 7 units/32 capabilities/192 anchors/106 cleanup entries/112 unique planned IDs/66 active refs 和 scoped diff check 通过。全量 Vitest 为 974 passed / 1 skipped / 16 sandbox-only loopback failures，Node 专用同步 validator 文件被 Vitest 收集后另报告 no suite；完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-27: same target (HLS media playlist structure rejection)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本步补齐固定 hls.js 的媒体清单结构拒绝语义，仍未完成 hls-engine cutover。
- change groups: `behavioral`（结构无效的 media playlist 不进入 Cat Catch `LEVEL_LOADED -> parseTs`）与 `verification`（固定 vendor executable oracle）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`。
- fixtures/tests: 新增 upstream-executable fixture `hls-media-playlist-structure-errors`；`hls.media-playlist-structure-rejection` 覆盖缺少 `#EXTM3U`、缺少 `TARGETDURATION`、重复 `TARGETDURATION` / `PLAYLIST-TYPE`，以及首个 fragment 后的 `MEDIA-SEQUENCE` / `DISCONTINUITY-SEQUENCE`。正向测试同时锁定整数 `TARGETDURATION` 的最小值 1 和大写 `PLAYLIST-TYPE`。
- accepted difference: 固定 hls.js 通过 `levelParsingError` 报告 reason 并阻止 `LEVEL_LOADED`；同步 OmniFlow facade 没有 evented loader 边界，因此在创建下载计划前直接抛出相同 reason。变量错误用例补齐合法 `TARGETDURATION`，避免被固定 hls.js 更晚的 `Missing Target Duration` 覆盖而形成假 oracle。
- excluded changes and reasons: 不在本步迁移 `PROGRAM-DATE-TIME`、`GAP`、`DATERANGE`、`SKIP`、session key、未知 codec 过滤或其余 master/loader event；不进行 cutover 或删除旧链。
- unresolved gaps: HLS 其余 parser 标签和 key 支持差分、live 未捕获 URL 过渡 DTO、视频+AES 真实组合、真实网站手工验证和最终 hls-engine cutover。
- runtime changes: `parseHlsManifest` 在生成计划前复刻固定 hls.js 的格式头、目标时长、单例标签和标签顺序校验；结构错误沿用 hls.js 的后写覆盖顺序，变量替换错误继续只保留第一条。媒体整数标签改用 `parseInt` 语义，目标时长最小为 1，playlist type 归一为大写。
- legacy cleanup: 无；旧 HLS 执行链继续保留到 hls-engine 原子 cutover。
- validation: 固定 vendor 对 6 个输入均实际执行并得到对应 `levelParsingError`，失败证据为 parser 8/9；实现与 review 后 parser 10/10、完整 HLS Vitest 73/73、全仓 ESLint、固定上游 validator、同步校验 16/16、metadata 7 units/32 capabilities/192 anchors/106 cleanup entries/113 unique planned IDs/67 active refs 和 scoped diff check 通过。全局 TypeScript 被其他 Agent 在途的 PowerShell/Agent 测试类型错误阻断；全量 Vitest 为 1000 passed / 1 skipped / 27 failed，其中 16 条是 sandbox-only loopback 监听失败，另 11 条来自其他 Agent 在途的 Shell Provider / orchestrator 改动，Node 专用同步 validator 文件被 Vitest 收集后另报告 no suite。完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-27: same target (HLS BYTERANGE previous-segment semantics)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本步修正固定 hls.js 的媒体分片与 MAP 两套 BYTERANGE 前序语义，仍未完成 hls-engine cutover。
- change groups: `behavioral`（媒体分片继承紧邻 previous fragment，MAP 独立解析）与 `verification`（固定 vendor executable oracle）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`。
- fixtures/tests: 扩展 `hls-byterange-implicit-offset`，锁定媒体分片即使 URI 切换仍继承紧邻前一 fragment 的 range end；新增 upstream-executable fixture `hls-map-byterange-independent`，锁定同 URI MAP 省略 offset 时从 `0` 开始。
- accepted difference: 无；两类结果均直接对齐固定 hls.js 1.6.16。
- excluded changes and reasons: 不扩展到 HLS 其余 parser 标签、loader event、live 过渡 DTO；不进行 cutover 或删除旧链。
- unresolved gaps: HLS 其余 parser 与 key 支持差分、live 未捕获 URL 过渡 DTO、视频+AES 真实组合、真实网站手工验证和最终 hls-engine cutover。
- runtime changes: 删除按资源 URL 维护的通用 range-end map；媒体分片只继承紧邻前一条带 range 的 fragment end，紧邻无 range 分片会重置；每条 `EXT-X-MAP` 不接收 previous fragment，省略 offset 时独立取 `0`。
- legacy cleanup: 无；旧 HLS 执行链继续保留到 hls-engine 原子 cutover。
- validation: 固定 vendor executable oracle 分别得到跨 URI media `10@100 -> 10@110` 与同 URI MAP `10@100 -> 10@0`；失败证据为 parser 9/11，实现后 parser 11/11、完整 HLS Vitest 74/74；本次收尾复跑 pure HLS port 16/16、固定上游 validator、同步校验 16/16、metadata 7 units/32 capabilities/192 anchors/106 cleanup entries/114 unique planned IDs/68 active refs 和 scoped diff check 均通过。未复跑全仓 Vitest、ESLint、TypeScript 或 build；并行 Agent 的在途改动仍会影响全仓结果，且 build 会覆盖其 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-27: same target (HLS AES-128 effective IV and playlist rotation)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本步闭合 AES-128 fragment effective IV 与本地 rewritten playlist 的 IV 轮换语义，仍未完成 hls-engine cutover。
- change groups: `behavioral`（无显式 IV 时按 media sequence 派生 16-byte big-endian IV）与 `platform-adaptation`（key 资源去重和 playlist 加密状态使用不同 identity）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`；`hls.segment-pipeline` 保持 `porting`。
- fixtures/tests: 新增 upstream-executable fixture `hls-aes128-iv-semantics`；`hls.aes128-effective-iv` 锁定 sequence 7/8 的派生 IV 和 sequence 9 的显式 IV；`hls.aes128-local-playlist-iv` 锁定同一 key URL 只下载一次 key bytes，但按三个有效 IV 重写三条 `EXT-X-KEY`；`hls.real-aes128-local-output` 扩展为显式 IV 与非零 media sequence 隐式 IV 两种真实 ffmpeg/ffprobe 输出。
- accepted difference: Cat Catch 在 JavaScript downloader 内按 fragment decryptdata 解密；OmniFlow 继续把有效 IV 固化进 fragment DTO 和本地 playlist，并由唯一可取消 ffmpeg owner 解密/remux，不增加第二轮 JavaScript production decrypt。
- excluded changes and reasons: 不在本步扩展 SAMPLE-AES/DRM、KEYFORMATVERSIONS、session key、delta playlist、视频加密组合、live 过渡 DTO 或其他 parser 标签；不进行 cutover 或删除旧链。
- unresolved gaps: HLS 其余 parser/key 标签差分、live 未捕获 URL 过渡 DTO、视频+AES 真实组合、真实网站手工验证和最终 hls-engine cutover。
- runtime changes: pure parser 为缺省 IV 的 AES-128 fragment 克隆 key DTO 并写入 sequence-derived IV；本地 downloader 继续用 method/URL/manual key identity 去重 key 文件，但用 method/local key ref/IV/KEYFORMAT identity 判断是否重发 `EXT-X-KEY`，避免相同 key URL 吞掉 IV 轮换。
- legacy cleanup: 无；旧 HLS 执行链继续保留到 hls-engine 原子 cutover。
- validation: 固定 vendor 对同一 fixture 实际输出 sequence 7/8/9 对应 `IV 07/08/2a`；失败证据为 parser/local downloader 合计 16/18 且两条预期差分失败，实现后 18/18、完整 HLS Vitest 75/75（clear、显式 IV AES-128、隐式 IV AES-128 的真实 ffmpeg/ffprobe output 均实际执行）、全仓 ESLint、固定上游 validator、同步校验 16/16、metadata 7 units/32 capabilities/192 anchors/106 cleanup entries/116 unique planned IDs/70 active refs 和 scoped diff check 通过。全局 TypeScript 仅被其他 Agent 在途的 Shell Provider / Agent prepared-action 测试类型错误阻断；全量 Vitest 为 1030 passed / 1 skipped / 22 failed，其中 16 条是 sandbox-only loopback 监听失败，另 5 条来自 Shell Provider registry、1 条来自 Agent orchestrator，Node 专用同步 validator 被 Vitest 收集后另报告 no suite。完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-27: same target (encrypted HLS map key context)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本步闭合 AES-128 `EXT-X-MAP` 声明时的独立 key/IV context，仍未完成 hls-engine cutover。
- change groups: `behavioral`（MAP 捕获声明时 key，缺省 IV 使用 sequence zero）与 `platform-adaptation`（本地 playlist 按播放状态重放 MAP/media key）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`；`hls.segment-pipeline` 保持 `porting`。
- fixtures/tests: 新增 upstream-executable fixture `hls-encrypted-map-key-context`；`hls.encrypted-map-key-context` 锁定 MAP 使用 `map.key/IV=0`、media sequence 7/8 使用 `media.key/IV=7/8`；`hls.encrypted-map-local-playlist-key-order` 锁定 `MAP key -> EXT-X-MAP -> media key -> EXTINF`，且 key/map 文件仍按资源去重。
- accepted difference: Cat Catch 由固定 hls.js fragment/initSegment decryptdata 保留上述上下文；OmniFlow 将等价状态固化进 DTO 和本地 playlist，仍由唯一 ffmpeg owner 解密/remux。
- excluded changes and reasons: 固定 Cat Catch 对 `EXT-X-SKIP` 的原始 fragments 可含 `null` 占位，而其 `parseTs` 未处理；本步不自创 delta playlist 行为，也不扩展 SAMPLE-AES/DRM、session key、视频加密组合或其他 parser 标签。
- unresolved gaps: HLS 其余 parser/key 标签差分、live 未捕获 URL 过渡 DTO、加密 fMP4/video 真实输出组合、真实网站手工验证和最终 hls-engine cutover。
- runtime changes: pure parser 在创建 MAP 时克隆当时的 key，并为缺省 IV 的 AES-128 MAP 固化 zero IV；download plan 与本地 downloader 传递 MAP key，在 MAP 与 media 状态切换处输出对应 `EXT-X-KEY`。
- legacy cleanup: 无；旧 HLS 执行链继续保留到 hls-engine 原子 cutover。
- validation: 固定 hls.js oracle 输出 MAP `map.key/IV=0` 与 media sequence 7/8 的 `media.key/IV=7/8`；失败证据为 parser/local downloader 合计 18/20，实现后 20/20，完整 HLS Vitest 77/77、定向 ESLint、metadata 7 units/32 capabilities/192 anchors/106 cleanup entries/118 unique planned IDs/72 active refs 和 scoped diff check 通过。全局 TypeScript 仅被其他 Agent 的 `agent-orchestrator.test.ts` prepared-action 类型错误阻断；完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-27: same target (HLS master variant filtering)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本步闭合固定 hls.js master 普通 level/I-frame/混合未知 codec 的选择边界，仍未完成 hls-engine cutover。
- change groups: `behavioral`（I-frame 不进入 Cat Catch 可选 `data.levels`、混合未知 codec level 过滤、无普通 level 拒绝）与 `dependency`（固定 hls.js 1.6.16 codec prefix 表）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`；新增 2 个 active test ID。
- fixtures/tests: 新增 upstream-executable fixture `hls-master-variant-filtering`；`hls.master-variant-filtering` 锁定普通已知 codec level 与 audio rendition，并排除混入的未知 codec 和 I-frame URL；`hls.master-no-levels-rejection` 锁定 I-frame-only master 的 `manifestParsingError / no levels found in manifest`；既有变量 fixture 修正为不再把 I-frame URI 当普通 variant。
- accepted difference: 固定 hls.js 在所有普通 level 都只有未知 codec 时会在后续 browser MediaSource 兼容阶段拒绝；OmniFlow pure parser 保留这些普通 level 给 ffmpeg execution boundary 尝试，不把 renderer codec 支持当作 main 执行权限。
- excluded changes and reasons: 不在本步迁移 `SESSION-KEY`、content steering、daterange/program-date-time、delta playlist 或浏览器 MSE codec selection；它们属于独立 parser/runtime 行为，不能混入 master level 列表修正。
- unresolved gaps: HLS 其余 master/media parser 标签与 key 差分、live 未捕获 URL 过渡 DTO、加密 fMP4/video 真实输出组合、真实网站手工验证和最终 hls-engine cutover。
- runtime changes: pure parser 只从 `EXT-X-STREAM-INF` 生成普通 variant，使用固定 1.6.16 codec prefix 表执行 parse-time 混合过滤，并在非 media playlist 没有普通 level 时抛固定错误；renderer facade 与后续 variant 选择自动继承该结果，没有新增状态 owner 或 IPC。
- legacy cleanup: 无；旧 HLS 执行链继续保留到 hls-engine 原子 cutover。
- validation: 固定 `lib/hls.min.js@1.6.16` oracle 对混合 fixture 实际输出 1 个普通 level/1 个 audio track，对 I-frame-only fixture 输出 `manifestParsingError / no levels found in manifest`；失败证据为 parser 12/15 且 3 条预期差分失败，实现与边界测试后 parser 16/16、广义 HLS Vitest 80/80、全仓 ESLint、固定上游 validator、同步校验 16/16、metadata 7 units/32 capabilities/192 anchors/106 cleanup entries/120 unique planned IDs/74 active refs 和 scoped diff check 通过。全局 TypeScript 仅被其他 Agent 在途的 Shell/Agent preparation 与 orchestrator test 类型错误阻断；完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (HLS key support and KEYFORMAT selection)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本步闭合固定 full EME hls.js 1.6.16 的 `EXT-X-KEY` 支持、忽略、继承与 decryptdata 选择边界，仍未完成 hls-engine cutover。
- change groups: `behavioral`（支持方法/KEYFORMAT、METHOD=NONE、identity 优先、单/多 DRM 选择、同格式轮换 copy-on-write、缺失 URI）与 `dependency`（固定 hls.js `LevelKey.isSupported`、`Fragment.decryptdata` 和 EME KeySystemFormats）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`；新增 1 个 active test ID。
- fixtures/tests: 新增 upstream-executable fixture `hls-key-support-boundary`；`hls.key-support-inheritance` 覆盖不支持与大小写无效方法不覆盖前值、identity SAMPLE-AES、任意 KEYFORMAT 的 full-segment AES、FairPlay/Widevine/PlayReady/ClearKey、缺失 URI、METHOD=NONE、不同 KEYFORMAT 共享继承、缺省/显式版本 `1` 的重复判定、同格式轮换复制、identity 优先以及多 non-identity 不臆选 decryptdata。
- accepted difference: 固定 hls.js effective decryptdata 将 identity 写成显式 `keyFormat="identity"`；现有 OmniFlow DTO 用缺省 `keyFormat` 表达同一 identity，避免 rewritten local playlist 无意义增加显式属性。OmniFlow 只保留 DRM key 解析结果，不声称绕过 DRM 或执行浏览器 EME license workflow。
- excluded changes and reasons: 本步不实现 DRM license/decrypt、SESSION-KEY、KEYID/PSSH 解析、KEYFORMATVERSIONS 选择、加密 fMP4/video 输出或其他 parser 标签；不进行 cutover 或删除旧链。
- unresolved gaps: HLS 其余 parser/key 标签差分、DRM 仅识别不下载、live 未捕获 URL 过渡 DTO、加密 fMP4/video 真实输出组合、真实网站手工验证和最终 hls-engine cutover。
- runtime changes: pure parser 以 KEYFORMAT map 保存当前 key 组；新增不同格式时共享既有组，同格式实际轮换时复制，解析结束后按 fragment/MAP 所持组选择 effective key。fragment DTO 新增 `encrypted`，从而在多个 non-identity key 尚待 key-system 选择、decryptdata 为空时仍保留上游状态。
- legacy cleanup: 无；旧 HLS 执行链继续保留到 hls-engine 原子 cutover。
- validation: 固定 vendor executable oracle 与 fixture 的 18 个 fragment 在 encrypted/method/KEYFORMAT/URI/IV 上逐项一致；失败证据为新增 fixture 下 parser 16/17，实现后 parser 17/17、广义 HLS Vitest 81/81、全仓 ESLint、固定上游 validator、同步校验 16/16、fixture JSON、metadata 7 units/32 capabilities/192 anchors/106 cleanup entries/121 unique planned IDs/75 active refs 和 scoped diff check 通过。全量 Vitest 为 1081 passed / 1 skipped / 16 sandbox-only loopback failures，4 个相关 loopback 文件在允许监听本机端口的环境复跑 20/20，通过后折算全部可执行测试为 1097 passed / 1 skipped；Node 专用同步 validator 被 Vitest 收集后另报告 no suite。全局 TypeScript 只被其他 Agent 在途的 Shell preparation 与 Agent orchestrator test 类型错误阻断；完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (HLS delta playlist rejection)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本步闭合固定 Cat Catch 下载路径对正数 `EXT-X-SKIP` delta playlist 的不可执行边界，仍未完成 hls-engine cutover。
- change groups: `behavioral`（正数 skipped fragment 不生成错误计划、非法/零值继续解析、重复 SKIP 第一结构错误优先）与 `stability`（把上游 null dereference 终态映射成稳定同步错误）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`；新增 1 个 active test ID。
- fixtures/tests: 新增 upstream-executable fixture `hls-delta-playlist-rejection`；`hls.delta-playlist-rejection` 覆盖正数 skip + 显式 fragment、只有 skipped placeholder、非法值、零值和重复正数标签。
- accepted difference: 固定 hls.js 在外部 `LEVEL_LOADED` 时暴露 `null` placeholders，Cat Catch `parseTs` 随后读取 `fragment.url` 抛 TypeError；同步 facade 没有 evented listener 边界，因此抛出稳定的 delta playlist 错误，但保持同一黑盒终态：不创建、不执行下载计划。
- excluded changes and reasons: 不实现 delta merge、`RECENTLY-REMOVED-DATERANGES`、SERVER-CONTROL reload directives、PROGRAM-DATE-TIME/DATERANGE 合并或前序 snapshot cache。Cat Catch 当前下载 listener 本身早于内部 merge，不能把 hls.js 播放控制器后续行为冒充成其下载能力。
- unresolved gaps: HLS 其余 parser/key 标签差分、真正有 previous snapshot 的 delta recording 仍未作为 OmniFlow 平台增强单独设计、DRM 仅识别不下载、live 未捕获 URL 过渡 DTO、加密 fMP4/video 真实输出组合、真实网站手工验证和最终 hls-engine cutover。
- runtime changes: pure parser 记录有限正数 `SKIPPED-SEGMENTS`，先保留已有 playlist parsing error 优先级，再在 plan materialization 前拒绝；非法/零值不改变 sequence，重复正数 tag 继续走固定多标签错误。
- legacy cleanup: 无；旧 HLS 执行链继续保留到 hls-engine 原子 cutover。
- validation: 固定 vendor executable oracle 实际输出 `startSN=4 / skippedSegments=2 / fragments=[null,null,sn6,sn7]`，静态 Cat Catch `parseTs` 证实首个 `.url` 读取；失败证据为 parser 17/18，实现后 parser 18/18、广义 HLS Vitest 82/82、定向 ESLint、fixture 检查、`cat-catch:validate`、同步校验 16/16、metadata 7 units/32 capabilities/192 anchors/106 cleanup entries/122 unique planned IDs/76 active refs 和 scoped diff check 通过。为快速收尾未重复运行全仓 Vitest、ESLint、TypeScript 或会覆盖其他 Agent `dist-electron/**` 的 build，暂无真实网站手工场景。

## 2026-08-28: same target (HLS media singleton tag rejection)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本步闭合固定 hls.js 1.6.16 media singleton 标签阻止 Cat Catch 下载 listener 执行的结构边界，仍未完成 hls-engine cutover。
- change groups: `behavioral`（重复 `VERSION`、`ENDLIST`、`SERVER-CONTROL` 和有效 `PART-INF` 拒绝）与 `stability`（把 evented loader 错误映射为稳定同步错误）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`；新增 1 个 active test ID。
- fixtures/tests: 新增 upstream-executable fixture `hls-media-playlist-singleton-tags`；`hls.media-playlist-singleton-tag-rejection` 覆盖四类重复错误、四类 singleton 同时单次出现，以及 invalid VERSION 和 zero PART-TARGET 后接有效标签的接受边界。
- accepted difference: 固定 hls.js 通过 `levelParsingError` 阻止 `LEVEL_LOADED`；同步 facade 在计划创建前抛相同 reason，不复制 loader event 状态机。只服务播放 reload 的 SERVER-CONTROL/PART-INF/VERSION 数值不扩展进下载 DTO。
- excluded changes and reasons: 不实现 SERVER-CONTROL reload、RENDITION-REPORT、PRELOAD-HINT、PROGRAM-DATE-TIME/DATERANGE 或 LL-HLS PART 下载；它们不改变 Cat Catch `parseTs(data.details.fragments)` 的当前下载列表。
- unresolved gaps: HLS 其余 parser 标签差分、真正有 previous snapshot 的 delta recording、DRM 仅识别不下载、live 未捕获 URL 过渡 DTO、加密 fMP4/video 真实输出组合、真实网站手工验证和最终 hls-engine cutover。
- runtime changes: pure parser 保留 VERSION 是否已解析、ENDLIST live 状态、SERVER-CONTROL 是否出现及 truthy PART-TARGET 四个最小状态，仅用于复刻重复标签错误优先级；`PART-TARGET=0` 或非法值保持上游的非重复边界。
- legacy cleanup: 无；旧 HLS 执行链继续保留到 hls-engine 原子 cutover。
- validation: 固定 vendor executable oracle 对四类重复输入分别输出对应 `levelParsingError` reason，并对三类允许输入进入 `LEVEL_LOADED`；失败证据为 parser 18/19，实现与前缀顺序 review 后 parser 19/19、广义 HLS/inspection/projection Vitest 84/84、全仓 ESLint、`cat-catch:validate`、同步校验 16/16、fixture JSON、metadata 7 units/32 capabilities/192 anchors/106 cleanup entries/123 unique planned IDs/77 active refs 和 scoped diff check 通过。全量 Vitest 为 1089 passed / 1 skipped / 16 sandbox-only loopback failures，4 个相关 loopback 文件在允许监听本机端口的环境复跑 20/20，通过后折算全部可执行测试为 1105 passed / 1 skipped；Node 专用同步 validator 被 Vitest 收集后另报告 no suite。全局 TypeScript 只被其他 Agent 在途的 Shell preparation 与 Agent orchestrator test 类型错误阻断；完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (HLS master rendition projection)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本步闭合固定 hls.js 1.6.16 到 Cat Catch `MANIFEST_PARSED` 的 audio/subtitle rendition 投影，并约束 captured master child authority，仍未完成 hls-engine cutover。
- change groups: `behavioral`（AUDIO/SUBTITLES 过滤与字段默认值）和 `security`（非下载 rendition URL 不获得 parent authority）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`；新增 2 个 active test ID。
- fixtures/tests: 新增 upstream-executable fixture `hls-master-rendition-projection`；`hls.master-rendition-projection` 覆盖有效 AUDIO/SUBTITLES、embedded audio 空 URL、NAME 回退 LANGUAGE、boolean 默认值，以及 CLOSED-CAPTIONS/未知/缺失/小写 TYPE 排除；`hls.master-rendition-authority` 证明合法 AUDIO child 可通过而 captions URI 被拒绝。
- accepted difference: 无。DTO 的 `language` 对应上游 track `lang`，其余被消费字段逐项相同。
- excluded changes and reasons: 不迁移 `data.captions`、音轨 codec 猜测、content steering clone 或播放 track controller；Cat Catch 当前下载 UI 只消费 `data.audioTracks` / `data.subtitleTracks`，OmniFlow child authority 也只应覆盖实际可选 manifest URL。
- unresolved gaps: HLS 其余 master/media parser 标签差分、内嵌 main audio 合成轨的产品取舍、真正有 previous snapshot 的 delta recording、live 未捕获 URL 过渡 DTO、加密 fMP4/video 真实输出组合、真实网站手工验证和最终 hls-engine cutover。
- runtime changes: pure parser 只投影大小写精确的 AUDIO/SUBTITLES rendition；合法无 URI 音轨保留 `url=""`，缺失 NAME 回退 LANGUAGE，缺失布尔字段归一为 false。live parent resolver 自动继承过滤结果，没有新增 authority 状态源。
- legacy cleanup: 无；旧 HLS 执行链继续保留到 hls-engine 原子 cutover。
- validation: 固定 vendor executable oracle 输出 2 条 AUDIO 与 1 条 SUBTITLES，排除 4 条其他 EXT-X-MEDIA；失败证据为 parser 19/20，实现后 parser 20/20、parser/authority 24/24、广义 HLS/inspection/projection Vitest 86/86、全仓 ESLint、TypeScript、`cat-catch:validate`、同步校验 16/16、fixture JSON、metadata 7 units/32 capabilities/192 anchors/106 cleanup entries/125 unique planned IDs/79 active refs 和 scoped diff check 通过。全量 Vitest 为 1091 passed / 1 skipped / 16 sandbox-only loopback failures，4 个相关 loopback 文件在允许监听本机端口的环境复跑 20/20，通过后折算全部可执行测试为 1107 passed / 1 skipped；Node 专用同步 validator 被 Vitest 收集后另报告 no suite。完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (HLS master session-key download boundary)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本步只闭合固定 hls.js 1.6.16 `EXT-X-SESSION-KEY` 到 Cat Catch 下载链的边界，仍未完成 hls-engine cutover。
- change groups: `behavioral`（master session-key attribute/变量解析错误）与 `explicit-exclusion`（默认关闭 EME 时不把 session key 传播成 fragment key）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`；新增 1 个 active test ID。
- fixtures/tests: 新增 upstream-executable fixture `hls-master-session-key-boundary`；`hls.master-session-key-exclusion` 覆盖 valid master session key 不进入 `manifest.keys`、media parser 忽略不属于该层的 session-key、clear child fragment 保持 `encrypted=false / key=null`，以及 master session-key 中前置缺失变量仍触发固定 parsing error。
- accepted difference: 无。同步 facade 抛出与固定 loader 相同的第一条变量 parsing reason；事件式 error 与同步 throw 的既有表示差异已记录在 `hls.parser-planner`。
- excluded changes and reasons: 不新增 session-key DTO、DRM preload、license/key-system 选择或 master-to-child key context。Cat Catch 下载页用默认 `emeEnabled=false` 创建 Hls，`MANIFEST_PARSED` 只读取 levels/audioTracks/subtitleTracks，`LEVEL_LOADED -> parseTs` 只读取 child fragments；这些 EME 能力不属于当前下载行为。
- unresolved gaps: HLS 其余 master/media parser 标签差分、真正有 previous snapshot 的 delta recording、live 未捕获 URL 过渡 DTO、加密 fMP4/video 真实输出组合、真实网站手工验证和最终 hls-engine cutover。
- runtime changes: pure parser 对 `EXT-X-SESSION-KEY` 只执行 quoted/hex attribute 的有序变量替换以保留 parsing error，随后丢弃；不写 `keys/currentKeys`，child 仍必须通过自己的 `EXT-X-KEY` 才能加密 fragment。
- legacy cleanup: 无；旧 HLS 执行链继续保留到 hls-engine 原子 cutover。
- validation: 固定 vendor executable oracle 先输出 `MANIFEST_LOADED sessionKeys=1 / emeEnabled=false`，随后 child `LEVEL_LOADED` fragment 为 `encrypted=false / decryptdata=null`；session-key 先于对应 `EXT-X-DEFINE` 时输出 fatal `manifestParsingError`。失败证据为 parser 20/21，实现后 parser 21/21、parser/authority 25/25、广义 HLS Vitest 75/75、全仓 ESLint、TypeScript、`cat-catch:validate`、同步校验 16/16、fixture JSON、metadata 7 units/32 capabilities/192 anchors/106 cleanup entries/126 unique planned IDs/80 active refs 和 scoped diff check 通过。全量 Vitest 为 1097 passed / 1 skipped / 16 sandbox-only loopback failures，4 个相关 loopback 文件在允许监听本机端口的环境复跑 20/20，通过后折算全部可执行测试为 1113 passed / 1 skipped；Node 专用同步 validator 被 Vitest 收集后另报告 no suite。完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (HLS MAP leading BYTERANGE transfer)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本步闭合固定 hls.js 1.6.16 中独立 BYTERANGE 到 MAP/media 下载请求的绑定边界，仍未完成 hls-engine cutover。
- change groups: `behavioral`（MAP init Range 与 media Range 绑定）和 `explicit-exclusion`（不投影只服务播放的其他 parser metadata）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`；新增 1 个 active test ID。
- fixtures/tests: 新增 upstream-executable fixture `hls-map-leading-byterange-transfer`；`hls.map-leading-byterange-transfer` 覆盖正时长 `EXTINF` 前的独立 BYTERANGE 同时绑定 MAP/下一 media fragment、该 range 省略 offset 时继承 previous fragment end、空 MAP BYTERANGE 仍沿用前置 range、正时长 `EXTINF` 后的 MAP 不接收 media range，以及 download plan 继续携带相同 init segment range。
- accepted difference: 固定 hls.js 对无有效 range 的 init segment 暴露空 `byteRange` 数组，OmniFlow 省略可选字段；Cat Catch 只在数组长度为 2 时设置 Range，OmniFlow 只在字段存在时设置 Range，最终请求相同。
- excluded changes and reasons: 不新增 program-date-time、daterange、gap、bitrate、preload-hint、rendition-report 或 independent-segments DTO；本步只迁移会改变 Cat Catch init/media 下载 URL 或 Range 的行为。
- unresolved gaps: HLS 其余真正影响下载的 parser 差分、真正有 previous snapshot 的 delta recording、live 未捕获 URL 过渡 DTO、加密 fMP4/video 真实输出组合、真实网站手工验证和最终 hls-engine cutover。
- runtime changes: pure parser 在尚无正时长 `EXTINF` 且 MAP 自身没有非空 BYTERANGE 时，先按 previous fragment end 补齐待处理独立 range 的省略 offset，再复制给 MAP；同一待处理 range 仍保留给下一 media fragment。MAP 自身的非空 range 和正时长 `EXTINF` 后的 media range 继续遵循原有独立规则。
- legacy cleanup: 无；旧 HLS 执行链继续保留到 hls-engine 原子 cutover。
- validation: 固定 vendor executable oracle 对精确 fixture 输出首个 init/media range `[0,720]`、第二个 init empty range 与 media `[720,1720]`，以及省略 offset 的第三个 init/media range `[1720,2320]`；失败证据为 parser 21/22，实现后 parser 22/22、广义 HLS/inspection/projection Vitest 82/82、全仓 ESLint、TypeScript、`cat-catch:validate`、同步校验 16/16、fixture JSON 和 metadata 7 units/32 capabilities/192 anchors/106 cleanup entries/127 unique planned IDs/81 active refs 通过。全量 Vitest 为 1100 passed / 3 skipped / 16 sandbox-only loopback failures，4 个相关 loopback 文件在允许监听本机端口的环境复跑 20/20，通过后折算全部可执行测试为 1116 passed / 3 skipped；Node 专用同步 validator 被 Vitest 收集后另报告 no suite。完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (HLS MAP URI rejection)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本步闭合固定 hls.js 1.6.16 中缺失/空 MAP URI 到 Cat Catch 下载路径的不可执行边界，仍未完成 hls-engine cutover。
- change groups: `behavioral`（无效 MAP 替换旧 init state）、`stability`（同步稳定拒绝）和 `security`（禁止把空 URL 解析为无关页面资源）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`；新增 1 个 active test ID。
- fixtures/tests: 新增 upstream-executable fixture `hls-map-uri-rejection`；`hls.map-uri-rejection` 覆盖已有有效 MAP 后出现缺失 URI，以及首张 MAP 显式空/纯空白 URI，三者都不得沿用旧 MAP 或进入 download plan。
- accepted difference: 固定 hls.js 为 missing/empty 输入创建 `url=""` 的 init segment，纯空白 URI 则解析为 playlist URL；Cat Catch `parseTs` 随后会抓取扩展页面或 manifest 内容。OmniFlow 在同步 parser 边界抛 `EXT-X-MAP URI must be a non-empty string`，保持同一“不产生有效媒体输出”的终态，同时阻止抓取无关内容。
- excluded changes and reasons: 不给 renderer 增加无效 MAP DTO，不让 main downloader猜测空 URI，也不在本步迁移 program-date-time、daterange、gap、bitrate、preload-hint、rendition-report 或 independent-segments 等非下载投影字段。
- unresolved gaps: HLS 其余真正影响下载的 parser 差分、真正有 previous snapshot 的 delta recording、live 未捕获 URL 过渡 DTO、加密 fMP4/video 真实输出组合、真实网站手工验证和最终 hls-engine cutover。
- runtime changes: pure parser 在 MAP attribute substitution 后发现 URI 缺失或为空时记录稳定 parsing error 并清空当前 MAP；更早的上游 parsing error 保持优先，manifest 不会物化为计划。
- legacy cleanup: 无；旧 HLS 执行链继续保留到 hls-engine 原子 cutover。
- validation: 固定 vendor executable oracle 对已有有效 MAP 后的 missing URI 输出 init URLs `["https://media.example/init-a.mp4", ""]`，对 empty URI 输出 `initUrl=""`，纯空白 URI 输出 playlist URL；静态 Cat Catch `parseTs` 证实会对这些 URL 调用 `fetch`。失败证据为 parser 22/23，实现后 parser 23/23、广义 HLS/inspection/projection Vitest 83/83、全仓 ESLint、TypeScript、`cat-catch:validate`、同步校验 16/16、fixture JSON 和 metadata 7 units/32 capabilities/192 anchors/106 cleanup entries/128 unique planned IDs/82 active refs 通过。全量 Vitest 为 1105 passed / 3 skipped / 16 sandbox-only loopback failures，4 个 loopback 文件在允许监听本机端口的环境复跑 20/20，折算全部可执行测试为 1121 passed / 3 skipped；Node 专用同步 validator 被 Vitest 收集后另报告 no suite。完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (HLS master variant group merge)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，固定依赖为 hls.js `1.6.16`。
- reviewedThrough / portedThrough: 均保持 `null`；本步闭合同一 master level 的重复声明和完整 rendition group 投影，仍未完成 hls-engine cutover。
- change groups: `behavioral`（固定 level identity、同 URI variant 合并、有序 group 去重）与 `renderer-projection`（plan 完整 group 数组、音轨/字幕过滤与高亮）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`；新增 2 个 active test ID。
- fixtures/tests: 新增 upstream-executable fixture `hls-master-variant-group-merge`；`hls.master-variant-group-merge` 覆盖四条同 identity/同 URI 的 `EXT-X-STREAM-INF`（首条无 group）合并为一个 variant，并保留首个实际单值与完整的 `audio-en/audio-ja`、`sub-en/sub-ja` group；`hls.master-variant-rendition-groups` 覆盖工具区允许两组合关联轨道、排除未关联 `fr` 轨道，以及无 group variant 不错误收窄候选。
- accepted difference: 后续固定 vendor boundary fixture 证实，Cat Catch 用来生成选择项的 `MANIFEST_PARSED` 对 implicit/explicit pathway 都只暴露首 URI，并没有 ordered URL fallback；OmniFlow 继续保留每个 identity/URI 为独立可选项，不静默吞掉后续 URL，也不新增 failover 语义。
- excluded changes and reasons: 本步不实现 content steering、跨 URI pathway failover、轨道 codec 推断或播放 controller；不切换或删除 legacy HLS owner。
- unresolved gaps: HLS 其余 master/media parser 差分、live 未捕获 URL 过渡 DTO、加密 fMP4/video 真实输出组合、真实网站手工验证和最终 hls-engine cutover。
- runtime changes: pure parser 按 `PATHWAY-ID/BANDWIDTH/RESOLUTION/FRAME-RATE/CODECS/VIDEO-RANGE/HDCP-LEVEL` identity 合并同 URL variant，兼容单值 group ID 保留首组，新增数组贯穿 manifest 与 download plan；renderer 通过纯 helper 统一过滤、展示和高亮完整 group 集合，没有新增状态 owner、IPC channel 或 main authority。
- legacy cleanup: 无；旧 HLS 执行链继续保留到 hls-engine 原子 cutover。
- validation: 固定 vendor executable oracle 对 fixture 的 `MANIFEST_PARSED` 输出 1 个 level、首个实际单值 `audio-en/sub-en`、`audioGroups=[audio-en,audio-ja]`、`subtitleGroups=[sub-en,sub-ja]`；失败证据为 parser `23/24` 且收到 4 个重复 variant，renderer 新测试在 helper 未实现时无法加载。实现后 parser/renderer `26/26`，广义 HLS/authority/projection `40/40`，TypeScript、全仓 ESLint、固定上游 validator、同步校验 `16/16`、fixture JSON、metadata `7 units / 32 capabilities / 192 anchors / 106 cleanup entries / 130 planned IDs / 84 active refs` 和 scoped diff check 通过。排除其他 Agent 正在修改且当前 `17/18` 的 quota-manager 文件，以及应由 `node --test` 执行的同步文件后，全量 Vitest 为 `1115 passed / 3 skipped`；4 个 loopback 文件在 sandbox 外复跑 `20/20`。完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (HLS master pathway URI boundary)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，固定实际 vendor 为 hls.js `1.6.16`。
- reviewedThrough / portedThrough: 均保持 `null`；本步纠正跨 URI pathway 的先前静态判断，并闭合相同 URI 被其他声明隔开时的 group 合并，仍未完成 hls-engine cutover。
- change groups: `behavioral-correction`（区分 `MANIFEST_LOADED` 原始 levels 与 Cat Catch 消费的 `MANIFEST_PARSED` 选择层）、`accepted-difference`（保留后续 URI）和 `parser-stability`（非相邻同 URI 合并）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`；新增 1 个 active test ID。
- fixtures/tests: 新增 upstream-executable fixture `hls-master-pathway-uri-boundary`；`hls.master-pathway-uri-boundary` 同时覆盖 implicit pathway 与显式相同 `PATHWAY-ID` 的 `A -> B -> A` URI 声明，并验证 OmniFlow 按首次出现顺序保留 A/B 两项、把 A 首尾 AUDIO/SUBTITLES group 有序合并。
- accepted difference: 固定 vendor 的 `MANIFEST_LOADED` 对 implicit 输入保留三条 level 并赋予 `. / .. / ...`，对 explicit 输入保留三条相同 `cdn-a` level；Cat Catch 生成选择项所消费的 `MANIFEST_PARSED` 在两种输入中都只暴露首 A，explicit 时还把 A1/B/A2 group 全部挂到首 A。OmniFlow 为避免数据损失保留每个 identity/URI 为独立可选项，但不建立 fallback 顺序、自动 failover 或 content steering 执行器。
- excluded changes and reasons: 不新增 fallback URL DTO、重试策略、content steering controller、IPC 或 renderer 状态；固定 Cat Catch 下载选择层没有提供可忠实迁移的 ordered fallback 行为。
- unresolved gaps: HLS 其余 master/media parser 差分、live 未捕获 URL 过渡 DTO、加密 fMP4/video 真实输出组合、真实网站手工验证和最终 hls-engine cutover。
- runtime changes: `mergeHlsVariantGroups` 现在在每个固定 level identity 下按 resolved URI 分桶；首次 URI 顺序保持不变，同一 URI 的重复声明无论是否相邻都合并 group，跨 URI 项保持独立。
- legacy cleanup: 无；旧 HLS 执行链继续保留到 hls-engine 原子 cutover。
- validation: 固定 Cat Catch vendor executable oracle 输出上述 `MANIFEST_LOADED / MANIFEST_PARSED` 两层证据；失败证据为 parser `24/25` 且 implicit 用例得到 `A/B/A` 三项。实现后 parser `25/25`，广义 HLS/authority/projection `41/41`，TypeScript、全仓 ESLint、fixture JSON、轻量 validator、固定上游 anchor 校验、同步校验 `16/16`、metadata `7 units / 32 capabilities / 192 anchors / 106 cleanup entries / 131 planned IDs / 85 active refs` 和本切片 diff check 通过。排除已由 `node --test` 单独执行的同步文件后，全量 Vitest 在 sandbox 内为 `1129 passed / 3 skipped / 16 loopback EPERM`；4 个 loopback 文件在 sandbox 外复跑 `20/20`，折算全部可执行测试为 `1145 passed / 3 skipped`。完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (HLS key IV byte normalization)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，固定实际 vendor 为 hls.js `1.6.16`。
- reviewedThrough / portedThrough: 均保持 `null`；本步闭合 `EXT-X-KEY` 显式 IV 从 attribute text 到 fragment decryptdata bytes 的归一化边界，仍未完成 hls-engine cutover。
- change groups: `behavioral`（固定 `AttrList.hexadecimalInteger` 的字节转换）与 `projection`（相同 IV 贯穿 manifest 和 download plan）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`；新增 1 个 active test ID 和 1 个固定上游 anchor。
- fixtures/tests: 新增 upstream-executable fixture `hls-key-iv-normalization`；`hls.key-iv-normalization` 覆盖非法文本、短 hex、奇数位 hex、大写 hex 以及空 IV 的 sequence 回退，并同时断言 pure manifest 与 download plan。
- accepted difference: 无。OmniFlow 忠实复刻去掉前两字符、奇数位左补零、逐字节 `parseInt` 以及无效结果写入 `Uint8Array` 后归零的行为；不额外拒绝短 IV 或非法字符。
- excluded changes and reasons: 不新增 IV 长度校验、严格 hex 校验、crypto/decrypt 分支、IPC 或 renderer 状态；固定 Cat Catch vendor 本身没有这些约束。
- unresolved gaps: HLS 其余 master/media parser 差分、live 未捕获 URL 过渡 DTO、加密 fMP4/video 真实输出组合、真实网站手工验证和最终 hls-engine cutover。
- runtime changes: `createHlsKey` 在变量替换后把显式 IV 按固定 hls.js 字节算法序列化为小写 `0x` DTO；缺失或空 IV 仍由现有 sequence/MAP zero 分支派生。该值沿现有 plan 和 local playlist 链传播，没有新增 owner。
- legacy cleanup: 无；旧 HLS 执行链继续保留到 hls-engine 原子 cutover。
- validation: 固定 Cat Catch vendor executable oracle 对五个 fragment 分别输出 `00000e / 01 / 0123 / abcdef / 0000000000000000000000000000000f`；失败证据为 parser `25/26`，当前实现保留非法/奇数/大写原文。实现后 parser `26/26`、完整 HLS 集合 `82/82`、TypeScript、全仓 ESLint、fixture JSON、轻量 validator、固定上游 anchor 校验、同步校验 `16/16`、metadata `7 units / 32 capabilities / 193 anchors / 106 cleanup entries / 132 planned IDs / 86 active refs` 和本切片 diff check 通过。排除已由 `node --test` 单独执行的同步文件后，全量 Vitest 在沙箱内为 `1136 passed / 3 skipped / 16 loopback EPERM`；4 个 loopback 文件在沙箱外复跑 `20/20`，折算全部可执行测试为 `1152 passed / 3 skipped`。完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (HLS BYTERANGE numeric normalization)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，固定实际 vendor 为 hls.js `1.6.16`。
- reviewedThrough / portedThrough: 均保持 `null`；本步闭合 `BaseSegment.setByteRange` 的数值解析和不可执行 range 边界，仍未完成 hls-engine cutover。
- change groups: `behavioral`（length/offset 使用固定无 radix `parseInt`）与 `accepted-difference`（计划创建前拒绝非法 range）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`；新增 1 个 active test ID 和 1 个固定上游 anchor。
- fixtures/tests: 新增 upstream-executable fixture `hls-byterange-numeric-normalization`；`hls.byterange-numeric-normalization` 同时覆盖 MAP/media 的尾随文本整数前缀、后续 media 省略 offset 的 range end 继承，以及零/负 length、NaN 和负 offset 拒绝。
- accepted difference: 固定 hls.js 对 `0@400 / junk@500 / 8@junk / 8@-2 / -8@100` 分别保留 `[400,400] / [500,NaN] / [NaN,NaN] / [-2,6] / [100,92]`，Cat Catch 随后会形成空或非法 `Range`。OmniFlow 保留可执行整数前缀语义，但在 manifest facade 抛 `Invalid HLS BYTERANGE`，不允许错误退化成无 Range 的整资源下载。
- excluded changes and reasons: 空 BYTERANGE 继续按既有未声明语义处理，以保留 MAP leading-range transfer；不新增 range URL 累计器、下载 fallback、IPC 或 renderer 状态。
- unresolved gaps: HLS 其余 master/media parser 差分、live 未捕获 URL 过渡 DTO、加密 fMP4/video 真实输出组合、真实网站手工验证和最终 hls-engine cutover。
- runtime changes: `parseHlsByteRange` 对显式 length/offset 改用固定 hls.js 数值规则；MAP/media 复用同一 helper，并在任一非空非法值出现时记录首个稳定 manifest error。有效 range 继续沿既有 manifest/download-plan DTO 传播，没有新增 owner。
- legacy cleanup: 无；旧 HLS 执行链继续保留到 hls-engine 原子 cutover。
- validation: 固定 Cat Catch vendor executable oracle 证明 MAP `[300,320]`、media `[100,115]`、implicit media `[115,127]` 及上述五类非法输出；失败证据为 parser `26/27` 且 MAP range 为 `undefined`。实现后 parser `27/27`、完整 HLS 集合 `83/83`、TypeScript、全仓 ESLint、fixture JSON、轻量 validator、固定上游 anchor 校验、同步校验 `16/16`、metadata `7 units / 32 capabilities / 194 anchors / 106 cleanup entries / 133 planned IDs / 87 active refs` 和本切片 diff check 通过。排除已由 `node --test` 单独执行的同步文件后，全量 Vitest 在沙箱内为 `1139 passed / 3 skipped / 16 loopback EPERM`；4 个 loopback 文件在沙箱外复跑 `20/20`，折算全部可执行测试为 `1155 passed / 3 skipped`。完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (live HLS selected child authority)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，固定实际 vendor 为 hls.js `1.6.16`。
- reviewedThrough / portedThrough: 均保持 `null`；本步闭合 live start 从 captured source 到 selected child 首次请求的 authority 边界，仍未完成 hls-engine cutover。
- change groups: `platform-adaptation`（opaque captured source 到 child 归属验证）与 `security-boundary`（验证前零 child fetch、收窄 live-start IPC）。
- affected capability IDs: `hls.live-recording` 保持 `porting`；新增 1 个 active test ID，固定上游 anchor 不变。
- fixtures/tests: `hls.live-selected-child-authority` 证明 main-owned resolver 在首次 child manifest fetch 前执行，hostile child 被拒绝后 fetch 次数为零；既有 parent-variable/abort/live terminal 用例同时证明 resolver 一次缓存和同一 AbortSignal。
- accepted difference: Cat Catch 扩展页由自身 hls.js loader 直接持有 master/child 关系；OmniFlow 的 renderer 只提交 selected URL 和 opaque source resource id，main 重新读取 captured source 并验证 exact resource 或 variant/rendition 归属。该平台替代不改变合法 child、变量 IMPORT 或后续分片列表。
- excluded changes and reasons: 不要求直播期间新出现的 key/map/media 预先被资源面板捕获；这些 URL 只能来自 main 已验证并解析的 child manifest，未命中 resource authority 时继续使用绑定 tab session 的 fetch。不扩展到 DASH 直拉、计划 shape 或旧 catch toolkit。
- unresolved gaps: HLS 其余 master/media parser 差分、加密 fMP4/video 真实输出组合、真实网站手工验证、application-level output workflow 和最终 hls-engine cutover。
- runtime changes: live-start IPC 的 `manifestUrl/resourceId/requestId` 改为必填并删除 renderer `headers/pageUrl`；main 无有效 source authority 时立即拒绝。Recorder 在首次 child fetch 前一次性调用 parent resolver，缓存 variable list 供后续 poll，拒绝时不请求 child；每次重新 start 都重新验证，并让 authority/manifest/segment 继续共用 recorder AbortSignal。
- legacy cleanup: 删除 live-start renderer headers/pageUrl 过渡字段；未删除旧 HLS 执行链，保留到 hls-engine 原子 cutover。
- validation: 失败证据为 live recorder `6/7`，hostile child start 错误地成功且 resolver 未执行；实现后 recorder `7/7`、定向 authority/IPC/renderer `14/14`、完整 HLS 集合 `84/84`、TypeScript、全仓 ESLint、轻量 validator、固定上游 anchor 校验、同步校验 `16/16`、metadata `7 units / 32 capabilities / 194 anchors / 106 cleanup entries / 134 planned IDs / 88 active refs` 和本切片 diff check 通过。排除已由 `node --test` 单独执行的同步文件后，全量 Vitest 在沙箱内为 `1140 passed / 3 skipped / 16 loopback EPERM`；4 个 loopback 文件在沙箱外复跑 `20/20`，折算全部可执行测试为 `1156 passed / 3 skipped`。完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (HLS valued tag dispatch boundary)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，固定实际 vendor 为 hls.js `1.6.16`。
- reviewedThrough / portedThrough: 均保持 `null`；本步闭合带值 HLS 标签从词法匹配到下载对象状态的分发边界，仍未完成 hls-engine cutover。
- change groups: `behavioral`（固定 `Xr/Qr` 冒号边界）与 `stability`（未知扩展标签不污染下载状态）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`；新增 1 个 active test ID，固定上游 anchor 不变。
- fixtures/tests: 新增 upstream-executable fixture `hls-valued-tag-boundary`；`hls.valued-tag-boundary` 同时覆盖未知 `KEY/MAP/BYTERANGE/MEDIA-SEQUENCE/TARGETDURATION/PLAYLIST-TYPE/STREAM-INF/EXTINF` 后缀不能清空 AES key、替换 init/range、改写 sequence/target/type、生成 variant 或吞掉 media URI，并锁住 manifest 与 download plan 的 URL、effective IV、MAP range、duration 和 discontinuity。
- accepted difference: 无。无值标签走固定 hls.js 的另一条正则，其前缀行为原样保留，没有在本步顺手规范化。
- excluded changes and reasons: 不投影 `PROGRAM-DATE-TIME/GAP/DATERANGE/BITRATE/PRELOAD-HINT/RENDITION-REPORT` 等 Cat Catch `parseTs` 不消费的播放 metadata；不新增 IPC、renderer 状态或 parser 框架。
- unresolved gaps: HLS 其余真正影响下载的 parser 差分、live 未捕获 URL 过渡 DTO、加密 fMP4/video 真实输出组合、真实网站手工验证和最终 hls-engine cutover。
- runtime changes: pure parser 的 `STREAM-INF/MEDIA-SEQUENCE/TARGETDURATION/PLAYLIST-TYPE/KEY/MAP/BYTERANGE/DISCONTINUITY-SEQUENCE/EXTINF` 分支只在固定标签名后立即出现冒号时执行；未知带值扩展继续落入固定 fallback。既有 key/map/range/sequence owner 和 DTO 不变。
- legacy cleanup: 无；旧 HLS 执行链继续保留到 hls-engine 原子 cutover。
- validation: 固定 Cat Catch vendor executable oracle 输出 3 个 fragment，保持 `sn=10/11/12`、`cc=0/1/1`、同 AES key/init MAP、逐 sequence IV、target duration `4`、总时长 `8` 且无 variant；失败证据为 parser `27/28`，未知 sequence 后缀触发错误。实现后 parser `28/28`、完整 HLS 集合 `85/85`、全仓 ESLint、fixture/capability JSON、轻量 validator、固定上游校验、同步校验 `16/16`、metadata `7 units / 32 capabilities / 194 anchors / 106 cleanup entries / 135 planned IDs / 89 active refs` 和 scoped diff check 通过。全量 Vitest 在沙箱内为 `1148 passed / 3 skipped / 16 loopback EPERM / 3 Agent Shell failures`；4 个 loopback 文件在沙箱外复跑 `20/20`，折算唯一测试为 `1164 passed / 3 skipped / 3 Agent Shell failures`。TypeScript 仅被其他 Agent 在途的 `agent-media-artifact-store.ts` 与 `agent-orchestrator.test.ts` 4 个错误阻断；完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (HLS integer tag token boundary)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，固定实际 vendor 为 hls.js `1.6.16`。
- reviewedThrough / portedThrough: 均保持 `null`；本步闭合整数媒体标签的首 token 词法边界及 initial/current discontinuity sequence 分离，仍未完成 hls-engine cutover。
- change groups: `behavioral`（固定 `Qr` 无符号整数分支）与 `state-model`（分开维护 startCC/current cc）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`；新增 1 个 active test ID，固定上游 anchor 不变。
- fixtures/tests: 新增 upstream-executable fixture `hls-integer-tag-token-boundary`；`hls.integer-tag-token-boundary` 覆盖正负号不进入整数分支、数字尾随文本保留整数前缀、非法 discontinuity sequence 落入无值前缀分支、后续合法 sequence 恢复，以及 signed-only target duration 拒绝，并断言 AES implicit IV 和 download plan sequence。
- accepted difference: 无。`DISCONTINUITY-SEQUENCE:-3` 未命中整数分支后按固定无值 `DISCONTINUITY` 前缀令 current cc 加一；合法后续 sequence 仍可写入独立 startCC/current cc。
- excluded changes and reasons: 不扩展到 BITRATE 等 Cat Catch 下载对象不消费的播放 metadata，不新增 IPC、renderer 状态或 parser 框架。
- unresolved gaps: HLS 其余真正影响下载的 parser 差分、live 未捕获 URL 过渡 DTO、加密 fMP4/video 真实输出组合、真实网站手工验证和最终 hls-engine cutover。
- runtime changes: pure parser 对 `MEDIA-SEQUENCE/TARGETDURATION/VERSION/DISCONTINUITY-SEQUENCE` 使用固定 `: *(\d+)` 词法边界；initial discontinuity sequence 与遍历中的 current cc 分离，sequence 继续贯穿 AES implicit IV 和 download plan。
- legacy cleanup: 无；旧 HLS 执行链继续保留到 hls-engine 原子 cutover。
- validation: 固定 Cat Catch vendor executable oracle 输出 recovered/prefix 的 `startSN=10 / startCC=2 / cc=2 / target=4`、fallback 的 `startSN=0 / startCC=0 / cc=1 / target=4`，signed-only target 报 `Missing Target Duration`；失败证据先后为 parser `28/29`（错误接受 signed sequence）和 `28/29`（startCC/current cc 未分离）。实现后 parser `29/29`、完整 HLS 集合 `86/86`、TypeScript、全仓 ESLint、fixture/capability JSON、轻量 validator、固定上游校验、同步校验 `16/16`、metadata `7 units / 32 capabilities / 194 anchors / 106 cleanup entries / 136 planned IDs / 90 active refs` 和 scoped diff check 通过。排除已由 `node --test` 单独执行的同步文件后，全量 Vitest 在沙箱内为 `1155 passed / 3 skipped / 16 loopback EPERM`；4 个 loopback 文件在沙箱外复跑 `20/20`，折算全部可执行测试为 `1171 passed / 3 skipped`。完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (HLS EXTINF token boundary)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，固定实际 vendor 为 hls.js `1.6.16`。
- reviewedThrough / portedThrough: 均保持 `null`；本步闭合 fast EXTINF regex 从时长前缀到 Cat Catch 下载列表的回扫边界，仍未完成 hls-engine cutover。
- change groups: `behavioral`（固定无符号 decimal token）与 `download-projection`（remainder URI、sequence、implicit IV、总时长贯穿 plan）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`；新增 1 个 active test ID 和 1 个固定上游 anchor。
- fixtures/tests: 新增 upstream-executable fixture `hls-extinf-token-boundary`；`hls.extinf-token-boundary` 覆盖合法整数/leading-dot、signed、指数、尾随文本、十六进制、空 duration、超长十进制的非有限状态及有效 duration 恢复，并同时断言 pure manifest 与 download plan 的 14 个 fragment URL、duration、sequence 和 AES implicit IV。
- accepted difference: 无。OmniFlow 不把非规范输入稳定拒绝或宽松数值化；固定 fast regex 回扫得到的额外 URI 正是 Cat Catch `LEVEL_LOADED -> parseTs` 会加入下载列表的黑盒行为。
- excluded changes and reasons: 不投影 Cat Catch `parseTs` 未复制的 hls.js title artifact，不扩展到 PROGRAM-DATE-TIME/DATERANGE/BITRATE 等播放 metadata，也不新增 IPC 或 renderer 状态。
- unresolved gaps: HLS 其余真正影响下载的 parser 差分、live 未捕获 URL 过渡 DTO、加密 fMP4/video 真实输出组合、真实网站手工验证和最终 hls-engine cutover。
- runtime changes: `parseExtinf` 只消费固定 `\d*(?:\.\d+)?` 前缀；非逗号 remainder 按固定 URI alternative 立即物化一个 fragment，下一条真实 URI 继续物化零时长 fragment。非有限 duration 会阻止 URI 物化，空 duration 复用当前 fragment 状态；既有 key/map/sequence owner 不变。
- legacy cleanup: 无；旧 HLS 执行链继续保留到 hls-engine 原子 cutover。
- validation: 固定 Cat Catch vendor executable oracle 与 fixture expected 逐字段比对为 `same=true / 14 fragments / duration=12.5 / sn=10..23`，并锁定每项 URL 与 AES IV；失败证据先后为 parser `29/30` 且总时长 `308.5`，以及补入 overflow 后总时长 `Infinity`。实现后 parser `30/30`、完整 HLS 集合 `87/87`、TypeScript、全仓 ESLint、fixture/capability JSON、轻量 validator、固定上游校验、同步校验 `16/16`、metadata `7 units / 32 capabilities / 195 anchors / 106 cleanup entries / 137 planned IDs / 91 active refs` 和 scoped diff check 通过。排除 4 个需监听本机端口的文件及已由 `node --test` 单独执行的同步文件后，全量 Vitest 为 `178 files / 1160 passed / 3 skipped`；4 个 loopback 文件在沙箱外复跑 `20/20`，合计全部可执行测试 `1180 passed / 3 skipped`。完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (HLS empty valued tag payload boundary)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，固定实际 vendor 为 hls.js `1.6.16`。
- reviewedThrough / portedThrough: 均保持 `null`；本步闭合 media-playlist slow regex 的零字符 payload 分发边界，仍未完成 hls-engine cutover。
- change groups: `behavioral`（固定 `Qr` 的 `(.+)` payload 门禁）与 `state-stability`（裸标签不清除下载状态或创建幽灵变量）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`；新增 1 个 active test ID 和 1 个固定上游 anchor。
- fixtures/tests: 新增 upstream-executable fixture `hls-empty-valued-tag-boundary`；`hls.empty-valued-tag-boundary` 覆盖裸 `BYTERANGE:` 保留 pending range、裸 `MAP:` 保留 init、裸 `PLAYLIST-TYPE:` 不形成重复声明、裸 `DEFINE:` 后的未定义变量继续报固定错误，并同时锁定 manifest/download plan 的 URL、range、MAP、AES key/implicit IV、sequence 和总时长。
- accepted difference: 无。这里区分的是未进入 MAP 分支的裸标签与已经进入分支、但属性 URI 缺失/空/whitespace-only 的 MAP；后者仍沿用 OmniFlow 已记录的稳定拒绝适配。
- excluded changes and reasons: 不投影 `PROGRAM-DATE-TIME/GAP/DATERANGE/BITRATE/PRELOAD-HINT/RENDITION-REPORT` 等 Cat Catch `parseTs` 不消费的播放 metadata，不在本步扩大到 master/media 混合语法或原始行首尾 whitespace 归一化。
- unresolved gaps: HLS 其余真正影响下载的 parser 差分、live 未捕获 URL 过渡 DTO、加密 fMP4/video 真实输出组合、真实网站手工验证和最终 hls-engine cutover。
- runtime changes: media parser 已实现的 `DEFINE/PLAYLIST-TYPE/SKIP/KEY/MAP/BYTERANGE` valued branches 只在冒号后有 payload 时执行；bare fallback 保留既有 key/map/range/type/variable owner，master DEFINE 的独立正则语义不变。
- legacy cleanup: 无；旧 HLS 执行链继续保留到 hls-engine 原子 cutover。
- validation: 固定 Cat Catch vendor executable oracle 输出 `3 fragments / duration=12 / sn=10..12 / type=VOD`，保留首片 `20..24` range、三片共同 MAP/key 与逐 sequence IV；裸 DEFINE 引用报 `Missing preceding EXT-X-DEFINE...`。失败证据为 parser `30/31`，空 PLAYLIST-TYPE 被误判为重复声明。实现后 parser `31/31`、完整 HLS 集合 `88/88`、TypeScript、全仓 ESLint、fixture/capability JSON、轻量 validator、固定上游校验、同步校验 `16/16`、metadata `7 units / 32 capabilities / 196 anchors / 106 cleanup entries / 138 planned IDs / 92 active refs` 和 scoped diff check 通过。排除 4 个需监听本机端口的文件及已由 `node --test` 单独执行的同步文件后，全量 Vitest 为 `178 files / 1162 passed / 3 skipped`；4 个 loopback 文件在沙箱外复跑 `20/20`，合计全部可执行测试 `1182 passed / 3 skipped`。完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (HLS media parser mode isolation)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，固定实际 vendor 为 hls.js `1.6.16`。
- reviewedThrough / portedThrough: 均保持 `null`；本步闭合 `isMediaPlaylist` 判定后 master-only 标签不能反向污染 media 下载列表的边界，仍未完成 hls-engine cutover。
- change groups: `behavioral`（固定 master/media parser 选择）与 `download-projection`（被错误吞掉的 media URI 恢复到 fragment/plan）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`；新增 1 个 active test ID 和 1 个固定上游 anchor。
- fixtures/tests: 新增 upstream-executable fixture `hls-media-parser-mode-isolation`；`hls.media-parser-mode-isolation` 覆盖 media playlist 内非空/裸 `STREAM-INF` 和 `EXT-X-MEDIA` 只走 level fallback，两个后续 URI 均作为零时长 fragment，并同时锁定 manifest/download plan 的 URL、sequence、MAP、AES key/implicit IV 和总时长。
- accepted difference: 无。Cat Catch 的 hls.js loader 先用 `EXTINF/TARGETDURATION` 选择 `parseLevelPlaylist`；OmniFlow pure facade 在同一判定后隔离 master-only variant/rendition 分支。
- excluded changes and reasons: 不扩展到未被 `isMediaPlaylist` 选中的 master 内混入其他 media-only 标签，也不投影 Cat Catch `parseTs` 不消费的播放 metadata。
- unresolved gaps: HLS 其余真正影响下载的 parser 差分、live 未捕获 URL 过渡 DTO、加密 fMP4/video 真实输出组合、真实网站手工验证和最终 hls-engine cutover。
- runtime changes: `EXT-X-STREAM-INF` 与 `EXT-X-MEDIA` 仅在 `hasMediaPlaylistSyntax=false` 时进入 master parser；media 模式下标签保持 fallback，其后的 URI 继续走既有 `addSegment` 并继承当前 MAP/key/sequence owner。
- legacy cleanup: 无；旧 HLS 执行链继续保留到 hls-engine 原子 cutover。
- validation: 固定 Cat Catch vendor executable oracle 输出 `4 fragments / duration=8 / sn=5..8 / levelCount=1 / audioTrackCount=0`，两个 mixed-syntax URI 为零时长且共同继承 init/key 与逐 sequence IV。失败证据为 parser `31/32`：manifest 被误标 master，生成 2 个 variant/1 个 rendition 并漏掉两片。实现后 parser `32/32`、完整 HLS 集合 `89/89`、TypeScript、全仓 ESLint、fixture/capability JSON、轻量 validator、固定上游校验、同步校验 `16/16`、metadata `7 units / 32 capabilities / 197 anchors / 106 cleanup entries / 139 planned IDs / 93 active refs` 和 scoped diff check 通过。排除 4 个需监听本机端口的文件及已由 `node --test` 单独执行的同步文件后，全量 Vitest 为 `178 files / 1163 passed / 3 skipped`；4 个 loopback 文件在沙箱外复跑 `20/20`，合计全部可执行测试 `1183 passed / 3 skipped`。完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (HLS master parser mode isolation)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，固定实际 vendor 为 hls.js `1.6.16`。
- reviewedThrough / portedThrough: 均保持 `null`；本步闭合 `isMediaPlaylist=false` 后 media-only 标签和游离 URI 不能污染 master 下载状态的反向边界，仍未完成 hls-engine cutover。
- change groups: `behavioral`（固定 master parser 分发）与 `state-isolation`（media key/MAP/range/fragment 状态在 master 中不可达）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`；新增 1 个 active test ID，复用既有 `isMediaPlaylist=function(e){return qr.test(e)}` 上游 anchor。
- fixtures/tests: 新增 upstream-executable fixture `hls-master-parser-mode-isolation`；`hls.master-parser-mode-isolation` 覆盖合法 master 混入 `KEY/MAP/BYTERANGE` 和游离 URI 时只保留普通 variant，且只有这些杂项、没有 level 的 master 继续报 `no levels found in manifest`。
- accepted difference: 无。合法 variant URI 仍由 pending `STREAM-INF` 消费；master `DEFINE/SESSION-KEY/MEDIA` 等已有分支保持原顺序，只有 media-only 状态和未绑定 variant 的 URI 被忽略。
- excluded changes and reasons: 不投影 Cat Catch `parseTs` 不消费的播放 metadata，不新增 parser 框架、IPC 或 renderer 状态，也不扩大到下一项 HLS 标签差分。
- unresolved gaps: HLS 其余真正影响下载的 parser 差分、live 未捕获 URL 过渡 DTO、加密 fMP4/video 真实输出组合、真实网站手工验证和最终 hls-engine cutover。
- runtime changes: 普通 URI 仅在 media 模式调用 `addSegment`；master-only 的 `SESSION-KEY/STREAM-INF/MEDIA` 分支处理后，master 不再落入 `MEDIA-SEQUENCE/TARGETDURATION/KEY/MAP/BYTERANGE` 等 media 标签状态机。既有 owner、DTO 和生产接线不变。
- legacy cleanup: 无；旧 HLS 执行链继续保留到 hls-engine 原子 cutover。
- validation: 固定 Cat Catch vendor executable oracle 只产生 `variant.m3u8 / bandwidth=1000000`，不产生 fragment/key/MAP/range；无普通 level 输入报 `no levels found in manifest`。失败证据为 parser `32/33`，错误生成 `stray.ts`、AES key、MAP 和 `10@0` range。实现后 parser `33/33`、完整 HLS 集合 `90/90`、fixture/capability JSON、全仓 ESLint、轻量 validator、固定上游校验、同步校验 `16/16`、metadata `7 units / 32 capabilities / 197 anchors / 106 cleanup entries / 140 planned IDs / 94 active refs` 和 scoped diff check 通过。排除 4 个需监听本机端口的文件及已由 `node --test` 单独执行的同步文件后，全量 Vitest 为 `178 files / 1166 passed / 3 skipped`；4 个 loopback 文件在沙箱外复跑 `20/20`，合计全部可执行测试 `1186 passed / 3 skipped`。TypeScript 当前仅被其他 Agent 在途的 `agent-orchestrator.test.ts` 泛型 mock 与 `agent-tool-executor.ts` 旧 `filePath` 字段共 3 个类型错误阻断。完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (HLS whitespace valued tag payload boundary)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，固定实际 vendor 为 hls.js `1.6.16`。
- reviewedThrough / portedThrough: 均保持 `null`；本步闭合 media slow regex 把行尾 whitespace 识别为 `(.+)` payload 的词法边界，仍未完成 hls-engine cutover。
- change groups: `behavioral`（固定 zero-character 与 whitespace payload 的分支差异）与 `state-stability`（MAP/range/variable/singleton 状态顺序）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`；新增 1 个 active test ID，复用既有 media slow regex 上游 anchor。
- fixtures/tests: 新增 upstream-executable fixture `hls-whitespace-valued-tag-boundary`；`hls.whitespace-valued-tag-boundary` 用 JSON `\u0020` 显式保留不可见行尾，覆盖 whitespace-only `MAP/BYTERANGE/DEFINE/PLAYLIST-TYPE/PART-INF/SERVER-CONTROL` 对 init/range/变量替换和重复声明的影响，并锁定 define 后 manifest/download plan 的 `.ts` URL、duration 和 sequence。
- accepted difference: 固定 hls.js 对 whitespace MAP 生成 `url=""` init，对 whitespace BYTERANGE 保留 `[0, NaN]`，Cat Catch 随后会抓取错误 init 或构造不可执行 Range；OmniFlow 复用已记录的稳定拒绝，分别报空 MAP URI 和非法 BYTERANGE。DEFINE 替换及三类 singleton error 与上游一致。
- excluded changes and reasons: 不投影 `PROGRAM-DATE-TIME/GAP/DATERANGE/BITRATE/PRELOAD-HINT/RENDITION-REPORT` 等 Cat Catch `parseTs` 不消费的播放 metadata，不新增 parser 框架、IPC 或 renderer 状态。
- unresolved gaps: HLS 其余真正影响下载的 parser 差分、live 未捕获 URL 过渡 DTO、加密 fMP4/video 真实输出组合、真实网站手工验证和最终 hls-engine cutover。
- runtime changes: manifest 行只移除前导 whitespace，保留行尾供 `hasHlsValuedTagPayload` 判定；属性解析和 URI 仍按既有规则 trim。PLAYLIST-TYPE 独立记录 branch seen 状态，PART-INF/SERVER-CONTROL 用原始 payload 门禁，whitespace BYTERANGE 进入既有非法范围拒绝；bare `TAG:` 行为不变。
- legacy cleanup: 无；旧 HLS 执行链继续保留到 hls-engine 原子 cutover。
- validation: 固定 Cat Catch vendor executable oracle 证明 whitespace DEFINE 把 `{$undefined}.ts` 解析为 `.ts`，whitespace MAP 生成空 init、whitespace BYTERANGE 生成 `[0, NaN]`，PLAYLIST-TYPE/PART-INF/SERVER-CONTROL 分别保留固定重复声明错误。失败证据为 parser `33/34`，DEFINE 行被预先 trim 后错误报告缺失变量。实现后 parser `34/34`、完整 HLS 集合 `91/91`、TypeScript、全仓 ESLint、fixture/capability JSON、轻量 validator、固定上游校验、同步校验 `16/16`、metadata `7 units / 32 capabilities / 197 anchors / 106 cleanup entries / 141 planned IDs / 95 active refs` 和 scoped diff check 通过。排除 5 个需监听本机端口的文件及已由 `node --test` 单独执行的同步文件后，全量 Vitest 为 `178 files / 1171 passed / 3 skipped`；5 个 loopback 文件在沙箱外复跑 `23/23`，合计全部可执行测试 `1194 passed / 3 skipped`。完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (HLS segment query compatibility)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，行为来自固定 Cat Catch `js/m3u8.js` 的 `tsAddArg`、`parseTs` 与参数按钮分支。
- reviewedThrough / portedThrough: 均保持 `null`；本步补齐下载对象 URL 的用户可控兼容经验，仍未完成 hls-engine cutover。
- change groups: `behavioral`（fragment query 保留/替换/清除）、`renderer-integration`（现有 HLS 草稿 owner）与 `main-integration`（直播 recorder 每轮 plan）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`；新增 4 个 active test ID、4 个上游 anchor 和纯 port target ref。
- fixtures/tests: 新增 spec-derived fixture `hls-segment-query-rewrite`；`hls.segment-query-rewrite` 覆盖 `null`、非空、空字符串、无原 query、大小写敏感默认值提取及 key/MAP 不改；`hls.segment-query-static-plan-integration` 证明静态任务强制走改写后的本地 plan；`hls.segment-query-live-empty-integration` 锁定 IPC 的空字符串语义；`hls.segment-query-live-recorder` 证明 manifest URL 保持而实际直播 fragment 请求被改写。
- accepted difference: Cat Catch 用扩展页面 query、prompt 和 reload 保存 `tsAddArg`；OmniFlow 用现有工具页内的 checkbox + 受控草稿表达同一三态，关闭为 `null`，开启后保留原始输入，包括空字符串。下载行为和 manifest query 默认提取正则保持固定上游语义。
- excluded changes and reasons: 不迁移 `m3u8.html` 的按钮 CSS、页面 reload 和扩展 query 编排；不把 fragment 参数应用到 key、MAP、manifest、独立音轨或外部工具 URL，也不把参数值写入任务日志。
- unresolved gaps: HLS 其余真正影响下载的 parser 差分、独立音轨与自定义 fragment query 的组合策略、加密 fMP4/video 真实输出组合、真实网站手工验证和最终 hls-engine cutover。
- runtime changes: 新纯模块在 post-parse plan 只改 `fragments[].url` 与 summary `segments[].url`；无设置时返回原 plan。工具页从当前 manifest 的小写 `.m3u8?` 后预填草稿，但必须显式启用；静态任务因此不走 ffmpeg 直拉，master 先解析用户选择的具体 variant。直播 IPC 新增可选 `segmentQuery`，main 仅在其为字符串时交给 recorder，每轮 snapshot 复用同一纯 plan 变换。
- legacy cleanup: 无；旧 HLS 执行链继续保留到 hls-engine 原子 cutover。
- validation: 失败证据分别为纯测试无法加载尚不存在的 `segment-query` 模块，以及 hook 集成 `2/4` 因目标 handler 不存在而失败。实现后专项 HLS `75/75`、新增纯/hook/recorder 集合 `13/13`、TypeScript、全仓 ESLint、fixture/capability JSON、轻量 validator、固定上游校验和同步校验 `16/16` 通过；metadata 为 `7 units / 32 capabilities / 201 anchors / 106 cleanup entries / 145 planned IDs / 99 active refs`。全仓 Vitest 在沙箱内除 5 个 loopback 文件外为 `1180 passed / 3 skipped`，5 个文件在允许本机监听后 `23/23`，合计 `1198 passed / 3 skipped`。完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (HLS queried independent track merge)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，继续复用固定 Cat Catch `tsAddArg`、master/rendition 与 `parseTs` 行为边界。
- reviewedThrough / portedThrough: 均保持 `null`；本步只闭合独立音轨与自定义 fragment query 的生产组合，未完成 hls-engine cutover。
- change groups: `renderer-integration`（组合分流与三个 opaque resource ID）、`main-integration`（master/child authority 与双 local plan）、`lifecycle`（双轨联动取消、进度聚合、隔离 workdir 和清理）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`，`hls.segment-pipeline` 保持 `porting`；新增 3 个 active test ID 和 2 个 target ref，不改变上游 anchor。
- fixtures/tests: 复用 `hls-segment-query-rewrite` 的 fragment-only 三态 expectation；`hls.segment-query-track-plan-integration` 证明 renderer 不再拉取或提交单轨 plan，只提交 master/video/audio resource ID 和 query；`hls.segment-query-track-plan-authority` 证明 main 校验两个 child 均属于 captured master、恢复 `EXT-X-DEFINE` 变量，并让 video/audio child 各自使用独立 protected context；`hls.segment-query-local-track-merge` 证明两条改写后的本地 playlist 进入既有 ffmpeg track merge。附加测试覆盖 child manifest 首次 HTTP 失败时只用同一 authority 执行一次 `force-cache` 回退，以及一轨失败时取消并等待另一轨。
- accepted difference: Cat Catch 在扩展下载页维护音轨与 fragment 列表；OmniFlow 作为 Electron 平台替代，为 video/audio 建立隔离的本地 playlist/workdir，再交给已有可取消 ffmpeg 双轨 merge。fragment query 的保留/清除/替换以及不修改 key/MAP 的行为不变。
- excluded changes and reasons: 独立音轨仍不与手动 AES key、自定义线程或分片范围控制混用；不把 query 传给 manifest/key/MAP/外部工具，不把 query 值写入任务日志、安全投影或同步文档。
- unresolved gaps: HLS 其余真正影响下载的 parser 差分、加密 fMP4/video 与独立双轨的真实输出组合、真实网站手工验证和最终 hls-engine cutover。
- runtime changes: `downloadHlsTracks` IPC 新增可选 `sourceResourceId / segmentQuery`。字段缺失保持原双 input ffmpeg 直拉；字段为字符串（包括空串）时，main 在同一个 tab/request active task 内验证 master/child、创建两条计划、并行下载到根 workdir 的 `video/audio` 子目录、汇总 bytes/fragments 后合并，最终或失败均删除根 workdir。renderer 仍要求两个 child 已在当前 active snapshot 中捕捉，main 不接受 renderer URL、header 或变量值。
- legacy cleanup: 无；旧 HLS 执行链继续保留到 hls-engine 原子 cutover。
- validation: 失败基线为 authority/local-merge helper 尚不存在，且 hook 集成因旧组合拦截使 `downloadHlsTracks` 调用数为 `0`。实现后新增三文件专项 `14/14`、完整 HLS 集合 `15 files / 101 tests`、TypeScript、全仓 ESLint、capability/fixture JSON、轻量 validator、固定上游 anchor 校验、同步校验 `16/16`、metadata `7 units / 32 capabilities / 201 anchors / 106 cleanup entries / 148 planned IDs / 102 active refs` 和 scoped diff check 通过。全仓 Vitest 在沙箱内除 5 个 loopback 文件及被 Vitest 扫入的 Node test 文件外为 `1195 passed / 3 skipped`；5 个 loopback 文件在允许本机监听后 `23/23`，其中 18 个先前 EPERM 用例转绿，合计唯一 Vitest 用例 `1213 passed / 3 skipped`；Node 同步测试单独 `16/16`。完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (HLS line-ending boundary)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，固定实际 vendor 为 hls.js `1.6.16`。
- reviewedThrough / portedThrough: 均保持 `null`；本步闭合 fast parser 对 CR/LF/CRLF 的清单行边界，仍未完成 hls-engine cutover。
- change groups: `behavioral`（固定 fast regex 的行分隔语义）与 `download-projection`（纯 CR 清单继续生成 Cat Catch `parseTs` 会消费的 fragment 列表）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`；新增 1 个 active test ID 和 1 个固定上游 anchor。
- fixtures/tests: 新增 upstream-executable fixture `hls-line-ending-boundary`；`hls.line-ending-boundary` 使用 JSON 中的 `\r` separator 构造纯 CR 清单，并同时锁定 pure manifest 与 download plan 的 URL、duration、media sequence、discontinuity、ENDLIST/live 状态。
- accepted difference: 无。固定 vendor 对同一输入输出 `sn=7..8 / cc=0..1 / duration=7.5 / live=false`，OmniFlow 保持相同可下载投影。
- excluded changes and reasons: 不借此扩大到 Cat Catch `parseTs` 不消费的播放 metadata，不修改网络解码、IPC、renderer 或任务 owner。
- unresolved gaps: HLS 其余真正影响下载的 parser 差分、加密 fMP4/video 与独立双轨的真实输出组合、真实网站手工验证和最终 hls-engine cutover。
- runtime changes: pure parser 的切行从只接受 LF/CRLF 改为显式接受 CRLF、LF 和 CR；后续 parser 分支、DTO 和生产接线不变。
- legacy cleanup: 无；旧 HLS 执行链继续保留到 hls-engine 原子 cutover。
- validation: 固定 Cat Catch vendor executable oracle 输出两片与上述终态；失败证据为新增用例报 `Missing format identifier #EXTM3U`。实现后 parser `35/35`、完整 HLS 集合 `16 files / 105 tests`、全仓 ESLint、fixture/capability JSON、轻量 validator、固定上游 anchor 校验、同步校验 `16/16`、metadata `7 units / 32 capabilities / 202 anchors / 106 cleanup entries / 149 planned IDs / 103 active refs` 和 scoped diff check 通过。全仓 Vitest 为 `1144 passed / 3 skipped`，失败只来自其他 Agent 在途的 media artifact upload/orchestrator：3 个 suite 初始化失败和 4 个 executor 断言/超时；同步 Node tests 被 Vitest 扫入时报无 suite，但已单独 `16/16`。TypeScript 同样被该在途模块的 8 个类型错误阻断。完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (HLS master pending variant boundary)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，固定实际 vendor 为 hls.js `1.6.16`。
- reviewedThrough / portedThrough: 均保持 `null`；本步闭合 master `STREAM-INF` pending regex 的跨行分支顺序，仍未完成 hls-engine cutover。
- change groups: `behavioral`（首 variant 声明所有权与中间 comment 吞并）和 `second-pass-projection`（夹在 pending match 内的 MEDIA 仍由独立扫描投影）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`；新增 1 个 active test ID 和 1 个固定上游 anchor。
- fixtures/tests: 新增 upstream-executable fixture `hls-master-pending-variant-boundary`；`hls.master-pending-variant-boundary` 覆盖连续 `STREAM-INF` 保留首个 bandwidth/resolution、中间 `DEFINE` 不创建变量并产生固定 missing-reference error、中间 `MEDIA` 仍产生 AUDIO rendition/group，以及 MEDIA 在第二次扫描中使用后置 `DEFINE`。
- accepted difference: 无。固定 vendor 对连续声明只输出 `100000 / 320x180 / video.m3u8`，对中间 DEFINE 报缺失变量，同时仍输出 interleaved AUDIO track；OmniFlow 保持相同选择投影。
- excluded changes and reasons: 不引入 content steering、session data 或 START 的 renderer DTO；这些字段不被 Cat Catch 当前下载选择与 `parseTs` 消费。
- unresolved gaps: HLS 其余真正影响下载的 parser 差分、加密 fMP4/video 与独立双轨的真实输出组合、真实网站手工验证和最终 hls-engine cutover。
- runtime changes: pure master parser 在已有 pending variant 时吞掉除 `EXT-X-MEDIA` 外的 `#` 行，直到首个非标签 URI 完成 variant；所有 MEDIA 延迟到首轮变量收集结束后统一投影，保留等价第二次扫描结果。现有 owner、IPC 和生产接线不变。
- legacy cleanup: 无；旧 HLS 执行链继续保留到 hls-engine 原子 cutover。
- validation: 失败证据为新增用例把连续声明错误投影成 `900000 / 1280x720`。实现后 parser `36/36`、完整 HLS 集合 `16 files / 108 tests`、全仓 ESLint、fixture/capability JSON、轻量 validator、固定上游 anchor 校验、同步校验 `16/16`、metadata `7 units / 32 capabilities / 203 anchors / 106 cleanup entries / 150 planned IDs / 104 active refs` 和 scoped diff check 通过。排除 Node 同步测试的全仓 Vitest 为 `1222 passed / 3 skipped`，唯一失败来自其他 Agent 在途的 `agent-orchestrator` 上传接口；TypeScript 同样只被该在途模块的 4 个类型错误阻断。完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (HLS rendition boolean boundary)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，固定实际 vendor 为 hls.js `1.6.16`。
- reviewedThrough / portedThrough: 均保持 `null`；本步闭合 master AUDIO/SUBTITLES rendition 的布尔属性大小写边界，仍未完成 hls-engine cutover。
- change groups: `behavioral`（固定 AttrList 枚举布尔判断）和 `selection-projection`（默认、自动选择与强制轨道标志）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`；新增 1 个 active test ID 和 1 个固定上游 anchor。
- fixtures/tests: 新增 upstream-executable fixture `hls-master-rendition-boolean-boundary`；`hls.master-rendition-boolean-boundary` 同时覆盖精确 `YES`、小写 `yes` 和混合大小写 `YeS/No/nO` 的 DEFAULT/AUTOSELECT/FORCED 投影。
- accepted difference: 无。固定 vendor 只把精确大写 `YES` 投影为 true，其余枚举值均为 false；OmniFlow 保持相同轨道标志。
- excluded changes and reasons: 不借此改变 rendition TYPE、语言、名称、URI、group 或 renderer 默认选择 owner，也不扩大到 master 数值属性归一化。
- unresolved gaps: HLS 其余真正影响下载与选择的 parser 差分、加密 fMP4/video 与独立双轨的真实输出组合、真实网站手工验证和最终 hls-engine cutover。
- runtime changes: pure parser 的 rendition boolean helper 从大小写无关归一化改为精确 `value === "YES"`；现有 DTO、authority、IPC 和生产接线不变。
- legacy cleanup: 无；旧 HLS 执行链继续保留到 hls-engine 原子 cutover。
- validation: 固定 vendor oracle 输出 Upper 三项 true、Lower/Mixed 三项 false；失败证据为本地把 Lower 三项和 Mixed DEFAULT 错误投为 true。实现后 parser `37/37`、完整 HLS 集合 `16 files / 109 tests`、TypeScript、全仓 ESLint、fixture/capability JSON、轻量 validator、固定上游 anchor 校验、同步校验 `16/16`、metadata `7 units / 32 capabilities / 204 anchors / 106 cleanup entries / 151 planned IDs / 105 active refs` 通过。排除 Node 同步测试的全仓 Vitest 为 `1236 passed / 3 skipped`，唯一失败来自其他 Agent 在途的 `agent-orchestrator` 资料库上传兜底断言。完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (HLS master variant numeric boundary)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，固定实际 vendor 为 hls.js `1.6.16`。
- reviewedThrough / portedThrough: 均保持 `null`；本步闭合 master variant typed quality 字段的 AttrList 数值边界，仍未完成 hls-engine cutover。
- change groups: `behavioral`（radix 10 decimalInteger 与 optionalFloat 前缀解析）和 `selection-projection`（质量排序与标签使用的 typed bandwidth/frame rate）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`；新增 1 个 active test ID 和 2 个固定上游 anchor。
- fixtures/tests: 新增 upstream-executable fixture `hls-master-variant-numeric-boundary`；`hls.master-variant-numeric-boundary` 覆盖整数/浮点合法前缀、`0x` radix 边界、AVERAGE-BANDWIDTH 小数截断、FRAME-RATE 与原始 RESOLUTION 保留。
- accepted difference: 无。固定 vendor 的 typed AttrList 结果为 `1000/900/29.97` 与 `0/3/0.5`；OmniFlow 保持相同数值投影，`rawAttributes` 仍保留原文本。
- excluded changes and reasons: 不改变 Cat Catch 实际展示的原始 attribute 字符串，不重定义 codec、resolution、variant merge 或 renderer selection owner，也不把异常 numeric 值扩散进 IPC。
- unresolved gaps: HLS 其余真正影响下载与选择的 parser 差分、加密 fMP4/video 与独立双轨的真实输出组合、真实网站手工验证和最终 hls-engine cutover。
- runtime changes: pure parser 新增固定 AttrList 等价的 decimal integer/floating-point helper；BANDWIDTH、AVERAGE-BANDWIDTH、FRAME-RATE 使用 typed 结果，SKIPPED-SEGMENTS 复用同一 integer helper且既有正数拒绝边界不变。DTO、authority、IPC 和生产接线不变。
- legacy cleanup: 无；旧 HLS 执行链继续保留到 hls-engine 原子 cutover。
- validation: 失败证据为本地把前缀值丢成 undefined、把 `0x100` 读成 256、把平均码率 `3.5` 保留为 3.5。实现后 parser `38/38`、完整 HLS 集合 `16 files / 110 tests`、TypeScript、全仓 ESLint、fixture/capability JSON、轻量 validator、固定上游 anchor 校验、同步校验 `16/16`、metadata `7 units / 32 capabilities / 206 anchors / 106 cleanup entries / 152 planned IDs / 106 active refs` 通过。本步未重复全仓 Vitest；紧邻上一提交的基线为 `1236 passed / 3 skipped`，唯一失败来自其他 Agent 的 `agent-orchestrator` 资料库上传兜底断言。完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (encrypted HLS fMP4 track merge output)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，继续验证已经迁入的 AES-128/MAP/独立双轨生产组合。
- reviewedThrough / portedThrough: 均保持 `null`；本步增加真实输出证据并修复 HLS 双 input ffmpeg 参数边界，仍未完成 hls-engine 或 output-integration cutover。
- change groups: `production-output`（加密 fMP4/H264 视频与独立 AES-128/AAC 音轨）和 `platform-adaptation`（ffmpeg input-scoped protocol/extension policy）。
- affected capability IDs: `hls.segment-pipeline` 保持 `porting`；`output.ffmpeg-process-owner` 保持 `pending`，因为非 HLS 的 4 个 ffmpeg 入口仍未统一；新增 1 个唯一 active test ID，不改变上游 anchor。
- fixtures/tests: `hls.real-encrypted-fmp4-track-merge-output` 用本机 ffmpeg 生成 clear fMP4/H264 视频后手工 AES-128-CBC 加密 init/segments，同时生成独立 AES-128/AAC 音轨；两轨分别经过 pure parser、download plan、本地下载和 playlist 重写，再由生产双轨 wrapper 合并，最后由 ffprobe 断言同一 MP4 包含 H264 与 AAC 流且时长为正。`hls.track-input-header-isolation` 同时锁定两个 `-i` 各自拥有 protocol/extension policy 和 protected headers。
- accepted difference: 无新增。Cat Catch 在扩展下载页执行解密/下载，OmniFlow 继续采用既有 Electron 平台替代：本地 playlist 保留 key/MAP 语义，由同一个可取消 ffmpeg owner 完成解密与双轨 mux。
- excluded changes and reasons: 不借此宣称 AES-256/AES-256-CTR 已通过真实输出，不改变 parser、renderer DTO、IPC、任务 owner 或资料库交付边界。
- unresolved gaps: HLS 其余真正影响下载与选择的 parser 差分、AES-256 系列真实输出、真实网站手工验证和最终 hls-engine cutover；非 HLS ffmpeg 入口继续留在 output-integration unit。
- runtime changes: manifest input policy 抽成固定参数组，并在 video/audio 两个 `-i` 前分别声明；此前只在首个 input 前声明时，第二轨的本地 `.key` 会被 ffmpeg 默认 `allowed_extensions` 策略拒绝。header 仍按轨隔离，进程、取消和 partial output 清理 owner 不变。
- legacy cleanup: 无；旧 HLS 执行链继续保留到 hls-engine 原子 cutover。
- validation: 修复前新增真实用例稳定失败于第二个 HLS input 拒绝 `.key`；实现后直接输出/参数测试 `2 files / 8 tests`、完整 HLS 集合 `16 files / 111 tests`、TypeScript、全仓 ESLint、capability JSON、轻量 validator、固定上游 anchor 校验和同步校验 `16/16` 通过，metadata 为 `7 units / 32 capabilities / 206 anchors / 106 cleanup entries / 153 planned IDs / 107 active refs`。排除需要 Node runner 的同步测试文件后，全仓 Vitest 为 `187 files / 1247 passed / 3 skipped`，同步 Node tests 单独 `16/16`；直接运行 `npm test` 的唯一失败是该 Node test 文件被 Vitest 收集后报告 no suite，并非代码断言失败。完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (HLS leading-whitespace token boundary)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，固定实际 vendor 为 hls.js `1.6.16`。
- reviewedThrough / portedThrough: 均保持 `null`；本步闭合 fast parser 的行首 whitespace/URI/tag 优先级，仍未完成 hls-engine cutover。
- change groups: `behavioral`（`LEVEL_PLAYLIST_REGEX_FAST` 的 URI alternative 抢占顺序）和 `download-projection`（零时长 fragment、media sequence 与 AES implicit IV）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`；新增 1 个 active test ID，复用已登记的固定 fast regex anchor。
- fixtures/tests: 新增 upstream-executable fixture `hls-leading-whitespace-token-boundary`；`hls.leading-whitespace-token-boundary` 覆盖 ASCII space 前缀的 MEDIA-SEQUENCE 被当作 fragment、tab 前缀仍被当作标签，以及 space 前缀 EXTM3U 保持格式头错误。
- accepted difference: 无。固定 vendor 对 space-tag 输入输出 `sn=0..1`、首片为 manifest fragment URL 且未加密、第二片 IV 为 sequence 1；tab-tag 只输出 `sn=10` 与 IV 10；OmniFlow 保持相同下载投影。
- excluded changes and reasons: 不借此迁入 PROGRAM-DATE-TIME、DATERANGE、BITRATE 等 Cat Catch `parseTs` 不消费的播放 metadata，也不修改 line ending、valued-tag payload、IPC 或 renderer。
- unresolved gaps: HLS 其余真正影响下载与选择的 parser 差分、AES-256 系列真实输出、真实网站手工验证和最终 hls-engine cutover。
- runtime changes: pure parser 不再统一 `trimStart()` 每一行，而是保留固定 regex 的细分顺序：`#` 前紧邻 ASCII space 时该行留在 URI 路径，tab-only 等前缀则跳过后进入 tag 路径。普通 URI 仍由 URL resolver 去除外围 whitespace，后续状态 owner 不变。
- legacy cleanup: 无；旧 HLS 执行链继续保留到 hls-engine 原子 cutover。
- validation: 隔离 VM 内的固定 vendor executable oracle 产生上述三类结果；失败证据为当前 parser 把 space-tag 错读为 `mediaSequence=10 / 1 fragment / IV=10`。实现后 parser `39/39`、完整 HLS 集合 `16 files / 112 tests`、TypeScript、全仓 ESLint、fixture/capability JSON、轻量 validator、固定上游 anchor 校验、同步校验 `16/16`、metadata `7 units / 32 capabilities / 206 anchors / 106 cleanup entries / 154 planned IDs / 108 active refs` 和 scoped diff check 通过。本步未重复全仓 Vitest；同工作树紧邻提交 `1ba4337` 的基线为 `187 files / 1247 passed / 3 skipped`，同步 Node tests 单独 `16/16`。完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (HLS retry cancellation and Range evidence)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，继续验证固定 Cat Catch downloader 的 range/retry/abort 组合语义。
- reviewedThrough / portedThrough: 均保持 `null`；本步激活 `hls.segment-pipeline` 最后一个尚无等名证据的 planned test ID，但未完成 hls-engine cutover。
- change groups: `behavioral-evidence`（每个 retry 保持同一 byte Range）和 `stability`（活动 retry 取消后队列与处理链不再推进）。
- affected capability IDs: `hls.segment-pipeline` 保持 `porting`；新增 1 个 active test ref，不增加计划 ID 或上游 anchor。
- fixtures/tests: 不新增 fixture；`embeddedBrowserFragmentDownloader.test.ts#hls.retry-cancel-range` 现在先让带 `bytes=5-7` 的 fragment 返回 503，再证明第二个 attempt 保持相同 Range，在该 retry 进行中取消后无第三次 fetch、processor、completed 或 allCompleted，并且只发出一次 aborted 终态。
- accepted difference: Cat Catch 按 `500ms * retryCount` 延迟自动重试；OmniFlow 继续使用既有有界立即重排队。URL/Range、最大次数、活动请求中止、队列停止和终态语义保持等价，不引入扩展页面的 retry UI。
- excluded changes and reasons: 不为延迟文案新增 timer/backoff，不借测试证据重写 downloader scheduler，也不扩大到跨 HLS/DASH/MSE 的通用任务中心。
- unresolved gaps: `hls.segment-pipeline` 的保留 planned IDs 均已有等名 active refs，但 capability 仍因完整 hls-engine cutover、旧 pipeline 清理、AES-256 系列真实输出和真实网站手工验证而保持 `porting`；其余 parser 差分继续按下载消费边界推进。
- runtime changes: 无生产代码变化；既有 downloader 已满足组合行为，本步把此前仅覆盖单次中止的同名测试改成真实 retry/range/cancel 回归合同。
- legacy cleanup: 无；旧 HLS 执行链继续保留到 hls-engine 原子 cutover。
- validation: 加强后的 downloader 专项 `5/5`、完整 HLS 集合 `18 files / 118 tests`、TypeScript、全仓 ESLint、capability JSON、轻量 validator、固定上游 anchor 校验、同步测试 `16/16`、metadata `7 units / 32 capabilities / 206 anchors / 106 cleanup entries / 154 planned IDs / 109 active refs` 和 scoped diff check 通过。排除由 Node runner 单独执行的同步测试文件后，全仓 Vitest 为 `187 files / 1249 passed / 3 skipped`。完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (HLS shared contract and plan owner)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步只收敛已经迁入的 HLS DTO 与计划 owner。
- reviewedThrough / portedThrough: 均保持 `null`；hls-engine 尚未完成整体 cutover，不能因内部 owner 收敛提前推进游标。
- change groups: `architecture-boundary`（shared contract 与 main/renderer 依赖方向）和 `behavior-preserving`（原 plan projection 原样进入 pure port）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`；新增 contract/plan target refs、1 个 planned ID 和 1 个 active ref，不改变上游 anchor。
- fixtures/tests: 不新增 fixture；`hls.contract-plan-single-owner` 断言 renderer 兼容出口的 parser、plan 与 segment-query 函数分别和 pure owner 是同一引用。既有 parser/authority/local/live/真实 ffmpeg 与 renderer hook 测试继续锁定结构调整前后的产物等价。
- accepted difference: 无新增；DTO 增加此前 runtime parser 已真实携带、但 renderer 重复类型漏写的 `segment.encrypted` 字段，不改变序列化对象或 IPC payload。
- excluded changes and reasons: 不在本步修改 UI、IPC 字段、preload 暴露面、下载器调度、直播 owner 或 ffmpeg。与其他 Agent 修改重叠的 preload/electron-env 类型注解暂时继续引用 renderer compatibility export，避免把对方改动带入本提交。
- unresolved gaps: renderer service/components 仍经薄 compatibility model 导入共享类型与 pure 函数；该文件的两个 legacy symbol 继续留到 hls-engine 原子 cutover。完整 parser 差分、AES-256 系列真实输出、旧 local/live/controller owner 删除和真实网站手工验证仍待完成。
- runtime changes: 新增 `contracts/hls.ts` 作为共享 DTO owner，新增 `cat-catch-port/hls/plan.ts` 作为下载计划 owner；parser 类型改为共享 contract alias。Electron main 的 controller types、authority、live recorder、track merge 与 output tests 不再反向 import renderer HLS model；renderer model 缩为同名 re-export。
- legacy cleanup: `node.hls.renderer-parser-planner` 与 `node.hls.renderer-download-plan` 仍为 `remove-after-cutover`，本步没有伪报删除；local downloader/live recorder/controller entries 不变。
- validation: 完整 HLS `19 files / 119 tests`、TypeScript、全仓 ESLint、capability JSON、轻量 validator、固定上游 anchor 校验、同步测试 `16/16`、metadata `7 units / 32 capabilities / 206 anchors / 106 cleanup entries / 155 planned IDs / 110 active refs`、Electron service 生产源码反向依赖搜索和 scoped diff check 通过。排除由 Node runner 单独执行的同步测试文件后，全仓 Vitest 为 `188 files / 1250 passed / 3 skipped`。首次 contract test 因相对路径多退一层而加载失败，修正后专项、TypeScript、HLS 与全仓回归全部重跑通过。完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (HLS renderer facade detachment)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步继续收敛本地依赖而不重新分类上游。
- reviewedThrough / portedThrough: 均保持 `null`；hls-engine 仍未整体关闭。
- change groups: `architecture-boundary`（renderer/preload 调用方向）和 `pre-cutover-cleanup`（让 legacy façade 无生产调用方但继续保留删除 sentinel）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`；planned IDs、active refs、target refs 和 anchors 均不变。
- fixtures/tests: 不新增 fixture 或占位测试；既有 `hls.contract-plan-single-owner` 继续证明 compatibility exports 与 pure owner 同一引用，HLS hook/parser/main IPC/rendition 测试覆盖迁移后的生产调用路径。
- accepted difference: 无；所有导入迁移只改变 TypeScript module owner，不改变 manifest/plan 对象、preload 字段或 IPC channel。
- excluded changes and reasons: validator 要求未关闭 unit 的 `currentImplementationRefs` 与 `remove-after-cutover` symbol 必须继续存在，因此本步不删除 renderer model，也不修改 legacy cleanup 合同。没有新增全仓 AST/import 分析器；使用 TypeScript、ESLint 和定向源码搜索作为本步证据。
- unresolved gaps: renderer model 只剩两个 parity test caller；待 local downloader、live recorder 和 controller task owner 一起达到 cutover 条件后，才能原子删除该文件和两个 legacy cleanup entry。完整 parser 差分、AES-256 系列真实输出与真实网站手工验证仍待完成。
- runtime changes: preload/electron-env 的 plan type、renderer resource components/service、tool-workspace hook/types 和 library detail view 全部改为直接 import shared contract 或 pure parser/plan/segment-query；生产源码已无旧 HLS model 引用。
- legacy cleanup: 两个 renderer legacy symbol 继续存在且仍标记 `remove-after-cutover`；没有提前移动状态或删除清单。
- validation: 完整 HLS `19 files / 119 tests`、TypeScript、全仓 ESLint、轻量 validator、固定上游 anchor 校验、同步测试 `16/16`、metadata `7 units / 32 capabilities / 206 anchors / 106 cleanup entries / 155 planned IDs / 110 active refs`、生产引用搜索和 scoped diff check 通过；旧 model 只剩 2 个明确 parity test caller。排除由 Node runner 单独执行的同步测试文件后，全仓 Vitest 为 `188 files / 1250 passed / 3 skipped`。迁移后首轮 TypeScript/ESLint 暴露一个已无用途的 plan type import，删除后所有门禁完整重跑通过。完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (HLS local and live processing owners)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步只把已有且已验证的执行逻辑放入既定 target owner。
- reviewedThrough / portedThrough: 均保持 `null`；hls-engine 仍有 controller plan task、parser 差分和原子 cleanup 未完成。
- change groups: `architecture-boundary`（local/live production owner）和 `pre-cutover-cleanup`（旧入口缩为同引用 façade）。
- affected capability IDs: `hls.segment-pipeline` 与 `hls.live-recording` 保持 `porting`；新增 1 个 planned ID 和 1 个 active ref，不增加上游 anchor。
- fixtures/tests: 不新增媒体 fixture；`hls.processing-owner-boundary` 证明默认 executor 是 `HlsTaskExecutor` 实例，并且两个旧入口分别与 target function/class 保持同一引用。原 local/live/track/output 测试改为直接运行 target owner。
- accepted difference: 无；移动不改变 key/map/segment fetch、Range、重试、playlist、直播轮询、取消、事件或 ffmpeg 行为。
- excluded changes and reasons: controller 继续拥有 authority、保存路径、IPC response、任务事件和 ffmpeg 产品编排；本步不顺手制造通用 task framework，也不删除 validator 仍要求存在的 legacy symbol。
- unresolved gaps: `downloadEmbeddedBrowserHlsPlanResource` 的执行编排仍在 controller；完整 parser 差分、AES-256 系列真实输出、真实网站手工验证和 hls-engine 原子 cutover 仍待完成。
- runtime changes: 本地 key/map/segment 下载与 playlist 重写迁入 `processing/hls-task.ts#HlsTaskExecutor`，直播 poll/cumulative plan 迁入 `processing/hls-live-task.ts#HlsLiveTask`；controller、local track merge、live task 与 output tests 均直接依赖 target。旧顶层 downloader/recorder 文件只保留同函数/同 class re-export。
- legacy cleanup: `node.hls.local-downloader` 与 `node.hls.live-recorder` 继续标记 `remove-after-cutover`，但已无生产调用方；controller plan task 和 renderer façade sentinel 不变。
- validation: target owner 首轮专项 `5 files / 24 tests`、完整 capability HLS 集合 `19 files / 118 tests`、TypeScript、全仓 ESLint、固定上游 validator、同步测试 `16/16`、metadata `7 units / 32 capabilities / 206 anchors / 106 cleanup entries / 156 planned IDs / 111 active refs` 和 scoped diff check 通过。排除由 Node runner 单独执行且已通过 `16/16` 的同步测试文件后，全仓 Vitest 为 `189 files / 1251 passed / 3 skipped`；未排除时其余测试仍全部通过，但 Vitest 按预期把该 Node 文件报告为无 suite。完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (HLS plan and retry execution sequence)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步收敛既有 plan/retry 运行序列。
- reviewedThrough / portedThrough: 均保持 `null`；hls-engine 尚未达到完整差分和原子 cleanup 条件。
- change groups: `architecture-boundary`（task sequence owner）和 `behavior-preserving`（首次执行/retry 阶段与 session 顺序）。
- affected capability IDs: `hls.segment-pipeline` 保持 `porting`；新增 1 个 planned ID 和 1 个 active ref，不增加上游 anchor。
- fixtures/tests: 不新增媒体 fixture；`hls.plan-task-executor` 用注入的 local/ffmpeg fake 锁定 retry fragment index、preprocess、local playlist handoff、阶段事件和完成前 cleanup 顺序。
- accepted difference: 无；首次与 retry 的 fetch、Range、手动 key、输出、错误和取消语义不变。
- excluded changes and reasons: executor 不读取 capture runtime、不选择保存路径、不持有 session owner、不构造 IPC response，也不新增跨 DASH/MSE 的通用任务框架。legacy-named controller handler 继续保留到 unit 原子切换。
- unresolved gaps: HLS parser 其余下载相关标签差分、AES-256 系列真实输出、真实网站手工验证和 hls-engine cleanup 仍待完成。
- runtime changes: `HlsTaskExecutor.executePlanToOutput` 成为首次 plan 与 failed-fragment retry 的唯一 local -> rewritten playlist -> ffmpeg owner；controller 通过 main-owned fetch 和 ffmpeg adapter 调用它，只映射任务投影、维护 retry session 与产品错误响应。retry 成功仍先移除 session，再发送 completed。
- legacy cleanup: `node.hls.plan-task` 继续标记 `remove-after-cutover`，但对应函数已缩为 authority/save/session/IPC adapter；local/live/renderer façade sentinel 不变。
- validation: executor/controller 首轮专项 `5 files / 22 tests`、完整 capability HLS 集合 `19 files / 119 tests`、TypeScript、全仓 ESLint、固定上游 validator、同步测试 `16/16`、metadata `7 units / 32 capabilities / 206 anchors / 106 cleanup entries / 157 planned IDs / 112 active refs` 和 scoped diff check 通过。排除由 Node runner 单独执行的同步测试文件后，全仓 Vitest 为 `189 files / 1253 passed / 3 skipped`。完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (HLS attribute value whitespace boundary)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步继续补固定 hls.js AttrList 的下载相关词法语义。
- reviewedThrough / portedThrough: 均保持 `null`；hls-engine 仍未完成其余 parser 差分和原子 cleanup。
- change groups: `behavioral-correction`（key method/clear 继承）和 `selection-parity`（rendition type/boolean）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`；新增 1 个 fixed upstream anchor、1 个 planned ID 和 1 个 active ref。
- fixtures/tests: `hls-attribute-value-whitespace-boundary` 同时锁定 media 的无效 `AES-128 `、有效 AES-128 与无效 `NONE ` 继承，以及 master 的 `DEFAULT=YES `、`AUTOSELECT= YES` 和 `TYPE=AUDIO ` 选择边界；manifest 与 download plan 都断言有效 key/IV。
- accepted difference: 无。pure parser 直接使用固定 `AttrList.parseAttrList` 正则并把 raw tag payload 交给它，只 trim attribute 名称，保留未加引号 value 的首尾空格。
- excluded changes and reasons: 本步不迁移 `PROGRAM-DATE-TIME/DATERANGE/GAP/BITRATE/START` 等未被 Cat Catch `parseTs` 消费的展示或播放字段，也不修改 DTO、IPC、authority、downloader 或 UI。
- unresolved gaps: HLS 其余真正影响 URL/sequence/cc/key/MAP/range/duration/可执行性的 parser 差分、AES-256 系列真实输出、真实网站手工验证和 hls-engine cleanup 仍待完成。
- runtime changes: 删除本地宽松 attribute scanner，改用固定上游 AttrList regex；所有 AttrList 调用改收原始 tag payload。空格污染的 key method 不再错误替换或清除当前 key，非精确 rendition flag/type 不再被本地 trim 提升。
- legacy cleanup: 无；旧 HLS compatibility façade 和 legacy-named controller adapter 继续保留到 hls-engine 原子 cutover。
- validation: 固定 vendor executable oracle 输出第一片 clear、后两片沿用 `active.key` 且 implicit IV 分别为 11/12；master 只输出 `Spaced flags` 一条 AUDIO rendition，其 DEFAULT/AUTOSELECT 为 false、FORCED 为 true。新增测试在修改前稳定收到 2 条 rendition 且 flag 被提升为 true，实现后 parser `40/40`、完整 HLS 集合 `19 files / 120 tests`、TypeScript、全仓 ESLint、fixture/capability JSON、固定上游 validator、同步测试 `16/16`、metadata `7 units / 32 capabilities / 207 anchors / 106 cleanup entries / 158 planned IDs / 113 active refs` 和 scoped diff check 通过。排除 Node runner 文件后，全仓 Vitest 为 `189 files / 1255 passed / 3 skipped`。完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (HLS PART duration fragment boundary)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步继续补固定 hls.js LL-HLS PART 对完整 fragment 的状态影响。
- reviewedThrough / portedThrough: 均保持 `null`；hls-engine 仍未完成其余 parser 差分和原子 cleanup。
- change groups: `behavioral-correction`（PART duration 累计/EXTINF 覆盖）与 `executability-boundary`（非有限 duration 抑制紧随 URI）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`；新增 1 个 planned ID 和 1 个 active ref，不增加上游 anchor。
- fixtures/tests: 新增 upstream-executable fixture `hls-part-duration-fragment-boundary`；`hls.part-duration-fragment-boundary` 锁定无 EXTINF 时两个 PART 累计为 3 秒、有效 EXTINF 覆盖后再累计为 5 秒、非有限 PART duration 抑制紧随 URI且下一条有效 EXTINF 恢复，并同时断言 manifest 与 download plan 不包含 PART URL。
- accepted difference: 无。固定 `LevelDetails.partList` 仍不进入 Cat Catch `parseTs` 下载列表；只保留 PART 已经施加到当前 fragment 的 duration/URL/sequence 状态。
- excluded changes and reasons: 本步不投影 `PART-INF` 播放 metadata、PART URL、PRELOAD-HINT 或 rendition report，不修改 DTO、IPC、authority、live owner、downloader 或 UI。
- unresolved gaps: HLS 其余真正影响 URL/sequence/cc/key/MAP/range/duration/manifest executability 的 parser 差分、AES-256 系列真实输出、真实网站手工验证和 hls-engine cleanup 仍待完成。
- runtime changes: 精确 `EXT-X-PART:` 解析固定 AttrList 并把 DURATION 累加到当前 pending segment；后续有效 EXTINF 继续覆盖该值，非有限累计沿用既有 addSegment 抑制分支。相似前缀保持 fallback，PART URL 和 partCount 行为不变。
- legacy cleanup: 无；旧 HLS compatibility facade 和 legacy-named controller adapter 继续保留到 hls-engine 原子 cutover。
- validation: 固定 vendor executable oracle 输出 `totalduration=12` 与 3 个 fragment，duration 依次为 `3/5/4`；修改前 pure parser 错误输出 4 个 fragment，duration 为 `0/4/4/4`。实现后 parser `41/41`、完整 HLS 集合 `19 files / 121 tests`、TypeScript、全仓 ESLint、fixture/capability JSON、固定上游 validator、同步测试 `16/16` 和 metadata `7 units / 32 capabilities / 207 anchors / 106 cleanup entries / 159 planned IDs / 114 active refs` 通过；排除 Node runner 文件后全仓 Vitest 为 `189 files / 1256 passed / 3 skipped`。首轮 TypeScript 暴露测试投影 helper 过度绑定 manifest segment 类型，收窄到实际断言字段后 parser 与 TypeScript 重跑通过。完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (HLS empty segment URI rejection)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步补固定变量替换与 fragment URL 物化的异常边界。
- reviewedThrough / portedThrough: 均保持 `null`；hls-engine 仍未完成其余 parser 差分和原子 cleanup。
- change groups: `executability-boundary`（空 segment URL）与 `state-integrity`（duration/sequence/key/MAP context 不得因静默删片前移）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`；新增 1 个 planned ID 和 1 个 active ref，不增加上游 anchor。
- fixtures/tests: 新增 upstream-executable fixture `hls-empty-segment-uri-rejection`；`hls.empty-segment-uri-rejection` 锁定 `EXT-X-DEFINE` 空值使中间 segment URI 替换为空时必须在 manifest/plan 形成前稳定拒绝，并证明非有限 PART duration 会在变量替换前抑制该 URI、下一条有效 EXTINF 仍能恢复。
- accepted difference: 固定 hls.js 会保留中间的 `url=""` fragment，让它占用 duration、sequence 和 key/MAP context；Cat Catch `parseTs` 随后把空 URL 投影到下载列表。OmniFlow 不执行空 URL 下载，而是报 `HLS segment URI must resolve to a non-empty string`；不得用静默删片替代拒绝。
- excluded changes and reasons: 不修改合法变量值、未定义/重复变量错误、MAP URI 规则、普通 URL resolution、downloader、authority、IPC 或 UI；不借本步扩建通用 URL parser。
- unresolved gaps: HLS 其余真正影响 URL/sequence/cc/key/MAP/range/duration/manifest executability 的 parser 差分、固定 url-toolkit 与 native URL 的边界、AES-256 系列真实输出、真实网站手工验证和 hls-engine cleanup 仍待完成。
- runtime changes: `addSegment` 先按固定分支顺序抑制非有限 pending duration，再在变量替换后的 URI 为空时登记首个 playlist parsing error，随后由既有 parser error gate 拒绝整个 manifest；普通 fragment 状态与计划 DTO 不变。
- legacy cleanup: 无；旧 HLS compatibility facade 和 legacy-named controller adapter 继续保留到 hls-engine 原子 cutover。
- validation: 固定 vendor executable oracle 对可物化输入输出 `totalduration=8`，第一片为 `sn=0 / duration=4 / url=""`，第二片为 `sn=1 / duration=4 / valid.ts`；Cat Catch `parseTs` 对两片均直接投影 fragment URL。非有限 PART duration 输入则只输出恢复后的 `sn=0 / duration=4 / recovered.ts`。失败测试先稳定得到 parser `41/42`，实现和分支顺序自审后 parser `42/42`、完整 HLS 集合 `19 files / 122 tests`、TypeScript、全仓 ESLint、fixture/capability JSON、固定上游 validator、同步测试 `16/16` 和 metadata `7 units / 32 capabilities / 207 anchors / 106 cleanup entries / 160 planned IDs / 115 active refs` 通过；排除 Node runner 文件后全仓 Vitest 为 `189 files / 1257 passed / 3 skipped`。完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (HLS effective request URL authority)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步固定 raw parser URL 到实际网络请求 URL 的平台边界。
- reviewedThrough / portedThrough: 均保持 `null`；hls-engine 仍未完成其余 parser 差分和原子 cleanup。
- change groups: `upstream-characterization`（固定 url-toolkit raw URL）与 `authority-boundary`（浏览器 canonicalization 后的 current-tab resource 精确命中）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`；新增 2 个 planned ID 和 2 个 active ref，不增加上游 anchor。
- fixtures/tests: 新增 upstream-executable fixture `hls-effective-url-canonicalization`；`hls.effective-url-canonicalization` 并列记录 literal space、encoded dot segment、反斜杠和越过 origin root traversal 的 `upstreamUrl` 与 `effectiveRequestUrl`，`hls.effective-url-authority` 证明 canonical fragment URL 能精确兑换当前 tab 已捕获 resource。
- accepted difference: 固定 hls.js 的 url-toolkit 先生成 raw fragment URL，Cat Catch 随后把它交给浏览器 `fetch`，由 WHATWG URL 规则得到实际请求目标。OmniFlow 直接在 manifest/plan 中保存该 canonical target；中间字符串可能不同，但最终网络 URL 相同，并使 main-owned authority 能恢复已捕获的 Cookie/Authorization，而不是因 raw 字符串不相等退化到无上下文 fetch。
- excluded changes and reasons: 不引入第二套 URL resolver、不修改 capture store 的 exact-match authority、不扩建通用源码分析器，也不修改 downloader、IPC 或 UI。固定 vendor raw URL 仅作为 fixture oracle，不进入生产 DTO。
- unresolved gaps: HLS 其余真正影响 URL/sequence/cc/key/MAP/range/duration/manifest executability 的 parser 差分、AES-256 系列真实输出、未捕获资源 fallback、真实网站手工验证和 hls-engine cleanup 仍待完成。
- runtime changes: 无行为代码变化；既有 native `new URL` 已等价于 Cat Catch `fetch` 最终 canonicalization，本步补充 provenance 注释、vendor oracle、parser fixture 和 main authority integration contract，防止未来为了机械匹配 url-toolkit 而破坏有效网络目标及凭据继承。
- legacy cleanup: 无；旧 HLS compatibility facade 和 legacy-named controller adapter 继续保留到 hls-engine 原子 cutover。
- validation: parser/authority 专项 `2 files / 50 tests`、完整 HLS 集合 `19 files / 124 tests`、TypeScript、全仓 ESLint、fixture/capability JSON、固定上游 validator、同步测试 `16/16` 和 metadata `7 units / 32 capabilities / 207 anchors / 106 cleanup entries / 162 planned IDs / 117 active refs` 通过；排除 Node runner 文件后全仓 Vitest 为 `189 files / 1259 passed / 3 skipped`。完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (HLS AES-256 local output)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步关闭固定 hls.js full-segment AES-256 到本地 ffmpeg 输出的已知断点。
- reviewedThrough / portedThrough: 均保持 `null`；hls-engine 仍有 parser 差分、legacy cleanup 与真实网站验证未完成。
- change groups: `behavioral-correction`（AES-256 CBC/CTR 可交付输出）、`platform-substitute`（ffmpeg 前 Web Crypto）与 `output-proof`（真实 ffmpeg/ffprobe）。
- affected capability IDs: `hls.segment-pipeline` 保持 `porting`；新增 3 个 planned ID、3 个 active ref 和 1 个 target function，不增加上游 anchor。
- fixtures/tests: 新增 upstream-executable fixture `hls-aes256-full-segment-output`；`hls.decrypt-aes256-full-segment` 锁定 CBC/CTR mode 与 32-byte key，`hls.aes256-local-predecrypt` 同时验证加密 MAP、media、key cache identity 和 clear playlist，`hls.real-aes256-local-output` 对两种 METHOD 均生成真实 AAC HLS 密文并经生产本地下载链、ffmpeg、ffprobe 交付正时长 MP4。
- accepted difference: 固定 full hls.js 已实现 `AES-256 -> AES-CBC`、`AES-256-CTR -> AES-CTR(length=64)`，但 Cat Catch 自有 m3u8 downloader 只实例化 AES-128-oriented JavaScript decryptor；ffmpeg 8.1 HLS demuxer也不识别这两个 METHOD，预检会把密文当明文并在首片失败。OmniFlow 在 main-owned 本地工作目录中按固定 hls.js Web Crypto 语义消费对应 key/IV，随后只从 clear playlist 移除已消费的 AES-256 key state，最终功能覆盖固定依赖而不复制其下载器断层。
- excluded changes and reasons: AES-128 继续保留 key/IV 标签并交给既有单一 ffmpeg owner；不修改 parser DTO、IPC、renderer、authority、直播 owner或通用 fragment downloader，也不引入新的跨协议加密框架。
- unresolved gaps: CBC encrypted MAP 使用非零 BYTERANGE 时，固定 hls.js 会按未加密长度扩展 range，并在非零 offset 前取一个 ciphertext block 重置 IV；该稀有组合尚无本地合同。其余 parser 可执行性差分、真实网站、旧 façade/controller adapter 与 hls-engine 原子 cleanup 仍待完成。
- runtime changes: `decryptHlsFullSegment` 成为 AES-128/256 CBC 与 AES-256 CTR 的 pure Web Crypto owner；本地 task 对 AES-256 key 强制 32 bytes、IV 强制 16 bytes，在 PNG/JPEG prefix 预处理后解密 media，并在 MAP 写盘前按独立 declaration-time key context 解密。MAP cache 只在本地解密时加入 key/IV identity；最终 playlist 使用原资源身份查找文件、使用 clear key state 写标签，避免状态查找互相污染。
- legacy cleanup: 无；本步扩充 target pipeline，不提前删除任何 cleanup sentinel。
- validation: AES 专项 `3 files / 17 tests`、完整 HLS `19 files / 127 tests`、TypeScript、scoped 与全仓正式 ESLint、fixture/capability JSON、固定上游 validator、同步测试 `16/16` 和 metadata `7 units / 32 capabilities / 207 anchors / 106 cleanup entries / 165 planned IDs / 120 active refs` 通过；排除 Node runner 文件后全仓 Vitest 为 `189 files / 1262 passed / 3 skipped`。真实 ffmpeg 8.1/ffprobe 门禁实际运行 CBC/CTR 两种输出。完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (HLS CBC encrypted MAP byte range)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步关闭固定 FragmentLoader 对 CBC 加密 ranged init segment 的经验分支。
- reviewedThrough / portedThrough: 均保持 `null`；hls-engine 仍有其余 parser/processing 差分、legacy cleanup 与真实网站验证未完成。
- change groups: `behavioral-correction`（cipher range/IV）与 `platform-substitute`（本地 clear MAP）。
- affected capability IDs: `hls.segment-pipeline` 保持 `porting`；新增 1 个 planned ID、1 个 active ref 和固定 `resetIV` anchor。
- fixtures/tests: 新增 upstream-executable fixture `hls-cbc-map-byterange-output`；`hls.cbc-map-byterange-decrypt` 用同一 ranged object 覆盖 AES-128/AES-256，断言声明 `31@32` 产生 `bytes=16-63`、前 16 bytes 重置 IV、MAP 精确恢复 31-byte clear payload，且 clear playlist 不再携带已消费的 MAP key。另有 case 稳定拒绝 `1..15` 的非零 offset。
- accepted difference: Cat Catch 自有 MAP fetch 直接请求 parser range 且不解密 MAP，没有复用其固定 hls.js 依赖的 FragmentLoader 分支。OmniFlow 以固定依赖为行为目标：CBC 明文 length 向 block 补齐，非零 offset 前取一个 ciphertext block；只对这类 AES-128 MAP 做本地预解密，普通 AES-128 media/MAP 仍由单一 ffmpeg owner。
- excluded changes and reasons: 不修改 parser DTO、media BYTERANGE、AES-CTR range、IPC、authority、renderer、live owner 或通用 downloader；不把这条协议分支扩建成跨格式加密框架。
- unresolved gaps: HLS 其余真正影响 URL/sequence/cc/key/MAP/range/duration/manifest executability 的差分、未捕获资源 fallback、真实网站验证、旧 façade/controller adapter 与 hls-engine 原子 cleanup 仍待完成。
- runtime changes: MAP 静态 ref 可按原 ref 派生实际 request range；CBC ranged MAP 在写盘前按前块 IV 与声明时 key context 使用 Web Crypto 解密并裁到明文 length。需要本地解密的 MAP cache identity 同时绑定 key/IV，media 解密、retry/cancel 与 ffmpeg owner 不变。
- legacy cleanup: 无；本步扩充 target pipeline，不提前删除任何 cleanup sentinel。
- validation: local downloader 专项 `1 file / 10 tests`、完整 HLS 集合 `20 files / 131 tests`、TypeScript、全仓 ESLint、fixture/capability JSON、固定上游 validator、同步测试 `16/16` 和 metadata `7 units / 32 capabilities / 208 anchors / 106 cleanup entries / 166 planned IDs / 121 active refs` 通过；排除 Node runner 文件后全仓 Vitest 为 `189 files / 1264 passed / 3 skipped`。完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (HLS no-value tag prefix boundary)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步补齐固定 slow regex 无值标签前缀的可执行证据。
- reviewedThrough / portedThrough: 均保持 `null`；hls-engine 仍有其余 parser/processing 差分、legacy cleanup 与真实网站验证未完成。
- change groups: `upstream-characterization`（无终止边界的标签名匹配）与 `behavioral-correction`（singleton error reason）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`；新增 1 个 planned ID 和 1 个 active ref，不增加上游 anchor。
- fixtures/tests: 新增 upstream-executable fixture `hls-no-value-tag-prefix-boundary`；`hls.no-value-tag-prefix-boundary` 锁定 `DISCONTINUITY-FOO` 与未命中整数分支的 `DISCONTINUITY-SEQUENCE:-3` 分别推进 cc、`ENDLIST-FOO` 结束 live，并同步断言 manifest/download plan。重复 `ENDLIST` 伪前缀必须拒绝且 reason 只包含规范 match。
- accepted difference: 无。固定 vendor 实际输出两片 `cc=1/2`、`live=false`；重复伪前缀发出 fatal `levelParsingError`，reason 为 `#EXT-X-ENDLIST must not appear more than once (#EXT-X-ENDLIST)`。
- excluded changes and reasons: `GAP/INDEPENDENT-SEGMENTS` 未被 Cat Catch `parseTs` 投影为下载 DTO，不新增无消费者字段；不修改 valued-tag 分支、IPC、authority、downloader 或 UI。
- unresolved gaps: HLS 其余真正影响 URL/sequence/cc/key/MAP/range/duration/manifest executability 的差分、未捕获资源 fallback、真实网站验证、旧 façade/controller adapter 与 hls-engine 原子 cleanup 仍待完成。
- runtime changes: 现有 `startsWith` 分支已经保持 cc/endList 行为；只把重复 ENDLIST error 的 source projection 从完整伪标签收敛为固定 regex 实际命中的 `#EXT-X-ENDLIST`。
- legacy cleanup: 无；旧 compatibility facade 和 legacy-named controller adapter 保留到 hls-engine 原子 cutover。
- validation: parser 专项 `1 file / 44 tests`、TypeScript、全仓 ESLint、同步测试 `16/16`、metadata `7 units / 32 capabilities / 208 anchors / 106 cleanup entries / 167 planned IDs / 122 active refs` 通过；排除 Node runner 文件后全仓 Vitest 为 `189 files / 1265 passed / 3 skipped`。完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (HLS key URI and manual fallback)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步补齐固定 hls.js keyless encrypted projection 与 Cat Catch custom key 经验分支。
- reviewedThrough / portedThrough: 均保持 `null`；hls-engine 仍有其余 parser/processing 差分、legacy cleanup 与真实网站验证未完成。
- change groups: `upstream-characterization`（缺失/空/空白 KEY URI）与 `behavioral-correction`（手动 AES-128 recovery 和 prefetch rejection）。
- affected capability IDs: `hls.parser-planner` 保持 `ported-unverified`，`hls.segment-pipeline` 保持 `porting`；新增 2 个 planned ID 和 2 个 active ref，不增加上游 anchor。
- fixtures/tests: 新增 upstream-executable fixture `hls-key-uri-manual-fallback`；`hls.key-uri-projection` 锁定固定 vendor 的 `encrypted=true/decryptdata=null` 与空白 URI 回指 playlist 行为，`hls.manual-key-fallback` 锁定无手动 key 的 fetch 前拒绝、缺 key URI 的手动恢复、完全无 key 信号时的手动恢复，以及 MAP-only key 不污染明文 media。
- accepted difference: 固定 hls.js + Cat Catch 会把缺失/空 URI 的 ciphertext 留在 keyless fragment，或把空白 URI 的 playlist 当 key 请求；OmniFlow 保留 encrypted 事实但禁止无 key 执行。Cat Catch custom key 无条件标记全部 fragment 加密；OmniFlow 只覆盖有 media 加密信号的分片，或在整个 manifest 无任何 key 信号时覆盖全部 media，避免 encrypted MAP-only playlist 的 clear media 被错误解密。
- excluded changes and reasons: 不修改 renderer 输入格式、IPC、key candidate 验证 UI、MAP 的声明时 key context、AES-256 或 DRM 执行策略；手动 key 仍只接受既有 16-byte AES-128 base64 合同。
- unresolved gaps: HLS 其余真正影响 URL/sequence/cc/key/MAP/range/duration/manifest executability 的差分、真实手工站点、未捕获资源 fallback、旧 façade/controller adapter 与 hls-engine 原子 cleanup 仍待完成。
- runtime changes: download plan 新增 renderer-safe `encrypted` 投影；local task 先验证手动 key，再按 media/key 信号生成 effective AES-128 refs，没有可执行 key 时在创建目录和发起 fetch 前失败。普通 valid key、METHOD=NONE、MAP-only key 和现有 CBC MAP path 保持不变。
- legacy cleanup: 无；旧 compatibility facade 和 legacy-named controller adapter 保留到 hls-engine 原子 cutover。
- validation: parser 专项 `1 file / 45 tests`、local downloader 专项 `1 file / 11 tests`、TypeScript、全仓 ESLint、同步测试 `16/16`、metadata `7 units / 32 capabilities / 208 anchors / 106 cleanup entries / 169 planned IDs / 124 active refs` 通过；排除 Node runner 文件后全仓 Vitest 为 `189 files / 1267 passed / 3 skipped`，其中真实 HLS 输出 `1 file / 4 tests` 通过。完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (HLS engine atomic cutover)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步关闭固定目标的 `hls-engine` unit。
- reviewedThrough / portedThrough: 仓库级游标均保持 `null`，因为其余 6 个 unit 仍开放；4 项 HLS capability 均改为 `verified` 且 `syncedThrough` 固定目标。
- change groups: `production-cutover`、`legacy-cleanup` 与 `documentation-correction`；无新的上游行为差分。
- affected capability IDs: `hls.parser-planner`、`hls.segment-pipeline`、`hls.live-recording`、`hls.cache-fallback-disguised-fragments` 全部关闭；metadata 仍为 `7 units / 32 capabilities / 208 anchors / 106 cleanup entries / 169 planned IDs / 124 active refs`，其中 28 项能力仍开放。
- fixtures/tests: 不新增 fixture 或 planned ID；既有 124 个 active ref 中，HLS 的所有 planned ID 均有同名 testRef，真实 ffmpeg/ffprobe 继续覆盖 clear、AES-128、AES-256 CBC/CTR 和 encrypted fMP4 + independent audio。
- accepted difference: 无新的黑盒差异；controller handler 只从 legacy 名称改为 target adapter 名称，IPC channel/payload、authority、task/session owner、输出和错误语义不变。
- excluded changes and reasons: 不把 HLS 完成度外推到 network/deep/MSE/DASH/transfer/output；未捕获派生 key/MAP/media URL 的 embedded-session fetch 是明确保留的平台 adapter，不当成待删除旧算法。
- unresolved gaps: 真实网站手工回归仍受当前环境限制；后续 HLS 只在该回归发现问题或上游游标前进时增量维护。其余 6 个 unit 继续按 capability map 推进。
- runtime changes: 删除 renderer HLS compatibility model、顶层 local-downloader/live-recorder re-export；parser/contract/owner 测试直接引用 target；main 的 plan adapter 改名为 `handleEmbeddedBrowserHlsPlanDownload` 并继续委派 `HlsTaskExecutor`。
- legacy cleanup: `hls-engine` 的 5 个 `remove-after-cutover` symbol 已全部消失，3 个 `retain-or-adapt` session owner 仍存在；cleanup entries 暂留，让 validator 在整体迁移结束前持续断言旧 symbol 不得复活。
- validation: HLS 集合 `19 files / 132 passed`（真实输出 `4/4`）、TypeScript、全仓 ESLint、全仓 Vitest `190 files / 1294 passed / 3 skipped`、同步测试 `16/16`、metadata/固定上游 validator 和 scoped diff check 已通过。完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (network capture atomic cutover)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步关闭固定目标的 `network-capture` unit。
- reviewedThrough / portedThrough: 仓库级游标均保持 `null`，因为其余 5 个 unit 仍开放；7 项 network capability 均改为 `verified` 且 `syncedThrough` 固定目标。
- change groups: `production-cutover`、`legacy-cleanup`、`contract-consolidation` 与 `documentation-correction`；无新的上游行为差分。
- affected capability IDs: `capture.network-event-lifecycle`、`capture.protected-request-context`、`capture.request-url-helpers`、`capture.rules-classification-deduplication`、`capture.resource-state-contract`、`capture.cross-process-contract`、`capture.owner-lifecycle` 全部关闭；metadata 为 `7 units / 32 capabilities / 208 anchors / 106 cleanup entries / 170 planned IDs / 125 active refs`，其中 21 项能力仍开放。
- fixtures/tests: 新增 `network.capture-settings-persistence`，锁定旧 JSON 路径/schema 2 的规范化、升级和产品默认经验规则；network 全集 `15 files / 62 tests` 覆盖首字节、终态、vault/store、规则、page probe、跨进程 reducer、固定-purpose consumer 和 owner lifecycle。
- accepted difference: 无新增差异；persisted domain settings 继续作为 OmniFlow resource/page host policy，Cat Catch top-level page policy 仍由 pure port 和 main-owned current page URL 单独执行。
- excluded changes and reasons: data/blob、未捕获拖拽和 derived manifest URL 的受限 adapter 不是第二套 listener/context owner；deep hooks、MSE、DASH、transfer/output 与旧 catch toolkit 按各自 unit 推进，本步不扩大范围。
- unresolved gaps: 真实网站手工回归受当前环境限制；Network 后续只在真实回归发现问题或上游游标前进时增量维护。
- runtime changes: production controller 继续唯一构造 `EmbeddedBrowserCaptureRuntime`；共享 capture-settings contract 与 target settings store 接管原 JSON 行为，main/preload/renderer 使用同一 DTO；删除旧 bridge、rules/classifier、service、state store 和 main resource types 共 6 个文件。
- legacy cleanup: `network-capture` 的 8 个 `remove-after-cutover` symbol 已全部消失，19 个 `retain-or-adapt` owner 已保留或指向 target；cleanup entries 暂留用于防复活。
- validation: network `15 files / 62 passed`、capture settings + target chain 专项 `4 files / 8 passed`、TypeScript、全仓 ESLint、同步测试 `16/16`、metadata/固定上游 validator 和 scoped diff check 已通过；排除 Node runner 文件后全仓 Vitest 为 `191 files / 1298 passed / 3 skipped`。完整 build 不运行以避免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (deep discovery executable baseline)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；本步开始 `deep-search-runtime`，不移动游标。
- reviewedThrough / portedThrough: 均保持 `null`；`deep.manifest-key-discovery` 从 `pending` 进入 `porting`，整个 unit 仍开放。
- change groups: `upstream-characterization` 与 `pure-port`；不接 production runtime。
- affected capability IDs: `deep.manifest-key-discovery`、`deep.runtime-hook-bundle`；metadata 为 `7 units / 32 capabilities / 208 anchors / 106 cleanup entries / 170 planned IDs / 128 active refs`，状态为 `11 verified / 4 porting / 17 pending`。
- fixtures/tests: 新增 upstream-executable fixture `deep-json-manifest-key-discovery`；`deep.inline-manifest-key`、`deep.base-url-blob-signature` 与 `deep.json-depth-width-cycle` 直接对比固定 `search.js` 的归一化 postMessage/Blob 内容。
- accepted difference: pure port 返回 inline manifest bytes，不在纯逻辑层创建 page-owned Blob URL；后续 page adapter 必须从完全相同的 bytes 创建 opaque resource。fixture 比较 Blob 内容而不比较随机 Blob URL identity。
- excluded changes and reasons: 不启用 `enableDeepRuntimeHooks`，不修改 document-start installer、Worker/fetch/XHR/TextDecoder、console relay、MSE、toolkit 或 renderer；先锁定经验算法，避免再次把 production 安全边界与行为迁移混成一块。
- unresolved gaps: hook install sentinels、Worker CSP 异步失败、TextDecoder、fetch/XHR/JSON runtime、secure relay、all-frame document-start、toolkit state、production cutover 和 legacy cleanup 仍未完成。
- runtime changes: 新增纯 `deep-search/discovery.ts`，保留上游七类 URL extension、协议相对 URL、宽松 16-number key coercion、all-zero/ftyp 排除、data URL、inline MPD/M3U8、全 enumerable width、depth 21/22、cycle 和未来 base URL 回放。
- legacy cleanup: 无；旧 probe/runtime/template 在整个 deep unit 完成前继续作为现有生产 owner，target pure port 尚无生产调用方。
- validation: discovery 专项 `1 file / 3 passed`、应用 TypeScript `--noEmit`、全仓 ESLint、同步测试 `16/16`、metadata/固定上游 validator 和 scoped diff check 已通过；排除 Node runner 文件后全仓 Vitest 为 `192 files / 1301 passed / 3 skipped`。项目引用 `tsc -b` 仍被既有 `vite.config.ts` 的 ES lib/`replaceAll` 错误阻断；完整 build 仍避免覆盖其他 Agent 的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (deep secure page relay evidence)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步复核 Network 阶段已进入 production 的 page relay 是否满足 deep unit。
- reviewedThrough / portedThrough: 均保持 `null`；`deep.secure-page-relay` 从 `pending` 进入 `ported-unverified` 并记录固定目标，整个 deep unit 仍开放。
- change groups: `platform-substitute-evidence` 与 `documentation-correction`；不增加第二套 relay owner。
- affected capability IDs: `deep.secure-page-relay`；metadata 为 `7 units / 32 capabilities / 208 anchors / 106 cleanup entries / 170 planned IDs / 130 active refs`，状态为 `11 verified / 4 porting / 1 ported-unverified / 16 pending`。
- fixtures/tests: `deep.relay-forgery` 锁定 tokenless/wrong-token/malformed/non-object rejection 与合法 current binding；`deep.frame-document-start` 锁定 CDP next-document script、当前 main/subframe 注入、detached frame 容错和旧 script replacement。
- accepted difference: Cat Catch 的 page `postMessage -> content script -> background` 在无扩展的 Electron 中替换为随机 document token + main lifecycle binding + console transport；renderer/page 不获得 tab owner、resource authority 或 main capability。
- excluded changes and reasons: 不创建 `SecurePageRuntimeRelay` 包装类；现有 `ElectronPageProbeEventAdapter`、`PageProbeCaptureAdapter` 与 view installer 已是唯一生产 owner。也不启用 deep hooks、不修改 discovery/MSE/toolkit/UI。
- unresolved gaps: Worker/fetch/XHR/JSON/TextDecoder hook runtime 尚未接入；完整 deep runtime production test、toolkit state、unit cutover 与 legacy cleanup 仍未完成。
- runtime changes: 无黑盒行为变化；只修正 event adapter 的过期“尚未 production”注释，并为既有生产 relay/installer 增加 Deep 专属证据。
- legacy cleanup: 无；installer 与 target adapters 属于 `retain-or-adapt`，旧 runtime/template/console emitter 只在完整 unit cutover 时处理。
- validation: secure relay 专项 `2 files / 4 passed`、应用 TypeScript `--noEmit`、全仓 ESLint、同步测试 `16/16`、metadata/固定上游 validator 和 scoped diff check 已通过；排除另一个 Agent 正在修改的 Shell policy expectation 后，全仓 Vitest 为 `193 files / 1299 passed / 3 skipped`。未排除时仅有 `electron/service/agent/shell/agent-shell-preparation-service.test.ts` 的 2 个无关失败；项目引用 `tsc -b` 仍被既有 `vite.config.ts` 的 ES lib/`replaceAll` 错误阻断，完整 build 继续避免覆盖其他 Agent 的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (deep core runtime hooks)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步从固定 `search.js` 迁入 core hook 安装语义。
- reviewedThrough / portedThrough: 均保持 `null`；`deep.runtime-hook-bundle` 仍为 `porting`，整个 deep unit 继续开放。
- change groups: `behavioral-port`、`runtime-safety-adaptation` 与 `documentation-correction`；只新增 target pure port，不切换 production dispatch。
- affected capability IDs: `deep.runtime-hook-bundle`；metadata 为 `7 units / 32 capabilities / 208 anchors / 106 cleanup entries / 173 planned IDs / 136 active refs`，状态仍为 `11 verified / 4 porting / 1 ported-unverified / 16 pending`。
- fixtures/tests: `deep.hook-install-sentinels` 锁定幂等安装、原样恢复与自包含序列化；`deep.worker-csp-fallback`、`deep.worker-bootstrap-relay` 锁定异步 Blob CSP 回退、成功 bootstrap、relay 拦截和 URL cleanup；`deep.fetch-clone-observation`、`deep.xhr-response-branches`、`deep.text-decoder-manifest` 锁定 Cat Catch 的 core 观察面。
- accepted differences: Blob Worker capability 处于异步 probing 时先保留原生 Worker，只有收到 probe message 才启用注入；error/timeout 后永久回退，避免 CSP 把真实 Worker 卡在失败 Blob URL。probe URL 立即回收，注入 URL 带 TTL/dispose；dispose 不终止页面拥有的真实 Worker。
- excluded changes and reasons: 本步不迁入 slice/subarray/btoa/atob/fromCharCode/DataView/typed-array/join/escape/indexOf 等辅助 key hooks，不连接 discovery/relay、不启用 production flag，也不修改 MSE/toolkit/UI。
- unresolved gaps: 辅助 key hooks、target discovery adapter、generated page/Worker composition、production equivalent test、unit cutover 和旧 deep 分支删除仍未完成。
- runtime changes: 无黑盒行为变化；新 installer 没有 production 调用方，旧 `enableDeepRuntimeHooks = false` 保持不变。
- legacy cleanup: 无；旧 runtime hook block 在 target bundle 与 adapter 完整前继续留作 characterization，不能提前删除。
- validation: discovery + core runtime 专项 `2 files / 9 passed`、应用 TypeScript `--noEmit`、scoped/full ESLint、同步测试 `16/16`、metadata/固定上游 validator 和 scoped diff check 已通过；排除 Node runner 文件后，全部可执行 Vitest 为 `195 files / 1344 passed / 3 skipped`。完整 build 继续避免覆盖其他 Agent 的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (deep auxiliary experience hooks)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步继续固定 `search.js` 的 key/string 经验入口。
- reviewedThrough / portedThrough: 均保持 `null`；`deep.runtime-hook-bundle` 仍为 `porting`，整个 deep unit 继续开放。
- change groups: `behavioral-port` 与 `runtime-safety-adaptation`；继续扩展同一个 target installer，不创建第二套 runtime。
- affected capability IDs: `deep.runtime-hook-bundle`；metadata 为 `7 units / 32 capabilities / 208 anchors / 106 cleanup entries / 177 planned IDs / 140 active refs`，状态仍为 `11 verified / 4 porting / 1 ported-unverified / 16 pending`。
- fixtures/tests: `deep.key-array-surfaces`、`deep.key-dataview-typedarray`、`deep.key-string-surfaces`、`deep.manifest-string-surfaces` 锁定固定上游的 slice/subarray、DataView/typed array、btoa/atob/escape、fromCharCode/join/indexOf 分支；既有 sentinel 同时锁定 inspect 重入门禁与所有 wrapper 的条件恢复。
- accepted differences: 延续上一切片的 Worker CSP/Blob URL lifecycle 差异；辅助 hooks 的触发条件和 native `toString` 投影保持固定上游语义，新增同步重入门禁仅阻止 runtime 自己的 discovery 回调再次触发 hook。
- excluded changes and reasons: 本步不接 inline DOM scan、Vimeo playlist 翻译、discovery/relay adapter、generated page/Worker composition、production flag、MSE/toolkit/UI。
- unresolved gaps: inline DOM/Vimeo、target discovery adapter、production-equivalent composition、unit cutover 和旧 deep 分支删除仍未完成。
- runtime changes: 无黑盒行为变化；target installer 仍没有 production 调用方，旧 `enableDeepRuntimeHooks = false` 保持不变。
- legacy cleanup: 无；旧 disabled deep block 继续作为 characterization，待 target composition 完整后原子删除。
- validation: discovery + runtime 专项 `2 files / 13 passed`、应用 TypeScript `--noEmit`、scoped/full ESLint、同步测试 `16/16`、metadata/固定上游 validator、全仓 Vitest `195 files / 1363 passed / 3 skipped` 和 scoped diff check 已通过。完整 build 继续避免覆盖其他 Agent 的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (deep inline and Vimeo discovery)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步补齐固定 `search.js` 的 DOM inline scan 与 Vimeo translator anchor。
- reviewedThrough / portedThrough: 均保持 `null`；`deep.runtime-hook-bundle`、`deep.manifest-key-discovery` 保持 `porting`，整个 deep unit 继续开放。
- change groups: `behavioral-port`、`platform-adapter-boundary` 与 `documentation-correction`；只加入纯 page-discovery helper。
- affected capability IDs: `deep.runtime-hook-bundle`、`deep.manifest-key-discovery`；metadata 为 `7 units / 32 capabilities / 210 anchors / 106 cleanup entries / 179 planned IDs / 142 active refs`，状态仍为 `11 verified / 4 porting / 1 ported-unverified / 16 pending`。
- fixtures/tests: `deep.inline-script-url-scan` 锁定上游仅 m3u8/mp4/flv、协议补全、relative-as-host 和重复候选；`deep.vimeo-playlist-translation` 锁定 playlist gate、base URL 归一化、init/segment、video/audio master 行与 header-only empty master。
- accepted differences: 上游直接在 page 创建 child/master Blob URL；target helper 通过 `materializeManifest(text)` callback 物化 child URL并返回 master 文本，后续 adapter 再生成 main 可治理的 opaque resource。
- excluded changes and reasons: 本步不接 DOMContentLoaded 调度、page Blob/resource store、discovery-to-relay composition、production flag、MSE/toolkit/UI。
- unresolved gaps: target page adapter、generated page/Worker composition、production-equivalent test、unit cutover 和旧 deep 分支删除仍未完成。
- runtime changes: 无黑盒行为变化；新增 helper 没有 production 调用方。
- legacy cleanup: 无；旧 inline/Vimeo 代码继续作为 characterization，待 target adapter 接入时原子删除。
- validation: page-discovery 专项 `1 file / 2 passed`、完整 deep target `3 files / 15 passed`、应用 TypeScript `--noEmit`、scoped/full ESLint、同步测试 `16/16`、metadata/固定上游 validator、全仓 Vitest `196 files / 1366 passed / 3 skipped` 和 scoped diff check 已通过。完整 build 继续避免覆盖其他 Agent 的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (stateful deep discovery session)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步修正 page adapter 接入前的跨 hook 状态模型。
- reviewedThrough / portedThrough: 均保持 `null`；`deep.manifest-key-discovery` 继续 `porting`，整个 deep unit 开放。
- change groups: `behavioral-port`、`state-owner-correction` 与 `serialization-readiness`；不增加 production owner。
- affected capability IDs: `deep.manifest-key-discovery`；metadata 为 `7 units / 32 capabilities / 210 anchors / 106 cleanup entries / 180 planned IDs / 143 active refs`，状态仍为 `11 verified / 4 porting / 1 ported-unverified / 16 pending`。
- fixtures/tests: `deep.cross-hook-base-replay` 将 relative manifest 与晚到 media URL 分成两次 `discover()`，锁定第二次按新 CDN base 回放 manifest；同一用例执行序列化 factory，确保 page world 可直接安装。
- accepted differences: 无新增平台差异；session 只是把 Cat Catch document 级 `filter/baseUrl/joinBaseUrlTask` 生命周期从闭包显式化，一次性 facade 仍保持原测试输出。
- excluded changes and reasons: 本步不接 runtime inspect、DOM/Blob/relay、production flag、MSE/toolkit/UI。
- unresolved gaps: target page adapter、generated page/Worker composition、production-equivalent test、unit cutover 和旧 deep 分支删除仍未完成。
- runtime changes: 无黑盒行为变化；session 没有 production 调用方。
- legacy cleanup: 无；旧 state 继续作为 characterization，等 adapter 原子切换。
- validation: discovery 专项 `1 file / 4 passed`、完整 deep target `3 files / 16 passed`、应用 TypeScript `--noEmit`、scoped/full ESLint、同步测试 `16/16`、metadata/固定上游 validator、全仓 Vitest `196 files / 1367 passed / 3 skipped` 和 scoped diff check 已通过。完整 build 继续避免覆盖其他 Agent 的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (deep page and Worker adapter composition)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步只建立 target page adapter 与 production-equivalent generated source。
- reviewedThrough / portedThrough: 均保持 `null`；`deep.runtime-hook-bundle`、`deep.manifest-key-discovery` 继续 `porting`，整个 deep unit 仍开放。
- change groups: `platform-adapter`、`behavior-order-preservation`、`worker-relay-composition` 与 `documentation-correction`；不切换 production dispatch。
- affected capability IDs: `deep.runtime-hook-bundle`、`deep.manifest-key-discovery`；metadata 为 `7 units / 32 capabilities / 210 anchors / 106 cleanup entries / 182 planned IDs / 145 active refs`，状态仍为 `11 verified / 4 porting / 1 ported-unverified / 16 pending`。
- fixtures/tests: `deep.page-adapter-composition` 执行真实 generated body，覆盖 stateful JSON discovery、inline scan、key surface、Vimeo child/master resource 物化及固定 XHR GET JSON-manifest 分支；`deep.page-worker-composition` 执行真实 generated Worker bootstrap，并把 raw observation 经 document session 和既有 page callback 回放。
- accepted differences: Worker observation 先以 structured-clone envelope 回到 document，再由唯一 document discovery session 物化资源；这替代 Cat Catch Worker 自己持有独立 filter/base state，避免 worker-owned Blob 无法被 main 治理。既有异步 CSP probe、Blob TTL/dispose 差异继续保持；Electron 注入已加载的 current frame 时在下一 task 扫 inline script，未来 document-start 仍走 DOMContentLoaded。
- excluded changes and reasons: target body 没有接入 `createEmbeddedBrowserResourceProbeScript`，不启用 production hooks、不新增 console/main relay、不修改 token、MSE、toolkit、renderer 或 IPC；生产仍只有旧 probe owner，且旧 deep block 仍由 `enableDeepRuntimeHooks = false` 关闭。
- unresolved gaps: `deep.catch-toolkit-page-settings` 的 origin storage/reload-reset 证据、完整 target probe-template harness、document-start generated resource 到 tokenized main ingress、unit 原子 cutover 和旧 deep block cleanup 尚未完成。
- runtime changes: 新 `deep-search-page.ts` 薄 adapter 保留 XHR/fetch/TextDecoder/root-string 的不同分支顺序，组合三个可序列化 target factory，调度 inline scan、Vimeo governed resource 和 nested Worker relay；`page-discovery` 只改成等价可序列化 factory，既有 facade 输出不变。
- legacy cleanup: 无；新 adapter 只有测试调用方，旧 disabled deep block 与现有 resource/MSE/toolkit platform owner 均留到完整 unit cutover。
- validation: deep target `4 files / 18 passed`、应用 TypeScript `--noEmit`、scoped/full ESLint、sync tests `16/16`、metadata 与固定上游 validator、排除 Node runner `tools/cat-catch-sync/validate.test.mjs` 后全仓 Vitest `197 files / 1369 passed / 3 skipped`、scoped diff check 通过。该 Node runner 已在正确的 `node --test` 下通过；完整 build 未运行，以免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (page-origin toolkit state)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步固定 Catch Toolkit 页面偏好的状态与存储语义。
- reviewedThrough / portedThrough: 均保持 `null`；`deep.catch-toolkit-page-settings` 从 `pending` 进入 `porting`，整个 deep unit 继续开放。
- change groups: `state-owner-port`、`origin-storage-evidence`、`serialization-readiness` 与 `accepted-platform-difference`；不增加 production owner。
- affected capability IDs: `deep.catch-toolkit-page-settings`；metadata 为 `7 units / 32 capabilities / 210 anchors / 106 cleanup entries / 182 planned IDs / 147 active refs`，状态为 `11 verified / 5 porting / 1 ported-unverified / 15 pending`。
- fixtures/tests: `deep.toolkit-origin-storage` 锁定不同页面 origin 隔离、`"checked"`/`""` 布尔写入、空字符串删除、selector/regex 验证和 DOM 命中变化；`deep.toolkit-reload-reset` 通过真实序列化 factory 锁定同 origin 重载恢复、新 origin 重置、字符串重载归一化以及 localStorage 被策略阻止时的内存降级。
- accepted differences: Cat Catch 的手动文件名和多余媒体头清理选项只存在于注入面板生命周期；OmniFlow 的外置集成 UI 把八项产品偏好都写入当前访问页面 origin 下的 `OmniflowCatchToolkit:*` key。捕捉是否启用不进入这个偏好 owner，仍随页面 runtime 重置。
- excluded changes and reasons: 本步不替换 production `catchToolkitState`、不修改 controller/all-frame merge、IPC、renderer、MSE 行为、probe template、deep flag 或 relay。
- unresolved gaps: 完整 target probe-template harness、toolkit 与 page adapter body 的组合、document-start generated resource 到 tokenized main ingress、deep unit 原子 cutover 和旧 deep block cleanup 尚未完成。
- runtime changes: 无黑盒行为变化；`toolkit-state.ts` 只有测试调用方，旧 probe 继续是 production 唯一 toolkit owner。
- legacy cleanup: 无；既有 toolkit state/storage/page-action cleanup entry 保持原分类，等待 deep unit 原子切换时删除或适配。
- validation: 完整 deep target `5 files / 20 passed`、应用 TypeScript `--noEmit`、scoped/full ESLint、sync tests `16/16`、metadata 与固定上游 validator、排除 Node runner `tools/cat-catch-sync/validate.test.mjs` 后全仓 Vitest `198 files / 1371 passed / 3 skipped`、scoped diff check 通过。该 Node runner 已在正确的 `node --test` 下通过；完整 build 未运行，以免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (complete deep probe-template ingress)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步证明完整 target page probe 到既有 main ingress 的组合路径。
- reviewedThrough / portedThrough: 均保持 `null`；`deep.runtime-hook-bundle`、`deep.manifest-key-discovery` 继续 `porting`，`deep.secure-page-relay` 继续 `ported-unverified`，整个 deep unit 仍开放。
- change groups: `platform-composition`、`production-equivalent-integration`、`existing-relay-reuse` 与 `documentation-correction`；不切换 production dispatch。
- affected capability IDs: `deep.runtime-hook-bundle`、`deep.manifest-key-discovery`、`deep.secure-page-relay`；metadata 为 `7 units / 32 capabilities / 210 anchors / 106 cleanup entries / 183 planned IDs / 148 active refs`，状态仍为 `11 verified / 5 porting / 1 ported-unverified / 15 pending`。
- fixtures/tests: `deep.probe-template-ingress` 执行真实 target-only 完整 probe，使用预签下一文档 token，经 `ElectronPageProbeEventAdapter`、`PageProbeCaptureAdapter` 写入 `ResourceStateStore`；锁定 relative manifest 在页面 base 与晚到 CDN base 下分别物化、direct media 发现及 navigation generation owner 绑定。
- accepted differences: 无新增差异；同一 manifest 随后续 hook 的新 base 再物化，是固定 Cat Catch document-level `joinBaseUrlTask` 的既有经验语义。
- excluded changes and reasons: 新 `deep-search-probe.ts` 只有测试/迁移目标调用方；默认 `createEmbeddedBrowserResourceProbeScript` 不传附加 body，`enableDeepRuntimeHooks` 仍为 `false`。本步不组合 toolkit owner、不修改 MSE、console/main relay、IPC 或 renderer。
- unresolved gaps: 把 toolkit state body 接入 target probe，准备唯一 dispatch boundary 的原子切换，验证 all-frame/toolkit round-trip/cleanup 组合并删除旧 deep block；真实网站手工回归仍受当前无测试场景限制。
- runtime changes: probe template 允许显式附加非空 body source，以便 target-only 组合复用现有 resource/MSE bootstrap；production 默认调用不附加 body，黑盒行为不变。
- legacy cleanup: 无；旧 disabled deep block 与 toolkit owner 保留到 unit 原子切换，不能提前删除或并行启用。
- validation: 定向 ingress/lifecycle `3 files / 5 passed`、完整 deep target `6 files / 21 passed`、应用 TypeScript `--noEmit`、scoped/full ESLint、sync tests `16/16`、metadata 与固定上游 validator、排除 Node runner `tools/cat-catch-sync/validate.test.mjs` 后全仓 Vitest `199 files / 1372 passed / 3 skipped`、scoped diff check 通过。该 Node runner 已在正确的 `node --test` 下通过；完整 build 未运行，以免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (toolkit owner probe round-trip)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步把已验证的 page-origin toolkit owner 组合进 target-only 完整 probe。
- reviewedThrough / portedThrough: 均保持 `null`；`deep.catch-toolkit-page-settings` 继续 `porting`，整个 deep unit 仍开放。
- change groups: `state-owner-composition`、`legacy-runtime-projection`、`production-equivalent-integration` 与 `documentation-correction`；不切换 production dispatch。
- affected capability IDs: `deep.catch-toolkit-page-settings`；metadata 为 `7 units / 32 capabilities / 210 anchors / 106 cleanup entries / 184 planned IDs / 149 active refs`，状态仍为 `11 verified / 5 porting / 1 ported-unverified / 15 pending`。
- fixtures/tests: `deep.toolkit-probe-round-trip` 执行真实 target-only 完整 probe，经既有 `getCatchToolkitState/updateCatchToolkitState` 入口验证 target owner、`"checked"` localStorage、手动文件名运行原值/派生 trim/持久 trim、regex/selector 投影和保留 MSE/page-actions 状态读取。
- accepted differences: 无新增平台差异；同一文档内 `manualFileName` 保留用户原始空格，而 `currentFileName` 与 localStorage trim，重载后 owner 再从持久值归一化，这是既有页面生命周期语义。
- excluded changes and reasons: target adapter 只在 `deep-search-probe.ts` 的测试/迁移目标组合中安装；默认 production probe 不包含该 body。未修改 MSE 捕捉、controller、IPC、renderer 或 production document factory。
- unresolved gaps: 旧 probe 的 core/hooks/page-actions 同时持有 Deep、MSE 和 resource action 职责，不能按现有 deep cleanup 条目直接整块删除；下步先拆清保留 owner 与纯 deep symbol，再准备原子 dispatch cutover。
- runtime changes: 新 `deep-search-toolkit.ts` 让 target state 成为唯一可写偏好 owner，既有 MSE/page-actions 只消费同步投影；dispose 仅在仍持有入口时恢复原 handler，避免覆盖后装 owner。production 黑盒行为不变。
- legacy cleanup: 无；本步明确发现跨 unit 共用文件/闭包边界，未伪造 cleanup 完成或提前改写 cleanup classification。
- validation: toolkit/完整 probe 定向 `2 files / 4 passed`、完整 deep target `6 files / 22 passed`、应用 TypeScript `--noEmit`、scoped/full ESLint、sync tests `16/16`、metadata 与固定上游 validator、排除 Node runner `tools/cat-catch-sync/validate.test.mjs` 后全仓 Vitest `199 files / 1373 passed / 3 skipped`、scoped diff check 通过。该 Node runner 已在正确的 `node --test` 下通过；完整 build 未运行，以免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (deep cutover cleanup boundary audit)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步收敛 deep production cutover 的真实删除/保留边界。
- reviewedThrough / portedThrough: 均保持 `null`；全部 deep capability 状态不变，整个 unit 仍开放。
- change groups: `cleanup-boundary-correction`、`platform-adapter-retention`、`executable-contract` 与 `documentation-correction`；不修改 production runtime。
- affected capability IDs: `deep.runtime-hook-bundle`、`deep.secure-page-relay`、`deep.catch-toolkit-page-settings`；metadata 为 `7 units / 32 capabilities / 210 anchors / 106 cleanup entries / 186 planned IDs / 151 active refs`，状态仍为 `11 verified / 5 porting / 1 ported-unverified / 15 pending`。
- fixtures/tests: `deep.toolkit-page-bridge-contract` 执行三个 toolkit page script generator，锁定 get/update/action 精确转发和缺失 handler；`deep.generated-resource-page-bridge-contract` 执行 opaque resource open/export/extract 脚本，锁定引号 key、安全布尔归一、Promise payload 和缺失 handler。
- accepted differences: 无；本步没有改变 Cat Catch 行为，只纠正 OmniFlow 平台 bridge/template/console prefix 不应随 deep 算法删除的事实。
- excluded changes and reasons: 没有修改旧 core/hooks/page-actions、MSE capture、generated-resource store、console emitter、global probe API、production builder、controller、IPC 或 renderer；这些混合职责必须先有替代 owner，不能通过 metadata 重分类假装完成。
- unresolved gaps: 31 个 deep cleanup 条目已固定为 `11 retain-or-adapt / 10 pure remove / 10 split-before-remove`。下一步先迁出 10 个混合 symbol 中的 MSE/runtime action 与 generated-resource store/API，再切 production dispatch 并删除剩余旧 symbol。
- runtime changes: 无黑盒变化；新增 `embeddedBrowserPageBridge.test.ts` 只执行既有受控 script generator。
- legacy cleanup: toolkit get/update/action 三个 page bridge、resource action/extract 两个 page bridge、通用 `createProbeScriptTemplate` 和 console prefix 共 7 项从误标 legacy/remove 修正为 `omniflow-integration/retain-or-adapt`；其余 20 项继续 remove，其中 10 项需先拆分。
- validation: bridge/完整 probe 定向 `2 files / 4 passed`、应用 TypeScript `--noEmit`、scoped/full ESLint、sync tests `16/16`、metadata 与固定上游 validator、排除 Node runner `tools/cat-catch-sync/validate.test.mjs` 后全仓 Vitest `200 files / 1375 passed / 3 skipped`、scoped diff check 通过。该 Node runner 已在正确的 `node --test` 下通过；完整 build 未运行，以免覆盖其他 Agent 正在修改的 `dist-electron/**`，暂无真实网站手工场景。

## 2026-08-28: same target (generated-resource page owner extraction)

- observedHead / migrationTarget: 均为 `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步只抽出 target Deep 的 generated-resource owner。
- reviewedThrough / portedThrough: 均保持 `null`；`deep.manifest-key-discovery` 继续 `porting`，整个 Deep unit 仍开放。
- change groups: `state-owner-extraction`、`platform-adapter-composition`、`production-equivalent-readback` 与 `documentation-correction`；不切换 production dispatch。
- affected capability IDs: `deep.manifest-key-discovery`；metadata 为 `7 units / 32 capabilities / 210 anchors / 106 cleanup entries / 187 planned IDs / 152 active refs`，状态仍为 `11 verified / 5 porting / 1 ported-unverified / 15 pending`。
- fixtures/tests: `deep.generated-resource-page-owner` 锁定 signature 去重、Blob/base64 bytes、文件名、open/export/read、MSE handler 委托、Unicode 编码和 dispose 恢复；`deep.probe-template-ingress` 还会通过 main-owned resource key 读回归一化 manifest bytes。
- accepted differences: 无新增差异；page-origin Blob identity 继续保持非确定性，main 仍通过既有 opaque tab/resource authority 治理访问。
- excluded changes and reasons: target owner 只由 `createDeepSearchTargetProbeScript` 组合；默认 production probe 仍不包含 target body，`enableDeepRuntimeHooks` 继续为 `false`。本步不修改 controller、IPC、renderer、MSE 行为或 relay owner。
- unresolved gaps: 继续从混合 legacy core/hooks/page-actions 抽出 MSE runtime/actions 与通用 console/global API，再原子切换 production document factory 并删除过时 Deep symbols。
- runtime changes: 无 production 黑盒变化；target probe 现在按 generated-resource store -> Deep page adapter -> toolkit adapter 组合，不再依赖旧 `probeResources`、`createProbeBlobResource` 或 `textToBase64`。
- legacy cleanup: `probeResources` 从 split-before-remove 移到 pure-remove；Deep 边界变为 `11 retain-or-adapt / 11 pure remove / 9 split-before-remove`，全部删除仍等待 unit 原子切换。
- validation: generated owner/page/probe `3 files / 5 passed`、完整 Deep target `7 files / 23 passed`、应用 TypeScript `--noEmit`、scoped/full ESLint、sync tests `16/16`、metadata/固定上游校验（`187 planned tests`）和全仓 Vitest `201 files / 1376 passed / 3 skipped` 均通过。完整 build 仍为避免覆盖其他 Agent 的 dirty `dist-electron/**` 而不运行，且当前没有真实网站手工场景。

## 2026-08-28: same target (production MSE owner extraction)

- observedHead / migrationTarget: 均为 `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步解除 production MSE 与 legacy Deep 文件的职责纠缠。
- reviewedThrough / portedThrough: 均保持 `null`；Deep capability 状态不变，`mse.page-capture-runtime` 也继续 `pending`，不把机械抽离当成固定上游 parity。
- change groups: `production-owner-extraction`、`behavior-characterization`、`cleanup-boundary-correction` 与 `documentation-correction`；不切换 Deep production dispatch。
- affected capability IDs: `deep.runtime-hook-bundle`、`deep.catch-toolkit-page-settings`、`mse.page-capture-runtime`；metadata 为 `7 units / 32 capabilities / 210 anchors / 106 cleanup entries / 187 planned IDs / 153 active refs`，状态仍为 `11 verified / 5 porting / 1 ported-unverified / 15 pending`。
- fixtures/tests: `mse.append-observability` 真实执行 production probe，锁定单次安装、重复安装不重复包 hook、addSourceBuffer/appendBuffer/endOfStream、诊断与资源事件，以及 read/open/export/drain 的 key/bytes 行为；MSE + Deep + relay/lifecycle 定向集为 `11 files / 30 passed`。
- accepted differences: 无新增差异；本步只保持 OmniFlow 现有 MSE 行为，尚未把 50MB page flush、header trimming、catch actions 或 completion 语义声明为 Cat Catch 等价。
- excluded changes and reasons: 不创建新的 MSE framework，不修改 main spool、IPC、renderer、资源 authority 或 target Deep runtime；production 仍由一个 probe IIFE 和一个 MediaSource hook owner 执行。
- unresolved gaps: Deep 仍需收敛混合 core、page host body、console emitter、global API 与 generated-resource read，再原子切换 document factory；MSE 仍需对照固定 `catch.js` 完成 audio/video flush-reset、页面预算和 parity 证据。
- runtime changes: 现有 MSE state/helpers、page actions 与 hooks 迁到 `capture/adapters/mse-page-runtime.ts`，worker/resource/global host 迁到 `page-probe-runtime-host.ts`；模板按 core -> MSE core -> manifest -> MSE actions -> page host -> MSE hooks -> Deep hooks 在同一 IIFE 组合，旧 510 行混合 PageActions 文件删除，黑盒行为不变。
- legacy cleanup: 3 个实际操作 MSE 流的 catch action 从 Deep 归回 `mse-runtime`，所有移动项继续保持 `legacy/remove-after-cutover`；Deep cleanup 现为 28 项，边界是 `11 retain-or-adapt / 12 pure remove / 5 split-before-remove`。
- validation: production MSE characterization `1 file / 1 passed`、MSE/Deep/relay/lifecycle 定向 `11 files / 30 passed`、应用 TypeScript `--noEmit`、full ESLint、sync tests `16/16`、metadata/固定上游校验（`187 planned tests`）和全仓 Vitest `202 files / 1377 passed / 3 skipped` 均通过。完整 build 仍为避免覆盖其他 Agent 的 dirty `dist-electron/**` 而不运行，且当前没有真实网站手工场景。

## 2026-08-28: same target (Deep production atomic cutover)

- observedHead / migrationTarget: 均为 `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步完成 `deep-search-runtime` 的唯一 production dispatch 切换和 legacy cleanup。
- reviewedThrough / portedThrough: 均保持 `null`；初始全面迁移仍有 17 项 open capability，不提前推进全局游标。
- change groups: `production-dispatch-cutover`、`platform-host-extraction`、`legacy-deletion`、`validator-fixture-generalization` 与 `documentation-correction`。
- affected capability IDs: `deep.runtime-hook-bundle`、`deep.manifest-key-discovery`、`deep.secure-page-relay`、`deep.catch-toolkit-page-settings`；四项均到达 `verified`，metadata 变为 `15 verified / 2 porting / 15 pending`。
- fixtures/tests: 固定 Deep pure ports、page adapter、production document ingress、tokenized relay、page bridge、lifecycle 和 MSE 组合定向集为 `12 files / 31 passed`；`deep.probe-template-ingress` 现直接执行 `ElectronPageProbeEventAdapter` 产生的 production script，不再使用 target-only factory。
- accepted differences: 无新增差异；Worker CSP 探测/回退、Blob URL 有界清理和 already-loaded document 下一 task 扫描继续使用 capability map 中已记录的平台差异。
- excluded changes and reasons: 不修改 MSE 行为、main spool、renderer、IPC 或资源 authority；MSE hooks 在同一 IIFE 中先安装，不让异常页面的 Deep hook 安装失败阻断现有 MSE owner。
- unresolved gaps: 真实网站手工回归尚未执行；`mse-runtime` 仍须对照固定 `catch.js` 完成 audio/video flush-reset、页面预算、main spool 与稳定性证据。
- runtime changes: 新 `page-probe-runtime-core.ts` 只持有 console transport、资源投影和 MSE 字节 helper，`page-probe-host-api.ts` 只提供稳定 global contract/MSE fallback，`page-probe-document.ts` 按 host -> MSE -> global API -> MSE hooks -> generated owner -> Deep runtime/toolkit 组合唯一 production document script。
- legacy cleanup: 删除旧 builder/wrapper、disabled hooks、manifest heuristic、whole-probe Worker bootstrap、toolkit state/storage、`probeResources`、混合 core/host 与 target-only factory；28 个 Deep cleanup 条目收口为 `11 retain-or-adapt / 17 removed`，validator 继续强制检查已删 symbol 不得回归。
- validation: production Deep/MSE 定向 `12 files / 31 passed`、应用 TypeScript `--noEmit`、full ESLint、sync tests `16/16`、metadata/固定上游校验（`17 open / 106 cleanup / 187 planned tests`）和全仓 Vitest `202 files / 1377 passed / 3 skipped` 均通过。原始 `npm test` 会让 Vitest 误收 Node-native sync test 并报 `0 suite`，因此按既有门禁将该文件用 `node --test` 单跑并从 Vitest 排除。完整 build 为避免覆盖其他 Agent 的 dirty `dist-electron/**` 而不运行，当前也没有真实网站手工场景。

## 2026-08-29: same target (MSE spool owner and flushed-download boundary)

- observedHead / migrationTarget: 均为 `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步继续收口 MSE 的 main owner 与下载边界。
- reviewedThrough / portedThrough: 均保持 `null`；`mse.page-capture-runtime` 进入 `porting`，`mse.main-spool-lifecycle` 进入 `ported-unverified`，MSE unit 仍开放。
- change groups: `main-spool-owner`、`flushed-resource-download`、`relay-authorization`、`cleanup-metadata-correction` 与 `documentation-correction`。
- affected capability IDs: `mse.page-capture-runtime`、`mse.main-spool-lifecycle`；metadata 为 `7 units / 32 capabilities / 210 anchors / 99 cleanup entries / 187 planned IDs / 158 active refs`，状态为 `15 verified / 3 porting / 1 ported-unverified / 13 pending`。
- fixtures/tests: MSE pure runtime `mse.audio-video-flush-reset` / `mse.append-observability`、production probe characterization、`mse.lifecycle-cleanup`、`mse.spool-budget-recovery` 和 `mse.relay-forgery`；专项为 `4 files / 6 passed`，定向 ESLint 通过，metadata validator 通过。
- accepted differences: MSE page adapter 保留页面 Blob/open/export 作为无 flush 的 platform action；轨道发生 page flush 后，显式 download action 由 main 按当前 tab 的 opaque MSE resource keys 逐轨提取并写入系统 Downloads，避免只导出尾部内存数据。该直接下载路径尚未接入 browser download import queue。
- excluded changes and reasons: 未修改 DASH、HLS、transfer、renderer UI 或其他 agent 的 Agent Shell / dist-electron 改动；真实网站和完整 build 仍不可执行。
- unresolved gaps: 固定上游 `catch.js` 的完整差分、生产等价大媒体输出、自动下载重复/清理语义以及统一 task registry 仍待补齐；需要真实页面确认 MediaSource 双轨和长时间 flush。
- runtime changes: `MseSpoolStore` 接管 per-track append queue、预算、TTL、stale sweep 和所有 navigation/view/process/tab/controller 清理；relay 额外校验当前 tab 对 `mse-stream:*` resource key 的 ownership；main 下载路径优先读取 spool 并合并 page 尾部。
- legacy cleanup: 删除对已不存在 `mse-page-runtime.ts` 和旧 spool Map 的失真引用，cleanup 现在只保留现存 page adapter、spool store、clear/append facade 与仍需保留的 page bridge。
- validation: `npm run cat-catch:validate` 通过（`7 units / 32 capabilities / 17 open / 99 cleanup / 187 planned`）；MSE 定向 `4 files / 6 passed`；scoped ESLint 与 scoped diff check 通过。全仓 `tsc` 仍受其他 agent 的 `agent-shell-execution-lease.ts` 语法错误影响，未运行完整 build，也未做真实网站手工回归。

## 2026-08-29: same target (MSE automatic output handoff)

- observedHead / migrationTarget: 均为 `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步继续收口 MSE 输出边界。
- reviewedThrough / portedThrough: 均保持 `null`；`mse.page-capture-runtime` 继续 `porting`，`mse.main-spool-lifecycle` 继续 `ported-unverified`。
- change groups: `download-output-adapter`、`production-single-owner`、`documentation-correction`；不切换其他 unit。
- affected capability IDs: `mse.page-capture-runtime`、`mse.main-spool-lifecycle`；metadata 为 `7 units / 32 capabilities / 210 anchors / 99 cleanup entries / 188 planned IDs / 159 active refs`。
- fixtures/tests: 新增 `mse.auto-download-output`，锁定 staging 文件名净化、完成事件 payload、字节统计和现有下载清理根目录；production MSE probe 额外锁定同一捕捉周期重复 `endOfStream` 只安排一次自动动作；MSE 定向为 `5 files / 9 passed`。
- accepted differences: 自动完成动作在 main 侧优先合并首个 audio/video 轨道，ffmpeg 不可用时回退为逐轨输出；输出进入现有 embedded-browser staging root 并发布 completed download event，renderer 不再重复执行保存/合并 dialog。该平台交付差异不改变 Cat Catch page runtime 的捕捉和 reset 经验语义。
- excluded changes and reasons: 未修改 DASH、HLS、transfer、renderer UI、Agent Shell 或 `dist-electron/**`；没有真实网站和真实下载导入场景，未宣称 production parity。
- unresolved gaps: 固定 `catch.js` 的完整 MSE 差分、真实大媒体长时间 flush、真实页面双轨输出和 renderer 导入回归仍待补齐；`ffmpeg` preference 与统一 output task registry 归后续 output unit。
- runtime changes: `mse-download-output.ts` 将主进程生成的 merged/per-track 文件桥接为标准下载完成事件；renderer `useEmbeddedBrowserCatchToolkit` 删除重复 auto-export effect，页面 adapter 对同一 capture cycle 的 auto-download 做一次性调度。
- validation: MSE 定向 `5 files / 9 passed`、scoped ESLint、scoped diff check 与 metadata validator（`7 units / 32 capabilities / 17 open / 99 cleanup / 188 planned`）均通过；全仓 TypeScript 仍受其他 agent 的 `agent-shell-execution-lease.ts` 语法错误影响，完整 build 与真实页面验证继续不执行。

## 2026-08-29: same target (DASH parser-planner foundation)

- observedHead / migrationTarget: 均为 `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步只建立 DASH pure parser，不切 production dispatch。
- reviewedThrough / portedThrough: 均保持 `null`；`dash.parser-planner` 进入 `porting`，`dash-engine` unit 仍开放。
- change groups: `pure-parser-port`、`segment-expansion-boundary`、`xml-adapter-boundary` 与 `documentation-correction`。
- affected capability IDs: `dash.parser-planner`；metadata 为 `7 units / 32 capabilities / 210 anchors / 99 cleanup entries / 188 planned IDs / 162 active refs`，状态为 `15 verified / 4 porting / 1 ported-unverified / 12 pending`。
- fixtures/tests: `dash.parser-core`、`dash.base-url-timeline-ranges` 覆盖 MPD/Period/AdaptationSet/Representation 的 BaseURL 继承、模板 token、有限 `r=-1`、SegmentList init/media range、多轨 content type 和 DRM PSSH；额外锁定动态无界 repeat 的显式 unsupported reason；renderer XML adapter `dash.renderer-dom-adapter` 验证现有 MPD model 入口改走 target parser；DASH 专项 `2 files / 4 passed`。
- accepted differences: pure port 保留多个 BaseURL 候选并用首个候选生成具体 URL；XML DOM 由平台注入，避免 `cat-catch-port` 依赖 Electron/React/Node。动态无界 timeline 和 SegmentBase SIDX 不猜测展开，而是保留 unsupported reason，等待固定 `mpd-parser` 差分后决定执行语义。
- excluded changes and reasons: 未修改 renderer MPD model、main MPD downloader、ffmpeg、DASH IPC 或其他 unit；没有真实 MPD 网站、动态 MPD 下载和大媒体手工场景，未宣称 parser parity 或 production cutover。
- unresolved gaps: 固定 bundled `mpd-parser` 的 1.4.0/third-party 文档 1.4.1 provenance 差异、SegmentBase/SIDX、dynamic availability、多 Period 合并、真实下载/取消/合并和唯一 dispatch boundary 仍待处理。
- runtime changes: 新增 `cat-catch-port/dash/parser.ts` 纯 parser 与平台中性的 XML AST contract；现有 renderer MPD model 只保留 XML DOM -> AST 与旧 DTO 映射，旧 MPD downloader 继续是唯一 production execution owner。
- legacy cleanup: 无；旧 renderer parser 和 MPD downloader 在 `dash-engine` 原子切换前继续保留。
- validation: DASH parser/renderer adapter `2 files / 4 passed`、应用 TypeScript `--noEmit`、定向 ESLint、metadata validator、sync tests `16/16` 和 scoped diff check 均通过；完整 build 与真实页面验证不执行。

## 2026-08-29: same target (DASH timeline download task foundation)

- observedHead / migrationTarget: 均为 `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步建立 DASH processing task，不切 production dispatch。
- reviewedThrough / portedThrough: 均保持 `null`；`dash.parser-planner` 与 `dash.timeline-download-merge` 继续 `porting`，`dash-engine` unit 仍开放。
- change groups: `main-processing-owner`、`range-aware-transfer`、`cancellation-cleanup` 与 `documentation-correction`。
- affected capability IDs: `dash.timeline-download-merge`；metadata 为 `7 units / 32 capabilities / 210 anchors / 99 cleanup entries / 188 planned IDs / 165 active refs`，状态为 `15 verified / 5 porting / 1 ported-unverified / 11 pending`。
- fixtures/tests: `dash.negative-repeat` 锁定 parser unsupported reason 在 fetch 前拒绝；`dash.download-merge-cancel` 覆盖 init/media range、并发下载后的顺序写入、注入 merge 和外部 cancel/partial output 清理；`dash.dynamic-drm-rejection` 锁定 dynamic/DRM 不触发 fetch；DASH task/parser/renderer 定向为 `3 files / 7 passed`。
- accepted differences: `DashTaskExecutor` 复用现有 fragment downloader 的并发/重试实现，merge 通过 callback 交给既有 ffmpeg adapter；动态 MPD 和 SegmentBase SIDX 在没有完整上游差分前显式拒绝，不猜测成静态文件。
- excluded changes and reasons: 未修改 main MPD IPC、旧 downloader、ffmpeg process owner、renderer UI 或其他 unit；没有真实 MPD、动态直播和大媒体输出场景，未宣称 production parity。
- unresolved gaps: fixed `mpd-parser` 差分、SegmentBase/SIDX、多 Period 合并、main captured authority 接线、ffmpeg cancel/terminal、唯一 dispatch boundary 和旧 downloader cleanup 仍待完成。
- runtime changes: 新增 `processing/dash-task.ts#DashTaskExecutor`，收口 plan preflight、range、ordered writes、task abort、temp cleanup 和 output callback；旧 `embeddedBrowserMpdLocalDownloaderService` 继续唯一 production execution owner。
- legacy cleanup: 无；旧 MPD parser 已由 target model adapter 替换，但旧 MPD downloader 在 `dash-engine` 原子切换前保留。
- validation: DASH task/parser/renderer `3 files / 7 passed`、应用 TypeScript `--noEmit`、定向 ESLint、metadata validator、sync tests `16/16` 和 scoped diff check 均通过；完整 build 与真实页面验证不执行。

## 2026-08-29: same target (DASH production dispatch cutover)

- observedHead / migrationTarget: 均为 `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步将 MPD 计划下载的 production owner 切到 target task。
- reviewedThrough / portedThrough: 均保持 `null`；`dash.parser-planner` 与 `dash.timeline-download-merge` 继续 `porting`，`dash-engine` unit 仍开放。
- change groups: `main-authority-wiring`、`shared-ffmpeg-output-adapter`、`atomic-legacy-removal` 与 `documentation-correction`。
- affected capability IDs: `dash.timeline-download-merge`、`output.ffmpeg-process-owner`；metadata 为 `7 units / 32 capabilities / 210 anchors / 99 cleanup entries / 188 planned IDs / 167 active refs`。
- fixtures/tests: 新增 `dash-output.test.ts`，验证单轨与双轨本地文件均经现有可取消 ffmpeg runner；DASH task/parser/renderer/output 定向为 `4 files / 9 passed`，另有 authority 集成回归 `7 passed`。
- accepted differences: renderer MPD DTO 在 main 侧归一为 `DashTaskPlan`；分片通过 `CapturedResourceAccessService` 的 opaque resource authority 获取，输出复用 manifest ffmpeg runner 的 process terminal、cancel 和 partial-output cleanup 语义。单轨和双轨均保留现有文件扩展名与用户工作流。
- excluded changes and reasons: 未修改 renderer UI、HLS、MSE、transfer、Agent Shell 或 `dist-electron/**`；没有真实 MPD 网站、动态直播和大媒体 ffprobe 场景，未宣称 DASH unit 已关闭。
- unresolved gaps: SegmentBase/SIDX、多 Period 合并、dynamic availability、真实 MPD/ffprobe 输出和应用级统一 task registry 仍待完成；旧 MPD downloader 已无 production 引用并在本步删除。
- runtime changes: `downloadEmbeddedBrowserMpdPlanResource` 通过 `DashTaskExecutor` 执行，绑定 tab/request 生命周期；新增 `dash-output.ts` 将本地轨道接入共享可取消 ffmpeg runner；删除 `embeddedBrowserMpdLocalDownloaderService.ts` 及对应 cleanup entries。
- legacy cleanup: 删除旧 MPD local downloader 和旧 DASH track merge executor 条目；保留 main controller orchestration、DASH task 与 output adapter 为 `omniflow-integration`，等待 unit 完成后继续审计。
- validation: `npm run cat-catch:validate`、DASH 定向测试、scoped ESLint、应用 TypeScript `--noEmit` 与 scoped diff check 通过；完整 build 与真实页面验证不执行。

## 2026-08-29: same target (DASH SegmentBase and multi-Period boundary)

- observedHead / migrationTarget: 均为 `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步补 parser 的单文件与不可安全展开边界。
- reviewedThrough / portedThrough: 均保持 `null`；`dash.parser-planner` 与 `dash.timeline-download-merge` 继续 `porting`，`dash-engine` unit 仍开放。
- change groups: `segment-base-single-file`、`sidx-rejection`、`multi-period-rejection` 与 `fixture-contract`。
- affected capability IDs: `dash.parser-planner`、`dash.timeline-download-merge`；metadata 为 `7 units / 32 capabilities / 210 anchors / 99 cleanup entries / 189 planned IDs / 168 active refs`。
- fixtures/tests: `dash.segment-base-and-period-boundary` 覆盖无 SIDX/无 init range 的单文件 SegmentBase、SIDX indexRange、init range 需要拆分和多 Period；parser/task/output 定向为 `4 files / 10 passed`。
- accepted differences: SegmentBase 的 SIDX 二进制索引尚未移植，不能安全生成媒体分片时保留明确 unsupported reason；多 Period 暂不猜测跨 Period init/discontinuity 合并，统一在计划层拒绝，避免产出静默不完整文件。
- excluded changes and reasons: 未修改 DASH task/output dispatch、renderer UI、HLS、MSE、transfer、Agent Shell 或 `dist-electron/**`；未宣称 SIDX、多 Period 或真实媒体输出已完成。
- unresolved gaps: SIDX 读取与引用展开、跨 Period 合并、dynamic availability 和真实 MPD/ffprobe 输出仍待完成。
- runtime changes: `parseSegmentBase` 现在物化可安全处理的 single-file SegmentBase；对 invalid indexRange、SIDX 和需要 init range split 的情况记录不同 unsupported reason；`parseDashManifest` 对多 Period 记录 `multi-period-not-expanded`。
- legacy cleanup: 无新增删除；现有 target task/output adapter 继续作为唯一 production owner。
- validation: DASH parser/task/output 定向测试、TypeScript、scoped ESLint、metadata validator、sync tests `16/16` 和 scoped diff check 通过；完整 build 与真实页面验证不执行。

## 2026-08-29: same target (DASH SegmentList input boundary)

- observedHead / migrationTarget: 均为 `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步补 SegmentList 的显式 range、初始化和时基校验。
- reviewedThrough / portedThrough: 均保持 `null`；`dash.parser-planner` 与 `dash.timeline-download-merge` 继续 `porting`，`dash-engine` unit 仍开放。
- change groups: `segment-list-range-validation`、`segment-list-input-validation` 与 `fixture-contract`。
- affected capability IDs: `dash.parser-planner`；metadata 为 `7 units / 32 capabilities / 210 anchors / 99 cleanup entries / 190 planned IDs / 169 active refs`。
- fixtures/tests: `dash.segment-list-boundary` 覆盖非法 duration、timescale、Initialization range、media URL 和 media range；相关错误会进入 manifest unsupported reasons，并在 task preflight 前阻止整资源降级请求。
- accepted differences: parser 继续保留坏 `SegmentURL` 的结构投影，便于诊断和回放，但通过 unsupported reason 禁止 executable plan 继续下载；没有把缺失媒体 URL 或非法 range 静默修正为默认值。
- excluded changes and reasons: 未修改 SegmentBase SIDX、dynamic availability、多 Period 合并、renderer UI、HLS、MSE、transfer 或 output；未宣称 DASH unit 已关闭。
- unresolved gaps: SegmentBase SIDX、多 Period 合并、dynamic availability、完整 `mpd-parser` 差分和真实 MPD/ffprobe 输出仍待完成。
- runtime changes: `parseSegmentList` 现在识别非法 duration/timescale、Initialization range、SegmentURL media URL 与 media range，并统一写入 `unsupportedReasons`。
- legacy cleanup: 无新增删除；现有 target task/output adapter 继续作为唯一 production owner。
- validation: DASH parser/task/output/renderer `4 files / 11 passed`、TypeScript、scoped ESLint、metadata validator、sync tests `16/16` 和 scoped diff check 通过；完整 build 与真实页面验证不执行。

## 2026-08-29: same target (DASH SegmentList timeline semantics)

- observedHead / migrationTarget: 均为 `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步补固定 `mpd-parser` 的 SegmentList/SegmentTimeline 时序投影。
- reviewedThrough / portedThrough: 均保持 `null`；`dash.parser-planner` 与 `dash.timeline-download-merge` 继续 `porting`，`dash-engine` unit 仍开放。
- change groups: `segment-list-timeline`、`segment-time-conflict` 与 `fixture-contract`。
- affected capability IDs: `dash.parser-planner`；metadata 为 `7 units / 32 capabilities / 210 anchors / 99 cleanup entries / 191 planned IDs / 170 active refs`。
- fixtures/tests: `dash.segment-list-timeline` 覆盖 timeline 的显式 `t`、`r` 展开、`startNumber`、每片 duration/time/number 投影，以及同时声明 `duration` 或缺失时基的拒绝 reason；DASH parser/task/output/renderer `4 files / 12 passed`。
- accepted differences: SegmentList 的显式 URL 仍按 URL 数量投影，timeline 多出的时序项不生成额外网络请求；坏结构保留诊断投影但在 task preflight 前拒绝。
- excluded changes and reasons: 未修改 SegmentBase SIDX、dynamic availability、多 Period 合并、renderer UI、HLS、MSE、transfer 或 output；未宣称 DASH unit 已关闭。
- unresolved gaps: SegmentBase SIDX、多 Period 合并、dynamic availability、完整 `mpd-parser` 差分和真实 MPD/ffprobe 输出仍待完成。
- runtime changes: 新增共享 `expandSegmentTimelineTimings`，SegmentTemplate 与 SegmentList 均使用同一 `S` 展开语义；SegmentList 现在识别 timeline 与 duration 冲突及缺失时基。
- legacy cleanup: 无新增删除；现有 target task/output adapter 继续作为唯一 production owner。
- validation: DASH parser/task/output/renderer `4 files / 12 passed`、TypeScript、scoped ESLint、metadata validator、sync tests `16/16` 和 scoped diff check 通过；完整 build 与真实页面验证不执行。

## 2026-08-29: same target (DASH static duration semantics)

- observedHead / migrationTarget: 均为 `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步补固定 `mpd-parser` 对静态 duration 模式最后一片的剩余时长修正。
- reviewedThrough / portedThrough: 均保持 `null`；`dash.parser-planner` 与 `dash.timeline-download-merge` 继续 `porting`，`dash-engine` unit 仍开放。
- change groups: `static-final-duration`、`segment-list-duration-parity` 与 `fixture-contract`。
- affected capability IDs: `dash.parser-planner`；metadata 为 `7 units / 32 capabilities / 210 anchors / 99 cleanup entries / 192 planned IDs / 171 active refs`。
- fixtures/tests: `dash.segment-template-final-duration` 锁定 10 秒 MPD 以 3 秒 nominal duration 展开为 `3/3/3/1`；SegmentList duration-only 路径复用同一剩余时长规则；DASH parser/task/output/renderer `4 files / 13 passed`。
- accepted differences: duration-only plans remain bounded by the declared SegmentURL/template count; no extra URL is invented when the source advertises fewer segments than the computed static range.
- excluded changes and reasons: 未修改 SegmentBase SIDX、dynamic availability、多 Period 合并、renderer UI、HLS、MSE、transfer 或 output；未宣称 DASH unit 已关闭。
- unresolved gaps: SegmentBase SIDX、多 Period 合并、dynamic availability、完整 `mpd-parser` 差分和真实 MPD/ffprobe 输出仍待完成。
- runtime changes: SegmentTemplate 与 SegmentList 的 static duration mode 现在按 MPD/Period 剩余时长裁剪最后一片，避免输出时长被 nominal duration 向上取整。
- legacy cleanup: 无新增删除；现有 target task/output adapter 继续作为唯一 production owner。
- validation: DASH parser/task/output/renderer `4 files / 13 passed`、TypeScript、scoped ESLint、metadata validator、sync tests `16/16` 和 scoped diff check 通过；完整 build 与真实页面验证不执行。

## 2026-08-29: same target (DASH Period SegmentTemplate inheritance)

- observedHead / migrationTarget: 均为 `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步补固定 `mpd-parser@1.4.0` 的 Period 级 SegmentTemplate 继承。
- reviewedThrough / portedThrough: 均保持 `null`；`dash.parser-planner` 与 `dash.timeline-download-merge` 继续 `porting`，`dash-engine` unit 仍开放。
- change groups: `period-template-inheritance` 与 `fixture-contract`。
- affected capability IDs: `dash.parser-planner`；metadata 为 `7 units / 32 capabilities / 210 anchors / 99 cleanup entries / 193 planned IDs / 172 active refs`。
- fixtures/tests: `dash.period-template-inheritance` 覆盖 Period 提供的 initialization/media/startNumber/duration 被 Representation 使用，并验证静态最后一片按 Period 剩余时长裁剪；DASH parser/task/output/renderer `4 files / 14 passed`。
- accepted differences: 当前仍只在单个 Period 内展开；多 Period 合并和 Period 级 SegmentList/SegmentBase 继承继续作为独立开放项。
- excluded changes and reasons: 未修改 SegmentBase SIDX、Period 级 SegmentList/SegmentBase、dynamic availability、renderer UI、HLS、MSE、transfer 或 output；未宣称 DASH unit 已关闭。
- unresolved gaps: SegmentBase SIDX、多 Period 合并、dynamic availability、完整 `mpd-parser` 差分和真实 MPD/ffprobe 输出仍待完成。
- runtime changes: `parseDashManifest` 将 Period SegmentTemplate 传入表示层，并按 Period -> AdaptationSet -> Representation 合并属性和 timeline 子节点。
- legacy cleanup: 无新增删除；现有 target task/output adapter 继续作为唯一 production owner。
- validation: DASH parser/task/output/renderer `4 files / 14 passed`、TypeScript、scoped ESLint、metadata validator、sync tests `16/16` 和 scoped diff check 通过；完整 build 与真实页面验证不执行。

## 2026-08-29: same target (DASH Period SegmentList/SegmentBase inheritance)

- observedHead / migrationTarget: 均为 `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步补固定 `mpd-parser@1.4.0` 的 Period 级 SegmentList/SegmentBase 继承。
- reviewedThrough / portedThrough: 均保持 `null`；`dash.parser-planner` 与 `dash.timeline-download-merge` 继续 `porting`，`dash-engine` unit 仍开放。
- change groups: `period-segment-info-inheritance` 与 `fixture-contract`。
- affected capability IDs: `dash.parser-planner`；metadata 为 `7 units / 32 capabilities / 210 anchors / 99 cleanup entries / 194 planned IDs / 173 active refs`。
- fixtures/tests: `dash.period-segment-info-inheritance` 覆盖 Period duration-only SegmentList 的 URL/timing 投影，以及无 indexRange 的 Period SegmentBase 单文件投影；DASH parser/task/output/renderer `4 files / 15 passed`。
- accepted differences: 当前仍只在单个 Period 内展开；SegmentList/SegmentBase 与同级其他 segment info 同时声明时沿用现有 template 优先级，复杂数组合并未扩展为新的 fallback 语义。
- excluded changes and reasons: 未修改 SegmentBase SIDX、SegmentList/SegmentBase 的复杂跨层数组合并、dynamic availability、多 Period 合并、renderer UI、HLS、MSE、transfer 或 output；未宣称 DASH unit 已关闭。
- unresolved gaps: SegmentBase SIDX、多 Period 合并、dynamic availability、完整 `mpd-parser` 差分和真实 MPD/ffprobe 输出仍待完成。
- runtime changes: `parseDashManifest` 将 Period SegmentList/SegmentBase 传入表示层，并按 Period -> AdaptationSet -> Representation 合并属性和子节点。
- legacy cleanup: 无新增删除；现有 target task/output adapter 继续作为唯一 production owner。
- validation: DASH parser/task/output/renderer `4 files / 15 passed`、TypeScript、scoped ESLint、metadata validator、sync tests `16/16` 和 scoped diff check 通过；完整 build 与真实页面验证不执行。

## 2026-08-29: same target (DASH SegmentBase SIDX expansion)

- observedHead / migrationTarget: 均为 `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步补固定 `mpd-parser@1.4.0` 的 SegmentBase SIDX reference 到 byte-range 分片投影。
- reviewedThrough / portedThrough: 均保持 `null`；`dash.parser-planner` 与 `dash.timeline-download-merge` 继续 `porting`，`dash-engine` unit 仍开放。
- change groups: `segment-base-sidx-expansion`、`sidx-range-fetch`、`fixture-contract`。
- affected capability IDs: `dash.parser-planner`、`dash.timeline-download-merge`；metadata 为 `7 units / 32 capabilities / 210 anchors / 99 cleanup entries / 196 planned IDs / 175 active refs`。
- fixtures/tests: `dash.segment-base-sidx-expansion` 覆盖 version 0/1 SIDX、firstOffset、reference duration/size、presentationTimeOffset 和 nested-only reject；`dash.segment-base-sidx-task-fetch` 覆盖 main task 通过 range fetch 取得 SIDX、生成有序媒体 Range 并写出顺序字节；DASH parser/task/output/renderer `5 files / 18 passed`。
- accepted differences: parser 只在纯层保留 index range 元数据，二进制 SIDX 由 main task 在 captured-resource authority 内拉取；nested reference 会被跳过，nested-only SIDX 稳定拒绝，不扩展递归 SIDX 链。
- excluded changes and reasons: 未修改动态 MPD、复杂嵌套 SIDX 递归、多 Period 合并、renderer UI、HLS、MSE、transfer 或 output；未宣称 DASH unit 已关闭，也未宣称已有真实 MPD/ffprobe parity。
- unresolved gaps: 动态 availability、复杂嵌套 SIDX、多 Period 合并、完整 `mpd-parser` 差分和真实 MPD/ffprobe 输出仍待完成。
- runtime changes: `SegmentBase` valid `indexRange` 现在进入 plan；`DashTaskExecutor` 在分片 downloader 前用同一 headers/signal/captured fetch 拉取 index range，`parseDashSidx` 将 ISO BMFF references 转为带绝对 byte range 的 `DashSegment`。
- legacy cleanup: 无新增删除；现有 target task/output adapter 继续作为唯一 production owner。
- validation: DASH parser/task/output/renderer `5 files / 18 passed`、TypeScript、scoped ESLint、metadata validator、sync tests `16/16` 和 scoped diff check 通过；完整 build 与真实页面验证不执行。

## 2026-08-29: same target (DASH constrained multi-Period merge)

- observedHead / migrationTarget: 均为 `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步补固定 `mpd-parser@1.4.0` 对同身份静态多 Period 的串接语义。
- reviewedThrough / portedThrough: 均保持 `null`；`dash.parser-planner` 与 `dash.timeline-download-merge` 继续 `porting`，`dash-engine` unit 仍开放。
- change groups: `multi-period-merge`、`initialization-compatibility-boundary` 与 `fixture-contract`。
- affected capability IDs: `dash.parser-planner`；metadata 为 `7 units / 32 capabilities / 210 anchors / 99 cleanup entries / 197 planned IDs / 176 active refs`。
- fixtures/tests: `dash.multi-period-merge` 覆盖相同 content type/id/language/BaseURL、可复用 init segment 的两个静态 Period，验证分片串接、URL 顺序和 index 重排；已有多身份 Period fixture 继续验证 `multi-period-not-expanded` 拒绝。DASH parser 定向为 `1 file / 10 passed`。
- accepted differences: 纯 parser 只在所有 Period 都提供同一轨道身份且 initialization range/URL 兼容时合并；跨 BaseURL、缺失 Period 轨道、同一 Period 重复身份、SegmentBase 或初始化冲突继续明确拒绝，不模拟多个 init segment 的播放器切换语义。
- excluded changes and reasons: 未修改 dynamic availability、复杂嵌套 SIDX、SegmentBase 递归、renderer UI、HLS、MSE、transfer 或 output；没有真实 MPD/ffprobe 场景，未宣称 DASH unit 已关闭。
- unresolved gaps: dynamic `r=-1` availability、复杂嵌套 SIDX、多轨道跨 Period 的播放器级 init/discontinuity 语义、真实 MPD/ffprobe 输出和 unit 关闭条件仍待完成。
- runtime changes: `parseDashManifest` 先按 Period 解析，再以 content type/id/language/首 BaseURL 形成轨道身份；兼容组的 segments 以 manifest 顺序串接并重排 `index`，冲突路径保留 `multi-period-not-expanded` 或 `multi-period-initialization-conflict`。
- legacy cleanup: 无新增删除；现有 target parser/task/output adapter 继续作为唯一 production owner。
- validation: DASH parser 定向 `10/10`，全量 Vitest（排除 Node 专用同步 runner）`212 files / 1409 passed / 3 skipped`，全量 `npm run lint`、应用 TypeScript `--noEmit`、metadata validator 和同步 runner `16/16` 均通过；完整 build 与真实页面验证未执行，build 仍避免触碰其他 agent 的 dirty `dist-electron/**`。

## 2026-08-29: same target (DASH availability-bounded dynamic repeat)

- observedHead / migrationTarget: 均为 `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步补固定 `mpd-parser@1.4.0` 对 dynamic MPD 最后一个 `SegmentTimeline r=-1` 的 availability 窗口计算。
- reviewedThrough / portedThrough: 均保持 `null`；`dash.parser-planner` 与 `dash.timeline-download-merge` 继续 `porting`，`dash-engine` unit 仍开放。
- change groups: `dynamic-availability-window`、`clock-injection` 与 `fixture-contract`。
- affected capability IDs: `dash.parser-planner`；metadata 为 `7 units / 32 capabilities / 210 anchors / 99 cleanup entries / 198 planned IDs / 177 active refs`。
- fixtures/tests: `dash.dynamic-negative-repeat-availability` 注入固定 `nowMs`，覆盖 `availabilityStartTime + minimumUpdatePeriod + $Number$` 计算出的有限 6 片窗口，以及窗口尚未到达时的零片展开；原有无 availability 证据的动态 `r=-1` fixture 继续验证显式拒绝。DASH parser 定向为 `1 file / 11 passed`。
- accepted differences: 动态窗口只用于 parser 计划展示，`DashTaskExecutor` 仍拒绝所有 dynamic MPD；不注入真实系统时间到 fixture，调用方可用 `nowMs` 做确定性回放；动态 duration-only 模板、AST/UTC timing 和 live 轮询仍未迁入。
- excluded changes and reasons: 未修改 dynamic task/live refresh、复杂嵌套 SIDX、SegmentBase 递归、renderer UI、HLS、MSE、transfer 或 output；没有真实直播 MPD/ffprobe 场景，未宣称 DASH unit 已关闭。
- unresolved gaps: dynamic duration-only availability、UTC timing/client offset、manifest refresh/live task、复杂嵌套 SIDX、多轨道跨 Period init/discontinuity 语义、真实 MPD/ffprobe 输出和 unit 关闭条件仍待完成。
- runtime changes: `parseDashManifest` 解析 MPD `availabilityStartTime`、`minimumUpdatePeriod`、Period `start` 并接受可选 `nowMs`；最后一个动态 `r=-1` 按上游 `ceil` 规则计算可用 segment count，缺少时间证据继续使用 `segment-timeline-negative-repeat-unbounded`。
- legacy cleanup: 无新增删除；现有 target parser/task/output adapter 继续作为唯一 production owner。
- validation: DASH parser 定向 `11/11`，全量 Vitest（排除 Node 专用同步 runner）`212 files / 1410 passed / 3 skipped`，全量 `npm run lint`、应用 TypeScript `--noEmit`、metadata validator 和同步 runner `16/16` 均通过；完整 build 与真实页面验证未执行，build 仍避免触碰其他 agent 的 dirty `dist-electron/**`。

## 2026-08-29: same target (DASH dynamic duration-only window)

- observedHead / migrationTarget: 均为 `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步补固定 `mpd-parser@1.4.0` 对 dynamic MPD duration-only `SegmentTemplate` 的时间窗口语义。
- reviewedThrough / portedThrough: 均保持 `null`；`dash.parser-planner` 与 `dash.timeline-download-merge` 继续 `porting`，`dash-engine` unit 仍开放。
- change groups: `dynamic-duration-window`、`time-shift-buffer-boundary` 与 `fixture-contract`。
- affected capability IDs: `dash.parser-planner`；metadata 为 `7 units / 32 capabilities / 210 anchors / 99 cleanup entries / 199 planned IDs / 178 active refs`。
- fixtures/tests: `dash.dynamic-duration-availability` 注入固定 `nowMs`，覆盖 `availabilityStartTime`、`minimumUpdatePeriod`、`timeShiftBufferDepth` 计算出的 live 窗口，并验证起始 number/time、结束边界和 URL；DASH parser 定向为 `1 file / 12 passed`。
- accepted differences: 动态 duration-only 结果只用于解析计划展示，`DashTaskExecutor` 仍拒绝 dynamic MPD；不实现 `endNumber`、UTC timing/client offset 或动态清单刷新，缺少 availability 证据时保持 `segment-template-duration-unbounded` 拒绝。
- excluded changes and reasons: 未修改 dynamic task/live refresh、复杂嵌套 SIDX、SegmentBase 递归、renderer UI、HLS、MSE、transfer 或 output；没有真实直播 MPD/ffprobe 场景，未宣称 DASH unit 已关闭。
- unresolved gaps: dynamic task/refresh、UTC timing/client offset、`endNumber`/其他 availability 属性、复杂嵌套 SIDX、多轨道跨 Period init/discontinuity 语义、真实 MPD/ffprobe 输出和 unit 关闭条件仍待完成。
- runtime changes: `expandSegmentTemplate` 在 dynamic duration-only 模式按上游 start/end 公式计算窗口，应用 `timeShiftBufferDepth` 截断起点，按 `$Number$`/`$Time$` 物化有限 segments；static duration-only 路径继续使用原有 MPD/Period duration 和最后一片裁剪。
- legacy cleanup: 无新增删除；现有 target parser/task/output adapter 继续作为唯一 production owner。
- validation: DASH parser 定向 `12/12`，DASH parser/task/output/renderer 定向 `5 files / 21 passed`，全量 Vitest（排除 Node 专用同步 runner）`212 files / 1411 passed / 3 skipped`，全量 `npm run lint`、应用 TypeScript `--noEmit`、metadata validator 和同步 runner `16/16` 均通过；完整 build 与真实页面验证未执行，build 仍避免触碰其他 agent 的 dirty `dist-electron/**`。

## 2026-08-29: same target (DASH finite dynamic snapshot execution)

- observedHead / migrationTarget: 均为 `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步把已有 availability-bounded / duration-only dynamic 计划从“全部拒绝”收口为有限当前窗口 snapshot 下载。
- reviewedThrough / portedThrough: 均保持 `null`；`dash.parser-planner` 与 `dash.timeline-download-merge` 继续 `porting`，`dash-engine` unit 仍开放。
- change groups: `dynamic-snapshot-download`、`finite-window-preflight` 与 `fixture-contract`。
- affected capability IDs: `dash.timeline-download-merge`；metadata 为 `7 units / 32 capabilities / 210 anchors / 99 cleanup entries / 200 planned IDs / 179 active refs`。
- fixtures/tests: `dash.dynamic-snapshot-download` 验证 dynamic 计划中的有限当前窗口按 manifest 顺序下载并合并输出；空 dynamic window 保持明确拒绝。DASH parser/SIDX/task 定向为 `3 files / 19 passed`。
- accepted differences: 这是一次有限 snapshot 执行，不负责重新抓取 MPD 或持续刷新；无分片 dynamic window、DRM、parser unsupported reason、复杂嵌套 SIDX 和不兼容多 Period 仍稳定拒绝。
- excluded changes and reasons: 未修改 dynamic manifest refresh/live task、复杂嵌套 SIDX、SegmentBase 递归、renderer UI、HLS、MSE、transfer 或 output；没有真实直播 MPD/ffprobe 场景，未宣称 DASH unit 已关闭。
- unresolved gaps: dynamic refresh/live、UTC timing/client offset、`endNumber`/其他 availability 属性、复杂嵌套 SIDX、多轨道跨 Period init/discontinuity 语义、真实 MPD/ffprobe 输出和 unit 关闭条件仍待完成。
- runtime changes: `DashTaskExecutor` 对 dynamic 计划继续复用 range-aware downloader、顺序写入、取消和 output adapter；仅在选中轨道拥有有限 segments 时允许执行，controller 不再提前按 `isDynamic` 拒绝。
- legacy cleanup: 无新增删除；现有 target parser/task/output adapter 继续作为唯一 production owner。
- validation: DASH parser/SIDX/task `3 files / 19 passed`、全量 Vitest（排除 Node 专用同步 runner）`212 files / 1412 passed / 3 skipped`、全量 `npm run lint`、应用 TypeScript `--noEmit`、metadata validator 和同步 runner `16/16` 均通过；直接运行 `npm test` 仍会错误收集 Node 专用 `tools/cat-catch-sync/validate.test.mjs` 并报告 `No test suite found`，按既有门禁排除该文件后通过；完整 build 与真实页面验证未执行，build 仍避免触碰其他 agent 的 dirty `dist-electron/**`。

## 2026-08-29: same target (DASH SegmentTemplate endNumber)

- observedHead / migrationTarget: 均为 `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步补固定 `mpd-parser@1.4.0` 对 SegmentTemplate `endNumber` 的静态和动态展开边界。
- reviewedThrough / portedThrough: 均保持 `null`；`dash.parser-planner` 与 `dash.timeline-download-merge` 继续 `porting`，`dash-engine` unit 仍开放。
- change groups: `segment-template-end-number`、`duration-boundary` 与 `fixture-contract`。
- affected capability IDs: `dash.parser-planner`；metadata 为 `7 units / 32 capabilities / 210 anchors / 99 cleanup entries / 201 planned IDs / 180 active refs`。
- fixtures/tests: `dash.segment-template-end-number` 覆盖 static duration-only 的 `endNumber` 截断、无 MPD/Period 总时长时仍按 nominal duration 展开、dynamic duration-only availability window 的 `endNumber` 上界以及负值产生空计划的边界；DASH parser 定向为 `1 file / 13 passed`。
- accepted differences: 遵循固定上游的数组索引语义，`endNumber` 作为 exclusive 展开结束索引而不是按 `startNumber` 换算的绝对数量；非法负值稳定得到空计划，不抛出数组长度异常。
- excluded changes and reasons: 未修改 SegmentTimeline `endNumber` 交互、dynamic task/live refresh、UTC timing/client offset、复杂嵌套 SIDX、renderer UI、HLS、MSE、transfer 或 output；没有真实 MPD/ffprobe 场景，未宣称 DASH unit 已关闭。
- unresolved gaps: dynamic refresh/live、UTC timing/client offset、其他 availability 属性、复杂嵌套 SIDX、多轨道跨 Period init/discontinuity 语义、真实 MPD/ffprobe 输出和 unit 关闭条件仍待完成。
- runtime changes: `expandSegmentTemplate` 以固定上游 `parseInt` 读取 `endNumber`，在 static duration-only 和 dynamic availability window 中裁剪展开范围；无效/负值不会进入负长度 `Array.from`。
- legacy cleanup: 无新增删除；现有 target parser/task/output adapter 继续作为唯一 production owner。
- validation: DASH parser `13/13`、TypeScript、全量 ESLint、metadata validator、同步 runner `16/16` 和 scoped diff check 通过；完整 Vitest 仍按既有规则排除 Node 专用同步 runner，完整 build 与真实页面验证未执行，build 仍避免触碰其他 agent 的 dirty `dist-electron/**`。

## 2026-08-29: same target (DASH dynamic client clock offset)

- observedHead / migrationTarget: 均为 `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本步补固定 `mpd-parser@1.4.0` 对 `NOW + clientOffset` 参与 dynamic window 计算的语义。
- reviewedThrough / portedThrough: 均保持 `null`；`dash.parser-planner` 与 `dash.timeline-download-merge` 继续 `porting`，`dash-engine` unit 仍开放。
- change groups: `dynamic-client-clock`、`availability-window` 与 `fixture-contract`。
- affected capability IDs: `dash.parser-planner`；metadata 为 `7 units / 32 capabilities / 210 anchors / 99 cleanup entries / 202 planned IDs / 181 active refs`。
- fixtures/tests: `dash.dynamic-client-offset` 注入固定 `nowMs` 与 `clientOffsetMs`，分别覆盖 dynamic `SegmentTimeline r=-1` 和 duration-only 窗口的有效分片边界；DASH parser 定向为 `1 file / 14 passed`。
- accepted differences: `clientOffsetMs` 是调用方提供的毫秒级确定性校时输入，不在 pure parser 内发起 `UTCTiming` 网络请求；无效偏移按零处理，持续 live refresh 仍由 task 层负责。
- excluded changes and reasons: 未修改 UTC timing HTTP/DIRECT 协商、dynamic task/live refresh、SegmentTimeline `endNumber` 交互、复杂嵌套 SIDX、renderer UI、HLS、MSE、transfer 或 output；没有真实 MPD/ffprobe 场景，未宣称 DASH unit 已关闭。
- unresolved gaps: dynamic refresh/live、UTC timing/client offset 的生产接线、其他 availability 属性、复杂嵌套 SIDX、多轨道跨 Period init/discontinuity 语义、真实 MPD/ffprobe 输出和 unit 关闭条件仍待完成。
- runtime changes: 新增共享 `resolveNowSeconds`，将有限 `clientOffsetMs` 与 `nowMs` 合并后用于 dynamic `r=-1` 和 duration-only availability 计算；静态计划和无偏移调用保持原行为。
- legacy cleanup: 无新增删除；现有 target parser/task/output adapter 继续作为唯一 production owner。
- validation: DASH parser `14/14`、TypeScript、全量 ESLint、metadata validator、全量 Vitest（排除 Node 专用同步 runner）`212 files / 1414 passed / 3 skipped` 和同步 runner `16/16` 均通过；完整 build 与真实页面验证未执行。

## 2026-08-29: same target (DASH dynamic snapshot owner)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本切片只推进 DASH 动态任务的可验证纯逻辑，不宣称 unit 完成。
- change groups: `behavioral`（按 representation/number/time/url/range 去重、只交付新分片、minimumUpdatePeriod 轮询窗口）与 `platform-adaptation`（注入式 snapshot loader、scheduler、AbortSignal、停止/丢弃生命周期）。
- affected capability IDs: `dash.timeline-download-merge` 保持 `porting`。
- fixtures/tests: `dash-live-task.test.ts#dash.dynamic-refresh-dedupe`、`#dash.dynamic-refresh-cancel`，覆盖首 snapshot、重叠刷新、增量回调、1.5–10 秒轮询夹逼和取消。
- excluded changes and reasons: 未接入新的 IPC/preload；main 当前没有安全的 XML DOM parser，本轮不把 renderer DOM 或不受信任页面脚本塞进 task，也不宣称真实 MPD/live output parity。
- unresolved gaps: 需要 main-owned captured-resource fetch + XML AST adapter，把真实 dynamic MPD 解析成 `DashTaskPlan`；随后才可把 delta 交给 `DashTaskExecutor`/统一 output owner，并补导航、tab close、ffmpeg/output cleanup integration。
- runtime changes: `DashLiveTask` 新增 main-side lifecycle/refresh/dedupe owner；`DashTaskPlan` 透传 `minimumUpdatePeriodSeconds`；现有静态/有限 snapshot MPD dispatch 行为不变。
- legacy cleanup: 无；DASH unit 仍未 cutover，旧实现不能删除。
- validation: DASH 定向 Vitest 8/8、TypeScript、Cat Catch 相关 ESLint 通过；未运行完整 build，未做真实页面和真实 MPD/ffprobe 验证。

## 2026-08-29: same target (DASH main MPD XML adapter)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动。
- reviewedThrough / portedThrough: 均保持 `null`；本切片补齐 main-owned MPD snapshot 读取和 XML AST 转换，不宣称 `dash-engine` unit 完成。
- change groups: `main-mpd-adapter`、`bounded-xml-input` 与 `fixture-contract`。
- affected capability IDs: `dash.parser-planner`、`dash.timeline-download-merge`，继续 `porting`。
- fixtures/tests: `dash-live-adapter.test.ts#dash.main-xml-adapter` 使用真实 dynamic MPD XML 覆盖 namespace、BaseURL、SegmentTemplate、minimumUpdatePeriod 和 client clock；同文件另覆盖 loader URL 保持、非 2xx、malformed XML、DOCTYPE/ENTITY、MPD 大小限制和 AbortSignal；adapter、live task、parser 定向共 `3 files / 25 passed`。
- accepted differences: `@xmldom/xmldom` 仅在 main adapter 使用，纯 parser 仍只消费平台中立 AST；MPD 文本默认限制为 8 MiB，DTD/ENTITY 直接拒绝，renderer DOM 和 renderer headers 不进入 adapter。
- excluded changes and reasons: 未新增 preload/IPC 或持续 live 输出协议；动态任务仍由注入式 `DashLiveTask` 管理，真实 captured-resource production 接线、导航/tab close cleanup 和真实 MPD/ffprobe 输出仍待完成。
- unresolved gaps: dynamic refresh/live IPC、增量输出交付、复杂嵌套 SIDX、不完整或初始化冲突的多 Period 集合、真实媒体输出和 unit 关闭条件仍开放。
- runtime changes: 新增 `processing/dash-live-adapter.ts`，通过注入的 main fetch 读取 bounded MPD response，拒绝 DTD/ENTITY，以 `@xmldom/xmldom` 构建 `DashXmlElement`，调用 `parseDashManifest` 并映射为 `DashTaskPlan`；`createDashLiveSnapshotLoader` 可直接供 `DashLiveTask` 使用。
- legacy cleanup: 无；DASH unit 尚未 cutover，旧实现继续保留。
- validation: adapter/live/parser 定向 Vitest `25/25`、应用 TypeScript `--noEmit` 通过；未运行完整 build，未做真实页面/真实 MPD/ffprobe 验证。

## Template

## 2026-08-29: same target (DASH live production lifecycle)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本切片把 DASH dynamic snapshot 从纯 task/adapter 接入 main 生产生命周期。
- reviewedThrough / portedThrough: 均保持 `null`；`dash.parser-planner` 与 `dash.timeline-download-merge` 继续 `porting`，`dash-engine` unit 仍开放。
- change groups: `platform-adaptation`（main-owned captured-resource authority、bounded MPD XML adapter、独立 IPC/preload）与 `behavioral`（只追加 Representation 新 init/media bytes、停止合并、按 tab/view/app 清理）。
- affected capability IDs: `dash.timeline-download-merge`；metadata 为 `7 units / 32 capabilities / 210 anchors / 100 cleanup entries / 208 planned IDs / 187 active refs`。
- fixtures/tests: `dash-task-live-append.test.ts#dash.dynamic-live-append` 验证 init 只写一次、media bytes 按顺序追加；同文件 `#dash.dynamic-live-append-cancel` 验证外部 AbortSignal 终止 fragment downloader；`dash-live-session-owner.test.ts#dash.dynamic-session-owner` 与 `#dash.dynamic-session-owner-active-task` 覆盖 tab 清理、revision snapshot 和 active task abort；`embeddedBrowserMainIpc.test.ts#dash.renderer-task-snapshot-ipc` 覆盖 start/stop/discard/list IPC forwarding；DASH live/adapter/task/output 定向测试共 `6 files / 22 passed`。
- accepted differences: live 录制默认选择首个 video/audio Representation，renderer 可提交 opaque representation id；当前不新增 renderer UI、不把 MPD headers 或 task 真相暴露给页面，live 输出停止后复用现有本地轨道到 ffmpeg adapter。
- excluded changes and reasons: 未扩展到通用 task registry、复杂嵌套 SIDX、跨 Period discontinuity、DASH DRM 或真实网站/ffprobe；未修改 HLS、MSE、Agent Shell、`dist-electron/**` 或其他 agent 的 dirty 文件。
- unresolved gaps: 无真实 dynamic MPD/ffprobe output 证据；多 Period/复杂 SIDX、renderer workflow 接入和 `dash-engine` 原子关闭仍待完成。
- runtime changes: 新增 `dash-live-session-owner.ts`，补 `appendDashRepresentationSegments`；controller 新增 DASH live start/stop/discard 与 `embedded-browser:dash-task` revision snapshot；preload/electron-env/resource API 暴露对应 typed bridge；导航、tab close、view destroyed、render-process-gone 和 dispose 均清理 DASH session/workdir。
- legacy cleanup: 无；DASH unit 尚未 cutover，旧实现和 `legacy-cleanup.json` 继续保留。
- validation: `npm run cat-catch:validate`、DASH 定向 Vitest `22/22`、应用 TypeScript `--noEmit` 和 scoped ESLint 通过；完整 build 未运行，避免覆盖其他 agent 的 dirty `dist-electron/**`，真实页面/真实 MPD 验证未执行。

## 2026-08-29: same target (DASH live manifest authority boundary)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本切片修正 DASH live start 对 captured resource authority 的 URL 绑定。
- reviewedThrough / portedThrough: 均保持 `null`；`dash.parser-planner` 与 `dash.timeline-download-merge` 继续 `porting`，`dash-engine` unit 仍开放。
- change groups: `platform-adaptation`（main-only authority resolver）与 `security-contract`（禁止 manifest URL mismatch 退回 browser-session fetch）。
- affected capability IDs: `dash.timeline-download-merge`；metadata 为 `7 units / 32 capabilities / 210 anchors / 100 cleanup entries / 209 planned IDs / 188 active refs`。
- fixtures/tests: `electron/service/embedded-browser/integrations/dash-manifest-authority.test.ts#dash.live-manifest-authority` 覆盖精确 URL、URL mismatch 和 stale/missing authority；DASH 定向测试为 `6 files / 20 passed`。
- accepted differences: DASH live 要求 renderer 提交的 manifest URL 与被兑换 captured resource 的 first-hop URL 完全一致；URL 规范化或跨资源推断不会在该入口隐式发生，避免任务生命周期中出现无 authority 请求。
- excluded changes and reasons: 未改 HLS live 的既有入口、DASH parser/transfer 算法、renderer UI、通用 task registry 或真实 MPD/ffprobe 输出；这些仍由各自开放能力追踪。
- unresolved gaps: 复杂嵌套 SIDX、不完整或初始化冲突的多 Period、真实 dynamic MPD/ffprobe、renderer workflow 和 `dash-engine` 原子关闭仍待完成。
- runtime changes: 新增 `integrations/dash-manifest-authority.ts#resolveDashManifestAuthority`，controller 在创建 live snapshot loader 前严格兑换并比对 URL；失败在保存对话框和网络请求前返回 authority 错误。
- legacy cleanup: 无；DASH unit 尚未 cutover，旧实现和 `legacy-cleanup.json` 继续保留。
- validation: 新 authority、DASH live task/adapter/append/session owner/output、IPC 定向 Vitest `20/20`，应用 TypeScript `--noEmit`、scoped ESLint 和 `git diff --check` 通过；完整 build、完整 Vitest、真实页面/真实 MPD/ffprobe 未执行。

## 2026-08-29: same target (DASH live terminal cleanup)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本切片补齐 DASH live 轮询非 Abort 错误后的 session/workdir 清理。
- reviewedThrough / portedThrough: 均保持 `null`；`dash.parser-planner` 与 `dash.timeline-download-merge` 继续 `porting`，`dash-engine` unit 仍开放。
- change groups: `lifecycle`（terminal error callback、live session cleanup）与 `stability`（保留错误 snapshot、避免任务卡死）。
- affected capability IDs: `dash.timeline-download-merge`；metadata 为 `7 units / 32 capabilities / 210 anchors / 100 cleanup entries / 210 planned IDs / 189 active refs`。
- fixtures/tests: `dash-live-task.test.ts#dash.dynamic-refresh-terminal-error` 覆盖第二轮 MPD 刷新失败、终止错误回调和保留当前 plan；DASH 定向测试为 `6 files / 21 passed`。
- accepted differences: 轮询出现非取消错误后，live task 进入终态并由 main owner 清理 workdir；最后一条 error snapshot 仍可供 renderer 恢复显示，之后必须重新开始任务。
- excluded changes and reasons: 未修改 HLS live、DASH parser/transfer 算法、通用 task registry、renderer UI 或真实 MPD/ffprobe 输出。
- unresolved gaps: 复杂嵌套 SIDX、不完整或初始化冲突的多 Period、真实 dynamic MPD/ffprobe、renderer workflow 和 `dash-engine` 原子关闭仍待完成。
- runtime changes: `DashLiveTask` 新增 `onTerminalError`，controller 以 `clearLive` 清理任务资源而不删除错误 snapshot；启动阶段失败仍由 start catch 做完整清理。
- legacy cleanup: 无；DASH unit 尚未 cutover，旧实现和 `legacy-cleanup.json` 继续保留。
- validation: DASH 定向 Vitest `21/21`、应用 TypeScript `--noEmit`、scoped ESLint、metadata validator 和 `git diff --check` 通过；完整 build、完整 Vitest、真实页面/真实 MPD/ffprobe 未执行。

## 2026-08-29: same target (DASH static real output evidence)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本切片补 DASH 静态双轨的真实 FFmpeg/FFprobe 输出证据。
- reviewedThrough / portedThrough: 均保持 `null`；`dash.parser-planner` 与 `dash.timeline-download-merge` 继续 `porting`，`dash-engine` unit 仍开放。
- change groups: `output-integration`（本地轨道输入模式）与 `fixture-contract`（真实生成媒体/探测）。
- affected capability IDs: `dash.timeline-download-merge`；metadata 为 `7 units / 32 capabilities / 210 anchors / 100 cleanup entries / 211 planned IDs / 190 active refs`。
- fixtures/tests: `electron/service/embeddedBrowserDashRealOutput.test.ts#dash.real-ffmpeg-ffprobe-output` 在本机可用 ffmpeg/ffprobe 时生成极小静态 DASH fMP4，读取 MPD、下载双轨 init/media、合并并验证 MP4 容器、正时长、H.264 video 和 AAC audio；相关 DASH/output 定向为 `4 files / 12 passed`。
- accepted differences: 真实输出测试使用临时 FFmpeg 生成的静态 MPD 和 injected local asset fetch，不宣称 dynamic MPD refresh 或真实网站 authority parity；缺失 ffmpeg/ffprobe 时整个测试显式 skip。
- excluded changes and reasons: 未改 HLS manifest 参数、DASH parser/live 轮询、复杂 SIDX、多 Period、renderer UI、通用 task registry 或资料库交付。
- unresolved gaps: 动态 MPD/真实 live output、复杂嵌套 SIDX、不完整或初始化冲突的多 Period、renderer workflow 和 `dash-engine` 原子关闭仍待完成。
- runtime changes: `embeddedBrowserResourceManifestDownloadService` 增加 `inputKind: 'local-file'`，本地输入跳过 HLS 专用 `-protocol_whitelist/-allowed_extensions` 与 HTTP headers；DASH output adapter 显式使用该模式，HLS 默认保持原 `hls-manifest`。
- legacy cleanup: 无；DASH unit 尚未 cutover，旧实现和 `legacy-cleanup.json` 继续保留。
- validation: DASH/output 定向 `12/12`、真实 FFmpeg/FFprobe test 通过；此前全仓 lint、排除 Node runner 的 Vitest `217 files / 1434 passed / 3 skipped`、TypeScript、metadata validator、sync runner `16/16` 均通过；完整 build、真实网站/动态 MPD 未执行。

## 2026-08-29: same target (DASH dynamic refresh real output evidence)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本切片补 DASH dynamic MPD 两轮刷新、增量追加和最终双轨输出证据。
- reviewedThrough / portedThrough: 均保持 `null`；`dash.parser-planner` 与 `dash.timeline-download-merge` 继续 `porting`，`dash-engine` unit 仍开放。
- change groups: `live-output-integration`（dynamic snapshot -> append -> merge）与 `fixture-contract`（真实生成 fMP4）。
- affected capability IDs: `dash.timeline-download-merge`；metadata 为 `7 units / 32 capabilities / 210 anchors / 100 cleanup entries / 212 planned IDs / 191 active refs`。
- fixtures/tests: `electron/service/embeddedBrowserDashRealOutput.test.ts#dash.real-dynamic-refresh-append-output` 生成 3 秒 H.264/AAC DASH fMP4，将同一 MPD 投影为首轮两片和第二轮完整窗口；两份 snapshot 均经 `DashLiveTask`，新增分片通过 `appendDashRepresentationSegments` 写入 main 临时轨道，停止后由 `mergeDashTaskTracksToOutput` 合并并用 FFprobe 检查 MP4、正时长、H.264 video 和 AAC audio；该文件 `2/2` 通过。
- accepted differences: 测试使用本地生成媒体与 injected asset fetch，dynamic MPD 的刷新由受控 snapshot 队列模拟，不宣称真实网站时钟、authority 或长时间 live 稳定性；缺失 ffmpeg/ffprobe 时测试显式 skip。
- excluded changes and reasons: 未改 DASH parser、SIDX、authority、renderer UI、通用 task registry、HLS 或资料库交付；复杂嵌套 SIDX 与多 Period 边界继续单独追踪。
- unresolved gaps: 复杂嵌套 SIDX、不完整或初始化冲突的多 Period、真实网站 live、renderer workflow 和 `dash-engine` 原子关闭仍待完成。
- runtime changes: 无生产运行时代码变更；仅新增真实 dynamic refresh/append/output 测试与能力地图引用。
- legacy cleanup: 无；DASH unit 尚未 cutover，旧实现和 `legacy-cleanup.json` 继续保留。
- validation: `embeddedBrowserDashRealOutput.test.ts` `2/2` 通过；本切片后需重跑 TypeScript、scoped/full lint、metadata validator、sync runner 与相关 DASH 集合，完整 build 仍因共享 `dist-electron/**` dirty 生成物暂不执行。

## 2026-08-29: same target (DASH nested SIDX range expansion)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本切片补 SegmentBase 嵌套 SIDX 的主 task 逐层 range fetch。
- reviewedThrough / portedThrough: 均保持 `null`；`dash.parser-planner` 与 `dash.timeline-download-merge` 继续 `porting`，`dash-engine` unit 仍开放。
- change groups: `parser-planner`（SIDX reference metadata）与 `transfer`（nested range owner）。
- affected capability IDs: `dash.timeline-download-merge`；metadata 为 `7 units / 32 capabilities / 210 anchors / 100 cleanup entries / 213 planned IDs / 192 active refs`。
- fixtures/tests: `electron/service/embedded-browser/processing/dash-task.test.ts#dash.segment-base-nested-sidx-task-fetch` 构造顶层 SIDX -> 子 SIDX -> 两个媒体 range，验证请求 `0-43`、`44-99`、`100-102`、`103-104`，最终轨道字节按索引顺序输出；SIDX/task 定向 `2 files / 8 passed`（含此前单层 SIDX、取消和 dynamic 相关测试）。
- accepted differences: task 侧递归最多 8 层；超过深度、空引用、非法 range 或子索引无媒体引用时显式失败，避免无限递归和静默丢片；单层 `parseDashSidx` 对外行为保持不变。
- excluded changes and reasons: 未改 MPD parser、live polling、authority、renderer UI、HLS、资料库交付或旧实现清理。
- unresolved gaps: 超过 8 层的极端 SIDX、复杂多 Period、真实网站 live、renderer workflow 和 `dash-engine` 原子关闭仍待完成。
- runtime changes: `dash/sidx.ts` 新增纯 `parseDashSidxReferences` 元数据投影；`dash-task.ts` 新增受限递归 SIDX range fetch，并沿用已有 headers、AbortSignal、ordered downloader 和 cleanup。
- legacy cleanup: 无；DASH unit 尚未 cutover，旧实现和 `legacy-cleanup.json` 继续保留。
- validation: SIDX/parser/task 定向测试、TypeScript、scoped ESLint、metadata validator、sync runner 需在本切片提交前重跑；完整 build 仍因共享 `dist-electron/**` dirty 生成物暂不执行。

## 2026-08-29: same target (DASH implicit Period duration)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本切片修正静态多 Period 缺省 `duration` 的推导。
- reviewedThrough / portedThrough: 均保持 `null`；`dash.parser-planner` 与 `dash.timeline-download-merge` 继续 `porting`，`dash-engine` unit 仍开放。
- change groups: `parser-planner`（Period timing inference）。
- affected capability IDs: `dash.parser-planner`；metadata 保持 `7 units / 32 capabilities / 210 anchors / 100 cleanup entries / 213 planned IDs / 192 active refs`。
- fixtures/tests: 扩展 `electron/service/embedded-browser/cat-catch-port/dash/parser.test.ts#dash.multi-period-merge`，根 MPD 只有总时长、两个 Period 只有 `start` 时，第一段时长取下一个显式 start 的差值，最后一段取 MPD 总时长减当前 start，并验证同身份轨道合并为 6 片；parser 定向 `14/14` 通过。
- accepted differences: 明确声明的 Period `duration` 优先；缺省时只在 start/总时长可推导的范围内补齐，无法可靠推导的集合仍保持现有 multi-period rejection 语义。
- excluded changes and reasons: 未改 SIDX、live polling、authority、renderer UI、HLS、资料库交付或旧实现清理。
- unresolved gaps: 复杂/交错 Period 身份、跨层 SegmentInfo 数组语义、真实网站 live、renderer workflow 和 `dash-engine` 原子关闭仍待完成。
- runtime changes: `parseDashManifest` 在计算每个 Period 计划前检查后续显式 start，并为末 Period 使用 MPD 总时长作为边界，避免把根总时长重复套用到每个 Period。
- legacy cleanup: 无；DASH unit 尚未 cutover，旧实现和 `legacy-cleanup.json` 继续保留。
- validation: parser/DASH 定向、TypeScript、scoped ESLint、metadata validator、sync runner 需在本切片提交前重跑；完整 build 仍因共享 `dist-electron/**` dirty 生成物暂不执行。

## 2026-08-29: same target (DASH SIDX recursion guard)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本切片为嵌套 SIDX 增加深度上限回归证据。
- reviewedThrough / portedThrough: 均保持 `null`；`dash.parser-planner` 与 `dash.timeline-download-merge` 继续 `porting`，`dash-engine` unit 仍开放。
- change groups: `stability`（bounded recursion rejection）。
- affected capability IDs: `dash.timeline-download-merge`；metadata 保持 `7 units / 32 capabilities / 210 anchors / 100 cleanup entries / 213 planned IDs / 192 active refs`。
- fixtures/tests: 扩展 `electron/service/embedded-browser/processing/dash-task.test.ts#dash.segment-base-nested-sidx-task-fetch`，构造 9 条嵌套引用链，验证在固定 8 层上限处抛出“嵌套层级超过限制”，不进入媒体下载或 merge。
- accepted differences: 深度上限是明确的资源保护策略；合法但超过 8 层的极端层级仍拒绝，后续若有真实样本再单独评估上限，而不是取消边界。
- excluded changes and reasons: 未改生产输出协议、MPD parser、live polling、authority、renderer UI、HLS、资料库交付或旧实现清理。
- unresolved gaps: 真实网站复杂 SIDX、多 Period/初始化冲突、renderer workflow 和 `dash-engine` 原子关闭仍待完成。
- runtime changes: 无新增生产代码；仅补充现有递归 owner 的超限回归断言。
- legacy cleanup: 无；DASH unit 尚未 cutover，旧实现和 `legacy-cleanup.json` 继续保留。
- validation: 嵌套 SIDX 定向 `1/1`、TypeScript、scoped ESLint、metadata validator、sync runner 在前一切片已通过；本切片测试断言重跑通过，完整 build 仍因共享 `dist-electron/**` dirty 生成物暂不执行。

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

## 2026-08-29: same target (MSE flushed automatic completion handoff)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本切片补齐 Cat Catch `autoDown` 在 page flush 后的 main-owned 自动输出边界。
- reviewedThrough / portedThrough: 均保持 `null`；`mse.page-capture-runtime` 继续 `porting`，`mse.main-spool-lifecycle` 继续 `ported-unverified`，`mse-runtime` unit 仍开放。
- change groups: `completion-handoff`、`relay-authorization`、`production-single-owner` 与 `fixture-contract`。
- affected capability IDs: `mse.page-capture-runtime`、`mse.main-spool-lifecycle`；metadata 当前为 `7 units / 32 capabilities / 210 anchors / 100 cleanup entries / 214 planned IDs / 193 active refs`，状态为 `15 verified / 5 porting / 1 ported-unverified / 11 pending`。
- fixtures/tests: 新增 `electron/service/embedded-browser/capture/adapters/mse-page.test.ts#mse.auto-download-after-flush`，用可注入的小阈值复现 page flush，验证完成时发出一次带 `mse-stream:*` resource key 的 `mse-complete` 且不再排队页面 500ms 下载；`mse-main-relay.test.ts#mse.relay-forgery` 验证完成事件与 flush/reset 一样必须通过当前 tab ownership；MSE 定向集合为 `7 files / 13 passed`。
- accepted differences: 无 flush 的小媒体仍由页面 Blob action 延迟下载；发生 flush 后自动完成由 main 复用现有 spool 提取、双轨合并/逐轨回退和 completed download event，不把已刷出的媒体重新拉回页面内存。
- excluded changes and reasons: 未修改 Cat Catch 的 1GB UI preference、DASH/HLS、transfer、renderer UI、统一 task registry、真实网站或 `dist-electron/**`；1GB 长时间压力和真实下载导入仍需环境验证。
- unresolved gaps: 固定 `catch.js` 的完整 MSE 差分、真实大媒体长时间 flush、真实页面双轨输出、ffmpeg preference/task registry 与 renderer 导入回归仍待补齐，不能关闭 MSE unit。
- runtime changes: `mse-page.ts` 在 auto-download completion 发现任一轨道已 flush 时发出一次 `mse-complete`；`electron-page-probe.ts` 和 `mse-main-relay.ts` 将事件纳入 token/resource ownership 边界；main controller 收到后调用现有 `downloadEmbeddedBrowserMseResourcesToDownloads`，避免 page/main 双重输出。
- legacy cleanup: 无新增删除；旧 Cat Catch 页面实现继续保留至 MSE unit 完成 parity 和真实回归。
- validation: MSE 定向 `7 files / 13 passed`、应用 TypeScript `--noEmit`、scoped ESLint、`npm run cat-catch:validate`（`7 units / 32 capabilities / 17 open / 100 cleanup / 214 planned`）通过；完整 build 与真实页面验证仍不执行，以免覆盖其他 agent 的 dirty `dist-electron/**`。

## 2026-08-29: same target (MSE periodic large-output save)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本切片补齐 Cat Catch `save1GB` 的产品化周期保存链路。
- reviewedThrough / portedThrough: 均保持 `null`；`mse.page-capture-runtime` 继续 `porting`，`mse.main-spool-lifecycle` 继续 `ported-unverified`，`mse-runtime` unit 仍开放。
- change groups: `page-origin-preference`、`periodic-output`、`serialized-relay` 与 `fixture-contract`。
- affected capability IDs: `mse.page-capture-runtime`、`mse.main-spool-lifecycle`；metadata 当前为 `7 units / 32 capabilities / 210 anchors / 100 cleanup entries / 215 planned IDs / 194 active refs`，状态为 `15 verified / 5 porting / 1 ported-unverified / 11 pending`。
- fixtures/tests: 新增 `electron/service/embedded-browser/capture/adapters/mse-page.test.ts#mse.periodic-large-output`，用可注入的小阈值验证每个累计阈值只触发一次、清理后可重新计数；relay 与 page-probe 测试覆盖 `mse-save` 的 payload 授权和路由；同步更新 toolkit origin-storage 与 deep probe round-trip。
- accepted differences: 产品设置名为 `saveEveryGigabyte`，默认关闭并持久化在当前页面 origin；实际阈值仍为 1 GiB。周期保存复用 main 合并/逐轨输出和现有完成事件，不在 renderer 复制媒体数据。
- excluded changes and reasons: 未修改 HLS/DASH、transfer、统一 task registry、真实网站/真实大媒体或 `dist-electron/**`；MSE 固定上游 parity、真实导入和长时间压力验证仍开放。
- unresolved gaps: 需要真实页面验证 flush 与保存时序、真实双轨 ffmpeg 输出及失败后重试/清理；MSE unit 不能因 synthetic threshold test 关闭。
- runtime changes: page-origin state 增加 `OmniflowCatchToolkit:saveEveryGigabyte`，MSE 在 flush 后按累计总字节跨越阈值发出 `mse-save`；main controller 以 tab 为粒度串行处理 flush/save/reset，成功周期输出后清 page cache 和 MSE spool。
- legacy cleanup: 无新增删除；旧 Cat Catch 页面实现继续保留至 MSE parity 和真实回归完成。
- validation: 本切片修改完成后重跑 MSE 定向 Vitest、TypeScript、scoped ESLint、metadata validator、sync runner 与 `git diff --check`；完整 build 与真实页面验证仍受共享 dirty `dist-electron/**` 和当前无测试场景限制。

## 2026-08-29: same target (MSE global media-size threshold)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本切片修正 Cat Catch `mediaSize` 的全局音视频累计语义。
- reviewedThrough / portedThrough: 均保持 `null`；`mse.page-capture-runtime` 继续 `porting`，`mse.main-spool-lifecycle` 继续 `ported-unverified`，`mse-runtime` unit 仍开放。
- change groups: `upstream-diff`、`periodic-output` 与 `fixture-contract`。
- affected capability IDs: `mse.page-capture-runtime`；metadata 当前为 `7 units / 32 capabilities / 210 anchors / 100 cleanup entries / 216 planned IDs / 195 active refs`，状态为 `15 verified / 5 porting / 1 ported-unverified / 11 pending`。
- fixtures/tests: 新增 `electron/service/embedded-browser/capture/adapters/mse-page.test.ts#mse.periodic-large-output-uses-total-bytes`，用 video/audio 各自低于阈值但合计跨阈值的 fixture 锁定只触发一次周期保存。
- accepted differences: 继续使用产品化的 flush 后保存和成功后清理，不复刻上游在 append 代理内先下载再清理的页面时序；阈值判定严格复刻上游 `mediaSize` 的全局累计含义。
- excluded changes and reasons: 未修改 HLS/DASH、transfer、统一 task registry、真实网站/真实大媒体或 `dist-electron/**`；MSE 固定上游其他异常路径、真实导入和长时间压力验证仍开放。
- unresolved gaps: 仍需真实双轨页面确认累计阈值、spool 时序、ffmpeg 输出和失败后重试；MSE unit 不能因 synthetic threshold test 关闭。
- runtime changes: `mse-page.ts` 以 `runtime.getSnapshot().totalBytes` 判定周期阈值，保持跨轨道全局累计并在 flush 后的 resource projection 完成后发送 `mse-save`。
- legacy cleanup: 无新增删除；旧 Cat Catch 页面实现继续保留至 MSE parity 和真实回归完成。
- validation: MSE/Cat Catch 定向 `10 files / 21 passed`、TypeScript `--noEmit`、scoped ESLint、`npm run cat-catch:validate`、同步校验 `16/16` 与非 `dist-electron/**` 的 `git diff --check` 均通过；完整 build、全仓 lint/test 与真实页面验证仍受共享 dirty `dist-electron/**` 和当前无测试场景限制。

## 2026-08-29: same target (MSE completion and clear boundary)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本切片补齐固定 `catch.js` 的完成开关与空轨道清理边界。
- reviewedThrough / portedThrough: 均保持 `null`；`mse.page-capture-runtime` 继续 `porting`，`mse.main-spool-lifecycle` 继续 `ported-unverified`，`mse-runtime` unit 仍开放。
- change groups: `upstream-diff`、`completion-gate`、`cache-clear` 与 `fixture-contract`。
- affected capability IDs: `mse.page-capture-runtime`；metadata 当前为 `7 units / 32 capabilities / 210 anchors / 100 cleanup entries / 218 planned IDs / 197 active refs`，状态为 `15 verified / 5 porting / 1 ported-unverified / 11 pending`。
- fixtures/tests: `electron/service/embedded-browser/cat-catch-port/mse/runtime.test.ts#mse.completion-respects-capture-gate` 验证关闭捕获时 `endOfStream` 不产生完成事件，重新开启后才完成；`#mse.complete-clear-without-streams` 验证已完成但没有轨道时 `clear()` 仍重置完成状态；MSE runtime 定向 `1 file / 4 passed`。
- accepted differences: OmniFlow 的 `isCaptureEnabled` 是可选平台开关，与 append 观察保持一致；native `addSourceBuffer` / `endOfStream` 异常继续只传播一次，不复制 Cat Catch catch 分支中可能重复调用失败 native 方法的副作用。
- excluded changes and reasons: 未修改 MSE spool、周期输出、HLS/DASH、transfer、renderer UI、真实网站或 `dist-electron/**`；真实页面异常状态和大媒体压力仍需环境验证。
- unresolved gaps: 固定上游 MSE 头部裁剪、长时间大媒体、双轨输出失败恢复、真实下载导入和 MSE unit 原子关闭仍待完成。
- runtime changes: `mse/runtime.ts` 在 `endOfStream` 后仅于捕获开关开启时设置 `isComplete` 并发出完成事件；`clear()` 在无轨道但已完成时继续执行上游的完成清理分支。
- legacy cleanup: 无新增删除；旧 Cat Catch 页面实现继续保留至 MSE parity 和真实回归完成。
- validation: MSE 关联集合 `7 files / 17 passed`、TypeScript `--noEmit`、scoped ESLint、`npm run cat-catch:validate`（`7 units / 32 capabilities / 17 open / 100 cleanup / 218 planned`）、同步 runner `16/16` 和非 `dist-electron/**` 的 `git diff --check` 均通过；完整 build、全仓 lint/test 与真实页面验证仍因共享 dirty 生成物和当前无测试场景不执行。

## 2026-08-29: same target (MSE sparse-buffer auto-seek)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本切片补齐固定 `catch.js` 自动缓冲尾使用首个 range 的语义。
- reviewedThrough / portedThrough: 均保持 `null`；`mse.page-capture-runtime` 继续 `porting`，`mse.main-spool-lifecycle` 继续 `ported-unverified`，`mse-runtime` unit 仍开放。
- change groups: `upstream-diff`、`page-media-control` 与 `fixture-contract`。
- affected capability IDs: `mse.page-capture-runtime`；metadata 当前为 `7 units / 32 capabilities / 210 anchors / 100 cleanup entries / 219 planned IDs / 198 active refs`，状态为 `15 verified / 5 porting / 1 ported-unverified / 11 pending`。
- fixtures/tests: `electron/service/embedded-browser/capture/adapters/mse-page.test.ts#mse.auto-buffer-seek-uses-first-range` 构造两个 buffered ranges，验证 progress 时读取 `end(0)` 并将 currentTime 定位到首段末尾前 5 秒；page-adapter 定向 `1 file / 4 passed`。
- accepted differences: 保留 OmniFlow 对稀疏 range 的异常保护和 `max(bufferedEnd - 5, 0)` 防负值；首段选择与固定上游一致，未把最后一段当作默认跳转目标。
- excluded changes and reasons: 未修改 MSE runtime/spool、周期输出、HLS/DASH、transfer、renderer UI、真实网站或 `dist-electron/**`；真实页面多 range seek 和播放状态仍需环境验证。
- unresolved gaps: 固定上游 MSE 头部裁剪、长时间大媒体、双轨输出失败恢复、真实下载导入和 MSE unit 原子关闭仍待完成。
- runtime changes: `mse-page.ts` 的 auto-seek progress handler 改用 `element.buffered.end(0)`，保持页面 adapter 其余生命周期和 listener owner 不变。
- legacy cleanup: 无新增删除；旧 Cat Catch 页面实现继续保留至 MSE parity 和真实回归完成。
- validation: MSE 关联集合 `7 files / 18 passed`、TypeScript `--noEmit`、scoped ESLint、metadata validator（`7 units / 32 capabilities / 17 open / 100 cleanup / 219 planned`）、同步 runner `16/16` 和非 `dist-electron/**` diff check 均通过；完整 build、全仓 lint/test 与真实页面验证仍因共享 dirty 生成物和当前无测试场景不执行。

## 2026-08-29: same target (MSE cross-flush header trimming)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本切片补齐固定 `catch.js` 最后初始化头部裁剪在 main-owned spool 上的跨 flush 语义。
- reviewedThrough / portedThrough: 均保持 `null`；`mse.page-capture-runtime` 继续 `porting`，`mse.main-spool-lifecycle` 继续 `ported-unverified`，`mse-runtime` unit 仍开放。
- change groups: `upstream-diff`、`large-media-output`、`relay-contract` 与 `fixture-contract`。
- affected capability IDs: `mse.page-capture-runtime`、`mse.main-spool-lifecycle`；metadata 当前为 `7 units / 32 capabilities / 210 anchors / 100 cleanup entries / 220 planned IDs / 200 active refs`，状态为 `15 verified / 5 porting / 1 ported-unverified / 11 pending`。
- fixtures/tests: `electron/service/embedded-browser/capture/adapters/mse-page.test.ts#mse.cross-flush-header-trim` 验证后续 flush 含初始化头部时发出 `trimBeforeHeader`；`electron/service/embedded-browser/capture/adapters/mse-main-relay.test.ts#mse.relay-forgery` 验证该标记只能作为已授权 flush 字段通过；`electron/service/embedded-browser/processing/mse-spool.test.ts#mse.header-trim-replaces-earlier-flush` 验证清理旧轨道后只保留新 flush 字节；MSE 关联集合为 `7 files / 20 passed`。
- accepted differences: Cat Catch 在 page 内存的完整 `catchMedia` 列表上裁剪；OmniFlow 通过受授权的 `trimBeforeHeader` 控制字段让 main 队列先删除对应 spool，再追加当前 flush，避免把 GB 级文件重新读入页面内存，输出语义保持一致。
- excluded changes and reasons: 未修改 MSE runtime 的 append/endOfStream、周期阈值、HLS/DASH、transfer、renderer UI、真实网站或 `dist-electron/**`；真实页面多次初始化头、长时间压力和最终 ffmpeg 导入仍需环境验证。
- unresolved gaps: 固定上游 MSE 头部识别的完整异常样本、长时间大媒体、双轨输出失败恢复、真实下载导入和 MSE unit 原子关闭仍待完成。
- runtime changes: `mse-page.ts` 在启用 `trimExtraMediaHeaders` 且当前 flush 含 MP4/WebM 头部时标记 `trimBeforeHeader`；relay 仅接受严格布尔值；main controller 在 per-tab 串行队列中先清理对应 resource spool 再追加 payload。
- legacy cleanup: 无新增删除；旧 Cat Catch 页面实现继续保留至 MSE parity 和真实回归完成。
- validation: 本切片 MSE 关联集合 `7 files / 20 passed`、TypeScript `--noEmit`、scoped ESLint、metadata validator（`7 units / 32 capabilities / 17 open / 100 cleanup / 220 planned`）、同步 runner `16/16` 和非 `dist-electron/**` diff check 均通过；完整 build、全仓 lint/test 与真实页面验证仍因共享 dirty 生成物和当前无测试场景不执行。

## 2026-08-29: same target (MSE real binary output)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本切片为 MSE main output 增加条件式真实 ffmpeg/ffprobe 双轨证据。
- reviewedThrough / portedThrough: 均保持 `null`；`mse.page-capture-runtime` 继续 `porting`，`mse.main-spool-lifecycle` 继续 `ported-unverified`，`mse-runtime` unit 仍开放。
- change groups: `large-media-output` 与 `fixture-contract`。
- affected capability IDs: `mse.main-spool-lifecycle`；metadata 当前为 `7 units / 32 capabilities / 210 anchors / 100 cleanup entries / 221 planned IDs / 201 active refs`，状态为 `15 verified / 5 porting / 1 ported-unverified / 11 pending`。
- fixtures/tests: `electron/service/embeddedBrowserMseRealOutput.test.ts#mse.real-ffmpeg-ffprobe-output` 用本机 ffmpeg 生成独立 fragmented MP4 视频/音频轨道，经生产 `mergeEmbeddedBrowserResourceTracks` 合并，并用 ffprobe 验证 MP4 容器、正时长、H.264 video 与 AAC audio；MSE 关联集合为 `8 files / 21 passed`（ffmpeg/ffprobe 不可用时按条件 skip）。
- accepted differences: 测试使用可重复的 lavfi 小媒体作为生产输出链 fixture，不宣称真实网站、长时间大媒体或页面 extraction/import parity。
- excluded changes and reasons: 未修改 MSE page runtime、header trim、spool budget、relay、HLS/DASH、transfer、renderer UI 或 `dist-electron/**`；真实页面和大媒体压力仍需环境验证。
- unresolved gaps: 固定上游 MSE 头部识别的完整异常样本、长时间大媒体、双轨合并失败恢复、真实页面下载导入和 MSE unit 原子关闭仍待完成。
- runtime changes: 无生产 runtime 变化；新增条件式真实二进制 output fixture。
- legacy cleanup: 无新增删除；旧 Cat Catch 页面实现继续保留至 MSE parity 和真实回归完成。
- validation: 本切片真实 MSE output `1 passed`、完整 MSE 集合 `8 files / 21 passed`、TypeScript `--noEmit`、scoped ESLint、metadata validator（`7 units / 32 capabilities / 17 open / 100 cleanup / 221 planned`）、同步 runner `16/16` 和非 `dist-electron/**` diff check 均通过；完整 build、全仓 lint/test 与真实页面验证仍因共享 dirty 生成物和当前无测试场景不执行。

## 2026-08-29: same target (MSE drain header trimming)

- observedHead / migrationTarget: `2cb981d7c2f4614732edccc167c4b5793d1cb138`；游标不移动，本切片补齐固定 `catch.js` 头部裁剪在最终 page drain 进入 main spool 时的语义。
- reviewedThrough / portedThrough: 均保持 `null`；`mse.page-capture-runtime` 继续 `porting`，`mse.main-spool-lifecycle` 继续 `ported-unverified`，`mse-runtime` unit 仍开放。
- change groups: `upstream-diff`、`large-media-output`、`relay-contract` 与 `fixture-contract`。
- affected capability IDs: `mse.page-capture-runtime`、`mse.main-spool-lifecycle`；metadata 当前为 `7 units / 32 capabilities / 210 anchors / 100 cleanup entries / 222 planned IDs / 202 active refs`，状态为 `15 verified / 5 porting / 1 ported-unverified / 11 pending`。
- fixtures/tests: `electron/service/embedded-browser/capture/adapters/mse-page.test.ts#mse.drain-header-trim` 验证 WebM 初始化头在最终 drain 中被标记；MSE 关联集合为 `8 files / 22 passed`。
- accepted differences: Cat Catch 在 page 内存的完整 `catchMedia` 列表上裁剪；OmniFlow 通过 page drain 返回严格布尔标记，让 main 在追加未 flush 尾部前清理对应 spool，避免把 GB 级文件重新读入页面内存，输出语义保持一致。
- excluded changes and reasons: 未修改 MSE runtime 的 append/endOfStream、周期阈值、HLS/DASH、transfer、renderer UI、真实网站或 `dist-electron/**`；真实页面多次初始化头、长时间压力和最终 ffmpeg 导入仍需环境验证。
- unresolved gaps: 固定上游 MSE 头部识别的完整异常样本、长时间大媒体、双轨输出失败恢复、真实下载导入和 MSE unit 原子关闭仍待完成。
- runtime changes: `mse-page.ts` 和 page-drain bridge 返回 `trimBeforeHeader`；main 的 drain extraction 在有旧 spool 时先清理对应 resource，再追加 page 尾部。
- legacy cleanup: 无新增删除；旧 Cat Catch 页面实现继续保留至 MSE parity 和真实回归完成。
- validation: 本切片 page/drain 定向 `2 files / 7 passed`、TypeScript `--noEmit`、scoped ESLint 均通过；完整 MSE 集合、metadata validator、同步 runner 和非 `dist-electron/**` diff check 将在提交前重跑，完整 build、全仓 lint/test 与真实页面验证仍因共享 dirty 生成物和当前无测试场景不执行。
