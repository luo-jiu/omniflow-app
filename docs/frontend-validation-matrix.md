# 前端验证矩阵

更新时间：2026-07-31

适用范围：`omniflow-app` 前端、Electron、IPC、工作区、文件树、文件预览、上传、内置浏览器和资源捕捉相关改动的提测、自测与 review 验证。

## 1. 概述

当前仓库已有 Viewer Session 纯 TypeScript 单元测试，但还没有覆盖完整 UI 和 Electron 交互的自动化门禁，所以“验证矩阵”仍是前端工程约束的一部分。

它的目标不是替代自动化，而是让每次改动至少回答 3 个问题：

- 我改的是哪一类能力？
- 这一类能力的主路径和失败路径是什么？
- 我这次至少手工确认了哪些路径？

## 2. 通用基线

只要涉及 `omniflow-app` 代码，默认先做：

```bash
npm run lint
npm test
npm run build
```

如果本次没跑，最终说明里必须写：

- 为什么没跑
- 哪些风险仍未验证

## 3. 按改动类型验证

### 3.1 路由 / 页面编排

适用改动：

- `views/`
- `router/`
- `layouts/`
- 页面级模式切换

至少验证：

- 页面能正常进入目标路由
- 刷新后能恢复到正确页面
- 登录态要求没有漂移
- 存在本地 token 的冷启动会等待认证 bootstrap 和 application/auth runtime 启动后再挂载受保护页面
- 从目标页面返回上一路径时行为正常

边界路径：

- 无数据、无 active file、无 active browser tab
- 直接打开深层路由

### 3.2 Library Detail 工作区

适用改动：

- `views/library/detail/`
- 工作区模式切换
- tab / browser / search-home / file-viewer / tools / system 关系
- `features/workspace-resource-release`
- 设置、个人主页、上传中心、回收站、标签 / 存储 / 浏览器映射等从旧全屏页迁移到工作区视图的入口

至少验证：

- `search-home -> file-viewer`
- `search-home -> browser`
- `search-home -> tools`
- `browser -> file-viewer`
- `browser -> search-home`
- `browser -> tools`
- `browser -> system -> browser`
- `file-viewer -> system -> file-viewer`
- `search-home -> system -> search-home`
- `tools -> file-viewer`
- `tools -> system -> tools`
- 页面切走再回来，workspace 缓存恢复正常

边界路径：

- 关闭最后一个 browser tab
- 当前没有 active file 时退出 browser
- system tab 重复打开同一入口不创建第二份视图
- 打开 system view 后，正在播放的音频 / 视频不中断
- 上传中心 system view 打开 / 关闭不影响后台上传队列
- 回收站 system view 恢复 / 彻底删除 / 清空后列表更新，目录树快照标记刷新
- 个人主页 system view 从目录树右下头像打开，修改头像 / 昵称后入口头像同步
- 资源监测 system view 能打开、刷新、展示空态 / 错误态、V2 统计仪表盘、资料库排行、业务集合、基础文件类型、集合内部构成、资源探针状态、探针可用性图谱、可见 / 回收站 / 孤儿对象状态维度和历史 provider 类型值标记；资源组成主图使用图表库渲染并支持业务集合、基础类型、集合构成、资料库、物理存储、资源状态维度切换，主图明细列在明暗主题下均可读且不与全局摘要重复；资料库详情页分布统计、V2 仪表盘统计和采样请求携带当前 `libraryId`，provider / 基础设施探针不按资料库过滤；探针历史由应用级 runtime 维护，离开资源监测页面后仍会继续按 5 分钟周期探测，退出登录后清空；V2 `/dashboard` 展示路径应能表达基础文件类型、业务集合类型和交叉矩阵；到存储设置、迁移任务、当前资料库回收站的跳转关系正常，仓库页入口不能在缺少 `libraryId` 时直接打开回收站；点击“记录样本”能写入一条历史采样并提示样本 ID；它不影响文件 tab、上传任务和媒体播放
- 右键释放仓库后，再进入同一仓库时文件 tab、目录树展开、browser tab、系统工作区现场、工具区草稿、viewer 前端 snapshot 和 MediaHub 出声实体都不恢复
- 右键释放仓库只影响目标 `libraryId`；另一个仓库的文件 tab、目录树现场和媒体播放不被清掉
- 删除仓库成功后，本地不留下该仓库可被同 id 恢复的旧工作区现场
- 主动退出登录或 401 登录失效后，所有资料库工作区现场、MediaHub 出声实体和 embedded browser view 都被释放，重新登录不恢复上一个会话的目录树、文件 tab 或浏览器 tab

legacy 兼容检查：

- `/settings`、`/profile`、`/upload-center`、`/transfer-center?tab=upload`、`/libraries/:id/recycle-bin`、`/settings/tags`、`/settings/storage`、`/settings/browser-file-mappings` 只作为迁移期兼容入口。
- 新增能力、样式基线和主路径验证默认落在 system workspace 或仓库页右侧系统宿主，不再以 legacy 全屏页作为推荐入口。
- legacy 路由删除前，只需要确认直接访问不造成明显崩溃；不要为它们重新扩展独立交互。

### 3.3 文件树 / File Explorer

适用改动：

- `features/file-explorer/`
- 目录树节点装载
- 上传后树刷新
- 重命名 / 删除 / 移动

至少验证：

- 根节点和子节点能正常展开
- 双击文件能正确打开
- 上传成功后节点出现在预期父目录
- 从外部浏览器拖拽图片到目录树可进入上传确认；普通本地文件拖拽上传仍走原链路
- 删除和重命名后树状态正确

边界路径：

- 大量节点展开后切页恢复
- 脏重建后展开状态是否保留
- 自动导入与手动上传是否都能刷新树
- 外部图片 URL 下载失败时有明确提示，不创建空上传任务；归档目录仍禁止拖拽上传

### 3.4 文件预览 / File Viewer

适用改动：

- `features/file-viewer/`
- `FileViewerContext`
- 预览 tab
- 文件分发器

至少验证：

- 打开图片、音频、视频、PDF 中至少一种受影响类型
- 同一文件重复打开时 tab 行为符合预期
- 关闭 active tab 后 fallback 正常
- reload 行为不会把 tab 弄丢

边界路径：

- 不支持预览的文件
- `nodeId` 和 `url` 作为 tab id 的复用行为
- 视频底部小窗按钮优先进入 Document PiP；不支持时降级应用内浮窗
- 视频小窗状态下 inline 占位可收回，同一个视频元素进度不丢
- Document PiP 原生关闭、应用内浮窗收起 / 软关闭后，MediaHub entry 和播放状态符合 `docs/media-hub-contract.md`
- 显式释放工作区后，PDF / 漫画 / ASMR / 视频进度 / 归档浏览等 viewer 前端 snapshot 不从释放前状态恢复；普通切页仍可恢复
- 已同步到后端 `viewMeta` 的阅读 / 播放进度不应被前端工作区释放误删

### 3.5 上传中心

适用改动：

- `modules/upload-center/`
- `utils/uploadManager.ts`
- 上传入口与上传进度

至少验证：

- 单文件上传成功
- 上传进度能推进
- 上传失败能提示
- 批量上传后树或页面能正确刷新

边界路径：

- 取消上传
- 重试上传
- 并发上传时 UI 没有卡死或串任务

### 3.6 Embedded Browser 基础生命周期

适用改动：

- `EmbeddedBrowserPanel`
- `electron/preload.ts`
- `embeddedBrowserMainController`
- `embeddedBrowserViewLifecycle`
- `features/workspace-resource-release`

至少验证：

- 新建 tab
- 激活 tab
- 导航 URL
- 返回 / 前进 / 刷新
- 关闭 tab
- 网页和地址栏分别获得焦点时，`Cmd/Ctrl` + `+/-/0` 都只缩放活动网页
- `Cmd+Option+I`（macOS）、`F12` / `Ctrl+Shift+I`（Windows / Linux）能在活动网页右侧停靠打开 DevTools；焦点进入 DevTools 的 Elements / Console 后，同一快捷键仍能关闭
- DevTools 可切换左侧 / 底部 / 独立窗口停靠方式；左上角原生元素选择器属于 Electron 运行时限制，不作为通过项
- 网页右键“检查”能定位当前元素，可编辑区域的剪切 / 复制 / 粘贴没有丢失

边界路径：

- browser 面板隐藏或切到文件区后，原生 view 不残留
- 右键释放仓库工作区后，该仓库登记过的原生 view 不残留
- session release / 退出登录后，所有原生 view 不残留
- 调整窗口尺寸后，浏览器视图 bounds 正常
- 空白页和已加载页之间切换时状态正常
- DevTools 打开时 deep capture 明确处于 CDP 调试降级；关闭 DevTools 后刷新页面，document-start probe 能恢复

### 3.7 资源捕捉 / Catch Toolkit

适用改动：

- `features/embedded-browser/resources/`
- probe / resource api / catch toolkit
- 资源面板过滤、导出、预览、合并

至少验证：

- 开启普通捕捉后资源进入列表
- 开启深度捕捉后页面刷新并继续能抓到资源
- MSE 资源能预览
- 音视频合并链路仍可用

边界路径：

- 只有音频或只有视频时的行为
- 资源很多时筛选仍正常
- 清缓存 / 从头重捕 / 自动跳缓冲尾行为正常

### 3.8 浏览器下载导入

适用改动：

- `features/embedded-browser/downloads/`
- 下载完成事件
- 导入资源库 / 保存到桌面

至少验证：

- 下载完成后能进入导入队列
- 导入到目标目录成功
- 保存到本地成功
- 临时文件能被清理

边界路径：

- 下载失败
- 用户取消保存
- 导入失败后错误提示是否清楚

### 3.9 IPC / Preload / 请求层

适用改动：

- `service/request/`
- `electron/preload.ts`
- IPC payload

至少验证：

- 新老调用方都能拿到预期 payload
- 登录失效语义没有漂移
- 失败时错误提示不为空

边界路径：

- 主进程抛错
- 后端返回业务失败但 HTTP 200
- renderer 在桌面环境缺失 bridge 时的报错是否合理

### 3.10 主题 / 布局 / 浮层

适用改动：

- `styled-components`
- `assets/theme`
- 头部、侧栏、分栏、右键菜单、modal、popover

至少验证：

- 亮色 / 暗色至少看一遍受影响区域
- 浮层不会被原生 view 遮挡
- 标题栏安全区没有被破坏

边界路径：

- 浏览器模式与文件模式切换时布局跳变
- 分栏拖拽到最小/最大宽度

### 3.11 桌面平台 / 窗口壳

适用改动：

- `electron/platform/`
- `src/platform/`
- `electron/main.ts` 的 BrowserWindow 配置或生命周期
- preload 的 `window.electronWindow` 暴露面
- 标题栏、安全区、红绿灯、Windows caption buttons

至少验证：

- macOS 与 Windows 各自识别出正确的 `html[data-platform]`
- 窗口可拖动、最小化、最大化 / 还原和关闭
- 亮色、暗色和跟随系统下标题栏控件可见
- Windows 标题栏右侧控件、macOS 左侧红绿灯都不遮挡业务按钮
- 内置浏览器激活后 resize / maximize 的原生 view bounds 正确

边界路径：

- Windows 100%、125%、150% DPI
- 多显示器切换和不同 DPI 显示器之间移动
- 主窗口最大化 / 还原后 overlay bounds 和点击命中正常
- macOS 全屏退出后红绿灯、安全区和 overlay 恢复正常
- 非 Electron renderer 预览环境缺少 bridge 时回退为可识别平台或 `unknown`，页面不崩溃

## 4. 最低提交说明模板

如果一次改动涉及交互，最终说明至少写清楚：

```text
已执行：
- npm run lint
- npm test
- npm run build

已手工验证：
- xxx 主路径
- xxx 边界路径

未验证：
- xxx
```

如果没跑构建或没做手测，也要明确写出来，而不是省略。

## 5. 维护规则

出现以下变化时，必须更新这份矩阵：

- 新增新的系统级业务域
- 某类改动的主路径或失败路径发生变化
- 构建门禁发生变化
- 已经出现多次“明明测过但漏了同类边界”的问题

这份文档的目标不是越来越长，而是长期代表“当前前端最值得优先验证的真实风险面”。
