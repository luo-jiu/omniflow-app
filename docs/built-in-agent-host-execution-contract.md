# 内置 Agent 宿主机执行契约

更新时间：2026-09-01

状态：**macOS Zsh 的 `host` 执行上下文已接入 main Shell 执行链，当前为开发预览；Linux / Windows 仍 fail-closed，持久规则和真实安装包验收尚未完成**。

适用范围：

- `src/shared/agent/`
- `electron/service/agent/`
- `electron/platform/shell/`
- `electron/ipc/agent.ts`
- `src/features/agent/`

本文同时记录 OmniFlow 向 Codex CLI 级宿主机执行能力迁移时的目标契约、当前实现事实和剩余门禁。Shell 的整体实现状态与通用约束以 [`built-in-agent-shell-architecture.md`](./built-in-agent-shell-architecture.md) 为准；本文件补充 `host` / `run-workspace` 的专属边界，不能把开发预览误称为稳定跨平台能力。

## 1. 用户目标

内置 Agent 应该能够在用户明确授予的权限范围内：

- 使用本机原生 Shell 执行完整命令，而不是只能调用有限的 CLI 白名单。
- 发现并使用本机已有的 `ffmpeg`、`git`、`npm`、`python`、文本处理工具和其他 CLI。
- 读取用户明确指定的本机文件和目录，不因为“读取”就强制复制到临时工作区。
- 通过结构化 Tool 操作 OmniFlow 的资料库、目录树、上传、发布和媒体业务。
- 在一次任务中组合 Shell 和结构化 Tool，并在每一步后重新感知真实状态。

典型任务：

```text
“检查当前机器有没有 ffmpeg，把视频目录里的 a.mp4 提取成 a.m4a，放回同一目录。”
```

Agent 应能够先检查环境，再执行转换，最后根据用户要求调用资料库 Tool 或本机发布 Tool。Shell 负责本机进程，结构化 Tool 负责 OmniFlow 的业务事务；两者不是互相替代关系。

## 2. 决策摘要

### 2.1 采用 raw native Shell

`shell.run` 接受完整命令字符串，并由主进程交给冻结的系统 Shell Provider 执行。`ffmpeg`、`git`、`npm` 等只是常见例子，不是允许列表。

命令分析器的职责是：

- 识别风险、原子操作和可能的副作用。
- 为审批卡、审计、规则匹配和 UI 提供解释。
- 在无法完整解析时标记 `unknown` 或 `unresolved`。

命令分析器不是 OS sandbox，也不能因为自己不认识某个命令就把它当成不存在。特别是 `full-access` 下，普通未知命令必须仍可进入主进程执行链。

### 2.2 沙箱和审批是两条轴

“完全访问”表示当前宿主用户权限下的真实文件系统、网络和环境，不表示 OmniFlow 获得了比操作系统更高的权限。它首先是当前 Policy Engine 的一个放行模式，而不是 OS sandbox。

当前代码的不可变 deny 只明确覆盖 `detached`、`interactive` 和 `privilege_escalation` 三个风险分面，以及（若接入规则时存在）显式 deny；环境变量的 protected / sensitive 覆盖则在输入规范化阶段拒绝。除此之外，`filesystem.delete`、`system_configuration`、`network`、`external_path`、`destructive` 和 `unresolved` / `unknown_syntax` 等 assessment 在 `full-access` 下不会再自动进入确认，只要没有命中上述 deny 就直接放行。若产品未来要求这些高影响操作继续确认，必须新增并冻结 policy revision；不能把目标安全意图误写成当前行为。

### 2.3 主进程是唯一执行 owner

模型和 renderer 只能提交经过 Schema 校验的逻辑请求，不能：

- 直接调用 Node `spawn` 或原始 IPC。
- 指定任意可执行文件路径、固定启动参数，或伪造已经由 main 解析的物理工作目录 binding；host cwd 请求仍必须由 main 解析、检查并冻结。
- 取得完整宿主环境、API Key、Cookie、签名 URL 或控制目录路径。

Electron main 负责解析、冻结、审批、租约、spawn、日志、取消和结算。现有 `AgentShellProcessSupervisor`、`AgentShellRuntime`、ToolRun 和日志链应继续复用。

## 3. 参考项目得到的结论

### 3.1 Codex CLI

本地 Codex 源码的 `exec_command` schema 直接接收 `cmd`、`workdir`、PTY 和输出参数，没有命令白名单。命令先经过 approval / exec policy，再由执行层在目标环境中运行。

Codex 的关键分离是：

```text
命令解析       -> 风险、规则和审批依据
Permission      -> 是否需要确认 / 是否允许
Sandbox         -> 文件系统和网络隔离方式
Process manager -> cwd、环境、输出、超时、终止
```

Codex 的工具 schema 没有 CLI allowlist，但最终行为仍由危险命令检测、exec policy、approval policy、权限 profile 和显式规则共同决定。未知但不危险的命令在 unrestricted 环境的一般路径上不会仅因为“未解析”而自动失败；危险命令仍可进入 `Prompt` 或 `Forbidden`。OmniFlow 当前的 `full-access` Policy 更宽：除不可变 / 显式 deny 外，连 unresolved 与其他高影响 assessment 也直接放行。因此不能把 Codex 的危险命令策略或本文件的目标安全要求当成 OmniFlow 当前已实现的额外确认；需要收窄时应单独升级 Policy。

可核对的源码位置：

- `project/codex/codex-rs/core/src/tools/handlers/shell_spec.rs`
- `project/codex/codex-rs/core/src/tools/handlers/unified_exec/exec_command.rs`
- `project/codex/codex-rs/core/src/exec_policy.rs`
- `project/codex/codex-rs/sandboxing/src/manager.rs`
- `project/codex/codex-rs/core/src/session/turn_context.rs`

### 3.2 OpenCode 与官方文档

OpenCode 的执行器同样把完整命令交给宿主进程，且存在统一的输出、Tool settlement 和进程终止边界。当前本地快照仍记录了 crash recovery / 幂等、输出托管和 Windows 进程树等局限；本文只吸收可由源码核对的原则，不把该快照描述成已经完整解决了这些问题。它没有证明“把命令交给宿主”就自动安全，反而说明了输出有界、恢复不重放副作用和进程树清理的重要性。

官方 OpenAI 文档也明确区分：模型只产生 shell call，应用自己的 runtime 必须执行命令并把结果回传；任意 Shell 需要由应用负责沙箱、审批、资源限制和审计：

- [Local shell](https://developers.openai.com/api/docs/guides/tools-local-shell)
- [Shell](https://developers.openai.com/api/docs/guides/tools-shell)
- [Sandbox Agents](https://developers.openai.com/api/docs/guides/agents/sandboxes)

## 4. 目标分层

```text
Agent Orchestrator
  -> Tool Registry / capability snapshot
  -> shell.run preparation
  -> permission / approval
  -> AgentToolBroker
  -> Host Execution Plane
       -> platform Shell Provider
       -> Process Supervisor
       -> bounded output / LogStore
       -> timeout / cancellation / settlement
  -> structured Tool result

并行的 OmniFlow Tool Plane
  -> file.list / file.stat
  -> file.stage / file.publish / file.upload
  -> media / library / directory tools
```

Shell 只能通过这条受控链进入宿主机。资料库 authoritative commit、目录创建、上传、Save As 和媒体业务仍由结构化 Tool 负责。

## 5. 执行上下文

当前实现已经显式区分两种上下文，不能用一个布尔值隐式切换：

```ts
type AgentShellExecutionContext =
  | {
      kind: 'run-workspace';
      workspaceId: string;
      generation: number;
      logicalCwd: string;
    }
  | {
      kind: 'host';
      environmentId: 'local';
      requestedCwd?: string;
    };
```

这是 main-owned 判别契约，不允许 renderer 自己构造物理 binding。host 分支的真实路径、Provider executable、环境和身份只存在 main-owned private binding 中；public action 只携带用户请求的 cwd 表示。

### 5.1 `run-workspace`

- 使用现有 `input / work / output / tmp / home` 虚拟目录。
- 继续执行 workspace generation、manifest、symlink、配额和产物发布检查。
- 适合需要暂存、转换、生成和后续 `file.publish` 的工作流。
- Shell 输出写入 workspace 不等于已经进入资料库。

### 5.2 `host`

- 使用 main 解析并冻结的真实宿主 cwd。
- 用户明确提供绝对路径或宿主 `~` 路径时，main 规范化并检查该路径；未提供时使用 main 冻结的默认 host cwd。相对路径只能相对于已经冻结的 host cwd 解析，不能把它解释成 workspace 路径。
- cwd 必须在 prepare 和紧邻 spawn 前都确认存在、是允许的目录类型，并重新检查 realpath、符号链接 / junction / reparse point 和 owner binding；任一 TOCTOU 漂移都废止旧 action。不存在路径、文件路径、越界链接或无法确认的路径不会静默回退到另一个目录。
- `~`、`$HOME`、`%USERPROFILE%` 在 host 上表示宿主用户目录，在 workspace 上仍表示虚拟 `home`。
- 不把 host 路径误交给 workspace cleanup、manifest 或 quota adapter。
- host 写入不自动变成资料库产物；需要入库时必须回到 `file.upload` 或 `file.publish`。

host 当前不接入 Run workspace 的 manifest、虚拟配额或执行期增长监控；宿主磁盘增长受操作系统和用户自身管理。即使未来增加监控，在没有 OS 级隔离时也不能宣称能阻止命令写满宿主磁盘或启动脱离进程。

## 6. 权限模式

权限模式在 Run capability snapshot 创建时冻结，只影响后续新 Run；不能给正在等待确认或执行中的 Run 中途提权。执行上下文和权限模式是两个正交维度：选择 `full-access` 只放宽策略，不会自动把一个 `run-workspace` action 变成 `host` action；host 也必须由 main 在 Run 创建时明确授予并冻结。

| 模式 | 普通已知命令 | 未知 / 无法完整解析 | 外部路径、网络和写入 |
| --- | --- | --- | --- |
| `ask` 询问我 | 进入确认 | 进入确认，并展示风险 | 进入确认 |
| `auto` 自动批准 | 仅 main 能证明安全的 workspace 子集自动执行 | 询问 | 询问或拒绝 |
| `full-access` 完全访问 | 按所选 execution context 执行；只有 `host` context 使用真实宿主 | 只要没有命中不可变 / 显式 deny，直接放行（包括 `unresolved` / `unknown_syntax`） | 不因外部路径、网络、写入、destructive 或 workspace 边界再次询问；仍受不可变 / 显式 deny 约束 |

三种模式都受不可变 deny 和进程能力限制约束。`auto` 不调用第二个 LLM 判断安全，也不接受模型在文本中自称“安全”。

`full-access` 的确切含义是：

```text
取消 OmniFlow 的 workspace 文件系统边界
保留当前操作系统用户权限
仅保留不可变 deny（detached / interactive / privilege_escalation）与显式 deny
继续执行输入规范化、binding / preflight、超时和进程终止约束
```

这与 Codex 的 `danger-full-access` 语义一致：sandbox 与 approval 独立，解析失败不是普通命令的永久禁门。

## 7. Prepare 与执行生命周期

每次 `shell.run` 都必须按以下顺序处理：

1. Registry 按严格 Schema 校验原始输入。
2. Orchestrator 从 Run snapshot 取得权限模式和 Provider snapshot。
3. main 解析执行上下文、cwd、shell 类型和环境覆盖。
4. Analyzer 对原始命令生成 advisory assessment；不得改写命令。
5. Policy 根据模式、不可变 deny、规则和风险决定 `allow / ask / deny`。
6. 对需要确认的动作持久化 ToolRun 和精确 public action；用户确认后重新 prepare。
7. main 建立一次性 execution lease，并复验 command bytes、command hash、Provider、cwd、环境和 context identity。
8. Process Supervisor 以绝对 executable + 固定 argv、`shell: false` 启动 Provider；Provider 再用原生 `-c` / `-Command` 解释完整命令。
9. stdout / stderr 增量解码、清洗、脱敏并写入有界 LogStore；进程诊断采集与模型源都采用固定字节数、固定对象数的 head / tail 缓冲，尾部回收不依赖数组头部搬移；模型和 renderer 只收到各自有界的 head / tail 摘要与 opaque `logRef`。
10. 正常退出、非零退出、取消、超时和终止不完整都生成明确终态；业务 Tool 需要时再执行“再感知”。

准备、批准和 spawn 之间任一 command、cwd、Provider、环境、AI destination 或权限 revision 漂移，都必须废止旧动作，不能静默换目标继续运行。

## 8. Provider 与环境

### 8.1 Provider

- 模型最多请求 Shell 类型；实际 executable 由 main 探测、解析和冻结。
- macOS 首先支持系统 Zsh；Linux Bash、Windows PowerShell 在各自 Provider 和终止机制通过真实验收前保持不可用或开发预览。
- Provider 固定启动参数和编码策略，默认不加载用户 profile、alias 或 prompt hook，也不接受模型指定的 wrapper；raw command 显式执行 `source`、子解释器或其他初始化逻辑仍属于命令本身，必须由 Analyzer / Policy 按实际风险处理。
- V1 仍只支持前台、非交互命令；PTY、stdin、密码输入和 TUI 是独立版本。

### 8.2 Host 环境

host 默认继承主进程的必要宿主环境，以便发现 `ffmpeg`、`git` 和 `npm`，但必须：

- 过滤 API key、token、cookie、password、credential 和 secret 类变量。
- 禁止模型覆盖 `PATH`、`HOME`、临时目录、动态加载器和 Shell 初始化变量；`HTTP_PROXY` / `HTTPS_PROXY` 等代理变量当前没有独立的 protected / deny 分类，仍按通用环境变量名称、大小和控制字符校验处理（显式 override 另经过敏感内容检查），不能把它们描述成已被单独阻断。
- 不把 AI Service key 注入 Shell 子进程。
- 对显式 env override 做大小、名称、敏感性和身份 hash 校验。
- 将环境 fingerprint 绑定到 prepared action；环境改变后重新 prepare。

## 9. Shell 与结构化 Tool 的决策规则

```text
查看用户明确指定的本机文件或环境 -> shell.run
列出当前资料库节点         -> file.list / file.stat
执行 ffmpeg / git / npm   -> shell.run
原样本机文件入资料库      -> file.upload
需要修改或转换后入库      -> file.stage -> shell.run -> file.publish
目录创建、资料库提交      -> 结构化业务 Tool
```

不能因为 Shell 能够调用 HTTP、文件系统或数据库 CLI，就把资料库事务改为不可审计的命令字符串。结构化 Tool 提供稳定 Schema、owner 校验、事务状态、再感知和恢复语义；Shell 提供宿主机的开放能力。

## 10. 输出、恢复与安全边界

- 保留当前 LogStore 的有界 tail、详细日志引用、UTF-8 解码、ANSI / OSC 清洗、脱敏、TTL 和配额。
- 完整日志不直接塞入模型上下文；模型按需读取有界分页或摘要。
- 普通 Tool result 的 provider 投影目标约为 `1,024 tokens`；必须完整承载说明的 `skill.activate` 使用约 `10,000 tokens` 且禁止截断；`shell.run` 从最多 `160,000` UTF-8 bytes 的安全 head + tail 源生成最高约 `40,000 tokens` 的独立投影，并继续受真实 continuation 空间约束。规范 Tool result 受 `100,000` JSON 字符硬门禁，Shell 在此前自适应收口到约 `90,000` JSON 字符；provider 二次 byte / token 投影重新计算实际 `omittedBytes`。预算只按 canonical Tool 名选择。
- 后续 turn 接近窗口时，只把连续、完整、已经被模型消费且允许压缩的旧 Tool 回合批量生成严格 JSON 语义摘要；摘要使用低权限 envelope 和不可由用户文字伪造的内部 provenance，先在 `messages / toolResults` 副本 staging，全部成功后才原子提交。`skill.activate`、不完整回合和默认保留的最新 Tool result 不参与压缩，SQLite canonical result、renderer 投影与详细日志保持不变。
- OpenAI-compatible 与 Claude 返回的实际 usage 用于校准当前 Run 后续请求：只累计本地估算相对实际 input tokens 的最大正向低估量；未返回 usage 时继续使用字符估算。结构化 context overflow 明确失败当前 Run，不新建 Run、不重放已经执行的 Tool，也不自动重试同一 provider turn。
- Run 不设置固定 provider turn 或 Tool 次数上限；main 在最近 24 轮稳定摘要中检测长度 `1..8` 的调用 / 结果周期，同一周期连续重复 3 次才按无进展停止，周期任一内容变化即不匹配。普通 Tool 保留业务 revision / 时间语义，只有 `shell.run` 的 `result.data` 顶层 execution transport 元数据不参与摘要。
- 页面卸载不能隐式杀掉宿主命令；Run 停止、注销和应用退出必须显式取消并等待 supervisor 收口。
- 应用重启后，未完成的 ToolRun 标记为 interrupted，不能自动重放可能有副作用的 Shell 命令。
- `shell.run`、lease、hash、cwd 检查和 host binding 都不是 OS sandbox。没有 Seatbelt、Job Object、namespace 或等价隔离时，不能承诺阻止同一用户权限下的 daemon、计划任务、GUI 或其他脱离行为。
- Shell 结果、错误和日志投影不得泄露物理控制目录、完整环境、凭据或不必要的本机路径。

## 11. 迁移顺序

### Phase 0：契约冻结（已完成）

- 明确 host / run-workspace 判别联合。
- 明确 full-access 不再因 unknown analyzer 结果硬拒绝。
- 明确当前事实是 macOS 开发预览，Windows / Linux 不提前宣称完成。

### Phase 1：macOS host V1（开发预览：核心链已落地）

- shared prepared action、lease、binding、preflight 和 Runtime 已增加 `host` / `run-workspace` 分支。
- Analyzer assessment 已与执行上下文分离；`full-access` 下任何未命中不可变 / 显式 deny 的 assessment（包括普通 unknown、`unresolved` 和高影响分面）都不会仅因无法解析而硬拒绝，风险字段和审计仍保留。
- 已实现真实 host cwd、realpath / stat identity、过滤后的完整主进程环境和可发现本机 CLI 的 PATH 合并。
- 已复用 Supervisor、LogStore、ToolRun、取消和恢复链；host action 不进入 workspace manifest、虚拟配额或 cleanup 生命周期。
- 当前自动化已覆盖 spawn 前的 host 集成链：相对冻结 cwd、宿主 PATH 与普通环境继承、敏感环境过滤、`full-access` 未知命令放行、workspace Store 零调用，以及 lease 消费后 cwd 被替换时的 preflight fail-closed；另有 macOS-only smoke 通过真实 `/bin/zsh`、Runtime、Supervisor 与 LogStore 执行 PATH 中的临时 fixture CLI，验证 canonical cwd、子进程 PATH / 普通环境 / 显式 env、敏感环境缺失、stdout 投影和进程收口。管道 / 重定向、超时 / 取消 / 进程树与孤儿清理、真实应用会话和 macOS 安装包行为仍需真实执行验收。

### Phase 2：权限与深度防御

- 冻结不可变 deny、危险命令策略和 UI 说明。
- 视平台能力增加 Seatbelt、namespace、Job Object 或更严格的 child-process 监控。
- 评估可撤销 Session / 资料库规则；规则不能由记忆、Skill 或模型文本生成。

### Phase 3：Windows / Linux

- Windows PowerShell 编码、真实 cwd、Job Object 和安装包验收。
- Linux Bash 进程组、sandbox provider 和真实安装包验收。
- 各平台分别通过验收后再修改跨平台能力声明。

### Phase 4：独立交互能力

- PTY、stdin、终端 resize、密码和 TUI。
- 后台 Job、重启恢复和用户可见的长期进程会话。

这些能力不应通过给 V1 Shell 增加几个布尔字段临时拼接。

## 12. 验证门禁

自动化至少覆盖：

- 未知普通命令及其他未命中不可变 / 显式 deny 的 unresolved assessment 在 `full-access` 下可以进入 macOS host 执行链；`ask` / `auto` 仍按策略询问或拒绝。当前实现不会仅因 `unresolved` 或 destructive / system_configuration 等高影响分面继续拒绝。
- host cwd 不会进入 workspace cleanup、manifest 或虚拟 quota 路径。
- host 使用真实 PATH 能发现本机 CLI；敏感环境变量不会进入子进程。
- command bytes、cwd、Provider、环境和权限 snapshot 任一漂移都会废止批准。
- 管道、重定向、条件、多行命令和 Unicode 不被错误改写。
- 输出洪泛、UTF-8 跨 chunk、超时、取消、普通子进程和日志恢复都有确定终态。
- Shell 产生的文件只有通过结构化 publish / upload Tool 才进入资料库。
- 应用重启不会自动重放未完成副作用。

真实平台验收先以 macOS 为主；Windows / Linux 未完成对应 Provider 和进程终止验收前，不能在发布说明中写成稳定 host Shell。

## 13. 当前差异表

| 能力 | 当前代码 | 本文目标 |
| --- | --- | --- |
| 命令范围 | macOS host 接受完整命令字符串；Analyzer 提供风险 assessment，无法完整分析的能力由权限模式处理 | 保持原生 Shell 语义，Analyzer 不改写命令 |
| `full-access` | macOS host 对未命中不可变 / 显式 deny 的 assessment 直接 allow，包括普通 unknown、`unresolved` 和高影响分面；不可变 deny 与环境输入校验仍生效 | 如需对更多高影响分面确认，升级 Policy 并补齐深度防御 |
| cwd | `run-workspace` 使用虚拟逻辑 cwd；macOS `host` 使用 main 冻结并在 spawn 前复验的真实 cwd | 各平台独立实现同一判别联合 |
| 环境 | workspace 使用虚拟 `HOME` / `TMP` / 受控 `PATH`；macOS host 继承过滤后的主进程环境并合并 Provider PATH | Windows / Linux 完成各自环境策略后再扩展 |
| 平台 | macOS 系统 Zsh 可执行并处于开发预览；Linux Bash、Windows PowerShell 保持 `executionReady: false` | 分别完成 Linux / Windows Provider、终止和安装包验收 |
| 进程层 | Supervisor、lease、spawn preflight、Runtime 和 LogStore 已复用 host binding | 继续补齐平台 containment 和真实验收 |
| 业务操作 | 结构化 Tool 已有 | 继续与 Shell 并列，不互相替代 |

## 14. 维护规则

- 本文描述 host execution 的契约、当前 macOS 开发预览事实和迁移决策；新增实现事实必须同步回 `built-in-agent-shell-architecture.md`。
- 新增字段、IPC、Provider、权限模式或日志行为前，先更新本文和对应验证矩阵。
- 不以“再增加一个支持命令”解决 raw Shell 问题；如果命令难以分析，应改善风险评估或明确询问策略。
- 不把准备快照、hash、租约或提示词写成 OS 隔离保证。
- 不让 renderer、Skill、记忆或模型文本获得宿主执行权限。
- 本地旧的 prepared action / 未完成 Run 可以按产品策略丢弃，不为历史数据制造兼容分支；但新的 action 判别联合、持久化字段和恢复语义必须保持单一来源。
- host mode 的 macOS 开发预览已经落地；只有在 Linux / Windows Provider、进程终止、持久规则门禁和各平台安装包验收完成后，才能把状态升级为稳定跨平台能力。
