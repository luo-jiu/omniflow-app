# Archive Viewer 说明

更新时间：2026-09-25
适用范围：`src/features/archive-viewer/` 下的归档语义 viewer 和相关辅助能力。

## 1. 作用

`archive-viewer` 负责归档语义目录的预览，不替代普通 `file-viewer`。

它当前主要承接：

- `video_archive`
- `audio_archive`
- `asmr_archive`
- `comic_archive`
- `gallery_archive`

这些 viewer 与普通 `video`、`asmr`、`comic` viewer 的区别，不只是界面不同，还包括它们在工作区中的导航语义不同。

其中 `video_archive` 当前是独立的视频墙视图：

- 双击卡片打开普通 `video` viewer
- 通过 `returnTarget` 返回原视频归档页
- 卡片数据来自归档目录下的第一代视频单元：优先支持直属 `VIDEO` 文件夹，兼容历史直属视频媒体文件
- `VIDEO` 内置类型只允许设置到文件夹；文件夹卡片通过 `mediaNodeId` 打开内部主视频
- 封面优先走 `coverNodeId`，其次兼容文件夹内封面，最后用视频首帧预览兜底；归档页不全量扫描归档根目录来匹配历史同名封面
- 字幕作为伴随资源计数展示，不单独变成视频卡片

其中 `audio_archive` 当前是独立的音频归档视图：

- 归档页展示歌曲列表，不再复用视频卡片墙
- 单击歌曲行只选中，双击歌曲行或点击封面 hover 播放按钮才开始播放
- 底部播放器由 `globalAudioPlayer` 承担播放状态，支持上一首、下一首、顺序播放、列表循环、单曲循环和随机播放；音量复用普通音频 / ASMR 共用的 `MediaVolumeControl` 和本机持久化偏好
- 首次播放后会以当前归档 tab 注册到 `MediaRegistry`，因此工具栏媒体控制中心可以控制播放 / 暂停 / seek / 移除
- 点击底部封面会在归档页内进入完整播放视图，列表退场，只保留大封面、歌词和底部播放控制；再次点击底部封面可折叠回歌曲列表
- 完整播放视图在封面 / 歌词下方、底部控制栏上方显示随当前声音上下跳动的实时频谱；频率数据来自 `globalAudioPlayer` 唯一 Web Audio `AnalyserNode`，不下载或解码第二份完整音频。`45Hz～16kHz` 对数频带映射为覆盖 `0%～80%` 的浅色原波，同一组高度倒序镜像后以同色系深色覆盖 `20%～100%`，深色先绘制、浅色原波位于前层；有彩色封面时两档颜色从封面主色相衍生，无封面、封面近灰或取色失败时回退当前主题强调色；两层统一应用边缘约 `40%`、中心 `100%`、另一侧回到 `40%` 的平滑透明度渐变，每个波按自身进度首尾归零，因此原波在 `0%/80%`、镜像波在 `20%/100%` 均为零高度，组合外轮廓中心对称；柱体细密且柱顶连续，暂停后彻底清空，不横向滚动，不创建第二个出声实体，也不接管播放状态
- 底部进度条与频谱共用同一配色结果（有有效封面用封面色，否则用主题强调色）：从 `00:00` 一侧的深色渐变到当前位置的浅色，以圆角端帽代替圆点 thumb；透明原生 range 提供点击、拖拽和键盘 seek，调整期间只更新本地预览，放手或按键释放后才提交真实播放位置；底部不再提供打开普通音频 viewer 的按钮
- 卡片数据来自归档目录下的直属歌曲单元：优先支持直属 `AUDIO` 普通文件夹，兼容历史直属音频媒体文件
- 歌曲文件夹内第一个音频文件作为主媒体，第一个图片文件作为封面，字幕 / 歌词文件作为伴随资源候选；直属普通音频文件不要求单独设置 `builtInType = AUDIO`
- 从目录树双击普通 `AUDIO + archiveMode=0` 文件夹时，使用 `audio-folder://` 入口进入同一 viewer 的单歌曲模式：跳过归档分页，直接读取直属资源，默认展开大封面、歌词、频谱和底部控制栏，但不自动播放
- 裸音频文件保持 `fileType=audio`，但也进入同一展开播放器：直接使用文件 URL 和完整文件名，不读取封面或歌词，封面区域为空，歌词显示“暂无歌词”，左右按钮按 10 秒跳转
- 歌词支持 `.lrc / .srt / .vtt / .ass / .ssa / .qrc.xml`；其中 QQ 音乐 QRC XML 会解析字级时间轴，音乐归档展开页用可滚动歌词滚筒展示，当前句自动居中放大，点击歌词可跳转播放，高精度歌词会按真实播放时间平滑从左到右填色
- 音频归档页不全量扫描归档根目录来匹配历史同名封面 / 歌词；需要伴随资源时优先使用歌曲文件夹结构
- 音频归档 Warm snapshot 只保存稳定选中卡片和卡片墙锚点；播放 URL、歌词候选和卡片数组不进入 snapshot，播放事实继续以 `globalAudioPlayer` 为准
- 上级音频归档视图不会把直属 `AUDIO + archiveMode=1` 子目录展示为合集；这类下级归档可以存在，但不进入上级歌曲列表

其中 `comic_archive` 当前是漫画归档墙视图：

- 卡片数据只来自当前归档目录的直属一代子节点，不递归展开孙级
- 直属 `COMIC + archiveMode=0` 目录作为普通漫画卡片，双击进入 `ComicViewer`
- 直属 `COMIC + archiveMode=1` 目录作为“合集”卡片，双击进入该子目录的 `ComicArchiveViewer`
- 任何层级都遵守同一条规则，因此 `归档 -> 归档 -> 归档 -> 漫画` 会逐层进入，而不是在最上层一次性铺平
- 如果用户从目录树直接打开中间层归档，返回栈从该归档开始，不自动推断隐藏父级
- 从归档卡片进入子归档或普通漫画时，`returnTarget` 会携带当前归档；子归档再进入下一层时会继续串起上一级，顶部返回按钮按显式栈逐级返回

其中 `gallery_archive` 当前是图集归档视图：

- 卡片数据来自当前归档目录的直属一代 `GALLERY` 子目录，不递归铺平孙级内容。
- 直属 `GALLERY + archiveMode=0` 目录作为普通图集卡片，单击进入普通 `GalleryViewer`。
- 直属 `GALLERY + archiveMode=1` 目录作为下级图集归档卡片，单击进入下一层 `GalleryArchiveViewer`。
- 卡片进入视口附近后才读取该图集目录的一代图片 / 视频数量，并用第一张图片作为封面；如果第一张图片是 HEIC / HEIF，则复用 Electron 本地预览代理生成 PNG 封面。
- 从归档卡片进入子归档或普通图集时，`returnTarget` 会携带当前归档，返回链路与漫画归档保持同一套显式栈模型。

归档卡片右键中的“属性”必须走目录树同一套节点属性 overlay；卡片只提供节点 id 和标题，属性内容仍以 `fetchNodeDetailById` 等节点接口返回的真实数据为准。

### 悬浮信息与操作

卡片归档取消通栏 footer，统一复用 `components/ui/floating-viewer-dock.tsx` 的局部悬浮气泡：视频、ASMR、图集位于底部中央，显示类型图标、名称及既有计数；漫画归档位于右侧中央竖排，名称沿竖向展示，右侧保留 64px 避让卡片。底部气泡对应的滚动 surface 末尾保留 64px，最后一排卡片可以完整滚出气泡覆盖区域。气泡相对当前 viewer 定位，不使用页面级 fixed 或新增尺寸监听，原滚动容器、分页和锚点 owner 保留。

音频归档保留完整播放控制，将既有 `audio-player-bar` 改为底部居中的半透明播放器气泡，材质复用 `floating-viewer-dock-styles.ts`。它仍包含封面展开、上一首/播放/下一首、进度、时间、播放模式和音量；左右等宽区域让中央播放组保持几何居中。标题/艺术家为普通信息，只有42px封面按钮能展开/收起播放器，其提示遮罩只在封面悬停/聚焦时出现；文字区域不触发展开或整块悬停背景。

进度沿气泡上方边框描边，从左上圆角的侧端沿顶边到右上圆角的侧端，使用封面配色的渐变；轨道两端、已播放部分的起点和移动端均使用圆头。不再绘制框内直线或执行展开/下移动画，气泡最小高度76px、底距16px（窄版12px）保持稳定。显隐由 `isCurrentAudioSource && playerState.hasStarted` 直接派生，首次成功播放前隐藏且不可聚焦，暂停后保留。`AudioDockProgress` 只接收进度投影及seek回调，ResizeObserver仅在尺寸变化时更新圆弧几何，拖动时不逐帧读取布局；填充按完整弧长计算，0不留残色、100覆盖两端。鼠标热区仅沿边缘，按最近路径位置预览，松手提交，Escape/指针取消/失去捕获/尺寸变化取消；透明原生range保留键盘seek。换源key隔离未完成手势，不接管全局播放状态。播放中的可见边框进度通过现有播放器只读快照采样真实media时钟，按弧长/时长对应的像素速度自适应4～60Hz；不足0.15px不额外写SVG，仅更新填充偏移和渐变端点，不逐帧setState或发播放状态事件。暂停、seek预览、隐藏、切走、来源失配与流星阶段停止采样；卡缓冲时跟真实时钟停住，不凭墙钟预测继续走。

自动续播成功后，音频归档气泡执行约1.05秒的流星过渡：亮点从当前进度端点立即向前沿边框运动，旧进度从首帧即成为整条渐隐大拖尾；拖尾在前220ms随头部一起向前移动并快速缩短到常规流星长度，不再先静止收拢。上轨道与右侧、底部圆角和下边框、左侧合成连续路径，24段拖尾保留亮头与衰减尾迹，950ms回到起点，末100ms淡出后重新显示真实的新曲进度。颜色起于旧歌曲配色，并在绕行途中用260ms过渡跟随下一首配色（包括异步封面取色），不延迟新曲播放。

流星事件只由`useAudioCardPlayback`经过现有request gate确认的自动播放成功结果发出；列表下一首、列表回环、随机和单曲重播共用该路径，自动重播明确seek到0。手动切歌/seek、播放失败、旧请求和顺序模式列表结束不触发。`AudioDockMeteor`仅保存一次视觉事件，不增加媒体owner、持久化状态或播放timer。暂停、失去来源、隐藏/切走、尺寸变化、减少动态效果以及卸载均取消；正常播放与键盘seek不被遮挡，seek会取消视觉事件。动画只在短时RAF里更新固定数量SVG属性，不逐帧setState或读布局；封面色晚于动画完成才返回时，按正常配色更新后续进度，不等待封面而拖慢播放。

按钮常态透明，悬停/按下显示底色，播放状态使用图标前景表达。按实际viewer容器宽度在760px/440px换行，列表和展开歌词/频谱区对应保留128/148/220px底部空间。上述气泡只对 `viewerMode='archive'` 生效；裸音频和普通音频文件夹继续使用原布局与展开行为。播放及媒体注册仍归 `globalAudioPlayer`，不增加播放状态副本。

## 2. 当前结构

- `components/video-archive-viewer/`
- 音频归档的列表与展开播放器由 `../audio-viewer/components/unified-audio-viewer/` 统一编排；`archive-viewer` 不再保留普通音频也要反向依赖的实现目录
- `components/asmr-archive-viewer/`
- `components/comic-archive-viewer/`
- `components/gallery-archive-viewer/`
- `hooks/useArchiveCardGrid.ts`
- `utils/archive-sort.ts`

四类卡片网格（视频、ASMR、漫画、图集）的自适应列数和卡片宽度完全由 CSS Grid 计算。`useArchiveCardGrid` 只返回稳定的最小列宽、间距变量和滚动容器 ref，不监听尺寸、不读取布局、不在拖拽中更新 React 状态；因此保活的隐藏归档页也不会因侧栏逐像素变化重新渲染全部卡片。保留 auto-fill 空列及末行对齐，滚动锚点、分页和封面懒加载仍由各 viewer 原有 owner 负责。 ASMR 归档卡片的封面容器保持固定比例并由图片完整填充，图片不会因卡片 flex 布局露出底色空带。

五类归档 viewer 都通过公共 Viewer Session Registry 保存最小阅读现场。卡片数组、分页响应、计数和临时封面/媒体链接始终重新请求；snapshot 只保存稳定卡片锚点、锚点内偏移、整体滚动比例、绝对滚动兜底，以及 Audio Archive 的稳定选择。刷新通过公共 reload generation 精确失效旧 snapshot，不再维护逐 viewer cache key。

Comic Archive 和 ASMR Archive 还会把语义阅读位置写入 `viewMeta`。同进程命中 Warm 时以 Warm 为准；未命中时才采用远端位置。恢复会继续分页直到锚点出现，锚点删除后按比例和绝对位置降级。分页更新不能改变 session adapter 引用，否则会重复注册并把用户拉回旧位置。

`components/comic-archive-viewer/index.tsx` 只保留页面编排、加载和渲染；新增或修改漫画归档卡片类型、DTO 映射、返回栈导航或阅读位置解析时，优先维护同目录下的 `comic-archive-card-mapper.ts`、`useComicArchiveNavigation.ts` 和 `comic-archive-progress.ts`，不要继续把规则堆回主组件。

## 3. 阅读顺序

建议按这个顺序读：

1. `../file-viewer/components/file-dispatcher/index.tsx`
2. `components/video-archive-viewer/`
3. `components/asmr-archive-viewer/`
4. `components/comic-archive-viewer/`
5. `components/gallery-archive-viewer/`
6. `../../views/library/detail/index.tsx`
   - 关注归档返回链路

## 4. 何时继续细分文档

如果后续某个归档 viewer 出现：

- 独立卡片布局规则
- 排序、筛选、搜索、分页
- 媒体回放状态机
- 明显不同于普通 viewer 的导航和交互

就应该在 `docs/viewers/` 下继续补对应 viewer 文档，而不是继续把所有解释都堆在一份总文档里。

当前如果 `video_archive` 后续继续膨胀，最适合先拆出的子文档方向会是：

- `docs/viewers/video-archive-viewer.md`
- 重点记录卡片来源、封面策略、返回链路和批量操作

## 5. 相关文档

- `docs/viewers/README.md`
- `docs/file-viewer-and-archive-viewer-map.md`
- `docs/built-in-type-and-archive-mode.md`
- `docs/file-explorer-file-viewer-boundary.md`
- `docs/viewers/video-archive-viewer.md`
