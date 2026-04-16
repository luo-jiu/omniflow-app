# OmniFlow App 前端交接索引

更新时间：2026-04-15

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
   - `docs/embedded-browser-architecture.md`
   - `docs/library-detail-workspace.md`
   - `docs/file-explorer-file-viewer-boundary.md`
   - `docs/built-in-type-and-archive-mode.md`
   - `docs/file-viewer-and-archive-viewer-map.md`
   - `docs/viewers/README.md`
   - `docs/frontend-validation-matrix.md`
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

## 4. 当前重点专题

- 总体分层、状态 owner、IPC / Electron 边界：
  - `docs/frontend-architecture-baseline.md`
- Embedded Browser 生命周期、资源捕捉、下载导入：
  - `docs/embedded-browser-architecture.md`
- `library detail` 工作区模式、browser / file-viewer / search-home 切换：
  - `docs/library-detail-workspace.md`
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
