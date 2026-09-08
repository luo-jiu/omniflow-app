# 内置 Agent 编码工具能力评估

更新时间：2026-09-03

状态：**调研完成；`apply_patch` 尚未实现，本文不得作为已完成功能说明。**

适用范围：

- `electron/service/agent/`
- `src/shared/agent/`
- `src/features/agent/`
- 内置 Agent 的 Tool 注册、模型提示词和宿主机代码操作能力

本文记录 OmniFlow 内置 Agent 与 Codex 编码工具形态的对照结论。Shell 的完整安全、权限、工作区、日志和宿主执行契约仍分别以 [`built-in-agent-shell-architecture.md`](./built-in-agent-shell-architecture.md) 与 [`built-in-agent-host-execution-contract.md`](./built-in-agent-host-execution-contract.md) 为准。

## 1. 结论

OmniFlow 当前已经拥有 Code Agent 的原生 Shell 执行基础，但尚未拥有 Codex 风格的专用代码修改 Tool。

| 能力 | 当前状态 | 实际入口 |
| --- | --- | --- |
| 使用 `rg` / `sed` / `cat` 搜索和读取代码 | 已支持 | `shell.run` |
| 使用本机编译器、测试命令和 Git | 已支持 | `shell.run` |
| 管道、重定向、条件命令和 heredoc | 已支持 | `shell.run` |
| 使用结构化 `apply_patch` 创建、修改或删除文件 | 未实现 | 当前没有生产 Tool |
| 生成结构化文件差异并形成专用修改审计 | 未实现 | Shell 结果不能替代 Patch 结果 |

因此，当前模型可以完成下面的工作流：

```text
Shell 搜索 / 读取
  -> Shell 写入或运行生成器
  -> Shell 编译 / 测试
  -> Shell 执行 Git 检查
```

但还不能稳定形成目标工作流：

```text
rg 搜索
  -> sed / cat 定位上下文
  -> apply_patch 进行结构化修改
  -> Shell 格式化、编译、测试和 Git 检查
```

模型当前使用 `cat > file <<'EOF'` 创建或覆盖文件，不应只归因于模型习惯。只要本轮没有暴露独立的 Patch Tool，Shell 就是模型唯一可靠的通用写入通道。

## 2. 当前 OmniFlow 事实

### 2.1 Shell 是完整命令执行能力

`electron/service/agent/tools/shell-run-tool.ts` 注册 `shell.run`，接受完整非交互式命令，并显式区分：

- `run-workspace`：使用当前 Run 的隔离工作区。
- `host`：使用当前 macOS 用户的真实宿主环境。

当前 Tool schema 接受命令、cwd、执行上下文、非敏感环境覆盖、Provider 和 timeout。Shell 语法、管道、重定向、条件命令和本机普通 CLI 不是固定白名单。

因此，只要目标 CLI 已经安装且当前权限模式允许，模型可以使用：

```text
rg / sed / cat / head / tail / stat
git / npm / pnpm / node / python / go / cargo
编译器、测试工具、格式化器及其他非交互式 CLI
```

macOS Zsh 当前仍属于开发预览。Linux Bash 与 Windows PowerShell 尚未进入 execution-ready 状态，不能把上述能力描述为稳定跨平台功能。

### 2.2 当前没有生产级 `apply_patch`

当前生产 Tool 的主要来源是：

- `agent-orchestrator.ts` 注册内置读取、交互、记忆、媒体和目录 Tool。
- `agent-shell-service-runtime.ts` 在 Shell Provider 可执行时动态注册 `shell.run`、`file.stage`、`file.publish` 和 `file.upload`。
- Skill runtime 注册 `skill.activate` 控制 Tool。
- `agent.plan.set` 是 Orchestrator 持有的 provider 控制调用，不是文件修改 Tool。

当前代码没有注册名为 `apply_patch` 的生产 Tool，也没有对应的 Patch parser、main-owned Patch executor、prepared action、结果投影或专用展示协议。

即使某台开发机的 `PATH` 偶然存在名为 `apply_patch` 的可执行文件，也只能被视为宿主 Shell 的环境偶然性，不能算作 OmniFlow 产品能力。它不会自动获得稳定 Tool schema、跨 Provider 行为、main 权限绑定、结构化差异、持久化事实和 UI 投影。

### 2.3 当前提示词已经存在部分 Tool 路由

`electron/service/agent/agent-prompt-assembler.ts` 已经明确：

- 领域 Tool 优先于通用 Shell。
- 明确宿主绝对路径的查看和概括直接使用 `shell.run`，不先暂存。
- 需要工作副本、转换或生成时使用 `file.stage -> shell.run -> file.publish`。
- 无加工的本机文件入库使用 `file.upload`。

这些规则解决的是“宿主文件、Run 工作区与 OmniFlow 资料库”之间的路由，不是代码编辑工具优先级。当前提示词没有把“搜索、读取、手工修改、机械生成、验证”进一步拆成编码工作流。

## 3. Codex 对照结论

本次对照基于本地 Codex 源码快照 `a9519cbcdd2d`，升级参考仓库后需要重新核对。

Codex 将 Shell 和 Apply Patch 建模为两种不同能力：

- `codex-rs/core/src/tools/handlers/shell_spec.rs` 注册 `exec_command`，负责终端命令与持续进程会话。
- `codex-rs/core/src/tools/handlers/apply_patch_spec.rs` 注册独立的 `apply_patch` freeform Tool，并用 grammar 约束 Patch 输入。
- `codex-rs/core/src/tools/spec_plan.rs` 根据模型与执行环境能力决定是否把 `apply_patch` 暴露给当前 turn。
- 模型提示词明确要求搜索优先使用 `rg` / `rg --files`，并要求普通文件编辑优先使用 `apply_patch`。

Codex 同时保留例外：自动生成文件、格式化器输出和适合批量脚本处理的机械改动不要求强行使用 Patch。

官方 OpenAI 文档也把两者定义为不同 Tool：

- [Shell](https://developers.openai.com/api/docs/guides/tools-shell)：让模型在托管容器或应用自己的本地 runtime 中执行命令。
- [Apply Patch](https://developers.openai.com/api/docs/guides/tools-apply-patch)：让模型用结构化 diff 创建、更新和删除代码文件。

## 4. Tool 选择优先级如何形成

Tool 优先级不是 LLM 内部固定不变的命令表，而是由以下层次共同形成：

1. **能力注册**：当前 Run 实际暴露了哪些 Tool，决定模型“能不能调用”。
2. **名称、描述和 schema**：告诉模型每个 Tool 解决什么问题、需要哪些参数。
3. **system / developer 指令**：明确推荐顺序、例外和禁止路径。
4. **运行时权限与 Effective View**：决定某个 Tool 在当前平台、Run 和权限模式下是否真正可用。
5. **模型判断**：模型结合用户目标，在可见能力和规则中选择下一步。

只有描述而没有注册，模型无法真正调用 Tool；只有注册而没有清晰描述和路由规则，模型则可能选择能完成任务但不够稳定的路径。

Codex 的表现来自“专用 Tool + 明确提示词 + 执行与权限实现”的组合，不是仅靠一句“请优先使用 apply_patch”。

## 5. OmniFlow 的目标补齐方向

后续应增加一个正式的一等公民 Patch Tool，并继续复用现有 Agent 基建：

```text
模型
  -> Tool Registry / Run capability snapshot
  -> Patch schema 与 parser
  -> main-owned prepare / 权限判断
  -> 路径、文件身份与 Patch 复验
  -> Patch executor
  -> 结构化结果 / ToolRun / renderer-safe 投影
```

编码工具的建议路由是：

```text
搜索文本和文件       -> shell.run + rg / rg --files
读取局部或完整内容   -> shell.run + sed / cat
人工可审查代码修改   -> apply_patch
自动生成和格式化     -> shell.run + 项目生成器 / formatter
编译、测试、运行     -> shell.run
Git 状态与差异检查   -> shell.run + git
OmniFlow 资料库事务  -> 现有结构化业务 Tool
```

Patch Tool 不能直接绕过现有 Registry、Run snapshot、ToolRun、权限、审批、取消、持久化和 renderer 安全投影，也不能用“调用 Shell 中偶然存在的 apply_patch 命令”冒充正式实现。

## 6. 维护规则

- 本文记录调研结论与当前能力差异，不承担具体实现流水账。
- `apply_patch` 落地后必须同步更新本文状态、`built-in-agent-architecture.md` 的当前能力和对应验证矩阵。
- Provider、平台或 Codex 参考源码升级后，重新核对 Tool 暴露方式和提示词结论。
- 任何目标能力在代码、自动化和对应平台验收完成前，都必须明确写成“未实现”或“开发预览”。
