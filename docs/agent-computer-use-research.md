# Agent 界面操作调研与轻量实现建议

更新时间：2026-10-12

状态：本文保留实现前的源码与官方接口调研快照，并补充鼠标争用、窗口捕获范围和 AX 摘要的后续结论；2026-10-10 的公开实现复核见第 9 节，进一步后台输入研究与阶段方案见第 10 节。后续已实现 macOS AX-only / 按需单窗口截图、有界 AX 文本、窗口搜索、观察内元素标识、AXPress、有限原生文本替换 / 插入及语义滚动；2026-10-12 原生页子按钮后台滚动和 Finder 视图往返通过限定真机验收，同日新增窗口定向快捷键、右键、双击和有界拖拽，路线与依据见第 11 节，最新实现与证据以[内置应用窗口操作](agent-computer-use.md)为准。本文第 5～8 节保留实现前的接线建议；无上限 AX、任意软件通用 keyboard / 画布 / 手势协议仍是目标设计。旧全局鼠标版的记录不代表当前窗口限定实现。

适用范围：内置 Agent 的截图、可访问性观察、鼠标键盘输入，以及 Electron main / 平台驱动边界。

## 1. 结论

可以自研一个较轻的实现，无需复制 Codex Agent，也无需先建设持续视频共享或远程桌面。最小闭环是：**读取目标窗口截图和可访问性树 → 模型选择控件或坐标 → 宿主执行一次动作 → 重新观察**。

建议复用 OmniFlow 的 Tool Registry、main prepare、Run capability snapshot、权限、ToolRun 和模型续轮，只新增平台观察与输入驱动。对于当前 macOS 环境，独立 Swift helper 调用系统接口是直接的选择；Windows 使用独立 UI Automation / SendInput adapter，不能由 macOS 调研推定已经支持。

Codex 的开源仓库可以借鉴工具分发、配置和生命周期。实际桌面驱动通过安装包中的 `@oai/sky` 与 `Codex Computer Use.app` 提供；本机 Computer Use 插件标明 Proprietary，不能将其当作 Apache-2.0 仓库中的开源驱动移植。

## 2. 本次证据范围

- 用户授权更新的 `project/codex` 已执行 `git pull --ff-only`，从 `2cc65cdd4c7c167f0c7252fcb5165d649c16aca0` 快进到 `2351d9e1b608e6f9d9a3699b71d7eb39ee41cfa4`；原有未跟踪文件保留。
- OmniFlow 的判断来自本次工作树。已有其他任务的 Agent UI 未提交改动不属于本次调研变更。
- 只读检查了本机 `unified-computer-use` 插件 manifest / MCP 配置，以及已分发的 `@oai/cua`、`@oai/cua-repl`、`@oai/sky` 普通 JS、类型声明和 API 文档。没有分析原生二进制或复制其实现。
- 没有运行桌面控制、截图、输入或 OS 权限请求；没有进入资料库做验证。后续实测仍须使用本机 macOS MinIO 的非第一个资料库，Win 可用时优先 Win。

## 3. Codex 实际如何调用

```text
模型调用 cua_repl.js
  → cua.getApp / App 的观察与操作接口
  → sky.get_app_state / sky.click 等
  → nodeRepl.rpc("sky", ...)
  → @oai/sky/service
  → MacComputerUseClient
  → 本地 native pipe / socket
  → Codex Computer Use.app
  → 返回可访问性文本、截图或动作回执
```

`cua.getState()` 主要取得应用与浏览器清单。目标应用的实际状态通过 `getApp`、`getAXState`、`getAXStateAndScreenshot` 等取得，不能把清单视为已经观察了屏幕。

可见协议包含以下机制：

- 应用状态包括可访问性文本与窗口截图，支持完整树或相对上次观察的 diff。
- 点击支持最近观察中的元素编号，也支持应用窗口截图坐标；输入、快捷键、滚动、设置可编辑控件值等使用同一调用链。
- macOS client 将观察发送为 `ComputerUseIPCAppGetSkyshotRequest`，将动作发送为 `ComputerUseIPCAppPerformActionRequest`。底层 transport 使用本地 socket、长度前缀和 JSON-RPC，请求带版本及 deadline。
- 原生服务由宿主的 `ensureService` 或 LaunchServices 启动，不要求建立 VNC 等远程桌面连接。
- 插件在 Stop / Interrupt / SubagentStop 时通知 `turn_ended`，让运行时收口本轮资源。

安装包中可复核的相对位置：

| 文件 | 可确认的事实 |
| --- | --- |
| `@oai/cua-repl/README.md` | 通过 NodeREPL 注入 cua API，插件由应用配置执行路径和启用 surface |
| `@oai/cua/.../tinysky_alt/create_tinysky_alt.js` | getApp 读取目标应用状态并绑定应用 |
| `@oai/cua/.../tinysky_alt/bind_mac_app.js` | AX 观察、联合截图观察，以及元素编号 / 坐标点击适配 |
| `@oai/sky/.../sky.js`、`service.js` | 可信 RPC 与平台 client 分发 |
| `@oai/sky/.../targets/mac/client.js`、`client.d.ts` | 原生请求类型与 skyshot 结果结构 |
| `@oai/sky/.../targets/mac/native-pipe.js` | 本地 transport、服务启动及超时 |
| `@oai/sky/docs/sky-window-api.md` | 可访问性文本、截图、最近状态元素编号的公开接口说明 |

上述 JS 不包含 macOS AX 树的原生序列化和事件注入实现。`skyshot.text` 在 JS 中是 opaque string，不能据此宣称 Codex 原生层具体用了哪一个 Apple 截图或事件 API。下一节的 API 是 OmniFlow 可以自行采用的实现方案。

### 后台点击与屏幕共享图标

OpenAI 官方 [Computer use](https://learn.chatgpt.com/docs/computer-use) 与 [Use your computer with Codex](https://learn.chatgpt.com/use-cases/use-your-computer-with-codex) 明确说明 macOS 可在后台操作，用户可以继续在其他应用工作，并通过画中画查看当前操作；Windows 则使用前台鼠标/键盘。屏幕录制权限负责观察，辅助功能负责操作。菜单栏共享屏幕图标只证明系统正在提供捕获，不证明有第二只系统鼠标；光标/高亮可作为叠层反馈，不能由其外观推断私有输入驱动。

公开 `CGEventPostToPid` 可向指定进程投递事件，但不足以保证所有 AppKit/Chromium 控件接受后台点击。公开 axcli recipe 涉及私有窗口位置接口及未文档化事件字段，当前不采用，也不以 Command 修饰键改变普通点击语义。Codex 原生驱动仍为专有组件，没有足够证据还原其通用坐标输入实现。

OmniFlow 当前点击选择公开 AXPress，文本与滚动分别使用已确认可写的原生文本属性和控件真实声明的 AX 滚动动作；均绑定已观察控件，不发送 CGHID、不移动指针、不主动激活或 AXRaise，不支持的控件明确失败。Electron 30 的 Chromium 124 为 clickable AX 节点暴露 AXPress，再转发默认动作；画布/未暴露动作的控件不能据此点击，网页输入也不走当前原生文本路线。AX 操作可能改变目标页面内焦点，App 自身也可能请求前台，因此“所有应用完全不抢焦点”必须逐 App 验证，不能从 API 形式推定。

Apple 对 `kAXErrorCannotComplete` 明确说明动作不一定失败，故执行结果按 unknown 结算，不自动重试 AX 或补坐标点击。原生依据见 [AXUIElementPerformAction](https://developer.apple.com/documentation/applicationservices/1462091-axuielementperformaction)、[Chromium 124 Cocoa AX 动作](https://chromium.googlesource.com/chromium/src/+/124.0.6367.243/content/browser/accessibility/browser_accessibility_cocoa.mm#2336)。

公开仓库中可以复用或参考的层：

- [MCP handler](../../project/codex/codex-rs/core/src/tools/handlers/mcp.rs)：模型工具调用进入 MCP 执行链。
- [MCP 调用生命周期](../../project/codex/codex-rs/core/src/mcp_tool_call.rs)：审批、取消上下文、模型策略 metadata 与结果。
- [MCP connection manager](../../project/codex/codex-rs/codex-mcp/src/connection_manager.rs)：目标 server / environment、工具过滤与 timeout。
- [Computer Use 配置](../../project/codex/codex-rs/config/src/computer_use.rs)：macOS bundle ID 与 Windows 应用身份的访问设置。
- [插件清理 hook](../../project/codex/codex-rs/plugin/src/bundled_hooks.rs)：`unified-computer-use` 对 `cua_repl.turn_ended` 的收口。

## 4. 轻量原生驱动

### macOS

一个由 Electron main 管理的 Swift helper，通过 stdio / JSON Lines 接受固定操作即可；不必在第一阶段建设 REPL、任意脚本执行、独立 MCP 服务或常驻网络端口。

| 工作 | 可采用的系统接口 | 首版边界 |
| --- | --- | --- |
| 权限检查 | AX 信任与屏幕捕获权限检查 | helper 自检；Electron 进程获授权不等于 helper 已获授权 |
| 单帧截图 | ScreenCaptureKit / SCScreenshotManager | 指定窗口；返回图像尺寸、窗口矩形与比例 |
| 控件观察 | AXUIElementCreateApplication / CopyAttributeValue | 限定目标应用、窗口、深度、节点数和文字预算 |
| 语义激活 | 查询支持的 AX actions，再 PerformAction | 支持时优先 AXPress；不同控件需要对应动作 |
| 鼠标与键盘 | CoreGraphics CGEvent | 坐标点击、滚轮、文本和按键；目标复验后串行发送 |

AX 树是应用暴露的控件语义，能提供按钮、名称、状态和位置等信息，不代表所有画面都可见。自绘 canvas、部分游戏或可访问性不完整的应用仍需截图定位。

本机 SDK 核实：`SCScreenshotManager.captureImage(contentFilter:configuration:)` 从 macOS 14.0 可用；rect 截图接口从 15.2 可用，`SCScreenshotConfiguration` 是 26.0 新增。首版可以选 14.0 的 filter / SCStreamConfiguration 组合；更低系统版本需要单独选择截图兼容路线，不应误用新 API 后宣称兼容。

资料：[Apple AX action](https://developer.apple.com/documentation/applicationservices/1462091-axuielementperformaction)、[SCScreenshotManager](https://developer.apple.com/documentation/screencapturekit/scscreenshotmanager)、[CGEvent 鼠标](https://developer.apple.com/documentation/coregraphics/cgevent/init(mouseeventsource:mousetype:mousecursorposition:mousebutton:))。

### 当前单窗口捕获实现与范围依据

用户要求共享后只查看对应应用 / 窗口，因此实际实现采用一个获准窗口作为最小授权单位，不能把应用名、PID 或 OS 录屏权限解释为可采集该应用所有窗口 / 整个显示器。main 默认解析当前 OmniFlow owner window，后续沿用本 Run 共享目标；用户指定应用 / 窗口名时精确匹配，出现多个匹配就拒绝。首次与切换目标走既有审批卡，目标 ID 由 main 签发。

Electron 30 的 `DesktopCapturerSource.id` 格式为 `window:XX:YY`，macOS 的 XX 是 CGWindowID；YY 不是 PID。`BrowserWindow.getMediaSourceId()` 可关联自有窗口，外部窗口还必须匹配 CG owner PID、内核进程启动时间和窗口几何。ID 单独不足以抵御关闭 / 重建或 PID 复用，完整身份仍留在 main 的私有 binding 中。

直接 npm/exec/spawn 启动的开发 Electron 暴露了 `NSRunningApplication.launchDate` 的限制：AppKit SDK 明确注明，未经过 LaunchServices 启动的应用可能没有该属性。当前实现统一使用公开 libproc `proc_pidinfo(PROC_PIDTBSDINFO)` 的 `pbi_start_tvsec/usec` 派生整数毫秒，检查结构返回尺寸、PID、非 zombie 状态与时间范围；开发直接启动和正常 LaunchServices 启动不再混用身份来源。获取不到内核身份仍拒绝，不删除或绕过进程重启 / PID 复用校验。最终版本已通过双架构编译和纯进程元数据自检：直接提取源码函数，仅加载 Foundation / Darwin，确认自身启动时间非空、子进程读取父身份一致、重复查询稳定；没有调用 CG / AX / 截图 API，真机窗口验收单独记录。

不能用 `desktopCapturer.getSources({types:['window'],thumbnailSize:非零})` 返回所有缩略图再挑选一个来实现严格单窗授权：该 API 没有指定 source ID 的参数。Electron 的 [v30.0.1 native wrapper](https://github.com/electron/electron/blob/v30.0.1/shell/browser/api/electron_api_desktop_capturer.cc) 创建窗口媒体列表并刷新 thumbnails；Chromium 124 的 [NativeDesktopMediaList](https://github.com/chromium/chromium/blob/124.0.6367.91/chrome/browser/media/webrtc/native_desktop_media_list.cc) 会依次 SelectSource / CaptureFrame，recurrent ScreenCaptureKit 分支还会先选择前 N 个来源。虽然 API 文档称零 thumbnail 可省略处理，recurrent 路径的 SelectSources 发生在后段零尺寸检查之前，严格范围实现不以零尺寸作为“绝不调用捕获”的保证。

实际 Swift helper 新增三个固定操作：`--windows` 只读 CGWindowListCopyWindowInfo / NSRunningApplication 元数据，不取像素也不创建 AX application；`--window-targets` 只遍历冻结窗口的 AX 树；`--window-capture` 使用 `SCContentFilter(desktopIndependentWindow:)` 与 macOS 14+ `SCScreenshotManager.captureImage`。SCWindow.windowID、owner PID、frame 必须匹配冻结身份，捕获前后再复验 CGWindowID / PID / 进程启动时间 / 窗口几何和标题。没有 display filter、app-wide filter、先截全屏后裁剪或旧 API fallback。

当前 `--window-targets` 在固定候选预算内观察有限 press / 文本 / 滚动能力，并为同一个已匹配 AX 窗口独立生成 `axTree / axTreeTruncated`。树按角色缩进，读取标题、描述、enabled、可读取值和支持的动作名称；secure 控件值以及 subrole 未知的文本输入值不读取。只走该窗口 AXChildren，遇到不同进程或嵌套的其他 AXWindow / AXApplication 就停止该分支并标记部分结果。字段移除 C0/C1 与 bidi 控制字符，tab/CR/LF 转空格；树格式只有 LF 和空格缩进，没有 native PID、窗口 ID、句柄、几何或私有候选 path。树遍历限 2048 节点、32 层路径、每节点 64 子项、单字段 200 Unicode scalar / 256 UTF-8 bytes；总文字含截断标记不超过独立 12 KiB UTF-8，另计算 JSON 转义后空间，保持整个 stdout 的 64 KiB 上限。扫描有独立短时 deadline，同时受 helper 五秒超时收口；空间不足以加入空摘要字段时保持旧候选回执，省略成对可选字段。

main 在获准窗口截图后再取得 AX 回执，只把最终身份匹配的后置摘要交给模型和会话；截图前 AX 候选失败或截断不阻止获取后置摘要。操作授权来自前后独立确认且私有指纹完全一致的控件交集；部分扫描仍可签发准确 elementId，但坐标路径要求两次扫描完整且整个候选集合稳定。`clickReady / textReady / scrollReady` 分别报告已批准操作能力，AX 摘要的完整度不参与授权。此前观察固定附带截图；2026-10-12已拆分AX-only / screenshot / both并增加V3无坐标语义点击与有界控件变化，仍保留视觉模型门槛。实现不声明兼容Codex的AX diff协议，当前事实见实施专题。renderer 的固定 `computer-ax` 预览只显示可信来源验证后的有界纯文本，不解释富文本。平台与 runtime mock 覆盖 Unicode/字节预算、成对字段、窗口漂移、截断、取消和 Run 释放；开发版同窗口主要控件与 CUA 的实查对照记录在实施专题；截断树不能宣称完整，不将文字结构相似或纯编译通过当作信息一致性证明。

本机 SDK 对 desktop-independent filter 明确说明只捕获传入窗口；SCStreamConfiguration 未设置 sourceRect 时读取完整窗口。实现不设置屏幕 crop，关闭光标、音频和窗口阴影，开启 `ignoreGlobalClipSingleWindow`，以保留部分移出显示器的完整窗口；macOS 14.2+ 还关闭 includeChildWindows。ScreenshotManager 最长边 2048，编码 PNG 最多 8 MiB，有界 JSON/base64 回执最多 12 MiB；adapter 比对单窗身份并检查 PNG 签名 / IHDR 与尺寸，失败不换截图来源。

CG 元数据使用 onScreenOnly，所以当前边界是当前 Space 中可确认进程身份的普通 layer-0 窗口，支持被其他应用遮挡的后台窗口；最小化、隐藏或完全 offscreen 的窗口不可用。独立窗口截图和 AX 操作不按其他应用的当前 z-order 阻挡，不会因此扩大捕获范围。点击只激活有 AXPress 的控件，文本与滚动各自检查对应能力；不移动物理指针、不主动激活目标窗口，不能保证目标 App 自身永不改变焦点。

开发版后台验证还发现截图文件可以是新生成的，而目标 Chromium 窗口的 backing frame 仍旧，置前后才刷新。主窗口未覆盖 `backgroundThrottling`，Electron 30 默认开启；本机 SDK 明确 `setBackgroundThrottling(false)` 会使整个 BrowserWindow 及其中 WebContents 持续 draw/swap，并影响 Page Visibility。最初只为已批准、正式复验后的自有目标获取租约，按进程PID / CGWindowID精确匹配；2026-10-12 又发现首次等待共享批准时owner UI停帧，代码确认该阶段尚无目标租约，不能单凭源码确定本次根因。现补上可信active Run在started前取得自有owner绘制租约，与获准目标共用同一WebContents引用计数管理器；不新增共享许可、renderer续期或永久全局false。真实Run abort同步归还引用，最后归零后250ms有界绘制收尾再恢复原值，新获取取消timer、销毁立即清理；不是React / 最终帧ACK，迟到取消终态仍可能超过该时限。不使用Raise / focus，不改变第三方应用后台策略。目录树切换还有260ms CSS动画，仅AXPress回执或AX toggle value改变不能证明新画面已可用。各批mock / 类型检查与真实截图或批准卡闭环分开记录，不能将SDK推论当作实测结果。

新 helper 保持 macOS 11 的双架构编译最低版本，ScreenCaptureKit 弱链接并以 macOS 14 availability guard 拒绝旧系统的窗口捕获；SDK 的 CGWindowListCreateImage 已标为 macOS 14 deprecated / 15 obsoleted，当前不选其兼容路径。平台 mock 与编译已验证上述协议和预算，当前窗口版的真实截图、后台控件动作和 TCC 归属仍需单独验收，不能使用此前全局鼠标版 observe → click → observe 成功记录替代。

### Windows 与依赖取舍

Windows 对应 UI Automation 读取树与控件 pattern，SendInput 提供鼠标键盘，Windows Graphics Capture 提供截图。SendInput 受 UIPI 限制，普通进程不能承诺操作管理员或 UAC 界面。首版保留平台 adapter 接口，Windows 在真实验证前不注册为可执行能力。

资料：[UIA patterns](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-controlpatternsoverview)、[SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)、[Windows Graphics Capture](https://learn.microsoft.com/en-us/windows/apps/develop/media-authoring-processing/screen-capture)。

直接调用系统 API 可避免引入 Python 环境和另一套 Agent 框架。需要 wrapper 时可以评估 MIT 的 [AXSwift](https://github.com/tmandry/AXSwift)、[FlaUI](https://github.com/FlaUI/FlaUI)；输入驱动可评估 [Enigo](https://github.com/enigo-rs/enigo)，但它不能代替截图与 AX/UIA。当前任务无需先选定完整跨平台库。

## 5. OmniFlow 已有基础与必须补的接口

调研时尚未向 Agent 注册截图、读取桌面 AX 或通用鼠标键盘工具。下面记录实现前的接线缺口，现有 main 工具运行框架足以承接它们：

| 当前代码 | 可以复用 / 需要补充 |
| --- | --- |
| [Tool Registry](../electron/service/agent/agent-tool-registry.ts) | prepareMain、冻结私有 binding、执行身份与注册快照 |
| [Run capability snapshot](../electron/service/agent/agent-run-capability-snapshot.ts) | 仅向 Run 暴露实际可用工具；新增 screen-capture / accessibility / input probe |
| [Permission Gate](../electron/service/agent/agent-permission-gate.ts) | 给桌面观察与输入定义专门 assess；当前 main read 默认 allow 不足以表达其他应用内容范围 |
| [Prepared action 类型](../src/shared/agent/agent.types.ts)、[normalizer](../src/shared/agent/agent-prepared-action.ts) | 增加 computer.act 专用 public action；当前联合和严格校验不接受未知 kind |
| [Orchestrator](../electron/service/agent/agent-orchestrator.ts) | 复用 ToolRun、取消与续轮；当前只从 attachment.view 的 imageId 装载 Tool 图像 |
| [模型 adapter](../electron/service/agent/agent-model-adapter.ts) | 当前无视觉模型只隐藏 attachment.view；新观察工具直接交付图片时也须依据 Run 冻结的 supportsImages 收窄 |
| [附件 runtime](../electron/service/agent/agent-attachment-runtime.ts) | 复用图像编码与视觉输入；最长边会缩至 2048，必须返回归一化后的坐标变换 |
| [附件 store](../electron/service/agent/agent-attachment-store.ts) | 已有 owner / Session 校验和总量限制；连续截图应另用 Run 临时、有界保留 |

建议共享 runtime 放 `electron/service/agent/computer/`，平台 helper / adapter 放 `electron/platform/macos/` 及后续 Windows 目录。main composition root 注入 runtime；renderer 只展示受控状态，不直接持有 native handle、spawn、任意 CDP 或桌面输入 IPC。

桌面访问范围与 Shell 的权限模式分别表达。Shell full-access 不自动授予其他应用截图与输入权限；Run 应冻结获准目标和 AI destination，操作前仍检查权限撤销与目标存活。

### 图片进入模型的两种接法

最小实验可以让 observe 将截图导入、绑定现有 AttachmentStore，返回 `screenshotAttachmentId`，再由模型调用 `attachment.view`。这复用已有视觉链，代价是多一个 Tool turn；直接在新工具的 JSON 中返回 imageId 不会自动把图像送入模型。

正式闭环宜让 observe 一次交付树与 main-owned image ref，再扩展受控视觉结果的识别。不要把 base64 塞进普通 result.data；需定义图片的 owner / Run 身份、TTL、配额、模型历史保留与恢复行为。复用附件实验不能被描述成已经解决连续截图的生命周期。

OS 能力可用不代表模型支持图片。直接视觉 observe 必须检查本 Run 冻结的 `supportsImages`；不支持时隐藏截图分支或明确只返回 AX 文本，否则 Provider 构建请求时会拒绝图像。AX-only 模式不能声称模型已看过截图或支持视觉坐标定位。

## 6. 建议首版协议

以下名称和字段是候选设计，尚未注册或实现：

```text
computer.targets()
  → 获准目标与 main 签发的 targetId，不默认枚举所有私有窗口内容

computer.observe({ targetId })
  → observationId、目标/窗口身份、时间、截图引用、图像尺寸、
    坐标变换、有界 AX 节点、truncated / unavailable 信息

computer.act({ targetId, observationId, action })
  → action 为 press(elementId)、click(x,y)、typeText(text)、key(keys)、scroll(...)
  → dispatched / stale / permissionDenied / outcomeUnknown 等宿主事实
```

目标与 native handle 由 main 持有。模型只能引用 main 签发的 target / observation / element ID，不能自行提交一个 PID 或 app 名称就扩展授权。元素引用属于某次观察，不能永久保存成稳定控件身份。

最小闭环必须处理：

1. **坐标统一。** 区分截图像素、窗口 points / DIP、屏幕物理像素。记录裁剪原点、Retina / DPI、2048 归一化、多屏负原点；执行前复验窗口和比例。
2. **状态变化。** 导航、窗口重建、目标切换、控件消失或观察过期后拒绝旧动作并重读；对 AX 引用复验目标与关键属性，不能只相信旧编号。
3. **桌面串行。** 全机输入队列覆盖多个 Run。切换前台、截图与动作协调执行；取消停止未发送动作，释放已经按下的键和鼠标。
4. **结果不确定。** request ID 与有界回执防止重复发送。输入已投递不等于业务成功；AX 超时可能已经执行，先观察，不能立即重试或再补一次坐标点击。
5. **权限与数据。** 读取屏幕和执行输入各有检查；截图与 AX 文本是外部内容，不能授权新动作或覆盖用户指令。截图送往模型须遵守本次冻结的目标与 AI destination。
6. **预算与恢复。** AX 扫描、截图、等待、队列有界；Run 结束释放临时观察。恢复历史只恢复执行事实，不重放未确认的点击。

Apple 特别说明 `AXUIElementPerformAction` 的 `kAXErrorCannotComplete` 不一定代表动作失败，例如模态回调可能没有及时返回。因此“AX 超时后直接 fallback click”不能作为通用策略，见前述 Apple action 文档。

## 7. 内置浏览器可做更小的独立 adapter

如果先验证网页操作，可复用已有 Chromium，不必为网页操作先做系统桌面驱动：

- [主进程 browser controller](../electron/service/embeddedBrowserMainController.ts) 已持有 tabId → WebContentsView。
- [文件输入实现](../electron/service/embeddedBrowserOpenFile.ts) 已使用 CDP 与 Input.dispatchDragEvent；可以参考其宿主调用边界，增加受控截图、Accessibility / DOM 观察与鼠标键盘操作。
- Electron 的 capturePage / sendInputEvent 只服务对应 webContents；desktopCapturer 可获取屏幕 / 窗口图像，两者都不能直接提供跨应用 AX 和输入。

实施前需要补 browser target 的 owner / library / Run authority，不能把任意遗留 tabId 交给当前 Run。必须协调已有 CDP 连接；[browser 专题](embedded-browser-architecture.md) 已记录 DevTools 会替换 debugger 连接，不能为新能力自行 detach。浏览器视图只在 browser 模式挂载，隐藏或未挂载视图的截图新鲜度也需验证。

外部参考 `project/computer-use-preview` 的 [Computer 接口](../../project/computer-use-preview/computers/computer.py) 和 [Playwright 实现](../../project/computer-use-preview/computers/playwright/playwright.py) 可以借鉴动作抽象，但该项目没有提供 macOS 桌面 AX 驱动。

资料：[Electron desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer)、[webContents 输入](https://www.electronjs.org/docs/latest/api/web-contents#contentssendinputeventinputevent)、[screen 坐标](https://www.electronjs.org/docs/latest/api/screen)。

## 8. 实施与验证顺序

推荐先验证 macOS helper 的权限自检、单窗口截图、有限 AX 树、语义激活和坐标输入，再接入标准 observe / act Tool 与受控视觉结果。用隔离测试窗口验证完整闭环，随后按 workspace 规则使用 Win / 本机 MinIO 验证。浏览器 adapter 可共享上层语义，单独验证 target ownership 与 CDP 生命周期。

首版不纳入锁屏控制、远程桌面、任意 REPL、整桌面无限树、自动提权、后台持续录像和跨重启点击续跑。打包时必须验证 helper 签名、路径与系统权限归属；开发终端可以执行不等于安装包可以执行。

真实验收至少覆盖截图→选中 AX 控件→点击→重新观察、截图坐标点击、中文文本、窗口移动/关闭、权限撤销、取消、超时后避免重复动作，以及 Retina / 多屏。Windows 验收后再注册对应能力。发生功能改动时执行项目要求的 lint、test、build 和相关手工矩阵。

调研阶段仅新增本文，未运行构建或真实桌面验证；后续简版实现的验证结果见实施专题。OpenAI Docs 的 [Computer use](https://developers.openai.com/api/docs/guides/tools-computer-use) 也明确由应用提供执行环境并回传观察结果，可采用自定义函数工具；无需为了这项能力替换现有 Agent 或绑定专用模型接口。

## 9. 2026-10-10 后台控制复核与下一步建议

本节只记录公开资料与只读源码调研，不代表下列库已接入或第三方应用已验收。OmniFlow 当前单窗口截图、AXPress、有限原生文本和滚动的实现及验证事实仍以实施专题为准；通用键盘、拖拽及画布点击未接入。

### Codex 的可复用边界

OpenAI Docs 的 [Computer Use](https://learn.chatgpt.com/docs/computer-use) 与[使用说明](https://learn.chatgpt.com/use-cases/use-your-computer-with-codex)确认 macOS 可后台操作并提供画中画预览，用户可继续使用其他应用；官方也建议避免并行操作同一个应用。文档没有公开原生事件投递机制，不能由共享图标或浮动光标推断独立鼠标设备。Apple [WWDC23](https://developer.apple.com/videos/play/wwdc2023/10136/) 将捕获菜单图标、预览与管理控件归于 ScreenCaptureKit；捕获反馈和输入路由是两项能力。

本轮独立浅克隆最新公开 `openai/codex`，版本为 `5ef96ab2785f3ecddf279639eff7b1b42c906fa4`；workspace 的 `project/codex` 保持此前 `2351d9e1…`，未修改。该公开版本仍提供 [应用访问配置](https://github.com/openai/codex/blob/5ef96ab2785f3ecddf279639eff7b1b42c906fa4/codex-rs/config/src/computer_use.rs)、MCP 调度及 [cua_repl 结束清理 hook](https://github.com/openai/codex/blob/5ef96ab2785f3ecddf279639eff7b1b42c906fa4/codex-rs/plugin/src/bundled_hooks.rs#L88)，没有找到原生 AX 序列化或后台事件驱动。官方[开源范围说明](https://developers.openai.com/blog/codex-as-a-platform)指向 CLI、app-server、SDK 与 harness / 集成层，不能等同于桌面驱动开源。

本机分发的普通 JS 复核与第 3 节一致：`@oai/sky` 0.7.5 的 `MacComputerUseClient` 将观察、元素编号或坐标动作通过本地 socket / JSON-RPC 交给 `Codex Computer Use.app`，AX 文本由原生服务返回；JS 是桥接协议。Computer Use 插件 manifest 标明 Proprietary，因此不将这套分发物当成公开仓库的 Apache-2.0 源码移植，也不从桥接层推定原生使用了某个 Apple API。

### 公开实现中值得借鉴的路线

以下结论来自固定版本源码或项目作者资料，不是 OmniFlow 的实测结果。公开 `CGEventPostToPid` 可以避开全局鼠标事件流，但只指定进程；窗口路由、Chromium 接受程度及操作结果仍需逐应用确认。

| 参考 | 可复用思想与具体边界 |
| --- | --- |
| AXorcist，`14eabe17…` | [actions](https://github.com/openclaw/AXorcist/blob/14eabe17200a46ac992561ada55e772eb3a2316e/Sources/AXorcist/Core/Element%2BActions.swift) 调 `AXUIElementPerformAction`，[values](https://github.com/openclaw/AXorcist/blob/14eabe17200a46ac992561ada55e772eb3a2316e/Sources/AXorcist/Core/Element%2BValueSetting.swift) 调 `AXUIElementSetAttributeValue`，适合借鉴查询、可写属性检查和语义动作。其 [scrollAt](https://github.com/openclaw/AXorcist/blob/14eabe17200a46ac992561ada55e772eb3a2316e/Sources/AXorcist/Core/Element%2BMouse.swift) 仍走全局 HID，不能把整个库当作不抢鼠标的实现。 |
| Peekaboo，`c02c2692…` | [后台输入策略](https://github.com/openclaw/Peekaboo/blob/c02c26927d77ddcc17a61233cd4bc0cf83de485a/Core/PeekabooAutomationKit/Sources/PeekabooAutomationKit/Services/UI/BackgroundInputDriver.swift) 优先 AXPress / 选中 / 可写值和 AX 滚动；[窗口事件路由](https://github.com/openclaw/Peekaboo/blob/c02c26927d77ddcc17a61233cd4bc0cf83de485a/Core/PeekabooAutomationKit/Sources/PeekabooAutomationKit/Services/UI/WindowRoutedPointerDriver.swift) 按应用选择公开 PostToPid 或私有 SkyLight，并复验目标。其[兼容性判断](https://github.com/openclaw/Peekaboo/blob/c02c26927d77ddcc17a61233cd4bc0cf83de485a/Core/PeekabooAutomationKit/Sources/PeekabooAutomationKit/Services/UI/WindowRoutedApplicationClassifier.swift) 对后台 wheel 仅放行部分 WebKit / Safari，拒绝 Electron / Chromium，不能作为通用后台滚动保证。 |
| axcli，`ce6ef8e6…` | [输入源码](https://github.com/andelf/axcli/blob/ce6ef8e65d210fbcf4f8d3d8d8d4bbeda5d2fde6/src/input.rs) 的后台像素点击依赖 NSEvent 工厂、私有 `CGEventSetWindowLocation`、窗口字段、非 active 时的 Command 旗标及 PostToPid；scroll 预发目标进程 MouseMoved。[作者实验记录](https://github.com/andelf/axcli/blob/ce6ef8e65d210fbcf4f8d3d8d8d4bbeda5d2fde6/docs/research/background-click-journey.md) 有助于理解失败条件，但私有接口与修饰键会增加兼容和点击语义的验证成本。 |
| Cua，`7cc4bd0b…` | [作者技术帖](https://github.com/trycua/cua/blob/7cc4bd0bfc3ce1a3246ae47fe02948dc9f64f010/blog/inside-macos-window-internals.md) 介绍 SkyLight `SLEventPostToPid`、focus-without-raise 与私有 AX observer；这是受 Codex 启发的独立实现，不是 Codex 源码。作者承认 Blender / Unity 等画布的前台 fallback 会抢鼠标。当前 [mouse.rs](https://github.com/trycua/cua/blob/7cc4bd0bfc3ce1a3246ae47fe02948dc9f64f010/libs/cua-driver/rust/crates/platform-macos/src/input/mouse.rs) 的部分输入路径仍有 `MousePostMode::Both` 双路投递；[issue #2874](https://github.com/trycua/cua/issues/2874) 记录重复单击风险。不能照搬双发或把旧技术帖当所有动作的保证。 |

一次动作应选择一条确定的投递路线；“API 已调用”不等于“目标未执行”。不明确的结果先重新观察，不能盲目重放第二条路线，也不能默默切回全局鼠标。AX 操作仍改变用户真实窗口的状态，目标 App 自身可能弹框或激活；不移动指针不等于隔离了同一应用内的并发操作。

### OpenDesign 同名候选与轻量优化顺序

检索到的同名候选是 `nexu-io/open-design`，尚不能确定用户所说的 Open design 就是它。固定版本 `802708f6c9f294347ef777b1fda49b9cbe26ef72` 中，[sidecar CLICK](https://github.com/nexu-io/open-design/blob/802708f6c9f294347ef777b1fda49b9cbe26ef72/apps/desktop/src/main/runtime.ts#L3000) 通过自有 `webContents.executeJavaScript` 查询 selector 并调用 `element.click()`，[SCREENSHOT](https://github.com/nexu-io/open-design/blob/802708f6c9f294347ef777b1fda49b9cbe26ef72/apps/desktop/src/main/runtime.ts#L3082) 使用 `capturePage()`。可参考自有 Electron 窗口的受控 adapter，但这不是跨应用后台鼠标驱动。

以下保留当时建议的优化顺序；窗口发现、观察内元素标识及有限文本 / 滚动已部分接线，其余仍为研究方向，当前范围见实施专题：

1. 先补可搜索的应用 / 窗口元数据入口、精确选择与既有单窗批准；不需要列出无窗系统进程或更换输入驱动。
2. 沿公开 AX 路线补按控件 / 子树查询、观察内元素标识，以及经 settable / action 检查的文本、选中、滚动条值或控件滚动动作。保持摘要有界、目标身份复验与观察后确认；普通简单控件操作可用，不要求整棵树无上限返回。
3. 自有 Electron 窗口和支持浏览器可评估定向 webContents / DOM / CDP adapter，沿现有 main owner、Run 授权和 debugger 生命周期，不开放任意脚本或任意 tab；这不覆盖第三方原生 App。
4. 仅 AX 不覆盖的画布 / 拖拽场景再做独立像素输入实验，明确应用及版本边界、单路投递和拒绝全局 fallback。私有 API 的系统升级兼容成本明显高于前两项；真正隔离同一应用状态需要独立实例或运行环境，超出本次轻量需求。

本轮仅更新调研文档并复核引用，未运行 lint、test、build 或第三方驱动；外部应用的实际连接、截图与动作结果由实施专题另行记录，不以库的 README 声称替代验收。

## 10. 2026-10-10 更多后台输入能力的源码复核

本节是只读调研与实施建议，没有安装、运行或接入这些第三方驱动。OmniFlow 自研的有限 AX 文本和滚动实现另见实施专题；通用键盘、拖拽、右键、双击或画布输入仍未接入。后台定向输入在部分应用中有可行路线，但“公开 API 已投递”“系统指针没有移动”和“应用正确完成操作”是不同事实，不能只凭仓库说明宣布任意软件均不干扰用户。

### 两个新增候选

`hyprcat/mac-cua` 的实验分支 `confirmed-delivery-pipeline` 固定为 `362393e312de500597146b13b6f5a428462f6ce2`，仓库采用 Apache-2.0。其[输入源码](https://github.com/hyprcat/mac-cua/blob/362393e312de500597146b13b6f5a428462f6ce2/app/_lib/input.py)使用 `CGEventSourceCreate(kCGEventSourceStatePrivate)` 隔离事件源状态；click 只向 PID 发送带位置、窗口 hint、压力和 click state 的 down/up，不先发 MouseMoved。drag 使用 LeftMouseDragged 序列；scroll 使用像素单位，同时设置 point delta 与 fixed-point delta。这些具体设计值得做独立实验，不能由 private source 推断目标焦点、窗口状态或硬件输入已被完全隔离。

该分支仍有以下可直接从源码确认的限制：

- `DeliveryConfirmationTap` 只按 source state ID 的事件回声确认传输，没有证明接收窗口消费事件或业务状态改变。confirmed key 管线在等待回声失败后切换路线、再可能整组重试；部分事件已发送时会产生重复与修饰键释放不完整的风险。
- 同一 `input.py` 的普通 key 路线明确用 compound flags，注释说明单独 modifier 事件可能污染全局键盘状态；但 `deliver_key_events` 实际仍发送 modifier down/up，和 README 对 CG 路线的描述不一致。这里只确认实现矛盾，没有运行它来证实本机泄漏。
- confirmed scroll 接口只有 PID、方向与像素量，未设置目标点或窗口 hint；调用处也没有把解析出的 point 交给该分支。无法据此确认同一应用的多个窗口或嵌套滚动区域会正确命中。
- drag 没有用 `finally` 保证异常后的唯一 mouse-up，Session 遇到部分输入错误还会重新执行整段手势；不适合直接复用为可取消的生产驱动。

其[微激活实现](https://github.com/hyprcat/mac-cua/blob/362393e312de500597146b13b6f5a428462f6ce2/app/_lib/skylight.py#L309)通过私有 SkyLight 修改进程 frontmost 状态。标称 10ms 的预算只在 `finally` 中事后检查、记录警告，没有强制中止；随后恢复 driver 自己的 connection，而不是记下用户原前台应用。这条路线会改变系统焦点状态，不能纳入当前“不主动置前”的路径。需要借用代码时保留其[Apache-2.0 许可](https://github.com/hyprcat/mac-cua/blob/362393e312de500597146b13b6f5a428462f6ce2/LICENSE)与适用声明；本轮没有复制其实现。

`antimatter15/macos-background-cua-skill` 固定为 `a1b8a3d35e59cdfcfdd52d3955192a19803a51ee`。这个版本只有 README、SKILL 和 Python 脚本，没有 LICENSE，也未在这些文件中找到明确许可声明，因此本轮只参考 API 思路，不复制代码。其[脚本](https://github.com/antimatter15/macos-background-cua-skill/blob/a1b8a3d35e59cdfcfdd52d3955192a19803a51ee/scripts/macos_bg_cua.py)优先通过 AXPress、AXSelectedRows、AXFocused、AXSelectedText / AXValue，以及最近滚动祖先的 AXScroll*ByPage 完成语义动作，再使用 CGEventPostToPid。它比完整 Agent 框架轻，但当前源码不能作为“不抢鼠标”的成熟驱动：

- CG click / right-click / drag 后等待约 120ms，再发现目标已置前时激活原前台应用；恢复是事后补救，不表示操作期间用户未被打断。
- drag 的移动步骤实际发送 `kCGEventMouseMoved`，没有发送 MouseDragged；未设置 private source 或 window routing hint，不能将这个函数的返回值当可靠拖拽证明。
- CG scroll 回退没有把传入坐标写入事件；raw key 仅采用 US 键码和 flags。AX 文本路线支持 Unicode，但回退中的未知字符被直接跳过，不能承诺中文输入完整。
- 文本插入通过 AXSelectedText 写入后立即读取 AXValue 判断变化，未确认变化时继续 AXValue 或 CG 输入，可能把迟到结果当失败而再次输入；也没有当前 OmniFlow 的进程启动身份、单窗授权及精确观察绑定。
- 每次 attach 永久设置第三方应用的 AXEnhancedUserInterface / AXManualAccessibility，没有恢复租约。OmniFlow 当前只按正式获准窗口启用自有 Electron 的可访问性，不能直接扩大为第三方应用的全局设置。

### 公共 AX 与定向事件的可复用边界

AXorcist 与 Peekaboo 的上述固定版本均采用 MIT。AXorcist 的可写值入口调用 AXUIElementSetAttributeValue，但普通文字、快捷键和 scrollAt 最终仍发送全局 HID；可参考具体 AX 方法，不能整体接入后声称后台隔离。

Peekaboo 的[语义滚动实现](https://github.com/openclaw/Peekaboo/blob/c02c26927d77ddcc17a61233cd4bc0cf83de485a/Core/PeekabooAutomationKit/Sources/PeekabooAutomationKit/Services/UI/ActionInputDriver.swift#L943)提供更适合当前轻量实现的思路：先检查可写滚动条的 AXValue，再选择已声明的 AXScroll*ByPage / AXPage* 或 AXIncrement / AXDecrement。只有已确定未发送的拒绝可以换路线；超时或可能已执行时不重复发送。其文本实现先检查 AXUIElementIsAttributeSettable，再写 AXValue / AXSelectedTextRange；[TextInputRoute](https://github.com/openclaw/Peekaboo/blob/c02c26927d77ddcc17a61233cd4bc0cf83de485a/Core/PeekabooAutomationKit/Sources/PeekabooAutomationKit/Services/UI/TextInputRoute.swift#L105)将 AXWebArea 下的输入明确转为 keyboard 路线，避免把网页 AXValue 写入当完整的键盘输入与 JavaScript 事件。普通文本替换也不能自动等同于插入、输入法、组合键或提交表单。

复核公开 SDK 后，右键相关能力可提前部分实现：控件实际声明 `kAXShowMenuAction` 时可以直接打开上下文菜单，不必等待通用像素右键。菜单 tracking runloop 可能使调用直到菜单关闭才返回；超时不等于未打开，必须观察实际菜单，不能补发右键。`AXConfirm` 可以提供已声明的确认/打开语义；两次 AXPress 不能冒充双击。`AXPick` 位于 SDK obsolete actions，只兼容真实声明，不推荐作为新主路线；`AXUIElementPostKeyboardEvent` 自 macOS 10.9 弃用，不是遗漏的现代通用键盘方案。

自有 Electron adapter 也需验证：本项目安装的 Electron 30.5.1 类型声明与最新[官方 webContents 文档](https://www.electronjs.org/docs/latest/api/web-contents#contentssendinputeventinputevent)均要求 `sendInputEvent` 的承载 BrowserWindow 已 focused，因此不能将它作为保证后台无干扰的输入 / 滚动入口；[`insertText`](https://www.electronjs.org/docs/latest/api/web-contents#contentsinserttexttext)仅插入当前 focused element，不接受目标控件，也未承诺后台隔离。现有渲染租约只解决自有窗口的后台绘制，不能补足这些焦点与目标绑定条件。`kCGEventSourceStatePrivate` 的 private 指事件源状态，不表示另有一个隔离桌面或用户焦点。

像素事件必须另行证明窗口和接收者。Peekaboo 只放行部分可见 AppKit / WebKit / Safari 的后台 wheel，明确拒绝 Electron、Chromium 和 Catalyst 的这条通用路线。Cua 的后台键盘使用私有 SLEventPostToPid 和认证消息，缺失时退回公开 PID 投递；其固定版本部分 wheel / drag 仍有 MouseMoved primer 与 SkyLight + public 双发。不同项目对“需要先移动”“是否双发”和“哪些应用接收”的选择并不一致，证明这里需要逐应用验证，而不是选一个仓库即可取得全部鼠标能力。

### 自有 Electron 控件桥的后续方案

该建议已于 2026-10-11 在当前 Agent 输入与对话区域接入，源码和实际验收状态见[实施契约](agent-computer-use.md#omniflow-第一方后台控件桥2026-10-11)。为 OmniFlow 自有窗口提供后台文字和滚动时，更小且可控的路线是固定的第一方控件桥：由现有 React 控件 owner 显式注册有限输入 / 滚动适配器，main 只请求已注册的操作，不将任意 selector、脚本、原始 CDP 或 desktop input IPC 暴露给模型 / renderer。输入复用现有草稿 setter，滚动复用现有滚动 owner 及跟随逻辑，避免裸 DOM 值与 React 状态分离；不调用 focus、不使用剪贴板或系统键鼠。这一方案不是完整独立桌面，用户与 Agent 同时修改同一控件仍会竞争。

当前 AX observation 的 elementId 绑定的是私有 AX 路径、角色、名称、几何及 AXIdentifier，不能直接用它按标签、坐标或列表顺序猜 DOM。HTML `id` 对应的是 AXDOMIdentifier，与 AXIdentifier 不同；[W3C HTML-AAM 的 id 映射](https://w3c.github.io/html-aam/#att-id)及 [Chromium Cocoa 的 DOM identifier 实现](https://chromium.googlesource.com/chromium/src/+/b6f71d14c08e11f74cba9a631bfe24542bfd8327/content/browser/accessibility/browser_accessibility_cocoa.mm)支持这一区别。若未来把两者关联，须在当前 Electron 版本实测该属性，只接受唯一已注册控件并复验其身份，不能将公开标准映射当本机支持已通过的证据。另一条首期路线由 DOM 观察签发自己的 opaque 引用并明确来源，不把 DOM 动作伪装成现有 AX elementId 的能力。

桥继续由 main 持有单窗批准、prepare、私有封印、消费和提交结算。main 发起固定 observe / setText / scroll 请求，preload / renderer 只处理受控请求并提交一次回执；可以复用现有 owner-bound request / completion 模式，但不能让 renderer 自行授权桌面动作。私有 binding 至少包含获准窗口、owner WebContents、可信主 frame、文档 generation、控件 mount / revision、Run / Session / owner scope、请求 nonce 及 observation 身份，沿用 60 秒有效期、一次消费、取消 / 结束释放和 unknown 后不重发。导航、窗口 / 控件重建、用户编辑或 IME 合成引起的变化必须拒绝旧请求，回执缺失不能认定未产生副作用。

原建议先用独立测试控件；本轮选择真实 Agent 控件，验收仅允许已确认空的本轮草稿写入合成中文 / 多行 / emoji 后清空，禁止提交或修改用户草稿。滚动验收从本轮会话取新观察并验证恢复；不把源码接线计为真机通过。此阶段只覆盖获准 OmniFlow owner 窗口中的可信主 frame，不覆盖 embedded browser、插件、iframe、第三方 Electron 或外部浏览器，也不据此宣布所有应用输入兼容。原生 TextEdit 文字闭环已通过；外部 AX 滚动仍受实际属性支持限制，第一方桥独立实施和验收。

### A / B / C / D 实施阶段与验收门槛

| 阶段 | 能力与具体路线 | 完成门槛与边界 |
| --- | --- | --- |
| A：连接与精确控件 | 沿现有单窗 SCK / AXPress，补应用窗口发现、opaque windowRef、观察内 elementId，以及 description / identifier 的私有身份复验和旧 subrole 兼容。 | 本轮收口范围；最新状态以实施专题为准。复验多窗口、同名窗口、空 title 的 toolbar 控件、旧引用过期、单窗批准与停止清理。没有增加通用像素事件。 |
| B：公共 AX 语义操作 | 增加明确的文本替换 / 插入、选中、滚动与上下文菜单。检查 IsAttributeSettable 和支持动作，再选择 AXValue、AXSelectedTextRange、AXSelectedRows、AXScroll*ByPage、滚动条 Increment / Decrement、AXShowMenu 或真实声明的 AXConfirm。 | 仅提供控件真实支持的能力；不读取 secure 或未确认输入类型的值。验证原生输入与网页输入的区别、滚动区域身份、菜单可能打开新窗口、用户同时操作目标窗口、取消、权限撤销和动作后新截图。没有成功回执时不盲目换输入路线。 |
| C：单窗定向像素实验 | 对 AX 不覆盖的位置评估 private CGEventSource + CGEventPostToPid 的 down/up、窗口 hint、正确 points 变换，并分别验证右键与 double-click state。私有 window-local API 只能作为显式实验路线。 | 只在已经验证的应用 / 系统版本启用；不自动激活、微激活、warp、发送全局 HID 或跨路线补发。验证被遮挡后台窗口、不同前台、Retina、多窗、嵌套区域及真实业务结果；不因仅 endpoint 未变就宣布全程无干扰。 |
| D：键盘与持续手势 | 独立验证定向 Unicode、快捷键及 bounded down → MouseDragged → up，明确 modifier 和取消后的释放策略；自有 Electron / 浏览器可以另评估受控 webContents / DOM adapter。 | 不复用有未知部分发送状态的手势；每个接收者与窗口绑定需重新验证。连续监测前台、物理指针和用户输入，覆盖中文 / 输入法、modifier 卡住、窗口销毁及中途取消。依赖私有 SkyLight 或特殊 key-window 状态的应用必须记录边界，不将失败回退成全局操作。 |

阶段 B 通常比通用画布输入更轻，可以继续复用现有 Run 授权、native helper、候选预算及提交结算；阶段 C / D 的主要成本是平台行为、接收者兼容和持续输入生命周期。任何阶段都改变用户真实应用状态，无法隔离用户与 Agent 同时操作同一个窗口；需要独立应用实例或桌面环境才属于进一步的状态隔离。

B 的文本替换 / 插入与单次 page / step 滚动已在 2026-10-10 按独立模块接线；同日源码新增 fraction 的严格能力路线，最新状态以 [实施契约](agent-computer-use.md) 为准。上下文菜单及选中工具仍未实现。当前 elements 显式声明 `press / replaceText / insertText / scroll*Page / scroll*Step / scroll*Fraction` 的有限 operations，文本和滚动分别检查对应 ID 能力，不复用点击许可；showMenu 尚未纳入。私有坐标命中保留所有可操作候选，先选唯一叶节点再要求 press，不能穿透文本或滚动子控件点击父控件。文本限定已确认的非安全原生字段，检查 settable，保留 Unicode，不改变焦点或通过剪贴板模拟；网页输入暂留浏览器适配路线。page / step 每次只执行真实声明的一页或一步，不能把 scrollbar increment 称为一页。fraction 只为方向、可写 AXValue 及当前 Value / MinValue / MaxValue 全部确认的原生滚动条签发能力：一次沿对应方向移动实际数值范围的 10%，在端点截停，不表示一页或可视区域的 10%，也没有模型自定义幅度。三项数值保持私有并参与观察前后和派发前复验；旧十一项操作许可不包含 fraction，需新共享批准。已发送或未知结果不切换路线补发；本段是当前源码契约，不提供滚动已生效或后台无干扰的实测结论。

当日 AA2 的真实标准 AppKit 滚动条已确认 AXValue 为数字且可写，但 AXMinValue / AXMaxValue 均返回 `attributeUnsupported (-25205)`，因此没有 fraction 候选，这个外部目标的 fraction 当前不可用。Apple 对 [NSScroller 自身 knob 位置](https://developer.apple.com/documentation/appkit/nsscroller/setfloatvalue%3Aknobproportion%3A)说明了 0…1，并推荐 doubleValue；这不是所有跨进程 AXScrollBar 的通用范围保证。本机 Apple `AccessibilityDefinitions.plist` 也把 AXScrollBar 的 min/max 标为非必需属性。网页 scrollbar 同样映射到 AXScrollBar，且数值范围可自定义，默认 0…100，见 [WAI-ARIA scrollbar](https://www.w3.org/TR/wai-aria-1.2/#scrollbar) 与 [Core AAM 映射](https://www.w3.org/TR/core-aam-1.2/#role-map-scrollbar)。当前不根据角色、几何、Identifier 前缀或应用框架猜 0…1，不为 fixture 补造范围来冒充外部滚动验收。

TextEdit 的 AC / AD 真实诊断已确认严格的 `native-text-identifier-v1` 文本候选可接受；该路线在读取 Description 前选定，只处理已确认非网页、非安全、纯文本操作的 AXTextArea，要求精确空 title、声明且可读的非空 Identifier，并封印 Description 声明状态。Identifier 失败不会转读 Description，资格变化也不能在派发前切换身份路线。AD 两次全窗口扫描仍因其他角色节点的 AXEnabled 返回 `attributeUnsupported (-25205)` 而不完整，文本候选本身已通过；原先要求完整扫描才能派生唯一文本标签的 main 规则因此未签发文本 elementId，不能把这轮计为输入通过。

当前 main 源码保持全局扫描严格状态，对同窗截图前后身份独立稳定的严格文本 profile 提供“原生文本区域”及 `labelSource=native-text-screenshot-bounds`、`screenshotBounds`；完整稳定扫描确认可输入 TextArea 唯一时仍使用原有唯一标签。截图边界按最终附件尺寸映射到同 imageId 图像的左上原点像素矩形，开始边向下取整、结束边向上取整，仅供辨认目标，setText 仍只接受 elementId；不声称部分扫描唯一、不公开 Identifier、不授予 Press 或坐标操作。截图前后任一已确认的可输入 TextArea 与目标重叠时拒绝通用位置标签，包括另一控件出现、消失或自身身份漂移而未进入稳定交集的情况；模型也必须在截图中确认用户目标，不能按 AX 树或列表顺序猜。

随后 AE 的内部 Agent 真机验收通过 TextEdit 文本路线：Run `cf5e6e65-6208-456c-b981-521e362e00ff` 的初始截图 `70efc3aa-897a-45b9-9d04-d24cae0c583b` 保持 `candidateScanComplete=false`，但稳定候选给出 `textReady=true`，最终图像中的 `screenshotBounds={x:0,y:200,width:1172,height:764}` 可用于核对目标。中文、😀与两行文本替换（`9999549e-4114-42c0-ab67-89d0bcb05b86`）、插入 `＋插入🪟`（`827cb735-8085-48ef-a4f2-525451897f98`）和清空（`a2c7cbd2-6b3f-4f2f-b393-f438b36fd548`）均返回 dispatched / committed；逐张检查动作后截图，并用独立 CUA AX 复核插入与清空结果。三个动作的 endpoint 日志均为 `axError=0`、`targetFrontmostBefore=false`、`targetFrontmostAfter=false`、`frontmostChanged=false`、`pointerMoved=false`，支持该 TextEdit 场景在后台完成文本操作；这些起止点检查不证明回调全过程始终没有焦点变化，也不证明其他应用兼容。该批 TextEdit 替换、插入和清空通过，fraction 未通过，OmniFlow 自有 Electron 控件桥当时尚未实施；2026-10-11 当前实现与独立验收见实施契约。该批最终 lint、build 均通过，测试为 4522 项通过、7 项跳过、471 个文件。

新动作沿用 prepare→单窗/控件/能力复验→一次提交→回执→observe；未知结果不能换路线补发。AXShowMenu 的 tracking 超时可能已打开菜单，不能认定未发送；当前 capture 排除 child windows，归属未确认的独立菜单不可自动纳入单窗授权。未来菜单阶段可先提供打开菜单，菜单观察与选择另做归属验收。当前共享卡已明确点击、文本输入和滚动范围；旧无 operations 的“查看与简单点击”许可仍只授予 press，后续新增动作不能静默扩权。

目标不是只停留在 AXPress。多数基础操作应组合“公开 AX 语义动作 + 已验证应用的单窗定向事件 + 浏览器适配”：先补输入、滚动和上下文菜单，随后按应用扩展真正右键/双击，再补 Unicode 快捷键和拖拽。各工具显式报告当前控件支持的操作；不支持时说明缺口，不因换路由而暗中争用全局鼠标。

本节仅更新调研结论。固定版本源码已只读检查，没有执行第三方驱动；B 的文本及滚动实现与验收另见实施专题；B 其余部分与 C / D 是待实施、待真机验证的方向，不计入当前可用功能或已通过验收。

### 2026-10-12 外部后台滚动复核

TextEdit AR 真实声明 `AXScrollDownByPage`，驱动对同一控件发送相同名称后返回 -25205；没有发现拼写错误。实际写调用后的结果保持 unknown，不在该 Run 补发其他路线。其滚动条 AXValue 可写，但 Min / Max getter 不支持，仍不猜默认范围；滚动条本身未提供 Increment / Decrement。后续 AU 只读诊断确认增页子按钮的真实 AXPress、父条 enabled / 轴向、精确获准窗口父链和有效子矩形；父矩形超过窗口，箭头和当时减页矩形无效。源码据此新增独立 `native-scroll-button-v1`，仅开放实际 AXIncrementPage / AXDecrementPage 子按钮对应方向的 page 操作，不授普通点击、不开放箭头；观察、prepare 和 final 复验私有父状态及原始子几何。该路线不是 AR unknown 后的补发；实际下翻、重新观察、上翻恢复的结果以[实施专题](agent-computer-use.md#本轮实际验收)为准。

公开 [CGEvent.postToPid](https://developer.apple.com/documentation/coregraphics/cgevent/posttopid(_:)) 只承诺发送到进程事件流，没有单窗口或嵌套区域消费保证，也没有接收端消费回执；private event source 只隔离事件源状态表。设置 location 不直接移动物理指针，但不能由此推定后台 wheel 正确路由。Peekaboo 的[固定窗口 wheel 实现](https://github.com/openclaw/Peekaboo/blob/c02c26927d77ddcc17a61233cd4bc0cf83de485a/Core/PeekabooAutomationKit/Sources/PeekabooAutomationKit/Services/UI/WindowRoutedPointerDriver.swift) 还依赖私有 window-local API 并限制 AppKit / WebKit 类别，不提供 TextEdit 通用保证。另一份[固定研究记录](https://github.com/maestrojeong/cua-rs-mcp/blob/e609b2525cb4331248d5f916f875b31b9e517cfc/DESIGN.md)报告400行 TextEdit 在 public PID / SkyLight 及多种 wheel 配方下未滚动、PageDown 键对照有效；这是外部作者实测，本项目没有复现。

若继续定向 wheel，先用独立、可丢弃的单窗 AppKit 夹具，记录接收窗口、局部坐标和实际滚动位置，再研究多窗口拒绝条件；不把无异常投递视为滚动成功，也不直接作为 AR 的生产 fallback。以上源码与 SDK 复核是研究证据，不计真实外部滚动通过。

后续自研页子按钮 AV 真机闭环已通过：80行合成TextEdit正文的首次可见行01→下页30→新ID上页01→清空，保存原图及独立CUA一致，前台/指针采样端点未变。Finder AW 则在候选部分扫描中按准确工具栏标签完成AX-only定位、列表切换和按需图标恢复。两者补齐了本机轻量基础操作约80分的证据，不能推广为滚轮驱动、外部step / fraction或WebStorm失效节点已修复；具体Run与门禁由实施专题/验证矩阵持有，不以外部库研究替代实际效果。

2026-10-12 用户锁屏后只继续代码：已接入以有效原生控件 ID 为锚点的有限父区域观察，沿原共享窗口身份和扫描预算，不把局部完整升级为全窗完整或坐标权限；解锁后验证复杂窗口的实际收益。当时快捷键下一步优先研究有限语义 command / 第一方 owner adapter。读取菜单快捷键元数据可用于发现，但应用级 AXMenuItem 通常依赖当前 key window，AXPress 不能单独证明作用于获准窗口；CGEventPostToPid 也只证明进程路由，不能保证单窗消费或用户修饰键隔离。两者不作为旧操作的后台快捷键 fallback；后续独立工具实现见第 11 节，任意软件通用键盘仍未实现。

## 11. 2026-10-12 窗口定向四动作实施

新增 `computer.input@1`，在独立 `inputOperations` 批准与本次 `availableInputOperations` 交集内提供 shortcut / rightClick / doubleClick / drag。它不扩展旧 AXPress 的含义，也不把失败的 AX 操作转成像素重发。完整 both 观察提供同图像的指针坐标；全窗 ax 只允许快捷键，截图独立模式或局部 AX 观察不签发新输入能力。快捷键使用固定 ANSI key / modifier，字母数字要求 Command 或 Control，正文仍走私有文本工具；拖拽限定同窗不同起终点、100～1000ms 的直线。

独立 AppKit 夹具暴露了单纯公开 NSEvent / CGEvent 与 windowNumber / window hint 的限制：应用 sendEvent 收到事件，但重建出的 locationInWindow 位于窗口外，NSView 没有消费。固定 Peekaboo 的窗口路线提供私有 window-local setter 的参考；本轮自行通过 typed dlsym 解析 `CGEventSetWindowLocation`，按窗口左上原点 local points 设置同一条事件，不复制事件驱动，也不引入认证包、opaque CGEvent 内存偏移或 SkyLight 第二投递。NSEvent factory 的坐标仍按 AppKit 左下原点转换，两种空间不能混用。

每条事件从 private source 构造，鼠标 global / local points 与冻结窗口编号明确绑定，只发送一次 `CGEventPostToPid`。无激活、AXRaise、真实鼠标 warp、全局 HID、MouseMoved primer、额外 Command mouse flags 或双发。私有符号缺失、未验收接收者、目标位于前台、进程 / 窗口漂移或用户修饰键 / 鼠标按住时拒绝；快捷键额外要求没有普通物理键按住，且 focusedUIElement 的非 secure 父链回到原窗。private source 没有提供第二个独立桌面；目标 App 自身仍可能请求前台，用户与 Agent 操作同一个 App 仍会竞争，因此每步监测前台与接收窗口，按应用及系统版本开放。

持续手势由有界序列 runner 持有唯一配对 up。所有事件在首发前分配，拖拽发送真正 MouseDragged；中途取消只在最后已发位置释放。若同 PID 切窗或原 AX root 已失效，不将 cleanup 投给另一个窗口，保留 unknown / 释放未确认。SIGTERM / SIGINT 只置取消标志，正常路径负责释放；父 runner 最多给 2 秒退出宽限，硬杀或 crash 不承诺释放。应用的实际消费由新的观察确认，投递 / 配对 up 的回执不能替代业务结果。

真实夹具已验证四动作、完整拖拽、首个 down 后主动 SIGTERM 的唯一 up、同进程第二窗成为接收者后的零派发拒绝。独立 AppKit 结果不证明 TextEdit、Electron 或浏览器兼容，也不等同于内部 AI GUI 验收。最终软件版本 gate、TextEdit 各动作结论和门禁由[实施专题](agent-computer-use.md)与[验证矩阵](frontend-validation-matrix.md)记录；第 10 节的外部 wheel 与通用输入方向仍按各自边界保留。
