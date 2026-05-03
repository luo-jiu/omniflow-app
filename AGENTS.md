# OmniFlow App Agent 规范

## 项目说明

`omniflow-app` 是 OmniFlow 的前端桌面客户端，基于 React、TypeScript、Vite 和 Electron。项目核心目标是：在保持用户黑盒行为、API / IPC 契约、状态所有权和 Electron 边界稳定的前提下，持续沉淀清晰、可维护、可验证的前端能力。

### 入口

- 应用入口：`src/main.tsx`
- 根组件：`src/App.tsx`
- 路由：`src/router/`
- 页面：`src/views/`
- 业务域：`src/features/`
- 通用组件：`src/components/`
- 全局上下文：`src/contexts/`
- 请求封装：`src/service/request/`
- 上传中心：`src/modules/upload-center/`
- Electron preload：`electron/preload.ts`
- Electron 主进程能力：`electron/service/`

### 权威文档

`.agent-docs/`、`docs/` 和少量模块内 README 是本项目的**外部长期记忆**。Agent 在修改相关代码前必须优先查阅对应文档，不能只凭组件名、变量名或当前局部实现推断边界。

- 前端 review 标准：`.agent-docs/frontend-review-standard.md`
- 前端交接说明：`.agent-docs/frontend-handoff.md`
- 前端文档规范：`.agent-docs/frontend-documentation-standard.md`
- 前端架构基线：`docs/frontend-architecture-baseline.md`
- 显示与可读性基线：`docs/ui-display-readability-baseline.md`
- Embedded Browser 专题：`docs/embedded-browser-architecture.md`
- Cat Catch 总览与迁移地图：`docs/cat-catch-overview-and-migration-map.md`
- Cat Catch 同步维护指南：`docs/cat-catch-sync-maintenance-guide.md`
- Overlay 窗口专题与迁移规范：`docs/overlay-window-architecture.md`
- Library Detail 工作区专题：`docs/library-detail-workspace.md`
- 文件树与预览边界：`docs/file-explorer-file-viewer-boundary.md`
- 内置类型与归档模式：`docs/built-in-type-and-archive-mode.md`
- Viewer 映射专题：`docs/file-viewer-and-archive-viewer-map.md`
- Viewer 文档入口：`docs/viewers/README.md`
- 前端验证矩阵：`docs/frontend-validation-matrix.md`
- 资源捕捉迁移审计：`docs/cat-catch-migration-audit.md`
- 上传中心局部说明：`src/modules/upload-center/README.md`

## 项目规范

### Review 规范

- 用户要求 review、代码审查、评审、检查改动、找风险时，必须先阅读并严格按 `.agent-docs/frontend-review-standard.md` 执行。
- Review 结论必须以 findings 为先，优先关注行为回归、状态双源、生命周期泄漏、热路径性能、Electron / IPC 边界、主题布局和验证缺口。
- 不得只做总结式 review；没有发现问题时，也必须明确写“未发现问题”，并说明残余风险或未验证项。
- 前端 review 中发现的通用规则缺口，应优先补充到 `.agent-docs/frontend-review-standard.md`，不要只写在一次性回复里。

### 开发规范

- 开始修改 `omniflow-app` 代码或文档前，必须先阅读：
  1. `.agent-docs/frontend-review-standard.md`
  2. `.agent-docs/frontend-handoff.md`
  3. `.agent-docs/frontend-documentation-standard.md`
- 涉及整体分层、状态 owner、API / IPC、Electron、工作区模式、文件树 / 文件预览、embedded browser、资源捕捉、上传或验证时，必须继续查阅对应专题文档。
- 涉及字号、排版、控件密度、目录树宽度、工具栏高度、弹框观感、亮暗主题可见性时，必须先阅读 `docs/ui-display-readability-baseline.md`。
- 当前显示基线处于恢复 `100%` 页面缩放的迁移阶段；新页面和新模块必须先参考 `docs/ui-display-readability-baseline.md` 的最新结论，不能继续套用旧的 `16px` 最小字号硬规则。高频工作区控件允许使用更紧凑字号，但必须同时保证行高、截断、点击热区、主题对比度和 `Cmd/Ctrl+0` 下的可读性。
- 按当前前端依赖方向开发：

```text
views -> features -> components / hooks -> service / bridge -> backend or electron
```

- `views` 负责页面级编排、模式切换和路由落点，不承载底层通信细节。
- `features` 负责业务域状态编排和交互逻辑，不偷偷吞掉页面总控逻辑。
- `components/ui` 保持通用，不直接知道业务语义。
- `service` 收敛 HTTP、IPC、上传、认证头和错误映射，不反向拼页面状态机。
- `electron` 收敛窗口、浏览器视图、下载、文件系统、资源捕捉等宿主能力，不反向承担 renderer 页面编排。
- 不得在页面或通用组件中散落原始 IPC channel 名称或大面积直接调用 `window.electron*`。
- 优先小步、最小必要改造；不要为了“看起来整齐”扩大改动范围。

### 构建与验证规范

- 常规前端改动至少执行：

```bash
npm run lint
npm run build
```

- 涉及交互、工作区、文件树、文件预览、上传、embedded browser、资源捕捉、主题或布局时，必须按 `docs/frontend-validation-matrix.md` 补手工验证。
- 如果没有执行构建或手工验证，最终回复必须明确说明原因和未验证风险。

## 文档规范

> **重要提醒**：文档是 Coding Agent 的**外部长期记忆**。  
> 1. **开发前（Read）**：必须阅读相关文档，理解当前事实、边界和约束。  
> 2. **开发后（Write）**：必须评估是否需要创建或更新文档，让下一次维护不靠猜。

详细写法、目录归属和归档规则见：`.agent-docs/frontend-documentation-standard.md`。

出现以下任一情况时，必须更新相关文档：

- 新增或修改 API / IPC 契约、preload 暴露面、Electron 主进程能力
- 新增或修改状态 owner、工作区模式、资源捕捉、上传、文件树 / 文件预览边界
- 新增或修改主题、布局、安全区、浮层、拖拽交互
- 新增或修改构建、验证、发布方式

如果判断本次不需要更新文档，最终回复中要简短说明原因。

## 禁止事项

- 未阅读必读文档，不得修改 `omniflow-app` 下的任何代码或文档。
- 不得绕过前端规范修改 API / IPC 契约、状态所有权、Electron 边界、主题布局或验证门禁。
- 不得把工作区状态、文件预览状态、浏览器 tab 状态或资源捕捉状态做成多份 source of truth。
- 不得用项目 README 替代专题文档或规范文档。
