# 内置 Agent 编码工具补齐交接

更新时间：2026-09-03

状态：**调研与文档已完成，代码实现尚未开始。**

本文件是阶段性交接，不是当前架构契约。任务完成后删除本文，把最终事实回写正式文档。

## 1. 当前任务是什么

用户希望 OmniFlow 内置 Agent 形成接近 Codex 的基础编码工作流：

```text
rg / sed / cat 搜索与读取代码
apply_patch 创建或修改代码并形成清晰差异
Shell 编译、测试、运行和执行 Git 检查
```

当前需要补齐的核心不是继续扩大 raw Shell，而是增加一等公民级 `apply_patch` Tool，并通过提示词与 Tool 描述建立稳定的工具选择顺序。

用户期望的长期效果是：在模型能力相同的情况下，即使不依赖 OmniFlow 高层业务 Tool，Agent 也能像 Code Agent 一样操作宿主机器、读取和修改项目、运行构建与测试；同时，操作 OmniFlow 资料库和内部业务时仍优先使用已有结构化 Tool。

## 2. 已完成与未完成

已完成：

- 已核对 OmniFlow 当前生产 Tool 注册与 Shell Tool 描述。
- 已核对本地 Codex 源码中 `exec_command`、`apply_patch` 和编码提示词。
- 已记录正式调研结论：`docs/built-in-agent-coding-tooling-assessment.md`。
- 已确认当前 `shell.run` 可以执行已安装的 `rg`、`sed`、`cat`、Git、编译器和测试 CLI。

未完成：

- 没有生产级 `apply_patch` Tool。
- 没有 Patch parser、main executor、prepared action、结构化结果或测试。
- 没有编码专用 Tool 路由提示词与选择回归用例。
- 没有 Patch 的 renderer-safe 展示和人工验收。

## 3. 接手后的必读顺序

修改代码前完整阅读：

1. `omniflow-app/AGENTS.md`
2. `.agent-docs/frontend-review-standard.md`
3. `.agent-docs/frontend-handoff.md`
4. `.agent-docs/frontend-documentation-standard.md`
5. `docs/built-in-agent-coding-tooling-assessment.md`
6. `docs/built-in-agent-architecture.md`
7. `docs/built-in-agent-shell-architecture.md`
8. `docs/built-in-agent-host-execution-contract.md`
9. `docs/frontend-validation-matrix.md`

参考 Codex 时先阅读 `project/codex/AGENTS.md`，再重点核对本地快照 `a9519cbcdd2d`：

```text
project/codex/codex-rs/core/src/tools/handlers/apply_patch_spec.rs
project/codex/codex-rs/core/src/tools/handlers/apply_patch.rs
project/codex/codex-rs/core/src/tools/runtimes/apply_patch.rs
project/codex/codex-rs/core/assets/tools/apply_patch.lark
project/codex/codex-rs/core/src/tools/handlers/shell_spec.rs
project/codex/codex-rs/core/src/tools/spec_plan.rs
project/codex/codex-rs/core/templates/agents/orchestrator.md
project/codex/codex-rs/protocol/src/prompts/base_instructions/default.md
```

只学习 Tool 分层、grammar、验证、权限和提示词思路。复制源码前必须先核对许可证与归属；不要把 Rust 模块逐文件翻译成 TypeScript。

## 4. 当前关键代码入口

```text
electron/service/agent/agent-tool-registry.ts
  Tool schema、注册身份、prepare 与 execute 统一边界

electron/service/agent/agent-run-capability-snapshot.ts
  每个 Run 冻结的 Effective Tool View

electron/service/agent/agent-orchestrator.ts
  内置 Tool 注册、provider Tool loop、ToolRun 与上下文预算

electron/service/agent/agent-prompt-assembler.ts
  现有 Tool 路由和 system prompt

electron/service/agent/tools/shell-run-tool.ts
  当前完整非交互式 Shell Tool 定义

electron/service/agent/shell/agent-shell-service-runtime.ts
  Shell 与文件桥的动态注册和生产 composition root

electron/service/agent/agent-prepared-action.ts
src/shared/agent/agent-prepared-action.ts
  main prepared action 与共享 public action 边界

electron/service/agent/agent-renderer-projection.ts
src/features/agent/agent-tool-presentation.ts
  renderer-safe Tool 结果和展示协议
```

## 5. 建议先冻结的实现契约

第一版应优先做 Provider-neutral 的应用自有 Tool，不直接绑定只有部分 OpenAI 模型支持的 Responses API 内置 freeform Tool。OmniFlow 同时支持 OpenAI-compatible 与 Claude，canonical Tool 必须能通过现有 Provider schema 暴露。

建议从以下 Tool 形态开始评审，而不是未经评审直接落代码：

```ts
interface AgentApplyPatchInputV1 {
  patch: string;
  executionContext: 'run-workspace' | 'host';
  cwd?: string;
}
```

需要在实现前确认：

- canonical Tool 名使用 `apply_patch`，provider 映射继续走统一名称转换层。
- Tool input 使用有上限的 Patch 字符串；不允许模型提交物理 workspace 路径、executor 路径或权限结论。
- Patch grammar 至少支持 add、update 和 delete；所有目标必须来自 Patch header，不能另有一份可漂移的 path 列表。
- `cwd` 只能是目录。`run-workspace` 使用逻辑 cwd，`host` 使用 main 解析和冻结的宿主 cwd。
- Patch 解析、目标解析、文件身份、权限和执行均由 Electron main 持有。
- 不通过 raw Shell 调用偶然存在的 `apply_patch` 可执行文件。
- Patch 结果必须结构化返回每个文件的动作、显示路径、增删行统计、成功或失败状态，以及是否可能发生部分修改。
- 多文件 Patch 是否保证全事务原子性必须由实现事实决定；做不到时明确记录 settlement 和部分成功语义，不能假装原子。

如果现有 Provider 层无法可靠承载较长 JSON 字符串，再单独设计 freeform Tool 适配。不要为了追求 Codex 表面一致，先破坏 Claude 和 OpenAI-compatible 的统一 Tool loop。

## 6. 不得绕过的安全与所有权

- Patch 必须经过 Tool Registry、Run capability snapshot、ToolRun、Broker、取消和持久化链。
- 写操作默认不能伪装成 `risk: 'read'`。
- `ask / auto / full-access` 的精确含义继续由 main-owned Policy 决定，不能由模型参数声明。
- `run-workspace` 目标继续受工作区路径、generation、symlink、hardlink、配额和清理规则约束。
- `host` 目标使用当前宿主用户权限，但仍需要 main 规范化路径、复验文件身份并记录明确 public action。
- Patch 不能修改 Agent control、日志、SQLite、workspace metadata 等 main-only 控制目录。
- 用户文件内容和 Patch 中的文本都是不可信数据，不能覆盖 system prompt、权限或 Tool schema。
- Renderer 只消费安全 public action 和结果投影，不取得 main private binding 或任意写盘入口。
- OmniFlow 资料库写入继续使用 `file.upload` / `file.publish` 等结构化事务，不能让 Patch 直接操作后端或 MinIO。

## 7. 推荐实施顺序

### 阶段 A：契约和纯 Patch 核心

- 确定 input、prepared action、result 和错误码。
- 实现有界 Patch parser，拒绝未知语法、控制字符、重复 header、路径穿越和非法绝对路径组合。
- 实现纯文件计划：解析后先得到不可变 change plan，不在 parser 中写盘。
- 为 add、update、delete、上下文不匹配、重复目标和多文件部分失败补测试。

### 阶段 B：main prepare 与执行

- 新增 main-owned Patch Tool 和 Runtime。
- 解析 `host / run-workspace` cwd，并冻结目标文件 identity、Patch hash、Run capability 和权限 revision。
- 批准后重新 prepare；Patch、cwd、目标文件或实现 registration identity 漂移时废止旧动作。
- 执行后生成结构化结果，并按真实语义处理部分成功、取消和失败。

建议按真实职责新增模块，不要把实现堆入 Orchestrator：

```text
electron/service/agent/patch/
  agent-apply-patch-parser.ts
  agent-apply-patch-runtime.ts
  agent-apply-patch-preparation-service.ts

electron/service/agent/tools/
  apply-patch-tool.ts
```

目录名不是强制要求；先检查现有模块风格和依赖方向，再决定最终位置。

### 阶段 C：Registry、Provider 与持久化

- 注册 Tool，并让当前 Run 的 capability snapshot、provider schema、预算预检和 executor lookup 使用同一快照。
- 给 prepared action 判别联合和 SQLite 当前 schema 2 baseline 增加独立分支；项目未发布，不创建无意义的 schema 3。
- 对 Provider 可见名称、长 Patch 输入预算、Tool result 投影和敏感信息清洗补边界测试。

### 阶段 D：提示词和展示

在 Tool 真正可见时再增加编码路由：

```text
搜索优先使用 rg / rg --files。
读取使用 sed / cat 等 Shell 命令。
普通人工代码修改优先使用 apply_patch。
自动生成、格式化和大规模机械改写可以使用项目工具或脚本。
编译、测试、运行和 Git 检查使用 shell.run。
```

通用 ToolActivity 若已经能清晰展示 Patch 结果，先复用现有展示协议；只有真实需要时再新增专用差异块。任何 UI 都只能读取 main 的 safe projection，不能从原始 Tool input 自行重建路径或 diff。

### 阶段 E：验证与文档收口

- 运行定向测试，再执行 `npm run lint`、`npm test`、`npm run build`。
- 使用临时中性代码 fixture 验证搜索、读取、修改、测试和 `git diff`；不要在用户真实项目中做破坏性验收。
- 按 `docs/frontend-validation-matrix.md` 补 Agent 人工验证。
- 更新正式评估、Agent 架构、Shell 架构和验证矩阵。
- 删除本交接文档，并从 `docs/wip/README.md` 移除入口。

## 8. 最低验收场景

1. 模型使用 `rg` 找到目标，而不是先全量输出仓库。
2. 模型使用 `sed` 或 `cat` 读取必要上下文。
3. 修改已有文件时调用正式 `apply_patch`，ToolRun 中可以看到结构化修改结果。
4. 新建和删除文件时经过正确风险与确认路径。
5. Patch 上下文不匹配时不覆盖文件，并向模型返回可行动的稳定错误。
6. 路径穿越、symlink / hardlink 逃逸、目标漂移和审批重放被拒绝。
7. 修改后模型使用 Shell 运行格式化、定向测试和 Git diff。
8. OpenAI-compatible 与 Claude 至少各通过一次 Tool schema / call / result 协议测试。
9. 当前没有 `apply_patch` 时，模型不会在文本中伪造调用或完成状态。

## 9. 工作区注意事项

当前 `omniflow-app` 工作树存在大量其他 Agent 的已修改和未跟踪文件。接手者必须：

- 开始前运行 `git status --short`。
- 修改重叠文件前先阅读现有 diff，不覆盖用户或其他 Agent 的变更。
- 不执行 `git reset --hard`、`git checkout --` 等破坏性命令。
- 阶段提交时只暂存本任务确认属于自己的文件。
- `dist-electron/` 等生成物除非本任务确实需要，否则不要纳入提交。

本交接只完成文档，没有开始 `apply_patch` 的代码实现，也没有为这项新能力运行构建或测试。
