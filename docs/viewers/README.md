# Viewer 文档入口

更新时间：2026-04-16
适用范围：`file-viewer`、`archive-viewer` 以及后续各类具体 viewer 的长期说明文档。

## 1. 作用

本目录是 OmniFlow 前端 viewer 体系的统一文档入口。

目标不是把所有 viewer 细节都堆进 `AGENTS.md`，而是让：

- `AGENTS.md`
  - 只暴露一个稳定入口
- `docs/viewers/README.md`
  - 负责继续分发阅读路径
- `docs/viewers/*.md`
  - 分别沉淀具体 viewer 或 viewer 体系文档

这样后续即使 viewer 数量继续增加，也不会让入口层变成一串越来越长的路径清单。

## 2. 当前文档地图

- `file-viewer.md`
  - 普通 viewer 体系入口、职责和阅读顺序
- `archive-viewer.md`
  - 归档 viewer 体系入口、职责和阅读顺序
- `asmr-viewer.md`
  - ASMR 集合 viewer 的局部模型、缓存、播放协作和编辑链路
- `comic-viewer.md`
  - 漫画 viewer 的阅读模式、进度恢复、远端同步和视图设置
- `pdf-viewer.md`
  - PDF viewer 的 pdf.js 渲染、窗口化分页、锚点恢复和缩放重排
- `text-viewer.md`
  - 文本文档 viewer 的 CodeMirror 编辑、暂存上传保存和链接刷新链路
- `video-viewer.md`
  - 普通视频 viewer 的底部控制条、右侧操作台和字幕覆盖层
- `video-archive-viewer.md`
  - 视频归档 viewer 的卡片来源、封面策略、缓存恢复和返回链路

## 3. 阅读顺序

建议按这个顺序读：

1. `docs/file-viewer-and-archive-viewer-map.md`
2. `docs/viewers/file-viewer.md`
3. `docs/viewers/archive-viewer.md`
4. 再按需读具体 viewer：
   - `docs/viewers/asmr-viewer.md`
   - `docs/viewers/comic-viewer.md`
   - `docs/viewers/pdf-viewer.md`
   - `docs/viewers/text-viewer.md`
   - `docs/viewers/video-viewer.md`
   - `docs/viewers/video-archive-viewer.md`

## 3.1 跨 tab 播放策略

当前 viewer 体系的跨 tab / 多媒体规则：

- 视频 viewer 不再因为所在 tab 失活而自动 pause；保留进度落库（`persistVideoProgress(true)`），但不再触发 `<video>.pause()`。多个视频可在不同 tab 并行播放。
- 音频 viewer / asmr viewer 共用 `globalAudioPlayer` 单例 `<audio>`，所以同一时刻仍只能有一个音频源在播放（属预期范围）；但音频不再因切换 tab 而出现"顶部 GlobalAudioMiniBar"那条额外 UI。
- video 启动播放不再调用 `globalAudioPlayer.pause()` 暂停音频；audio 启动播放不再暂停所有视频。音视频可并行。
- 所有 audio / video / asmr viewer 在挂载且首次播放后向 `MediaRegistry` 注册自身，由 `library detail` 工具栏右侧的"媒体控制中心"集中展示与控制，详见 `docs/library-detail-workspace.md` §11。

## 4. 落点规则

从现在开始，viewer 相关长期文档优先放在：

- `docs/viewers/`

而不是散落在：

- `src/features/file-viewer/README.md`
- `src/features/archive-viewer/README.md`
- `src/features/**/components/**/docs/README.md`

代码目录里的 README 只有在下面情况才值得保留：

- 它是临时代码导览，不属于长期知识
- 它强依赖与代码紧邻维护，而且不会进入全局阅读入口

对 viewer 体系来说，长期知识更适合集中在 `docs/viewers/` 管理。

## 5. 何时新增单个 viewer 文档

满足任一条件时，应在本目录新增一个单独文档，而不是继续往总文档里堆：

- viewer 有独立状态机
- viewer 有缓存、恢复、排序、搜索、分页等复杂行为
- viewer 有独立播放器或媒体协作模型
- viewer 有项目内部术语，不适合只留在代码里
- viewer 已成为多人或多 agent 高频改动点

## 6. 维护规则

出现以下任一变化时，必须更新本目录的索引或新增对应文档：

- 新增新的 viewer
- 某个 viewer 复杂度明显上升
- viewer 文档路径调整
- 阅读顺序发生变化
