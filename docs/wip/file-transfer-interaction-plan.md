# 文件跨界交互临时开发方案

状态：WIP / Phase 1 实施中

更新时间：2026-08-17

适用范围：本地文件系统、文件目录树、内置浏览器 `WebContentsView` 三者之间的文件拖拽、下载、上传与临时文件管理。

## 1. 目标

最终支持以下六条路径：

1. 本地文件拖入目录树，上传到指定目录。
2. 本地文件拖入内置浏览器：已打开网页时交给网页上传区；浏览器空白区域负责打开文件。
3. 目录树文件拖到 Finder / Explorer / 桌面，导出为本地文件。
4. 目录树文件拖入内置浏览器，行为与本地文件拖入浏览器一致。
5. 内置浏览器里的真实文件或可下载资源拖到本地。
6. 内置浏览器里的真实文件或可下载资源拖入目录树并上传。

这六条路径不分别实现六套传输逻辑。统一模型应为：

```text
识别来源
  -> 解析为传输候选
    -> 必要时暂存为真实本地文件
      -> 交付到桌面 / 网页 / 上传中心
```

## 2. 测试约束

- 任何开发、调试、验证和截图都禁止使用第一个资料库。
- `Win` 资料库可用时优先使用 `Win` 资料库。
- 当前公司环境只能使用本机 macOS 的 MinIO；家中 Windows MinIO 不可达时，资料库验证使用 macOS 上的非第一个资料库。
- 调研和基础链路测试优先使用中性的 `.txt`、`.json` 和程序生成的小图片，不使用个人音视频资料。
- 跨视图原生拖拽必须分别在 Windows 和 macOS 验证，不能用一个平台的结果推断另一个平台。

## 3. Chrome 与 Electron 的行为边界

### 3.1 文件拖入网页

Chrome 的标准网页行为是：

- 网页在 `dragover` 中调用 `preventDefault()` 后才能成为有效放置目标。
- 网页在 `drop` 中通过 `DataTransfer.files/items` 取得用户拖入的 `File`。
- 浏览器只负责把文件交给网页，是否读取和上传由网页决定。
- 网页脚本不能直接给 `<input type="file">` 写入本地路径。
- 页面收到 `drop` 不等于服务器上传成功，宿主应用无法据此做“上传失败后自动打开”的可靠回退。

OmniFlow 的内置浏览器使用独立的 `WebContentsView`。当前没有启用 `navigateOnDragDrop`，Electron 默认值也是 `false`。因此网页没有接收文件时，不应依赖浏览器自动导航到本地文件。

产品语义暂定为：

- 拖到已打开网页：只交给网页，不隐式替换当前页面。
- 拖到浏览器空白页、标签栏或明确的文件打开区域：在新标签打开文件。
- 网页未接受文件：给出无操作反馈，不把它误报为上传成功。

### 3.2 网页内容拖出

网页里“看起来像文件”的内容并不一定是文件：

- 文件输入或网页生成的 `File`：可能提供真实文件项。
- `<img>`：通常提供 `text/html` 和图片 URL，不一定提供文件字节。
- `<a>`：通常只是 URL；拖到桌面可能生成网址快捷方式。
- `blob:`：只在原页面和对应生命周期内有效，Node 侧不能把它当普通 URL 下载。
- `data:`：可以解码，但必须限制体积和 MIME。
- Canvas、CSS 背景图：可能没有原生可拖拽资源。
- 登录态或防盗链资源：只有 URL 不够，需要浏览器 Cookie、Referer 或捕获到的请求头。

所以所有浏览器来源必须先分类，不能把任意 URL 都当作可上传文件。

## 4. 当前能力与问题

### 4.1 已有能力

- 本地文件拖入目录树已接入上传确认与上传中心。
- 目录树右键“下载”已支持文件和目录递归导出。
- 目录树右键“在浏览器打开”已支持按后缀映射网站，并把库内文件暂存后注入网页。
- 内置浏览器的 `will-download` 已统一暂存下载结果，可保存到本地或导入资料库。
- 目录树可从外部拖拽数据中解析部分网页图片 URL，再下载并上传。

### 4.2 “内置浏览器 -> 目录树”不稳定的原因

当前链路存在以下结构性问题：

1. 触发条件过宽。
   `hasExternalUploadData()` 只要看到 `Files`、`text/html` 或 `text/uri-list` 就认为可能上传。普通链接和大量不可下载内容也会触发目录树反馈。

2. 实际解析能力过窄。
   当前只解析 HTML 中的 `<img src>`，或者带常见图片后缀的 URI。`srcset`、懒加载属性、CSS 背景、无后缀签名 URL、`blob:` 等不会稳定命中。

3. 跨原生视图时事件信息不稳定。
   网页位于独立 `WebContentsView`，目录树位于 renderer DOM。指针跨过两块原生表面后，目录树拿到的 `DataTransfer.types`、事件进入顺序和 `relatedTarget` 必须实机验证，不能假定等同于普通 DOM 内拖拽。

4. 目录目标依赖坐标猜测。
   当前通过鼠标 `clientY` 匹配可见树行，并保留 500ms、28px 范围内的旧命中作为回退。这能容忍事件抖动，也会造成用户感觉“明明放在这里却传到了别处”。

5. 下载链路不继承完整浏览器会话。
   网页图片下载目前主要补充 User-Agent 和 Referer，没有自动复用内置浏览器 partition 的 Cookie。登录态图片、防盗链资源和临时授权 URL 容易失败。

6. 成功语义不准确。
   现有网页文件注入找不到真实文件输入框时会创建隐藏输入框。文件成功写入隐藏输入框，只能证明 CDP 设置成功，不能证明网页识别或上传成功。

## 5. 统一传输模型

### 5.1 传输来源

建议定义统一但不泄漏本地路径给 renderer 的来源模型：

```ts
type TransferSource =
  | { kind: 'local-file'; token: string }
  | { kind: 'library-node'; libraryId: number; nodeId: number; revision?: string }
  | { kind: 'browser-download'; downloadId: string }
  | { kind: 'browser-resource'; tabId: string; resourceId: string }
  | { kind: 'browser-page-drag'; tabId: string; dragSessionId: string }
```

renderer 只传递 token 和业务标识。文件绝对路径、Cookie、临时目录和清理责任留在 Electron main。

### 5.2 暂存产物

```ts
type StagedArtifact = {
  token: string
  fileName: string
  mimeType?: string
  size: number
  expiresAt: number
}
```

main 内部另外持有真实绝对路径，不通过通用 UI 状态持久化。

暂存缓存键建议包含：

- account scope
- library id / node id
- content revision 或 ETag
- 文件名与大小

必须具备：并发去重、取消、进度、容量上限、TTL、应用退出清理和异常残留清理。

### 5.3 交付目标

- `desktop-file-export`：单个资料库文件通过短 TTL loopback `DownloadURL` 流式导出；目录与多选暂不支持。
- `browser-page-drop`：把真实文件交给活动网页的原生拖放目标。
- `browser-open`：在受控的新标签中打开暂存文件。
- `library-upload`：复用 `UploadManager`，不另建上传状态机。

## 6. 浏览器拖入目录树的重做方案

这条链路采用“标准拖拽数据 + 页内来源会话”双通道，不再只依赖目录树最后拿到的字符串。

### 6.1 浏览器侧来源会话

在活动页面记录一次短生命周期的拖拽来源会话：

- tab id 和 page URL
- 来源元素类型：image / link / file / unknown
- `currentSrc`、`src`、`href`、`download`、可识别 MIME
- 捕获资源列表中是否存在同 URL 请求
- 是否为 `blob:` / `data:`
- 创建时间和一次性 session id

它只记录解析所需元数据，不记录页面输入内容、文件正文或大块 HTML。

### 6.2 目录树接收

目录树收到跨界 `dragenter` 后：

1. 读取标准 `DataTransfer` 的类型，但不立即宣告“可上传”。
2. 查询 main 中当前活动 tab 的短生命周期拖拽会话。
3. 两路信息合并后得到置信度明确的候选。
4. 只有候选可解析时才显示复制光标和目录高亮。
5. 放在文件行上时明确显示“上传到父目录 X”，不能只高亮文件行。
6. 空白区域是否指向根目录需要做成固定规则，不使用旧坐标猜测。
7. 归档目录继续禁止直接拖拽上传。

旧的 500ms 坐标回退不作为最终目标选择依据。事件抖动应通过稳定的 row hit-test 和拖拽会话解决。

### 6.3 来源解析优先级

1. `DataTransfer.files` 中的真实文件。
2. 已完成的内置浏览器下载暂存文件。
3. 捕获面板中已有、带完整请求头的资源。
4. 页面拖拽会话中的普通 HTTP(S) 图片或下载链接。
5. `blob:` 通过原页面桥接读取并限额暂存。
6. `data:` 在体积和 MIME 校验后解码。
7. 无法确认是文件的普通链接拒绝上传，可另行提供“保存网址”能力，但不混进文件上传。

### 6.4 下载与鉴权

浏览器资源下载应优先复用 embedded browser partition 的会话能力，而不是普通 Node HTTP 请求。

至少需要保留：

- Cookie
- Referer / Origin
- User-Agent
- 捕获到的必要请求头
- 重定向后的最终 URL

同时限制协议、重定向次数、单文件大小、总暂存配额和私有地址访问，避免任意 URL 导入变成本机 SSRF 入口。

## 7. 目录树拖出约束

资料库节点本身不是本地文件。当前单文件导出不再先暂存到本地，也不调用
`webContents.startDrag()`；renderer 在原有 HTML5 `dragstart` 中同步写入短 TTL loopback
`DownloadURL`，Finder / Explorer 放下后再由 main 取得签名链接并流式转发文件内容。

已冻结的交互约束：

- 用户直接拖动文件名，不增加独立拖拽手柄。
- 不向用户暴露单独的“准备文件”步骤，也不要求重复拖动。
- 文件和目录在树内的现有移动行为优先级高于系统导出，任何方案都不得接管或破坏它。
- 目录第一版不直接支持原生拖出；后续选择“暂存完整目录”或“打包为 zip”，需要单独确认。

目录树内部移动与系统拖出共用同一个 HTML5 手势：

- 树内移动继续由现有 Semi Tree DnD 唯一处理，不切换到第二套原生手势。
- 单文件单选时额外附加 `DownloadURL`；目录和多选不附加。
- 树内 drop 不解析 `DownloadURL`，仍走原移动链路；拖到 Finder / Explorer 时由系统兑现文件。
- `dragstart` 写入承诺后立即异步获取签名链接但不下载正文，本地 broker 最多等待 30 秒；
  用户仍只有一次拖拽，不暴露准备步骤。

## 8. 分阶段实施

### Phase 0：行为原型（macOS 已完成，Windows 待验证）

- 建立本地中性测试页：文件输入框、标准 dropzone、拒绝 drop 区域、iframe、Shadow DOM。
- 使用中性测试文件；独立原型不连接资料库，进入业务验证后遵守本文件第 2 节的资料库约束。
- 验证 macOS / Windows 下 `WebContentsView -> renderer` 的拖拽事件和数据类型。
- 验证 renderer `startDrag()` 到桌面、到活动 `WebContentsView`、再返回目录树的行为。
- 原型不接真实业务上传，只输出结构化诊断结果。

当前实验入口：

```bash
npm run dev:drag-drop-lab
```

实验代码位于 `tools/drag-drop-lab/`，与正式应用路由、后端和资料库隔离。

当前验证状态：

- macOS 隐藏窗口自动冒烟已通过：host、preload bridge、`WebContentsView`、标准 dropzone、自定义拖拽来源和 Blob 夹具均能加载。
- 自动冒烟不模拟操作系统指针拖拽，因此跨视图事件顺序、DataTransfer 保留情况和原生文件拖出仍属于人工待验证项。
- macOS 人工验证发现，实验台的真实文件卡片如果同时保留 HTML5 `draggable` 和
  `webContents.startDrag()`，会叠加两层拖拽会话；原生拖拽结束后下一次按钮点击会被
  吞掉。实验台现已在启动 Electron 原生拖拽前取消 renderer 拖拽，并在窗口级别清理
  跨 `WebContentsView` 的临时拖拽状态。这个结论也适用于正式实现：内部跨视图传输
  不能让 HTML5 和 OS 原生拖拽同时处于活动状态。
- macOS 原生拖拽会显示系统拖拽图标，并在右下角显示文件数量；拖拽会话位于所有
  应用窗口之上，最终由鼠标释放位置下的应用接收。实验台拖到 Chrome、Finder 或桌面
  属于验证 OS 级文件导出，不代表 OmniFlow 已经完成网页上传、目录树上传或浏览器
  会话注入。
- 当前阶段只完成隔离实验台、事件记录和原生拖拽行为验证；六条正式业务路径尚未
  全部落地，尤其是浏览器网页上传判断、资源暂存、鉴权下载、目录树上传和失败反馈。
- Windows 尚未验证；Windows MinIO 是否可达不影响本实验台，但正式业务链路仍需回家后在 Windows 环境验证。
- Chromium 私有 `DownloadURL` 已在当前 Electron/macOS 实机拖到 Finder 成功，Finder 能生成
  `omniflow-download-url-sample.txt`。该结论允许正式目录树采用同一 HTML5 手势附加下载承诺，
  不再评估 `startDrag()` 中途切换路线。

### Phase 1：传输中枢与目录树导出

- 定义 transfer source、artifact、session 状态机。
- 建立受控暂存目录、缓存、进度和清理。
- 完成单文件“目录树 -> 本地”的 `DownloadURL` 导出能力，并保持目录树 UI 的原有移动手势。
- 不改浏览器资源捕捉主链。

当前进度：已完成目录树正式使用的 renderer/preload 最小 claim 契约和
`FileTransferDownloadUrlBroker`。目录树单文件导出使用只监听 `127.0.0.1` 的随机端口、运行期随机
token 和短 TTL claim，放下后直接流式转发签名 URL，不提前写入临时目录。

通用 `FileTransferCoordinator`、artifact store、buffer/URL staging IPC 当前没有业务调用方，且取消、
来源身份、URL allowlist、配额并发和退出清理都必须由具体目标共同定义，因此不提前作为 preload
公开契约保留。后续首次需要真实本地暂存文件时，按实际来源和目标重新落地并补齐状态机测试。

实测证明，在 Semi Tree 文件节点的 `dragstart` 中直接调用 `webContents.startDrag()` 会接管
同一个手势，导致现有文件/目录树内移动中断；即使先悬停预热，暂存状态与 HTML5 拖拽状态
仍然会形成竞争。该接入已撤回，禁止再次从 Semi `dragstart` 启动原生导出。

pointer coordinator 路线也已在 macOS 实机证伪：文件行可以由 `pointerdown` 单独接管，
跨出目录树后也能完成 artifact 暂存并向 main 发送 `native-start`；但指针越出应用后 renderer
会失去 pointer 会话，且脱离 Chromium `dragstart` 调用 `webContents.startDrag()` 无法建立
Finder 可接收的系统拖拽。若保留 Semi `dragstart`，两套会话又会竞争；若阻止 Semi
`dragstart`，系统拖拽仍不会启动。因此该实验代码与诊断日志均已撤回，目录树恢复纯 Semi
DnD。两条失败路线的 IPC、平台 adapter 和 UI 诊断代码均已删除，禁止恢复。

后续不得重复尝试“HTML5 drag 中途切换”或“pointer 越界后调用 startDrag”。在不接受独立
手柄、修饰键或第二次拖动的产品约束下，需要评估真正的平台能力：macOS file promise / File
Provider、Windows virtual file / Cloud Files，或让资料库文件先通过同步目录成为真实本地文件。
这些方案属于原生平台集成，需单独立项，不能继续堆在 Semi Tree 事件层。

Chromium 私有 `DownloadURL` 隔离实验已在 macOS Finder 通过，正式目录树现已按相同格式接入。
正式实现与实验台的区别是：实验台直接提供中性文件，正式实现先暴露随机 loopback claim，
renderer 在同一次拖拽中异步取得资料库签名链接，Finder 请求到达后由 main 流式转发。2026-08-17 已使用
macOS 非第一个资料库完成正式链路实测，文件成功出现在 Finder；树内移动仍保持原行为。
Windows Explorer 尚未实测，右键下载继续作为所有平台的稳定兜底。

### Phase 2：本地 / 目录树 -> 浏览器

- 已打开网页使用真实文件拖放语义。
- 空白页和明确打开区域负责打开文件。
- 保留“按后缀映射网站打开”作为显式命令，不作为拖放失败回退。
- 明确网页接收、未接收和无法判定三种结果。

## 9. 实现前必须冻结的架构决策

实验台不是正式实现。长期目标采用“两条传输平面 + 一个按需落地的传输中枢”的结构，避免把
临时事件处理逐步堆成补丁；当前只实现目录树单文件导出所需的桌面导出平面：

1. **应用内语义拖拽**：目录树、浏览器宿主、工具区之间只传递一次性 transfer token、
   来源类型和候选元数据，不传绝对路径，不把任意 `text/html` / URL 当成文件。
2. **桌面文件导出**：目录树单文件使用原有 HTML5 手势附加 `DownloadURL`，由 main 的
   loopback broker 在 drop 后流式转发；不得再从该手势调用 `webContents.startDrag()`。
   后续若其他来源必须先生成真实文件，也只能由独立目标能力使用 artifact store。
3. **Transfer Coordinator（未来 main owner）**：首次出现真实暂存调用方时，再统一管理 session、
   候选解析、暂存、目标能力、取消、超时、清理和结果回报；在此之前不向 preload 暴露空置的
   begin/stage/complete 契约。renderer 仍不得自行拼接上传、下载和浏览器注入逻辑。

正式实现必须满足以下门槛后才接入目录树和浏览器页面：

- 每个拖拽手势只有一个 owner 和一个 session id；内部拖拽与 OS 拖拽不能重叠。
- 浏览器来源先分类为真实 `File`、已暂存下载、可鉴权资源、`blob:` / `data:` 或普通链接，
  普通链接不能被误报为文件上传。
- 所有真实临时产物由 main 进程持有路径并负责 TTL、容量、取消和退出清理；流式导出 claim
  同样由 main 持有，renderer 只得到 loopback origin、运行期 token 和 claim id。
- 网页是否接受 drop 不能靠猜测；未接受时不自动导航、不伪报上传成功，给出明确结果。
- macOS 和 Windows 分别有平台适配与手工验证记录，不能用一个平台的拖拽结果推断另一个。
- 关键路径覆盖成功、拒绝、取消、跨窗口、重复拖拽、页面刷新、登录态资源和超大文件。

目录树正式实现复用的是实验验证过的 `DownloadURL` 平台事实，不复制实验页面代码。loopback
broker 和 renderer service 分层持有各自状态，目录树只负责给当前手势附加声明并异步解析资料库
签名链接。

## 10. macOS / Windows 统一性结论

正式六条链路从第一天就按 macOS 与 Windows 的共同模型设计，不采用“先完成 macOS，
之后再补 Windows”的业务方案：

- transfer session、artifact、来源分类、目标能力、上传状态、取消与清理全部是跨平台
  的业务层契约。
- renderer 与 `WebContentsView` 的网页交互遵循 Chromium 标准 `DataTransfer` / `FileList`
  语义；不把 macOS 的事件顺序或坐标行为写进业务判断。
- 目录树导出依赖 Chromium `DownloadURL` 和 loopback HTTP，业务代码不分叉 macOS / Windows；
  是否能被 Finder / Explorer 兑现必须分别实测。
- `webContents.startDrag()` 不再用于目录树导出，已删除的 `PlatformDragAdapter` 不得作为
  手势补丁恢复；确实需要真实暂存文件的后续目标继续使用 artifact store。
- Windows 不能使用本机 MinIO 作为前提。传输架构与资料库 provider 解耦，Windows 验证
  可以使用远程后端和中性本地夹具；真正接入资料库时再按环境选择可达的 provider。

在 Windows 实机完成 `DownloadURL` 拖出、Explorer 拖入、WebContentsView 跨视图拖放、取消与重复
拖拽验证之前，不把该功能标记为正式稳定版。也就是说，设计目标是双平台一致，当前
实现状态是 macOS 正式链路已通过实机回归、Windows 待验证。

### Phase 3：浏览器 -> 目录树

- 先支持真实 File 和普通 HTTP(S) 图片。
- 接入页内拖拽来源会话与稳定目录命中。
- 下载时复用浏览器会话与捕获请求头。
- 再处理 `blob:`、`data:` 和通用下载资源。

### Phase 4：浏览器 -> 本地与增强能力

- 为捕获资源和已完成下载提供可靠原生拖出。
- 增加多文件、失败重试、缓存配额与批量清理。
- 评估目录拖出、虚拟文件和大文件体验。

## 11. 验收门槛

每条路径都至少验证：

- 单文件成功
- 目标拒绝
- 用户取消
- 文件名冲突
- 签名链接或 loopback 流式转发失败
- 登录态资源
- 大文件、Range 请求与中途取消
- 拖拽中切换 tab / 资料库
- 应用退出后的临时文件清理

浏览器到目录树额外验证：

- 普通图片、无后缀图片 URL、懒加载图片
- 普通链接不会误触发上传
- `blob:` 和 `data:` 有明确支持或拒绝反馈
- 指针悬停文件行时目标目录表达准确
- 快速进入/离开目录树不会沿用上一次目标
- 网页和目录树分属不同原生视图时仍可重复稳定触发

## 12. 实施前待确认事项

1. 目录树拖出第一版已冻结为只支持单文件；目录和多选的导出形式后续单独设计。
2. 拖拽上传是否继续每次打开上传确认框，还是允许使用默认 provider 快速上传。
3. 浏览器空白区域打开本地文件时，是优先内置浏览器标签，还是复用现有 File Viewer。
4. 网页拒绝文件时，反馈采用状态提示还是只改变鼠标光标。
5. 捕获资源面板中的资源是否也纳入同一套原生拖出能力。

以上事项不会阻塞 Phase 0 行为原型，但会影响正式交互。
