# 前端验证矩阵

更新时间：2026-04-15

适用范围：`omniflow-app` 前端、Electron、IPC、工作区、文件树、文件预览、上传、内置浏览器和资源捕捉相关改动的提测、自测与 review 验证。

## 1. 概述

当前仓库没有完整的前端自动化测试门禁，所以“验证矩阵”就是前端工程约束的一部分。

它的目标不是替代自动化，而是让每次改动至少回答 3 个问题：

- 我改的是哪一类能力？
- 这一类能力的主路径和失败路径是什么？
- 我这次至少手工确认了哪些路径？

## 2. 通用基线

只要涉及 `omniflow-app` 代码，默认先做：

```bash
npm run lint
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
- 从目标页面返回上一路径时行为正常

边界路径：

- 无数据、无 active file、无 active browser tab
- 直接打开深层路由

### 3.2 Library Detail 工作区

适用改动：

- `views/library/detail/`
- 工作区模式切换
- tab / browser / search-home / file-viewer 关系

至少验证：

- `search-home -> file-viewer`
- `search-home -> browser`
- `search-home -> tools`
- `browser -> file-viewer`
- `browser -> search-home`
- `browser -> tools`
- `tools -> file-viewer`
- 页面切走再回来，workspace 缓存恢复正常

边界路径：

- 关闭最后一个 browser tab
- 当前没有 active file 时退出 browser

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
- 删除和重命名后树状态正确

边界路径：

- 大量节点展开后切页恢复
- 脏重建后展开状态是否保留
- 自动导入与手动上传是否都能刷新树

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

至少验证：

- 新建 tab
- 激活 tab
- 导航 URL
- 返回 / 前进 / 刷新
- 关闭 tab

边界路径：

- browser 面板隐藏或切到文件区后，原生 view 不残留
- 调整窗口尺寸后，浏览器视图 bounds 正常
- 空白页和已加载页之间切换时状态正常

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

## 4. 最低提交说明模板

如果一次改动涉及交互，最终说明至少写清楚：

```text
已执行：
- npm run lint
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
