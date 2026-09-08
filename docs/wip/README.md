# docs/wip/ — 临时开发计划

这个目录里的文档**不是长期文档**。专门给"正在干 / 还没干完"的多步骤任务存计划用。

## 规则

- 只放过程性内容：roadmap、TODO、设计草稿、决策记录。
- 任务做完后**整文件删除**，相关结论按需回写正式文档（`docs/`、`docs/viewers/`、`.agent-docs/` 等）。
- 不要在 `AGENTS.md` 或正式专题文档里引用这里的内容；这里随时会消失。
- 一个任务一个文件，文件名用 `<topic>-roadmap.md` / `<topic>-notes.md` 这类自描述名。

## 当前文件

- `media-hub-roadmap.md` — 全局媒体控制中心后续迭代清单（基线版本已合入 main）。
- `file-type-identity-roadmap.md` — 文件类型身份识别终局规划草案。
- `resource-create-wizard-roadmap.md` — 资源创建向导规划草案。
- `resource-monitor-console-roadmap.md` — 资源监测控制台规划草案。
- `resource-monitor-dashboard-v2-roadmap.md` — 资源监测仪表盘 V2 改进规划草案。
- `system-workspace-roadmap.md` — 设置 / 上传 / 回收站等系统页面改成资料库工作区视图的规划草案。
- `built-in-agent-development-notes.md` — 内置 Agent 后续 Tool、向量检索和受控本地进程的历史讨论稿；已落地边界见 `docs/built-in-agent-architecture.md`，已批准但未实现的 raw Shell 见 `docs/built-in-agent-shell-architecture.md`，renderer UI 见 `docs/built-in-agent-ui-contract.md`。
- `built-in-agent-coding-tooling-handoff.md` — Codex 风格编码工具补齐的阶段性交接；当前已完成能力评估，下一步是实现正式 `apply_patch` Tool 与编码路由。
- `built-in-agent-skill-v1-design.md` — Claude Code / OpenCode 调研后形成的 Skill V1 历史决策与验收记录；代码、自动化和首条真实 provider / 媒体端到端路径已验收，当前事实以正式架构文档为准。
- `built-in-agent-skill-management-roadmap.md` — Skill V1 之上的 Capability 可用性、执行目标准备、本机启停和只读管理 UI 路线图。
