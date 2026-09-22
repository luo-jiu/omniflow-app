# JSON 转换并另存样板

`example.json-transform@0.1.0` 使用 SDK 0.5.0，仅提供 `file-output` Tool。它读取获准的 UTF-8 JSON 文件，支持对象或数组根、顶层字段选择和 pretty 输出，生成一个新的 JSON 文件；不读取网络、不使用 Shell、不覆盖目标文件。

插件只收到宿主提供的资源句柄和目标提案输入，正文通过 SDK 有界分块读取。产物由 `completeFileOutput` 交给 main，最大 1 MiB；宿主确认目标、冲突策略、源版本和上传回执。插件完成产物交付不代表文件已经创建。

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
