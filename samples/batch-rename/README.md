# 批量改名提案样板

本包仅声明 macOS；格式 2、SDK 包版本 `0.4.0`。它只提供 `example.batch-rename.propose`，无需 Viewer 标签页。

## 能力与边界

- 分别批准 `resource.rename.propose` 与 `agent.tools` 后，内部 Agent 可在新 Run 发现此工具；仍需本次资源授权。
- 宿主将 1～50 个节点转换为调用内随机 ID 与完整文件名。插件收到 `{parameters:{prefix?,suffix?},files:[{id,name}]}`，没有真实节点 ID、路径、正文 handle、凭据或网络能力；`context.resource` 为 `null`。
- 插件返回 `{changes:[{id,name}]}`，只包含发生变化的文件。实际改名由宿主校验、展示旧名→新名并另行确认执行。批准提案能力不等于批准文件写入。
- prefix/suffix 各不超过 80 字符；保留最后一个扩展名及大小写，如 `archive.tar.gz` 添加后缀后为 `archive.tar-终稿.gz`。无扩展名与仅有开头点的 `.env` 整体视为文件名；`.config.json` 则保留 `.json`。
- 名称禁止空值、`.`、`..`、首尾空白、末尾点、控制字符和 `<>:"/\|?*`。最终完整名称最多 240 UTF-8 字节，宿主会独立复验更严格的业务限制、目标范围和同目录冲突。
- 空前后缀返回空 changes；不接受正则表达式或执行代码。停用、撤权、版本更新由宿主结束实例；不在插件中自行重试提交。

## 仓库外离线构建

将本目录复制到独立目录，并使用开发包提供的 SDK tarball 安装依赖：

```sh
npm install --offline --ignore-scripts --no-audit --no-fund /path/to/omniflow-plugin-sdk-0.4.0.tgz
npm run build
npm run package
```

`build.mjs` 只复制本包源码和公开 SDK；不使用宿主 alias 或内部 API。`pack.mjs` 使用 Node 内建能力生成有界 `plugin.zip`，无需 ZIP 第三方依赖。此 ZIP 是本地插件包，不是桌面发行包。

业务回归由宿主仓库中的 Vitest 执行 `samples/batch-rename/src/rename-proposal.test.js`，覆盖扩展名、中文、非法名称、UTF-8 和数量边界、无正文读取及单终态。
