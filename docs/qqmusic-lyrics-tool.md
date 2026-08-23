# QQ 音乐歌词工具

更新时间：2026-08-23

## 1. 目标

工具区的 `QQ 音乐歌词` 在 macOS 客户端内只读 QQMusicMac 本地曲库和歌词缓存，预览主 QRC 的逐字时间，确认后把解密 XML 保存到当前 OmniFlow 资料库/MinIO。Go 后端不访问用户电脑，也不代理 QQ 音乐。

## 2. 数据流

```text
renderer 搜索
  -> window.electronQQMusicLyrics
  -> 主窗口 main-frame IPC 校验
  -> readonly qqmusic.sqlite / rrdbcache.sqlite
  -> binary plist 解包
  -> smart-lyric 内存解密
  -> renderer timed-text 逐字预览
  -> createStagedTextFile
  -> /v1/directory/upload (auto_rename)
  -> MinIO
  -> cleanupStagedTextFile
```

QQMusicMac 数据库路径：

```text
~/Library/Containers/com.tencent.QQMusicMac/Data/Library/Application Support/QQMusicMac/qqmusic.sqlite
~/Library/Containers/com.tencent.QQMusicMac/Data/Library/Application Support/QQMusicMac/iRRCache/rrdbcache.sqlite
```

两库始终以 SQLite `OPEN_READONLY` 打开，每次操作完成后关闭连接。不写回 QQ 音乐，不读取 Cookie、账号、Keychain 或网络接口。

## 3. 缓存与解码

搜索从 `SONGS` 读取 `id / K_SONG_RESERVE1 / name / singer`，再批量检查 Cache keys：

- `<SongID>.qrc`
- `<SongID>.lrc`
- `<SongID>_trans.lrc`
- `<SongID>_yinyi.lrc`

预览只读取 `<SongID>.qrc`。`Cache.data` 可能是 `bplist00` archive，其 `$objects[1]` 是 hex 或二进制 payload；解包后由 ISC 许可的 `smart-lyric@1.0.4` 解密为 XML。第一版不解析 translation/yinyi 的不透明二进制内容。

真实 QRC 逐字格式是：

```text
[lineStart,lineDuration]文字(wordStart,wordDuration)下一词(wordStart,wordDuration)
```

时间标记属于标记前的文字。timed-text parser 必须保留首词、末词和没有标记的尾随文本。

## 4. IPC 契约

Bridge：`window.electronQQMusicLyrics`

- `status()`：返回平台、支持状态、两个数据库路径与存在性。
- `search({ query, singer, limit, offset, cachedOnly })`：返回歌曲和缓存种类，输入使用参数化 SQL，limit 限制为 `1..50`，offset 最大为 `100000`，超过上限明确返回 `INVALID_REQUEST`，不得钳位后重复上一页；`cachedOnly=true` 时按歌词缓存最近访问顺序只返回已有主 QRC 的歌曲，并通过 offset 分页。列表查询只读取缓存 key、size 和数据库侧 `length(data)`，不把 QRC/LRC BLOB 载入内存；只有预览指定歌曲时才读取对应 QRC payload。
- `preview(songId)`：返回歌曲、安全文件名和解密后的 `qrcXml`。

`search/preview` 使用 `{ ok, data | error }`，错误码包括：

- `UNSUPPORTED_PLATFORM`
- `LIBRARY_DATABASE_MISSING`
- `CACHE_DATABASE_MISSING`
- `DATABASE_READ_FAILED`
- `INVALID_REQUEST`
- `SONG_NOT_FOUND`
- `CACHE_ENTRY_MISSING`
- `PLIST_DECODE_FAILED`
- `QRC_DECODE_FAILED`

IPC 只允许主窗口 `webContents.mainFrame`。Overlay、独立媒体窗口和子 frame 不得访问本机 QQ 音乐数据。

## 5. Renderer 与保存

Renderer 拥有搜索条件、候选列表、当前预览、模拟播放时间、逐字高亮和保存中状态。工具打开后默认加载“本地已有”，每页 50 首并可继续加载；用户可以切换到“全部曲库”查找尚未缓存的歌曲，两种范围都支持歌曲名和歌手过滤。歌曲名搜索框不放装饰性音乐图标，避免压缩可输入空间；工具导航中的 QQ 音乐图标固定使用 `#ec4141`，在展开、折叠、选中和未选中状态下保持识别色。缓存仍存在但曲库元数据已清理时，列表使用 SongID 和未知歌手占位，预览与保存仍可继续。预览复用音乐播放器的 timed-text 焦点行和连续扫色计算，按 QRC 时间片内部进度从左到右推进，不按整词瞬时切换颜色；句间空隙聚焦下一句。歌曲结果和非活动歌词行使用稳定局部渲染边界，播放帧只更新当前扫色、时间控件和焦点变化涉及的行，不整批重渲染歌曲按钮与全部歌词 DOM。搜索和预览分别使用单调请求序号，新搜索会同步废弃旧预览请求，旧响应不得覆盖后一次搜索、选歌或 loading 状态。Renderer 不拥有数据库连接或 QRC 密钥。

歌曲列表与预览之间使用独立竖向分隔线，只有边界中心 `6px` 是命中区。常规工作区允许在 `260px～34%` 间调整，紧凑工作区允许在 `220px～40%` 间调整；初始百分比宽度同时是当前最大宽度。pointer capture、拖拽预览和结束清理都由歌词工具局部持有，移动期间通过 `requestAnimationFrame` 只更新布局 CSS 变量，松手才提交 React 宽度；方向键和 `Home / End` 提供等价键盘操作。它与外层工具导航、资料库目录树共用带 token 所有权的文档拖拽样式协调器，任何一个结束都不能清除另一个仍然有效的拖拽状态。

预览标题栏只保留一个中圆角保存图标，不在底部常驻文件名、Provider 或目标目录表单。刷新、搜索、保存和播放等单图标操作复用 AI 服务配置的行内操作反馈：常态透明且图标使用弱文本色，悬停时只切换为正文色和清晰的中圆角中性底色，不使用外投影或位移；必要说明使用浏览器原生 `title`，播放进度不显示悬浮时间提示。进度控件复用音乐播放器的无圆点渐变轨道，透明原生 `range` 继续承担点击、拖拽和键盘定位。点击保存后打开紧凑弹窗，弹窗内可修改文件名、打开资料库目录选择器并选择 storage provider；每次打开弹窗都重新选中后端默认 Provider，也允许只针对本次歌词保存切换 Provider，保存成功不把该选择带入下一次。目录选择器确认后立即把目录按 `libraryId` 写入本机 `localStorage`，本次取消保存也不撤销用户刚设置的默认目录；不同资料库互不共享。保存前通过节点详情确认目标仍是当前资料库的目录；节点不存在、类型变化、资料库不匹配或无法确认时清除旧偏好，回退到当前目录或资料库根目录并要求用户再次确认，不直接向未经确认的回退目录上传。保存失败时弹窗保留当前草稿，便于切换 Provider 后重试。保存目标优先级：

1. 当前资料库上次确认的保存目录。
2. 当前选中目录。
3. 当前选中文件父目录。
4. 当前资料库根目录。

紧凑信息层级不再使用 `9px/10px` 关键文字：歌曲标题为 `13px`，歌手、SongID、范围计数、状态、标题说明、时间戳和播放时间至少为 `12px`，时间轴歌词为 `13px`；目录选择器的面包屑、节点名称和行尾操作也至少为 `12px`。对应的结果行、歌词行、时间列、播放栏和目录行同步增高或加宽，长歌手、SongID 和毫秒时间不应与相邻内容重叠。文件名默认是 `<歌曲> - <歌手> [SongID].qrc.xml`。非法本地文件名字符替换为 `_`，main 按 UTF-8 字节限制文件名并保留扩展名；renderer 保存时保证 `.qrc.xml` 后缀。上传复用字幕工具的 staged text helper，文件信息校验只接受通用临时导入根目录或文本 staging 根目录，冲突策略固定为 `auto_rename`，并把本次选择的 provider alias 透传到直传 init；上传成功或失败后均清理 staging 文件。

## 6. 验证

- QRC parser 的真实尾随时间标记和历史前置时间标记单测。
- 临时 SQLite 的普通搜索、本地已有列表和解密服务测试；需要当前 Node/Electron 可加载 `sqlite3` N-API 二进制。
- `npm run lint`、`npm test`、`npm run build`。
- macOS 真机使用非第一个资料库，确认打开工具自动列出本地已有 QRC；搜索并快速切换至少两首缓存歌曲，检查无前缀图标的歌曲搜索框、红色工具导航图标、首词/末词、seek/play/pause、连续扫色、无圆点渐变进度、关键文字字号和对齐、标题栏保存弹窗、可选择且可记忆的保存目录、显式 Provider 保存和目录刷新。
- 把歌曲列表拖到最小/最大宽度并验证方向键、`Home / End`；播放歌词期间连续交替拖动目录树、工具导航和歌曲列表，再快速折叠/展开目录树与工具导航，确认三个窄命中区互不抢事件且没有卡顿、文本误选或残留拖动光标。
- Windows/Linux 或无数据库环境验证明确不可用状态。
