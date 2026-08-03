# Image Viewer 说明

更新时间：2026-08-03
适用范围：`src/features/file-viewer/components/image-viewer/` 下的普通图片预览、变换、裁剪和 Viewer Session 恢复能力。

## 1. 概述

`image-viewer` 负责普通图片与 HEIC/HEIF 预览，并提供缩放、平移、旋转、裁剪副本和右键操作。它已接入公共 `ViewerSessionRegistry`，真卸载后可以在当前运行 session 内恢复阅读现场，但关闭 tab 仍按产品语义丢弃现场。

## 2. 当前结构

- `index.tsx`
  - 图片加载、缩放、平移、旋转、裁剪和 session adapter
- `style.ts`
  - 图片舞台、浮动信息和状态样式
- `image-viewer-session.ts`
  - snapshot schema、payload 校验和边界归一化
- `image-viewer-session.test.ts`
  - snapshot 解析、绝对偏移降级和非法值测试
- `image-crop-overlay`
  - 裁剪交互；不属于可恢复 session 状态

## 3. Viewer Session 契约

resource key 使用稳定账号 scope、`libraryId`、`node:<nodeId>` 和 `viewerKind=image`。签名 URL、HEIC 预览 URL 和本地临时路径都不进入身份。

Image snapshot schema version 为 1，只保存：

- `zoom`
- `offsetX` / `offsetY`
- `offsetRatioX` / `offsetRatioY`
- `rotateSteps`

不保存：

- `baseScale`，它由当前图片尺寸和容器重新计算
- 裁剪模式、裁剪范围和裁剪选区
- 拖拽、空格平移模式和鼠标锚点
- 右键菜单、loading、error
- HEIC 临时预览 URL

绝对 offset 用于同尺寸恢复和无可测容器时降级；比例 offset 用于真卸载后容器尺寸变化的恢复。恢复优先使用当前容器宽高乘以比例，比例不可用时才使用绝对值。

## 4. 恢复时序

公共 session restore 可能早于 `<img>` 完成加载。此时 adapter 只保存 pending snapshot，不能立即用旧图片尺寸计算视图。

恢复顺序是：

1. session adapter 校验 snapshot 并登记为当前资源的 pending restore。
2. URL 切换 effect 清理上一资源的运行态，但保留同一资源的 pending restore。
3. 图片 `onLoad` 写入 natural size，并按当前容器计算 `baseScale`。
4. 如果存在同资源 pending restore，则应用 zoom、offset 和 rotation；否则执行默认 fit。

用户主动执行“重置视图”会取消 pending restore，避免异步加载完成后把用户拉回旧现场。

## 5. 生命周期语义

- 普通 tab 失活：capture Warm snapshot，不重置图片变换。
- 工作区模式切换或真卸载：卸载前 capture，重新挂载并 ready 后恢复。
- reload：按 `reloadToken` 失效同资源旧 snapshot，再以默认 fit 打开。
- 关闭 tab：`closeBehavior=discard`，同时删除 snapshot 和对应 live adapter；旧组件 cleanup 不能重新写回。
- 资料库或 auth session 释放：由公共 runtime 统一清理。
- Cold：当前为 `none`，应用重启后不恢复普通图片现场。

## 6. 维护边界

- Viewer 本地 state 是运行时事实，registry snapshot 只是恢复副本。
- 不把变换状态上提到 `FileViewerContext`。
- 不为 Image 再建模块级 `Map` 或双写 cache。
- 新增可恢复字段时必须升级 schema 或保持向后兼容，并同步更新解析测试。
- 新增临时资源时不能把 URL 写入 snapshot。

## 7. 验证方式

涉及 Image Viewer session 时至少验证：

1. 缩放、平移、旋转后切换文件 tab 再返回，现场不变。
2. `file-viewer -> tools/system -> file-viewer` 后现场恢复。
3. 真卸载重建后仍恢复现场。
4. 容器尺寸变化后平移位置按比例合理恢复。
5. reload 后回到默认 fit，不恢复旧变换。
6. 关闭 tab 再打开回到默认 fit，符合 `discard`。
7. 裁剪模式、右键菜单和 dragging 不被恢复。
8. HEIC 临时预览可以重新生成，snapshot 不依赖旧 URL。

## 8. 维护规则

出现 snapshot 字段、恢复时序、关闭语义、HEIC 资源策略或裁剪边界变化时，必须回写本文。
