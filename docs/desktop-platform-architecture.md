# 桌面平台适配架构

更新时间：2026-08-23

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

当前主窗口平台事实：

| 平台 | 标题栏 | 平台效果 | 窗口控制 |
| --- | --- | --- | --- |
| macOS | `hiddenInset` | `sidebar` vibrancy | 左侧系统红绿灯，固定坐标 `{ x: 14, y: 11 }` |
| Windows | `hidden` + `titleBarOverlay` | renderer 侧栏使用不透明主题背景 | 系统窗口按钮叠入首行工具栏右侧，不显示独立标题和应用名 |
| Linux / 其他 | `default` | 无额外效果 | 系统默认窗口框架 |

`electron/main.ts` 继续拥有 BrowserWindow 生命周期、窗口状态持久化、overlay 同步和应用退出语义；`electron/platform` 只返回平台窗口选项并执行平台初始化，不接管业务生命周期。

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

Agent 的受控本地进程生命周期继续由共享 `electron/service/agent/agent-local-process-runner.ts` 持有，不按平台复制 Tool 或任务状态。Runner 只把“如何结束整棵进程树”委托给 `electron/platform/processTree.ts`：macOS / Linux 终止独立进程组，Windows 使用系统 `taskkill.exe /T` 并在不可用时退回直接终止子进程。该能力没有 preload / IPC 暴露，也不是任意 Shell 入口。

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
