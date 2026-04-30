# Text Viewer 说明

更新时间：2026-04-30
适用范围：`src/features/file-viewer/components/text-viewer/` 下的文本预览、编辑、保存和另存为链路。

## 1. 概述

`text-viewer` 是普通文件 viewer 体系里的可编辑文本查看器，当前基于 CodeMirror 渲染和编辑文本内容。

它当前承担：

- 按文件名扩展名选择基础语法高亮
- 加载后维护编辑内容和 dirty 状态
- 支持字号缩放、自动换行、保存、另存为和下载
- 保存时调用后端按 `nodeId` 更新内容的专用 API
- 另存为时通过 Electron 暂存文本文件，再走现有上传创建节点链路
- 保存成功后刷新目录树和当前 tab 的文件链接，但不 reload 当前 viewer

它不是文件打开链路 owner，也不是后端节点存储 owner。

## 2. 当前结构

- `index.tsx`
  - CodeMirror 配置、文件加载、编辑状态、保存/另存为和快捷键
- `style.ts`
  - 编辑区、底部工具栏、dirty 标记和操作按钮样式

## 3. 关键链路

### 3.1 加载

`text-viewer` 收到 `url + reloadToken` 后直接 `fetch(url)` 读取文本。

这里不要随意给对象存储签名 URL 加 `cache: 'no-store'` 等额外 fetch 选项；某些签名 URL 对请求形态比较敏感，改请求选项可能导致文件加载失败。

### 3.2 编辑状态

编辑内容同时写入：

- React state：驱动 CodeMirror 的 `value`
- `contentRef`：让保存回调拿到最新内容

两者必须保持同步。只更新 ref 会导致 CodeMirror 仍受旧 state 控制，保存或重渲染后用户看到的内容回退。

### 3.3 保存

当前保存链路使用专用内容更新接口：

1. 读取当前节点详情。
2. 调用 `PUT /api/v1/nodes/:nodeId/content`，请求体包含 `libraryId`、`content` 和可选 `contentType`。
3. 后端生成新的对象存储内容，并替换当前文件节点的 storage 绑定。
4. 保留节点 ID、文件名和目录位置不变。
5. 刷新目录树和当前 tab 的文件链接，但不触发 `reloadActiveTab`。

右键新建文件后，目录树会立即通过同一个内容 API 写入空内容，让新文件从一开始就有对象存储绑定。这样新建的 `.txt`、`.md` 或代码文件可以像记事本一样马上打开和保存。

保存时不应该重置当前 viewer 的局部阅读状态，例如字号和自动换行。重新关闭再打开文件时，viewer 可以重新使用默认字号；但一次保存动作不能把正在编辑的界面当成重新进入。

不要把普通保存重新改成 `uploadLocalPathAndCreateNode + conflictPolicy: 'replace'`。那条链路只适合兼容上传替换，不适合作为编辑器保存的主路径。

### 3.4 另存为

另存为同样使用 Electron 暂存文件，但上传时使用 `conflictPolicy: 'auto_rename'`，目标是创建一个新文件节点。

## 4. 边界

`text-viewer` 负责：

- 文本内容加载和编辑
- 编辑态、dirty 态和保存按钮状态
- 保存后的目录树刷新通知
- 当前 tab 文件链接刷新

它不负责：

- 决定一个文件是否是文本文件
- 管理文件预览 tab 生命周期
- 定义后端节点覆盖规则
- 直接写本地原文件或对象存储

相关边界优先看：

- `src/utils/preview-file-type.ts`
- `src/features/file-viewer/components/file-dispatcher/index.tsx`
- `src/contexts/FileViewerContext.tsx`
- `src/features/file-explorer/services/file.api.ts`
