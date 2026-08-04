# File Viewer 与 Archive Viewer 映射说明

更新时间：2026-08-04
适用范围：`features/file-viewer`、`features/archive-viewer`、`contexts/FileViewerContext.tsx`、`components/business/app-main/` 中与文件预览、viewer 分发和归档返回链路相关的代码。

## 1. 概述

OmniFlow 当前不是“一个万能 viewer”，而是多种 viewer 共同组成的预览体系。

当前这套体系分成两层：

- `file-viewer`
  - 普通文件和普通语义目录的预览
- `archive-viewer`
  - 归档语义目录的预览

页面真正渲染哪个 viewer，不是由页面组件硬编码判断，而是由 `fileType` 分发。

## 2. 当前 `fileType` 枚举

当前预览上下文里主要的 `fileType` 包括：

- `image`
- `video`
- `audio`
- `pdf`
- `text`
- `comic`
- `gallery`
- `asmr`
- `video_archive`
- `audio_archive`
- `asmr_archive`
- `comic_archive`
- `gallery_archive`
- `other`

这里的 `fileType` 是预览分发类型，不等同于文件扩展名，也不等同于目录树节点上的 `builtInType`。

## 3. 当前 viewer 映射

`FileDispatcher` 当前的实际分发关系是：

- `image -> ImageViewer`
- `audio -> AudioViewer`（参与 MediaRegistry 注册，kind=audio）
- `video -> VideoViewer`（参与 MediaRegistry 注册，kind=video）
- `pdf -> PdfViewer`
- `text -> TextViewer`
- `comic -> ComicViewer`
- `gallery -> GalleryViewer`（图集目录 viewer；图片和视频详情在当前 tab 内切换，视频通过 `floatingVideoService` 接入 MediaHub）
- `asmr -> AsmrViewer`（参与 MediaRegistry 注册，kind=audio，仅当 ownerType 为 asmr 且为该 viewer 的 ownerKey）
- `video_archive -> VideoArchiveViewer`
- `audio_archive -> AudioArchiveViewer`（归档页底部播放器首次播放后参与 MediaRegistry 注册，kind=audio）
- `asmr_archive -> AsmrArchiveViewer`
- `comic_archive -> ComicArchiveViewer`
- `gallery_archive -> GalleryArchiveViewer`（图集归档卡片墙；直属普通图集卡片进入 `gallery`，直属下级归档卡片进入下一层 `gallery_archive`）
- `other -> 不支持预览提示`

对应代码位置：

- `src/features/file-viewer/components/file-dispatcher/index.tsx`

`FileDispatcher` 现在会接收 `tabId` prop 并透传给 audio / asmr / video viewer，用于把它们的播放注册到 `MediaRegistry`，详见 `docs/library-detail-workspace.md` §11。

`AppMain` 还会把认证账号 scope 与 tab 上的 `libraryId`、`contentRevision`、`reloadToken` 作为 session identity 输入交给 `FileDispatcher`。当前所有声明 Warm memory 的 viewer 都已消费这些字段接入公共 Viewer Session Registry，Text 还用稳定账号/资料库/节点身份定位 IndexedDB draft；分发器只透传身份事实，不持有阅读状态或草稿正文。

公共 session 只保存最小稳定现场。目录 children、归档卡片、分页响应、临时文件/封面/字幕链接和媒体 DOM 都由对应 viewer 或服务 owner 重新构建；不得为了新 viewer 接入在分发器或 `workspace-resource-release` 中新增逐类型 cache switch。

`FileDispatcher` 也会把 tab 上的 `returnTarget` 透传给需要继续开子层的归档 viewer。当前 `comic_archive` 会用它串起归档返回栈：父归档打开子归档时，子归档 tab 的 `returnTarget` 指向父归档；子归档再打开漫画或下一层归档时，会把自己的父级继续挂在 `returnTarget.returnTarget` 上。顶部返回按钮只按这条显式链返回，不根据目录树反查父级。返回栈的构造、规范化和 pop 逻辑统一收敛在 `src/contexts/file-viewer-return-target.ts`，后续不要在 viewer 内手写另一套对象拼装规则。

## 4. 模块边界

### 4.1 `file-viewer`

`file-viewer` 当前承担：

- 普通文件预览
- 普通语义目录预览
- 文件分发
- 若干播放器/查看器的运行时辅助能力

当前目录下主要 viewer：

- `image-viewer`
- `audio-viewer`
- `video-viewer`
- `pdf-viewer`
- `text-viewer`
- `comic-viewer`
- `gallery-viewer`
- `asmr-viewer`
- `welcome-view`
- `file-dispatcher`

### 4.2 `archive-viewer`

`archive-viewer` 当前只承接归档语义 viewer：

- `video-archive-viewer`
- `audio-archive-viewer`
- `asmr-archive-viewer`
- `comic-archive-viewer`
- `gallery-archive-viewer`

它和 `file-viewer` 是配套关系，不是替代关系。

### 4.3 页面容器

真正把这些 viewer 放进工作区的是：

- `src/components/business/app-main/index.tsx`

它负责：

- 欢迎页和 viewer 页切换
- tabs 保活
- 把 active tab 交给 `FileDispatcher`
- 透传 `videoPlaylist` / `audioPlaylist`、字幕候选、封面和归档返回目标
- 协调全局音频播放器与 ASMR/普通音频 viewer 的关系

## 5. 归档返回链路

归档 viewer 不是孤立页面，当前还带一条“返回原归档入口”的工作区链路。

当前 `library detail` 页面会根据：

- 当前 active tab 的 `returnTarget`
- 当前文件 `fileType`

决定是否显示“返回归档”的路径。

当普通 `asmr / comic / video / audio` viewer 来自对应归档 viewer 时，顶部文件系统按钮会切换成绿色返回按钮：按钮背景保持透明，返回箭头图标本身常态显示为绿色，用来提示当前文件可以返回原归档入口。

这说明归档 viewer 不只是视觉差异，它还携带额外导航语义。

`audio_archive` 也可以在归档页内直接播放歌曲列表；归档页自身会在首次播放后以当前 tab 注册到 `MediaRegistry`，用于工具栏媒体控制中心的播放 / 暂停 / seek / 移除控制。只有用户从底部控制条打开普通 `audio` viewer 时，才通过 `FileViewerContext` 透传 `audioPlaylist`、`audioSubtitleSources`、`audioCoverUrl` 和 `returnTarget`。这些字段只表达打开来源和播放上下文，不拥有实际播放时间或歌词解析结果。

## 6. 当前最值得读的文件

如果要理解 viewer 体系，建议按这个顺序读：

1. `src/contexts/file-viewer.context.ts`
2. `src/contexts/FileViewerContext.tsx`
3. `src/components/business/app-main/index.tsx`
4. `src/features/file-viewer/components/file-dispatcher/index.tsx`
5. 再按需看具体 viewer：
   - `src/features/file-viewer/components/comic-viewer/`
   - `src/features/file-viewer/components/gallery-viewer/`
   - `src/features/file-viewer/components/asmr-viewer/`
   - `src/features/file-viewer/components/text-viewer/`
   - `src/features/archive-viewer/components/video-archive-viewer/`
   - `src/features/archive-viewer/components/comic-archive-viewer/`
   - `src/features/archive-viewer/components/asmr-archive-viewer/`

## 7. 文档落点建议

当前建议采用两层文档结构：

- `docs/` 放跨模块概念文档
  - 例如本文件、内置类型/归档模式专题
- `docs/viewers/` 放 viewer 体系入口和单个 viewer 文档
  - 例如 `docs/viewers/README.md`、`docs/viewers/asmr-viewer.md`

如果单个 viewer 后续继续膨胀，例如：

- 内部状态机复杂
- 有独立播放模型
- 有复杂缓存、排序、搜索、分页、回放、键盘交互

那就再在 `docs/viewers/` 下为该 viewer 单独补文档，不要一开始给所有 viewer 都铺一份空文档，也不要把长期说明散落到代码目录里。

## 8. 验证方式

涉及 viewer 分发变更时，至少手工验证：

1. 普通文件类型仍进入正确 viewer。
2. `comic / asmr` 仍进入普通 viewer。
3. `gallery` 目录进入图集 viewer，图片 / 视频详情在同一 tab 内左右切换。
4. `video_archive / audio_archive / comic_archive / asmr_archive / gallery_archive` 仍进入归档 viewer。
5. 归档 viewer 返回链路仍然成立。
6. 从 `asmr / comic / video / audio` 归档打开普通 viewer 后，顶部返回按钮显示绿色提示态。
7. 从 `comic_archive` 打开子 `comic_archive` 后，顶部返回按钮能逐级回到父归档；从目录树直接打开中间层归档时，不显示不存在的父级返回。
8. 不支持预览的文件仍进入降级态，而不是白屏。

## 9. 维护规则

出现以下变化时，必须回写本文：

- 新增新的 `fileType`
- `FileDispatcher` 映射关系变化
- `archive-viewer` 或 `file-viewer` 模块边界变化
- 归档返回链路变化
- 某个 viewer 复杂度显著上升，需要独立局部文档
