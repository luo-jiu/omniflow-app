# 桌面平台适配架构

更新时间：2026-07-30

适用范围：`omniflow-app` 的 macOS、Windows 和 Linux 宿主差异，包含主窗口配置、renderer 平台识别、标题栏安全区、平台专属系统能力及分平台构建验证。

## 1. 当前结论

Omniflow 继续保持一个 Electron 项目。页面、业务状态、HTTP、IPC 契约、文件树、viewer、上传和内置浏览器默认跨平台共享；只有依赖操作系统窗口或本地系统能力的代码进入平台目录。

当前目录边界：

```text
electron/platform/
  index.ts                 main 侧平台策略入口
  types.ts                 主窗口平台配置类型
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
| Windows | `default` | 系统默认背景 | 系统原生标题栏和右侧窗口按钮 |
| Linux / 其他 | `default` | 无额外效果 | 系统默认窗口框架 |

`electron/main.ts` 继续拥有 BrowserWindow 生命周期、窗口状态持久化、overlay 同步和应用退出语义；`electron/platform` 只返回平台窗口选项并执行平台初始化，不接管业务生命周期。

Windows 后续改用 `titleBarOverlay` 时，应在 `electron/platform/windows/mainWindow.ts` 内完成宿主策略，并通过 `data-platform="windows"` 收敛 renderer 安全区。不要直接把 Windows 分支重新写回 `electron/main.ts`。

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

## 5. 构建与验证

本地构建入口：

```bash
npm run build:mac
npm run build:win
```

macOS 可以生成 Windows NSIS 产物，但交叉打包不能替代 Windows 运行验证。Windows 相关改动至少需要在 Windows 10/11 或 Windows 11 ARM 虚拟机中验证：

- 安装、启动、退出和覆盖安装
- 最小化、最大化、还原、关闭和拖动窗口
- 100%、125%、150% DPI
- 亮色、暗色和跟随系统
- 内置浏览器 `WebContentsView` bounds
- overlay 在最大化、多屏和视频硬件加速场景下的覆盖与点击
- 文件选择、保存、下载目录和本地可执行文件发现

Windows 正式发布还需要在 x64 Windows 上做最终冒烟，并配置代码签名，不能只以虚拟机或 macOS 交叉构建成功作为发布结论。

## 6. 维护规则

出现以下变化时必须更新本文：

- 新增平台目录、平台 bridge 字段或平台专属宿主能力
- 修改 macOS / Windows 标题栏和安全区策略
- 修改分平台构建、签名、安装或发布方式
- 平台差异开始影响共享业务契约

平台目录只收纳真实系统差异。不要为了目录对称提前复制共享模块，也不要创建 macOS / Windows 两套业务实现。
