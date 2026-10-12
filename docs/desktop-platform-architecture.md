# 桌面平台适配架构

2026-10-12：新增独立 `computer.input@1` 的后台快捷键、右键、双击和同窗直线拖拽。纯输入契约位于 `src/shared/computer-use/window-input-contract.ts`，main 平台 adapter 为 `window-input.ts`，原生驱动为 `macos-window-input.swift`；平台模块不依赖 Agent Session / Run / UI。Agent runtime 持有独立 `inputOperations` 共享许可、观察能力、同张截图像素映射、sealed prepare 和 broker 提交结算，没有通用桌面输入 preload / IPC。旧 AXPress、文字与语义滚动路线不变。

新驱动使用私有 source 创建 NSEvent / CGEvent，按批准窗口设置 global / local points 与窗口 hint，每条事件只发送一次公开 `CGEventPostToPid`；鼠标局部坐标依赖动态解析的私有 `CGEventSetWindowLocation`，缺符号在首发前拒绝，不采用全局 HID、激活、warp、MouseMoved primer 或双路投递。生产能力仅固定、实测的软件及系统版本 profile 开放，固定开发夹具另有不限定系统 build 的实验 profile，精确名单由电脑操作契约持有；目标必须后台且为该进程精确 focusedWindow，快捷键另复核非 secure focused element 的窗口父链。观察前后、prepare / final 及每次事件复验接收者；物理 modifier / 鼠标按住拒绝，快捷键额外拒绝任意物理键按住。普通打字不屏蔽后台指针动作；切换前台、目标窗漂移或取消停止后续动作。

拖拽限定 100～1000ms、不同起终点、同一批准窗口内的直线，发送真实 MouseDragged。首次派发后取消只对仍有效且为同 focusedWindow 的原 AX root 发送一次配对 up，使用最后已发送位置；原窗口销毁 / 同 PID 切窗则不把释放投给另一个窗口，结果 unknown / 释放未确认。TS runner 在 SIGTERM 后最多等待 2 秒释放回执，再硬终止；SIGKILL / crash 无法保证释放。dispatched 和 confirmed 仅分别证明投递与配对 up 投递，应用消费必须重新观察，不重放 unknown 或切输入路线补发。精确 profile 与真实夹具 / TextEdit 验收范围由[电脑操作契约](agent-computer-use.md)和[验证矩阵](frontend-validation-matrix.md)持有；发行包、其他软件或系统版本不据此通过。

2026-10-12：Agent 工作区可见期间新增独立 main-owned 绘制注册，覆盖没有 Session / Run 的新建会话、空闲预览和工作区管理界面。注册只接受可信主窗口的精确 mainFrame，导航、renderer 崩溃、窗口销毁、作用域切换和退出均自动释放，并与 active Run、获准窗口截图共用 WebContents 引用计数 manager。它只关闭自有窗口的后台绘制节流，不改变全局默认、不激活窗口、不触碰第三方应用，也不保证 compositor ACK；其他平台和发行包仍需分别验证。

2026-10-11：获准当前主窗口的第一方 Agent 控件另接轻量 main-owned transport。它使用可信窗口 contentBounds / zoom 将 renderer CSS bounds 映射为屏幕点，再由原 runtime 映射为同附件像素；只接受精确 mainFrame 的固定注册 / 完成消息。文本/滚动复用 React 草稿与聊天滚动 owner，不调用系统键鼠、焦点或任意脚本/CDP，已绑定动作失败不换 AX。外部应用保持原 macOS SCK / AX 平台路线，Windows/Linux、第三方 Electron 和网页不因此新增兼容性。实现边界与本轮验收见[电脑操作契约](agent-computer-use.md#omniflow-第一方后台控件桥2026-10-11)。

第一方调试诊断另复用固定helper `--parent-activity`，无请求正文或PID参数，只读NSWorkspace当前前台与直接父PID是否相等，父PID前后不一致或查询失败时unknown。main-only adapter严格接收布尔字段，独立500ms / 512B上限；仅显式debug时在派发相邻两端调用，不增加renderer能力、权限或生产进程。Electron活动事件缓存和原生实时采样独立记录，不混作后台通过，诊断不能改变权威执行结果。

2026-10-10：单窗口 Agent 增加纯元数据 `computer.windows` 搜索、Run 绑定短期引用与观察内 elementId 点击。原生候选将直接读取的 AXDescription 与已声明 AXIdentifier 纳入私有身份指纹，生产 AXPress 不读取非必要 AXSubrole；旧 subrole 解析仍保留；字段有界、严格存在性和值复验，不以文本 AXValue 绑定身份、不截短身份。main 返回人类标签和随机元素标识，原生 identifier / 路径仍私有；旧 helper 缺字段兼容。新增公共 AX 文字替换 / 插入和真实翻页 / 滚动条步进；本轮另接入独立 fraction 比例滚动 ABI，读取并封存滚动条数值范围以便严格复验，不采集文本正文。均不发送 CG 事件、全局键盘、拖动或前台激活。平台通过 computer-use/index.ts 单窗 facade 独立于 Agent，pure shared contract 单独维护。该阶段工具为 macOS 五项；本轮新增 computer.input 后为六项，非视觉模型仍只保留无图像发现。新增 ABI 的原生定向检查及最新全量 lint / test / build 通过，universal helper 已重建，AE 的限定 TextEdit 文本闭环通过、滚动未通过，契约及证据见 [应用窗口操作](agent-computer-use.md)。

fraction 只在实际 AXScrollBar、明确 enabled、匹配 vertical / horizontal、Value / MinValue / MaxValue 成功读取为非 Boolean 的 finite 数值且范围有效、AXValue 确认可写时提供四向 Fraction operations；缺范围不填 0 / 1。每次只移动确认数值范围的 10% 并在边界截停，不能称一页、一步、像素或可视区域比例；旧 page / step 不变、不在失败后 fallback。私有 scrollState 三值参与候选前后稳定性与执行前复验，不公开给模型或 renderer、不写入诊断日志。AA2 实测因 Min / Max getter 不支持未提供 Fraction 候选，未派发，不计通过。

TextEdit 诊断只记录固定 roleKind / 拒绝及 probe stage / AX 错误数值和能力布尔，每次扫描独立限 32 条，耗尽只停止日志、不改变候选或 truncated；prepare / final 的单目标读取仍可记录。AB 确认 Description 真实 getter 失败后新增预选 native-text-identifier-v1：仅 nonweb 原生 TextArea、text-only、有有效 textState、title 精确为空且 Identifier 已声明；真实 Identifier 必须成功有界 CFString、trim 非空，完整原值封存，失败不 fallback。private profile / descriptionDeclared 成对，prepare 固定路线，final 完整候选严格复验，不触 Description、不授 Press，原点击严格 getter 不变。唯一文本标签要求完整稳定扫描；AD 后已在源码另接入自身前后稳定、与已知其他文本区不重叠的通用标签 / 同附件像素边界，不宣称唯一、不放宽扫描判定或点击门槛，原生 Identifier / profile 不公开。日志包含 Identifier 能力四布尔及 generic 固定失败 stage，不含身份原值、动态角色名、窗口身份、坐标或正文。profile 版本源码门禁通过，AC 身份通过而未输入；新标签路线全量门禁与 AE 限定 TextEdit replace / insert / clear 真实闭环通过，保存 PNG / AX / 独立 CUA 一致；端点稳定不声明持续隔离，其他 App / Electron / 网页输入不推定兼容，证据由专题记录。该原生轮次尚未接入第一方桥；2026-10-11 当前实现见上文，不扩大平台或网页兼容声明。

Agent 简单窗口操作由 `electron/platform/computer-use/` 承接。独立 Swift helper 只读 CG / NSRunningApplication 窗口元数据，macOS 14+ 使用 ScreenCaptureKit 的 `desktopIndependentWindow` 与 `SCScreenshotManager` 捕获获准的单个窗口；不使用 Electron 全窗口缩略图枚举、显示器捕获或屏幕裁剪。支持当前 Space 中被遮挡的后台窗口，最小化、隐藏或其他 Space 的目标不可用时明确拒绝。AX 只扫描冻结窗口的有界候选，按显式 operations 发送 AXPress、可写文本属性或真实滚动动作，不移动系统指针、不主动置前；AX 路线不支持无 AX 动作的画布，新定向输入另受接收者 profile 限制。`--window-targets` 另返回同一匹配窗口的 `axTree / axTreeTruncated` 纯文本摘要，独立限于 12 KiB UTF-8、节点/深度/时间预算和整体 64 KiB JSON 回执；摘要可截断，不暴露 native 身份或私有点击路径，也不改变候选点击授权。adapter 严格核对窗口身份、成对字段、Unicode、控制字符与字节预算；main 只使用匹配的截图后摘要，保持单窗许可和取消/释放边界。当前仅在 macOS 注册六种内置 Tool，其他平台保持不可用；构建、权限和固定 resource 路径见 [屏幕查看与点击](agent-computer-use.md)。开发版实际系统权限、截图/后台点击及同窗口 AX 信息一致性需分别实测，不能据 helper 自检推断应用或发行包已获授权；旧版全局点击记录与本次单窗口 AX 验收分别记录。

主窗口的默认后台节流保持 Electron 默认值；Agent 工作区可见时经可信 mainFrame 注册绘制引用，覆盖新建会话和 idle 预览。可信 active Run 在发送 started 前另取得自有 owner 引用，覆盖运行 / 等待批准 / 等待回答；已批准自有目标的正式观察再核对当前进程 PID 与精确 CGWindowID 取得目标引用。三个入口共用一个 WebContents 引用计数管理器，临时 `setBackgroundThrottling(false)`，不授截图或操作许可。工作区隐藏或 scope 变化释放注册，Run 取消同步释放其引用，失败 / 结束 / 启动异常 / owner 释放 / shutdown / 销毁清理；文档导航与 renderer crash 使工作区注册失效。最后引用归零后 250ms 有界绘制收尾再恢复原值，新获取取消待恢复 timer，销毁立即清理；不是最终帧确认，不延长执行或共享。该设置影响同窗绘制与 Page Visibility，不置前、不改变第三方应用或全局窗口策略；后台批准卡与最终帧的新鲜度须单独验收。

更新时间：2026-10-12

适用范围：`omniflow-app` 的 macOS、Windows 和 Linux 宿主差异，包含主窗口配置、renderer 平台识别、标题栏安全区、平台专属系统能力及分平台构建验证。

## 1. 当前结论

Omniflow 继续保持一个 Electron 项目。页面、业务状态、HTTP、IPC 契约、文件树、viewer、上传和内置浏览器默认跨平台共享；只有依赖操作系统窗口或本地系统能力的代码进入平台目录。

当前目录边界：

```text
electron/platform/
  index.ts                 main 侧平台策略入口
  types.ts                 主窗口平台配置类型
  processTree.ts           受控本地进程的跨平台终止策略
  mediaExecutable.ts       ffprobe 等媒体可执行文件的跨平台绝对路径解析
  macos/mainWindow.ts      macOS 主窗口策略
  windows/mainWindow.ts    Windows 主窗口策略

src/platform/
  index.ts                 renderer 平台入口
  runtime.ts               bridge 读取、浏览器 fallback、DOM 标记
  types.ts                 renderer 平台类型
```

不要在 `views`、`features` 或通用组件中继续散落 `process.platform`、user agent 判断或硬编码系统路径。业务调用方需要平台事实时，统一从 `src/platform` 读取；Electron main 的窗口策略统一从 `electron/platform` 进入。

## 2. 平台契约

preload 在 `window.electronWindow.platform` 暴露只读宿主值：

- `darwin`
- `win32`
- `linux`
- `unknown`

renderer 的 `getDesktopPlatform()` 将其归一为：

- `macos`
- `windows`
- `linux`
- `unknown`

应用启动时 `installDesktopPlatformDomState()` 会把归一值写到 `document.documentElement[data-platform]`。标题栏安全区和平台观感应优先使用这个稳定 DOM 标记，不要让每个 styled component 自己探测平台。

非 Electron 预览环境缺少 preload bridge 时，renderer 允许根据 `navigator.userAgent` 做 best-effort fallback。该 fallback 只服务预览和开发，不作为宿主能力授权依据。

## 3. 主窗口策略

macOS原生全屏时，目录树开关从窗口态的left=75px收回到10px，标题栏drag/no-drag区域与侧栏收起时的工具栏安全留白同步缩小；退出全屏恢复原值。使用BrowserWindow的enter-full-screen/leave-full-screen事件经`window-full-screen-changed`投影，不由窗口尺寸或DOM媒体全屏推断。视频 viewer 使用的是 Chromium HTML fullscreen，主进程另行监听webContents的enter-html-full-screen/leave-html-full-screen事件，并在进入/退出后恢复透明窗口 backing，避免退出视频全屏后目录树露出黑底。preload提供只读getFullScreen/onFullScreenChange，初始读取`window-get-full-screen`仅允许主窗口主frame，重新加载时也能恢复全屏布局。`src/platform/runtime.ts`统一写入`html[data-window-fullscreen]`，晚到的初始读取不能覆盖新事件；HMR释放订阅。Windows原有安全区和macOS毛玻璃背景保持原策略。

当前主窗口平台事实：

| 平台 | 标题栏 | 平台效果 | 窗口控制 |
| --- | --- | --- | --- |
| macOS | `hiddenInset` | `sidebar` vibrancy | 左侧系统红绿灯，固定坐标 `{ x: 14, y: 11 }` |
| Windows | `hidden` + `titleBarOverlay` | renderer 侧栏使用不透明主题背景 | 系统窗口按钮叠入首行工具栏右侧，不显示独立标题和应用名 |
| Linux / 其他 | `default` | 无额外效果 | 系统默认窗口框架 |

`electron/main.ts` 继续拥有 BrowserWindow 生命周期、窗口状态持久化、overlay 同步和应用退出语义；`electron/platform` 只返回平台窗口选项并执行平台初始化，不接管业务生命周期。

主窗口启用vibrancy时，`mainWindowBackground`保持透明底色`#00000000`，MainLayout与body也保持透明，让目录树原有半透明背景透出macOS毛玻璃。禁止为掩盖快速resize露底而给整个页面外壳或vibrancy窗口填充不透明聊天背景；实色`--app-bg`由右侧ContentArea和AgentRoot负责。未启用vibrancy的平台才使用与renderer一致的底色：暗色`#1e1e1e`、亮色`#f5f5f0`，Windows继续使用原有MainLayout实色。底色跟随nativeTheme更新，窗口关闭时清理监听；独立overlay仍透明。不承诺仅靠CSS消除macOS原生resize未绘制帧，保留目录树毛玻璃优先。

A1 自定义配色由主窗口可信快照投影到非 vibrancy 窗口底色；mainWindowBackground 缓存该有限颜色投影，nativeTheme 更新时不会重新覆盖成硬编码默认色。vibrancy 主窗口与 overlay 保持透明。来源与 IPC 规则见 [外观系统](appearance-system.md)。

macOS 目录树侧栏使用原生 `sidebar` vibrancy 单独提供材质与桌面透色，不再由 renderer 叠加 `surface.sidebarVibrancy` 主题色。Windows 使用 `surface.sidebar` 实色回退。其他工作区若确实需要主题投影，仍须使用低不透明度变量，禁止提高叠层不透明度或关闭原生 vibrancy；仅确认 BrowserWindow 仍配置 `vibrancy: 'sidebar'` 不足以证明效果保留，还需检查 renderer 叠层是否遮住材质，并在真实 macOS 窗口中复验。

Windows 的 `titleBarOverlay` 策略收敛在 `electron/platform/windows/mainWindow.ts`：标题栏透明，最小化、最大化和关闭仍由 Windows 原生绘制，符号色跟随 `nativeTheme`。首行工具栏使用 Window Controls Overlay 提供的 `titlebar-area-*` CSS 环境变量计算右侧安全区，不能用固定 padding 覆盖不同 DPI；不支持环境变量时才回退到三枚标准 caption button 的宽度。

Windows 不模拟 macOS vibrancy：目录树侧栏和主内容圆角背板通过 `data-platform="windows"` 使用不透明的 `--app-bg-sidebar`，亮暗主题分别继承自己的实色 token，避免圆角露出 BrowserWindow 默认白底。侧栏折叠按钮位于左上角并显式使用 `no-drag`，其余顶部空白仍可拖动窗口。文件模式的刷新按钮位于“工具”和“网页”入口之间；浏览器模式继续使用地址栏左侧的网页刷新按钮。

## 4. 平台能力归属

适合进入平台层：

- 标题栏、红绿灯、Windows caption buttons、vibrancy、Mica
- Chrome 等本地应用的系统路径发现
- Touch ID、Windows 凭据或系统身份验证
- taskbar、dock、系统菜单和平台通知
- 随包可执行文件路径，例如 `ffmpeg.exe`

继续保持共享：

- API / IPC payload 和错误语义
- React 页面及业务状态 owner
- 文件树、预览器、上传任务和 embedded browser 生命周期
- 跨平台文件路径拼接、系统对话框和 `app.getPath()` 能覆盖的目录

平台能力如果需要跨 preload 暴露，先更新本专题和 `electron/electron-env.d.ts`，再提供 renderer service；页面不得直接新增原始 IPC channel。

固定媒体 Tool 的受控本地进程生命周期继续由共享 `electron/service/agent/agent-local-process-runner.ts` 持有，不按平台复制 Tool 或任务状态。Runner 只把“如何请求结束受管进程组 / 进程树”委托给 `electron/platform/processTree.ts`：macOS / Linux 终止独立进程组，Windows 使用系统 `taskkill.exe /T` 并在不可用时退回直接终止子进程。该能力没有 preload / IPC 暴露，也不是任意 Shell 入口；raw Shell 走独立的 Provider、Process Supervisor、Runtime 与权限链。当前媒体 fallback 也不构成任意宿主命令不可逃逸的证明。

### 4.1 Agent Shell 目标平台边界

当前应用启动时会探测平台 Provider；只有 macOS 系统 Zsh 的 `executionReady` 为真时动态注册 `shell.run@1`，Linux Bash 与 Windows PowerShell 继续保持不可执行且不注册。共享 Tool / Run / ToolRun 不按平台复制，解释器、方言分析、编码、启动参数和受管进程生命周期交给平台 Provider；Provider 仍以绝对 executable + argv、`shell: false` 启动，模型和 renderer 不能选择任意可执行路径。

macOS 开发预览中，`cwd` 仍只能是 Run 工作区逻辑路径，但受支持只读命令可以直接引用用户明确给出的宿主绝对路径。`ask / auto` 对这类外部路径读取进入确认，`full-access` 在 Analyzer 完整理解命令时直接执行；Shell 的 `~` 固定指向 Run 虚拟 home，不是宿主 Home。只读查看不先 `file.stage`，需要工作副本、修改或转码时才暂存，原样上传仍使用 `file.upload`。

Windows 的 `taskkill.exe /T` 失败后直接终止子进程，足以作为当前固定媒体子进程的保守兜底，但不足以证明 raw Shell 的任意孙进程已经清理。Shell V1 在 Windows 上必须使用 Job Object 或等价可验证 supervisor；否则取消只能报告 `termination_incomplete`，不能宣称双平台完成。当前 Shell 实现事实见 `docs/built-in-agent-shell-architecture.md`，宿主机迁移目标见 `docs/built-in-agent-host-execution-contract.md`。

### 4.2 QQMusicMac 本地歌词

QQ 音乐歌词缓存是明确的 macOS 专属宿主能力，但共享业务页面不复制成 macOS 版本：

- Electron main 使用 `process.platform === 'darwin'` 作为能力授权，并只读打开 QQMusicMac 的曲库/cache SQLite。
- `window.electronQQMusicLyrics.status()` 向共享 renderer 返回 `supported` 和数据库存在性；Windows / Linux 页面使用同一组件显示不支持状态。
- 系统路径只在 `electron/service/qqMusicLyricsService.ts` 中解析，renderer 不读取 `process.platform`、user agent 或硬编码 `~/Library/Containers`。
- `search/preview` IPC 仅允许主窗口 main frame。数据库缺失、缓存缺失、plist/QRC 解码失败使用稳定错误码，不以空数组或空 XML 伪装成功。
- 解密和预览是本机只读流程；最终 `.qrc.xml` 保存仍属于共享资料库上传能力，不是平台层或 Go 后端的本地访问职责。

完整契约见 `docs/qqmusic-lyrics-tool.md`。

## 5. Renderer 演进准则

Renderer 平台适配按差异强度逐级处理，不能一开始就复制页面：

1. 颜色、背景、圆角、间距和安全区等纯视觉差异，继续通过根节点 `data-platform` 和共享 CSS token 处理。
2. 少量结构差异由共享页面读取 `src/platform` 的稳定平台事实，只让平台决定组件位置或是否展示；按钮行为、业务状态和事件处理保持单一实现。
3. 当同一窗口安全区或标题栏结构在两个以上页面重复，或一个共享页面出现三个以上平台 JSX 分支时，再建立 `src/platform/window-frame/`，抽取共享的窗口壳组件和布局 token。
4. 只有依赖 Electron / 操作系统 API 的能力才进入 `electron/platform/<os>/`。共享窗口生命周期、IPC 契约和业务 service 不按平台复制。

当前 `--windows-caption-controls-width` 由 `MainLayout` 统一计算，具体工具栏只消费该安全区 token；文件模式刷新按钮仍是同一份交互实现，仅在 Windows 与其他平台使用不同放置位置。现阶段没有第二套窗口壳，也没有重复的平台业务实现，因此不新增空目录或 capability 配置系统。

### 5.1 当前架构审查结论

2026-08-19 对 macOS / Windows 共存结构完成一次专项 review，当前结论如下：

- 未发现需要阻止合并的分层、状态双源、生命周期或 Electron 边界问题。
- `electron/platform` 的主进程宿主策略与 `src/platform` 的 renderer 平台事实职责清楚，继续保持现状。
- Windows 窗口按钮安全区由 `MainLayout` 单点计算，页面只消费 token；暂不需要新增窗口壳目录。
- 当前唯一的平台 JSX 布局选择是文件刷新按钮的位置，按钮行为和状态仍为单一实现，不构成分平台业务复制。
- macOS 规则均由 `data-platform="windows"` 或 main 侧 `win32` 分支隔离，静态检查未发现 macOS 行为改变。
- 残余风险是尚未在真实 Windows 上验证不同 DPI、最大化 / 还原、主题切换、窗口拖动和 caption buttons 点击命中；这些项目必须在 Windows 提测时完成。

后续 review 应先对照本节判断新增差异是否已经达到第 3 条的抽取阈值，而不是仅因新增一个平台判断就拆分目录。

禁止以下演进方式：

- 新建 `views/windows`、`views/macos` 或分平台复制整个 feature。
- 为了消除一个布尔判断，把单个布局选择设计成全局 capability 表。
- 页面自行读取 user agent、`process.platform` 或原始 preload 字段。
- 把 Windows 标题栏尺寸写成多个页面各自维护的固定 padding。

## 6. 构建与验证

日常编译验证入口：

```bash
npm run build
```

该命令不调用 `electron-builder`，不会触发 macOS 代码签名。生成平台安装包时使用：

```bash
npm run build:mac
npm run build:win
```

`build:mac` 是底层打包入口，要求签名钥匙串已经解锁。正式 macOS 发版统一使用 `npm run release:mac -- <version> [--publish]`，不要把日常编译验证和签名打包混在一起。

macOS 可以生成 Windows NSIS 产物，但交叉打包不能替代 Windows 运行验证。Windows 相关改动至少需要在 Windows 10/11 或 Windows 11 ARM 虚拟机中验证：

- 安装、启动、退出和覆盖安装
- 最小化、最大化、还原、关闭和拖动窗口
- 100%、125%、150% DPI
- 亮色、暗色和跟随系统
- 内置浏览器 `WebContentsView` bounds
- overlay 在最大化、多屏和视频硬件加速场景下的覆盖与点击
- 文件选择、保存、下载目录和本地可执行文件发现

Windows 正式发布还需要在 x64 Windows 上做最终冒烟，并配置代码签名，不能只以虚拟机或 macOS 交叉构建成功作为发布结论。

macOS 应用内更新的状态 owner、更新源、签名要求与本地验证流程见 `docs/desktop-auto-update.md`。自动更新属于共享 Electron 能力，平台层只承载签名、安装器和目标产物等真实平台差异。

## 7. 维护规则

出现以下变化时必须更新本文：

- 新增平台目录、平台 bridge 字段或平台专属宿主能力
- 修改 macOS / Windows 标题栏和安全区策略
- 修改分平台构建、签名、安装或发布方式
- 平台差异开始影响共享业务契约

平台目录只收纳真实系统差异。不要为了目录对称提前复制共享模块，也不要创建 macOS / Windows 两套业务实现。

## 第一方插件开发运行（C2）

macOS 第一方 CSV 已接入独立 sandboxed WebContentsView。开发启动显式移除 vite-plugin-electron 默认 `--no-sandbox`；主窗口/overlay/系统视频窗口共用的 preload 改为明确的 CommonJS `dist-electron/preload.cjs`，专用插件 preload 要求 `process.sandboxed`。未扩大 Windows/Linux 插件支持声明；完整验证范围见 [C2](plugin-system-c2-csv-viewer.md)。

D1 增加 macOS 本地插件管理：私有 ZIP staging、版本 index、固定四个 session 槽位清理后复用、文件选择拦截、运行资源观测和恢复模式。安全启动支持 `OMNIFLOW_DISABLE_THIRD_PARTY=1` 或 `--disable-third-party-plugins`；不依赖第三方执行提供管理/恢复。平台限制与证据见 [D1](plugin-system-d1-management.md)。
