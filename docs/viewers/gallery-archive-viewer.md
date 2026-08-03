# Gallery Archive Viewer 说明

更新时间：2026-08-03
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

## 3. Viewer Session 契约

`GalleryArchiveViewer` 已接入公共 `ViewerSessionRegistry`。resource key 使用稳定账号 scope、显式 `libraryId`、`node:<folderNodeId>` 和 `viewerKind=gallery_archive`；`gallery-archive://` 入口 URL、签名封面 URL 和 HEIC 本地预览 URL 不参与身份。

Gallery Archive snapshot schema version 为 1，只保存：

- 当前滚动位置的稳定卡片节点 ID。
- 卡片内偏移比例。
- 整体滚动比例和绝对 `scrollTop` 降级值。

不保存：

- 卡片列表、图片 / 视频计数和 cover node。
- 签名封面 URL、HEIC 本地预览 URL。
- lazy detail 队列、loading / error、右键菜单和属性弹层。

恢复时先重新读取直属图集目录并完成当前卡片网格布局，再优先按卡片节点锚点定位；锚点已不存在时降级到滚动比例，最后使用绝对 `scrollTop`。

卡片封面层必须保留可计算的方形尺寸：`.gallery-album-stack` 使用 `width: 100%`、固定 flex basis 和 `aspect-ratio: 1 / 1`。封面、标题遮罩等绝对定位子元素不参与父级高度计算，不能依赖它们撑开卡片；否则长卡片墙会塌缩，滚动恢复也失去稳定布局基线。

生命周期语义：

- 普通 tab 失活或工作区真卸载：capture Warm snapshot，重新挂载后恢复卡片位置。
- reload：按 `reloadToken` 失效旧 snapshot，重新从顶部加载。
- 关闭 tab：`closeBehavior=discard`，重新打开从顶部开始。
- 资料库或 auth session 释放：由公共 runtime 统一清理。
- Cold：当前为 `none`。

## 4. 导航

图集归档使用与漫画归档一致的显式返回栈：

- 从图集归档进入普通图集时，普通图集 tab 的 `returnTarget` 指向当前图集归档。
- 从图集归档进入下级图集归档时，下级归档 tab 的 `returnTarget` 指向当前图集归档。
- 直接从目录树打开中间层图集归档时，不自动推断隐藏父级。

## 5. 边界

`GalleryArchiveViewer` 不负责：

- 单个图集内部图片 / 视频详情查看。
- 普通图片 viewer 或普通视频 viewer。
- 跨层搜索、递归聚合或智能分类。
- 图集封面持久化到后端。

## 6. 验证方式

涉及图集归档改动时，至少验证：

1. `GALLERY + archiveMode=1` 目录双击进入图集归档 viewer。
2. 归档页只展示直属 `GALLERY` 子目录。
3. 普通图集卡片单击进入 `GalleryViewer`。
4. 下级图集归档卡片单击进入下一层 `GalleryArchiveViewer`。
5. 卡片进入视口附近后再加载数量和封面；大量图集不会在首屏一次性请求全部子文件。
6. 卡片封面优先显示该图集第一张图片；HEIC / HEIF 封面能生成 PNG 预览。
7. 从图集返回归档时，返回链路仍指向原归档 tab。
8. 文件 tab 往返和工作区真卸载后恢复同一卡片锚点；窗口宽度造成列数变化时仍以该卡片为主。
9. 锚点卡片被删除时按滚动比例合理降级；reload 和关闭重开均回到顶部。
10. 卡片列表、计数、封面和 HEIC 预览重新加载，snapshot 中不含临时资源 URL。

## 7. 维护规则

出现以下变化时必须更新本文：

- 图集归档开始支持递归、分页、搜索或智能分类。
- 图集归档卡片来源不再是直属 `GALLERY` 子目录。
- 图集封面策略或 HEIC 预览代理发生变化。
- 返回链路不再使用显式 `returnTarget` 栈。
- Gallery Archive snapshot 字段、恢复时序或关闭语义变化。
