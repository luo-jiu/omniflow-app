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
- fixtures/tests: 新增 active fixture `hls-byterange-implicit-offset`，覆盖 parser core、map/key/discontinuity 和同一资源省略 offset 的连续 range。
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
