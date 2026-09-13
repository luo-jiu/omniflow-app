# Text Viewer 说明

底栏保存、另存为、下载使用 Lucide 的 Save、FilePlus2、Download 细线图标，统一 1.25px 描边；保留 28px 点击区、透明常态和悬停中圆角背景，不修改操作行为。

更新时间：2026-08-25
适用范围：`src/features/file-viewer/components/text-viewer/` 下的文本预览、编辑、保存和另存为链路。

## 1. 概述

`text-viewer` 是普通文件 viewer 体系里的可编辑文本查看器，当前基于 CodeMirror 渲染和编辑文本内容。

它当前承担：

- 按文件名扩展名选择基础语法高亮
- 加载后维护编辑内容和 dirty 状态
- 使用公共 Viewer Session Registry 恢复选区、顶部行、滚动、字号和换行
- 使用 IndexedDB DraftStore 持久化未保存正文，并显式处理恢复/放弃与 revision 冲突
- 支持编辑器内快捷键字号缩放、自动换行、保存、另存为和下载
- 保存先核对读取时的正文 SHA-256，再通过带 expectedStorageKey 的条件 API 更新内容，版本冲突保留草稿并刷新远端资源；旧后端不支持条件端点时不退回无条件覆盖
- 另存为先弹出文件名确认，再通过 Electron 暂存文本文件并走现有上传创建节点链路
- 下载通过系统保存窗口将当前编辑器正文写到本地，不依赖对象存储签名链接的浏览器下载行为
- 保存成功后刷新目录树和当前 tab 的文件链接，但不 reload 当前 viewer

它不是文件打开链路 owner，也不是后端节点存储 owner。

## 2. 当前结构

- `index.tsx`
  - CodeMirror 配置、文件加载、编辑状态、保存/另存为和快捷键
- `language.ts`
  - 文本编辑器语言识别、CodeMirror 语法扩展注册和语言标签
- `text-viewer-session.ts`
  - UI snapshot schema、反序列化校验和正文 SHA-256 revision
- `text-viewer-save.ts`
  - 保存完成后的草稿状态与用户反馈判定
- `text-viewer-local-save.ts`
  - 系统保存窗口 filters 与当前编辑正文的本地写盘链路
- `style.ts`
  - 编辑区、底部状态栏、另存为弹窗、dirty 标记和操作按钮样式

## 3. 关键链路

### 3.0 语法高亮

语言注册实现已下沉到 `src/components/code/language.ts`，本目录 `language.ts` 保留兼容导出。文档编辑器继续消费同一个 resolveTextEditorLanguage；Agent 代码围栏通过 resolveCodeFenceLanguage 复用标签、Lezer 和 legacy grammar。聊天只使用解析器生成受控文本 token，不挂载文档编辑器，也不接入文件保存链路。

`text-viewer` 当前继续使用 CodeMirror 6，不引入富文本编辑模型。语法高亮分三层：

Markdown 默认进入渲染模式；底部使用单个图标按钮在渲染与 CodeMirror 源码之间切换。渲染模式显示 Eye，源码模式显示 Code2，颜色区分当前模式，不改变正文、草稿或保存状态。

- 官方 Lezer parser：用于 JavaScript / TypeScript / JSON / Markdown / HTML / CSS / XML / Python / Go / Rust / Java / C/C++ / SQL / YAML / PHP 等主流代码文件。
- `@codemirror/legacy-modes` stream parser：用于 Shell / PowerShell / Dockerfile / TOML / Ruby / Perl / Lua / diff / nginx / protobuf / Swift / R / CMake / Kotlin / SCSS / Sass / Less / Stylus 等轻量兼容场景。
- 纯文本：用于 txt / log / csv / tsv / subtitle / ignore 文件等不适合强行套 parser 的内容。

语言注册集中在 `language.ts`，`index.tsx` 只消费 `resolveTextEditorLanguage(fileName)` 返回的 `label`、`source` 和 CodeMirror `extension`。后续新增高亮能力时，优先改 `language.ts` 和 `src/utils/preview-file-type.ts`，不要把扩展名判断重新塞回 viewer 主组件。

文件进入 text viewer 的前置判断仍由文件打开链路完成，核心位置是 `src/utils/preview-file-type.ts`。如果新增一种可编辑文本格式，必须同时确认：

1. `preview-file-type.ts` 会把它识别为 `text`。
2. `language.ts` 能给它合适的高亮，或明确作为纯文本降级。
3. `docs/viewers/text-viewer.md` 中的高亮分层仍准确。

### 3.1 加载

`text-viewer` 收到 `url + reloadToken` 后直接 `fetch(url)` 读取文本。签名 URL 不作为 session 或 draft identity；稳定身份来自账号 scope、`libraryId` 和 `nodeId`。

外部写入通过 FileViewerProvider 更新现存 tab 的链接及 reloadToken，不创建或切换 tab。刷新前必须先 flush 当前内存草稿；失败则保留缓冲区并停止刷新。成功后按新正文 revision 与已保存草稿比较，复用“恢复草稿 / 使用最新文件”的冲突交互，不静默覆盖草稿。

节点详情暂时没有可靠服务端内容版本时，首次加载的原始正文会计算 SHA-256 作为 draft baseline。存在 draft 时不能静默替换正文：baseline 相同仍要求用户选择恢复或使用当前文件，baseline 不同则显示内容冲突提示。draft 与远端正文完全相同时视为保存后清理中断的残留，可以直接删除。

CodeMirror 的 `basicSetup` 使用模块级稳定配置对象。普通 active tab 变化可以触发 React rerender，但不能因此让 `@uiw/react-codemirror` 误判基础扩展发生变化并执行 reconfigure；否则编辑器滚动位置会回到顶部。

`AppMain` 的 keep-alive 渲染顺序同样必须稳定。切换 active tab 只改变可见性，不能把已挂载 tab 移到 DOM 列表末尾；最近使用顺序与 React 渲染顺序必须分开维护。

这里不要随意给对象存储签名 URL 加 `cache: 'no-store'` 等额外 fetch 选项；某些签名 URL 对请求形态比较敏感，改请求选项可能导致文件加载失败。

### 3.2 编辑状态

编辑内容同时写入：

- React state：驱动 CodeMirror 的 `value`
- `contentRef`：让保存回调拿到最新内容

两者必须保持同步。只更新 ref 会导致 CodeMirror 仍受旧 state 控制，保存或重渲染后用户看到的内容回退。

每次真实输入都会把 draft 标记为尚未安全落盘，并在 700ms 后写 IndexedDB；tab 失活、组件卸载和 `pagehide` 会立即尽力 flush。写入失败时 dirty 状态保持，adapter 继续投影 `dirty` pin reason，并提示用户及时保存，不能把失败当成已持久化。

### 3.3 保存

当前保存链路使用专用内容更新接口：

1. 读取当前节点详情。
2. 调用 `PUT /api/v1/nodes/:nodeId/content`，请求体包含 `libraryId`、`content` 和可选 `contentType` / `storageProvider`。
3. 后端生成新的对象存储内容，并替换当前文件节点的 storage 绑定。
4. 保留节点 ID、文件名和目录位置不变。
5. 刷新目录树和当前 tab 的文件链接，但不触发 `reloadActiveTab`。

右键新建文件后，目录树会在新建弹框中直接选择存储位置，再通过同一个内容 API 写入空内容，让新文件从一开始就有对象存储绑定。新建文件的首次写入明确使用 `text/plain; charset=utf-8`，避免 `.ts` 这类冲突后缀被后端按媒体类型推断；如果首次写入失败，前端会先移入回收站再立即彻底删除刚创建的文件节点，避免留下没有对象绑定的半成品。

保存时不应该重置当前 viewer 的局部阅读状态，例如选区、滚动、字号和自动换行。关闭再打开仍可在当前 auth runtime 内从 Warm snapshot 恢复这些状态；一次保存动作不能把正在编辑的界面当成重新进入。

保存成功后清除已提交 draft，并以已保存正文的新 SHA-256 作为后续编辑 baseline。如果保存请求进行期间用户继续输入，成功回调不能把编辑器回退到请求开始时的正文；新输入继续保持 dirty，并立即写成基于新 baseline 的 draft。

保存后的签名 URL 只能通过 `FileViewerContext.updateFileTabResource(tabId, ...)` 静默更新发起保存的现存 tab。该入口不改变 `activeTabId`，目标 tab 已关闭或 node identity 不匹配时直接 no-op；旧保存回调不能调用 `setFileUrl` 重新激活或创建 tab。保存期间后续编辑的 draft flush 返回失败时，只能提示“文件已保存但草稿尚未写入”，不能声称修改已经保留。

不要把普通保存重新改成 `uploadLocalPathAndCreateNode + conflictPolicy: 'replace'`。那条链路只适合兼容上传替换，不适合作为编辑器保存的主路径。

### 3.4 另存为与下载

另存为继续在当前文件的资料库目录创建新节点。点击按钮或在编辑器聚焦时按 `Cmd/Ctrl+Shift+S` 后，先打开紧凑名称弹窗；确认后使用 Electron 暂存当前编辑正文，并以 `conflictPolicy: 'auto_rename'` 上传，名称冲突时由后端创建自动重命名副本。

保存入口在异步请求前捕获正文快照，并以同步 in-flight 门禁防止同一事件周期重复提交。普通保存与另存为共享门禁；下载独立防重入。正文加载中、加载失败、草稿待恢复或viewer非活跃时不能提交；另存为弹窗在切换资源/活跃状态时关闭，每个实例使用独立输入框ID。旧资源保存的迟到回执不改写当前资源的草稿/dirty状态。

2026-09-09 补充组件回归：异步元数据等待期间切换文件仍保存原正文，同周期双提交只上传一次，非活跃弹窗关闭，加载期间禁止另存为/下载。win（ID 3）的合成文本已做暗色状态栏和名称弹窗只读检查，未在本轮执行真实上传或下载写盘。

下载是本地导出，不创建资料库节点。点击后必须调用 `saveDownloadFile` 打开系统保存窗口，再通过 `writeTextFile` 写入当前编辑正文。不能继续依赖 `<a download>` 直接访问对象存储签名链接：Electron 的外链处理和跨域响应可能让点击没有可见结果，而且旧链接内容也不一定包含尚未保存的编辑。

### 3.5 编辑区滚动条

CodeMirror 的实际横纵滚动容器是 `.cm-scroller`。Text Viewer 在该容器上使用 `8px` 细滚动条、透明轨道和全局 `--app-scrollbar-*` 主题 token，并显式清除横纵滚动条交汇区背景。

滚动条样式保持在 `style.ts` 的 Text Viewer 作用域内，不添加全局 CodeMirror 或全局元素选择器，避免影响 PDF、漫画、图集等具有独立滚动模型的 viewer。

### 3.6 底部操作区

- 底部只显示当前字号数字，不提供加减按钮。桌面端的 `Cmd/Ctrl +`、`Cmd/Ctrl -` 和 `Cmd/Ctrl 0` 由 Electron main 固定应用壳缩放后，通过 `onViewerZoomShortcut` bridge 投影给当前活动 Text Viewer；非 Electron 预览环境保留 CodeMirror keymap 作为 fallback。
- Text Viewer 必须用 `active` 状态保护 zoom bridge 回调，避免同一库中后台保留的文本 tab 同步改变字号。快捷键只改变活动文档字号，不改变应用页面缩放。
- 状态栏在操作按钮前显示当前光标 `行:列`、`LF / CRLF / CR`、`UTF-8` 和字号；不显示翻译入口或制表符控制。光标只在 CodeMirror 选区或正文变化时更新，换行符只在加载 / 草稿恢复时扫描正文，普通输入不能反复全量扫描大文本。
- 不在底部提供自动换行按钮；已有 session 中的自动换行状态仍按原 schema 恢复，避免局部 UI 调整破坏历史现场。
- 保存、另存为和下载使用固定 `28px * 28px` 无背景图标按钮，分别采用保存、新增副本和下载语义图标；常态使用弱文本色，悬停显示中圆角中性背景，不显示边框、位移或外投影。
- 三个图标提示统一使用浏览器原生 `title`，不再套 Semi Tooltip；可访问名称继续保留中文操作名。
- 保存仍是主操作，并继续受 dirty / saving 状态控制；另存为和下载只改变呈现形式，不改变原有业务链路。

### 3.7 Session 与 DraftStore

Text 的两类恢复数据必须分开：

- Warm snapshot 只保存 `selectionAnchor`、`selectionHead`、`topLine`、行内偏移、横纵滚动、字号和换行，不保存正文。
- dirty content 只写 `ViewerDraftStore`。DraftStore 每个 resource slot 保留最新一份草稿，draft key 内保留其内容 revision，用于判断重新打开时是否冲突。

DraftStore 使用 IndexedDB，默认单草稿上限 5 MiB、单账号上限 50 MiB、保留 30 天。普通关闭 tab、资料库释放、退出登录和异常退出采用 hot-exit 语义，只卸载运行实例，不删除已落盘 draft；同一账号重新登录仍能恢复，其他账号因 key 隔离无法读取。用户明确选择“使用最新文件”、保存成功或确认删除节点后才清除对应 draft。软删除、彻底删除和清空回收站统一通过 `file-explorer/services/node-deletion.ts` 收口；只有后端删除成功后才清 draft 并提升资源写入 generation，使旧 Text 组件的延迟 cleanup 不能把已删除 draft 写回。

当前 `viewerSessionPolicies.text` 声明 Warm memory、Cold none、保留阅读位置和 `hasDraft=true`。这里的 Cold none 指普通 UI envelope 尚未跨重启持久化；独立 DraftStore 不属于可淘汰 UI snapshot。

## 4. 边界

`text-viewer` 负责：

- 文本内容加载和编辑
- 编辑态、dirty 态和保存按钮状态
- Text session adapter、payload codec 和草稿恢复选择
- 保存后的目录树刷新通知
- 当前 tab 文件链接刷新

它不负责：

- 决定一个文件是否是文本文件
- 管理文件预览 tab 生命周期
- 在普通 workspace/session release 时删除持久草稿
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
- 在长文本中设置光标/选区、滚到中段并调整字号/换行，切 tab、切工作区及真卸载后恢复现场。
- 编辑后等待 debounce，再关闭 tab、切资料库或重启应用；重新打开必须显示恢复选择，选择恢复后正文与 dirty 状态正确。
- 修改远端正文后重新打开旧 draft，必须显示冲突提示；选择使用最新文件会清草稿，选择恢复不会静默保存覆盖。
- 保存请求期间继续输入，保存成功后新输入仍保留为 dirty draft，编辑器正文不回退。
- 保存请求期间切到其他 tab 时不被强制切回；关闭原 tab 时保存回调不会重新创建它。
- 模拟 IndexedDB 容量/不可用错误时显示持久化失败，dirty 状态不消失。
- 保存期间后续编辑的 draft flush 失败时，只提示文件本身已保存，不显示“后续修改已保留为草稿”。
- 底部状态栏显示准确的光标行列、换行符、UTF-8 和字号，不显示翻译图标、制表符控制或自动换行按钮；大文本输入时不因状态项触发逐字全量扫描。
- 保存、另存为和下载图标使用原生提示；验证禁用态、loading 态、中圆角 hover 和点击行为。另存为弹出名称确认并在当前资料库目录创建副本，下载弹出系统保存窗口且写入当前编辑正文。
- 在长行和多行文本中分别触发横向、纵向滚动条，确认滚动条轨道和右下角交汇区透明，滑块在亮色和暗色主题下可辨认。
- 亮色和暗色主题下 gutter、正文、选区和底部工具栏可读。

常规代码变更仍按 `docs/frontend-validation-matrix.md` 执行 `npm run lint`、`npm test` 和 `npm run build`。

当前真实样本已在 Electron 的 `win` 测试库完成跨应用重启恢复、revision 冲突两种选择、保存后草稿清理、保存期间继续编辑、保存期间切换 tab 和关闭原 tab 验收。IndexedDB 容量/不可用故障仍由单元测试与错误分支覆盖，不作为日常手工样本前置条件。
