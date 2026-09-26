# 只读查看器工程模板

此工程只依赖公开 `@omniflow/plugin-sdk`，不导入 OmniFlow 宿主模块。生成器已设置独立插件 ID、viewer ID、扩展名和本地 SDK 依赖。

```bash
npm install --offline --ignore-scripts --no-audit --no-fund
npm run build
npm run package
```

在 OmniFlow（已验收平台为 macOS）打开“设置 → 插件管理”，选择本工程的 `plugin.zip`。核对 ID、版本、权限和指纹后确认安装，再分别启用、批准读取能力。打开匹配文件，选择自己的查看器并允许读取该文件。安装和启用本身不会授予正文访问。

`src/main.js` 演示 ready、context、64 KiB 分块读取、取消、主题、活动状态以及滚动检查点。模板只读 256 KiB 以内的 UTF-8 文本；请为自己的领域逻辑明确设置文件、节点/行数、字符串和 DOM 数量上限。渲染文本使用 textContent，不把文件内容拼入 innerHTML。

主题接法见 `src/main.js` 的 `themeProperties` / `theme` 和 `src/style.css`：初始 context 与后续 theme 事件都投影为插件自己的变量，覆盖应用/面板表面、正文/说明/禁用文字、边框、普通按钮默认/hover/active/disabled、错误、focus、文字划选与滚动条；`mode` 同时控制原生控件的 `color-scheme`。只接受递增的主题 revision，不与阅读检查点 revision 混用。每次应用前恢复亮暗两套本地默认值，再覆写快照实际提供的字段，缺字段或完整快照切回部分字段都不会残留上次主题色。

隔离策略要求使用包内外链 CSS。模板通过 CSSOM 仅修改自己的 `style.css` 规则，不写 `element.style`、不注入 `<style>`，也不导入宿主 React/CSS/Context。宿主主题不会穿透插件页面：增加新控件时须继续映射对应语义并消费变量，不要只让背景跟随主题而将文字、焦点或按钮状态写死。图片、文件正文及领域图表颜色要分别判断，不应全部重着色。

修改自己的代码和 Manifest 后重新构建、打包；更新时提高 Manifest 的三段版本号。更新安装后重新启用和授权；设置按包指纹隔离，回滚访问旧版本设置，不自动迁移数据。重载不会保留有效句柄。

`build.mjs` 是最小无 bundler 构建器，仅替换 main.js 中一个 SDK 裸导入并复制明确列出的静态资产；新增文件须加入构建清单。可以替换成自己的编译器/打包器，但不要引用宿主 alias、React Context、DOM、通用 IPC 或 URL/凭据。`pack.mjs` 只使用 Node 标准库生成 ZIP，不执行包脚本；最终合法性以宿主预检为准。

SDK 只在 OmniFlow 的隔离视图中可用，直接打开 HTML 不会获得资源权限。本机 file input、任意网络、声音、WebGL、Shell 和文件写入均不在首期开放范围。
