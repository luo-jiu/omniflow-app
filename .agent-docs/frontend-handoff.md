# OmniFlow App 前端交接索引

更新时间：2026-08-26

适用对象：继续维护 `omniflow-app` 前端、Electron 主进程、IPC、桌面交互和前端文档的开发者或 Coding Agent。

## 1. 当前结论

`omniflow-app` 是桌面工作区，不是普通网页。后续维护优先守住这 4 件事：

- 用户黑盒行为稳定
- API / IPC 契约稳定
- 状态 owner 单一
- Electron 宿主边界清楚

具体规则以 `AGENTS.md`、review 标准和专题文档为准。本文件只做索引，不重复正文。

## 2. 阅读顺序

开始动前端代码前，按下面顺序读：

1. `AGENTS.md`
2. `.agent-docs/frontend-review-standard.md`
3. `.agent-docs/frontend-documentation-standard.md`
4. `docs/frontend-architecture-baseline.md`
5. 按需补读专题：
   - `docs/current-deployment-topology.md`（云端、Tailscale、MinIO、打包或发布相关任务）
   - `docs/local-macos-signing-and-release.md`（个人签名、bootstrap、证书恢复与 macOS 发布）
   - `docs/embedded-browser-architecture.md`
   - `docs/library-detail-workspace.md`
   - `docs/built-in-agent-architecture.md`（Agent 执行、持久化、IPC 和安全事实）
   - `docs/built-in-agent-shell-architecture.md`（Agent raw Shell 的目标权限、平台、工作区和日志契约；非执行准备基座已落地，可执行 Tool 尚未注册）
   - `docs/built-in-agent-ui-contract.md`（Agent 工作区、状态投影和受控交互）
   - `docs/file-explorer-file-viewer-boundary.md`
   - `docs/built-in-type-and-archive-mode.md`
   - `docs/file-viewer-and-archive-viewer-map.md`
   - `docs/viewers/README.md`
   - `docs/frontend-validation-matrix.md`
   - `docs/cat-catch-full-migration-execution-plan.md`
   - `docs/cat-catch-migration-audit.md`

## 3. 入口地图

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
- Electron 平台策略：`electron/platform/`
- Renderer 平台入口：`src/platform/`

## 4. 当前重点专题

- 总体分层、状态 owner、IPC / Electron 边界：
  - `docs/frontend-architecture-baseline.md`
- 当前云端、Tailscale、多 MinIO 和发布方式：
  - `docs/current-deployment-topology.md`
- macOS / Windows 窗口策略、平台 bridge 和构建验证：
  - `docs/desktop-platform-architecture.md`
- macOS 个人签名、bootstrap 和后续发布：
  - `docs/local-macos-signing-and-release.md`
- Embedded Browser 生命周期、资源捕捉、下载导入：
  - `docs/embedded-browser-architecture.md`
- Cat Catch 全面重构、行为验证与完成定义：
  - `docs/cat-catch-full-migration-execution-plan.md`
- `library detail` 工作区模式、browser / file-viewer / search-home 切换：
  - `docs/library-detail-workspace.md`
- 内置 Agent 的执行、持久化、IPC、安全和 renderer UI 边界：
  - `docs/built-in-agent-architecture.md`
  - `docs/built-in-agent-shell-architecture.md`
  - `docs/built-in-agent-ui-contract.md`
- 文件树、文件打开、预览 tab、viewer 分发边界：
  - `docs/file-explorer-file-viewer-boundary.md`
- 内置类型、归档模式、目录树特殊语义：
  - `docs/built-in-type-and-archive-mode.md`
- viewer 与归档 viewer 映射：
  - `docs/file-viewer-and-archive-viewer-map.md`
- viewer 体系总入口与细分 viewer 文档：
  - `docs/viewers/README.md`
- 手工验证基线：
  - `docs/frontend-validation-matrix.md`

## 5. 高风险区域

后续改动时优先多看一遍、多测一遍的地方：

1. Embedded Browser：tab / view 生命周期、资源捕捉、下载与合并
2. `library detail`：工作区模式切换、缓存恢复、browser 与 file-viewer 的关系
3. 文件树与文件预览：树快照、文件打开、tab 复用、viewer 分发
4. 上传中心：任务状态机、取消、重试、并发
5. IPC / preload：payload 漂移、错误映射、bridge 发散
6. 主题与布局：标题栏安全区、浮层、分栏拖拽、原生 view 遮挡

## 6. 交付提醒

- 改代码前先补齐相关专题文档上下文。
- 改代码后先判断文档是否失真，再决定补哪一份。
- 交互改动按 `docs/frontend-validation-matrix.md` 记录已验证和未验证项。
