# Tools Workspace 说明

更新时间：2026-04-22

适用范围：`src/views/library/detail/` 中的 `tools` 工作区模式，以及 `src/features/tool-workspace/` 下的工具域能力。

## 1. 概述

`tools workspace` 不是单独的路由应用，而是 `library detail` 页面里的一个工作区模式。

当前目标：

- 保留目录树上下文。
- 让复杂工具流程从设置页和内容页中抽离出来。
- 支持后续从视频、音频、文件详情等位置带上下文进入工具区。

当前工具包括：

- `AI 字幕翻译`
- `媒体处理`

## 2. 工作区层级

当前 `library detail` 的 `workspaceDisplayMode` 有 4 种：

- `search-home`
- `file-viewer`
- `browser`
- `tools`

其中：

- 页面层继续拥有“当前显示哪种工作区模式”的 owner。
- 工具自身的业务状态不回写到页面层，而是收敛在 `src/features/tool-workspace/`。

当前结论：

- 页面层只负责进入 / 离开 `tools`。
- 工具区内部具体是哪个工具、字幕当前草稿是什么，属于工具域自己的状态。

## 3. 当前工具区结构

当前 `tools workspace` 的结构分为两层：

1. 页面层容器
   - 位于 `src/views/library/detail/index.tsx`
   - 负责：
     - 工具区入口按钮
     - 切换 `workspaceDisplayMode='tools'`
     - 保留目录树显示
     - 将目录树当前选中节点透传给工具区
     - 从浏览器资源面板把已选媒体资源送入媒体处理工具

2. 工具域实现
   - 位于 `src/features/tool-workspace/`
   - 负责：
     - 工具导航壳
     - 字幕翻译配置
     - 字幕解析、翻译、另存为
     - 浏览器捕获媒体资源承接、音视频合并、转格式
     - HLS 下载计划承接与执行
     - 工具草稿缓存

## 4. 目录树联动

当前工具区没有新造一套“库内文件选择器”，而是复用目录树当前选中节点。

目录树当前透传字段包括：

- `primaryNode`
- `selectedNodeIds`
- `rootNodeId`

用途：

- 导入库内字幕时，读取当前选中的字幕文件。
- 另存为到库内时，优先使用当前选中目录作为目标目录。

当前保存目标回退规则：

1. 当前选中目录
2. 当前选中文件的父目录
3. 源字幕文件的父目录
4. 当前库根目录

媒体处理工具不再直接展开全部目录下拉；改为“保存到本地 / 保存到内部”单按钮切换（与搜索主页模式切换风格一致，含背景色与图标状态变化）。

## 5. AI 字幕翻译工具

### 5.1 当前能力

- 读取本地字幕文件
- 读取库内字幕文件
- 自动解析 `srt / vtt`
- 列表展示：
  - 时间戳
  - 原文
  - 译文
- 单句翻译
- 一键翻译全部
- 译文手动编辑
- 另存到本地
- 另存到库内文件系统

### 5.2 模型协议

当前按 OpenAI-compatible 接口风格请求：

- `GET /models`
- `POST /chat/completions`

默认本地配置：

- `baseUrl = http://localhost:11434/v1`
- `apiKey = ollama`
- `presetPrompt = ''`

这些配置只保存在本机 `localStorage`，不回写后端。

当前支持“预设提示词”：

- 作为每次翻译请求固定附带的 system prompt 补充
- 用于长期术语、语气、专有名词等稳定规则

### 5.3 上下文拼接

当前单句翻译会把：

- 当前句
- 前 `contextWindow` 句
- 后 `contextWindow` 句

一起发给模型，但明确要求模型只返回“当前句”的译文。

默认 `contextWindow = 5`。

## 6. 保存链路

### 6.1 本地另存为

当前链路：

```text
renderer tool workspace
  -> preload save dialog
  -> preload writeTextFile
  -> Electron main 写入目标路径
```

### 6.2 库内另存为

当前链路：

```text
renderer tool workspace
  -> preload createStagedTextFile
  -> Electron main 在 userData staging 下生成真实文本文件
  -> renderer 复用 /v1/directory/upload
  -> 上传成功后清理 staging 文件
```

规则：

- Electron main 只负责“通用文本文件 staging / 写入”。
- 上传业务仍由 renderer 侧现有上传链路负责。
- 工具区生成内容属于系统插入，库内另存调用 `/v1/directory/upload` 时传 `conflictPolicy=auto_rename`；同目录重名由后端返回最终名称，例如 `字幕 (1).srt`。

## 7. 状态 owner

当前 owner 规则如下：

- `workspaceDisplayMode`
  - owner：`library detail` 页面
- 目录树当前选中节点
  - owner：目录树组件内部
  - 向页面层只做只读透传
- 字幕翻译草稿
  - owner：`features/tool-workspace`
  - 当前按 `libraryId` 做内存缓存
- 翻译配置
  - owner：`features/tool-workspace`
  - 当前持久化到本地 `localStorage`
- 媒体处理资源
  - owner：`features/tool-workspace`
  - 当前由浏览器资源面板一次性送入，只保存在工具区内存中，不写入工具区持久化状态

## 8. 媒体处理工具

### 8.1 当前能力

- 从浏览器资源面板接收“已选资源”。
- 从浏览器资源卡接收“已解析 HLS 计划”。
- 展示送入资源的标题、类型、大小、来源和扩展名。
- 合并音视频：复用当前 embedded browser 的本地 ffmpeg 合并链路。
- 转格式：单个媒体资源可输入目标扩展名后通过本地 ffmpeg 尝试转换，扩展名只接受 1-12 位字母或数字，例如 `mp3`、`m4a`、`mp4`、`wav`。如果 ffmpeg 不支持该封装或编码组合，错误直接回传给用户。
- HLS 计划模式：
  - `媒体处理` 内部新增 `直接资源 / HLS 计划` 模式切换，不新开第三个工具。
  - 资源卡中的 HLS manifest 在解析后可点击“送到工具页”。
  - 工具页显示 HLS 计划摘要：playlist 类型、是否直播、分片数、key/map/part 数量、建议线程数。
  - 对媒体 playlist，工具页已补 Cat Catch 风格的第一版下载控制：
    - 线程数
    - 起始分片
    - 结束分片
  - 一旦改动线程数或分片范围，就会强制切到本地 downloader 主链，不再让 ffmpeg 直接拉整条 manifest。
  - 网络 `master playlist` 已支持第一版 variant / 清晰度选择：
    - 默认保持“自动”，继续把原始 manifest 交给 ffmpeg。
    - 也可以明确锁到某个 variant URL，再按该清晰度执行下载。
  - 工具页现在会额外展示 `master playlist` 的音轨 / 字幕轨摘要，并把当前选中 variant 关联到对应 audio group / subtitles group。
  - 当前已支持在工具页里：
    - 选择独立 audio rendition，并走 `ffmpeg` 下载+合并主链
    - 选择 subtitle rendition，并单独下载字幕文件
  - 工具页支持手动输入 16 字节 AES-128 自定义 key（hex / base64）。
  - 工具页也可以直接做一轮 key 验证：
    - 自动候选来源于 manifest 自带 key URL 和当前 tab 已捕获的 key 资源。
    - 如果你已经手动输入了 key，也会一起作为候选参与验证。
    - 当前已开始区分“不需要 key / 还没有候选 / 候选未命中 / 验证过程失败”这几类结果，方便排障。
    - 当前验证会抽前面几段 AES-128 分片一起验证，不再只试第一段。
    - 当前也会把“试了多少候选 / 验了多少片”直接展示出来，方便判断验证结论的可信度。
  - 工具页会显示当前执行状态、最近日志、当前阶段，以及分片完成数；当前日志已按阶段 / 执行链结构化展示，并补了一版任务阶段进度条；失败时还会显示失败分片编号并支持一键复制，便于排障或后续做定向重试。
  - 本地 downloader 下载中会补充已收字节、下载速度和预计剩余时间；`ffmpeg` 阶段会补充处理秒数和速度文本，但仍以阶段状态为主，不伪装成精确百分比。
  - 当前本地 downloader 失败后，工具页已经可以直接“重试失败分片”，不再默认整条任务从头来一遍。
  - 网络 manifest：
    - 继续走现有 `ffmpeg` 直拉主链。
  - blob / 页内内存 manifest：
    - 走 Electron main 的本地 downloader 主链：
      `plan -> local workdir -> rewritten local-playlist.m3u8 -> ffmpeg`。
  - 如果填写了自定义 key，也会强制走本地 downloader 主链，让本地 playlist 引用手动写入的 key 文件。
  - 当前 `master playlist + 手动 key` 仍不作为可用组合；需要先收敛到具体媒体 playlist，再走本地 downloader 主链。
  - HLS 计划模式仍复用统一“保存到本地 / 保存到内部”的保存目标切换，不单独弹第二套保存 UI。
  - 当前下载控制先补了 Cat Catch 最常用的线程数和分片范围；时间范围、IV 等还没补。
- 保存目标切换：
  - 本地：保存位置显示为一行路径，点击路径可切换到系统目录
  - 内部：通过紧凑目录选择器选择目录（面包屑 + 双击进入目录）
  - 内部未选目录时，点击“合并&保存 / 转换&保存”会把路径框标红并提示“必须选择”
- 内部保存链路：
  - 合并/转格式先在本地落盘
  - 再以 `conflictPolicy=auto_rename` 自动上传到所选内部目录（上传失败时提示“本地已保存，内部上传失败”）
  - 上传成功后会触发目录树目标目录局部刷新，立即可见新文件

### 8.2 边界

- 媒体处理工具不重新捕捉资源，不修改资源 URL、后缀或来源。
- 当前转格式一次只处理一个媒体资源；多资源批量转码后续再扩展。
- HLS 第一版只把“计划解析后的重处理”收进工具区；资源面板仍只负责解析、复制计划和发起，不承载长时间下载 UI。
- 当前 HLS 计划模式已补基础执行反馈（阶段 / 结构化最近日志 / 分片完成数 / 阶段进度 / 重新执行），并补了网络 master playlist 的 variant 选择、独立音轨选择与 ffmpeg 合并、字幕轨单独下载，以及媒体 playlist 的线程数 / 分片范围控制；本地 downloader 失败后也已经支持“重试失败分片”，下载中会展示已收字节、速度和 ETA，ffmpeg 阶段会展示处理秒数和速度文本。剩余主要是轨道联动验真和真实样本测试。

## 9. 验证方式

本次工具区改动至少应验证：

- `file-viewer -> tools`
- `search-home -> tools`
- `browser -> tools`
- 工具区读取本地字幕
- 工具区读取库内字幕
- 单句翻译
- 批量翻译
- 本地另存为
- 库内另存为
- 浏览器资源面板已选资源进入媒体处理工具
- 媒体处理工具切换保存位置（本地 / 库内目录）
- 媒体处理工具合并音视频
- 媒体处理工具转格式保存
- 内部系统目录选择弹框：面包屑跳转、双击进入目录、仅显示目录

## 10. 目录选择器复用

新增通用组件：`src/features/file-explorer/components/library-node-picker-modal/index.tsx`

- 支持参数化显示模式：`folders` / `files` / `all`
- 当前媒体处理使用 `folders` 模式
- 后续可复用到其他“内部节点选择”场景，避免重复实现目录浏览弹框

## 11. 维护规则

出现以下变化时，必须回写本文：

- 新增第二个工具
- 工具区支持多工具会话或多工具 tab
- 工具区开始支持从视频/音频/文件详情自动跳转
- 字幕工具支持更多格式或导出模式
- 文本 staging / preload 保存链路变化
