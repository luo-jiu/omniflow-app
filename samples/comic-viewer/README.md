# 独立漫画目录查看器样板

使用 SDK 0.2.0，支持普通 COMIC 目录直属图片的单页翻页、主题和阅读位置恢复。通过插件管理手动安装并授权，用户再选择打开方式；不自动顶替内置查看器。

从宿主仓库执行 `node tools/plugin-isolation/build-independent.mjs comic-viewer`，进入输出的 sample 目录执行 `npm run package`，在插件管理安装生成的 `plugin.zip`。外部开发者也可用打包后的 SDK tgz 安装依赖，再运行 `npm run build` 和 `npm run package`。

最多枚举 512 个直属节点；样板单图最多 10 MiB、2400 万像素，只保留当前图片。空目录、超限、移动、撤权和解码失败会明确显示状态。当前不支持归档漫画、滚动/双页、递归和内置 viewMeta 进度迁移。

完整契约和验证状态见宿主 `docs/plugin-system-e1-directory-viewer.md`。新增目录能力需要 E1 版本宿主，旧宿主会拒绝新增 manifest 字段。
