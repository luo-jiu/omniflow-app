# Drag & Drop Lab

该工具用于验证 Electron renderer DOM、`WebContentsView` 和操作系统文件管理器之间的真实拖拽行为，不连接后端、MinIO 或资料库。

## 启动

```bash
npm run dev:drag-drop-lab
```

自动启动冒烟：

```bash
npm run dev:drag-drop-lab -- --smoke
```

## 布局

- 左侧：宿主 renderer DOM，包含接收区、原生文件拖出入口、Chromium `DownloadURL` 入口和事件日志。
- 右侧：独立 `WebContentsView`，包含网页来源、标准 dropzone 和事件日志。
- “在系统中显示测试文件”：用于验证 Finder / Explorer 向两块页面拖入真实文件。
- “允许未处理拖拽触发导航”：重建右侧 view，用于对照 Electron `navigateOnDragDrop` 的开关行为。

真实文件卡片只启动 Electron 的 `webContents.startDrag()` 原生拖拽，会主动取消
renderer 自己的 HTML5 拖拽会话。不要同时保留两层拖拽，否则原生拖拽结束后下一次
鼠标点击可能仍被浏览器当作 `dragend`，表现为工具栏按钮暂时无法点击。

## 建议验证顺序

1. 右侧“混合网页数据”拖到左侧接收区。
2. 右侧“普通链接”和“纯文本”分别拖到左侧，确认它们没有被误认为真实文件。
3. 左侧“自定义网页数据”拖到右侧 dropzone。
4. 左侧“真实测试文件”拖到右侧 dropzone和 Finder / Explorer。
5. 左侧“远程承诺文件”直接拖到 Finder / Explorer；成功标准是目标目录生成
   `omniflow-download-url-sample.txt`，内容与 `fixtures/sample.txt` 一致。该入口只设置 Chromium
   私有 `DownloadURL`，不调用 Electron `webContents.startDrag()`。
6. 从 Finder / Explorer 把 `sample.txt` 拖入左右两侧接收区。
7. 开启 `navigateOnDragDrop` 后，把系统文件拖到右侧 dropzone 外，观察 `will-navigate`；随后重置页面。

每个平台分别记录：事件顺序、`DataTransfer.types`、文件元数据、`dropEffect` 和是否触发导航。实验结果确认前，不据此修改正式文件树逻辑。

## 已确认结果

- 2026-08-17：当前 Electron/macOS 下，左侧“远程承诺文件”拖到 Finder 后成功生成
  `omniflow-download-url-sample.txt`，证明 Chromium `DownloadURL` 可被 Finder 兑现。
- Windows Explorer 尚未验证，不能由 macOS 结果直接推断。
