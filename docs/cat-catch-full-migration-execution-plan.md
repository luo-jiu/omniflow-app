# Cat Catch 全面迁移执行计划

更新时间：2026-08-26

状态：生效。当前固定迁移目标为 `2cb981d7c2f4614732edccc167c4b5793d1cb138`，尚未完成初始行为审计与迁移。

适用范围：OmniFlow 内置浏览器的资源发现、页面深搜、MSE 捕捉、HLS/DASH 解析与下载、请求上下文、任务生命周期、文件处理以及资料库输出集成。

本文是迁移边界和完成定义。版本游标由 `docs/cat-catch/upstream-state.json` 维护，逐项事实由 `docs/cat-catch/capability-map.json` 维护，初始 cutover 期间的旧位置由临时文件 `docs/cat-catch/legacy-cleanup.json` 维护。

## 1. 目标

OmniFlow 不运行 Cat Catch 浏览器扩展，而是把与产品目标相关的行为和经验分支迁入一个可维护的纯逻辑 port，再通过薄 adapter 接入 Electron 与 OmniFlow。

我们追求的长期结果是：

- 新 Agent 能从明确的上游游标继续同步，不需要重新猜本地历史。
- 上游 source anchor、本地实现、测试和已知差异可以逐项对应。
- Cat Catch 的经验分支由 fixture 和测试保护，不能被“更规范”的重写静默删除。
- 每项生产能力只有一个 owner。
- 每个 cutover unit 切换后，立即删除该 unit 的旧算法、旧 listener、旧 flag、兼容转发和旧测试 helper。
- 后续维护成本主要取决于 Cat Catch 新增了多少行为，而不是 OmniFlow 仓库大小。

## 2. 完成定义

固定目标版本的全面迁移完成，必须同时满足：

1. `upstream-state.json.migrationTarget` 之前的目标范围已全部分类，`reviewedThrough` 等于该 commit。
2. `capability-map.json` 中每项能力均为 `verified` 或有明确理由的 `excluded`。
3. 所有纳入能力都有实际存在的测试；需要结构化输入时再使用 fixture，不能只有计划名称。
4. Cat Catch 来源行为已通过可执行差分、独立规范 expectation 或明确的平台等价测试验证。
5. 每个 cutover unit 已在唯一 dispatch boundary 切换到新 owner。
6. `legacy-cleanup.json` 中所有 `remove-after-cutover` 项均已删除；`retain-or-adapt` 项已明确归入 OmniFlow adapter/integration。
7. 不存在长期双栈、隐藏 fallback、旧 feature flag 或仍指导使用旧实现的活跃文档。
8. TypeScript、lint、相关 Vitest、Electron fixture、输出正确性和资源清理验证通过。
9. `portedThrough` 等于迁移目标，第三方来源与许可证说明准确。

最后一个 unit 切换后，先保留 `legacy-cleanup.json` 运行校验，确认所有 `remove-after-cutover` symbol 已消失且 `retain-or-adapt` owner 仍存在。校验通过后，在最终整理提交中同时删除该文件、capability map 的 legacy `currentImplementationRefs`，以及 validator 中只服务于初始 cleanup 的分支和回归测试。Git commit/tag 和已发布版本是回滚手段，不保留一份无法持续测试的旧运行时作为备用。

## 3. 当前事实

### 3.1 上游

| 字段 | 当前值 |
| --- | --- |
| repository | `https://github.com/xifangczy/cat-catch` |
| branch | `master` |
| baseline / observed / migration target | `2cb981d7c2f4614732edccc167c4b5793d1cb138` |
| description | `2.7.2-22-g2cb981d` |
| reviewedThrough | 未建立 |
| portedThrough | 未建立 |

`observedHead` 只表示最近看到了哪个版本；`reviewedThrough` 表示此前变化已分类；`portedThrough` 表示此前所有纳入变化已实现并验证，或已明确排除。三者不能混用。

### 3.2 当前 OmniFlow

现有资源捕捉实现只能作为 characterization 输入，不能作为正确性 oracle。已确认的事实包括：

- 深度 Worker/fetch/XHR/JSON/key hooks 被 `enableDeepRuntimeHooks = false` 关闭，外围 MSE hooks 仍运行。
- 网络捕捉使用 `onCompleted`，Cat Catch 在首字节阶段的 `onResponseStarted` 识别。
- request context 无明确容量和 TTL，敏感 header 值还会进入 renderer DTO。
- HLS 已知缺少隐式 BYTERANGE offset、一次性 manifest cache fallback、伪装分片预处理等经验分支。
- DASH 手写 parser 对 `r=-1`、多 BaseURL、动态 MPD 等语义不完整。
- HLS、DASH、MSE、ffmpeg、临时文件和输出交付尚无统一 task/cleanup 合同。
- 当前 network classifier/rules、page URL policy、main-only request context vault、main-owned resource state contract 与未注册的 Electron network adapter 的 11 个计划 ID 已落成专项纯行为/合同或 fake `webRequest` integration test；adapter 已按 `onSendHeaders -> onResponseStarted` 接通 vault/store 并同步投影 context 失效，但尚未接入生产入口、IPC/reducer 或下载 consumer，其余计划 ID 仍只是需求种子，尚无 active fixture/test。

因此当前有 5 项能力达到 `ported-unverified`，其余 27 项仍为 `pending`；不能因为同名代码存在就标记为已迁移或已验证。

## 4. 长期事实文件

### 4.1 `upstream-state.json`

唯一维护上游版本游标：

- `baselineCursor`：本轮全面迁移最初依据，固定不动。
- `observedHead`：最近 fetch 后看到的 HEAD。
- `migrationTarget`：当前准备完整迁入的固定版本。
- `reviewedThrough`：正式分类已经覆盖到的 commit；当前批不得越过 `migrationTarget`。
- `portedThrough`：最近一个完整实现并验证的 commit；新批次未完成时保留旧值，只有首次迁移前为 `null`。

当前批 capability 是否完成由 `syncState` 和 `syncedThrough === migrationTarget` 一起派生，unit 进度再从成员 capability 派生，不在 state 文件重复维护。选定新 target 后，未受影响的已验证能力也要经过 diff 分类和相关测试再推进 `syncedThrough`；受影响能力保留旧 cursor 并进入 pending/porting。正式分类完成后先把 `reviewedThrough` 推进到 target；全部能力实现、验证并对齐 target 后，才把 `portedThrough` 推进到 target。

### 4.2 `capability-map.json`

长期保存 7 个 cutover unit 与 32 项初始能力：

- 上游 path、anchor 和固定 commit。
- 当前实现位置与计划目标位置。
- 能力与上游的关系、风险提示和已知缺口。
- 计划 test ID、真实 test refs、accepted difference。
- `syncState` 与单项 `syncedThrough`。

允许的 `syncState`：

- `pending`：当前 target 的工作尚未开始；`syncedThrough` 保留最近一次记录的 commit，首次迁移时为 `null`。
- `porting`：正在实现当前 target；`syncedThrough` 保留最近一次记录的 commit。
- `ported-unverified`：当前 target 的代码存在，但行为或集成证据不足；`syncedThrough` 指向 target。
- `verified`：最近记录版本的行为、集成和清理已完成；只有 `syncedThrough` 指向当前 target 才算本批完成。
- `excluded`：最近记录版本确认不属于产品目标，并记录理由和用户影响；只有 `syncedThrough` 指向当前 target 才算本批完成。

如果在没有新上游 commit 的情况下发现漏迁或回归，保持 `migrationTarget`、`portedThrough` 和旧 `syncedThrough` 不变，只把受影响 capability 重新设为 pending/porting。状态打开本身就表示当前完成声明已失效，不伪造更老 cursor，也不新增第二套“reopened”状态。

### 4.3 `legacy-cleanup.json`

这是临时删除清单，不是长期架构：

- `remove-after-cutover`：对应能力切换后必须删除。
- `retain-or-adapt`：仍承担 Electron、IPC、上传、文件系统等产品职责，迁移时保留或改造成 adapter。

条目不能仅凭文件名批量删除。初始迁移期间，每个 `currentImplementationRef` 必须在此表中有且只有一个处置位置；`legacy` 只能 `remove-after-cutover`，`omniflow-integration` 只能 `retain-or-adapt`。删除前必须先确认 symbol 的新 owner、调用方和测试。检查器直接根据 capability 状态和源码 symbol 是否存在判断删除合同，不手填 removed 状态或 commit hash。全部 unit 完成后，先带着本文件完成最终校验；通过后再同时删除本文件、legacy refs 和 cleanup 专用校验代码。

### 4.4 文档和测试

- 本文：迁移边界与完成定义。
- `cat-catch-sync-maintenance-guide.md`：下一位 Agent 的同步步骤。
- `cat-catch-migration-audit.md`：当前事实摘要。
- `cat-catch-sync-log.md`：每轮 from/to、分类和验证记录。
- `tools/cat-catch-lab/fixtures/`：真实行为输入和 expectation。
- `electron/service/embedded-browser/cat-catch-port/README.md`：port 依赖边界和来源规则。

## 5. 目标架构

```text
electron/service/embedded-browser/
  contracts/                 # main/preload/renderer 共享契约
  orchestration/             # tab、session、任务编排和 facade
  capture/
    state/                   # ResourceStateStore、context vault
    adapters/                # Electron network 与 page runtime adapter
  cat-catch-port/
    shared/
    network/
    deep-search/
    mse/
    hls/
    dash/
    downloader/
  processing/
    tasks/
    filesystem/
    ffmpeg/
  integrations/
    resource-model/
    external-tools/
```

目录表示依赖边界，不要求先做一次纯搬家。每个能力切片在目标目录实现、测试和切换后，再删除对应旧实现。

### 5.1 依赖规则

- `cat-catch-port` 只能依赖标准 JavaScript/Web API、纯 contracts 和明确引入的协议 parser。
- port 禁止依赖 Electron、React、IPC、资料库、ffmpeg、本地文件系统或 OmniFlow 页面状态。
- adapter 负责把 Electron/page/OmniFlow 输入转成 port 所需的标准输入输出。
- orchestration 负责生命周期和 dispatch，不重复 classifier/parser/downloader 算法。
- processing 负责 task、临时文件、ffmpeg、取消和清理，不反向依赖 renderer。
- renderer 只发起动作并展示安全投影，不持有 main 的资源、凭据和任务真相。
- `embeddedBrowserMainController` 最终只保留 facade/orchestration。

### 5.2 唯一 owner

| 事实 | 目标 owner |
| --- | --- |
| tab/view/session 生命周期 | Electron main lifecycle/orchestration |
| 捕捉资源与去重状态 | main `ResourceStateStore` |
| Cookie/Authorization 等请求上下文 | main context vault |
| 页面 hook 安装 | main page-runtime adapter；port 提供 bundle |
| HLS/DASH/MSE/ffmpeg 长任务 | main task registry |
| HLS/DASH 解析和计划语义 | `cat-catch-port` |
| MSE spool/temp/staged output | main processing/filesystem |
| 资料库上传执行 | 现有 UploadManager |
| processing/delivery 的用户工作流投影 | application-scoped coordinator |

## 6. 纳入与排除

默认纳入：

- 网络请求时机、headers、规则、分类、去重和资源状态。
- Worker、fetch/XHR、JSON、TextDecoder、key、inline manifest 等页面深搜经验。
- MediaSource/SourceBuffer 捕捉、分轨、flush、reset 和清理。
- HLS/DASH parser、plan、range、key、map、track、retry、live 和输出语义。
- 文件名、URL、模板和媒体签名等被上述能力调用的共享经验逻辑。
- Electron 安全、IPC、task、temp、ffmpeg、资料库导入等平台适配。

默认不直接移植：

- popup/options/side panel 的 CSS、翻译和纯视觉状态。
- Chrome action/context menu/alarms/service worker 等扩展产品生命周期。
- 只为浏览器 Blob/下载限制存在、Electron 有更可靠替代的 workaround。
- recorder/WebRTC/JSON viewer/MQTT 等当前产品目标外的外围能力。

排除前仍要检查 HTML 默认值、script 引用、manifest、依赖和 query 参数。文件是 CSS/HTML 或提交标题写“UI”不能代替语义判断。

## 7. 单项迁移协议

每项 capability 按同一流程处理：

1. **Map**：确认 `migrationTarget` 下全部上游 path/anchor 及直接行为依赖。
2. **Characterize**：记录当前 OmniFlow 行为和风险，只用于防回归，不把旧行为当正确答案。
3. **Test/Fixture**：先建立最小可执行失败测试；需要结构化输入和 expected 时再创建 fixture。
4. **Reference**：优先运行固定上游子模块；不适合执行时采用独立规范 expectation，并说明原因。
5. **Port**：在 `cat-catch-port` 忠实实现，保留分支顺序、兼容原因和 source anchor。
6. **Adapt**：通过薄 adapter 接入 Electron/IPC/文件/ffmpeg/资料库。
7. **Verify**：比较行为 trace、结构或输出字节，并覆盖异常、取消和清理。
8. **Cut over**：unit 内相关能力就绪后，在唯一 dispatch boundary 切换。
9. **Clean**：同一切片删除旧算法、旧 listener/handler、旧 flag、fallback 和旧测试 helper。
10. **Record**：更新 capability map、legacy cleanup、同步日志和版本游标。

不得把目录移动、行为重写、上游同步和 UI 重做混在一个不可审查的改动中。

## 8. Test、Fixture 与验证

### 8.1 计划测试与真实 Fixture

`plannedTestIds` 只是需求种子，可能对应 pure behavior、Electron integration、output 或 stability test。实现时可以拆分、合并或删除不再准确的 seed，但 `verified` 状态下每个保留 ID 都必须由同名 `testRefs` 的 `path#id` 覆盖，且 path 必须是真实 test/spec 文件。测试实际通过后才可计为验证。

需要输入和 expectation 的行为场景使用：

```text
tools/cat-catch-lab/fixtures/<fixture-id>/
  fixture.json
  input...
  expected...
```

`fixture.json` 至少记录 capability IDs、上游 commit、状态、输入和 test refs。不要为计划测试预建空目录；只有真实场景落地时才创建 fixture。

### 8.2 验证层级

| 层级 | 目的 |
| --- | --- |
| Pure behavior | classifier/parser/plan/retry 等确定性行为 |
| Upstream differential | 防止遗漏 Cat Catch 经验分支 |
| Electron integration | document-start、tab/session、IPC、state、task |
| Output correctness | hash、parser、容器结构、ffprobe |
| Stability | timeout、cancel、导航、tab close、退出、内存/temp 预算 |
| Manual smoke | 真实页面补充观察，不作为唯一门禁 |

没有时间慢测时，必须先完成可自动执行的前五层。涉及资料库的手工验证禁止使用第一个资料库，公司环境使用本机 macOS MinIO 上的非第一个资料库。

### 8.3 Oracle 边界

- 固定上游 commit 和所需源码，不运行上游 install/postinstall。
- 页面脚本视为不可信，使用隔离 Electron context、loopback fixture 和资源上限。
- 无法安全执行的子模块使用 recorded/spec-derived expectation，不伪装成 exact oracle。
- normalizer 只能去除时间、随机端口和临时路径，不能忽略数量、顺序、headers、错误或输出内容。

## 9. Cutover 与旧代码删除

初始 cutover units：

1. `network-capture`
2. `deep-search-runtime`
3. `mse-runtime`
4. `hls-engine`
5. `dash-engine`
6. `transfer-engine`
7. `output-integration`

一个 unit 的切换至少要求：

- unit 内能力达到 `ported-unverified`，且生产等价 integration 测试通过。
- dispatch boundary 唯一且可定位。
- 侵入式 page runtime/MSE 不会双安装。
- 新 owner 写入生产状态后，旧 owner 立即不可达。
- `legacy-cleanup.json` 中该 unit 的 `remove-after-cutover` 项在同一切片删除。
- `retain-or-adapt` 项重新确认仍有真实 OmniFlow 职责。
- 完整 TypeScript、相关测试和最小 Electron smoke 通过。

禁止保留：

- “以防万一”的旧 classifier/parser/downloader。
- 默认关闭但仍可重新启用的旧 feature flag。
- 新旧两套 listener、IPC handler 或 page hook。
- 只转发到新实现、没有兼容期限的 wrapper。
- 已无调用方的类型、helper 和旧使用指南。

如果需要回滚，revert 完整 cutover commit 或回到已知良好版本，不重新启用藏在代码中的旧 owner。

## 10. 当前优先级

推荐顺序：

```text
同步状态与能力映射稳定
  -> 创建 port/fixture 最小骨架
    -> network classifier vertical slice
      -> deep-search runtime
        -> MSE
          -> HLS
            -> DASH
              -> transfer/output integration
```

优先选择能够形成“真实 fixture -> port -> adapter -> production test -> 删除旧实现”的小闭环，不先拆三千行 controller。

## 11. 轻量检查边界

当前 `tools/cat-catch-sync/validate.mjs` 只自动检查：

- state/map/cleanup 的字段、唯一 ID、游标和引用关系。
- verified 的计划测试 ID 是否绑定到真实 test/spec 文本。
- 初始 cutover 期间旧 symbol 的存在/删除、处置分类和 unit 原子性。
- 传入上游源码目录时，remote、branch head、commit 祖先、path 和 anchor。

本轮 diff 是否完整分类、`cat-catch-port` 依赖边界、TypeScript、lint、行为测试和 Electron smoke 由同步 Agent/CI 显式执行并记录；当前 validator 不解析全仓 import graph、Git diff 或 sync log，也不把这些步骤伪报成已自动证明。

不再构建全仓 AST 调用图、反向不动点闭包、trusted attestation、report-index、artifact retention、Gate 或 seal 链。那些机制不能直接保护 Cat Catch 行为，且会让维护工具本身成为主要工作量。遇到疑难调用关系时可以使用现成代码搜索、TypeScript 和一次性分析，但不把一次性诊断升级为长期框架。

## 12. 当前下一步

1. 运行轻量 `cat-catch:validate`，确认版本、32 项能力和 106 个旧位置自洽。
2. 按同一协议继续 `network-capture` 的事件阶段，通过唯一 Electron adapter 把现有 request context vault 接入 main-owned resource state，并消费 vault invalidation、实现 revisioned IPC reducer 与逐跳安全 consumer；需要结构化输入时再创建 fixture。
3. 为剩余能力补固定目标的直接行为依赖、真实 test refs 和 production-equivalent integration，不把现有 legacy 行为当 oracle。
4. 整个 unit 就绪前保持旧实现为唯一生产 owner；切换成功后在同一 unit 提交中删除对应旧代码。
