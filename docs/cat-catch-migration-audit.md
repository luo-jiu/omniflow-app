# Cat Catch 功能夺舍对照表

更新时间：2026-04-14  
功能实现基线：截至 `omniflow-app` 提交 `2805ccf`，对照对象 `project/cat-catch`

目标：先把 Cat Catch 的功能能力尽量完整迁过来，再统一调整正式 UI。正式资源面板 UI 暂不定型；如需验证，优先做薄 demo / debug 入口。

状态说明：

- `已夺舍`：主链路已经在 OmniFlow 内可用，后续主要靠真实站点压测补边角。
- `部分夺舍`：已有核心实现，但还缺 Cat Catch 的完整经验逻辑、下载参数、验证能力或 UI 操作面。
- `未夺舍`：还没有迁入，或只存在很弱的替代能力。
- `暂缓/另议`：可能不适合直接搬，需确认是否符合 OmniFlow 产品定位。

## 总览

| Cat Catch 能力 | 对应源码 | OmniFlow 当前状态 | 下一步 |
| --- | --- | --- | --- |
| 当前页网络资源嗅探 | `js/background.js`, `js/popup.js` | 已夺舍 | 继续补规则过滤和真实站点验证 |
| 深度搜索注入 | `catch-script/search.js` | 部分夺舍 | 补更多经验规则、特殊 JSON、站点边角 |
| Worker 注入嗅探 | `catch-script/search.js` | 已夺舍 | 测 worker-heavy 页面 |
| fetch / XHR / JSON 扫描 | `catch-script/search.js` | 已夺舍 | 测相对 URL、嵌套 JSON、一次性 m3u8 |
| HLS/m3u8 内联识别 | `catch-script/search.js`, `js/m3u8.js` | 部分夺舍 | 补 parser / downloader 能力 |
| DASH/mpd 内联识别 | `catch-script/search.js`, `js/mpd.js` | 部分夺舍 | 补 mpd parser 选择音视频轨 |
| Vimeo playlist.json 转 m3u8 | `catch-script/search.js` | 已夺舍 | 测 Vimeo 页面 |
| key 候选捕获 | `catch-script/search.js`, `js/content-script.js`, `js/m3u8.js` | 部分夺舍 | 补真实 key 验证 / 自定义 key |
| MSE 缓存捕获 | `catch-script/catch.js` | 已夺舍 | 测长视频、直播、异常重试 |
| 自动跳缓冲末尾 | `catch-script/catch.js` | 已夺舍 | 真实播放页验证 |
| 去额外媒体头 | `catch-script/catch.js` | 已夺舍 | 多格式验证 |
| 本地 ffmpeg 合并 MSE 音视频 | `catch-script/catch.js`, `js/m3u8.js` | 部分夺舍 | 从 B 站 m4s 扩到 HLS/DASH |
| m3u8 parser 页面 | `m3u8.html`, `js/m3u8.js` | 部分夺舍 | 先做功能/demo，不急着定正式 UI |
| m3u8 downloader | `js/m3u8.downloader.js` | 未夺舍 | 迁下载队列、重试、范围、key、EXT-X-MAP |
| mpd parser 页面 | `mpd.html`, `js/mpd.js` | 未夺舍 | 迁轨道解析/选择，或引入等价 parser |
| N_m3u8DL 协议调用 | `options.html`, `js/popup.js`, `js/m3u8.js` | 未夺舍 | 评估是否作为外部工具导出 |
| aria2 RPC | `js/function.js`, `js/popup.js`, `js/preview.js` | 未夺舍 | 可作为外部下载器适配 |
| invoke 本地程序 | `js/function.js`, `js/popup.js`, `js/preview.js` | 未夺舍 | 可作为命令模板/外部工具适配 |
| MQTT 推送 | `js/pupup-utils.js`, `js/preview.js`, `options.html` | 未夺舍 | 暂缓/另议 |
| 自动下载 | `js/popup.js`, `options.html` | 部分夺舍 | MSE 完成后自动下载已有；普通资源未完整迁 |
| 规则过滤 / Regex / 黑白名单 | `js/init.js`, `js/background.js`, `js/function.js` | 部分夺舍 | 抽成规则模块，不塞回 probe |
| 请求头保留 / Referer / Cookie | `js/background.js`, `js/function.js`, `js/m3u8.js` | 部分夺舍 | 下载链路统一透传 headers |
| 下载器边下边存 / StreamSaver | `downloader.html`, `js/downloader.js`, `lib/StreamSaver.js` | 未夺舍 | Electron 内可用本地文件流替代 |
| 录屏 / WebRTC / recorder | `catch-script/recorder*.js`, `catch-script/webrtc.js` | 未夺舍 | 暂缓/另议，和“资源嗅探”分开做 |
| 媒体控制 / 截图 / 画中画 | `js/content-script.js`, `js/media-control.js` | 未夺舍 | 暂缓/另议 |
| JSON 查看器 | `json.html`, `js/json.js` | 未夺舍 | 暂缓/另议 |
| 移动 UA / 移动标签 | `js/init.js`, `options.html` | 未夺舍 | 暂缓/另议 |

## 已经夺舍的核心链路

### 资源捕获与深度搜索

- 当前页资源列表：已接入 Electron 主进程网络捕获和前端资源面板。
- 深度捕获：已通过当前页注入 probe，覆盖 `fetch`、`XMLHttpRequest`、`JSON.parse`、`btoa`、`atob`、`String.fromCharCode`、TypedArray、DataView、Worker。
- Worker 注入：已支持 worker 内 relay 回主页面，和 Cat Catch `search.js` 的方向一致。
- JSON 递归：已支持从 JSON 中扫描 URL、manifest、key 候选；相对 URL 会使用 response URL 作为 base。
- inline script 扫描：已补 m3u8/mp4/flv 的内联脚本扫描。

### HLS / DASH / Manifest

- HLS inline m3u8：已能生成 page-context blob resource。
- m3u8 baseUrl：已实现 Cat Catch 类似的 `joinBaseUrlTask` 思路，先缓存相对 m3u8，后续看到真实 media/manifest URL 时补发。
- HLS 引用：已解析 `EXT-X-KEY`、`EXT-X-MAP`、普通分片/子 playlist URI。
- DASH inline mpd：已能生成 manifest resource。
- MPD 引用：已解析 `BaseURL`、`Location`、`media`、`initialization`、`sourceURL`，并跳过 `$Number$` 这类模板 URL。
- MPD BaseURL：已让 `BaseURL` 参与后续相对分片 URL 解析。
- Vimeo playlist.json：已转换为 m3u8 master/stream manifest。

### Key 候选

- 已覆盖 base64 key、hex key、ArrayBuffer / TypedArray / DataView 16-byte key、重复扩展 key buffer。
- 已过滤全 0 base64 key、MP4 `ftyp` 头误报。
- HLS data URI key 已尝试进入 key 候选捕获。

### MSE 缓存捕获

- 已捕获 `MediaSource.addSourceBuffer` / `SourceBuffer.appendBuffer`。
- 已识别 audio/video stream。
- 已支持 MSE 流导出、清缓存、自动跳缓冲末尾、捕获完成后自动下载、去额外媒体头。
- 已打通本地 ffmpeg 合并音视频流，B 站 m4s 链路已跑通。

## 部分夺舍，优先补齐

### 1. m3u8 parser / downloader

Cat Catch 里这块很厚，主要在 `m3u8.html`、`js/m3u8.js`、`js/m3u8.downloader.js`。

OmniFlow 当前有 manifest 捕获、key 候选和 ffmpeg 合并基础，但还缺：

- m3u8 parser 的层级 playlist 展开。
- 多 variant / 多清晰度选择。
- `EXT-X-KEY` 下载、验证、替换、自定义 key。
- `EXT-X-MAP` 下载与解密处理。
- 下载范围：序号范围、时间范围 `HH:MM:SS`。
- 下载队列、并发线程、失败重试、重下失败项。
- 直播录制与直播结束处理。
- 估算大小、进度、速度、剩余时间。
- 只要音频、转码为 mp4、ffmpeg 转码参数。
- 边下边存 / 大文件分片写入。

建议顺序：

1. 先做一个 HLS parser service / demo，输入 m3u8 URL 或内联内容，输出 segments / keys / maps。
2. 接入已有 captured resource，能从资源列表选一个 manifest 送进 demo。
3. 再接下载队列与本地 ffmpeg。

### 2. mpd parser

Cat Catch 依赖 `lib/mpd-parser.min.js` 和 `js/mpd.js`。

OmniFlow 当前只做了 MPD 捕获与浅引用解析，还缺：

- MPD 解析为 audio/video representation。
- 视频轨 / 音频轨选择。
- init segment 和 media segment 的模板展开。
- SegmentTemplate / SegmentTimeline。
- headers / referer 透传到下载器。

建议：优先引入稳定 parser 或迁移最小解析器，不手写完整 DASH 规范。

### 3. key 验证体系

Cat Catch 的 m3u8 页面支持“疑似密钥验证真实 key”。

OmniFlow 当前只收集 key 候选，还缺：

- key 候选池与 manifest 关联。
- 用 m3u8 fragment 解密尝试验证 key。
- 自定义 key 输入/选择。
- key 格式展示：hex / base64。

建议先做内部 API：`manifest + keyCandidates -> verifiedKey?`，UI 后置。

### 4. 下载/外部工具

Cat Catch 覆盖多种出口：

- 浏览器下载。
- m3u8DL URL protocol。
- aria2 RPC。
- invoke 本地程序。
- 在线 ffmpeg。
- send2local。
- MQTT。

OmniFlow 当前更适合走 Electron 本地下载 / 本地 ffmpeg。未夺舍部分建议拆成外部工具适配层：

- command template / URL protocol：可迁。
- aria2：可迁。
- MQTT：暂缓/另议。
- send2local：如果 OmniFlow 后续需要自动化输出，可迁。

### 5. 规则过滤与黑白名单

Cat Catch 默认配置在 `js/init.js`，运行逻辑在 `js/background.js` / `js/function.js`。

已迁：

- 多数默认扩展名。
- m3u8/mpd/m4s 等关键 MIME。
- 基础 regex 筛选入口。

还缺：

- 默认 Regex 规则：爱奇艺 JSON、B 站直播 m4s 黑名单、Instagram/Facebook bytestart 规则等。
- `damnUrl` 全局屏蔽。
- 用户自定义 Ext / Type / Regex 的完整存储与启停。
- 黑名单资源去重和过滤状态。
- blockUrl / whitelist 模式。

建议：抽 `resourceCaptureRules`，不要塞回 probe。

## 未夺舍或暂缓项

### 录制类脚本

来源：`catch-script/recorder.js`、`recorder2.js`、`webrtc.js`。

当前未迁。它们更像录屏/录制能力，不是当前“资源嗅探 + 下载”主链。建议暂缓，独立立项。

### 媒体控制与截图

来源：`js/content-script.js`、`js/media-control.js`。

当前未迁。包括页面视频控制、截图、画中画、全屏等。建议暂缓，后续作为浏览器辅助工具独立做。

### JSON viewer

来源：`json.html`、`js/json.js`。

当前未迁。可用现有 UI 或调试工具替代，暂缓。

### MQTT

来源：`options.html`、`js/pupup-utils.js`、`js/preview.js`。

当前未迁。属于外部通知/推送能力，和资源夺舍主线不是一类。建议暂缓或作为外部输出适配。

## 测试 Demo 建议

正式 UI 先不定型，但为了后续测试，可以做一个轻量 debug/demo：

- 位置：嵌入浏览器资源面板内的折叠区，或单独 `/debug/cat-catch` 开发入口。
- 输入：当前捕获资源、m3u8/mpd URL、内联 manifest 文本、key 候选。
- 输出：
  - manifest 类型：HLS / DASH / Vimeo converted。
  - baseUrl 决策记录。
  - keys / maps / init segments / media segments。
  - headers / referer。
  - 可生成的下载任务 JSON。
  - 可生成的 ffmpeg / m3u8DL / aria2 命令预览。
- 原则：只服务测试，不作为正式交互方案。

## 下一批建议顺序

1. 补 `resourceCaptureRules`：默认 Regex / block / ext / MIME 规则。
2. 做 HLS parser service：m3u8 text/url -> playlists / keys / maps / segments。
3. 做 key 验证 API：manifest + key candidates -> verified key。
4. 做 MPD parser service：优先 SegmentTemplate / SegmentTimeline / Representation。
5. 做下载任务模型：manifest resource -> normalized download plan。
6. 做 debug/demo UI：仅用于验证，不锁正式 UI。
7. 再把正式 UI 和下载体验统一调整。

## 当前结论

按“当前产品需要的资源嗅探 + 缓存捕获 + 本地合并”算，已经约 `75%-80%`。

按“Cat Catch 功能全量夺舍”算，约 `60%-65%`。差距主要不在 probe 注入，而在：

- m3u8/downloader 的完整 parser + 下载器。
- MPD parser 的完整轨道/模板解析。
- key 验证与自定义 key。
- 规则过滤体系。
- 外部工具出口。
- recorder / webrtc / 媒体控制等外围能力。
