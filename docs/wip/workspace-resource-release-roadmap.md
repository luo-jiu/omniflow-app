# 工作区资源释放治理规划草案

更新时间：2026-05-12
状态：进行中（Phase 1 已落地，Phase 3 防写回基础已部分落地）

> 本文是 `docs/wip/` 下的临时开发计划。功能稳定后，应删除本文，并把最终契约回写到 `docs/library-detail-workspace.md`、`docs/file-explorer-file-viewer-boundary.md`、`docs/media-hub-contract.md`、`docs/embedded-browser-architecture.md` 和 `docs/frontend-validation-matrix.md`。

## 1. 背景

当前资料库详情页为了提供“切走再回来仍保留现场”的体验，存在多类跨页面存活的前端资源：

- 文件预览 tab 和 active file。
- 目录树展开状态、树节点 snapshot 和懒加载缓存。
- library detail 工作区状态，包括浏览器 tab、搜索草稿、工作区模式。
- Electron Embedded Browser 的 WebContentsView / 捕捉资源 / 下载导入状态。
- MediaHub、`globalAudioPlayer`、`floatingVideoService` 和全局 video element。
- viewer 内部阅读 / 播放 snapshot，例如 PDF、漫画、视频、音频归档、ASMR 等。
- 工具区和上传 / 迁移类任务状态。

这些资源不能简单依赖 React 组件卸载。普通路由切换时应保存现场；但退出登录、401 登录失效、右键释放仓库、删除仓库时，应显式释放对应 scope 内的资源。

当前问题：

- 退出登录只清认证信息，没有释放工作区资源。
- 资料库详情页卸载时会保存当前工作区状态，导致 logout 后再次进入仍恢复 tab 和目录树。
- 右键“释放工作区”只清理文件 tab cache、library detail workspace cache 和部分 browser tab，目录树 snapshot、MediaHub、全局媒体和部分 viewer snapshot 仍可能残留。
- 释放逻辑分散在页面里，后续新增跨页面资源时容易继续漏清。

## 2. 当前结论

采用统一资源释放层，而不是在各入口补一串 `clearXXX()`。

建议新增前端资源释放模块，负责两个层级：

| 层级 | 语义 | 典型入口 |
| --- | --- | --- |
| `disposeLibraryWorkspace(libraryId)` | 释放单个资料库工作区现场 | 仓库右键释放、删除仓库成功 |
| `disposeSessionWorkspaces()` | 释放当前登录会话的全部工作区现场 | 退出登录、401 登录失效 |

核心原则：

- 普通离开资料库详情页继续保存现场。
- 显式 dispose 时不保存现场。
- 会跨路由、跨组件、跨 renderer 组件生命周期存活的资源，都必须接入统一释放层。
- 页面只触发释放，不直接知道每一种资源的清理细节。
- 能按 `libraryId` 精确释放的资源优先 scoped release；无法可靠判定归属的模块在 session release 中全量释放。

## 3. 目标行为

### 3.1 退出登录

用户主动退出登录后：

- 清空认证信息。
- 关闭所有 Embedded Browser tab / view。
- 清空所有资料库详情工作区状态。
- 清空所有文件预览 tab cache。
- 清空所有目录树 snapshot / dirty marker。
- 清空 MediaHub 出声实体，停止音频 / 视频并释放全局媒体元素。
- 清空当前登录会话相关的 viewer 内存 snapshot。
- 导航到登录页后，不应再看到上一个用户留下的 tab、目录树展开、MediaHub、浏览器 view 或系统工作区现场。

### 3.2 401 登录失效

任意请求收到登录失效后：

- 行为应与退出登录一致。
- 不能只 `auth.clear()` 后跳 login。
- 释放过程失败不能阻塞跳转登录页，但需要尽量完成本地资源清理。

### 3.3 右键释放仓库工作区

用户在仓库页右键“释放工作区”后：

- 只释放目标 `libraryId` 的工作区资源。
- 清空目标资料库的文件 tab、目录树 snapshot、workspace state、system workspace 临时 tab。
- 关闭目标资料库登记过的 browser tab / view。
- 如果当前音频 / 视频属于该资料库，应停止并从 MediaHub 移除；其他资料库的媒体不受影响。
- 再进入该资料库，应从默认搜索 / 文件树初始状态开始。
- 不删除用户数据，不影响后端节点、文件、上传历史或存储对象。

### 3.4 删除仓库

删除仓库成功后：

- 自动执行 `disposeLibraryWorkspace(libraryId)`。
- 因目标资料库已不存在，所有 scoped cache 必须移除，不能留下可被同 id 恢复的旧现场。

## 4. 资源清单

### 4.1 第一批必须接入

| 资源 | 当前 owner | 释放要求 |
| --- | --- | --- |
| 文件预览 tab cache | `src/contexts/file-viewer-cache.ts` | 支持按 cacheKey 清、全量清 |
| library detail workspace cache | `src/features/library-workspace/workspace-state.ts` | 支持按 cacheKey 清、全量清 |
| 目录树 snapshot / dirty marker | `use-repository-tree/snapshot-store.ts` | 支持按 libraryId 清、全量清 |
| Embedded Browser view | `window.electronEmbeddedBrowser` | scoped release 关闭已登记 tab；session release 调 `closeAll()` |
| MediaHub audio | `globalAudioPlayer` | scoped release 按 `libraryId` 清；session release 全量 clear |
| MediaHub video | `floatingVideoService` | scoped release 按 `libraryId` dismiss；session release 全量 dismiss |
| 资料库详情卸载保存 | `src/views/library/detail/index.tsx` | 显式 dispose 时跳过 cleanup 保存 |
| auth logout / 401 跳转 | `AuthContext`、request service | 统一调用 session dispose |

### 4.2 第二批补齐

| 资源 | 当前 owner | 释放要求 |
| --- | --- | --- |
| PDF viewer snapshot | `pdf-viewer` 模块内 Map | 支持按 tab/cacheKey 或全量清 |
| Comic reader snapshot | `comic-viewer` / `comic-archive-viewer` | 支持按 cacheKey 前缀或全量清 |
| ASMR snapshot | `asmr-viewer` / `asmr-archive-viewer` | 支持按 cacheKey 前缀或全量清 |
| Audio archive snapshot | `audio-archive-viewer` | 支持按 cacheKey 前缀或全量清 |
| Video archive snapshot / progress | `video-archive-viewer`、`video-viewer` | 支持按 cacheKey 前缀或全量清 |
| pending media activation | `file-viewer-pending-activation.ts` | session release 清空；scoped release 清目标 library |
| 工具区状态 | `tool-workspace.state.ts` | scoped release 清目标 library 内存 cache，是否清 localStorage 需单独决策 |

第二批可在第一批稳定后接入。第一批先解决用户可见的 tab、目录树、browser view 和出声资源残留。

### 4.3 暂不处理

- 主题、语言、标签色调等用户偏好。
- 上传中心和迁移中心的历史任务记录。
- 浏览器密码、cookie、资源捕捉规则和外部工具配置。
- 后端数据、对象存储数据和数据库记录。

这些属于用户配置或业务数据，不应被“释放工作区”清掉。退出登录是否清 browser cookie 需要另设隐私策略，不纳入本次。

## 5. 设计边界

### 5.1 新模块边界

建议新增：

```text
src/features/workspace-resource-release/
```

职责：

- 统一暴露 `disposeLibraryWorkspace(libraryId, options?)`。
- 统一暴露 `disposeSessionWorkspaces(options?)`。
- 收敛各 cache / singleton / Electron bridge 的释放调用。
- 记录正在 dispose 的 library / session，用于页面 cleanup 判断是否跳过保存。

不负责：

- 认证 token 管理。
- 路由跳转。
- 后端删除仓库。
- 业务数据清理。
- 弹框 UI。

### 5.2 页面边界

`views/library`：

- 右键释放和删除仓库成功后只调用 release service。
- 不直接 import 多个 cache clear 函数。

`AuthContext` / request service：

- 退出登录或 401 只调用 session release，然后清认证 / 跳登录。
- 允许 release 异步失败被吞掉并记录日志，不能阻塞登录页跳转。

`library detail`：

- 普通 unmount 继续保存 workspace state。
- 处于 dispose 中的 cacheKey / libraryId unmount 时跳过保存，避免“刚清完又写回”。

### 5.3 状态 owner 边界

- `FileViewerContext` 仍然是文件预览 tab owner，不把 tab 状态搬到 release service。
- `useRepositoryTree` 仍然是目录树 owner，release service 只清 snapshot store。
- `library detail` 仍然是 browser tab renderer 投影 owner，release service 只清缓存和通知 Electron 关闭 view。
- `globalAudioPlayer` / `floatingVideoService` 仍然是出声资源 owner，release service 只调用它们暴露的释放接口。

## 6. 分期计划

### Phase 1：统一释放入口和第一批资源（已落地）

目标：先解决右键释放仓库的可见残留，并建立 session release 的统一入口。

任务：

- 新增 workspace resource release service。（已落地）
- 给 `file-viewer-cache` 增加全量清理能力。（已落地）
- 给 `workspace-state` 增加全量清理能力。（已落地）
- 给 repository tree snapshot store 增加按 libraryId 清 dirty marker 和全量清理能力。（已落地）
- 给 `globalAudioPlayer` / `floatingVideoService` 增加按 libraryId 释放能力。（已落地）
- scoped release 关闭该 library workspace state 中记录的 browser tabs。（已落地）
- session release 调 `window.electronEmbeddedBrowser.closeAll()`。（已落地，待 Phase 2 接入调用点）
- `views/library` 右键释放改成调用统一 service。（已落地）
- 删除仓库成功后调用统一 service。（已落地，复用仓库页删除成功后的 release 路径）

验收：

- 右键释放后重新进入同仓库，文件 tab 清空。
- 右键释放后重新进入同仓库，目录树不恢复旧展开。
- 右键释放后目标仓库的 MediaHub 音视频消失。
- 右键释放不影响其他仓库已打开资源。

### Phase 2：登出和登录失效接入

目标：退出登录和 401 登录失效彻底清 session。

任务：

- `AuthContext.logout()` 接入 `disposeSessionWorkspaces()`。
- `apiRequest`、`ipcRequest`、上传 session、迁移 service 中的 401 分支接入同一个 session dispose helper，避免多套逻辑。
- 登出跳转前后都不能重新保存 workspace state。
- release 失败时记录日志，但不阻断登录页跳转。

验收：

- 打开文件 tab、展开目录树、打开内置浏览器、播放音频 / 视频后退出登录，再登录回来不恢复旧现场。
- 401 自动跳登录后不恢复旧现场。
- 退出登录时 Embedded Browser view 不残留遮挡登录页。

### Phase 3：防写回机制（部分落地）

目标：解决“清了又被 effect cleanup 写回”的根因。

任务：

- release service 提供 `isDisposingLibrary(libraryId)` / `isDisposingSession()` 或一次性 dispose token。（已落地：marker 跟随 dispose promise，完成后下一轮事件循环移除）
- `library detail` cleanup 在 dispose 中跳过 `saveLibraryDetailWorkspaceState`。（已落地）
- `FileViewerContext` 持久化 effect 在 dispose 中跳过 `setFileViewerStateCache`。（已落地）
- `useRepositoryTree` snapshot 保存 effect 在 dispose 中跳过 `saveRepositoryTreeSnapshot`。（已落地）
- 必要时在 dispose 完成后移除 dispose marker，避免影响下一次正常进入。

验收：

- scoped release 和 session release 后不会被 unmount cleanup 写回旧数据。
- 普通离开资料库仍能恢复现场。

### Phase 4：viewer 内部 snapshot 和工具区状态补齐

目标：减少阅读进度 / 归档浏览等内部 snapshot 在 release 后残留。

任务：

- 为 PDF / comic / ASMR / audio archive / video archive / video progress 等模块补清理出口。
- 优先按 cacheKey 前缀清理，无法可靠归属时只在 session release 全量清理。
- 工具区状态区分“草稿偏好”和“当前资料库工作现场”，只清后者。

验收：

- release 后重新打开同资源，不从已释放前的内部阅读位置恢复。
- 用户偏好不被误删。

### Phase 5：文档与验证收口

目标：把临时计划转成长期契约。

任务：

- 更新 `docs/library-detail-workspace.md`：补充普通离开 vs 显式 dispose 行为。
- 更新 `docs/file-explorer-file-viewer-boundary.md`：补充目录树 snapshot 清理契约。
- 更新 `docs/media-hub-contract.md`：补充 library/session release 对出声资源的语义。
- 更新 `docs/embedded-browser-architecture.md`：补充 logout / release workspace 时关闭 view 的约定。
- 更新 `docs/frontend-validation-matrix.md`：增加 logout / release workspace 手工验证项。
- 删除本 wip 文档，或只保留已完成结论并迁出 `docs/wip`。

## 7. 验证矩阵

最低自动验证：

- `npm run lint`
- `npm run build`

手工主路径：

- 打开仓库 A，展开目录树，打开 2 个文件 tab，右键释放仓库 A，再进入 A。
- 打开仓库 A 和 B，播放 A 的音频 / 视频，释放 A，确认 B 的工作区不受影响。
- 打开内置浏览器 tab，释放仓库，确认 BrowserView 关闭且重新进入不恢复 browser tab。
- 打开文件 tab、目录树、内置浏览器、MediaHub 后退出登录，再登录确认全部清空。
- 触发 401 自动跳登录，确认行为等同退出登录。

边界路径：

- 普通从资料库页切到设置 / 仓库页，再回资料库，现场仍恢复。
- 删除仓库成功后不留下该仓库旧现场。
- release 期间 Electron close tab 失败时，前端 cache 仍被清理，并用 warning 提示有浏览器视图未确认关闭。
- 当前没有登录 token 时进入登录页，不误触发报错。

## 8. 风险和决策点

### 8.1 是否清 localStorage

第一批不清普通 localStorage，只清内存型工作区 cache。原因：

- 主题、语言、自动导入配置、浏览器规则等是用户偏好，不是工作区现场。
- 工具区部分状态写入 localStorage，需要先拆分“用户偏好”和“资料库现场”，避免误删。

### 8.2 scoped release 如何识别 browser tab 归属

当前 renderer workspace state 里保存 browser tab 列表。scoped release 可以先读取目标 `library:${id}` 的 workspace state 并关闭其中 tab。session release 使用 Electron `closeAll()` 兜底。

如果未来出现 browser tab 不在 workspace state 中登记的情况，应考虑在 release service 维护 renderer 侧 tab ownership registry。

### 8.3 scoped release 如何处理媒体

第一批给媒体服务增加按 `libraryId` 释放接口。若当前出声实体 `libraryId` 命中目标库，则清理；不命中不动。

### 8.4 dispose marker 生命周期

dispose marker 应只用于阻止当前释放过程中的 cleanup 写回。marker 生命周期必须跟随 dispose promise；释放完成后下一轮事件循环移除，避免长时间阻止正常保存，也避免释放耗时超过固定时长后旧状态被写回。

## 9. 禁止事项

- 禁止在 logout、401、右键释放里各自散落多份清理代码。
- 禁止让组件 unmount 成为唯一释放机制。
- 禁止为了清 workspace 而清用户偏好、认证之外的浏览器配置或业务数据。
- 禁止把 MediaHub registry 改回 React 组件生命周期注册。
- 禁止在 `setState` updater 中调用带副作用的 release 方法。
- 禁止在普通路由切换时破坏现有“现场恢复”体验。
