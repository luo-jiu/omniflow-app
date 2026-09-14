# OmniFlow 只读插件开发包

此开发包独立于宿主仓库，包含 SDK tgz、公开类型/schema、工程模板和生成器。需要 Node.js 20 或更新版本；当前只声明 macOS OmniFlow 宿主已经验收。

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

`examples/csv-viewer` 和 `examples/json-tree-viewer` 含两种功能的完整源码，均只依赖本开发包 SDK。在任一示例目录执行相同的 install/build/package 命令即可得到 ZIP。CSV 示例默认 ID 为随包保留 ID，制作外部副本时先修改 Manifest 的 id、viewers[].id 和 activation；JSON 示例可直接用于本地验证。

## 安装与授权

1. 宿主“设置 → 插件管理 → 安装 / 更新本地包”，选择 ZIP。
2. 核对真实 ID、三段版本、请求/新增能力、未验证来源和 SHA-256 指纹后确认。
3. 分别启用插件、批准读取能力；然后在匹配文件的“查看器”菜单选择它，并允许读取当前文件。

权限不能从快照恢复；每次新实例仍需宿主授予当前资源。上下文中的不透明 handle 不是下载 URL，不能访问其他文件或账号。

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
