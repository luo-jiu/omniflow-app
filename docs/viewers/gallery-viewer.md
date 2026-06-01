# Gallery Viewer 说明

更新时间：2026-06-01
适用范围：`src/features/file-viewer/components/gallery-viewer/` 下的图集目录预览、图片 / 视频详情切换和 MediaHub 接入。

## 1. 概述

`GalleryViewer` 是 `GALLERY + archiveMode=0` 目录的普通内置类型 viewer。

它的用户心智接近手机相册：

- 进入目录后先展示图片和视频组成的网格。
- 网格卡片不直接显示文件名，避免把相册视觉降级成文件列表；文件名只保留为悬停 title / 无障碍辅助信息。
- 点击某个媒体后仍停留在当前 tab 内进入详情态。
- 详情态用左右按钮或键盘左右键切换上一项 / 下一项。
- 详情态顶部提供媒体详情按钮，先以弹框展示基础信息和图片 EXIF 中可读的拍摄时间、定位、相机信息等字段。
- 图片和视频详情都由 `GalleryViewer` 自己渲染，不复用普通 `ImageViewer` / `VideoViewer` 组件。

`GALLERY + archiveMode=1` 已由 `GalleryArchiveViewer` 承接，普通 `GalleryViewer` 只负责单个图集内部的图片 / 视频浏览。

## 2. 当前结构

- `index.tsx`
  - 加载目录直属子节点
  - 过滤图片 / 视频媒体
  - 管理网格、详情态、图片查看状态和视频播放状态
  - 通过 `floatingVideoService` 接入 MediaHub
- `style.ts`
  - 相册网格、模糊占位、大图 / 视频详情和底部视频控制条样式

## 3. 数据与加载规则

图集只读取当前目录的直属一代子节点：

- 图片：`image/*` MIME 或常见图片扩展名。
- HEIC / HEIF：归入图片媒体，但不要求浏览器原生支持解码。
- 视频：`video/*` MIME、`application/vnd.apple.mpegurl` 或常见视频扩展名。
- 隐藏文件和子目录不会进入图集媒体列表。

网格页不会在首次渲染时把全部媒体解码进内存：

- 初始只为前一批媒体请求临时链接。
- 鼠标进入卡片或打开详情时再补请求对应链接。
- 图片缩略图使用 `loading="lazy"` 和 `decoding="async"`。
- 缩略图加载前显示模糊占位。

HEIC / HEIF 预览走 Electron 本地代理：

- Renderer 仍通过原文件临时链接识别媒体，后端文件事实不变。
- `electron/preload.ts` 暴露 `prepareImagePreview`，主进程 IPC `image-preview:prepare` 下载临时链接到本地临时输入，再用 `ffmpeg` 生成 PNG 预览，并把本地 file URL 返回给 Renderer。
- 预览和元信息缓存在 `app.getPath('userData')/gallery-preview-cache`，按 `libraryId-nodeId` 加源文件指纹记录，不把 PNG 回写后端，也不替换原 HEIC 文件。
- HEIC 详情元信息先通过 macOS `sips -g all` 读取拍摄时间、相机型号、色彩信息、尺寸等可读字段；如果图片本身没有定位或系统命令读不到定位，不在前端伪造。

## 4. 详情态

图片详情：

- 支持拖拽平移、滚轮缩放、旋转和重置。
- 支持在当前缩放 / 平移状态下裁剪可见图片区域；裁剪结果作为当前图集目录下的图片副本上传，命名为“原名 副本 / 原名 副本1 …”，并排到被裁剪图片前面。
- 旋转不做过渡动画，点击后直接切到下一个 90° 状态。
- 详情弹框会尝试读取图片尺寸、文件大小和 JPEG EXIF 信息；HEIC / HEIF 使用本地预览代理提供的原图大小和 `sips` 可读元信息；读不到 EXIF / HEIC 元信息时显示明确提示。
- 状态只属于当前图集 viewer，不写入 `FileViewerContext` 或后端 `viewMeta`。

视频详情：

- 使用图集自己的视频布局和控制条。
- 视频元素仍通过 `global-video-elements` 和 `floatingVideoService` 管理。
- 首次播放后由 `floatingVideoService` 注册到 MediaHub。
- 切换到另一项或回到网格时释放当前图集视频；切换 tab 或离开资料库时沿用 MediaHub 契约的保活 / handoff 行为。

## 5. 边界

`GalleryViewer` 不负责：

- 文件树状态和节点配置。
- 普通图片 viewer / 普通视频 viewer 的功能演进。
- 图集归档 viewer 的卡片加载与逐层进入。
- 跨 tab 播放列表或视频观看进度持久化。

`FileViewerContext` 只保存当前图集 tab 的文件事实，图集内部选中项、缩放、旋转和视频进度都不上提。

## 6. 验证方式

涉及图集 viewer 改动时，至少验证：

1. `GALLERY` 目录双击进入图集 viewer。
2. 网格只展示直属图片和视频，不展示目录、字幕、文本等文件。
3. 图片详情可左右切换、缩放、拖拽、旋转和重置。
4. 图片缩放 / 平移后进入裁剪，选框仍落在当前可见图片区域；保存后新图片使用副本命名并出现在原图前面。
5. 网格和详情顶部不直接显示文件名；悬停卡片仍能看到 title。
6. 图片详情按钮可打开媒体详情弹框；有 EXIF 的图片能显示拍摄时间 / 定位等字段，无 EXIF 时有明确提示。
7. HEIC / HEIF 在本机有 `ffmpeg` 时能生成缩略图和详情大图；详情弹框能展示 `sips` 可读的时间、相机、尺寸等信息。
8. 视频详情可播放、暂停、seek，并且开始播放后 MediaHub 出现视频 entry。
9. 从视频切换到图片或回到网格后，当前图集视频被释放。
10. 关闭图集 tab 后，图集视频从 MediaHub 消失。
11. 切换到其他 tab 再回来，图集 tab 不丢失当前前端状态。

## 7. 维护规则

出现以下变化时必须更新本文：

- 图集媒体过滤规则变化。
- 图集开始支持递归、分页、搜索或排序。
- 图集视频 MediaHub 接入方式变化。
- HEIC / HEIF 预览缓存、IPC 或元信息读取方式变化。
- 图集图片裁剪、副本命名或排序语义变化。
- 新增 `gallery_archive` 或图集归档 viewer。
