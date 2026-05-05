# Video Archive Viewer 说明

更新时间：2026-05-05
适用范围：`src/features/archive-viewer/components/video-archive-viewer/` 下的视频归档卡片视图、封面解析、缓存恢复和返回链路能力。

## 1. 概述

`video-archive-viewer` 不是普通视频播放器，而是一个归档目录下的视频墙 viewer。

它当前同时承担：

- 解析 `video-archive://library/:libraryId/node/:nodeId` 路由
- 读取归档目录下的视频卡片分页数据；卡片可以是历史直属视频文件，也可以是新的 `VIDEO` 文件夹视频单元
- 归档目录内如果直属子目录本身也是 `VIDEO` 归档目录，则以“合集”卡片展示，支持封面和逐层返回
- 用卡片墙方式展示直属视频资源
- 解析并补齐 `coverNodeId` 对应封面；没有显式封面时，优先兼容同名 / 文件夹内封面，再用视频文件自身链接做首帧预览
- 解析视频单元内或历史同名字幕，双击打开普通视频 viewer 时作为库内字幕候选传入
- 卡片右下角展示视频时长；当前时长来自后端 `durationSeconds`，不在卡片上展示节点 id 和“双击打开”提示
- 卡片尺寸和底栏密度跟漫画 / ASMR 归档保持同一档，视频封面仍保留 16:9 横向比例
- 维护局部列表缓存和滚动位置
- 提供重命名、删除、目录树定位等卡片级操作
- 双击卡片后打开普通 `video` viewer，并带上 `returnTarget`

如果只把它当成“卡片列表”来改，最容易把返回链路、封面策略和分页缓存改坏。

## 2. 当前结构

- `index.tsx`
  - 主体实现，包含分页加载、封面解析、右键菜单、缓存恢复和打开视频链路
- `style.ts`
  - 视频墙卡片布局和视觉样式
- `docs/viewers/video-archive-viewer.md`
  - 当前说明

## 3. 关键概念

### 3.1 路由语义

当前 viewer 依赖：

- `video-archive://library/:libraryId/node/:nodeId`

其中：

- `libraryId`
  - 用于请求分页卡片和视频文件链接
- `nodeId`
  - 代表当前视频归档目录

所以这不是通用目录页，而是“某个归档目录下的视频墙”。

### 3.2 卡片来源

当前卡片数据来自：

- `fetchArchiveCardsPage`
- `builtInType = 'VIDEO'`

它表达的是：

- 当前归档目录下的视频单元

视频单元包含两类：

- 新规则：直属 `VIDEO` 文件夹，文件夹内部第一个视频文件是 `mediaNodeId`，第一个图片文件是 `coverNodeId`，字幕文件作为伴随资源计数，并在打开播放页时传给普通 `VideoViewer`
- 历史兼容：直属视频媒体文件，`mediaNodeId` 回退为卡片自身 id；同级同名图片 / 字幕由前端辅助匹配
- 归档嵌套：直属 `VIDEO + archiveMode=1` 子目录作为 `cardKind=collection` 合集卡片展示；双击合集卡片会进入该子归档，继续按它自己的第一代视频单元展示；合集封面沿用普通视频单元封面规则，优先 `coverNodeId`，否则取合集目录第一代图片文件

也就是说现在的模型不是“递归抓整棵子树所有视频”，而是按归档目录自己的第一代视频单元结果来展示。

归档嵌套也只看亲子关系：父归档只显示直属子归档为合集，不把孙级内容提前摊平。进入子归档后，子归档再按相同规则展示自己的直属视频单元和直属合集。

### 3.3 封面策略

当前卡片封面优先使用显式封面：

- `coverNodeId`

具体策略是：

1. 卡片初始只带 `coverNodeId`
2. 再通过 `batchGetFileLinks` 批量解析封面 URL
3. 如果接口返回的是视频文件夹卡片，`mediaNodeId` 指向真正要播放的视频文件；如果是历史视频文件卡片，`mediaNodeId` 回退为卡片自身 id
4. 如果没有 `coverNodeId`，前端会按卡片名匹配同级同名图片作为兼容封面
5. 如果仍没有封面，则批量解析 `mediaNodeId` 对应视频链接，渲染只读 `<video preload="metadata">` 预览，并在 metadata 后 seek 到约 0.5 秒避开 0 秒空帧
6. 如果封面和视频预览链接都不可用，则显示占位卡面

这说明当前封面不是现场生成图片文件，而是优先依赖已有封面节点；没有显式封面时，只在前端用视频元素做轻量预览。

### 3.4 局部缓存

`video-archive-viewer` 当前有一层局部 snapshot cache，key 由：

- `fileUrl`
- `folderNodeId`

共同组成。

缓存内容包括：

- 是否已加载列表
- 当前卡片数组
- `nextOffset`
- `total`
- `hasMore`
- `scrollTop`

它的目标是让用户切 tab 或切工作区再回来时，能恢复视频墙列表和滚动位置，而不是每次都重新从头加载。

### 3.5 返回链路

双击卡片打开的不是 `video_archive` 自己，而是普通：

- `video`

但会通过 `returnTarget` 把归档来源一并传过去。

这意味着：

- 视频详情播放页和视频归档页是两层不同 viewer
- 归档页负责“视频墙入口”
- 普通 `video` viewer 负责真正播放
- 返回归档依赖 `returnTarget.fileType = video_archive`

## 4. 当前职责边界

`video-archive-viewer` 当前负责：

- 分页加载视频归档卡片
- 兼容视频文件夹内封面 / 字幕和历史直属视频文件的同名封面 / 字幕
- 批量解析封面或视频首帧预览链接
- 卡片网格展示和滚动恢复
- 维护 `100%` 页面缩放下的紧凑归档卡片密度
- 卡片级右键菜单
- 重命名、删除、目录树定位
- 双击打开普通视频 viewer

它当前不负责：

- 真正的视频播放
- 顶层 `fileType` 分发
- 归档目录 built-in type 规则定义
- 工作区 tab 生命周期

这几块分别优先看：

- 普通视频 viewer
- `src/features/file-viewer/components/file-dispatcher/index.tsx`
- `docs/built-in-type-and-archive-mode.md`
- `src/components/business/app-main/index.tsx`

## 5. 关键流程

### 5.1 初次进入

建议顺着这条链路阅读：

1. 从 `fileUrl` 解析 `libraryId`
2. 用 `fileUrl + folderNodeId` 计算 cache key
3. 如果命中本地 snapshot：
   - 直接恢复卡片、分页信息和 `scrollTop`
4. 如果未命中：
   - 从 offset 0 开始请求第一页
   - 把 `coverNodeId` 批量补成 `coverUrl`；没有 `coverNodeId` 的卡片尝试匹配同级同名封面，再补 `videoPreviewUrl`
   - 初始化 `nextOffset / total / hasMore`

### 5.2 分页加载

当前 viewer 的分页特点是：

- 固定 `PAGE_SIZE = 24`
- sentinel 进入视口后触发 `loadMore`
- 新数据 append 到当前卡片列表
- 合并时按 id 去重
- 最终按 `sortOrder` 和 `id` 排序

这说明它不是单纯的“滚动到底就拼接”，而是有基本的去重和排序保护。

### 5.3 封面补齐

分页接口返回的卡片初始结构里，媒体和封面重点是：

- `cardKind`
- `mediaNodeId`
- `coverNodeId`
- `subtitleCount`
- `durationSeconds`
- `coverUrl = null`
- `videoPreviewUrl = null`

后续通过 `resolveCardCoverUrls`：

- 收集未解析封面的 `coverNodeId`，没有显式封面时收集 `mediaNodeId`
- `cardKind=collection` 且没有显式封面时不尝试获取媒体链接，直接显示合集占位封面
- 批量拿链接
- 对显式封面回填 `coverUrl`
- 对无显式封面的卡片回填 `videoPreviewUrl`

失败时当前会：

- 保留卡片
- 只是不显示封面或视频预览
- 用占位卡面兜底

### 5.4 双击打开视频

双击卡片后当前链路是：

1. 如果 `cardKind=collection`，直接打开 `video-archive://library/:libraryId/node/:cardId`，相当于继续进入子归档，并把当前归档作为 `returnTarget`
2. 否则调用 `getFileLink(card.mediaNodeId || card.id, libraryId, expiry)`
3. 收集字幕候选：
   - `VIDEO` 文件夹卡片读取卡片目录内的字幕文件，按 `sortOrder` / `id` 排序
   - 历史直属视频文件按同级同名字幕兼容匹配
4. 用 `setFileUrl` 打开普通 `video` viewer
5. 透传 `returnTarget` 和 `videoSubtitleSources`

`returnTarget` 当前关键内容包括：

- 归档页 `fileUrl`
- 归档页 `fileName`
- `fileType = 'video_archive'`
- `nodeId`
- `tabTypeLabel = 'VIDEO-ARCHIVE'`

这部分如果丢了，用户从视频页返回归档页的体验就会断掉。

`videoSubtitleSources` 只传可序列化的节点摘要（字幕节点 id、libraryId、文件名和排序值）。真正的字幕链接仍由普通 `VideoViewer` 在播放页按需获取，避免归档页缓存里保存过期的临时链接。

合集嵌套的返回是逐层语义：

- 父归档打开子合集时，子归档 tab 的 `returnTarget` 指向父归档
- 子归档打开内部视频时，视频 tab 的 `returnTarget` 指向子归档
- 用户从视频返回子归档时，页面会保留子归档 tab 既有的 `returnTarget`，因此还能继续从子归档返回父归档
- 更深层合集按同一规则套用，前提是中间归档 tab 未被手动关闭

### 5.5 卡片右键菜单

当前右键菜单支持：

- 重命名
- 在目录树中定位
- 删除

这些操作不是单独页面级功能，而是跟具体卡片绑定的资源管理动作。

## 6. 当前最值得小心的点

- `video_archive` 和普通 `video` 是两层 viewer，不要混成一个页面
- 卡片来源当前是归档分页接口，不是目录树递归扫描；`VIDEO` 文件夹只取第一代内部资源
- 归档嵌套只把直属子归档显示成合集卡片，不在父归档卡片页递归拉平孙级内容
- `coverNodeId`、`coverUrl` 和 `videoPreviewUrl` 是展示阶段字段，不能假设一开始就有可显示封面
- `mediaNodeId` 是实际播放目标；卡片 `id` 仍然用于重命名、删除和目录树定位
- 返回链路依赖 `returnTarget`，改打开逻辑时必须一起验证
- snapshot cache 里不只存卡片，还存滚动位置和分页信息

## 7. 阅读顺序

建议按这个顺序读：

1. `src/features/archive-viewer/components/video-archive-viewer/index.tsx`
2. `src/features/archive-viewer/components/video-archive-viewer/style.ts`
3. `src/features/file-viewer/components/file-dispatcher/index.tsx`
4. `src/views/library/detail/index.tsx`
5. `docs/viewers/archive-viewer.md`

## 8. 何时继续细分文档

当下面任一项继续膨胀时，应该继续在 `docs/viewers/` 下拆子文档：

- 归档卡片来源和分页协议
- 封面策略
- 返回链路
- 卡片级资源操作

建议未来的拆分方向：

- `docs/viewers/video-archive-cover-strategy.md`
- `docs/viewers/video-archive-return-target.md`

## 9. 验证方式

涉及 `video-archive-viewer` 改动时，至少手工验证：

1. 归档页能正确展示视频卡片。
2. 滚动加载更多仍然正常。
3. 有 `coverNodeId` 的卡片能正确补出封面。
4. 视频文件夹卡片会打开内部主视频，删除 / 重命名仍作用于卡片节点本身。
5. 无封面的卡片会优先匹配同名封面，再显示视频首帧预览；链接不可用时走占位卡面，不会白块。
6. 字幕伴随资源数量能在卡片状态上展示，不会单独变成视频卡片。
7. 双击卡片能打开普通视频 viewer。
8. 从普通视频 viewer 返回时，仍能回到原视频归档页。
9. 重命名、删除、目录树定位仍然正常。
10. 切换 tab 再回来后，列表和滚动位置仍能恢复。
11. 视频单元存在字幕时，打开普通视频 viewer 后会默认加载排序最靠前的库内字幕；多个字幕可在视频操作台切换。

## 10. 维护规则

出现以下任一变化时，必须回写本文：

- `video-archive://` 路由格式变化
- 分页协议变化
- 封面策略变化
- `returnTarget` 结构变化
- 右键菜单能力变化
- snapshot cache 结构变化
