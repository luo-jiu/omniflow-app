# Gallery Archive Viewer 说明

更新时间：2026-06-01
适用范围：`src/features/archive-viewer/components/gallery-archive-viewer/` 下的图集归档卡片视图、封面解析和返回链路。

## 1. 概述

`GalleryArchiveViewer` 是 `GALLERY + archiveMode=1` 目录的归档 viewer。

它展示的不是单张图片，而是一组“相册分类”卡片：

- 当前归档目录下的直属 `GALLERY + archiveMode=0` 子目录会显示为普通图集卡片。
- 当前归档目录下的直属 `GALLERY + archiveMode=1` 子目录会显示为下级归档卡片。
- 单击普通图集卡片进入 `GalleryViewer`；单击下级归档卡片进入下一层 `GalleryArchiveViewer`。

## 2. 数据规则

图集归档只读取当前目录的直属一代子目录：

- 不递归铺平孙级图集。
- 不展示普通文件、非 `GALLERY` 子目录或隐藏文件。
- 卡片初始只渲染直属 `GALLERY` 子目录本身，不立即读取每个相册内部文件。
- 卡片进入视口附近后才读取该图集目录直属一代中的图片 / 视频数量，并取第一张图片作为封面。
- 封面和数量加载有前端并发上限，避免归档页一次性触发大量临时链接请求或 HEIC 转码。

如果封面是 HEIC / HEIF，归档页会复用 Electron `prepareImagePreview` 本地预览代理生成 PNG 封面，并通过本地 file URL 展示，不要求浏览器原生支持 HEIC，也不把预览图写回后端。

## 3. 导航

图集归档使用与漫画归档一致的显式返回栈：

- 从图集归档进入普通图集时，普通图集 tab 的 `returnTarget` 指向当前图集归档。
- 从图集归档进入下级图集归档时，下级归档 tab 的 `returnTarget` 指向当前图集归档。
- 直接从目录树打开中间层图集归档时，不自动推断隐藏父级。

## 4. 边界

`GalleryArchiveViewer` 不负责：

- 单个图集内部图片 / 视频详情查看。
- 普通图片 viewer 或普通视频 viewer。
- 跨层搜索、递归聚合或智能分类。
- 图集封面持久化到后端。

## 5. 验证方式

涉及图集归档改动时，至少验证：

1. `GALLERY + archiveMode=1` 目录双击进入图集归档 viewer。
2. 归档页只展示直属 `GALLERY` 子目录。
3. 普通图集卡片单击进入 `GalleryViewer`。
4. 下级图集归档卡片单击进入下一层 `GalleryArchiveViewer`。
5. 卡片进入视口附近后再加载数量和封面；大量图集不会在首屏一次性请求全部子文件。
6. 卡片封面优先显示该图集第一张图片；HEIC / HEIF 封面能生成 PNG 预览。
7. 从图集返回归档时，返回链路仍指向原归档 tab。

## 6. 维护规则

出现以下变化时必须更新本文：

- 图集归档开始支持递归、分页、搜索或智能分类。
- 图集归档卡片来源不再是直属 `GALLERY` 子目录。
- 图集封面策略或 HEIC 预览代理发生变化。
- 返回链路不再使用显式 `returnTarget` 栈。
