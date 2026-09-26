# Comic Viewer 说明

更新时间：2026-09-25
适用范围：`src/features/file-viewer/components/comic-viewer/` 下的漫画阅读、阅读模式切换、进度恢复和远端进度同步能力。

## 1. 概述

`comic-viewer` 不是简单的图片列表页，而是一个带阅读器状态机的漫画 viewer。

它当前同时承担：

- 解析 `comic://library/:libraryId/node/:nodeId` 路由中的 `libraryId`
- 读取漫画目录中的图片页并按阅读器模型展示
- 支持滚动模式和翻页模式两套阅读交互
- 通过公共 Viewer Session Registry 维护 Warm 阅读现场
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

普通漫画的右侧中央工具栏复用 `FloatingViewerDock` 并隐藏名称和顶部类型图标，只保留可点击页码、回到顶部、阅读模式、页布局和查看器设置。回到顶部在滚动/翻页模式均常驻，翻页时返回首组，切换模式不改变工具栏高度。页码从上到下显示当前页、横向两点、总页数；它表示视口锚点，末页较短时不强行改写为总页数。

`ComicReaderDock` 只持有当前展开气泡，不保存阅读模式或阅读位置。进度轨道作为 `FloatingViewerDock` 的 `decoration` 由同一个工具栏容器绘制，用加厚描边沿工具栏外框完整闭合；不再额外定位第二个工具栏圈。描边底轨保持连续中性边框，强调色只沿同一闭合路径连续绘制当前进度，不拆成独立色段。阅读模式或页布局在对应按钮左侧展开选项气泡；页码按钮只显示当前页数，不再展开进度气泡。工具栏内嵌圆角进度轨道，沿竖向圆角矩形闭合路径从0到100%绕行一周；点击和拖动按指针在闭合描边上的最近位置跳转，键盘按同一进度值调节。内容区隐藏原生滚动条，滚动仍由原viewport承载。滚动模式的轨道严格跟随实际 `scrollTop / maxScrollable`，最后一页已经露出时进度立即进入最后区间，实际滚动到底才到100%；点击轨道只用页组比例预加载目标区域，再由同一物理比例恢复精确位置，避免页码锚点和轨道脱节，单张长图也可滚动。翻页模式按单页/双页的页组步进，阅读区域左右两半都可点击翻页，拖动结束产生的合成 click 只消费本次拖动，不吞掉下一次普通点击。远跳继续使用原增量渲染和锚点恢复路径，读取进度由原scroll与flip状态投影，轨道不进入session快照。

阅读模式与页布局的外层图标表示当前状态、保持中性色；点击后气泡展示两枚选项图标，当前项使用主题强调色和`aria-pressed`，点击当前项不切换，选择另一项后收起并将焦点还给入口。背景常态透明，悬停/按下才显示底色。点击外部、Escape、焦点移出或viewer失活时关闭；控件键盘事件不触发背景翻页。滚动视口和翻页舞台继续保留右侧64px安全区，模式和阅读恢复owner不变。漫画归档墙的名称与类型展示不受这一阅读工具栏精简影响。

存在多个查看器候选或发生回退时，右侧气泡增加「查看器设置」图标，取代顶部选择框/默认按钮/提示横栏；回退时图标和可访问名称提示当前情况，详细原因在弹窗内显示。弹窗选择仅为草稿，点击「应用」或「设为此类文件默认」才经原 `FileViewerContext.selectViewer` 提交；取消不改选择或关联。加载、空目录和失败状态仍保留入口。弹窗打开时暂时令当前漫画view inactive，停止背景键盘操作；独立插件的原生view沿原active清理路径收起，关闭后恢复原授权视图和快照。选择/默认关联/阅读恢复仍由原owner持有，`ViewerOptionsContext`只提供展示入口。其他文件类型继续保留原打开方式入口。

### 3.3 Warm Session

`comic-viewer` 通过公共 registry 保存：

- 稳定页锚点、锚点内偏移、滚动比例和绝对位置兜底
- 当前页码
- 滚动/翻页模式与单双页模式
- 滚动缩放、页间距
- 翻页缩放、平移、旋转和是否使用自定义缩放

页列表、渲染窗口、临时图片链接、已解码图片和 DOM ref 不进入 snapshot；恢复时重新读取 children 并按目标页抬高首批渲染窗口。资源身份使用稳定节点，不使用 `fileUrl`；刷新由 `reloadToken` generation 精确失效旧 snapshot。

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
- `scrollTop`
- `scrollRatio`
- `currentPageNumber`
- `updatedAt`

同进程命中 Warm 时直接以 Warm 为准，远端只作为没有 Warm snapshot 时的 Cold fallback；旧的远端记录不能覆盖本地恢复点。
`anchorPageId + anchorOffsetRatio` 是优先恢复依据，`scrollTop / scrollRatio` 作为页面顺序变化或 anchor 不可用时的兜底。

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

1. 使用显式 `libraryId` 和 `folderNodeId` 构造公共 session identity。
2. registry 同步恢复模式、缩放、页间距、翻页变换和待定位页锚点。
3. 并行加载 children 和节点详情，过滤出图片页。
4. 命中 Warm 时按稳定页锚点定位，并忽略本轮远端位置；未命中时才解析 `viewMeta`。
5. 根据目标页提前抬高 `visibleCount`，重新请求图片链接，待布局稳定后完成定位。

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
- 支持缩放和旋转；单页只有按住空格再按左键才进入抓手平移，松开空格或窗口失焦立即结束。双页禁止平移，切入双页及恢复双页快照清除旧偏移。普通左键拖动不移动图片且不触发翻页，轻点左右区域仍翻页
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

- Warm 和远端恢复是有明确优先级的两条链路，不能让较慢的远端请求覆盖 Warm
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
5. 滚动/翻页、单双页、缩放、页间距和平移旋转在真卸载重建后恢复。
6. 未命中 Warm 时，重新进入同一漫画目录能从远端阅读进度续读。
7. reload 后不恢复旧 Warm snapshot，关闭重开按 retain-reading-position 续读。
8. 历史 `viewMeta` 兼容情况下不会白屏或丢进度。

## 10. 维护规则

出现以下任一变化时，必须回写本文：

- `comic://` 路由解析变化
- Warm session schema 或恢复优先级变化
- 远端阅读进度字段变化
- 滚动/翻页模式切换规则变化
- 单双页或缩放模型变化
- 右键菜单或设置弹窗能力变化

## 目录插件接管（E1）

普通漫画目录新增可安装的独立插件候选，用户显式选择或保存默认打开方式后使用；停用或缺失回退内置。原 comic-viewer 与 viewMeta 逻辑保留，插件阅读状态使用自己的 Viewer Session 命名空间，不互相写入。范围、SDK 与验收见 [E1 目录查看器](../plugin-system-e1-directory-viewer.md)。
