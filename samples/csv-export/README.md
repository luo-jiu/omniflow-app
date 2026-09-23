# CSV处理并另存样板

`example.csv-export@0.1.1` 使用独立SDK 0.6.0，提供 `file-output` Tool 与手动命令 `example.csv-export.run`。读取当前获准的单个CSV，将全部数据或指定列精确匹配的数据行完整导出CSV/JSON；不打开Viewer、不调用网络、Shell或宿主私有模块。

安装后启用并批准读取、文件产物，即可从文件菜单或工具区运行手动命令；Agent Tool 为独立可选批准。交给 Agent 时仍需会话范围，所有入口仍需宿主最终另存批准。输入 `resource.nodeId` 与 `destination.parentId/fileName` 由宿主管理，沙箱仅收到format及可选column/equals。format为csv或json；目标后缀须一致。目标同名时报错，不覆盖或自动改名。

沿用有界流式CSV解析：源≤4MiB、最多10000行（含表头）、128列、100000个单元格、单元格≤16384字符。产物为1字节至1MiB；任何源/结果超限或格式不支持均明确失败，禁止截断后声称完整导出。CSV保留逗号、双引号、CR/LF并按标准转义；JSON为`{headers,rows}`，不存在隐式100行限制。

在本目录安装SDK后执行`npm run build`、`npm run package`。宿主仓库可用`node tools/plugin-isolation/build-independent.mjs csv-export`在仓库外离线构建。生成的`plugin.zip`仅含静态资源；产物正文由`completeFileOutput`交给main，不成为模型Tool回复或SQLite聊天内容。实际提交/回执查询状态以宿主W3验收记录为准。
