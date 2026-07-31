# Text Viewer 说明

更新时间：2026-07-31
适用范围：`src/features/file-viewer/components/text-viewer/` 下的文本预览、编辑、保存和另存为链路。

## 1. 概述

`text-viewer` 是普通文件 viewer 体系里的可编辑文本查看器，当前基于 CodeMirror 渲染和编辑文本内容。

它当前承担：

- 按文件名扩展名选择基础语法高亮
- 加载后维护编辑内容和 dirty 状态
- 支持编辑器内快捷键字号缩放、自动换行、保存、另存为和下载
- 保存时调用后端按 `nodeId` 更新内容的专用 API
- 另存为时通过 Electron 暂存文本文件，再走现有上传创建节点链路
- 保存成功后刷新目录树和当前 tab 的文件链接，但不 reload 当前 viewer

它不是文件打开链路 owner，也不是后端节点存储 owner。

## 2. 当前结构

- `index.tsx`
  - CodeMirror 配置、文件加载、编辑状态、保存/另存为和快捷键
- `language.ts`
  - 文本编辑器语言识别、CodeMirror 语法扩展注册和语言标签
- `style.ts`
  - 编辑区、底部工具栏、dirty 标记和操作按钮样式

## 3. 关键链路

### 3.0 语法高亮

`text-viewer` 当前继续使用 CodeMirror 6，不引入富文本编辑模型。语法高亮分三层：

- 官方 Lezer parser：用于 JavaScript / TypeScript / JSON / Markdown / HTML / CSS / XML / Python / Go / Rust / Java / C/C++ / SQL / YAML / PHP 等主流代码文件。
- `@codemirror/legacy-modes` stream parser：用于 Shell / PowerShell / Dockerfile / TOML / Ruby / Perl / Lua / diff / nginx / protobuf / Swift / R / CMake / Kotlin / SCSS / Sass / Less / Stylus 等轻量兼容场景。
- 纯文本：用于 txt / log / csv / tsv / subtitle / ignore 文件等不适合强行套 parser 的内容。

语言注册集中在 `language.ts`，`index.tsx` 只消费 `resolveTextEditorLanguage(fileName)` 返回的 `label`、`source` 和 CodeMirror `extension`。后续新增高亮能力时，优先改 `language.ts` 和 `src/utils/preview-file-type.ts`，不要把扩展名判断重新塞回 viewer 主组件。

文件进入 text viewer 的前置判断仍由文件打开链路完成，核心位置是 `src/utils/preview-file-type.ts`。如果新增一种可编辑文本格式，必须同时确认：

1. `preview-file-type.ts` 会把它识别为 `text`。
2. `language.ts` 能给它合适的高亮，或明确作为纯文本降级。
3. `docs/viewers/text-viewer.md` 中的高亮分层仍准确。

### 3.1 加载

`text-viewer` 收到 `url + reloadToken` 后直接 `fetch(url)` 读取文本。

CodeMirror 的 `basicSetup` 使用模块级稳定配置对象。普通 active tab 变化可以触发 React rerender，但不能因此让 `@uiw/react-codemirror` 误判基础扩展发生变化并执行 reconfigure；否则编辑器滚动位置会回到顶部。

`AppMain` 的 keep-alive 渲染顺序同样必须稳定。切换 active tab 只改变可见性，不能把已挂载 tab 移到 DOM 列表末尾；最近使用顺序与 React 渲染顺序必须分开维护。

这里不要随意给对象存储签名 URL 加 `cache: 'no-store'` 等额外 fetch 选项；某些签名 URL 对请求形态比较敏感，改请求选项可能导致文件加载失败。

### 3.2 编辑状态

编辑内容同时写入：

- React state：驱动 CodeMirror 的 `value`
- `contentRef`：让保存回调拿到最新内容

两者必须保持同步。只更新 ref 会导致 CodeMirror 仍受旧 state 控制，保存或重渲染后用户看到的内容回退。

### 3.3 保存

当前保存链路使用专用内容更新接口：

1. 读取当前节点详情。
2. 调用 `PUT /api/v1/nodes/:nodeId/content`，请求体包含 `libraryId`、`content` 和可选 `contentType` / `storageProvider`。
3. 后端生成新的对象存储内容，并替换当前文件节点的 storage 绑定。
4. 保留节点 ID、文件名和目录位置不变。
5. 刷新目录树和当前 tab 的文件链接，但不触发 `reloadActiveTab`。

右键新建文件后，目录树会在新建弹框中直接选择存储位置，再通过同一个内容 API 写入空内容，让新文件从一开始就有对象存储绑定。新建文件的首次写入明确使用 `text/plain; charset=utf-8`，避免 `.ts` 这类冲突后缀被后端按媒体类型推断；如果首次写入失败，前端会先移入回收站再立即彻底删除刚创建的文件节点，避免留下没有对象绑定的半成品。

保存时不应该重置当前 viewer 的局部阅读状态，例如字号和自动换行。重新关闭再打开文件时，viewer 可以重新使用默认字号；但一次保存动作不能把正在编辑的界面当成重新进入。

不要把普通保存重新改成 `uploadLocalPathAndCreateNode + conflictPolicy: 'replace'`。那条链路只适合兼容上传替换，不适合作为编辑器保存的主路径。

### 3.4 另存为

另存为同样使用 Electron 暂存文件，但上传时使用 `conflictPolicy: 'auto_rename'`，目标是创建一个新文件节点。

### 3.5 编辑区滚动条

CodeMirror 的实际横纵滚动容器是 `.cm-scroller`。Text Viewer 在该容器上使用 `8px` 细滚动条、透明轨道和全局 `--app-scrollbar-*` 主题 token，并显式清除横纵滚动条交汇区背景。

滚动条样式保持在 `style.ts` 的 Text Viewer 作用域内，不添加全局 CodeMirror 或全局元素选择器，避免影响 PDF、漫画、图集等具有独立滚动模型的 viewer。

### 3.6 底部操作区

- 底部只显示当前字号数字，不提供加减按钮。桌面端的 `Cmd/Ctrl +`、`Cmd/Ctrl -` 和 `Cmd/Ctrl 0` 由 Electron main 固定应用壳缩放后，通过 `onViewerZoomShortcut` bridge 投影给当前活动 Text Viewer；非 Electron 预览环境保留 CodeMirror keymap 作为 fallback。
- Text Viewer 必须用 `active` 状态保护 zoom bridge 回调，避免同一库中后台保留的文本 tab 同步改变字号。快捷键只改变活动文档字号，不改变应用页面缩放。
- 保存、另存为和下载使用固定 `30px * 30px` 图标按钮，分别采用保存、新增副本和下载语义图标；可访问名称和 hover tooltip 保留中文操作名。
- 保存仍是主操作，并继续受 dirty / saving 状态控制；另存为和下载只改变呈现形式，不改变原有业务链路。

## 4. 边界

`text-viewer` 负责：

- 文本内容加载和编辑
- 编辑态、dirty 态和保存按钮状态
- 保存后的目录树刷新通知
- 当前 tab 文件链接刷新

它不负责：

- 决定一个文件是否是文本文件
- 管理文件预览 tab 生命周期
- 定义后端节点覆盖规则
- 直接写本地原文件或对象存储

相关边界优先看：

- `src/utils/preview-file-type.ts`
- `src/features/file-viewer/components/file-dispatcher/index.tsx`
- `src/contexts/FileViewerContext.tsx`
- `src/features/file-explorer/services/file.api.ts`

## 5. 依赖边界

CodeMirror 相关依赖必须显式写在 `package.json`，不能依赖本地 `node_modules` 中偶然存在的 extraneous 包。

当前 text viewer 使用的关键依赖包括：

- `@uiw/react-codemirror`
- `@codemirror/view`
- `@codemirror/state`
- `@codemirror/language`
- `@codemirror/lang-*`
- `@codemirror/legacy-modes`
- `@fontsource/jetbrains-mono`

不要为了只读高亮引入 Shiki / highlight.js 作为编辑器主链路。它们更适合渲染代码块或静态预览；当前目标是普通可编辑文本编辑器，CodeMirror extension 才是主边界。

## 6. 验证方式

涉及 text viewer 高亮或编辑链路时，至少验证：

- 打开 `.ts` / `.md` / `.json` / `.py` 中至少一种官方 parser 文件，确认有高亮且可编辑。
- 打开 `.sh` / `Dockerfile` / `.toml` / `.diff` 中至少一种 legacy parser 文件，确认有高亮且可编辑。
- 打开 `.txt` / `.log` 等纯文本文件，确认不会白屏且仍可保存。
- 编辑器聚焦时验证 `Cmd/Ctrl +`、`Cmd/Ctrl -`、`Cmd/Ctrl 0` 只改变文档字号，应用其他区域尺寸不变。
- `Cmd/Ctrl+S` 保存后 dirty 标记清除，目录树刷新，当前 tab 不丢失。
- 保存、另存为和下载图标的 tooltip、禁用态、loading 态和点击行为正确。
- 在长行和多行文本中分别触发横向、纵向滚动条，确认滚动条轨道和右下角交汇区透明，滑块在亮色和暗色主题下可辨认。
- 亮色和暗色主题下 gutter、正文、选区和底部工具栏可读。

常规代码变更仍按 `docs/frontend-validation-matrix.md` 执行 `npm run lint` 和 `npm run build`。
