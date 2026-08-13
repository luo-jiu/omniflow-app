# PDF Viewer 说明

更新时间：2026-07-31
适用范围：`src/features/file-viewer/components/pdf-viewer/` 下的 PDF 预览、按页渲染、滚动恢复和缩放阅读能力。

## 1. 概述

`pdf-viewer` 不是简单的 `iframe` 包装，而是一个基于 `pdfjs-dist` 的本地渲染 viewer。

它当前同时承担：

- 初始化 `pdf.js` worker
- 加载 PDF 文档并逐页渲染到 canvas
- 维护当前页、缩放、滚动位置和 anchor page
- 用窗口化方式只渲染当前页附近的页
- 在缩放和重排后恢复阅读位置
- 提供页码跳转、缩放、新窗口打开和下载

如果只把它当成“拿 URL 打开 PDF”的外壳来改，最容易把滚动恢复和性能边界改坏。

## 2. 当前结构

- `index.tsx`
  - 主体实现，包含 worker 初始化、文档加载、分页渲染、状态恢复和底部控制栏
- `style.ts`
  - PDF 预览区域、分页外观和底部工具栏样式
- `pdf-viewer-session.ts`
  - PDF snapshot schema、payload 类型和反序列化校验
- `pdf-viewer-navigation.ts`
  - 页码跳转、布局稳定判断和 viewport anchor 解析
- `pdf-viewer-navigation.test.ts`
  - 未渲染页跳转、页间 gap、布局稳定和边界位置单元测试
- `docs/viewers/pdf-viewer.md`
  - 当前说明

## 3. 关键概念

### 3.1 pdf.js worker

当前 viewer 不是依赖浏览器原生 PDF 插件，而是显式配置：

- `pdfjs-dist/build/pdf.worker.min.mjs`

这意味着：

- 页面渲染逻辑在 pdf.js 体系内
- worker 路径如果失效，整个 PDF 预览会直接出问题

所以后续如果你升级 bundler、调整静态资源路径或换 `pdfjs-dist` 版本，必须优先检查这里。

### 3.2 公共 Viewer Session

`pdf-viewer` 已迁移到公共 `ViewerSessionRegistry`，不再维护独立模块级 `Map`。resource key 由以下稳定事实组成：

- 账号 scope
- `libraryId`
- `node:<nodeId>`
- `viewerKind=pdf`

签名 URL 不进入 resource key。没有正整数 `nodeId` 或稳定账号/资料库身份时，PDF 仍可依赖当前 Hot 实例阅读，但不会写入公共 Warm snapshot。

PDF adapter 使用 schema version 1，payload 包括：

- `currentPage`
- `zoom`
- `scrollTop`
- `scrollRatio`
- `anchorPage`
- `anchorOffsetRatio`

滚动时按动画帧更新 snapshot，active 变为 false 和组件卸载时再次 capture。`reloadToken` 只作为当前 runtime 的失效 generation；变化时删除同资源旧 snapshot，不进入 resource key，也不会留下旧 token 孤儿项。普通关闭 tab 按 PDF policy 保留阅读位置，显式释放资料库或 session 时统一由公共 runtime 清理。

session restore 可能早于 PDF 页数解析完成。此时只先恢复 snapshot/ref，不能把大于当前临时 `max=1` 的页码交给页码控件；文档解析出真实页数后，才同时提交 `numPages` 和受控 `currentPage`。否则 Semi `InputNumber` 会把页码判为非法，并且不会只因后续 `max` 变化重新格式化显示值。

### 3.3 anchor 恢复优先于纯 scrollTop

这个 viewer 恢复滚动位置时，不是单纯依赖 `scrollTop`。

当前恢复优先级大致是：

1. 用 `anchorPage + anchorOffsetRatio` 对齐到对应页
2. 对齐不到时，再回退到 `scrollTop / scrollRatio`

这是因为：

- PDF 页高会随着缩放变化
- 某些页尚未实际渲染出来
- 只记 `scrollTop` 在重排后很容易漂移

所以 `anchorPage` 是更核心的恢复语义。

### 3.4 窗口化渲染

`pdf-viewer` 当前不会把整本 PDF 一次性全部渲染出来，而是只渲染当前页附近的窗口：

- 前 `WINDOW_PAGES_BEFORE`
- 后 `WINDOW_PAGES_AFTER`

窗口之外的页通过虚拟 spacer 占位。

这说明它已经带有明显的性能设计：

- 减少同时存在的 canvas 数量
- 控制长 PDF 的渲染成本
- 仍然保留连续滚动阅读体验

后续如果你想“简单一点全量渲染”，要先考虑大文档的内存和卡顿问题。

### 3.5 页高估算与重排

因为不是所有页都已渲染完成，所以当前 viewer 会维护：

- 每页实际高度
- 平均页高

并用它们来：

- 估算未渲染页的偏移
- 计算虚拟 spacer 高度
- 在页码跳转或恢复时推断目标滚动位置

这意味着它其实有一套“小型布局估算器”，不是简单的固定高度列表。

## 4. 当前职责边界

`pdf-viewer` 当前负责：

- PDF 文档加载和销毁
- pdf.js worker 初始化
- 逐页 canvas 渲染
- 当前页计算
- 滚动和缩放状态持久化
- 页码跳转
- 新窗口打开与下载入口

它当前不负责：

- 顶层 `fileType` 分发
- 归档 PDF 语义
- 工作区 tab 生命周期
- 文件链接的生成本身

这几块分别优先看：

- `src/features/file-viewer/components/file-dispatcher/index.tsx`
- `src/features/archive-viewer/`
- `src/components/business/app-main/index.tsx`
- 文件打开链路的上游调用方

## 5. 关键流程

### 5.1 文档加载

建议顺着这条链路阅读：

1. 用 `url` 调用 `getDocument`
2. 加载成功后拿到 `PDFDocumentProxy`
3. 由 session adapter 校验并恢复 `currentPage` / `zoom`
4. 初始化待恢复滚动信息
5. 文档和布局 ready 后再按 anchor 执行滚动定位并计算渲染窗口

失败时当前会进入：

- `PDF 加载失败`

而不是静默白屏。

### 5.2 单页渲染

每页由 `PdfPageCanvas` 单独负责：

- 获取 `pdfDoc.getPage(pageNumber)`
- 基于 stage 宽度和 zoom 计算 viewport
- 按 `devicePixelRatio` 渲染到 canvas
- 上报本页真实渲染高度

这里最值得注意的是：

- CSS 尺寸和像素尺寸分开计算
- 高 DPI 屏幕下会走更高像素密度渲染

### 5.3 滚动中的当前页计算

滚动时当前 viewer 会同时做几件事：

- 记录 `scrollTop`
- 计算 `scrollRatio`
- 解析 viewport anchor
- 从已渲染页 ref 中推断最合理的 `currentPage`
- 把这些状态写回本地 snapshot

所以 `currentPage` 不是“用户点了哪一页”这么简单，而是滚动过程中的派生状态。

### 5.4 页码跳转

底部页码输入框和上一页/下一页按钮，最终都会走：

- `jumpToPage`

当前逻辑会：

1. 设置 `pendingJumpPageRef`
2. 尝试优先用已渲染页的 DOM 定位
3. 如果目标页还没渲染，就用估算高度计算目标偏移
4. 保持 jump pending，等待目标页和当前渲染窗口测量稳定
5. 用目标页精确 DOM 位置完成定位并同步 snapshot

这说明它并不是只能跳到“已在屏幕上的页”，而是有一套针对未渲染页的估算跳转机制。

### 5.5 缩放与重排恢复

缩放和 stage 宽度变化都会触发分页重排。当前处理顺序是：

- 在旧布局仍有效时捕获当前 `anchorPage + anchorOffsetRatio`
- 建立 pending restore，阻止重排中的原生 scroll clamp 改写当前页
- debounce 后提交新的 stage render width
- 页高缓存清空
- layout revision 增加
- 目标页及其之前的渲染窗口测量稳定后，按 anchor 完成 restore

所以缩放或打开右侧 DevTools 这类宽度变化不仅是 UI 尺寸变化，它们都会影响整套分页布局和恢复逻辑。

## 6. 当前最值得小心的点

- `anchorPage` 比 `scrollTop` 更关键，恢复逻辑不要只盯 `scrollTop`
- 缩放会导致页高估算失效，所以重排时必须重新走恢复链路
- stage 宽度变化必须在提交新宽度前捕获 anchor，不能等浏览器把 `scrollTop` clamp 到新范围后再推导当前页
- 虚拟 spacer 高度依赖平均页高和已测量页高，修改时要防止跳页或滚动漂移
- `currentPage` 是滚动派生状态，不要把它当成唯一输入状态反向驱动一切
- `pdfDoc` 和 `loadingTask` 都有资源释放语义，生命周期改动时要确认销毁逻辑

## 7. 阅读顺序

建议按这个顺序读：

1. `src/features/file-viewer/components/pdf-viewer/index.tsx`
2. `src/features/file-viewer/components/pdf-viewer/style.ts`
3. `src/features/file-viewer/components/file-dispatcher/index.tsx`
4. `docs/file-viewer-and-archive-viewer-map.md`

## 8. 何时继续细分文档

当下面任一项继续膨胀时，应该继续在 `docs/viewers/` 下拆子文档：

- pdf.js worker 与资源加载策略
- anchor 恢复与滚动同步模型
- 虚拟化分页与高度估算
- 页码跳转与缩放重排

建议未来的拆分方向：

- `docs/viewers/pdf-scroll-restore.md`
- `docs/viewers/pdf-virtualized-layout.md`

## 9. 验证方式

涉及 `pdf-viewer` 改动时，至少手工验证：

1. PDF 能正常加载并显示页内容。
2. 长 PDF 滚动时不会整本一次性卡死。
3. 页码输入框、上一页、下一页都能正确跳转。
4. 缩放后仍能维持合理阅读位置，不会明显跳页。
5. 切换 tab 再回来后，页码和阅读位置仍能恢复。
6. 关闭 tab 再打开符合 `retain-reading-position`，实际视口和页码控件显示一致。
7. 调整窗口宽度或打开/关闭右侧 DevTools 后，仍按页锚点保持阅读位置。
8. 新窗口打开和下载按钮仍然正常。

## 10. 维护规则

出现以下任一变化时，必须回写本文：

- `pdfjs-dist` worker 初始化方式变化
- snapshot 结构变化
- anchor 恢复逻辑变化
- 窗口化渲染范围变化
- 页码跳转逻辑变化
- 缩放与重排策略变化
