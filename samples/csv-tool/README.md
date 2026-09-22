# CSV Viewer 与 Agent Tool 独立样板

包 ID 为 `example.csv-tools`，版本 `0.1.0`，使用 manifest v2 与 npm SDK `0.3.0`。原 `samples/csv-viewer` 保持独立，安装本包不会自动替换用户的 CSV 默认查看器。

本包同时贡献 `example.csv-tools.table` Viewer 与 `example.csv-tools.query` Tool。两者使用同一个纯 CSV parser 和有界文件读取模块；Tool 的 `tool.html`/`tool.js` 不消费 DOM、主题、查看器活动事件或阅读状态，也不要求先打开 Viewer。Tool 是否进入内部 Agent 目录以及执行授权由宿主负责；样板本身不注册 Agent 会话或直接访问资料库 API。

## 构建

这是独立 npm 工程，不导入宿主源码、alias、React 或业务组件。开发包提供 SDK tarball 后，将依赖指向对应本地 tarball，可离线安装并执行：

```sh
npm install --offline --ignore-scripts --no-audit --no-fund
npm run build
npm run package
```

`build.mjs` 只用 Node 标准库，将自己的静态资源和已安装 SDK 复制到 `dist/`。分发包包含 Viewer `index.html` 与 Tool `tool.html` 两个入口。`npm run package` 生成以 `dist/` 内容为根的 `plugin.zip`，交给宿主安装器。

## 查询契约

Tool 调用输入要求 `resource: { nodeId }`，nodeId 是正安全整数。宿主绑定资料库、当前调用身份、资源版本与句柄，移除 `resource` 后只把业务参数交给插件。插件拿不到原始 nodeId、凭据、签名 URL 或本机路径。

可选业务参数：

- `column` 与 `equals` 必须同时存在。`column` 是从 0 开始的列索引，范围 0–127，并且必须位于实际表头范围内；`equals` 最长 256 字符。比较使用精确字符串，不转换数值、不忽略大小写或空格。
- `limit` 为 1–100，默认 100；返回匹配结果的前 `limit` 行。

文件只接受 UTF-8（可带 BOM），第一行为表头，后续行列数必须与表头相同。允许重复或空表头，筛选按索引避免歧义。支持 CRLF、引号转义、多行字段、空字符串；保留数字原文与公式字符串，不执行公式、表达式或数值聚合。空文件与不完整引号明确失败，仅有表头的文件返回零行。

输出固定为 `{ headers, totalRows, matchedRows, rows, truncated }`。两个计数均不含表头；`matchedRows` 扫描全文件后得出，`truncated` 仅表示匹配行超过返回行数，不把未解析内容包装成完整结果。

## 预算与错误

解析限制为 4 MiB、10,000 行（含表头）、128 列、100,000 单元格、单元格 16,384 字符。Viewer 和 Tool 共用这些限制。读取按 SDK chunk 上限串行分块，块间至少等待 25 ms，为宿主的每秒请求配额预留控制请求空间。

Tool 另限制每个返回字符串 4,096 字符、最多 100 行，以及整个结果 JSON 编码后最多 32,768 UTF-8 字节；超限明确失败，不偷偷截断字段。可以缩小 `limit` 或筛选范围减少结果。宿主还会独立执行 schema、字节预算、30 秒超时和撤权检查。

- `INVALID_INPUT`：业务参数无效或列索引越界。
- `UNSUPPORTED_FORMAT`：UTF-8、CSV 格式、行列不一致、空文件或解析规模不受支持。
- `FAILED`：读取失败、版本或完整性变化、调用上下文无效，或结果超出预算。

`failTool` 只交付上述固定错误码，内部异常文本和资源响应不交付给模型。宿主取消或撤销调用后直接销毁隔离实例；插件不自行重试终态。成功回包被宿主拒绝时也不补发失败回包。

## 验证

在宿主仓库可定向运行 `npx vitest run samples/csv-tool/src`，覆盖原 parser、中文/重复表头/精确筛选、截断计数、输入和输出预算、UTF-8 分块、读取完整性、取消及单终态。真实沙箱和资料库授权的验证由宿主 AT0/AT1 验收记录维护，不能用本包的业务单测替代。当前仅声明 macOS。
