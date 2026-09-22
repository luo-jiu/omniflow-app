# D1：本地插件安装、管理与恢复

更新时间：2026-09-14

适用范围：macOS 客户端内的手动 ZIP 安装、只读查看器、权限管理、版本恢复与故障隔离。前置契约见 [C1 隔离实验](plugin-system-c1-sdk-isolation.md)、[C2 真实资源链路](plugin-system-c2-csv-viewer.md)；总入口为 [实施计划](plugin-system-implementation-plan.md)。

状态：**D1 已通过 macOS 本地受限只读范围验收。** lint、build、2582 项测试以及 C1/C2/D1 Electron 回归全部通过；后续 D2 已完成，见 [独立开发交付](plugin-system-d2-external-development.md)。

AT0 增量：格式 2 包可包含 Tool；管理页和安装索引增加独立 Tool 批准，原读取批准不自动授权 Tool。启停/撤权/升级广播 Viewer 与 Tool 运行时，底座见 [AT0](plugin-system-at0-tool-runtime.md)，真实模型与实际资料库调用已通过[AT1](plugin-system-at1-agent-tools.md)核心验收。

## 1. 当前能力

宿主设置中新增“插件管理”，库列表设置和资料库工作区设置复用同一页面。页面支持安装预检/确认、插件版本与贡献详情、启停、读取批准/撤销、更新、单个保留版本回滚、卸载、清除设置、恢复模式和失败日志。

列表来自 main 的 `PluginManager`，renderer 只订阅快照并提出操作，不持有另一份安装事实。首次安装和每次更新均保持停用、未批准读取；启用、批准能力、逐文件授权是三个独立门槛。菜单展示标题与包来源/ID，避免同名插件混淆。未安装、停用、被阻止或未取得必要能力的贡献不进入打开方式。

D1 原始验收仅覆盖只读 Viewer Manifest 与 SDK。后续 E1 增加目录 Viewer，AT0～AT2 增加独立 Agent Tool，W0～W2 增加 `resource.rename.propose` 元数据提案与宿主条件提交；各自范围及验收状态以专题为准，不追溯扩大 D1 结论。仍不包含商城、自动下载更新、第三方外观包安装、任意网络、Node、Shell、媒体或原生二进制。随应用提供的 CSV 可以停用/撤权，但不能被本地包覆盖、卸载或回滚。Windows/Linux 仍未验收，不开放安装入口。

改名包的启用、元数据提案权限与 Agent Tool 权限独立管理；插件安装/授权不等于用户批准某批改名。更新/停用/撤权会中断提案运行，已发出的条件提交则按 W0～W2 有界结算，不把实例终止误报成未提交。详情见 [受控改名](plugin-system-w0-w2-rename.md)。

W3 文件处理包增加独立 `outputApproved`：读取、`resource.output.propose` 和 Agent Tool 分别批准，包指纹变化及回滚不会沿用旧产物授权。安装/启用不代表批准目标目录中的新文件；具体产物仍走标准批准。已发生操作的固定“查询回执”不运行插件，停用或卸载后仍可按当前账号权限查询。实际 macOS 正常导出及未知查询未手验边界见 [W3](plugin-system-w3-file-output.md)。

## 2. 入口与 owner

| 入口 | 职责 |
| --- | --- |
| `src/features/plugin-management/PluginManagement.tsx` | 独立管理页面、安装审阅、状态/错误、确认与恢复操作 |
| `src/service/plugins/plugin-management.api.ts` | 宿主快照与 IPC 包装；丢弃旧 revision，不乐观伪造启停结果 |
| `src/features/file-viewer/contributions/installed-viewers.ts` | 按实际可用 catalog 注册 B2 贡献；版本变化更换适配组件，旧逐文件授权不复用 |
| `electron/service/extensions/plugin-management-ipc.ts` | 主窗口 main frame 来源校验、原生文件选择器、受控操作及错误映射 |
| `electron/service/extensions/plugin-manager.ts` | 安装/准入/故障与运行状态的宿主编排 |
| `plugin-install-store.ts` / `plugin-zip.ts` | 私有 staging、ZIP 校验、原子安装记录、更新/回滚与代码回收 |
| `plugin-settings-store.ts` | 有界、按包指纹隔离的本机设置；损坏时关闭读写，支持先备份再重置 |
| `plugin-session-pool.ts` / `isolated-view.ts` | 四个固定 session 槽位、隔离视图、资源预算、强停和复用前清理 |

D1 复用 C2 的真实后端授权适配和 B2 的标签/恢复 owner，没有新增 Go 接口或数据库表。安装记录位于当前 Electron userData 的 `plugins-v1`，并行开发继续使用既有 userData suffix；同一个 userData 不支持多个写进程共享安装状态。

## 3. 包格式与安装事务

ZIP 根目录必须直接包含 `manifest.json`，不能额外套一层工程目录。只打包构建后的静态产物，不带 node_modules、源码文档或安装脚本。独立样板构建后可在 dist 目录执行：

```bash
zip -r ../viewer.zip manifest.json index.html main.js csv-parser.js sdk.js style.css
```

外部作者必须使用自己的插件 ID 与 viewer ID；`example.csv` 和 `omniflow` 命名空间由宿主保留。Manifest 格式版本和 SDK 主版本目前均只接受 1，最低宿主版本、平台、贡献、激活条件和能力先于代码执行校验。插件 ID 不重复，viewer ID 还会跨所有已安装包检查冲突，包含嵌套命名空间；预检后提交及回滚时再次复核。

流程：

1. 原生文件选择器提供 ZIP 路径；renderer 不能自行指定安装目录或向执行入口传包路径。
2. main 用禁止跟随文件 symlink 的打开方式取得有界字节快照，再从该快照解包到私有 UUID staging。
3. 校验路径、目录/文件类型、大小、压缩比、CRC、重复/大小写冲突、Manifest、平台和 SDK，以及静态资产白名单与 SVG 规则。
4. 展示身份、版本变化、请求/新增能力、未验证的本地来源与 SHA-256 指纹。安装票据最多保留 5 分钟，取消/过期不能提交。
5. 确认时重新计算 staging 指纹，并比较预检时记录的原版本。先停止该插件准入和实例，再发布不可变版本目录，最后以原子 rename 替换安装 index。
6. index 写入失败时旧记录不变，旧版本仍可重新打开；提交后的代码回收不反向把成功事务报告为失败。新版本默认停用且未批准读取。

指纹为 SHA-256，带 `omniflow-package-v1` 域、按确定性文件名顺序编码的路径与字节长度、实际文件字节。长度和边界参与哈希，避免不同文件拆分形成相同输入。它证明用户确认的字节与激活字节一致，**不证明发布者身份**；当前所有手动包均显示“发布者未验证”，不因名称或 ID 冒充官方来源。

版本目录以指纹命名，文件只读；每次启用、回滚和运行仍复核字节。安装器不处理可执行安装脚本、符号链接、硬链接对象或路径穿越。staging/packages 子目录先验证为真实目录，避免清理时跟随意外 symlink。私有目录与 sandbox 阻止插件修改安装文件；不承诺对同一 OS 用户的任意外部文件修改程序提供完整防篡改保证。

## 4. 权限、停用和版本恢复

读取有效范围始终为：服务端用户权限 ∩ 插件声明/批准能力 ∩ 当前获准文件。安装或启用不发放句柄；C2 仍由 main 取得用户和节点事实、验证库归属、固定 ETag、检查签名目标范围，并拒绝重定向。插件不获得凭据、URL、主窗口 DOM、通用 IPC 或管理 bridge。

安装/启停/撤权/升级期间先关闭准入，再撤销句柄、取消 pending open/读取、销毁实例，随后投影贡献变化。晚到结果不能重新激活。已交付字节无法追回，撤权不承诺擦除历史读取。

更新只接受严格更高的包版本。保留一个可校验旧版本；回滚交换当前与保留包，仍要求重新启用和批准。代码、设置和阅读恢复分别处理：

- 设置按插件、包指纹、服务端账号 scope、资料库隔离，版本之间不执行迁移，不把新版写入覆盖旧版设置。回滚重新访问旧包自己的设置。
- 阅读状态继续交给 B2 Warm/Cold，并附带包指纹；指纹或资源版本不匹配时不向另一个版本投递快照。它是可失效的 UI cache，不是用户草稿。
- 卸载停止并移除代码/贡献，默认保留用户文件、插件设置和阅读快照。只有“清除设置”的独立确认操作会清理该插件所有版本的本机设置，仍不删除文件或阅读快照。
- 设置文件损坏时停止设置读写，管理页提供“备份并重置损坏设置”。明确确认后停止插件，保留原文件备份，再重置设置；不会静默吞掉或覆盖损坏数据。

## 5. 故障隔离与安全启动

恢复模式可在管理页即时开启并持久化；它停止第三方实例并阻止新的第三方激活，随应用能力不受影响。还可在启动前使用：

```bash
OMNIFLOW_DISABLE_THIRD_PARTY=1 npm run dev
```

打包客户端支持 `--disable-third-party-plugins`。启动参数强制模式不能在管理页直接解除，移除参数并重启后再操作。管理、失败原因、停用和恢复内置外观均由可信宿主提供，不需要第三方成功启动。

安装 index 损坏时 fail closed：阻止第三方，保留原代码目录及设置，允许从管理页重新预检。包完整性失败显示被阻止；运行挂死、崩溃、超预算、本机文件选择或失去文件选择拦截时隔离该插件，并持久化停用/失败原因。重新启用是显式操作，不恢复旧句柄或逐文件授权。

沿用 C1 的 sandbox/contextIsolation、独立 origin、来源绑定、默认拒绝网络/导航/新窗口/下载/权限/子 frame。补充边界：

- session 固定最多四个槽位；先销毁旧 WebContents、移除协议/监听器并清理 storage/cache，完成后才能租给新实例。origin 每次重新生成，旧消息来源不可复用。
- 禁止 JS 对话框、拖出数据、拖入导航、WebGL，并强制静音；没有媒体出声或向 OS 交付任意 DownloadURL 的旁路。
- 先在受控空白页建立文件选择拦截，再运行包脚本。HTML file input 不能绕过 SDK 读取本机文件；触发选择器或拦截失效时停止实例。File System Access 权限同样默认拒绝。
- Vite 不使用全局 `--no-sandbox`；宿主发现该参数即拒绝加载，专用 preload 还核对 `process.sandboxed`。

## 6. 预算与清理

| 对象 | 限制与行为 |
| --- | --- |
| ZIP 输入 / 解压总字节 | 各 4 MiB；不接受加密 ZIP |
| 文件 / 目录项 / 深度 | 单文件 1 MiB、最多 64 个文件、128 项、最多 8 层目录 |
| 压缩比 | 每项最多 100 倍，小项容忍至 1 KiB；逐项 CRC 校验 |
| staging | 最多 2 份，票据 5 分钟；启动清理中断 staging，过期在下一次预检回收 |
| 安装 | 32 个外部包；通常每包当前+上一版，版本目录保守上限 66 个；不删除损坏 index 留下的保留包以伪装成功 |
| 设置 | 每 namespace 32 keys / 256 KiB；全局 256 namespaces / 4 MiB；单次仍受 SDK 16 KiB request 约束 |
| 损坏设置备份 | 最多 3 份，不静默覆盖已有备份 |
| 实例 / session | 最多 4 个活动/租用槽位，管理加载不再受 C1 64 次累计激活限制 |
| renderer 资源 | 每秒观测；working set 超过 256 MiB，或 CPU 超过 80% 连续 3 次采样时终止；无响应仍走心跳看门狗 |
| 日志 | 管理会话最多 128 条；RPC 失败按秒采样，包含插件/实例及请求 ID 哈希，不记录请求正文、原始请求 ID、URL 或凭据 |

CPU/内存是 main 观测后终止的限额，不是 OS 硬配额，不承诺零瞬时超量或抵御内核/Chromium 漏洞。RPC/读取/快照预算继续采用 SDK `LIMITS`；session 清理失败的槽位不再使用。设置达到全局配额会明确报 LIMIT，须由用户选择清理，不把旧设置当缓存自动删除。

## 7. 验证与已测范围

自动命令：

```bash
npm run lint
npm test
npm run build
node tools/plugin-isolation/run.mjs
node tools/plugin-isolation/run.mjs --c2
node tools/plugin-isolation/run.mjs --d1
```

安装测试覆盖恶意路径、symlink/类型、大小、大小写冲突、SDK 不兼容、跨包 viewer ID 冲突、staging 篡改、并发预检冲突、index 替换失败、回滚、损坏 index、真实目录检查、持久化设置/CAS/版本隔离和显式备份恢复。页面测试覆盖确认前不提交、启用不自动批准读取、宿主状态单源及卸载保留说明。

D1 Electron 实验使用全新临时 userData、合成 HTTP/存储服务和独立构建包，通过真实管理/查看器 IPC 验证安装、权限、禁用、更新、回滚设置、安全模式、卸载与重建状态。70 次激活复用不超过四个 session；死循环时管理页面所在 renderer 仍响应；超内存与本机 file picker 均能终止并隔离。恶意包只在临时实验宿主运行，不安装到真实用户 profile。

实际桌面验收只在第三个 **win** 资料库访问既有合成 CSV `/文档/omniflow-c2-qa-20260914.csv`：

| 场景 | 结果 |
| --- | --- |
| 设置进入管理页 | 随包 CSV、状态、能力、恢复入口、版本详情和日志可见 |
| 安装 local.csv 1.0.0 | 原生选包 → 身份/权限/指纹预检 → 确认；默认停用、未批准读取 |
| 票据过期 | 过期提交被拒绝，没有半安装贡献；可重新选择预检 |
| 启用与批准 | 两次独立操作；打开方式区分随包与 local.csv |
| 真实文件打开 | 同一标签选择本地插件后仍需逐文件授权；206 行 CSV 正确显示 |
| 更新到 1.0.1 | 显示版本差异，提交后重新停用/未批准，并保留 1.0.0 |
| 回滚到 1.0.0 | 明确确认后旧版本恢复，继续要求重新启用/批准 |
| 恢复模式 | 本地插件显示被阻止，随包能力与管理页保持可用；可恢复正常模式 |
| 停用后的标签 | 原文件保留，自动回退内置查看器，requested ID 与恢复信息保留 |
| 卸载确认 | 清楚说明保留用户文件、设置和阅读快照；实际删除由隔离宿主自动测试覆盖 |

原生 AX/截图曾落后于 DOM，已通过实际 DOM 状态和窗口重绘复核，不把旧加载画面当作失败结果。验收未进入第一个资料库，未改写 CSV 正文；本次安全测试包在收尾时通过受控宿主存储移除，设置及阅读快照保留。恢复模式最终关闭，未安装真实恶意包。

完整结果及数量见 [D1 验证摘要](plugin-system-d1-results.json)。发行安装包、Windows/Linux、多显示器/DPI 以及多个写进程共享 userData 未验收。D2 已用 JSON 树和仓库外开发包验证复用，详情见 [D2](plugin-system-d2-external-development.md)；后续仍不能为新插件增加专属核心分支。
