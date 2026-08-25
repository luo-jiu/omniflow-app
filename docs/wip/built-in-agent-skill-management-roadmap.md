# 内置 Agent Skill 管理与能力可用性路线图

更新时间：2026-08-25

状态：阶段 A、B 已实现并通过自动化门禁；阶段 C 的真实媒体、本机 Save As 和非首个资料库上传核心路径已完成用户验收；阶段 D、E 尚未开始。

适用范围：

- `electron/service/agent/skills/`
- `electron/service/agent/agent-run-capability-snapshot.ts`
- `electron/service/agent/agent-orchestrator.ts`
- Agent Tool 的环境预检、动作确认和 renderer-safe 投影
- 后续只读 Skill 管理页与本机启停偏好

当前 Skill V1 的实现事实与安全边界以 `docs/built-in-agent-architecture.md` 为准；V1 的设计理由和剩余验收以 `docs/wip/built-in-agent-skill-v1-design.md` 为准。本文只规划 V1 之上的能力可用性、执行目标准备和管理层，不重新设计已经落地的 Registry 与激活协议。

## 1. 结论

下一步不应直接制作完整 Skill 管理 UI，也不应先开放本地 `SKILL.md`、远程安装或插件市场。

这条路线包含两层通用基建：

1. **能力可用性**：在 Run 开始前知道相关 Tool、操作系统能力和受控依赖是否可用，并向模型与 UI 提供安全、结构化的状态。
2. **执行目标准备**：涉及写入时先解析并让用户确定目标，再把精确动作冻结为不可变快照，之后才进入既有审批和执行链。

两层通用基建均已落地到 Run、ToolRun、审批、执行和恢复边界，首条真实媒体核心路径也已完成验收。下一步进入 Skill 本机启停与只读管理投影；Skill 管理核心仍不应绕过现有能力快照或把停用 Skill 误解为禁用底层 Tool。

推荐顺序：

```text
能力可用性与 Run 诊断身份（阶段 A 已实现）
  -> 执行目标准备与冻结（阶段 B 已实现）
  -> media-extract-audio 真实路径验收（阶段 C 已完成）
  -> Skill 本机启停与只读管理投影
  -> Skill 管理 UI
```

## 2. 当前事实

现有 Skill V1 已经具备：

- 纯数据、仅内置来源的 Skill 定义。
- 注册校验、预算校验、深拷贝冻结和稳定目录。
- Tool 与 Skill 的统一 Run capability snapshot。
- 初始上下文只注入摘要，`skill.activate` 按需加载完整正文。
- 激活独占 provider turn，并从下一轮收窄业务 Tool。
- Tool Schema、动态权限、确认、执行、审计和再感知继续独立生效。
- renderer-safe 投影不会泄漏完整 Skill 正文和 allowlist。
- Main 侧 Capability Registry、`machine / owner / library` scope 缓存、超时、取消和 generation 失效。
- `media.ffprobe / media.ffmpeg` 只读 Probe，以及 Tool registration 的 required / optional Capability 声明。
- Effective Tool / Skill View：blocked 业务 Tool 与依赖它的 required Skill 不会进入本 Run，optional 不可用只降级。
- `capability_identity / tool_catalog_revision / skill_catalog_revision` 随 Run 持久化，完整 Probe 状态与 executor 引用仍只留在当前进程。

因此以下组件不得重写或复制：

```text
AgentSkillRegistry
skill.activate
AgentRunCapabilitySnapshot
AgentToolRegistry / AgentToolBroker
Run / ToolRun 状态与时间线
```

当前主要缺口：

- 没有本机 Skill 启停偏好、renderer-safe 管理目录或管理 UI。

## 3. 外部实现调研

### 3.1 Claude Code

主要参考：

- `claude-code-analysis/src/tools/SkillTool/SkillTool.ts`
- `claude-code-analysis/src/tools/SkillTool/prompt.ts`
- `claude-code-analysis/src/skills/loadSkillsDir.ts`
- `claude-code-analysis/src/skills/bundledSkills.ts`

值得采用：

- Skill 摘要常驻、完整正文按需加载的渐进披露。
- 摘要目录具有独立预算，单条描述也有硬上限。
- 区分托管、用户、项目、插件和远程来源，并保留来源用于诊断。
- Skill 激活和真实 Tool 权限分离。
- 条件 Skill 只有在环境匹配后才进入有效目录。
- 已激活内容在当前运行上下文中保持稳定，不因实时目录变化而漂移。

暂不采用：

- Skill 内嵌 Shell、Hook 和命令展开。
- Skill 指定子 Agent、模型或推理强度。
- CLI 斜杠命令兼容层。
- 远程 Skill、市场和热更新。
- 用 Skill 的 `allowed-tools` 扩大执行权限。

Claude Code 的 `/skills` 更接近只读清单，不是适合 OmniFlow 的完整管理界面。OmniFlow 需要额外展示 `ready / degraded / blocked`、缺失能力和本机启停状态。

### 3.2 OpenCode

主要参考：

- `../project/opencode-dev/packages/schema/src/skill.ts`
- `../project/opencode-dev/packages/core/src/skill.ts`
- `../project/opencode-dev/packages/core/src/skill/guidance.ts`
- `../project/opencode-dev/packages/core/src/tool/skill.ts`
- `../project/opencode-dev/packages/core/src/tool/tool.ts`
- `../project/opencode-dev/packages/core/src/tool/registry.ts`
- `../project/opencode-dev/packages/core/src/skill/discovery.ts`

值得采用：

- Skill 来源、Skill 内容、Tool 定义和 Tool Registry 分层明确。
- 模型平时只看到经过权限过滤的名称与说明。
- Skill Tool 加载正文时再次检查当前目录和权限。
- Tool 输入、输出都经过 Schema，副作用不由 Skill 执行。
- 每轮物化 Tool 定义并绑定注册 identity，过期调用明确失败。
- 远程内容更新采用 staging 后原子替换，而不是覆盖正在使用的版本。

暂不采用：

- `directory / url / embedded` 三种动态来源。
- 同名 Skill 静默覆盖。
- 缺少签名和内容哈希的远程索引。
- 通用 Bash 或宿主级 Shell 能力。
- 尚未收口的 MCP、插件和 Session 级动态 Tool 注册。

OpenCode 没有通用 Skill 环境依赖系统。它在 Formatter 等具体能力内部实现探测，因此 OmniFlow 的统一 Capability 层需要自行设计。

### 3.3 共同原则

两家的共同原则可以直接保留：

```text
Skill 负责工作方法
Tool 负责真实能力
Registry 负责规范定义
Permission 负责最终授权
Run 负责冻结本次执行事实
```

## 4. 新增概念与所有权

### 4.1 Skill Definition

由应用代码内置、只读且可版本化。仍然只描述流程，不携带 executor、IPC、路径、URL、组件或回调。

阶段 A 已增加 `requiredTools / optionalTools`；阶段 D 再增加 `displayName / defaultEnabled`。目标契约为：

```ts
interface AgentSkillDefinition {
  id: string;
  version: string;
  displayName: string;
  description: string;
  whenToUse: string;
  toolAllowlist: readonly string[];
  requiredTools: readonly string[];
  optionalTools: readonly string[];
  instructions: string;
  source: 'built-in';
  defaultEnabled: boolean;
}
```

约束：

- `toolAllowlist` 仍只是激活后的最大可见业务 Tool 集合，不表示每个 Tool 都是必经步骤。
- `requiredTools` 是完成该流程必需的 Tool，`optionalTools` 只影响增强分支；二者必须是 `toolAllowlist` 的无重复子集。
- Capability 依赖归属具体 Tool registration，Skill Resolver 只聚合 required / optional Tool readiness，不能在 Skill 和 Tool 中重复维护 `ffmpeg` 等依赖。
- 目标目录、文件格式、存储 provider 等依赖本次输入的条件由具体 Tool 的 prepare / execute 阶段检查，不进入 Run 前静态 readiness。
- `displayName` 供本地 UI 使用；图标继续由 renderer 按 `skillId` 映射本地资源，Definition 不接受任意图片或 SVG。该字段尚未实现。
- `defaultEnabled` 只是没有用户偏好时的默认值，不是执行授权。该字段与 Preference Store 一起留到阶段 D。

### 4.2 Capability Definition 与 Probe

Capability Registry 已由 Electron main 持有。只有应用内置代码可以注册探测器：

```ts
interface AgentCapabilityDefinition {
  id: string;
  revision: string;
  scope: 'machine' | 'owner' | 'library';
  timeoutMs: number;
  cacheTtlMs: number;
  probe(context: AgentCapabilityProbeContext): Promise<AgentCapabilityStatus>;
}

type AgentCapabilityStatus =
  | { state: 'available'; checkedAt: number }
  | { state: 'unavailable'; reasonCode: string; checkedAt: number }
  | { state: 'unknown'; reasonCode: string; checkedAt: number };
```

第一批 Run 静态 Capability：

```text
media.ffprobe
media.ffmpeg
```

`library.write-context` 和 `local.save-dialog` 不属于 Run 前静态 Capability：前者依赖本次目标资料库、目录和 provider，后者还依赖当前窗口与一次性用户交互。二者只在 prepare 阶段解析为本次动作的可用性结果或短生命周期 capability，不进入 Skill readiness，也不写入 Tool registration 的静态依赖。

Tool registration 通过纯数据声明静态依赖：

```ts
interface AgentToolAvailabilityPolicy {
  requiredCapabilities: readonly string[];
  optionalCapabilities: readonly string[];
}
```

例如 `media.inspect` 必需 `media.ffprobe`，`media.extractAudio` 必需 `media.ffmpeg`。资料库目录、物理 provider 和本机兜底是否可用取决于本次目标，不放进该静态声明，而在执行目标准备阶段解析。

规则：

- Probe 必须只读、快速、有超时并支持取消。
- Probe 只返回稳定状态和安全 reason code，不返回可执行文件绝对路径、存储 endpoint、临时目录或凭据。
- 可缓存的本机能力允许短 TTL；账号、资料库和网络相关状态必须按 owner scope 隔离，并使用更短 TTL。
- machine scope 的缓存 key 只包含 capability ID 与 definition revision；owner scope 增加规范化 backend / account；library scope 再增加 `libraryId`。
- 切换账号、API base、资料库、存储配置或释放 owner 时必须失效对应 generation；旧 generation 的迟到 Probe 不得覆盖新状态。
- 调用方取消只停止等待本次结果，不把共享缓存写成 unavailable；Registry 自己控制 Probe 生命周期和超时。
- Probe 结果用于提前解释和减少错误调用，不构成执行授权。
- Tool 在真正执行前必须再次做 authoritative check，不能相信过期缓存。
- Capability identity 只包含 definition `id + revision`、规范化状态、reason code、scope identity 和 Tool / Skill / Preference revision，不包含 `checkedAt`，也不尝试哈希运行时函数。

### 4.3 Skill Preference

本机偏好只保存用户是否启用某个内置 Skill：

```text
backend_scope + account_scope + skill_id
enabled_override
revision
updated_at
```

规则：

- 偏好跟随当前机器，不跨机器同步。
- 不复制 Skill 正文、版本、allowlist 或 Capability 状态。
- 没有偏好行时使用 Definition 的 `defaultEnabled`。
- Skill 版本升级保留同一 ID 的启停偏好；行为不兼容时应使用新 Skill ID，而不是偷偷重置偏好。
- 第一版不支持资料库级启停，避免同一个 Skill 在不同资料库出现难以解释的状态差异。
- “停用”只表示不向 Agent 发现和激活这条流程说明，不会禁用底层 Tool；若未来需要禁用具体能力，必须设计独立 Tool policy，不能借 Skill Preference 暗中实现。
- Preference 更新由 main 重新规范化 owner，并携带 `expectedRevision` 做 CAS；未知 built-in Skill、scope 不匹配和 revision 冲突都必须拒绝。

### 4.4 Effective Tool 与 Skill Catalog

Capability 先作用于 Tool，再由 Skill 聚合 Tool readiness。Live `AgentToolRegistry` 仍保存完整、不可变的注册定义；Run 创建时基于同一份 Capability Probe 安全快照派生 Effective Tool View，不修改 live Registry。

业务 Tool 的 Run readiness：

```ts
type AgentToolReadiness = 'ready' | 'degraded' | 'blocked';
type AgentToolReadinessProjection = AgentToolReadiness | 'checking' | 'unknown';
```

- `ready`：所有 required / optional 静态 Capability 均有新鲜的 available 结果。
- `degraded`：required Capability 可用，但某个 optional Capability 为 unavailable，或没有可继续使用的新鲜结果；Tool 核心能力仍可执行。
- `blocked`：某个 required Capability 明确 unavailable。required Probe 为 unknown、checking、超时或缓存已过期时，管理投影保留对应状态，但本 Run 同样按 blocked 失败关闭。
- 阶段 A 在缓存未超过 TTL 时直接复用；TTL 过期后等待新 Probe 并冻结本 Run 结果，不沿用过期值。管理页所需的后台刷新、`stale / refreshing` 投影留到阶段 D，不属于当前 Run snapshot 事实。
- Capability identity 使用本 Run 冻结的规范化结果；`checkedAt`、refreshing 和请求时序不参与 identity。

只有 `ready / degraded` 的业务 Tool 才进入本 Run 的模型 Tool 列表。Provider schema 物化、计划校验、Skill allowlist 交集、Broker 执行和审计必须消费同一个 Effective Tool View；blocked / unknown Tool 不能被模型通过直接点名绕过 Skill readiness。控制 Tool 不受业务 Capability 过滤，但 `skill.activate` 只能激活本 Run Effective Skill Catalog 中的 Skill。执行前仍需 authoritative check，以发现 Run 开始后的环境变化。

Effective Catalog 是派生结果，不是新的事实源：

```text
Skill Definition
  + 当前 owner 的本机启停偏好
  + 当前 Tool snapshot
  + Capability Probe 安全快照
  = Effective Skill
```

状态：

```ts
type AgentSkillReadiness = 'ready' | 'degraded' | 'blocked';
type AgentSkillReadinessProjection = AgentSkillReadiness | 'checking' | 'unknown';
```

- `ready`：全部 required Tool 可用且没有降级，optional Tool 也可用。
- `degraded`：required Tool 的核心能力可用，但其中某个 Tool 已降级，或 optional Tool / optional Capability 不可用、未知或已过期；核心流程仍可完成。
- `blocked`：required Tool 未注册或在 Effective Tool View 中 blocked。
- `unknown / checking` 只用于管理投影。required Tool 尚无可用结论时，本 Run 按 fail-closed 处理且不向模型展示该 Skill；optional Tool 尚无结论时按 degraded 处理，不阻塞发现。

用户禁用与 `blocked` 必须分开。阻塞是当前已经实现的环境事实；禁用是阶段 D 才加入的本机偏好。

模型目录只包含当前启用的 `ready / degraded` Skill。被禁用、`blocked`、`unknown` 或 `checking` 的 Skill 不可通过猜测 ID 激活；必要的环境限制通过独立、紧凑的 capability 摘要告诉模型。管理 UI 可以看到全部内置 Skill 及其状态、`checkedAt`、stale 和 refreshing 投影。

### 4.5 Run Capability Snapshot

现有快照继续是一次 Run 的唯一能力视图，并扩展为同时冻结：

```text
Tool registration identity
Tool readiness 安全快照
Skill id / version / instructions hash
用户启停决策
Skill readiness 安全快照
Capability reason code
```

冻结规则：

- 用户在 Run 开始前改变启停状态，影响下一次 Run。
- Run 开始后修改 Skill 偏好，不改变当前 Run。
- Provider schema、计划校验、Skill 激活和 Tool 执行必须使用当前 Run 冻结的同一份 Effective Tool / Skill View，禁止中途回读 live Registry 改变可见集合。
- Capability Probe 的快照用于本轮发现和诊断；Tool 执行前仍重新检查真实环境。
- capability identity、Tool revision 和 Skill revision 已进入 Run 的持久化诊断字段，完整 Definition、Probe `checkedAt` 和 executor 引用不写入 SQLite。
- 当前生产 Orchestrator 在创建 Run 时始终写入完整诊断身份；Store 的 legacy 缺省值只用于旧数据和测试兼容。

## 5. 执行目标准备与确认

“上传到哪里”不是 Skill 管理设置，而是一次具体 Tool 调用的执行参数。

正确顺序：

```text
Skill 组织流程
  -> Tool 解析语义目标
  -> 必要时通过 interaction.request 让用户选择
  -> ToolRun 进入无副作用 preparing 阶段
  -> main 发出 owner-bound prepare request
  -> renderer 解析目标 provider 并回传受控结果
  -> main 校验并生成不可变 prepared action
  -> 展示精确确认卡
  -> 用户批准
  -> Tool 严格按 prepared action 执行
```

`prepared action` 是现有 ToolRun 执行事实的扩展，不建立第二套 Workflow 或独立业务 Store：

- `prepare` 是 Tool registration 可选的通用生命周期契约，不是 Orchestrator 对 `media.extractAudio` 的分支特判。
- 需要审批前补全环境事实的 Tool 先创建状态为 `preparing` 的 ToolRun；Run 同步进入 `preparing` 并通过 `currentStep` 展示准备进度，renderer 时间线将其视为活跃状态而不是失败。
- Orchestrator 通过独立的 Agent Tool Prepare Broker 驱动 main / renderer prepare request、超时、取消和 owner 校验。Prepare Broker 与执行 Broker 分离，prepare capability 不能被当作 execution capability 使用。
- prepare 只能规范化输入、读取环境并让用户选择目标，不能上传、转码、复制或提交业务副作用。
- 成功后状态按权限决策进入 `awaiting_approval` 或 `running`；失败、取消、停止、owner release 和窗口销毁分别收口到既有终态并清理内部 capability。
- 不声明 prepare 契约的 Tool 继续使用现有 assess / approval / execute 路径。

```ts
interface AgentPreparedActionPublic {
  sourceNodeId: number;
  libraryId: number;
  parentId?: number;
  destination: 'library' | 'local';
  outputFileName: string;
  outputFormat: string;
  conflictPolicy: string;
  fallbackPolicy: 'prompt_local' | 'none';
}

interface AgentPreparedActionInternal {
  public: AgentPreparedActionPublic;
  storageProviderBinding?: string;
  preparedActionId: string;
  snapshotHash: string;
}
```

ToolRun 只持久化安全的 public projection、`preparedActionId` 和 `snapshotHash`；物理 provider binding 在 prepare 和审批期间只存在于 main，批准后仅通过一次性 execution request 交给 renderer executor 的局部变量，不进入 React state、事件历史、SQLite、ToolResult 或模型上下文。当前应用重启会把待确认 Run 标记为 interrupted，因此不恢复内部 binding。

规则：

- 确认前可以修改目标目录、目标类型和安全选项。
- 确认卡只负责展示并批准精确动作，不承担复杂编辑器职责。
- 审批的 input hash 必须覆盖 public snapshot 和内部 provider binding；确认后目标冻结，executor 只能消费同一个 `preparedActionId`，不能重新读取当前目录、默认路由或重新选择 provider。
- 修改语义目标必须产生新的 prepared action、snapshot hash 和审批；旧 capability 立即失效，不能复用旧确认。
- 目标失效时返回结构化失败或重新进入目标选择，不复用旧确认。
- prepare request 必须绑定主窗口、规范化 owner、`libraryId`、Session、Run、ToolRun、call、一次性 request ID 和语义输入 hash；重复或迟到回执拒绝。
- 用户选择资料库目标时，物理 `storageProvider` 由 renderer 根据源文件和当前资料库策略解析，main 校验后冻结 binding；模型不能指定 alias 或 endpoint。
- 资料库存储不可用且策略允许本机兜底时，必须打开系统“另存为”；用户选择路径后才写盘。
- `complete` 阶段提交状态不确定时不能自动再保存一份到本机，避免产生重复结果。

共享上传层必须返回结构化提交状态：

```ts
type UploadCommitState = 'uncommitted' | 'commit_unknown' | 'committed';
```

- complete 请求尚未发出时失败为 `uncommitted`，允许按已确认策略进入本机兜底。
- complete 请求一旦发出，超时、断连或响应丢失均为 `commit_unknown`；禁止自动兜底、自动重传或根据 abort 成功推断未提交。
- `commit_unknown` 必须先使用 upload ID / idempotency identity 做服务端 reconciliation；仍无法确认时向用户报告“提交状态待确认”。
- 服务端明确返回节点后才是 `committed`；后续刷新失败不得重复上传或本机保存。

上述契约已经贯通：`upload_sessions` 保存稳定 `clientOperationId` 与 7 天 completion receipt，complete 可重放同一 node，`GET /api/v1/upload/complete/status` 明确返回 `unknown / uncommitted / committed(node)`。共享 Electron 上传层会在 complete 网络错误、`408 / 429 / 5xx` 后核对状态，恢复 committed node；仍不明确时抛出 `UploadCommitUnknownError` 并保留 session，不自动 abort。Tool executor 已统一投影 `uncommitted / commit_unknown / committed`，只在明确 `uncommitted` 且冻结策略允许时打开本机 Save As；authoritative commit 回执失败也不能把已经成功的资料库写入误判成本机兜底条件。

系统 Save As 必须新增 Agent 专用能力，禁止扩权 Embedded Browser 的下载 IPC：

- capability 绑定主窗口 WebContents、规范化 owner、资料库、Session、Run、ToolRun、execution、prepared action 和 artifact。
- 状态原子流转为 `issued -> claimed -> consumed / expired`；用户取消也消费本次 capability，新尝试必须重新签发。
- renderer 和模型不传目标路径；main 打开系统 Save Dialog 并复制，结果只返回安全文件名和“用户所选本机位置”。
- 停止、owner release 或窗口销毁时先失效 capability 并中止复制，复制任务收口后再释放 artifact，不能边复制边删除源文件。

## 6. `media-extract-audio` 验收样例

这条 Skill 用于验证新设计，但业务规则仍留在媒体 Tool：

```text
发现 Skill
  -> media.ffprobe / media.ffmpeg 可用性预检
  -> 解析唯一源文件并 inspect
  -> 确定 destination: library | local
  -> library 时确定逻辑目录与物理 provider
  -> 生成 action snapshot
  -> 用户确认
  -> ffmpeg 生成 artifact
  -> 上传或系统 Save As
  -> 提交 authoritative result
  -> 刷新并再感知，或展示本机产物结果
```

最低场景：

- ffmpeg 与资料库存储都可用，上传成功。
- 源文件 provider 可用时显式继承，不重新落到错误的默认 provider。
- 源 provider 不可用，但资料库路由到可用 provider 后成功。
- 资料库存储不可用，用户同意并选择本机位置后成功。
- 用户取消本机“另存为”，任务明确取消且不伪装失败。
- ffmpeg 缺失时在副作用前标记 Skill blocked，并给出安全说明。
- 预检后环境变化，Tool 的执行前检查仍能阻止错误执行。
- 上传 `complete` 状态不确定时不自动生成第二份本机文件。
- artifact capability 只能使用一次，停止、超时、窗口销毁和 Run 终态都会清理。
- ToolResult、SQLite、React/UI state、renderer 事件、日志和模型上下文不包含 endpoint、本机绝对路径、签名 URL、物理 provider alias 或 artifact ID。
- 当前架构允许 context-isolated 的一次性 executor bridge 在执行期间看到短生命周期 artifact ID / path 与 provider binding；这些值不能进入页面状态。后续若迁移为 main 全托管上传，再收紧为仅 main 可见。

## 7. Skill 管理投影与 UI

管理 IPC 只返回 renderer-safe DTO：

```ts
interface AgentSkillManagementItem {
  id: string;
  version: string;
  displayName: string;
  description: string;
  source: 'built-in';
  enabled: boolean;
  readiness: 'checking' | 'ready' | 'degraded' | 'blocked' | 'unknown';
  reasonCodes: readonly string[];
  availabilityLabels: readonly string[];
  checkedAt?: number;
  stale: boolean;
  refreshing: boolean;
}
```

`availabilityLabels` 是 main 根据 required / optional Tool readiness 派生出的本地化安全标签，不是 Skill 自己声明的 Capability 列表，也不能被 renderer 当作执行授权。

不得返回：

- 完整 instructions。
- Tool allowlist 的内部权限细节。
- 可执行文件路径、环境变量和存储 endpoint。
- API Key、Cookie、签名 URL、临时文件路径或本机隐私路径。

第一版管理页只需要：

- 查看内置 Skill 名称、版本、说明、来源和当前状态。
- 启用或停用。
- 查看经过本地映射的阻塞原因和环境修复建议。
- 手动重新检查环境。

管理 list 请求携带当前 `libraryId` 仅用于计算 readiness；Preference 的复合唯一键仍是 `backend_scope + account_scope + skill_id`。update 必须携带 `expectedRevision`，main 返回 authoritative 新快照；把 blocked Skill 设为 enabled 只改变偏好，不能让它进入可激活目录。

第一版明确不提供：

- 编辑 Skill 正文。
- 导入、删除或覆盖内置 Skill。
- 来源优先级和冲突处理。
- 远程安装、更新、市场和自动下载。
- Skill 自定义脚本、Hook、Shell、子 Agent 或任意 UI。
- “停用 Skill 等于禁用底层 Tool”的误导性承诺。

## 8. 文件结构建议

在现有结构上原地扩展：

```text
electron/service/agent/
  capabilities/
    agent-capability.types.ts
    agent-capability-registry.ts
    agent-capability-runtime.ts
    definitions/
      media-capabilities.ts
      storage-capabilities.ts
  skills/
    agent-skill.types.ts
    agent-skill-registry.ts
    agent-skill-catalog.ts
    agent-skill-runtime.ts
    agent-skill-resolver.ts
    agent-skill-preference-store.ts
    skill-activate-tool.ts
  agent-run-capability-snapshot.ts

src/shared/agent/
  agent.types.ts

src/features/agent/
  services/
    agent-skill.api.ts
  hooks/
    useAgentSkills.ts
  components/
    AgentSkillManager.tsx
```

不要提前创建空目录。只有对应阶段开始实现时再增加文件；首批 Capability 数量很少时可以先放在一个 catalog 文件中，出现真实维护成本后再拆 `definitions/`。

## 9. 分阶段实施

### 阶段 A：Capability 可用性（已实现）

- 定义 Capability Registry、状态和安全 reason code。
- 接入 `ffprobe / ffmpeg` 只读探测。
- 先派生 Effective Tool View，再由 Effective Skill Resolver 聚合、过滤或标记 Skill；Provider schema、计划校验、Skill 激活和 Broker 使用同一 Run 快照。
- Run 创建前冻结安全可用性快照。
- 同批持久化 capability identity、Tool revision 和 Skill revision 诊断字段；阶段 D 引入 Preference 后再把其 revision 纳入身份。
- Tool 执行前继续 authoritative check。

当前实现没有新增 IPC、preload 或 UI；`checking / stale / refreshing` 管理投影不属于阶段 A。

### 阶段 B：执行目标准备（已实现）

- 先实现通用 Tool prepare 契约、`preparing` ToolRun 状态、Prepare Broker / IPC，以及超时、取消、失败和 owner release 的持久化收口；禁止在 Orchestrator 中为媒体 Tool 写特判。
- 为 `media.extractAudio` 增加语义目标与兜底策略。
- 目标选择和 renderer prepare 发生在审批前，由 main 生成不可变 prepared action 后再展示审批。
- 冻结并显式传递物理 provider。
- 新增 Agent 专用、owner-bound 的系统 Save As capability。
- 上传 completion receipt / idempotency、status reconciliation 与共享上传层的安全保留行为已完成；Tool prepare/executor 已补齐 `uncommitted / commit_unknown / committed` 结构化投影，只有明确未 commit 时才允许本机兜底。

### 阶段 C：首条 Skill 验收与诊断（已完成）

- 媒体提取、prepare、审批编辑、provider 重新绑定、上传三态、Save As、防重放、取消和 SQLite 恢复的自动化边界测试已完成。
- 2026-08-25 用户在 macOS 本机 MinIO 的非第一个资料库中验证真实视频路径：provider 正确激活 Skill，完成媒体检查、音频提取、本机 Save As、资料库上传和目录树新节点定位。
- 本轮真实调用没有暴露需要立即调整的 Skill 摘要或 instructions；新增格式、平台或 provider 差异时再补定向诊断。

### 阶段 D：管理核心（未开始）

- 增加本机 Skill Preference Store。
- 增加 renderer-safe list / update / refresh IPC。
- Preference update 使用 owner-bound CAS，未知 Skill 和 revision 冲突明确失败。
- 启停只影响后续 Run，当前 Run 保持快照不变。
- 管理投影与 Registry 保持单向依赖，不在 renderer 复制 Definition。

### 阶段 E：管理 UI（未开始）

- 实现只读状态列表、启停和重新检查。
- UI 只展示安全标签和修复建议。
- Skill 数量或来源尚未增长前，不做搜索、排序、分组和市场入口。

## 10. 验证门禁

自动化至少覆盖：

- Capability 注册重复、未知 ID、超时、取消和异常清洗。
- Effective Tool 与 Skill 的 required / optional readiness、unknown / checking / stale、用户禁用、降级、阻塞和恢复可用。
- blocked / unknown 业务 Tool 不进入 Provider schema，计划校验与直接点名调用均无法绕过同一 Run 快照；控制 Tool 保持可用。
- optional Capability 没有新鲜结果时稳定降级，required Capability 没有新鲜结果时稳定阻塞；未过 TTL 的 last-known 仅在 refreshing 期间沿用。
- 缓存按 machine / owner / library scope 隔离，失效 generation 能拒绝迟到 Probe 覆盖。
- disabled / blocked / unknown Skill 无法通过猜测 ID 激活。
- 启停或环境变化不修改已启动 Run 的快照。
- Tool 执行前重新检查能发现过期 Probe。
- capability identity 在等价输入下稳定，定义或偏好变化时改变。
- renderer DTO 不泄漏 instructions、allowlist、路径、endpoint 和凭据。
- Skill Preference 按 owner scope 隔离，revision 冲突拒绝覆盖。
- prepare request 防重放，执行目标或 provider binding 变化会使旧审批失效，executor 不会重新路由。
- 通用 prepare 状态覆盖成功、拒绝、超时、取消、停止、窗口销毁和 owner release，且 prepare 阶段不会产生业务副作用。
- 上传覆盖 `uncommitted / commit_unknown / committed`，特别验证 complete 已落库但响应丢失时不会本机兜底或重复上传。
- 本机保存 capability 精确绑定窗口、owner、Run、prepared action 和 artifact；取消、防重放与清理顺序稳定。
- 短生命周期 artifact / provider 数据只存在 main 与 context-isolated executor bridge，不进入 UI 状态、事件、日志、SQLite 或模型上下文。

常规门禁：

```text
npm run lint
npm test
npm run build
```

真实媒体验证继续遵守 workspace 规则：任何场景禁止第一个资料库；当前公司环境使用 macOS 本机 MinIO 的非第一个资料库。媒体播放相关验证由用户执行。

## 11. 维护规则

- 实现前必须同时阅读本文、`docs/built-in-agent-architecture.md` 和 `docs/wip/built-in-agent-skill-v1-design.md`。
- 实现进度只有在代码和测试真实落地后才能回写为完成。
- Capability 只提供可用性事实，不授予权限，也不替代 Tool 执行前检查。
- Skill Preference 只保存用户偏好，不复制 Registry 定义和动态环境状态。
- 新增 Skill 前先写清适用场景、Tool allowlist、required / optional Tool、默认值、目标选择、确认、完成验证和失败边界；环境依赖由对应 Tool registration 声明。
- 若未来开放本地或远程 Skill，必须另行完成来源信任、签名/哈希、版本锁定、原子更新、撤回、冲突和离线策略；不能把它混入当前阶段。
