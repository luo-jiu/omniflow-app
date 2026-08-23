# OmniFlow App 前端架构基线

更新时间：2026-08-23

适用范围：`omniflow-app` 的 React renderer、Electron preload/main、页面分层、状态所有权、IPC 边界和前端文档维护。

## 1. 概述

`omniflow-app` 是 OmniFlow 的桌面客户端，当前主体由 `React + TypeScript + Vite + Electron` 组成。前端不是一个纯网页，而是一个带原生窗口、内置浏览器、文件系统、上传、资源捕捉和本地预览能力的桌面工作区。

主窗口由 Electron main 进程创建，当前最小窗口尺寸固定为 `1120 x 720`。这个下限用于保护目录树、工作区工具栏、文件预览、overlay 弹框等桌面布局不被压缩到不可用状态；后续调整最小尺寸必须同时验证 library detail、上传确认、属性弹窗和内置浏览器模式。

主窗口外壳的 `zoomFactor` 固定为 `1`。`Cmd/Ctrl` + `+/-/0` 由 Electron main 按当前宿主分流：已挂载的 embedded browser 优先缩放活动网页，其他工作区则把指令投影给文件 Viewer；不允许通过全局页面缩放改变 React 工具栏与原生 view bounds 的尺寸关系。

这份文档的目标不是重复代码目录，而是固定当前前端最重要的长期事实：

- 页面层、业务层、服务层和 Electron 宿主边界怎么分。
- 哪些状态属于全局，哪些状态只能由局部业务域拥有。
- Renderer 和 main 之间的能力入口应该收敛到哪里。
- 后续哪些改动必须回写文档，避免前端继续“自由发挥”。

## 2. 运行入口

当前入口链路：

```text
src/main.tsx
  -> App.tsx
    -> ThemeProvider(styled-components)
    -> HashRouter
    -> contexts/ThemeContext
    -> contexts/AuthContext
    -> features/user/preferences/UserPreferencesBootstrap
    -> layouts/MainLayout
    -> router/index.tsx
```

当前路由落点：

- `/login`
- `/libraries`
- `/libraries/:id`
- `/libraries/:id/recycle-bin`
- `/settings`
- `/settings/tags`
- `/settings/browser-file-mappings`
- `/upload-center`
- `/profile`

受保护路由以 `AuthContext` 完成 bootstrap 后的 `isLoggedIn` 为准，不直接把本地 token 当作 renderer 子树已经可挂载的信号。认证成功或本地会话恢复时，application/auth session runtime 必须先启动，再提交用户状态并挂载工作区；退出登录或 401 则先释放 runtime 和工作区，再清除认证投影。

当前主工作区重心在 `/libraries/:id`，它承载：

- 文件树浏览
- 文件预览
- 搜索工作区
- 内置浏览器
- 浏览器资源捕捉
- 工具工作区

React 18 兼容层：

- `vite.config.ts` 当前把裸 `react-dom` alias 到 `src/utils/react-dom-compat.ts`，只用于兼容第三方库仍调用 `ReactDOM.render` / `unmountComponentAtNode` 的旧入口。
- 应用自身入口继续从 `react-dom/client` 使用 `createRoot`；不要在业务代码里新增 `ReactDOM.render`。
- 修改该 alias 或兼容层后，dev 环境需要用 `npm run dev -- --force` 重建 Vite optimized deps，避免继续加载旧的 `node_modules/.vite/deps/chunk-*.js`。

Electron `userData`：

- 主进程默认继续使用历史目录 `omniflow-app`，保证普通启动能读到原有本地状态。
- 本地双开调试可通过环境变量 `OMNIFLOW_USER_DATA_SUFFIX` 指定隔离目录；例如 `stable` 会落到 `omniflow-app-stable`，避免 dev / stable 实例互相抢 IndexedDB、session、窗口状态和本地预览缓存。
- suffix 只允许字母、数字、下划线和短横线，其他字符会被替换为短横线。

## 3. 目录语义

当前目录分层以“页面编排”和“业务域”并存为主：

```text
views/               页面入口和页面级编排
features/            业务域逻辑、局部状态、业务组件
components/          通用 UI 与跨页面业务壳组件
contexts/            全局上下文
service/             HTTP / IPC 请求收口
modules/             已经抽成独立模型的复杂域
electron/            主进程、preload、IPC、原生能力
electron/platform/   主进程平台窗口和系统能力策略
src/platform/        renderer 平台识别和 DOM 平台标记
docs/                前端专题与架构文档
.agent-docs/         Agent 长期规范
```

当前建议按下面的方向理解，而不是按名字机械归类：

```text
views -> features -> components / hooks -> service / preload bridge -> electron main / backend
```

解释如下：

- `views/`
  - 负责页面级编排、路由落点、模式切换。
  - 可以组合多个 feature，但不应该承担底层通信细节。
- `features/`
  - 负责一个业务域的状态编排、交互逻辑和业务组件。
  - 例如 `embedded-browser`、`file-explorer`、`file-viewer`、`tag-management`。
- `components/`
  - `components/ui` 偏通用展示和交互壳。
  - `components/business` 允许带有限业务语义，但不要反向吞掉整块 feature。
- `service/`
  - 收敛 HTTP / IPC 请求封装、统一鉴权、错误映射和上传基础能力。
  - 不持有页面状态机，不直接操作页面交互。
- `modules/`
  - 用于已经明确需要“模型化”的复杂域。
  - 当前最典型的是 `modules/upload-center`，它已经有局部 README 和状态机边界。
- `electron/`
  - 负责窗口、浏览器视图、下载、会话、文件系统、资源捕捉、IPC 注册等宿主能力。
  - 不反向承担 renderer 页面编排。
- `electron/platform/`
  - 只收纳 macOS / Windows / Linux 的真实宿主差异，当前首先承载主窗口选项。
  - 共享窗口生命周期仍由 `electron/main.ts` 持有，不按平台复制。
- `src/platform/`
  - 是 renderer 读取宿主平台事实的唯一入口。
  - 应用启动时统一写入 `html[data-platform]`，页面和组件不自行解析 user agent。

## 4. 当前核心业务域

### 4.1 Library 工作区

`src/views/library/detail/` 是当前最复杂的页面工作区。当前至少包含 3 种显示模式：

- `search-home`
- `file-viewer`
- `browser`
- `tools`

对应状态定义位于：

- `src/features/library-workspace/workspace-state.ts`

旧 `src/views/library/detail/workspace-state.ts` 仅作为兼容 re-export 保留。

这里的 `LibraryDetailWorkspaceState` 是页面级工作区状态，而不是全局状态。它负责：

- 当前激活的浏览器 tab
- 浏览器输入框草稿
- 浏览器模式开关
- 搜索模式和搜索草稿
- 当前工作区展示模式

这类状态的 owner 应该继续留在页面工作区，不要下沉到通用组件，也不要直接塞到 Electron 层。

### 4.2 Embedded Browser

`features/embedded-browser` 是当前前端最重的宿主协同域之一，负责：

- 内置浏览器 tab 及工具栏交互
- 主进程 `WebContentsView` 的激活、导航和状态同步
- 下载事件与资源捕捉事件投影
- 当前页资源列表、深度捕捉、缓存捕捉、预览、导出与合并

这个域的特点是：

- UI 在 renderer。
- 真正的浏览器视图和资源管理在 Electron main。
- 能力通过 preload 暴露给 renderer。

因此它是最需要守住 IPC/Electron 边界的地方。

### 4.3 File Explorer / File Viewer

`features/file-explorer` 和 `features/file-viewer` 共同组成资源库的文件浏览与预览主链路。

职责建议：

- `file-explorer`
  - 目录树、路径定位、上传入口、外部导入、文件选择。
- `file-viewer`
  - 图片、视频、音频、PDF、归档等预览分发。
- `audio-viewer`
  - 裸音频、普通音乐文件夹和音频归档共用的播放器编排；实际出声、owner 和实时频率数据仍由 `file-viewer/services/global-audio-player.ts` 单例拥有。

不要把“文件树状态”和“预览器内部状态”做成双 source of truth。

### 4.4 Tools Workspace

`features/tool-workspace` 是工具域壳层，当前承载 `AI 服务配置`、`AI 字幕翻译` 和媒体处理工具。

当前边界：

- `library detail` 页面只拥有“是否进入 tools 模式”的状态。
- 工具内部草稿、任务模型选择和字幕工作台状态由 `features/tool-workspace` 持有。
- 本机 AI 服务档案、provider 协议适配和加密 API Key 由 Electron main 持有；`features/ai-services` 常态只持有安全投影，进入单个已有档案的编辑页后才短暂持有该档案的明文编辑草稿。
- 目录树当前选中节点只做只读透传，不在页面层复制一份树结构事实。

专题说明见：

- `docs/tools-workspace.md`
- `docs/ai-service-architecture.md`

### 4.4 Upload Center

`modules/upload-center` 是当前前端里少数已经有明确模型边界的模块。局部规则见：

- `src/modules/upload-center/README.md`

当前结论：

- 单任务状态机在 `model/`
- 任务集合管理在 `store`
- 并发上传与取消/重试在 `engine`

后续前端其他复杂域如果要做长期治理，可以优先参考它这种拆分方式，而不是继续把所有状态和副作用都留在一个页面组件里。

## 5. 状态所有权基线

前端后续演进必须优先回答“谁拥有状态”。

当前推荐按下面 4 层理解：

### 5.1 全局状态

只放真正跨页面、跨业务域都需要共享的状态：

- 认证状态：`contexts/AuthContext`
- 主题状态：`contexts/ThemeContext`
- 用户偏好初始化：`features/user/preferences`
  - `UserPreferencesBootstrap` 继续投影历史 `users.ext` 偏好。
  - `SyncedUserPreferencesProvider` 是 `user_preferences` 命名空间数据的应用级 owner，负责登录后加载、optimistic 投影、串行保存和账号切换清理。
  - 跨设备偏好以数据库为事实来源；本地目录、窗口坐标和缓存路径等设备事实不得进入同步 provider。

全局状态不要继续膨胀成“万能桶”。如果一个状态只在某个页面或某个 feature 内有效，就不要先放全局。

### 5.2 页面工作区状态

由页面 owner 持有，典型是 library detail 工作区：

- 当前模式
- 当前激活 tab
- 当前页草稿输入
- 当前页选择和展开态
- 当前正在播放的媒体注册表（`MediaRegistry`，库维度，由各 audio/video viewer 注册自身，详见 `docs/library-detail-workspace.md` §11）

这类状态可以缓存，但缓存只是恢复手段，不应变成第二份权威数据。

### 5.3 业务域状态

由 feature 或 module 持有：

- 资源捕捉列表
- 上传任务
- 文件树快照
- 浏览器下载导入状态
- AI 服务的 renderer 安全投影

同一份业务事实不要同时保存在页面、feature、本地 ref 和 Electron 投影里，除非能明确说明“哪份是真实 owner，其他只是派生”。

### 5.4 宿主状态

由 Electron main 或原生资源拥有：

- `WebContentsView`
- 浏览器 session / download item
- 本地文件打开和保存对话框
- 本机 AI 服务档案和加密 API Key
- 资源捕捉 probe 安装状态

Renderer 只能持有这些状态的投影，不要把 main 的内部结构当成 renderer 可直接依赖的数据模型。

## 6. API / IPC / Electron 边界

### 6.1 HTTP 请求

当前请求层入口在：

- `src/service/request/apiRequest.ts`
- `src/service/request/ipcRequest.ts`

当前事实：

- 鉴权头和统一错误处理已经在请求层收口。
- 登录态失效会在请求层触发清理并跳回登录页。
- `VITE_API_BASE_URL` 是 renderer 与 Electron HTTP 请求共享的 API 基址；未配置时回退到本机 `127.0.0.1:8850`。
- `VITE_STORAGE_ORIGINS` 声明客户端需要直连的 MinIO origin。Vite 会把 API、WebSocket 与这些存储 origin 统一注入 dev server 响应头和构建 HTML 的 CSP。
- 通过 Tailscale Serve 使用云端 Go 时，宿主系统本身必须加入对应 tailnet；仅运行用于 MinIO 入站转发的 Docker userspace sidecar，不会给宿主自动安装 tailnet 路由。

规则：

- 页面和组件不要重复实现鉴权、401 处理、统一错误语义。
- 新接口优先复用现有请求层，不要在页面里直接拼 `fetch`。
- 切换 API 或增加存储节点时同步维护环境变量，不在 `index.html`、`overlay.html` 或业务组件中硬编码部署地址。

### 6.2 Preload Bridge

当前 renderer 使用的原生能力主要通过下面 3 组桥接暴露：

- `window.electronAPI`
- `window.electronWindow`
- `window.electronEmbeddedBrowser`

其中 `window.electronWindow.platform` 是只读宿主平台事实，renderer 统一通过 `src/platform` 归一和消费，不直接在页面中读取。

对应实现位于：

- `electron/preload.ts`

规则：

- Renderer 不直接知道 main 里的内部 service 结构。
- 新增能力时先设计 preload 暴露面，再设计 renderer 的 service 包装。
- 页面和通用组件不要到处散落 `window.electronEmbeddedBrowser.*` 原始调用。

当前新增的通用文件桥接包括：

- 文本文件选择（支持自定义 filters）
- 文本文件写入
- 文本 staging 文件创建与清理

AI 服务使用独立的 `window.electronAIService` bridge，且 main 只接受主窗口 main frame 的调用。列表和修改响应只暴露 `hasApiKey`；模型列表与补全请求也通过该 bridge 进入主进程 provider 适配层。磁盘密文永不暴露；已保存 Key 的明文只允许在进入单个已有档案编辑页时通过 `revealApiKey(id)` 单次返回，并在取消或保存后从 renderer 草稿清除。批量 AI 任务通过 main 内存运行会话冻结连接快照，会话按 profile 和 renderer owner 隔离，生命周期内禁止编辑或删除来源档案；停止任务或 owner 销毁时由 main 取消该会话仍在执行的网络请求后释放配置锁。

内置 Agent 使用独立的 `window.electronAgent` bridge。Session 持久化由 Electron main 的 SQLite Store 独占，renderer 只持有当前投影；所有会话操作按 API 基址、数字用户 ID 和资料库 ID 共同隔离。每个 Agent Run 复用 AI Service 运行会话边界冻结连接并锁定来源配置，认证会话释放时由 workspace disposer 通过 bridge 取消当前窗口全部 Run。

### 6.3 Electron Main

主进程里的目录语义应保持：

- `electron/ipc/`：channel 注册
- `electron/service/`：窗口、浏览器、下载、文件、资源捕捉等宿主能力
- `electron/platform/`：主窗口和系统能力的平台策略

规则：

- main 负责宿主能力和资源生命周期。
- renderer 负责业务编排和显示反馈。
- 不要因为赶功能，把业务状态机直接搬到 main 里“顺手做掉”。

## 7. 文档地图

当前前端值得长期维护的文档：

- `.agent-docs/frontend-review-standard.md`
- `.agent-docs/frontend-handoff.md`
- `.agent-docs/frontend-documentation-standard.md`
- `docs/frontend-architecture-baseline.md`
- `docs/desktop-platform-architecture.md`
- `docs/embedded-browser-architecture.md`
- `docs/library-detail-workspace.md`
- `docs/file-explorer-file-viewer-boundary.md`
- `docs/frontend-validation-matrix.md`
- `docs/cat-catch-migration-audit.md`
- `src/modules/upload-center/README.md`

建议后续继续补的方向：

- `embedded-browser` 的 IPC / 生命周期文档
- library detail 工作区状态 owner 文档
- 文件树与文件预览的边界文档

## 8. 验证基线

常规前端改动至少执行：

```bash
npm run lint
npm test
npm run build
```

涉及下面任一领域时，除构建外还应补手工验证说明：

- 内置浏览器
- 资源捕捉与下载
- 目录树、拖拽、右键菜单
- 上传中心
- 主题、安全区、浮层

如果本次没有做代码，只做文档整理，也应该确认文档描述与当前代码事实一致。

## 9. 后续维护规则

出现以下变化时，必须回写本文：

- 路由入口或主工作区模式变化
- `views / features / service / electron` 的职责边界变化
- 新增全局状态层或跨页面状态 owner
- preload 暴露面或 IPC 组织方式变化
- 上传中心、内置浏览器、资源捕捉成为新的系统级核心域

这份文档不是为了限制重构，而是为了让重构有明确边界。  
如果未来前端要继续治理，优先做的是“固定真实边界”，不是先发明更多抽象名词。
