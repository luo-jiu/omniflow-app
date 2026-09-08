# Agent 模型执行适配

更新时间：2026-09-08

## 当前实现

模型目录不只用于显示名称。Agent 在 Run 启动时把本地模型配置、经过白名单校验的服务端元数据和现有工具注册表合成为不可变适配快照，实际用于提示词、请求参数、工具和 Skill 可见性。适配 identity 进入 Run capability identity，续接与副作用前预算使用同一份适配提示词，不在 Run 中途刷新模型策略。

实现入口：`agent-model-profiles.ts`、`agent-model-adapter.ts`、`agent-model-context.ts`。预算仍自动解析，不恢复 renderer 的手动窗口设置。

## 本地可信配置

OpenAI 推理模型的窗口与并行调用默认值参考本地 Codex 源码 `4b0d9669cc`（2026-09-08）的 models-manager/models.json，包含 gpt-6-astra 等精确 ID。它们是客户端默认值，不证明相同名称的中转模型具有相同服务规格。

模型匹配同时检查 Provider 类型；只允许精确 ID 和明确日期后缀，不用宽泛前缀把自定义别名归类成官方模型。其他已列出的 OpenAI、Claude 和 DeepSeek 配置为应用维护的协议适配，不凭空补写未知上下文规格。

| 配置类别 | 当前行为 |
|---|---|
| 本地目录中的 OpenAI 推理模型 | 保留 low/medium/high reasoning_effort；可提出批量工具调用，实际执行仍由运行时控制 |
| GPT-4o / GPT-4.1 已列出变体 | 不发送 reasoning_effort |
| Claude Opus / Sonnet 4.6 | effort 使用 output_config |
| 已列出的旧 Claude 路由 | 不发送尚未适配的 effort 字段 |
| deepseek-chat | 不发送 reasoning_effort |
| deepseek-reasoner | 当前适配器没有往返 reasoning_content 的工具续接契约，保守采用纯文本模式；不是宣称模型本身永远不支持工具 |
| 未知模型 / 自定义别名 | 保持现有 Provider 协议回退，不注入猜测的模型专用提示词；仍保留显式工具协议拒绝后的降级机制 |

模型特定指令是本地维护的简短使用提示，不复制 Codex 整份系统提示词，不替代 OmniFlow 的业务、安全、资源范围和权限规则。当前请求只支持文本消息、已有 JSON Tool 协议与现有推理档位；不会因目录声明视觉、code mode、补丁语法或更高推理档位就自动开启未实现的能力。

## 服务端元数据边界

沿用按 Provider、Base URL、凭据摘要隔离的目录缓存。继续接受经过数值校验的上下文和输出上限，新增以下白名单：

- `supports_tool_calling`：严格布尔值。
- `supports_parallel_tool_calls`：严格布尔值。
- `shell_type=disabled`：只用于禁用 Shell，不解释其他工具实现类型。
- `supported_reasoning_levels`：最多 16 项的受控档位字符串或 effort 对象，只与当前支持的 low/medium/high 取交集；空数组明确不发送 effort，非法列表忽略。

这些字段可以收窄本地适配，不能授予新工具、放宽权限或开启未实现协议。true 不会覆盖本地的工具禁用限制。base_instructions、model_messages、任意 tool schema、可执行代码或远端提示词全部忽略。没有这些扩展字段的普通兼容 `/models` 仍可使用本地配置或协议回退。

## 请求与执行

- Run 在启动前只解析一次元数据和适配。无法发送的推理档位规范化为 auto，Run 记录有效值，不把不支持的字段继续传给供应商。
- OpenAI-compatible 路由使用现有 chat/completions 和函数工具编码，Claude 使用现有 messages / tool_use / tool_result 编码；不新增或推测 Responses、code mode 等传输能力。
- 并行调用字段只在有工具且适配有明确值时发送；Claude 的关闭并行采用 tool_choice.disable_parallel_tool_use。模型允许一轮产生多个调用，不代表运行时已经并行执行命令，当前执行顺序与既有副作用防护保持不变。
- 模型限制通过每个 Run 的 Tool snapshot 包装器应用，不修改全局注册表。查询、验证、执行和 main preparation 签发入口都不能访问被排除的工具；依赖缺失必需工具的 Skill 一并隐藏。
- 工具完全禁用时，不发送业务工具或计划工具。即使供应商仍返回工具调用，main 也拒绝执行。协议兼容降级不等于授予原工具权限。
- main 的权限模式、owner、资料库、一次性执行绑定和源文件授权继续独立生效。模型适配不是权限来源。

## 界面与剩余边界

本轮不改模型选择器的数据来源，不把内置目录全部显示成“当前账号可用”。Composer 的推理档位 UI、模型能力来源展示、自定义模型配置编辑、真实多供应商验证尚未扩展；当前不支持的档位只在启动时规范化。辅助摘要和其他非 Agent AI 工作流仍沿用各自的协议适配。

真实供应商可能重映射模型 ID、缺少能力元数据或不支持某些兼容字段。自动化不能替代每条真实路由的验收，不能将本地目录视为供应商最新规格承诺。

## 验证

自动化覆盖精确 / 日期 ID、跨 Provider 和自定义别名回退、Astra 窗口默认值、OpenAI / Claude / DeepSeek 参数差异、远端提示词丢弃、负向能力收窄、不可变快照、全局工具不受影响、禁用工具无法执行、无工具模式直接回答，以及工具续接不重新解析元数据。

自动化检查：1,958 项测试通过、7 项跳过，lint、TypeScript、完整构建及源码 diff 检查通过。当前完成的是第四步基础适配层，不等于已验收全部模型和扩展协议。

解锁后真实验收：在同一 OpenAI-compatible 服务配置和非第一个 win 资料库中，gpt-5.5 / medium 完成 glob、三页正文续搜及库内正文搜索；gpt-6-astra / medium 完成三次 limit=1 的正文续读。两条 Run 均 completed、工具目录 revision 相同、capability identity 不同，所有工具成功，没有 Shell 调用、写入或重复授权。测试结束恢复 gpt-5.5 / medium，未修改账号、Key 或付费配置。本轮只验证当前中转服务的两条模型名路由，不证明底层模型身份；Claude、DeepSeek、其他档位和供应商限制的真实行为仍待验收，冻结与禁用分支由自动化覆盖。
