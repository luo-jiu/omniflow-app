# OmniFlow App Agent 规范

## 项目说明

`omniflow-app` 是 OmniFlow 的前端桌面客户端，基于 React、TypeScript、Vite 和 Electron。它负责文件库浏览、资源预览、上传、浏览器资源捕捉、书签与文件映射等桌面交互能力。

## 必读规则

凡是任务涉及 `omniflow-app`，包括前端代码、Electron、IPC、样式、构建、测试或文档，Agent **必须先阅读并严格遵守**：

```text
.agent-docs/frontend-review-standard.md
.agent-docs/frontend-handoff.md
.agent-docs/frontend-documentation-standard.md
```

## Review 必读规范

- 用户要求 review、代码审查、评审、检查改动、找风险时，必须先阅读并严格按 `.agent-docs/frontend-review-standard.md` 执行。
- Review 结论必须以 findings 为先，优先关注行为回归、状态双源、生命周期泄漏、热路径性能、Electron/IPC 边界、主题布局和验证缺口。
- 不得只做总结式 review；没有发现问题时，也必须明确写“未发现问题”，并说明残余风险或未验证项。
- 前端 review 中发现的通用规则缺口，应优先补充到 `.agent-docs/frontend-review-standard.md`，不要只写在一次性回复里。

## 文档要求

- 开发前先读相关文档和模块 README。
- 开发后必须评估是否需要新增或更新文档。
- 涉及 API/IPC 契约、Electron 边界、状态所有权、资源捕捉、上传、主题布局或关键交互时，必须同步更新相关文档。
- 如果判断不需要更新文档，最终回复中要简短说明原因。

详细写法见：`.agent-docs/frontend-documentation-standard.md`。

## 禁止事项

- 未阅读上述 `.agent-docs` 文档，不得修改 `omniflow-app` 下的任何代码或文档。
- 不得绕过前端规范修改 API/IPC 契约、状态所有权、Electron 边界、主题布局或验证门禁。
