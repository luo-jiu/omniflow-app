# JSON 转换并另存样板

`example.json-transform@0.1.3` 使用 SDK 0.7.0，提供 `file-output` Tool、手动命令 `example.json-transform.run` 和独立工具页 `example.json-transform.workspace`。它读取获准的 UTF-8 JSON 文件，支持对象或数组根、顶层字段选择和 pretty 输出，生成一个新的 JSON 文件；不读取网络、不使用 Shell、不覆盖目标文件。

启用并批准读取、文件产物后，可从文件菜单或工具区运行手动命令；Agent Tool 为独立可选批准。插件只收到 `select` / `pretty` 处理参数，`resource` 与 `destination` 由宿主冻结并剥除，正文通过 `context().resource` 的当前句柄有界分块读取。产物由 `completeFileOutput` 交给 main，最大 1 MiB；宿主确认目标、冲突策略、源版本和上传回执。插件完成产物交付不代表文件已经创建。

工具页的用户路径为：宿主选择源文件并点击“打开工具” → 勾选字段与缩进选项、查看结果预览 → 在宿主选定输出目录和文件名 → 点击“准备另存” → 在宿主批准保存提案。页面通过 `prepareWorkspaceCommand({ select?, pretty })` 请求准备，不能指定资源身份、目标、直接写入或自行批准；返回的 requestId 也不表示保存完成。最终执行、结果和历史仍以宿主记录为准。原有 Agent 和手动表单入口继续可用。

## 工具页边界

- `workspace.html`、脚本和 CSS 均随本包提供，不引用宿主内部代码。HTML 无内联脚本或样式；主题从 SDK `subscribe` 及 context 获取，通过本包外链 CSS 的规则应用。JSON 内容与字段名只作为 DOM 文本显示。
- 源文件最大 4 MiB，严格 UTF-8 分块读取，版本变化、缺失分块、读取拒绝、停止或超限时不提供另存。关闭页面会取消读取并释放 SDK 订阅；暂停后返回会重新检查 context，源身份不变时复用已经完整读取的正文。
- 预览和 Tool 共用 `transformJson`。预览只显示前 24,000 字符以内，截断时明确标注；产物仍完整生成并按 UTF-8 字节校验，超过 1 MiB 直接失败，不能用截断产物冒充完整结果。
- 默认保留全部字段；自选模式最多 64 项，名称长 1～128 字符。最多显示 256 个候选字段，更多字段或空/超长字段名仍可通过“保留全部字段”完整保留。数组中的非对象项不变化，嵌套内容不递归筛选。
- `JSON.parse` / `JSON.stringify` 的语义沿用原 Tool：转换会重新序列化，原始空白和数值字面写法不保留；超出 JavaScript 安全整数范围的数值可能失去精度。需要保留原始字节时不应使用转换工具。

在本目录安装 SDK 后执行：

```sh
npm run build
npm run package
```

仓库外离线构建使用：

```sh
node tools/plugin-isolation/build-independent.mjs json-transform
```

此样板的 JSON 解析和字段选择逻辑独立于 CSV 样板，不依赖 CSV 解析器、列索引或 CSV 输出规则。

从宿主仓库执行 `npx vitest run samples/json-transform` 验证转换与工具页纯逻辑；独立构建同时输出 Tool 和工具页，开发包继续复用本样板，不新增副本。
