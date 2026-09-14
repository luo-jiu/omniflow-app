# 只读查看器工程模板

此工程只依赖公开 `@omniflow/plugin-sdk`，不导入 OmniFlow 宿主模块。生成器已设置独立插件 ID、viewer ID、扩展名和本地 SDK 依赖。

```bash
npm install --offline --ignore-scripts --no-audit --no-fund
npm run build
npm run package
```

在 OmniFlow（已验收平台为 macOS）打开“设置 → 插件管理”，选择本工程的 `plugin.zip`。核对 ID、版本、权限和指纹后确认安装，再分别启用、批准读取能力。打开匹配文件，选择自己的查看器并允许读取该文件。安装和启用本身不会授予正文访问。

`src/main.js` 演示 ready、context、64 KiB 分块读取、取消、主题、活动状态以及滚动检查点。模板只读 256 KiB 以内的 UTF-8 文本；请为自己的领域逻辑明确设置文件、节点/行数、字符串和 DOM 数量上限。渲染文本使用 textContent，不把文件内容拼入 innerHTML。

修改自己的代码和 Manifest 后重新构建、打包；更新时提高 Manifest 的三段版本号。更新安装后重新启用和授权；设置按包指纹隔离，回滚访问旧版本设置，不自动迁移数据。重载不会保留有效句柄。

`build.mjs` 是最小无 bundler 构建器，仅替换 main.js 中一个 SDK 裸导入并复制明确列出的静态资产；新增文件须加入构建清单。可以替换成自己的编译器/打包器，但不要引用宿主 alias、React Context、DOM、通用 IPC 或 URL/凭据。`pack.mjs` 只使用 Node 标准库生成 ZIP，不执行包脚本；最终合法性以宿主预检为准。

SDK 只在 OmniFlow 的隔离视图中可用，直接打开 HTML 不会获得资源权限。本机 file input、任意网络、声音、WebGL、Shell 和文件写入均不在首期开放范围。
