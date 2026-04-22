# Cat Catch 总览与迁移地图

更新时间：2026-04-22
适用范围：给不熟悉 Cat Catch、媒体格式和 OmniFlow 内置嗅探链路的开发者快速建立全局视角。

## 1. 先看结论

如果只想先记住最重要的三件事，可以先看这里：

1. **Cat Catch 的核心不是某个按钮，而是一整条“识别资源 -> 判断类型 -> 选择处理器 -> 输出文件”的链路。**
2. **OmniFlow 的目标不是把 Cat Catch 的浏览器扩展实现逐行搬过来，而是把它的能力迁进来，并按桌面客户端的最佳实践重组。**
3. **当前最值得优先做完整的是 `m3u8/HLS` 主线；它做顺了，后面的 MPD、MSE、导入资源库、大文件处理都会更顺。**

这份文档的作用不是替代代码文档，而是帮你先洞观全局，知道：

- Cat Catch 到底有哪些能力
- 这些能力大概分成哪几类
- 不同媒体格式到底是什么
- Cat Catch 怎么做
- OmniFlow 现在做到哪一步
- 后面应该优先补什么

## 2. 先统一一个总模型

可以把整个系统先看成下面这条链：

```text
页面里出现资源
  -> 嗅探到资源
  -> 判断这是什么类型
  -> 交给对应处理器
  -> 生成成品文件
  -> 保存到本地 / 导入资源库
```

所谓“Cat Catch 很强”，本质上是它在这几层都做了很多经验积累：

- 更会嗅探
- 更会判断
- 更会解析
- 更会下载
- 更会处理奇怪站点的边角

而 OmniFlow 现在做的事情，就是把这整条链一点点补起来。

## 3. 先认识几个关键格式

如果不熟悉媒体格式，最容易在这里迷路。下面这几个概念够用。

### 3.1 `m3u8 / HLS` 是什么

可以把 `m3u8` 理解成一种**播放列表文件**。

它通常不是视频本体，而更像：

```text
头文件 / 播放列表
  -> 告诉播放器去哪里找真正的视频碎片
```

常见组成：

- 一个 `m3u8` 文件
- 一堆媒体分片（`.ts`、`.m4s` 等）
- 有时还有 key（加密密钥）
- 有时还有 map / init segment（初始化片段）

你可以把它想成：

```text
目录文件 + 一堆碎片文件
```

播放器拿到 `m3u8` 后，会按顺序去拉这些碎片，最后连续播放。

### 3.2 `mpd / DASH` 是什么

`mpd` 和 `m3u8` 很像，也是**清单 / 播放计划**，只是标准不同。

它通常描述：

- 视频轨有哪些
- 音频轨有哪些
- 每条轨的初始化片段和后续分片在哪里

可以把它理解成：**另一种格式的播放列表标准**。

### 3.3 MSE 是什么

MSE（Media Source Extensions）可以简单理解为：

**网页播放器不是拿到一个稳定的视频文件地址，而是自己在页面里一段一段往播放器喂数据。**

这种场景下，最麻烦的点是：

- 你可能拿不到完整稳定的 `m3u8` / `mp4` 地址
- 真正的数据已经进了页面内存

所以这类资源经常不能像普通 `m3u8` 那样直接让 `ffmpeg` 去拉。

### 3.4 直链媒体是什么

这个最简单，就是：

- 一个 `mp4`
- 一个 `webm`
- 一个音频文件 URL

拿到链接基本就能直接下载。

### 3.5 key、map、byterange 是什么

#### key

有些 `m3u8` 分片是加密的，播放前需要一个 key 才能解出来。

#### map / init segment

有些分片不是完整可独立播放的数据，播放前还需要一个初始化片段。这个初始化片段就是 `EXT-X-MAP` 常见场景。

#### byterange

有时一个大文件里只用到某一段字节范围，而不是整个文件。  
这时候播放列表里会写：

```text
从某个文件的某个偏移，截取多少字节
```

这就是 `BYTERANGE`。

## 4. Cat Catch 具备的能力，可以分成哪几大类

把 Cat Catch 的能力拆开看，会更容易理解它为什么显得“什么都能抓”。

### 4.1 资源发现与嗅探

- 当前页网络请求嗅探
- 深度搜索注入
- Worker 注入
- fetch / XHR / JSON 扫描
- 内联脚本里的资源提取
- key 候选捕获
- MSE 缓存捕捉

### 4.2 资源判断与解析

- 判断这是 HLS、DASH、直链还是 MSE
- 解析 `m3u8`
- 解析 `mpd`
- 找到 key / map / 分片 / variant / 轨道
- 修正相对 URL 和 baseUrl

### 4.3 下载与处理

- `m3u8 downloader`
- `mpd` 下载
- MSE 音视频导出和合并
- 本地 ffmpeg 合并 / 转码
- 自动下载

### 4.4 外部工具与输出

- `N_m3u8DL` 协议
- `aria2 RPC`
- 调用本地程序
- send2local
- MQTT

### 4.5 外围辅助能力

- 录屏 / recorder / WebRTC
- 媒体控制
- 截图 / 画中画
- JSON viewer
- 移动 UA / 移动标签

## 5. OmniFlow 当前大图

OmniFlow 不是浏览器扩展，而是 Electron 客户端，所以整体路线应该这样理解：

```text
Renderer
  负责：展示资源、发起动作、展示工具页

Electron main / 本地工具 / ffmpeg
  负责：真正的下载、写文件、合并、转码

后端
  负责：接收成品、存进 MinIO、创建目录树节点
```

所以 OmniFlow 当前的目标不是：

```text
像浏览器插件一样把所有事都在页面里做完
```

而是：

```text
把 Cat Catch 的识别与处理能力迁进来
  -> 用客户端方式重新组织
  -> 让大文件、ffmpeg、本地文件系统发挥作用
```

## 6. Cat Catch 和 OmniFlow 的核心区别

| 维度 | Cat Catch | OmniFlow |
| --- | --- | --- |
| 运行环境 | 浏览器扩展 | Electron 客户端 |
| 主要限制 | Blob、浏览器下载、扩展页面参数传播 | 本地文件系统、IPC、主进程边界 |
| 重处理位置 | 扩展页面 / 页面脚本 | Electron main / 本地工具 / ffmpeg |
| 对大文件的主要思路 | 浏览器环境下想办法继续活 | 客户端本地写盘、ffmpeg、后续分片上传 |
| 是否需要照搬 workaround | 经常需要 | 经常不需要 |

一句话说：

**Cat Catch 值得学的是“它怎么识别和怎么踩坑”，不是“它在浏览器扩展里是怎么活下来的”。**

## 7. 按处理器来看：不同资源怎么处理

这一节最适合快速建立全局感。

### 7.1 HLS / `m3u8`

#### 这是什么

- 一个播放列表
- 里面列着很多视频碎片
- 可能有 key
- 可能有 map
- 可能有多清晰度 variant

#### Cat Catch 会做什么

- 识别 `m3u8`
- 解析 master / media playlist
- 识别 key / map / 分片
- 下载分片
- 处理重试、线程、范围、直播录制等

#### OmniFlow 现在怎么做

- 已能识别 `m3u8`
- 已能解析 variants / renditions / keys / maps / segments
- 已能把 HLS 计划送入工具区
- 已有两条执行主线：
  - 网络 manifest：`ffmpeg` 直拉
  - 页内 / blob manifest：本地 downloader -> local playlist -> `ffmpeg`
- 工具区已支持手动输入 AES-128 自定义 key；一旦填写，会切到本地 downloader 主链，用本地 key 文件重写 playlist 后再交给 `ffmpeg`
- 工具区也能直接做一轮 key 验证；会同时尝试 manifest key URL、当前 tab 已捕获 key，以及手动输入 key
- 工具区已补基础执行反馈：当前阶段、最近日志、分片完成数，以及失败后重新执行
- 网络 master playlist 已补第一版 variant / 清晰度选择：默认保持“自动”，也可以锁到某个具体 variant URL 再交给 ffmpeg
- 当前 `master playlist + 手动 key` 仍不是完整支持场景，工具区会先显式拦住，避免误走错误主链

#### 还缺什么

- 更完整 key / map 体验
- 更完整的轨道 / variant / 清晰度选择
- 更细的日志 / 进度 / 失败重试 UI
- 边下边存 / 更稳的大文件策略

### 7.2 DASH / `mpd`

#### 这是什么

- 另一种播放计划格式
- 通常会分别描述音轨、视频轨、初始化片段和分片模板

#### Cat Catch 会做什么

- 解析 `mpd`
- 展开轨道和分片
- 提供下载能力

#### OmniFlow 现在怎么做

- 已能识别和基础解析 `mpd`
- 已能展开一部分常见 `SegmentTemplate` / `SegmentTimeline`
- 已能输出下载计划 JSON

#### 还缺什么

- 轨道选择
- 真正 downloader 主链
- 真实站点验证

### 7.3 MSE / 页内缓存流

#### 这是什么

- 数据不是一个稳定地址
- 播放器自己在页面里一段一段喂

#### Cat Catch 会做什么

- 拦 `appendBuffer`
- 识别音频流 / 视频流
- 导出缓存
- 必要时合并

#### OmniFlow 现在怎么做

- 已有 MSE 深度捕捉
- 已能识别 audio/video
- 已能导出和本地 ffmpeg 合并

#### 还缺什么

- 更大文件下更稳的写盘策略
- 与 HLS / DASH 更统一的导入体验

### 7.4 直链媒体

#### 这是什么

- 一个稳定文件地址

#### Cat Catch 会做什么

- 直接下载
- 转发给外部工具

#### OmniFlow 现在怎么做

- 可直接下载
- 部分已可导入资源库
- 后面可继续统一到工具区/导入链路

## 8. 猫抓能力总表：按全局看

下面这张表不是给 review 用的，是给快速看全局用的。

| 能力大类 | Cat Catch 有什么 | OmniFlow 现在到哪 |
| --- | --- | --- |
| 网络资源嗅探 | 很强，已成熟 | 已有主链 |
| 深度注入 / JSON / Worker | 很强 | 已有主链，继续补经验规则 |
| HLS 识别与解析 | 很成熟 | 已有主链，继续补 downloader 完整度 |
| MPD 识别与解析 | 有 | 已有基础 parser，离完整还远 |
| key 候选与验证 | 有 | 已有候选和验证入口，还缺自定义 key |
| MSE 捕捉与导出 | 很强 | 已有主链，继续测长视频和大文件 |
| m3u8 下载器 | 很成熟 | 已有骨架和两条执行主线，继续补 UI 和完整参数 |
| MPD 下载器 | 有 | 还没完整迁 |
| 外部工具输出 | 很多 | 大多未迁 |
| 规则过滤 | 很成熟 | 只有基础，规则体系还缺很多 |
| 录制/JSON/控制类 | 有不少外围能力 | 目前基本暂缓 |

## 9. OmniFlow 当前最值得优先做的

如果目标是“舒服地、不遗漏地、符合客户端最佳实践地迁 Cat Catch”，我建议优先级这样排：

1. **把 `m3u8/HLS` 做完整**
   - key
   - map
   - variant 选择
   - 日志 / 进度 / 失败重试
   - 大文件策略

2. **补 MPD 主链**
   - 轨道选择
   - 更完整 parser
   - downloader

3. **补规则过滤体系**
   - regex
   - 黑白名单
   - block / whitelist

4. **补外部工具出口**
   - `aria2`
   - `N_m3u8DL`
   - 本地命令模板

5. **最后再看外围能力**
   - recorder
   - 媒体控制
   - JSON viewer

## 10. 为什么你会觉得“做了又有、还有就又做”

因为这里不是一个按钮开发，而是一个系统开发。

你现在和我一起做的，很多时候只是下面这些层里的某一层：

- 识别层
- parser 层
- 计划层
- 执行层
- 输出层
- 导入层

所以看起来像：

```text
做了 HLS
  -> 其实只是做了 HLS parser
做了 downloader
  -> 其实只是做了 downloader 内核
接了工具页
  -> 其实只是接了入口，还没补日志和重试
```

这不是反复打补丁，而是同一条主链在逐层闭环。

## 11. 现在该怎么用这些文档

后面如果你想快速判断问题，建议这样用：

### 想快速洞观全局

先看本文档。

### 想知道“已经做了什么、还缺什么”

看 [cat-catch-migration-audit.md](/Users/loyce/personal/omniflow/omniflow-app/docs/cat-catch-migration-audit.md)

### 想知道“Cat Catch 某个提交值不值得迁”

看 [cat-catch-sync-maintenance-guide.md](/Users/loyce/personal/omniflow/omniflow-app/docs/cat-catch-sync-maintenance-guide.md)

### 想知道“代码当前结构怎么分层”

看 [embedded-browser-architecture.md](/Users/loyce/personal/omniflow/omniflow-app/docs/embedded-browser-architecture.md)

### 想知道“处理结果为什么要先在客户端成型再导入资源库”

看 [captured-resource-flow-plan.md](/Users/loyce/personal/omniflow/omniflow-app/docs/captured-resource-flow-plan.md)

## 12. 最后再总结一次

你真正想要的不是“把猫抓看起来像是迁过来了”，而是：

- Cat Catch 的能力尽量完整迁入
- 不遗漏主链
- 做法符合 OmniFlow 的客户端视角
- 大文件、工具区、资源库导入、后续维护都能说得通

这也是这份文档的目的：让人先看到整张地图，再去看某一段路。
