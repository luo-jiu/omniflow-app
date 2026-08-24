# 内置 Agent Skill V1 设计与决策记录

更新时间：2026-08-24

状态：WIP 验证中。Registry、环境 Capability Probe、Effective Tool / Skill Run snapshot、摘要投影、`skill.activate`、能力收窄、Run 诊断身份持久化、renderer 安全投影、provider 总轮次和首条内置 catalog 已实现；真实 provider 与媒体端到端验证尚未完成，因此不能把 Skill V1 视为已经验收。

适用范围：

- `electron/service/agent/` 中当前的 Skill 注册、发现、激活与上下文投影。
- `AgentOrchestrator`、`AgentToolRegistry`、`AgentToolBroker`、权限确认和 Run / ToolRun 的协作边界。
- 第一批内置媒体 Skill，以及后续字幕翻译等流程配方。
- Skill 在 Agent 时间线中的受控展示。

已落地的 Agent 事实、IPC、持久化和安全边界以 `docs/built-in-agent-architecture.md` 为准。本文保留 Skill V1 的设计理由、实现对照和剩余验证门禁；不能把“代码路径存在”误写成“功能已经验收”。

## 1. 结论

OmniFlow 的 Skill 是**按需加载、受能力约束的 Tool 编排说明**，不是可执行插件、Workflow 引擎、权限系统或第二个 Agent。

```text
用户目标
  -> Agent 先看到有界的 Skill 摘要目录
  -> 模型通过受控 skill.activate 加载匹配 Skill 的完整说明
  -> 继续在原 Session / Run 中调用既有 Tool
  -> Tool 仍经过 Registry、Schema、权限、确认、Broker、进度、审计和再感知
  -> 既有时间线展示执行事实和结果
```

Skill 只回答两个问题：

1. 什么时候适合使用这组能力。
2. 应该按照什么约束和顺序组合已有 Tool。

真正的副作用永远由 Tool 执行。Skill 不能直接运行 ffmpeg、访问文件、调用 IPC、上传内容、写数据库或渲染任意 UI。

### 1.1 当前实现收口状态

截至 2026-08-24，以下能力已经落地并有自动化测试覆盖：

- 数据化、仅内置来源的 Skill 定义，注册校验、预算校验、深拷贝冻结和稳定目录。
- Tool 的 `business / control` 封闭分类、registration identity、不可变 Tool snapshot 和 stale identity 拒绝。
- Tool + Skill 的 Run 级组合快照，以及从预检、prompt、provider schema、计划到执行的同快照消费。
- 初始 prompt 只注入有预算的摘要目录；`skill.activate` 从当前 Run 快照返回完整 envelope。
- 激活独占 provider turn；混合调用在创建 ToolRun 和副作用前整批拒绝。
- 激活成功后从下一 turn 收窄业务 Tool；控制 Tool 保留，激活不消耗 8 次业务 Tool 配额，也不绑定计划步骤。
- 终态历史投影只保留 `skillId + version + instructionsHash`，不向后续 provider 回灌完整正文。
- 首条 `media-extract-audio` 定义已经注册，allowlist 只引用五个既有业务 Tool。
- main 到 renderer 的独立安全投影会剥离 `instructions / toolAllowlist`，事件和 Session 快照只保留 `skillId + version + instructionsHash` 及本地状态文案；SQLite 中的 main 审计事实不被反向改写。
- provider 总上限固定为 10 turn，可容纳一次 Skill 激活、8 个串行业务 Tool turn 和最终回答；8 次业务 Tool 调用仍是独立硬上限，控制 Tool 不能无限续接。
- 首条 catalog 已统一默认格式语义：用户未指定时直接使用 `m4a`，只有目标不唯一或明确要求不支持格式时才请求交互。

仍待收口的验收项：真实 provider 是否能稳定选择并执行该 Skill；macOS 非首个资料库与 Windows 的媒体端到端路径；拒绝、停止、刷新失败和重启中断等手工边界。Run 已持久化 capability identity、Tool catalog revision 与 Skill catalog revision；Skill 注册期尚未提前验证 provider Tool 名映射冲突，这属于后续提前失败能力，不改变当前 provider materialization 的运行时拒绝边界。

## 2. 为什么现在需要 Skill

当前 Agent 已经具备会话、Run、ToolRun、权限确认、进度、交互卡、上下文压缩、长期记忆、本地进程基座和首条媒体 Tool 闭环。继续把每一种业务流程写入系统提示词会产生三个问题：

- 所有业务说明随每轮请求重复发送，上下文越来越重。
- 系统提示词同时承担安全规则和业务操作手册，职责会逐渐混乱。
- 字幕翻译、媒体转码等流程容易各自再造状态机、权限入口和 UI。

Skill 提供的是薄编排层：稳定系统规则继续保持简短，业务流程在匹配时才加载，执行仍复用已经验证过的 Agent 地基。

## 3. 调研范围与版本口径

本次只读参考了 Claude Code 的 Skill 实现与 OpenCode V2 / legacy 中直接相关的 Skill、Tool Registry、权限和 Session runner。外部代码仅作为设计输入，不成为 OmniFlow 的源码依赖。

### 3.1 Claude Code

重点研究内容：

- Skill Tool 的受控加载入口。
- Skill 目录发现、来源分层和内置 Skill。
- 摘要目录的上下文预算。
- inline / fork、参数、引用文件和压缩保留等扩展能力。
- 远程 / MCP Skill 的信任差异。

核心观察：Claude Code 初始上下文只放 Skill 名称、说明和使用提示；模型调用 Skill Tool 后才加载完整正文。后续真实操作仍使用同一套 Agent loop、Tool、权限和审计。Skill 不是新的执行引擎。

### 3.2 OpenCode

重点研究内容：

- V2 Skill schema、来源和 guidance 投影。
- `skill` Tool 的正文加载。
- Tool 的规范表示、Registry 物化、输出收口与 stale call 拒绝。
- 权限目录过滤与执行授权的分离。
- Session runner 的持久化执行边界和上下文更新。

OpenCode 仓库同时存在 legacy `packages/opencode` 与正在迁移的 V2 `packages/core`。本文的架构判断优先采用 V2；V2 中 Task、MCP、插件注册和部分 Skill 入口仍有未完成项，不能把它描述成已经全部成熟的成品。

### 3.3 参考位置

Claude Code 解析资料中的主要入口：

- `src/tools/SkillTool/SkillTool.ts`
- `src/tools/SkillTool/prompt.ts`
- `src/skills/loadSkillsDir.ts`
- `src/skills/bundledSkills.ts`
- 《第三部分-高级模式篇/11-技能系统与插件架构.md》

OpenCode workspace 中的主要入口：

- `../project/opencode-dev/packages/schema/src/skill.ts`
- `../project/opencode-dev/packages/core/src/skill.ts`
- `../project/opencode-dev/packages/core/src/skill/guidance.ts`
- `../project/opencode-dev/packages/core/src/tool/skill.ts`
- `../project/opencode-dev/packages/core/src/tool/tool.ts`
- `../project/opencode-dev/packages/core/src/tool/registry.ts`
- `../project/opencode-dev/packages/core/src/session/runner/llm.ts`
- `../project/opencode-dev/specs/v2/config.md`
- `../project/opencode-dev/specs/v2/session.md`

## 4. 两家方案对比与 OmniFlow 取舍

| 关注点 | Claude Code | OpenCode | OmniFlow V1 |
| --- | --- | --- | --- |
| Skill 定位 | 按需加载的操作说明，可带参数和引用 | 按需加载的说明内容，执行仍在统一 Agent loop | 受控 Tool 编排说明 |
| 初始上下文 | 只注入有预算的摘要目录 | 只注入权限过滤后的名称和说明 | 只注入可用 Skill 的 ID、说明、适用场景 |
| 正文加载 | 模型调用 Skill Tool | 模型调用规范 `skill` Tool | 模型调用 `skill.activate` |
| 执行能力 | 继续调用既有 Tool | 继续调用规范 Tool Registry | 继续调用现有 Agent Tool |
| 权限 | Skill 不替代 Tool 权限 | 可见性过滤与执行授权分离 | allowlist 只能收窄；运行时权限仍是唯一真相 |
| 运行状态 | 仍属于当前 Agent 任务 | 仍属于当前 Session runner | 仍属于当前 Run / ToolRun |
| 上下文 | Skill 正文按需进入，并考虑压缩保留 | legacy 将 Skill 输出列为 pruning 保护项；V2 主要沿 Context Epoch / Session history 方向演进 | 当前 Run 保留激活结果；终态历史只需保留激活事实 |
| 来源 | 内置、用户、项目、插件、远程等 | directory、URL、embedded | 第一版仅内置 TypeScript 定义 |
| 高级能力 | fork、hook、shell expansion、远程 Skill | 动态来源、上下文 epoch、未来插件能力 | 第一版全部暂缓 |

共同原则比具体文件格式更重要：**渐进披露、统一 Tool 执行、权限独立、单一运行状态**。

## 5. 不可违反的架构决策

下面的编号用于未来实现和 review 溯源。若要改变任一决策，必须先更新本文并写明新的触发条件与迁移影响。

| 编号 | 决策 | 原因与后果 |
| --- | --- | --- |
| `SKILL-01` | Skill 不是 executor | 防止绕过 Tool Registry、Broker、确认、取消和审计；Skill 中不得出现可执行回调或 IPC。 |
| `SKILL-02` | Skill 不是 Workflow 状态机 | Session、Run、ToolRun 继续是唯一执行事实；不新增第二套步骤、进度或重试状态。 |
| `SKILL-03` | 使用渐进披露 | 初始上下文只放摘要，完整说明由 `skill.activate` 按需加载，避免系统提示词无限增长。 |
| `SKILL-04` | 第一版只支持内置、随应用发布的 TypeScript 定义 | 先验证契约和运行闭环，不同时引入 Markdown 发现、远程下载、插件信任和热更新。 |
| `SKILL-05` | Run 启动时冻结 Skill catalog 快照 | 同一 Run 中 ID、版本、正文和 allowlist 不因注册表变化而漂移。 |
| `SKILL-06` | Skill allowlist 只能收窄能力 | 有效 Tool 是当前 Run 原本可用 Tool 与已激活 Skill allowlist 的交集；Skill 永远不能授予新权限。 |
| `SKILL-07` | Tool 运行时授权是唯一安全真相 | 即使 Tool 出现在 Skill 中，仍必须重新经过 Schema、领域校验、动态权限、确认和 executor 边界。 |
| `SKILL-08` | 激活属于当前 Run 的受控 ToolRun 事实 | `skill.activate` 复用现有只读 Tool / ToolRun 链路，不创建子 Run、子 Session 或独立执行记录。 |
| `SKILL-09` | Skill 正文有严格预算 | 注册时限制正文、摘要和引用规模；第一版不加载任意引用目录，避免上下文与秘密失控。 |
| `SKILL-10` | Skill 不拥有 UI | 时间线只展示本地注册的语义块；Skill 不能返回 JSX、HTML、CSS、回调、URL 或 IPC channel。 |
| `SKILL-11` | Skill 不保存业务状态 | 进度、确认、交互、产物和结果仍由 Run / ToolRun 及既有 Store 持久化。 |
| `SKILL-12` | 首个 Skill 聚焦单一可验证流程 | 先做 `media-extract-audio`，不做包揽所有媒体操作的通用 Skill。 |
| `SKILL-13` | Run 同时冻结 Tool 与 Skill catalog | 预算、provider schema、计划、激活和执行必须使用同一能力身份；不能预检旧 Tool、执行同名新 executor。 |
| `SKILL-14` | 激活独占一个 provider turn | 激活后的正文和能力收窄从下一 turn 生效；同一响应中的其他调用不能抢跑。 |

## 6. V1 组件关系

```text
AgentOrchestrator
  ├─ Run 启动前取得 AgentRunCapabilitySnapshot
  │    ├─ AgentToolCatalogSnapshot
  │    └─ AgentSkillCatalogSnapshot
  ├─ AgentPromptAssembler 注入有界 Skill 摘要目录
  ├─ Provider 请求暴露 skill.activate 与当前可见 Tool
  └─ Tool loop 继续使用现有执行链
          |
          v
AgentSkillRegistry
  ├─ 注册内置定义
  ├─ 校验 ID / 版本 / 大小 / Tool 引用
  ├─ 深拷贝并冻结定义
  └─ 为 Run 生成不可变 Skill 快照
          |
          v
skill.activate
  ├─ 只允许读取当前 Run 快照中的 Skill
  ├─ 返回有界完整说明和 allowlist
  └─ 作为当前 Run 的只读 ToolRun 被审计
          |
          v
AgentToolRegistry -> PermissionGate -> AgentToolBroker -> executor
  现有 Schema、确认、取消、进度、结果、再感知与 SQLite 事实不变
```

Skill Registry 只管理说明；Tool Registry 只管理能力。二者不能合并成“注册 Skill 时顺带注册任意 executor”的接口。Run 的组合快照只是把两套已注册事实锁定在同一启动边界，不改变二者职责。

## 7. 最小定义契约

第一版概念契约：

```ts
interface AgentSkillDefinitionV1 {
  id: string;
  version: string;
  description: string;
  whenToUse: string;
  toolAllowlist: readonly string[];
  requiredTools: readonly string[];
  optionalTools: readonly string[];
  instructions: string;
  source: 'built-in';
}
```

字段语义：

- `id`：稳定、可搜索、与展示名称解耦的内部 ID，例如 `media-extract-audio`。
- `version`：正文或行为约束变化时递增，用于 Run 审计和问题复现；不是应用版本。
- `description`：简短说明 Skill 能解决什么问题，进入摘要目录。
- `whenToUse`：帮助模型区分相近 Skill，进入摘要目录。
- `toolAllowlist`：该流程预计使用的业务 Tool；只参与能力收窄，不构成授权，也不列入 Orchestrator 固定控制能力。
- `requiredTools`：核心流程必需的 Tool；任何一项在本 Run 的 Effective Tool View 中 blocked 时，该 Skill fail-closed，不进入摘要目录且不可激活。
- `optionalTools`：只服务增强分支的 Tool；不可用时 Skill 标记为 degraded，但核心流程仍可被发现。`requiredTools` 与 `optionalTools` 必须无重复地完整划分 `toolAllowlist`。
- `instructions`：激活后加载的完整流程、默认值、询问条件、失败边界和完成验证；与激活结果 envelope 序列化后必须完整落在现有 provider Tool result 的 1,024 token 上限内，V1 不允许截断正文继续运行。
- `source`：V1 固定为 `built-in`，为未来来源分层保留明确边界。

注册时必须拒绝：

- 重复或不符合命名规则的 ID。
- 空描述、空适用场景或空正文。
- 单条摘要超出字段上限，或正文无法随激活 envelope 完整装入 1,024 token Tool result 上限。
- 重复 Tool 或未知 Tool。
- `requiredTools / optionalTools` 重复、交叉，或没有完整划分 allowlist。
- 危险对象结构、运行时函数、可执行回调和非可序列化字段。

Registry 注册成功后深拷贝并冻结定义；调用方后续修改原对象不能改变 Run 快照。

provider Tool 名映射冲突当前仍在请求 materialization 边界拒绝，不属于注册期已落地能力；后续可以把这项校验提前到 Skill 注册或 Run 快照边界，以获得更早、更清晰的失败反馈。

正文预算不能只按字符数猜测。Registry 必须用与真实 `skill.activate` 相同的序列化 envelope 和现有 token 估算器做注册期校验，执行前再用当前 continuation 剩余预算复核。

## 8. 发现、投影与激活

### 8.1 Run 启动快照

每个 Run 必须在“创建 Run 前预算预检”之前取得一次不可变的 `AgentRunCapabilitySnapshot`。它同时包含：

- Environment capability snapshot：`media.ffprobe` / `media.ffmpeg` 等只读 Probe 的规范状态、安全 reason code 与 scope identity。
- Tool snapshot：规范名称、注册 identity、冻结 schema / 元数据和当前 executor 引用。
- Effective Tool View：根据 Tool registration 的 required / optional Capability 派生；required 不可用或 unknown 时 blocked，optional 不可用或 unknown 时 degraded。
- Skill snapshot：完整不可变定义，以及对同一 Effective Tool View 聚合的 required / optional Tool readiness。

预算预检、system prompt、provider Tool schema、`agent.plan.set` 合法 Tool、Skill 摘要、Skill 激活、运行时参数校验和 executor lookup 必须贯穿使用这同一份快照。blocked 业务 Tool 不进入 provider schema、计划或 Broker，依赖它的 required Skill 不进入摘要目录且不能通过猜测 ID 激活。不能在预检后重新读取 live Registry；同名 Tool 被替换或注册 identity 不匹配时必须拒绝 stale call，不能误执行新实现。

完整环境结果和 executor 引用只属于当前进程；Run 在 SQLite 中只持久化稳定的 `capability_identity / tool_catalog_revision / skill_catalog_revision` 诊断字段，不保存 Probe 的 `checkedAt`、绝对路径、异常原文或完整 Definition。

用于提示和审计的 Skill 投影至少固定：

```text
skill id + version + description + whenToUse + toolAllowlist + instructions hash
```

V1 不支持运行中 reload。应用升级或 Registry 改变只影响后续 Run；当前 Run 的激活和执行必须继续从启动时保存的组合内存快照读取。应用重启后现有规则会把未完成 Run 标记为 `interrupted`，因此 V1 不需要跨进程恢复函数引用。

### 8.2 初始目录

系统上下文只注入经过当前 Agent / owner / 平台能力过滤后的摘要：

```text
id + description + whenToUse
```

不注入完整正文、示例、参考文件和无关 Skill。摘要目录必须由同一 Run 快照生成，并在创建 Run 前计入完整请求预检。目录有独立总 token 预算；超过预算时按稳定顺序只保留完整 Skill 摘要并明确标记，不能发送半条摘要。`skill.activate` 只能接受本轮实际展示在目录中的 Skill ID，不能通过猜测访问被预算排除的定义。

### 8.3 `skill.activate`

模型判断某个 Skill 匹配后调用：

```text
skill.activate({ skillId })
```

该 Tool 只能从当前 Run 快照读取定义，不能按模型提供的路径或 URL 加载内容，也不接受由用户或模型拼接进正文的自由参数。成功结果向 provider 返回：

```text
skillId、version、完整 instructions、toolAllowlist、instructionsHash
```

`skill.activate` 是 Tool Registry 中固定注册的 main 侧只读控制 Tool。它复用现有 Schema、Tool 事件、结果清洗和 ToolRun 持久化，不增加特殊 IPC 或第二套审计表；但它不计入 8 次业务 Tool 配额、不绑定计划步骤，也不阻止模型在下一 turn、首个业务 Tool 前调用一次 `agent.plan.set`。只有应用内置代码可以注册控制 Tool，Skill 定义和未来插件都不能声明这个类别。

激活结果 envelope 与完整正文必须在执行前估算并完整落入当前 `MAX_PROVIDER_TOOL_RESULT_TOKENS = 1,024` 以及该 continuation 的剩余预算；不满足时在无副作用边界拒绝激活，不能截断流程说明后继续。受限的完整激活结果随 ToolRun 保存以便 main 审计；当前 Run 后续 provider turn 可以读取完整结果，Run 终态后的历史投影只返回 `skillId + version + instructionsHash`，不得通过近期 ToolRun 事实把旧正文反复灌回上下文。Main 到 renderer 的集中安全投影会把 Skill ToolActivity 和 Session 快照收口为 `skillId + version + instructionsHash` 与本地状态文案，不把 SQLite 中的完整 ToolRun result 原样发送给 UI。

Skill 正文即使来自内置可信代码，也只是低于稳定系统策略的流程指导，不能覆盖系统安全规则、当前用户目标、Tool 参数校验或权限结果。

同一个 Run 重复激活相同 `id + version` 时返回幂等结果，不重复改变能力集。V1 每个 Run 最多激活一个不同 Skill；尝试切换到另一个 Skill 时明确拒绝并建议新建 Run。只有出现真实组合需求后才扩展。

`skill.activate` 必须独占一个 provider turn。若同一模型响应同时声明激活和任意其他 Tool call，Orchestrator 在创建任何 ToolRun 或执行任何副作用前拒绝整批调用，并为协议中的每个 call 返回结构化失败；模型只能在下一 turn 单独激活。能力收窄和 Skill 正文也只从激活成功后的下一 provider turn 生效。

## 9. Tool 可见性与权限

Skill 激活前，Agent 只能看到当前 Run 原本允许的 Tool 与 `skill.activate`。Skill 激活后的业务 Tool 可见集合为：

```text
Orchestrator 固定保留的控制能力
  ∪
(当前 Run 原本允许的业务 Tool ∩ 已激活 Skill 的 toolAllowlist)
```

若未来允许同一 Run 激活多个 Skill，先对各 Skill allowlist 求并集，再与当前 Run 原本允许集合求交集。这个规则允许组合流程，但仍不能把原本不可用的 Tool 变成可用。

控制能力必须逐个定义，不能留给实现自行扩张：

- `agent.plan.set`：沿用现有 provider control call；不创建 ToolRun、不计入 8 次业务 Tool 配额、不成为计划步骤，并继续遵守“首个业务 Tool 前最多一次”的规则。
- `skill.activate`：固定注册的只读控制 Tool；创建 ToolRun 作为激活事实，但不计入 8 次业务 Tool 配额、不成为计划步骤，并且必须独占 provider turn。

两者在满足自身阶段条件时始终可见，不受业务 allowlist 删除；其他 Tool 默认都是业务 Tool，除非未来先修改本文并补齐独立安全审计。Skill 定义不能把任何业务 Tool 自行标记为控制能力。

实现时应把 `business / control` 做成 Tool snapshot 中由内置 Registry 决定的封闭分类，默认值必须是 `business`；不能在 Orchestrator 各处靠 Tool 名字符串分别特判，也不能接受模型、Skill 或外部配置提供这个字段。

若摘要目录与用户目标明确匹配，提示词应要求模型先激活 Skill 再开始该流程；模型没有激活 Skill 本身不是授权漏洞，任何直接 Tool 调用仍受原运行时安全边界约束。

必须区分两件事：

- **模型可见性**：本轮是否向 provider 声明某个 Tool。
- **执行授权**：Tool 参数规范化后，运行时是否 allow / ask / deny。

前者用于减少误调用和上下文，后者才是安全边界。Skill 正文中的“用户已同意”“允许覆盖”或类似文字一律无效；长期记忆和历史消息也不能替代当前动作确认。

环境 Capability 同样只决定 Run 可见性与提前解释，不授予权限。`media.inspect` 和 `media.extractAudio` 在执行前仍重新解析 `ffprobe` / `ffmpeg`；Run 前可用不代表执行时必然可用。

## 10. 上下文、压缩与持久化

- Skill 摘要属于稳定能力目录，由 Run 快照生成，并计入创建 Run 前以及后续每次完整 provider 请求预算。
- 完整正文只在激活后以受控 Tool 结果进入当前 Run；注册期与执行期均保证完整结果不超过 1,024 token，不能依赖 provider 投影截断。
- 当前 Run 不被会话摘要切开，因此已激活说明在该 Run 的后续 Tool loop 中继续可见。
- 终态 Run 进入后续压缩或近期 ToolRun 事实投影时，只保留“激活了哪个 `skillId + version + instructionsHash`”和实际业务 Tool 事实，不再次投影完整正文；用户目标仍由规范消息保留，SQLite 中的有界原始 ToolRun 继续用于本机审计。
- 应用重启后未完成 Run 仍按现有规则进入 `interrupted`，V1 不恢复模型执行，因此无需从新版 Registry 猜测并重放旧 Skill。
- Skill 不能写入长期记忆；用户明确要求记住偏好时仍通过 `memory.propose` 和既有确认闭环。

如果未来支持自动恢复未完成 Run，必须先持久化可复现的完整 Skill 快照或不可变内容包；仅保存 ID 后从当前 Registry 重新加载是不安全的。

## 11. 第一条 Skill：`media-extract-audio`

选择这条流程的原因：

- `media.inspect` 与 `media.extractAudio` 已经存在，Skill 不需要同时发明新的执行能力。
- 可以验证摘要发现、按需激活、Tool 收窄、参数补齐、确认、进度、产物和再感知。
- 风险可控，失败边界和成功结果都容易人工判断。

职责边界：

```text
适用：从当前感知范围内的一个音视频文件提取第一条音轨。
不适用：视频转码、音轨剪辑、批量处理、目录递归、任意 ffmpeg 参数。
```

当前 allowlist：

```text
file.list
file.stat
media.inspect
interaction.request
media.extractAudio
```

设计流程：

1. 从当前感知和必要的 `file.list` / `file.stat` 中解析一个明确输入文件，不使用历史文件名替代当前事实。
2. 调用 `media.inspect` 确认容器中存在音频流；不根据扩展名猜测。
3. 用户未指定格式时使用现有安全默认值 `m4a`，不为了已有默认值增加无意义询问；当前 catalog 已与此规则统一。
4. 只有输入文件不唯一、用户要求与支持范围冲突或确实缺少少量必要参数时，才调用 `interaction.request`。
5. 调用 `media.extractAudio`；写入、上传和媒体处理仍由运行时给出精确确认，Skill 不自行批准。
6. 使用 Tool 返回的 authoritative 节点与再感知结果确认产物，不能只根据 ffmpeg 退出码宣称成功。
7. 通过既有受控语义动作展示并定位结果。

完成条件：

- `media.extractAudio` 返回已提交的后端节点身份。
- 再感知能够在授权目标目录中确认同一节点时标记 verified。
- 如果写入已经提交但刷新失败，沿用现有 committed fallback，明确区分“文件已生成”和“界面验证未完成”，不得重复执行提取。

下一条独立 Skill 可以是 `media-transcode`，但必须先有受控 `media.transcode` Tool。不能用扩大 `media-extract-audio` 正文的方式偷偷加入通用转码。

## 12. 当前文件结构

第一版保持在 Electron main 的 Agent 域内，不在 renderer 建第二份 Registry：

```text
electron/service/agent/
  agent-run-capability-snapshot.ts
  capabilities/
    agent-capability.types.ts
    agent-capability-registry.ts
    agent-capability-runtime.ts
  skills/
    agent-skill.types.ts
    agent-skill-registry.ts
    agent-skill-catalog.ts
    agent-skill-runtime.ts
    skill-activate-tool.ts
```

职责：

- `agent-run-capability-snapshot.ts`：在创建 Run 前同时冻结 Tool / Skill identity，并向预算、provider、计划、激活与执行提供同一视图。
- `capabilities/agent-capability-registry.ts`：内置只读 Probe 的注册、scope 缓存、超时、调用方取消、generation 失效与安全快照。
- `capabilities/agent-capability-runtime.ts`：首批 `media.ffprobe / media.ffmpeg` 定义与生产 Registry 入口。
- `agent-skill.types.ts`：可序列化定义、摘要和 Run 快照契约。
- `agent-skill-registry.ts`：注册校验、冻结、list / get / snapshot。
- `agent-skill-catalog.ts`：内置定义的唯一组合入口；当前首条定义也保存在该文件，等数量增长产生真实维护成本后再拆分 `definitions/`。
- `agent-skill-runtime.ts`：在业务 Tool 注册完成后注册固定控制 Tool 和内置 catalog。
- `skill-activate-tool.ts`：只能读取当前 Run catalog 快照的受控 Tool。

Renderer 仅在未来确实需要 Skill 管理或快捷入口时增加新的业务投影；V1 现有集中安全投影只负责保证完整 Skill 正文不跨到 renderer，不引入第二份 Registry。

## 13. 实现顺序

### 阶段 A：Registry 与契约（主链已落地）

- 实现定义、注册校验、冻结，以及 Tool + Skill 共用的 Run capability snapshot。
- 让预算、provider schema、计划校验、激活和 executor lookup 全部消费同一快照，并拒绝 stale call。
- 为重复 ID、未知 Tool、正文 / 摘要预算、不可变性和稳定排序补单元测试。
- 不改 UI，不新增业务 Tool。

### 阶段 B：渐进披露（已落地）

- 在 Prompt Assembler 中只注入 Skill 摘要。
- 注册 `skill.activate`，验证激活前没有完整正文、激活后同一 Run 能读取完整说明。
- 把摘要与最大激活结果纳入创建 Run 前预算，接入 Tool 可见集合收窄和 provider 每轮 Tool materialization。
- 整轮拒绝“激活与其他调用同 turn 抢跑”，下一 turn 才应用正文和能力收窄。
- main 到 renderer 的集中安全投影会剥离完整 instructions 和 allowlist。
- provider 总 turn 固定为 10，业务 Tool 调用继续独立限制为 8，既允许控制激活，又不允许控制调用无限续接。

### 阶段 C：首条媒体 Skill（实现已落地，端到端待验证）

- 注册 `media-extract-audio`。
- 复用现有 `media.inspect`、`interaction.request`、`media.extractAudio`。
- 复用既有 ToolActivity，不创建新的任务页面或执行状态；renderer 只收到集中安全投影生成的紧凑激活身份。

### 阶段 D：验证后再扩展（未开始）

- 根据真实调用记录调整描述、适用场景和流程说明。
- 再决定是否增加 `media.transcode` Tool / Skill。
- 字幕翻译继续等现有能力收敛成稳定 Tool 后再接入。

## 14. 验证门禁

截至 2026-08-24，完整验证结果为：`npm test` 共 136 个测试文件、779 个用例通过、1 个跳过；`npm run lint` 和 `npm run build` 均通过，build 中的 `tsc` 同时完成 TypeScript 检查。build 只有既有的单 chunk 超过 500 kB 警告。自动化门禁已经收口，但仍没有真实 provider / 媒体端到端记录。

现有自动化已经覆盖或部分覆盖：

- 注册重复 ID、无效 ID、空字段、过长正文和未知 Tool 时失败。
- 注册后修改原定义不能改变 Registry 或 Run 快照。
- Tool / Skill catalog 稳定排序，Run 开始后 Registry 变化不影响当前 Run；同名注册 identity 变化时拒绝 stale call。
- Capability Registry 覆盖重复注册、machine / owner / library scope 隔离、TTL、超时、异常清洗、调用方取消、generation 失效和迟到结果拒绝。
- required Capability 不可用或 unknown 时业务 Tool 被移出 provider schema、计划与 Broker；optional Capability 不可用或 unknown 时 Tool / Skill 保持可见但标记 degraded。
- required Tool blocked 时 Skill 不进入摘要目录且无法猜测激活；optional Tool blocked 时 Skill 降级。
- 等价状态下 Run capability identity 稳定，不受 `checkedAt` 影响；状态或 Tool / Skill catalog revision 变化时 identity 改变，三项诊断身份随 Run 持久化。
- 初始系统上下文只包含摘要，不泄漏完整 instructions。
- 未知 Skill、非当前 Run 可用 Skill 和越权来源激活失败。
- Skill 摘要进入创建 Run 前预检；激活 envelope 与完整正文超过 1,024 token 或 continuation 剩余预算时在无副作用边界失败。
- `skill.activate` 的输出、错误和审计字段经过现有清洗；终态 Run 的上下文与近期 ToolRun 投影不回灌完整正文。
- 同一 provider turn 同时返回激活和其他 Tool 时整批拒绝，没有 ToolRun 或业务副作用抢跑；能力收窄从下一 turn 生效。
- `skill.activate` 创建审计 ToolRun，但不消耗业务 Tool 配额、不绑定计划步骤，也不阻止下一 turn 在首个业务 Tool 前设置计划。
- Skill allowlist 只能减少 provider 可见 Tool，不能增加权限。
- Skill 中列出的写 Tool 仍进入 `ask`，拒绝后不执行。
- 同一 Skill 重复激活幂等；激活数量达到上限时明确失败。
- 上下文压缩不切开当前 Run；终态摘要不把 Skill 文本误当执行事实。
- main 到 renderer 的 ToolActivity / Session 投影不包含 `instructions` 或完整 allowlist，只包含紧凑激活身份。
- 激活 continuation 接近模型窗口上限时，Orchestrator 在无副作用边界拒绝且不持久化伪成功。
- 控制激活不消耗业务 Tool 调用配额；一次激活、最多 8 个串行业务 Tool turn 和最终回答都受 10 个 provider turn 总上限约束。

非阻塞的后续测试补强：增加“激活后调用写 Tool 仍进入 `ask`”的单条组合用例；把 provider Tool 名规范化冲突从请求 materialization 的现有拒绝边界提前到 Skill 注册或 Run 快照边界。

首条 Skill 手工验证至少覆盖：

- 当前文件明确且含音轨时，检查、确认、提取、上传、刷新、再感知和定位完整成功。
- 未选文件、选中目录、多候选、无音轨和不支持格式时不误执行。
- 用户拒绝、停止、页面切换、上传失败和刷新失败时不重复产生文件。
- 应用重启后未完成 Run 只显示 interrupted，不自动重放。
- macOS 与 Windows 共享同一 Skill 定义，平台差异只留在既有媒体 Tool / process runner。

测试资料库继续遵守 workspace 规则：任何场景禁止第一个资料库；`Win` 可用时优先使用 `Win`。当前公司环境只能使用本机 macOS MinIO，因此本地资料库验证使用 macOS 上的非第一个资料库，媒体播放相关验证由用户执行，避免意外外放。

## 15. V1 明确不做

- 用户目录或项目目录中的任意 `SKILL.md` 发现。
- 远程 Skill、URL source、市场、自动下载和热更新。
- 插件在注册 Skill 时附带可执行代码、二进制或任意 Shell。
- Skill hook、shell expansion、环境变量展开和路径引用。
- fork Agent、子 Agent、后台 Skill 和跨 Session 自动运行。
- Skill 自己的数据库、任务队列、进度、重试或 Workflow 表。
- 用 Skill allowlist 替代 Tool 动态权限和用户确认。
- 把全部 Skill 正文常驻系统提示词。
- 为 Skill 接受模型生成的任意 React / HTML / CSS / callback。
- 一开始就做通用“媒体处理大全”或直接迁移字幕翻译。

## 16. 后续演进触发条件

只有出现对应真实需求和验证证据后，才评估扩展：

| 能力 | 触发条件 |
| --- | --- |
| 本地 `SKILL.md` | 内置 Skill 已稳定，且确实需要用户创建流程说明；必须先完成来源信任、schema、大小、路径和更新策略。 |
| 远程 Skill | 有明确分发需求，并具备签名、版本锁定、原子 staging、撤回、缓存和离线降级。 |
| 多 Skill 组合 | 单个真实任务必须组合两个已稳定 Skill，且并集收窄规则通过验证。 |
| Workflow 层 | 出现跨 Run 重试、共享产物、跨多轮暂停恢复或跨 Session 编排，而现有 Run / ToolRun 无法表达。 |
| 子 Agent | 有必须隔离上下文或并行委派的真实任务，并先设计深度、权限继承、取消、恢复和配额。 |
| 通用 Shell | 高层 domain Tool 无法合理覆盖的高级用户需求长期存在，并完成工作目录、环境、网络、命令和 OS 沙箱设计。 |
| Skill 管理 UI | Skill 来源和数量增长到用户确实需要启停、检查版本或解决冲突；完整正文仍不由 renderer 执行。 |

## 17. 维护与溯源规则

- 实现 Skill 前必须先读本文、`docs/built-in-agent-architecture.md` 和同目录的 `built-in-agent-development-notes.md`。
- 每次新增 Skill，必须写清适用、不适用、allowlist、默认值、询问条件、完成验证和失败边界。
- 每次新增 Tool，先更新 Tool 契约和权限 / 验证文档；不能为了让某个 Skill 工作而绕过 Registry。
- 实现进度只在功能和测试真实落地后回写；不能把规划项提前写成当前能力。
- 若实现与 `SKILL-01` 至 `SKILL-14` 任一决策冲突，先停下并更新决策理由，不用局部补丁掩盖架构偏离。
- 外部 Claude Code / OpenCode 更新不会自动改变本文；只有重新调研并确认适合 OmniFlow 后才修订。
- 稳定实现事实、SQLite 字段和验证入口已经开始同步到 `docs/built-in-agent-architecture.md`；只有本节剩余门禁全部收口后，才能把本文状态改为“已落地基线”并删除或归档。
