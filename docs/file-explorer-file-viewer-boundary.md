# File Explorer 与 File Viewer 边界说明

更新时间：2026-04-15

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

它不负责维护“预览 tab 列表”，只在文件被打开时通过 `onFileOpen(...)` 把结果交给外部页面。

### 3.2 `useRepositoryTree`

`useRepositoryTree.ts` 当前是文件树真正的 owner，负责：

- root node id 解析
- expanded keys
- 按 repository 维度保存 `treesCache`
- snapshot 恢复与脏重建
- 懒加载子节点
- 目录节点和文件节点的树内增删改
- 文件双击打开时的文件类型判定与回调派发

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
    -> getFileLink / resolveFileType
      -> onFileOpen(fileUrl, fileName, fileType, nodeId, options)
        -> page / file viewer context
          -> FileViewerContext.setFileUrl(...)
            -> file-dispatcher 渲染对应 viewer
```

关键点：

- 文件树负责“把节点变成可打开文件信息”。
- 文件预览负责“把文件信息放进当前预览状态和 tab”。
- 文件类型解析当前发生在 `useRepositoryTree`，不是 `FileDispatcher`。

这意味着如果以后要改“文件类型怎么判”，优先改文件树打开链路，不要往分发器里塞更多判断。

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
