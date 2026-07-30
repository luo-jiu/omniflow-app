# File Explorer 与 File Viewer 边界说明

更新时间：2026-05-12

适用范围：`features/file-explorer`、`features/file-viewer`、`contexts/FileViewerContext.tsx`、`views/library/detail/` 中与文件树、文件打开、预览 tab、预览分发和缓存恢复相关的代码。

## 1. 概述

OmniFlow 当前的文件浏览主链路不是一个模块完成的，而是 3 层配合：

- `file-explorer`
  - 负责目录树、节点装载、目录变更、文件打开入口
- `file-viewer`
  - 负责预览 tab 状态、当前激活文件、viewer 分发
- `library detail`
  - 负责把“文件区”和“浏览器区”装进同一个页面工作区，并决定当前显示哪一块

这三层最重要的边界是：

- 文件树不拥有预览 tab 状态。
- 文件预览不拥有目录树结构。
- 页面工作区不直接实现文件类型分发，而是编排两者。

## 2. 模块地图

当前关键模块：

- 文件树侧边栏
  - `src/features/file-explorer/DirectorySidebar.tsx`
- 文件树核心 hook
  - `src/features/file-explorer/hooks/useRepositoryTree.ts`
- 文件类型身份解析
  - `src/features/file-identity/`
- 文件预览上下文
  - `src/contexts/FileViewerContext.tsx`
  - `src/contexts/file-viewer.context.ts`
  - `src/contexts/file-viewer-cache.ts`
- 文件预览 hook
  - `src/hooks/useFileViewer.ts`
- 文件分发器
  - `src/features/file-viewer/components/file-dispatcher/index.tsx`
- 页面编排
  - `src/views/library/detail/index.tsx`

## 3. 分层职责

### 3.1 File Explorer

`DirectorySidebar.tsx` 是文件树容器，负责：

- 挂接 `useRepositoryTree`
- 目录树节点的展开、双击、懒加载
- 上传成功后的节点追加
- 删除、重命名、配置变更后的树更新
- 自动导入触发的节点追加
- 右键属性弹窗的数据编排，包括目录树逻辑位置和文件物理存储位置展示
- 上传确认弹框的数据编排，包括目标目录、待上传文件摘要和可选 storage provider
- 删除二次确认弹框的数据编排；确认弹框走 overlay 子窗口，不能在侧边栏 Popconfirm 中展开

它不负责维护“预览 tab 列表”，只在文件被打开时通过 `onFileOpen(...)` 把结果交给外部页面。

右键“属性”里的“位置”是资料库目录树内的逻辑所在目录，不包含当前节点自身名称；文件节点额外展示“物理存储”，来源于 `GET /api/v1/nodes/:nodeId` 返回的 `storageProvider`、`storageEndpoint`、`storageBucket` 和 `storageKey`，用于区分同为 MinIO 的不同机器或不同桶。节点所属类型、内置类型和归档模式作为“视图与模式”字段展示，不再重复放在名称下方。

上传确认弹框由主 renderer 先读取 `/v1/storage/providers`，overlay 只展示可序列化后的 provider 摘要。用户在弹框里选择 provider 后，上传任务把 `storageProvider` 透传到后端；未取到 provider 列表时，上传仍可走后端默认分配。

右键新建文件在新建弹框内直接展示创建目录和存储位置，不再额外弹上传确认 overlay。新建文件的首次空内容写入会把用户选择的 `storageProvider` 传给 `PUT /v1/nodes/:nodeId/content`，并显式使用 `text/plain; charset=utf-8`，避免空 `.ts` 文件被后端按后缀推断为 MPEG-TS 视频。

回收站列表会展示文件节点的物理存储位置；目录节点使用后端返回的 `storageLocations` 聚合子树内文件实际分布。前端默认只展示前两个存储位置，更多位置通过行内“更多”按钮展开。

### 3.2 `useRepositoryTree`

`useRepositoryTree.ts` 当前是文件树真正的 owner，负责：

- root node id 解析
- expanded keys
- 按 repository 维度保存 `treesCache`
- snapshot 恢复与脏重建
- 懒加载子节点
- 目录节点和文件节点的树内增删改
- 文件双击打开时的文件类型解析入口与回调派发

它拥有“树结构事实”，不应该顺手拥有文件预览状态。

### 3.3 File Viewer

`FileViewerContext.tsx` 是预览状态 owner，负责：

- 当前激活文件状态 `fileState`
- 预览 tab 列表 `tabs`
- 当前激活 tab id
- 打开文件到 tab
- 激活 tab、关闭 tab、按 nodeId 关闭 tab
- 预览 reload token
- 预览 tab 排序
- 按 cache key 恢复/保存预览状态

它拥有“预览事实”，不拥有目录树数据，也不负责知道某个节点是否还在树中。

### 3.4 File Dispatcher

`file-dispatcher/index.tsx` 的职责只有一个：

- 根据 `fileType` 把当前文件分发给对应 viewer

例如：

- `image -> ImageViewer`
- `audio -> AudioViewer`
- `video -> VideoViewer`
- `pdf -> PdfViewer`
- `text -> TextViewer`
- `comic / asmr / archive -> 对应 viewer`

它不应该承担：

- 文件树状态
- tab 管理
- 页面模式切换
- 文件类型解析策略

## 4. 文件打开链路

当前文件打开链路可概括为：

```text
DirectoryTree double click
  -> useRepositoryTree.handleDoubleClick()
    -> getFileLink / file-identity resolveFileType
      -> onFileOpen(fileUrl, fileName, fileType, nodeId, options)
        -> page / file viewer context
          -> FileViewerContext.setFileUrl(...)
            -> file-dispatcher 渲染对应 viewer
```

关键点：

- 文件树负责“把节点变成可打开文件信息”。
- 文件预览负责“把文件信息放进当前预览状态和 tab”。
- 文件类型解析当前由 `src/features/file-identity/` 提供统一 resolver，并由 `useRepositoryTree` 在打开链路中调用，不发生在 `FileDispatcher`。

这意味着如果以后要改“文件类型怎么判”，优先改 `file-identity` 的 resolver 和打开链路传入的上下文，不要往分发器里塞更多判断。

## 5. 树状态 owner

当前树状态主要包括：

- `selectedRepository`
- `rootNodeId`
- `expandedKeys`
- `treesCache`

它们都在 `useRepositoryTree` 内维护，并按 `libraryId` 做 snapshot 缓存。

当前缓存行为：

- 正常切页时恢复树快照
- 标记 dirty 时按展开状态重建树
- 保留可见展开分支，避免切回来整树折叠
- 显式释放工作区时，`workspace-resource-release` 会按 `libraryId` 清理目录树 snapshot 和 dirty marker；session release 会全量清理。dispose 期间 `useRepositoryTree` 不再保存 snapshot，避免旧展开状态被写回。

规则：

- 树结构相关状态不要复制到页面层再维护一份。
- 页面层如果要刷新树，应通过 `DirectorySidebarHandle.refreshNodeSubtree(...)` 或 hook 暴露的方法做，而不是自己操作树数据。

## 6. 预览状态 owner

当前预览状态由 `FileViewerContext` 持有，核心规则如下：

### 6.1 Tab 标识

tab id 的规则：

- 有 `nodeId` 时，用 `node:${nodeId}`
- 否则，用 `url:${url}`

这说明当前预览 tab 更偏“同一文件单实例”模型，而不是每次点开都新建一个完全独立 tab。

### 6.2 当前激活文件

`fileState` 只是当前 active tab 的投影，不是独立 source of truth。  
真正的预览集合在 `tabs`，`fileState` 来自 active tab 推导。

规则：

- 不要一边维护 `tabs`，一边再额外维护一份平行的“当前文件对象”并手动同步。

### 6.3 预览缓存

预览状态通过 `file-viewer-cache.ts` 做内存缓存，带 `FILE_VIEWER_CACHE_MAX_ENTRIES = 12` 的上限。

这类缓存不是持久化到磁盘的业务数据，而是工作区恢复优化。  
因此：

- 可以恢复
- 不能当成长期数据来源

显式释放工作区时，`workspace-resource-release` 是预览缓存清理入口：

- 单库释放会读取目标 `library:${id}` 的文件预览 tab cache，先按 tab 清理 viewer 内部 snapshot，再清文件预览 tab cache。
- session 释放会全量清理文件预览 tab cache 和 viewer 内部 snapshot。
- PDF、漫画、图集、ASMR、视频进度、音频归档、视频归档等 viewer 的阅读 / 播放 / 浏览现场应放在各自轻量 cache sidecar 中，由 `src/features/file-viewer/services/viewer-snapshot-release.ts` 汇总释放，不要让 release service 静态 import React viewer 组件。
- viewer snapshot sidecar 的写入入口必须在 `isDisposingAnyWorkspace()` 命中时跳过保存，避免组件卸载 cleanup 把已释放的现场写回。

前端释放只清工作区现场。已经同步到后端 `viewMeta` 的阅读 / 播放进度不在这里删除；如果未来要支持“清远端阅读进度”，必须另设用户确认和后端接口。

## 7. 页面工作区和文件预览的关系

`library detail` 页面负责把文件预览放进更大的工作区容器中。

它额外决定：

- 当前显示文件区还是浏览器区
- 从浏览器回到文件区时显示 `file-viewer` 还是 `search-home`
- 某些文件是否改用浏览器打开

规则：

- 页面层只负责“工作区切换”。
- `FileViewerContext` 继续负责“文件预览状态”。
- 不要把 tab 管理重新搬回 `library detail` 页面。

## 8. 高风险改动点

后续改动以下地方时，最容易把边界改乱：

1. `useRepositoryTree.handleDoubleClick`
原因：这里同时承担文件打开入口、文件类型解析和树节点行为。

2. `FileViewerContext.setFileUrl`
原因：这里决定同一文件是否复用 tab，以及当前 active tab 如何更新。

3. `file-dispatcher`
原因：它看起来像最适合“顺手加业务判断”的地方，但实际上应该保持纯分发。

4. 目录树 snapshot / dirty rebuild
原因：恢复逻辑和运行时树状态一旦分叉，用户切回来就会觉得树“自己变了”。

5. 页面工作区与文件预览的交界
原因：一旦把工作区模式和文件预览 tab 混成一层，很快就会出现双 source of truth。

## 9. 维护规则

出现以下变化时，必须回写本文：

- 文件类型解析策略变化
- 文件树 snapshot / dirty rebuild 语义变化
- `FileViewerContext` 的 tab 规则变化
- 页面层开始接管更多预览状态
- 文件分发器新增新的 viewer 类型或不再只是纯分发

后续继续治理时，优先方向应该是：

- 让文件树更专注于“节点与树”
- 让文件预览更专注于“tab 与 viewer”
- 让页面继续只做“工作区编排”

## 10. 外部拖拽上传命中与高亮规则

目录树对外部拖拽上传采用“命中回溯”和“视觉反馈分离”的策略：

- 支持来源：本地文件拖拽继续走 `DataTransfer.files`；外部浏览器图片拖拽可从 `text/html` 中的 `<img src>` 或 `text/uri-list` 中的图片 URL 解析，先下载到临时导入目录，再复用上传确认和 UploadManager 队列。
- 不支持来源：外部浏览器的 `blob:` 图片、需要浏览器登录态 cookie 才能访问的防盗链图片，不保证可下载；失败时只提示错误，不创建空上传任务。
- 命中回溯：当鼠标位于文件节点（非目录）时，仍允许把落点解析为最近可用父目录，以保持上传便利性。
- 视觉反馈：只有当鼠标真正悬停在目录节点行上时，才显示目录高亮边框。
- 非目录节点悬停：即使可回溯到父目录，也不显示父目录高亮，避免用户误判“拖拽偏移”。
- 归档目录：继续禁止外部拖拽上传，保持现有阻断提示语义。
- 缝隙落点兜底：若鼠标落在两行之间等非节点区域，上传落点可短时回退到最近一次有效解析目标；仅在邻近行区域内生效，避免误命中远处旧目标。

维护要求：

- 若后续调整“拖到子节点是否可上传到父目录”的行为，必须同时更新命中规则与高亮规则，避免交互心智分裂。
