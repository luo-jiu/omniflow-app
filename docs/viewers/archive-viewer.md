# Archive Viewer 说明

更新时间：2026-08-04
适用范围：`src/features/archive-viewer/` 下的归档语义 viewer 和相关辅助能力。

## 1. 作用

`archive-viewer` 负责归档语义目录的预览，不替代普通 `file-viewer`。

它当前主要承接：

- `video_archive`
- `audio_archive`
- `asmr_archive`
- `comic_archive`
- `gallery_archive`

这些 viewer 与普通 `video`、`asmr`、`comic` viewer 的区别，不只是界面不同，还包括它们在工作区中的导航语义不同。

其中 `video_archive` 当前是独立的视频墙视图：

- 双击卡片打开普通 `video` viewer
- 通过 `returnTarget` 返回原视频归档页
- 卡片数据来自归档目录下的第一代视频单元：优先支持直属 `VIDEO` 文件夹，兼容历史直属视频媒体文件
- `VIDEO` 内置类型只允许设置到文件夹；文件夹卡片通过 `mediaNodeId` 打开内部主视频
- 封面优先走 `coverNodeId`，其次兼容文件夹内封面，最后用视频首帧预览兜底；归档页不全量扫描归档根目录来匹配历史同名封面
- 字幕作为伴随资源计数展示，不单独变成视频卡片

其中 `audio_archive` 当前是独立的音频归档视图：

- 归档页展示歌曲列表，不再复用视频卡片墙
- 单击歌曲行只选中，双击歌曲行或点击封面 hover 播放按钮才开始播放
- 底部播放器由 `globalAudioPlayer` 承担播放状态，支持上一首、下一首、顺序播放、列表循环、单曲循环和随机播放
- 首次播放后会以当前归档 tab 注册到 `MediaRegistry`，因此工具栏媒体控制中心可以控制播放 / 暂停 / seek / 移除
- 点击底部封面会在归档页内进入完整播放视图，列表退场，只保留大封面、歌词和底部播放控制；再次点击底部封面可折叠回歌曲列表
- 也可以从底部按钮打开普通 `audio` viewer，并通过 `returnTarget` 返回原音频归档页
- 卡片数据来自归档目录下的直属歌曲单元：优先支持直属 `AUDIO` 普通文件夹，兼容历史直属音频媒体文件
- 歌曲文件夹内第一个音频文件作为主媒体，第一个图片文件作为封面，字幕 / 歌词文件作为伴随资源候选；直属普通音频文件不要求单独设置 `builtInType = AUDIO`
- 歌词支持 `.lrc / .srt / .vtt / .ass / .ssa / .qrc.xml`；其中 QQ 音乐 QRC XML 会解析字级时间轴，音乐归档展开页用可滚动歌词滚筒展示，当前句自动居中放大，点击歌词可跳转播放，高精度歌词会按真实播放时间平滑从左到右填色
- 音频归档页不全量扫描归档根目录来匹配历史同名封面 / 歌词；需要伴随资源时优先使用歌曲文件夹结构
- 音频归档 Warm snapshot 只保存稳定选中卡片和卡片墙锚点；播放 URL、歌词候选和卡片数组不进入 snapshot。从普通音频详情页返回归档时，按全局音频 `audio:node:<id>` owner 反向匹配 `mediaNodeId`，让列表高亮和底部播放器继续指向正在播放的歌曲
- 上级音频归档视图不会把直属 `AUDIO + archiveMode=1` 子目录展示为合集；这类下级归档可以存在，但不进入上级歌曲列表

其中 `comic_archive` 当前是漫画归档墙视图：

- 卡片数据只来自当前归档目录的直属一代子节点，不递归展开孙级
- 直属 `COMIC + archiveMode=0` 目录作为普通漫画卡片，双击进入 `ComicViewer`
- 直属 `COMIC + archiveMode=1` 目录作为“合集”卡片，双击进入该子目录的 `ComicArchiveViewer`
- 任何层级都遵守同一条规则，因此 `归档 -> 归档 -> 归档 -> 漫画` 会逐层进入，而不是在最上层一次性铺平
- 如果用户从目录树直接打开中间层归档，返回栈从该归档开始，不自动推断隐藏父级
- 从归档卡片进入子归档或普通漫画时，`returnTarget` 会携带当前归档；子归档再进入下一层时会继续串起上一级，顶部返回按钮按显式栈逐级返回

其中 `gallery_archive` 当前是图集归档视图：

- 卡片数据来自当前归档目录的直属一代 `GALLERY` 子目录，不递归铺平孙级内容。
- 直属 `GALLERY + archiveMode=0` 目录作为普通图集卡片，单击进入普通 `GalleryViewer`。
- 直属 `GALLERY + archiveMode=1` 目录作为下级图集归档卡片，单击进入下一层 `GalleryArchiveViewer`。
- 卡片进入视口附近后才读取该图集目录的一代图片 / 视频数量，并用第一张图片作为封面；如果第一张图片是 HEIC / HEIF，则复用 Electron 本地预览代理生成 PNG 封面。
- 从归档卡片进入子归档或普通图集时，`returnTarget` 会携带当前归档，返回链路与漫画归档保持同一套显式栈模型。

归档卡片右键中的“属性”必须走目录树同一套节点属性 overlay；卡片只提供节点 id 和标题，属性内容仍以 `fetchNodeDetailById` 等节点接口返回的真实数据为准。

## 2. 当前结构

- `components/video-archive-viewer/`
- `components/audio-archive-viewer/`
- `components/asmr-archive-viewer/`
- `components/comic-archive-viewer/`
- `components/gallery-archive-viewer/`
- `hooks/useArchiveCardGrid.ts`
- `utils/archive-sort.ts`

五类归档 viewer 都通过公共 Viewer Session Registry 保存最小阅读现场。卡片数组、分页响应、计数和临时封面/媒体链接始终重新请求；snapshot 只保存稳定卡片锚点、锚点内偏移、整体滚动比例、绝对滚动兜底，以及 Audio Archive 的稳定选择。刷新通过公共 reload generation 精确失效旧 snapshot，不再维护逐 viewer cache key。

Comic Archive 和 ASMR Archive 还会把语义阅读位置写入 `viewMeta`。同进程命中 Warm 时以 Warm 为准；未命中时才采用远端位置。恢复会继续分页直到锚点出现，锚点删除后按比例和绝对位置降级。分页更新不能改变 session adapter 引用，否则会重复注册并把用户拉回旧位置。

`components/comic-archive-viewer/index.tsx` 只保留页面编排、加载和渲染；新增或修改漫画归档卡片类型、DTO 映射、返回栈导航或阅读位置解析时，优先维护同目录下的 `comic-archive-card-mapper.ts`、`useComicArchiveNavigation.ts` 和 `comic-archive-progress.ts`，不要继续把规则堆回主组件。

## 3. 阅读顺序

建议按这个顺序读：

1. `../file-viewer/components/file-dispatcher/index.tsx`
2. `components/video-archive-viewer/`
3. `components/asmr-archive-viewer/`
4. `components/comic-archive-viewer/`
5. `components/gallery-archive-viewer/`
6. `../../views/library/detail/index.tsx`
   - 关注归档返回链路

## 4. 何时继续细分文档

如果后续某个归档 viewer 出现：

- 独立卡片布局规则
- 排序、筛选、搜索、分页
- 媒体回放状态机
- 明显不同于普通 viewer 的导航和交互

就应该在 `docs/viewers/` 下继续补对应 viewer 文档，而不是继续把所有解释都堆在一份总文档里。

当前如果 `video_archive` 后续继续膨胀，最适合先拆出的子文档方向会是：

- `docs/viewers/video-archive-viewer.md`
- 重点记录卡片来源、封面策略、返回链路和批量操作

## 5. 相关文档

- `docs/viewers/README.md`
- `docs/file-viewer-and-archive-viewer-map.md`
- `docs/built-in-type-and-archive-mode.md`
- `docs/file-explorer-file-viewer-boundary.md`
- `docs/viewers/video-archive-viewer.md`
