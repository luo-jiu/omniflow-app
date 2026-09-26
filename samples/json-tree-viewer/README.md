# JSON 树查看器

第二个独立只读样板，仅依赖 `@omniflow/plugin-sdk`。它通过现有 D1 安装/授权与 C2 资源桥运行，不需要 JSON 专属 IPC、后端接口、主壳分支或宿主源码。

从宿主仓库运行 `node tools/plugin-isolation/build-independent.mjs json-tree-viewer` 可在仓库外打包 SDK、离线安装依赖并独立构建。随后在输出的 sample 工程运行 `npm run package`，用宿主插件管理安装 `plugin.zip`。

支持 UTF-8（含 BOM）、对象/数组展开与收起、类型显示、每页 200 个可见节点、完整节点值/路径查看、亮暗主题、取消/活动状态、展开/页码/滚动检查点及显示设置。数字保留 JSON 词法原文，大整数、`-0` 和 `1e400` 不经过 JavaScript Number 舍入；字符串以 JSON 转义形式显示。

主题以 `src/main.js` 的 `themeProperties` / `applyTheme` 和 `src/style.css` 为接入示例：消费初始 context 与 theme 事件，把背景、节点/详情面板、正文/说明/禁用文字、边框、按钮与节点 hover/active、禁用、错误、焦点、文字划选和滚动条映射到包内变量。只用 CSSOM 修改本包外链样式表，不引用宿主 React、CSS 或另一个样板；`data-theme` 同时提供亮暗默认值与 `color-scheme`。应用快照前恢复两套原始 CSS 值，缺字段时按模式回退，避免完整快照的颜色残留；旧 revision 不覆盖较新颜色。不新增节点选择状态，展开、分页、详情和阅读状态仍按既有规则处理。源码更新需重新构建并更新安装包。

上限：1 MiB 文件、20000 节点、64 层嵌套、字符串 65536 字符、键 4096 字符、数字 256 字符、128 个同时展开节点。超过 12 层时视觉缩进封顶，详情仍显示真实层级与 JSON Pointer 路径。摘要截短时可点击查看完整值，不把省略显示成完整数据。

拒绝重复键、注释、尾逗号、非法 JSON 与非法 UTF-8，不静默采用“最后一个重复键”。属性按输入顺序保留，`__proto__` 等名称只作为数据；文件内容通过 textContent 呈现，不执行 HTML 或脚本。

更新须提高 Manifest 版本，重新构建/安装并启用、批准能力。D1 的包指纹与资源版本会隔离不兼容快照；各包版本设置独立保留。
