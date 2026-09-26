# CSV 独立开发样板

C2 第一方开发样板，依赖 `@omniflow/plugin-sdk@0.1.0`，不导入宿主代码。将本地打包的 SDK tgz 安装为依赖后执行 `npm run build`，产物为 `dist/`，包含 Manifest、HTML、CSS、JS 和 SDK。

推荐从宿主仓库运行 `node tools/plugin-isolation/build-independent.mjs`；该命令会在仓库外复制工程、安装 SDK tgz 并独立构建。`node tools/plugin-isolation/run.mjs --inspect` 会创建新的临时用户目录，用合成 CSV 启动开发窗口；从「实验」菜单操作授权/撤权、主题、暂停/恢复、重载、停止、宿主浮层和有界诊断。

仅支持 UTF-8（含 BOM）、CSV 引号/转义引号/CRLF/字段内换行；文件最多 4 MiB、10000 行、128 列、100000 单元格、单元格 16384 字符；每页最多绘制 100 行。内容按文本显示，不求值、不执行 HTML。非法 UTF-8、未闭合引号或超限明确报错。采用跨分块有状态解析，拒绝非法引号，不承诺兼容其他 CSV 方言。

主题从 SDK 快照投影为样板自己的 CSS 变量。紧凑显示设置采用插件 namespace 和 revision；活动状态停止当前读取，恢复后重新检查授权。页码/滚动检查点通过 SDK state API 保存；C2 已接入 B2 打开方式、真实服务端授权与 Warm/Cold 恢复，详见 `docs/plugin-system-c2-csv-viewer.md`。

主题接入示例在 `src/main.js` 的 `themeProperties` / `theme` 与 `src/style.css`：同时消费初始 context 和 theme 事件，将应用/面板背景、正文/说明/禁用文字、边框、普通按钮三态与禁用填充、错误、焦点、文字划选及滚动条映射到包内变量，并按 mode 设置原生控件的 `color-scheme`。只通过 CSSOM 修改本包外链样式表；不导入宿主样式、React 或主题 owner，也不注入内联样式。每次应用前恢复亮暗两套 CSS 默认值，旧宿主缺字段或完整快照切回部分字段时不会残留上次颜色；旧 revision 不覆盖新快照。当前 CSV 全部是数据单元格，不将每页首行冒充表头；CSS 给未来真正的 `th` 保留独立表面颜色。包之间保留独立源码与构建，无跨样板运行时依赖。更改源码后需重新构建并更新包，已安装版本不会自动变化。

D1 可手动安装构建产物 ZIP，并提供更新/回滚；外部副本需修改插件 ID、viewer ID 和 activation，不能覆盖保留的 `example.csv`。本地包发布者未经验证，不代表已签名或可信来源。格式与流程见 `docs/plugin-system-d1-management.md`。当前 Manifest 只声明 macOS。包加载时使用稳定的开发目录，构建完成后再重载；不要让其他进程在加载期间改写目录。
