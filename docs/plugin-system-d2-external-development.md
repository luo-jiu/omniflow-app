# D2：第二样板与独立开发交付

更新时间：2026-09-14

状态：**D2 已完成 macOS 技术验收，本轮只读插件工程 A0～D2 收口。** 第二样板与模板通过现有 SDK 和 D1 管理运行，未添加 JSON 专属宿主分支、IPC 或后端接口。

## 1. 交付内容

| 交付 | 入口 |
| --- | --- |
| JSON 树查看器 | [样板说明](../samples/json-tree-viewer/README.md)、`samples/json-tree-viewer/src` |
| 只读工程模板 | [模板说明](../templates/readonly-viewer/README.md)、`templates/readonly-viewer` |
| 可移交开发包与生成器 | [开发包说明](../templates/plugin-kit/README.md)、`templates/plugin-kit/create-plugin.mjs` |
| 仓库外构建验证 | `tools/plugin-isolation/build-developer-kit.mjs`、`verify-external-kit.mjs` |
| 实际 Electron 复用验收 | `tools/plugin-isolation/run.mjs --d2`、`d2-lab.mjs` |
| 验证摘要 | [D2 结果](plugin-system-d2-results.json) |

生成的交付物保存在忽略版本控制的 `dist-plugin-kit/`：开发包 tgz、JSON 0.1.0 包、0.1.1 更新验证包和 CSV 替代测试包。源代码、模板和构建脚本保留在仓库，可重新生成。没有上传或发布 npm 包、插件商城或发行安装包。

## 2. 第二种功能：JSON 树

JSON 包身份为 `example.json-tree`，贡献为 `example.json-tree.tree`，匹配 `.json`。源码只导入 `@omniflow/plugin-sdk` 和包内 JSON 模型，不读取宿主 Context、DOM、文件 URL、鉴权工具或通用 IPC。

功能包括对象/数组展开、类型显示、可见节点分页、完整节点值与 JSON Pointer 路径查看、主题、活动/取消、展开/页码/滚动检查点及显示设置。它与 CSV 的表格解析/呈现不同，不把第二个 CSV 当作功能复用证明。

解析器先验证输入边界，再构建展示模型：

- 数字保留原始词法文本，`9007199254740993`、`1e400` 和 `-0` 不经过 Number 转换。
- 字符串按 JSON 规则解码并以转义形式显示；对象键顺序保留，重复键明确拒绝，不静默采用最后一项。
- `__proto__`、HTML、URL 等只作为数据；通过 textContent 渲染，属性不写入普通对象的原型。
- 支持 UTF-8/BOM、对象、数组和标量；拒绝 JSONC 注释、尾逗号、非法 UTF-8 和不完整 JSON。

预算为 1 MiB 文件、20000 节点、64 层嵌套、65536 字符字符串、4096 字符键、256 字符数字和 128 个同时展开节点；每页只渲染 200 个可见节点。超过 12 层时缩进封顶，详情仍显示真实深度与完整路径。摘要截短可进入详情查看完整值，不表示原数据被截断。

用户展开/翻页在模型就绪后提交检查点，程序性恢复滚动则抑制采样；不依赖隐藏窗口的动画帧。恢复遵循已有“最近成功检查点”契约，关闭不保证最后尚未完成的 200ms 滚动写入。设置失败时重新读取权威值并恢复控件显示，避免未保存选择伪装成成功。

## 3. 仓库外开发验证

开发包包含 SDK tgz、类型/schema 文档、模板、生成器以及两个独立样板源码；不包含宿主业务代码。SDK 当前为本地发布候选 `0.1.0`，Manifest 的 `sdkVersion: 1` 是契约代次，不是 npm 版本号；尚未发布公开 npm registry。

从宿主仓库导出并自动验证：

```bash
node tools/plugin-isolation/build-developer-kit.mjs
node tools/plugin-isolation/verify-external-kit.mjs
node tools/plugin-isolation/run.mjs --d2
```

命令输出真实临时目录位置。在导出的开发包内，开发者执行：

```bash
node create-plugin.mjs --id your.notes --out /tmp/your-notes --extension txt
cd /tmp/your-notes
npm install --offline --ignore-scripts --no-audit --no-fund
npm run build
npm run package
```

这些命令已实际运行验证。生成器拒绝保留 ID、重复参数、已有输出目录和开发包内部输出路径，不覆盖既有工程。生成工程将 SDK tgz 复制到 vendor，并使用本地 file 依赖。构建只用 Node 标准库复制自己的静态资源和 SDK；打包器生成带 CRC 的静态 ZIP，不借用宿主 alias、React 或 node_modules。

自动验证同时从开发包复制 JSON 与 CSV 工程到仓库外，分别离线安装、构建和打包；JSON 修改代码并升级到 0.1.1，CSV 改为独立 `example.csv-alternative` 身份。构建环境实测 Node v25.5.0，模板要求 Node 20+；Electron 渲染验证使用 30.5.1。此证据模拟外部作者的技术流程，不宣称已经由外部人员进行可用性或安全审计。

## 4. 宿主复用与兼容

本批改动位于样板、模板、工具、测试和文档。生产 `electron/` 与 `src/` 不增加这三个测试身份的判断；JSON、模板与 CSV 替代包均通过现有通用管理和资源 bridge 运行。

- 安装后仍停用、未批准读取；启用、能力批准与逐文件授权继续分离。
- 读取继续经不透明 handle、服务端权限/库归属与 ETag 校验。
- 主题、取消、状态与设置使用既有 API，没有新增 SDK 方法。
- 更新代码实际生效，旧包指纹的检查点不会注入新包；停用/卸载清理实例，用户数据保留。
- 两个 CSV 贡献具有不同 ID。安装第二贡献不会自动改变默认查看器；选择仍由既有 FileViewerContext 和格式关联 owner 管理。

## 5. 验证记录

最终 lint、build 与全量测试通过：374 个测试文件、2602 项测试通过，3 文件/7 项跳过。新增模型测试覆盖数值精度、字符串/键、原型名称、无效输入、全部配额和状态恢复；开发包测试验证离线打包、宿主预检接受及不覆盖已有工程。

17 项 Electron 检查覆盖：仓库外生成模板运行、纯文本而非 HTML、JSON 安装不授权、通用 bridge 打开、精确数字、原型/HTML 安全、200 行分页、树检查点恢复、主题、停用、独立更新代码、旧指纹状态拒绝、非法 JSON 错误与空树、CSV 冲突候选、替代 CSV 运行和卸载。

实际桌面验收仅使用第三个 **win** 资料库、本机 macOS MinIO：

| 场景 | 结果 |
| --- | --- |
| 独立包安装 | JSON 0.1.0 通过已有管理页预检、安装、启用和批准 |
| 真实文件 | 新建 `/文档/omniflow-d2-qa-20260914.json` 合成数据，共 759 节点；默认仍为文本 |
| JSON 展示 | 明确逐文件授权后读取；对象/数组展开与两页列表正常 |
| 数字与详情 | `9007199254740993`、`1e400` 原样呈现；详情显示 `/large`、层级和完整数字 |
| 关闭恢复 | 核对已提交检查点后重开，展开结构与第 2/2 页恢复，显示类型设置保留 |
| 更新 | 仓库外 0.1.1 包通过已有管理页更新，重新停用并要求授权 |
| CSV 匹配冲突 | 既有合成 CSV 仍默认文本；菜单并列显示随包 CSV 和独立替代 CSV 的身份 |

原生菜单、AX 与画面曾更新不同步；首次选择通过现有选择事件并重绘核对，随后用原生菜单复测。检查点以实际持有的成功快照与复测为准，不把初次未确认的观察记为通过。

验收标签已关闭。实际 profile 中仅本次安装的 JSON/替代 CSV 包，在停止开发进程后通过宿主存储按身份和指纹校验后移除；设置、阅读快照以及合成资料库文件保留。没有读取第一个资料库、改写其他文件或向插件开放写能力。

## 6. 本轮收口与后续范围

A0～D2 的 macOS 只读插件技术链路已完成：内置外观、稳定贡献、查看器兼容、公开 SDK、隔离、真实资源、管理恢复、第二功能和可移交模板均有实现及证据。

Windows/Linux、发行安装包、多显示器/DPI、真实外部开发者试用、公开 SDK 发布、写入能力、主题包安装与商城仍在后续范围。当前预算、权限边界及恢复规则继续以 D1 为准，不能把本轮完成解释为开放任意本机程序执行或承诺全平台生产支持。
