# File Viewer 说明

更新时间：2026-06-01
适用范围：`src/features/file-viewer/` 下的普通文件预览能力、viewer 分发和局部辅助能力。

## 1. 作用

`file-viewer` 负责普通文件预览，不直接负责目录树，也不直接负责页面工作区切换。

它当前主要承担：

- viewer 分发
- 普通文件/普通语义目录预览
- 局部播放器辅助能力

## 2. 当前结构

- `components/file-dispatcher/`
  - 按 `fileType` 分发 viewer
- `components/image-viewer/`
  - 普通图片预览；HEIC / HEIF 通过 `prepareImagePreview` 生成本地 PNG 预览后复用现有缩放、平移、旋转逻辑。
- `components/audio-viewer/`
- `components/video-viewer/`
- `components/pdf-viewer/`
- `components/text-viewer/`
- `components/comic-viewer/`
- `components/gallery-viewer/`
- `components/asmr-viewer/`
- `components/welcome-view/`
- `services/global-audio-player.ts`
- `utils/*-owner-key.ts`

## 3. 阅读顺序

建议按这个顺序读：

1. `components/file-dispatcher/index.tsx`
2. `../../contexts/file-viewer.context.ts`
3. `../../contexts/FileViewerContext.tsx`
4. 再看具体 viewer

## 4. 何时给单个 viewer 单独写文档

满足任一条件时，建议直接在 `docs/viewers/` 下新增单独文档：

- 组件超过“读一遍就能把状态机讲清”的复杂度
- 有专门的缓存、回放、排序、搜索、分页能力
- 有独立播放器或 keep-alive 约束
- 有明显的业务术语，不适合只留在代码里

当前优先级最高、最值得单独文档化的候选通常会是：

- `asmr-viewer`
- `comic-viewer`
- `pdf-viewer`

## 5. 相关文档

- `docs/viewers/README.md`
- `docs/file-explorer-file-viewer-boundary.md`
- `docs/file-viewer-and-archive-viewer-map.md`
- `docs/built-in-type-and-archive-mode.md`
- `docs/viewers/asmr-viewer.md`
- `docs/viewers/comic-viewer.md`
- `docs/viewers/gallery-viewer.md`
- `docs/viewers/pdf-viewer.md`
- `docs/viewers/text-viewer.md`
