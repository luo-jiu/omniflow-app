# Archive Viewer 说明

更新时间：2026-04-16
适用范围：`src/features/archive-viewer/` 下的归档语义 viewer 和相关辅助能力。

## 1. 作用

`archive-viewer` 负责归档语义目录的预览，不替代普通 `file-viewer`。

它当前主要承接：

- `video_archive`
- `asmr_archive`
- `comic_archive`

这些 viewer 与普通 `video`、`asmr`、`comic` viewer 的区别，不只是界面不同，还包括它们在工作区中的导航语义不同。

其中 `video_archive` 当前是独立的视频墙视图：

- 双击卡片打开普通 `video` viewer
- 通过 `returnTarget` 返回原视频归档页
- 卡片数据来自归档目录下的直属视频媒体文件
- 子视频文件当前不要求再单独设置 `builtInType = VIDEO`
- 封面优先走 `coverNodeId`
- 暂无封面时使用占位卡面，后续再按需补首帧策略

## 2. 当前结构

- `components/video-archive-viewer/`
- `components/asmr-archive-viewer/`
- `components/comic-archive-viewer/`
- `hooks/useArchiveCardGrid.ts`
- `utils/archive-sort.ts`

## 3. 阅读顺序

建议按这个顺序读：

1. `../file-viewer/components/file-dispatcher/index.tsx`
2. `components/video-archive-viewer/`
3. `components/asmr-archive-viewer/`
4. `components/comic-archive-viewer/`
5. `../../views/library/detail/index.tsx`
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
