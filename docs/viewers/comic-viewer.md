# Comic Viewer 说明

更新时间：2026-04-16
适用范围：`src/features/file-viewer/components/comic-viewer/` 下的漫画阅读、阅读模式切换、进度恢复和远端进度同步能力。

## 1. 概述

`comic-viewer` 不是简单的图片列表页，而是一个带阅读器状态机的漫画 viewer。

它当前同时承担：

- 解析 `comic://library/:libraryId/node/:nodeId` 路由中的 `libraryId`
- 读取漫画目录中的图片页并按阅读器模型展示
- 支持滚动模式和翻页模式两套阅读交互
- 维护本地阅读快照缓存
- 把阅读进度回写到节点 `viewMeta`
- 提供缩放、单双页切换、页间距、回到顶部、右键菜单和设置弹窗

如果只把它当成“批量展示图片”的组件来改，最容易把阅读进度、恢复逻辑和模式切换改坏。

## 2. 当前结构

- `index.tsx`
  - 主体实现，包含阅读器状态、远端同步、滚动恢复和翻页交互
- `style.ts`
  - 阅读器整体布局与模式样式
- `docs/viewers/comic-viewer.md`
  - 当前说明

## 3. 关键概念

### 3.1 阅读源与图片过滤

`comic-viewer` 当前会把目录 children 过滤成图片页，而不是展示目录下所有文件。

当前过滤规则重点包括：

- 只接受图片文件
- 忽略隐藏文件
- 兼容基于 `mimeType` 和扩展名的判断

这意味着它本质上是“目录转漫画页序列”的 viewer，不是通用文件浏览器。

### 3.2 两套阅读模式

当前 reader 有两种主模式：

- `scroll`
  - 连续滚动阅读
- `flip`
  - 翻页阅读

另外还有一层页布局模式：

- 单页
- 双页

这两层模式不是同一个概念：

- 阅读模式决定交互模型
- 页布局模式决定一屏展示一页还是两页

后续改动时不要把它们揉成一个开关。

### 3.3 本地快照缓存

`comic-viewer` 当前有局部快照缓存，缓存 key 由：

- `fileUrl`
- `folderNodeId`
- `reloadToken`

共同组成。

当前缓存内容包括：

- 是否已加载列表
- 已解析的页列表
- 当前已渲染页数
- 滚动位置与滚动比例
- anchor page 和 offset ratio

它的目的不是持久化全部阅读器设置，而是让 tab 切换、重渲染后能尽可能恢复到原阅读位置。

### 3.4 远端阅读进度同步

这个 viewer 不只做本地恢复，还会把阅读进度写回节点 `viewMeta`。

当前关键字段位于：

- `__omniflowViewerStateV1`
- `comicReader`

兼容旧字段：

- `__omniflow_viewer_state_v1`
- `comic_reader`

当前同步内容主要包括：

- `anchorPageId`
- `anchorOffsetRatio`
- `currentPageNumber`
- `updatedAt`

所以后续如果你改阅读进度模型，要同时确认：

- 本地缓存是否还能恢复
- 远端 `viewMeta` 兼容是否还成立

## 4. 当前职责边界

`comic-viewer` 当前负责：

- 从目录构造漫画页列表
- 批量预取图片链接
- 管理滚动/翻页模式切换
- 管理缩放、单双页和页间距
- 恢复本地阅读位置
- 同步远端阅读进度
- 提供阅读器右键菜单和设置弹窗

它当前不负责：

- 顶层 `fileType` 分发
- 文件树目录语义判断
- 归档漫画阅读
- 工作区 tab 生命周期

这几块分别优先看：

- `src/features/file-viewer/components/file-dispatcher/index.tsx`
- `src/features/file-explorer/`
- `src/features/archive-viewer/components/comic-archive-viewer/`
- `src/components/business/app-main/index.tsx`

## 5. 关键流程

### 5.1 初次进入与恢复

建议顺着这条链路阅读：

1. 从 `fileUrl` 解析 `libraryId`
2. 用 `folderNodeId + fileUrl + reloadToken` 计算 reader cache key
3. 如果命中本地快照：
   - 恢复 pages、visibleCount、anchor 和 scroll 信息
   - 再异步拉一次节点详情，尝试用远端阅读进度覆盖本地恢复点
4. 如果未命中本地快照：
   - 并行加载 children 和节点详情
   - 过滤出图片页
   - 如果 `viewMeta` 里有阅读记录，则直接把 visibleCount 和 anchor 提前抬到目标页

这里最重要的是：

- 本地恢复优先解决“切 tab 不丢位置”
- 远端恢复优先解决“重新进入还能续读”

### 5.2 图片链接预取

这个 viewer 不会一次性把所有图片链接都拉完，而是按窗口逐步预取。

当前特点：

- 根据 `visibleCount + PREFETCH_AHEAD` 决定预取范围
- 使用 `batchGetFileLinks` 批量取链接
- 每次 tick 最多处理 `MAX_RESOLVE_PER_TICK`
- 页状态有 `idle / loading / ready / error`

所以如果未来你觉得“加载慢”，先看预取窗口设计，不要直接粗暴改成全量请求。

### 5.3 滚动模式

滚动模式下，核心逻辑是：

- `pages-scroll` 容器负责滚动
- 用 anchor page + offset ratio 捕捉当前阅读位置
- 用 sentinel 触发增量加载更多页
- 支持滚轮/快捷键缩放
- 支持回到顶部动画

这里的阅读位置恢复，不是简单 `scrollTop` 回写，而是：

- 优先用 anchor page 对齐
- 对齐失败再回退到 scrollTop / scrollRatio

这也是它比普通图片列表复杂的地方。

### 5.4 翻页模式

翻页模式下，核心逻辑是：

- 当前页索引由 `flipPageIndex` 驱动
- 单页/双页会影响翻页步长和索引归一化
- 支持点击左右区域翻页
- 支持键盘左右键翻页
- 支持缩放、拖拽平移、旋转
- 支持为当前页附近做 decode warmup

翻页模式和滚动模式共用同一份页数据，但交互模型完全不同，所以改动时要分别测。

### 5.5 右键菜单与设置弹窗

当前 viewer 右键菜单会根据模式动态显示：

- 重置视图
- 翻页模式下的旋转
- 设置入口

设置弹窗当前主要承接：

- 阅读模式切换
- 单双页切换
- 缩放调节
- 页间距调节

这说明它已经不是“只读展示页”，而是一个带用户可控阅读参数的阅读器。

## 6. 当前最值得小心的点

- 本地恢复和远端恢复是两条链路叠加的，不能只验证其中一条
- `layoutMode` 和 `scrollColumnMode` 是两层状态，不要误合并
- `visibleCount` 同时影响渲染数量、预取窗口和恢复能力，是关键状态
- `flipPageIndex` 在双页模式下需要做偶数对齐，不能直接拿来显示
- `viewMeta` 里兼容了新旧 key，清理前必须先确认历史数据迁移
- 翻页模式有缩放、平移、旋转和 decode warmup，改 UI 时很容易误伤交互

## 7. 阅读顺序

建议按这个顺序读：

1. `src/features/file-viewer/components/comic-viewer/index.tsx`
2. `src/features/file-viewer/components/comic-viewer/style.ts`
3. `src/features/file-viewer/components/file-dispatcher/index.tsx`
4. `src/components/business/app-main/index.tsx`
5. 再回头看：
   - `docs/file-viewer-and-archive-viewer-map.md`
   - `docs/file-explorer-file-viewer-boundary.md`

## 8. 何时继续细分文档

当下面任一项继续膨胀时，应该继续在 `docs/viewers/` 下拆子文档：

- 阅读进度同步模型
- 滚动恢复与 anchor 机制
- 翻页模式交互模型
- 设置弹窗与阅读参数

建议未来的拆分方向：

- `docs/viewers/comic-reading-progress.md`
- `docs/viewers/comic-scroll-restore.md`
- `docs/viewers/comic-flip-mode.md`

## 9. 验证方式

涉及 `comic-viewer` 改动时，至少手工验证：

1. 漫画目录能正确过滤并展示图片页。
2. 滚动模式下能继续加载更多页，缩放和回到顶部正常。
3. 翻页模式下能左右翻页、单双页切换、缩放、拖拽和平移。
4. 右键菜单和设置弹窗在两种模式下都正常。
5. 切换 tab 再回来后，本地阅读位置仍能恢复。
6. 重新进入同一漫画目录后，远端阅读进度仍能续读。
7. 历史 `viewMeta` 兼容情况下不会白屏或丢进度。

## 10. 维护规则

出现以下任一变化时，必须回写本文：

- `comic://` 路由解析变化
- 本地 reader snapshot 结构变化
- 远端阅读进度字段变化
- 滚动/翻页模式切换规则变化
- 单双页或缩放模型变化
- 右键菜单或设置弹窗能力变化
