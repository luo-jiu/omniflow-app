# OmniFlow 插件开发包

此开发包独立于宿主仓库，包含 SDK tgz、公开类型/schema、查看器模板和生成器，以及独立 Tool 样板。需要 Node.js 20 或更新版本；只读功能与受控改名提案已完成各自限定 macOS 验收，实际范围见下文。Windows/Linux 不在当前声明范围。

## 创建工程

选择自己的命名空间及不存在的工程目录；工程放在开发包目录之外：

```bash
node create-plugin.mjs --id your.notes --out /tmp/your-notes --extension txt
cd /tmp/your-notes
npm install --offline --ignore-scripts --no-audit --no-fund
npm run build
npm run package
```

产物是工程根目录的 `plugin.zip`。该流程使用开发包中的 SDK tgz，不访问 npm 注册表、不运行依赖安装脚本，也不需要宿主源码或 node_modules。

SDK 尚未发布到公开 npm 注册表，不要把 `npm install @omniflow/plugin-sdk` 当作可用的发布流程。完整 API、错误和配额见 `SDK.md`，Manifest 契约见 `manifest.schema.json`。

## 独立样板

`examples/csv-viewer`、`examples/json-tree-viewer`、`examples/comic-viewer`、`examples/csv-tool` 、`examples/batch-rename` 和 `examples/csv-export` 分别覆盖文件查看、目录漫画、同包 Viewer/Tool、元数据改名提案与CSV/JSON完整导出，均只依赖本开发包 SDK。在任一示例目录执行相同的 install/build/package 命令即可得到 ZIP。CSV Viewer 默认 ID 为随包保留 ID，制作外部副本时先修改 Manifest 的 id、viewers[].id 和 activation；Tool 副本还应同步 agentTools[].id 和 tool activation。

开发包当前包含 SDK 0.5.0，格式 2 支持独立 Tool 批准。CSV Tool 已接入内部 Agent 生产工具目录和会话单文件权限，在 macOS 通过真实模型与资料库验收；新安装/启用的 Tool 从后续新 Run 的冻结目录发现。

batch-rename 只声明元数据提案与 Tool 权限，收到随机引用和名称，不能读正文或直接写文件。宿主标准审批卡展示完整提案，批准后使用条件原子接口执行。真实 macOS Agent 与 Win/local-minio 专用合成文件已验证双阶段批准、改名、回执审计和目录/预览同步，完整边界见宿主 W0～W2 验收记录；安装成功不能代替后端兼容与本次批准。生成器仍创建只读 Viewer 工程，改名插件以本样板为起点。

## 安装与授权

1. 宿主“设置 → 插件管理 → 安装 / 更新本地包”，选择 ZIP。
2. 核对真实 ID、三段版本、请求/新增能力、未验证来源和 SHA-256 指纹后确认。
3. 启用插件并分别批准声明能力。Viewer 从文件“查看器”菜单选择并授权当前资源；只读 Tool 需要读取和 Agent Tool 批准；改名提案需要 `resource.rename.propose` 与 `agent.tools`，每次还须通过宿主范围及具体提案批准。

权限不能从快照恢复；每次新实例仍需宿主授予当前资源。上下文中的不透明 handle 不是下载 URL，不能访问其他文件或账号。

改名提案的插件完成事件不代表文件已改名；宿主负责 old value 条件、冲突、原子提交和 operation 回执。取消不能撤销已经提交的名称变化，结果不明时由宿主核对，插件不得新建操作盲目重试。本版不提供跨重启自动核对或撤销。

修改、构建、更新时提高 manifest.json 的 version；SDK 主版本、包格式版本和设置 schema 版本独立管理。支持回滚到保留包；各版本设置隔离，新版本不应假设已迁移旧数据。卸载默认保留用户文件、设置和阅读快照；设置清理是单独确认操作。

## 开发约束

- 静态 ZIP 根目录直接放 manifest.json 与构建资产，不额外套工程目录。
- `omniflow` 命名空间和 `example.csv` 为宿主保留，生成器不会替你使用这些 ID。
- viewer ID 必须位于自己的插件 ID 命名空间，activation 与贡献精确对应；扩展名不带点。
- HTML/CSS/JS 只使用本包资源；不能请求任意网络、本机文件、Shell、Node、通用 IPC 或主窗口 DOM。
- 读取 64 KiB/块，支持 AbortSignal；文件变化、撤权或停止后丢弃迟到结果。
- 设置/状态按 revision 写入。冲突后重新读取，不盲目覆盖；超时或取消不是已完成写入的事务回滚。
- 读取/解析/DOM 渲染必须有上限。数字精度、非法输入、空文件和截断必须明确处理。
- 当前源包总计/ZIP 各不超过 4 MiB，单文件 1 MiB，最多 64 文件；原生文件选择、拖出数据、声音、WebGL 不能绕过 SDK。

## 故障恢复

管理页可停用、撤权、回滚、开启恢复模式和恢复内置外观。插件死循环、超预算或违反隔离边界会被停止，不应阻止宿主打开管理页面。启动前还可用 `--disable-third-party-plugins`；开发宿主可使用 `OMNIFLOW_DISABLE_THIRD_PARTY=1`。

“最近操作与失败日志”包含插件/实例与请求哈希，默认不记正文或凭据。坏包预检失败不会注册部分贡献。发行包、多显示器、Windows/Linux 未在本轮交付中完成验收。

文件产物样板csv-export使用独立resource.output.propose批准，SDK正文上限1MiB，超限失败；目标由宿主确认后创建新文件、不覆盖，正文不进入模型Tool结果或聊天审计。它不改变生成器的只读Viewer默认模板。完整执行、上传和回执核对验收以宿主W3文档为准，SDK打包成功不代表端到端验收完成。
