# 内置 Agent 应用窗口操作

更新时间：2026-10-12

适用范围：macOS 内置 Agent 的 `computer.windows@1` / `computer.observe@1` / `computer.click@1` / `computer.setText@1` / `computer.scroll@1`、Electron main 和原生窗口捕获 / AX 语义 helper。

## 当前能力

已接入 macOS 开发预览。Agent 观察本次任务获准的一个应用窗口，优先读取 AX、按需截图，按准确标签和本次观察内的控件 ID 执行已声明的点击、文本替换 / 插入或滚动，再次观察同一窗口确认结果。点击通过 macOS `AXPress` 激活控件，外部应用的文本与滚动各走对应的公共 AX 属性或动作；当前 OmniFlow 主窗口的两个注册控件另走固定第一方 owner 桥。截图使用 macOS 14+ 的 ScreenCaptureKit 独立窗口过滤器，不采集整屏后裁剪，也不收集其他窗口的缩略图。复用已有 Tool Registry、main prepare、授权卡、ToolRun、附件与视觉 Provider 链，不增加桌面输入 IPC 或新的 Agent 框架。

需要选择支持图片的模型。非视觉模型隐藏 observe / click / setText / scroll，但可查询无图像的窗口元数据；Windows / Linux 不注册工具。点击仅支持有可访问性动作的控件；已增加明确非安全原生控件的文字替换 / 插入，以及实际声明的一页 / 一步滚动。外部 AX 已接入显式 fraction 比例滚动策略，尚无内置 Agent 成功验收结果；第一方对话区的独立实现与往返结果见下文。右键、双击、画布、快捷键、拖动和连续录像不可用；网页输入不走此 AX 文本路线。观察支持 mode=ax / screenshot / both，省略模式兼容原截图加 AX；工具建议先读 AX，需要视觉辨认时再取图。优先使用观察内 elementId；AX-only 使用无坐标的 V3 语义点击，both 保持 V2 截图坐标兼容。AX 路径、原生 identifier 及进程身份仍只用于 main 内的目标绑定。

可用性结论：已验收的 OmniFlow 控件、计算器边栏和访达视图按钮可完成后台查看、点击、重新观察的简单闭环；标准 AppKit 夹具与 macOS TextEdit 测试文档的文本替换、插入和清空也已完成真实闭环，TextEdit 长文后仍可定位正文。2026-10-12 AV 的原生页子按钮下翻 / 上翻恢复已通过真实后台验收；旧 AXScrollArea Page 路线曾返回 unknown，外部 step / fraction 仍未通过，不因新路线成功而改写旧结果。AW 在 Finder 合成文件目录完成 AX-only 定位、列表切换、按需截图及图标恢复；WebStorm 部分控件因实际 AX getter 失效没有可用 ID。第一方 Agent 输入的替换 / 追加 / 清空及对话区上下 page / step / fraction 的独立后台结果见 AL。AX 摘要截断不要求将整个方案判为不可用，但模型没有隐藏完整树；AX 和 Provider 投影均有预算。复杂页面、任意第三方软件与 Electron / 网页编辑器的文本操作仍须分别验证。

早期 CoreGraphics 全局鼠标事件实现会与用户争用系统鼠标，现已改为 `AXUIElementPerformAction(..., kAXPressAction)`。驱动不发送 CGHID 鼠标事件、不移动指针、不激活应用或 `AXRaise`，没有全局点击 fallback。独立窗口捕获不受其他应用遮挡影响，`ignoreGlobalClipSingleWindow` 保留部分移出屏幕的窗口完整表面；AX 动作也不要求该窗仍为前台。目标应用可能自行改变焦点，具体 App 的后台支持仍须实机验证；尚无虚拟光标叠层。

重启 Electron 主进程后工具才会注册，仅刷新 renderer 不足。可以在 Agent 中提出“查看 OmniFlow 窗口并点击某个按钮”。首次 `computer.observe` 展示“共享应用窗口并允许操作”，明确应用、单个窗口、本次任务范围、截图发送到当前 AI 服务且保存在本机会话。默认当前 Agent 所属 OmniFlow 窗口，之后默认沿用本 Run 的已共享窗口；许可同时明确点击、文本输入、滚动，并把有限 operations 封存。旧无 operations 的共享 action 仅表示点击许可，不能静默扩权；也可按用户指定的应用名 / 窗口名精确匹配。多个匹配不能猜测，切换到其他窗口必须再次批准。同一应用的其他窗口、新建窗口或相同 PID 不自动扩大共享范围。完全访问和资料库目录授权不会省略首次共享确认。

元数据清单只列当前 Space 中 on-screen、普通 layer-0 且进程身份可确认的窗口；包括被其他应用遮挡的后台窗口。最小化、隐藏或完全离开当前 Space 的窗口会明确不可用。macOS 14 以下拒绝独立窗口截图，不降级整屏、其他窗口或旧 CoreGraphics 截图接口。

进程启动身份统一来自公开 libproc 的 `proc_pidinfo(PROC_PIDTBSDINFO)`，将内核 `pbi_start_tvsec/usec` 转为整数毫秒，校验返回结构尺寸、PID 与有效状态。不能使用 `NSRunningApplication.launchDate` 作为唯一来源：Apple SDK 明确说明它对未通过 LaunchServices 启动的应用可能为空，直接 npm/exec/spawn 启动的开发 Electron 会因此被误判不可用。开发直接启动和 LaunchServices 启动均使用同一内核身份源，未确认时仍拒绝，不放宽 PID 复用校验。最终 libproc 版本已完成双架构编译；提取实际 `processStart` 函数的纯进程自检确认自身启动时间非空、子进程读取父身份一致、重复查询稳定，未调用 CG / AX / 截图 API。

macOS 还需屏幕录制与辅助功能权限。权限检查不会自动同意 OS 授权；只在共享批准后显式请求辅助功能提示。录屏拒绝时提示前往系统设置并重启应用。开发 Electron、安装后的 OmniFlow 和 helper 的权限归属需分别验证。

开发启动链也会影响 macOS TCC 的权限归属：从终端、IDE 或其他宿主启动 `npm run dev` 时，系统可能将录屏请求归给启动宿主，不能仅凭 Electron 开关已开启判断权限可用。2026-10-09 实测从 Codex 执行进程启动的 Electron 请求被 TCC 归给主 ChatGPT/Codex 程序，Electron 录屏开关开启并完整重启后仍被拒绝。应核对实际请求归属并授权对应程序，不移除权限预检来掩盖拒绝。

WebStorm 启动链在 2026-10-09 经用户明确允许后，已通过系统设置添加「录屏与系统录音」并按系统提示退出重开 WebStorm、重启开发版。Run `cc887f37-9a2c-4f65-96e0-cdb5bebb4b11` 首次成功获得 V2 `captureScope: window` 的 2048×1257 图像；在聊天附件共用的大图预览实看只有 OmniFlow，没有遮挡它的 IDE 或其他显示器内容。此前 WebStorm 辅助功能已开但录屏列表没有它的阶段记录保留，不能把那个阶段的拒绝误写为重启后仍不可捕获。

单窗截图成功后发现 AX 扫描的 16 层上限过低。Run `1c6b57a3-00a1-40fb-ac48-3f5bd7cd99b6` 和单次诊断 G 的原生计数确认窗口匹配成功、没有 AX 错误，仅深度上限触发（108 节点、33 候选、最大子项 19）；当前把私有路径、扫描和 adapter 校验同步为 32 层，节点、子项、时间、文本和输出预算不变。系统日志仅记录计数、布尔及错误码，不记录窗口身份、位置或 AX 正文。旧坐标路径要求完整扫描；当前新增的 elementId 路径可使用部分扫描中已独立确认的稳定控件。

## 观察接口与本轮改进（2026-10-12）

模块仍由纯 shared 契约、main computer runtime / platform facade 和固定 Swift helper 组成，不增加独立常驻服务、聊天状态源或 renderer 输入入口。本轮已实现的接口与自动验证不等于跨应用真机验收。

后台绘制使用共享 main manager：可见 Agent 工作区不依赖 Session / Run 注册绘制引用；可信 active Run 在 started 前取得自有 owner 窗口引用，覆盖运行 / 等待批准 / 等待回答；获准自有共享目标正式复验后另取目标引用。三种引用独立释放，工作区与 owner 引用不授共享或操作能力。工作区隐藏、切库 / 账号 / 后端变化时释放注册，导航、崩溃、销毁和退出使注册失效；Run abort 同步归还其引用，终态 / 启动异常 / owner 释放 / shutdown 清理。最后引用归零后仅 250ms 有界绘制收尾，再恢复原节流值；新获取取消待恢复并沿用原值。这不改变全局窗口默认或第三方应用，也不确认 React / compositor 最后一帧。当前源码修复与历史真机范围见验证矩阵。

- `computer.observe({mode:"ax"})`：同一获准窗口两次独立 AX / 第一方控件快照，只签发稳定交集；不调用截图、不导入附件、不返回 imageId、截图尺寸或 screenshotBounds。准确原生名称、完整稳定扫描证明的唯一原生文本/滚动条、固定第一方标签可以签发 ID；依赖截图位置辨认的匿名区域不签发。
- `mode:"screenshot"`：仅捕获该窗口，不读取 AX 或第一方控件，不签发操作 ID，并清除旧动作观察。图片仍经原视觉 Provider / 会话附件 / 缩略图链。`mode:"both"` 保留截图前后稳定交集。首个 AX-only 观察也取得精确自有窗口的后台渲染租约，避免控件状态停留旧帧；不因此捕获图片。
- 可选 `query / role / operation / offset / limit` 仅筛选本次独立确认的公开控件。query 在 label / description 中作大小写不敏感子串，role 精确匹配，operation 是有限能力白名单；分页默认无查询128项、有查询32项，上限128，第一方固定控件在原生满页时优先。`totalMatched / hasMore / searchScope=observed-controls` 不代表扫描整个 AX 树；`candidateScanComplete` 仍独立。每次调用重新扫描、换 observationId 和随机 elementId，翻页后不能复用前页 ID。
- 可选 `focus:{observationId,elementId,ancestorLevels}` 从本 Run 最新有效观察签发的原生控件重新读取局部 AX，ancestorLevels 为0～3的整数，省略为0（控件自身）；不能超过原完整路径深度。上溯有限父区域可以给该分支重新分配扫描预算，不能传入原生路径、PID或任意 selector；它仍需要全窗口观察先取得可辨认的锚点，不是任意全树搜索。禁止与 application / windowTitle / windowRef 或 screenshot 模式混用，第一方 source=omniflow-control 的 ID 不能作为原生锚点。prepare 和执行均核对本 Run / owner / 共享窗口、60秒有效期与未消费状态；执行再从精确获准 AXWindow 解析完整路径、复验锚点完整指纹、同PID无循环父链和安全上下文，漂移、旧helper、不支持或取消均拒绝，不退回全窗。
- 局部结果公开 `scope:{kind:"element-ancestor",ancestorLevels:n}`，全窗为 `scope:{kind:"window"}`；`scopeScanComplete` 只描述两次扫描所选区域，`candidateScanComplete` 仍只指全窗口。局部即使完整稳定也保持 candidateScanComplete=false、coordinateClickReady=false，不证明本窗口唯一，不签发依赖全窗唯一的匿名 AX-only ID。both 仍截同一个获准整窗口，位置矩形仍按整窗图片计算；局部摘要从区域起缩进，候选和动作私有路径始终从获准窗口起算。局部不混入全窗第一方控件。新观察轮换所有 ID；路径、scopeRoot、锚点指纹不进入 Provider 或 UI。
- `includeChanges:true` 可返回同 Run、同精确窗口身份、同模式、同原生区域的前后控件变化；初次、模式/几何/区域变化时 baselineAvailable=false。main 私有路径/identifier只作比对键，不输出；变化不含 elementId，最多32条。`scopeScanComplete / previousScopeScanComplete` 与全窗完整度独立。`noLongerObserved` 仅表示前后有界集合的变化，部分扫描不能推断节点已删除；AX摘要变化只表达摘要文本不同。动作只能使用本次 elements，差异不延长旧观察。Provider预算不足时可省略差异细节并明确 `changesOmittedForContext`，保留摘要、区域信息和当前完整控件记录的投影规则。
- AX-only 点击 prepared V3 只带 targetId / observationId / elementId 等身份及固定左键单击语义，没有虚构的截图尺寸或坐标；V1/V2历史继续可读。setText / scroll 沿既有语义操作、一次消费、提交结算和 unknown 不重放契约。每 Run 最多256次观察；32张 / 64MiB截图配额独立，AX-only不消耗图片配额。首次共享批准和切窗批准保持原范围。

TextEdit 长文本候选新增严格可见区域路线：仅已有 `native-text-identifier-v1`、text-only、非网页/安全控件、真实最近父 AXScrollArea、同PID无循环祖先链回到精确获准 AXWindow，且视口在窗口内并与完整文档矩形相交时才成立。完整原始 AXRect 存为私有 documentBounds，可见交集用于候选 bounds；两者在前后观察与原生 prepare / final 继续复验，不授 Press 或坐标输入。稳定匿名原生 AXScrollArea 如确实声明翻页能力，在 both 模式可提供“原生滚动区域”与 `labelSource=native-scroll-screenshot-bounds`；已知其他可滚动区域重叠时不签发，模型须结合同截图位置确认。没有默认0…1滚动范围、全局滚轮或键鼠兜底。

另新增有限 `native-scroll-button-v1` 语义路线：仅实际 AXButton 的 AXEnabled 返回 unsupported/noValue 且 nil、真实声明 AXPress、subrole 精确为 AXIncrementPage / AXDecrementPage，立即父为 enabled=true 且实际轴向明确的 AXScrollBar，同PID、无循环、非web/secure祖先链回到精确批准AXWindow，且子控件真实正矩形在window内、真实parentBounds包含child时成立。parentBounds允许超过window，但不裁切或伪造child几何。该profile不读Description/Identifier，冻结title/subrole/childBounds与私有scrollButtonState(parentBounds/axis)，不混用文本profile字段；生产父链读取独立1秒且受普通扫描deadline约束，不依赖debug探针。前后观察、prepare及final均复验，只有精确轴向的一项Page operation，不授press，不能调用computer.click。

main派生“向上/下/左/右滚动一页”与 `labelSource=native-scroll-button`，不是原生名称或全局唯一控件。both附同截图中的真实child screenshotBounds，重叠同操作目标不签发；AX-only仅完整稳定扫描且对应轴可操作父身份唯一、该operation页按钮唯一时提供匿名派生ID。实际scroll对该子控件执行恰好一次AXPress，仍沿原一次消费/未知结算；不在ScrollArea翻页unknown后自动切换此路线，也不开放箭头子控件。新增有限stage25～29与四个能力布尔仅用于拒绝诊断，不含正文/身份/坐标；真机结果另见下文与验证矩阵。

本轮仍保留视觉模型门槛：AX-only减少不必要图像，但非视觉模型暂未开放电脑工具。锚点局部观察已通过下述WebStorm只读、计算器局部新ID点击与TextEdit局部输入/翻页/清空验证；没有可用锚点的区域、跨整个AX树的目标查找、上下文菜单、通用快捷键、任意像素/画布、右键/双击/拖拽与其他平台仍待实施。原生候选采用有界广度扫描，让浅层不同分支先进入预算，避免某个深文件树占满候选；child-index 私有路径不变。局部继续保留128候选、2048总节点/排队节点、32绝对层级、每节点64子项、3.2秒和12 KiB文本预算；query仅筛所选扫描结果，不能找回未扫描控件，也不修复应用AX getter错误。

80分是本模块的工程目标：AX-only后台点击闭环、按需单窗图片、外部80行Unicode长文编辑闭环、至少一个外部真实滚动往返、多区域文件列表/工具栏控件定位，以及旧ID/取消/unknown不重放。AV / AW补上外部滚动及Finder往返，局部四轮再验证点击/输入/翻页后，可按本机macOS的轻量基础操作范围评约80分；分数是工程判断，不表示Codex全接口覆盖或任意应用兼容。复杂IDE的失效节点、其他App局部动作、通用快捷键和更多指针操作仍须后续验证或实现。后台 idle 绘制注册和内置交互长等待已在源码收口，但尚未新增 GUI 真机验收；签名包、其他平台和 compositor 最后一帧仍分别受原有边界约束。当前门禁与本轮实际结果由[验证矩阵](frontend-validation-matrix.md)记录。

### 本轮实际验收

历史 TEXT3 / SCROLL4 记录中的首次共享卡、运行进度与终态结果保持不变；当时 SCROLL4 的 36.012 秒中断确实来自旧的通用 30 秒执行时限。当前源码已补上可见工作区绘制注册，以及内置 `interaction.request` 的 30 分钟 host-only 等待、30 秒 settlement grace 和 broker Tool signal 传递。运行前初始化的键盘焦点与 compositor 最后一帧仍需 GUI 单独验收，不能由自动化或租约设置调用代替。

局部 TEXT3 Run `cc017160-07a7-4b1b-bbab-224bf5462c5b` completed，三次focus自身的新ID分别完成短Unicode替换、插入和80行替换，均原生dispatched / committed、axError=0。目标均后台，前台端点未变；末次指针端点变化，不能归因。该Run没有滚动：真实测试窗口缩至253×46导致页子按钮不可用，末次focus还引用被新观察替代的旧ID，执行前以`observation_not_latest_or_wrong_window`拒绝，不能误记TTL或驱动失败。成功输入与观察同组、失败观察独立；局部AX标签/说明、真实缩略图及聊天共用大图/缩放/Esc与焦点恢复已做暗色验收。

恢复可丢弃测试窗口尺寸后，局部 SCROLL4 Run `3654ae0c-98ac-41c1-b337-a2bfd771f80a` completed。focus上溯1层的新页按钮ID下翻、focus自身的新页按钮ID上翻、focus正文自身的新ID清空，三写均dispatched / committed、axError=0，无unknown；采样前后目标后台、前台与指针端点均未变。7张675×441保存原图逐张确认获准整窗，首可见行01→30→01→空白；局部scopeScanComplete仍false，清空后的全窗完整。独立CUA确认空白/滚动值0，GUI保存0字节并关闭临时文档。连续观察/滚动/输入同组，成功动作只显示操作行；最后交互超时为独立边界。本轮不计交互提交通过，不推定其他App、外部step / fraction或持续指针隔离。

局部 AX1 Run `5547e177-f1bd-4fb6-924f-6b11a8adf672` completed，WebStorm仅windows + 4 observe，没有写动作。准确文件AXRow的自身区域缩为同名Row / StaticText共2个控件、233 UTF-8 bytes且摘要未截断，独立CUA同区域相符；上溯2级和1级仍有96控件并截断，按标签 / role / operations比较没有全窗之外的新控件，不计修复此前“结构”按钮定位。四次scopeScanComplete均false，局部仍不授全窗完整度或坐标。最后both保存的2048×1058原图实看仅含整WebStorm窗口，局部AX不会将图像裁成局部区域。

局部 CLICK2 Run `2a606291-4eed-4b54-8318-5c9871546d4b` completed，计算器8工具 / 2写全部completed；5次AX-only观察无imageId。两次focus自身均使用紧邻前观察的锚点，点击均使用局部新ID、V3无坐标、dispatched / committed。全窗标签确认“显示边栏→隐藏边栏→显示边栏”，最终独立CUA确认边栏关闭、原表达式和完整显示值保持。局部摘要137字节且未截断，scopeScanComplete / candidateScanComplete / coordinateClickReady均false；没有实际提交旧ID拒绝测试。两次AXPress axError=0、目标前后后台、frontmostChanged=false；第1次pointerMoved=true、第2次false，不能归因驱动或宣称持续指针隔离。首次共享正式ask / approved，数据库未记录批准者输入来源。本轮发现首个共享等待批准和终态展示后台旧帧，用户点开发窗口后刷新；owner Run绘制修复与后续验收另记。

AQ `b4cbdf21-3361-4bad-b466-468aaa285af1` 使用 AX-only 完成计算器边栏开关恢复；三次成功 AX 观察没有图片附件，两次 V3 点击真实生效。两次因边栏改变窗口宽度而复用旧 windowRef 的观察被拒绝，重新发现后继续，没有重发点击。AX-only UI 展开只显示 AX / 当前控件，V3 点击仍为紧凑成功行。

AR `9795bf48-b8d7-4507-b745-a2daf3d9c1f1` 成功写入80行中文 / emoji，长文后可见区域定位仍可用。真实原生翻页却返回 -25205，被结算为 unknown / commit_unknown；后观察文首未变，Agent 未继续写入或重试。独立 AS `67719a66-048b-49c8-a181-bc07ce0b2e0a` 随后完成长文→短替换→插入→清空的完整编辑闭环，截图和独立 CUA 相符；临时文件已保存为空。AS 三写原生端点均目标后台、前台和指针未变；AR 长文写的指针端点有变化，保留该事实而不归因于驱动。

AR / AS 的七张 TextEdit 保存原图逐张核对只含批准窗口。该阶段外部滚动未通过，AXScrollArea 声明四向 Page 不能证明执行成功；AXScrollBar Value 可写也不能替代真实 Min / Max 范围。源码没有添加全局滚轮、强制置前或 unknown 后的替代输入路线。

AV `138cc46b-dcae-4515-a6c7-22d77c93b6d2` completed，10工具 / 4写全部 completed、dispatched / committed。内部 Agent 将空临时文本区替换为80行，重新观察后选择右侧竖条的 `native-scroll-button` / AXButton / scrollDownPage，而非旧 ScrollArea；一次下翻后，第一可见行由01变为30。新观察给出真实正矩形的 scrollUpPage 子按钮，使用新ID上翻后恢复01；最后以新正文ID清空。五张673×439保存原图逐张实看仅含批准TextEdit窗口，长文后的三次观察仍 candidateScanComplete=false / axTreeTruncated=true。四写 axError=0、原生端点均 known / 目标后台、frontmostChanged=false / pointerMoved=false；只证明本次端点，不证明持续隔离。独立CUA确认空白、保存0字节并关闭临时文档；Tool input没有保存text。

AW `1bed1841-87b8-4898-b925-19b363226e8f` completed，6工具 / 2写全部 completed、dispatched / committed。仅新建含40合成文件/3合成目录的 Finder 测试窗口；首次AX-only query=视图取得4个准确 AXRadioButton / press，没有图片，V3点击“列表视图”后 both 图确认名称/日期/大小/种类列及文件列表。随后以新观察“图标视图”ID执行V2点击，最后 both 图确认恢复图标网格。两张1259×649保存原图逐张核对只含同一批准窗口，三次观察均候选部分 / 摘要截断，不因此猜目标或宣称全树完整。两点击 axError=0，原生前后目标后台、前台与指针端点未变；独立CUA确认图标视图值1、列表值0，再关闭该新建测试窗口，没有打开或修改文件。AV / AW 的白名单Run证据和原生日志在 `/tmp/omniflow-computer80-evidence-20261012/`；最新源码门禁见验证矩阵。

滚动条子控件新增 debug-only 只读诊断 `scrollbar-child-capability`：仅 debug=1、获批 `--window-targets`、原生 AXButton 的 Enabled unsupported/noValue 且 nil 时探测，最多8次、每次250ms且受扫描deadline约束；不增加候选能力。childKind=1/2/3/4 对应增箭头/减箭头/增页/减页，parentRoleKind=0/1/2/3/4 对应未知/ScrollBar/ScrollArea/Window/其他，orientationKind=0/1/2 对应未知/竖/横，parentEnabledKind=0/1/2 对应未知/disabled/enabled。relationFailure=0/1/2/3/4/5/6/7 对应成功/父读取失败/非ScrollBar父/跨PID/循环/非原生/外来Window/超深。另记录真实Press、精确批准窗口父链、几何布尔和错误码，不记录身份/正文/坐标；deadlineReached 时未知布尔不能当明确缺失。

## 第三方应用抽样（2026-10-11）

本轮按用户要求仅抽样简单与复杂应用，不做全量兼容修复。仍只用开发版、win（libraryId=3、本机 macOS MinIO）与内部 Agent computer 工具；验收者通过 CUA 发任务、批准准确单窗口并独立核对。用户继续使用 Codex，没有要求目标置前。五个 Run 全部 completed，但任务结束不代表其中每个操作都通过。

| 样本 / Run | 实际操作与证据 | 限定结论 |
| --- | --- | --- |
| TextEdit AM `e789a881-b03c-4852-a9b6-b21198514bcc` | 临时本地空 txt，6 工具 / 1 写；replace 80 行中文 / emoji 为 dispatched / committed。4 张673×439单窗原图实看空白→长文，独立 CUA 读到测试文字。 | 初始原生文字替换可用；长文后 elements 为空，textReady / scrollReady=false，没有继续短替换、追加、清空或滚动，不能计完整编辑闭环。 |
| Chrome AN `addfa212-c2bc-4a65-b813-d524198adf13` / AN2 `452c79c1-bce5-4b8d-a73e-6a344695bdea` | 公开 W3C Disclosure FAQ 页由 CUA 建立；窄搜索无结果，较宽 query=Chrome 找到3窗，但没有测试页标题。各1个windows工具，没有observe或写入。 | 窗口元数据发现可用；CUA当前页面与OmniFlow发现标题不一致，原因未确定。Chrome网页点击与滚动本轮未验证，不能记为不支持。 |
| WebStorm AO `f06902fb-3792-41ad-acf4-e5afc8ce30e5` | 精确发现并共享 `omniflow-app – overlay.api.ts`，2工具 / 0写；2048×1058单窗原图与独立CUA主要界面一致，原提交工具窗保持。 | 查看通过；“结构”按钮没有签发ID，所以未点击。128公开候选为127个press的Row / StaticText与1个可写TextArea，不能说整个App无press；textReady=true、scrollReady=false，也不能据声明推定编辑器输入成功。 |
| 计算器 AP `5e3c251a-1fec-4830-b2c1-54c0bf78a7e0` | 6工具 / 2点击，均dispatched / committed。3张window原图逐图实看边栏关闭→展开→关闭，独立CUA确认恢复；未改计算内容。 | 该边栏按钮的后台点击往返通过，partial候选扫描不妨碍已确认ID；scrollReady=false，没有滚动。 |

三次实际写入的原生日志两端均frontmostKnown=true、targetFrontmost=false、frontmostChanged=false、pointerMoved=false，确认这些端点目标在后台且指针未变；不证明全过程持续隔离。8张保存原图只包含获准窗口，没有其他应用遮挡内容。外部AX滚动仍没有成功验收，不以第一方滚动或第三方textReady声明替代。

TextEdit长文后诊断为文本roleKind=1 / stage=bounds / axError=0；源码先读AXRect再要求冻结window.bounds完整包含。已定位到bounds校验拒绝；可能涉及长文本区超窗等几何变化，但本轮没有记录实际矩形，具体原因未确认。滚动条MinValue getter不支持（-25205），未提供fraction；不猜默认范围、不补全局输入。WebStorm扫描291nodes / 128candidates、partial，role/actions getter错误为-25202，未触深度或每层子项限额；这只定位当前候选覆盖缺口，不将摘要中的按钮直接转为执行授权。本轮没有修改源码或放宽门槛。

清理由验收者CUA将临时txt清空并关闭，持久文件复验0字节；此清理不计内部Agent能力。W3C测试标签页已关闭，Chrome恢复先前标签；IDE布局未改。证据副本 `/tmp/omniflow-external-sample-qa-20261011/` 含AM / AN2 / AO / AP白名单JSON及8张原图；tmp可清理，持久Run和附件仍可按RunID追查。浏览器工具曾拒绝file协议，随后改用公开HTTPS示例，未绕过限制；该工具策略拒绝不计OmniFlow兼容失败。本轮仅GUI抽样与文档记录，没有重复lint / test / build，沿用前述原生诊断版本门禁。

## OmniFlow 第一方后台控件桥（2026-10-11）

当前源码接入当前可见 Agent 工作区的“Agent 输入”和“Agent 对话区域”，由 `source=omniflow-control` 区分于 AX 控件；公开随机 elementId、固定标签、有限 operations 和同截图像素 screenshotBounds，不公开注册身份或草稿正文。这条路线不覆盖 embedded browser、插件、iframe、第三方 Electron 或其他浏览器，也不声明 press。首次单窗口共享批准和 Run 许可仍由原 computer runtime 独占；renderer 没有发起动作的接口。

轻量模块分成纯 `first-party-control-contract`、`electron/service/agent/computer/agent-first-party-controls.ts` main transport、`src/service/computer-use/first-party-controls.api.ts` 固定 bridge、`src/modules/computer-use/first-party-controls.ts` 本地同步 dispatcher，以及 `useAgentComputerControls` 业务适配。preload 只提供 `electronComputerControls.register / unregister / complete / onRequest`，对应 register / unregister / complete 三个 IPC 和一个 main 请求 channel；IPC 先要求可信主窗口精确 mainFrame，再校验固定协议。main 签发 registrationId、documentGeneration 和一次 requestId，绑定账号 / backend / library / Session / Run、主frame身份、PID / CG窗口ID及可信 contentBounds / zoom 映射。每次 observe 在同一捕获前后取稳定交集；真实换文档导航、注册替换、隐藏或离开工作区、上下文变化、控件状态漂移使旧目标失效；HashRouter 同文档导航保持代次，scope / Session 变化仍经精确注销及重新注册。

文字复用 `useAgentSession` 的唯一草稿 owner；所有原 setDraft 路径增加 revision，dispatch 在原子比较 scope / Session / revision / value 后才写入。replace 可替换或清空草稿；insert 只在冻结选区折叠且位于末尾时提供，不把中间选区语义改成追加。DOM 值与 React 草稿不一致、输入法合成、当前前台正在聚焦编辑该 textarea、会话恢复或管理操作期间不提供能力。后台窗口保留 activeElement 不会单独阻止输入；桥不调用 focus / blur、选区 setter、剪贴板、全局键鼠或自动发送消息。它仍是同一个用户草稿，不提供隔离桌面或同控件并行编辑。

滚动复用聊天 scrollRef / follow owner，先取消排队的跟随 RAF，再暂停自动跟随并立即改变真实位置；用户下一次滚轮、指针或键盘操作解除程序滚动标记。只支持上下方向：page 是一 clientHeight，step 是40 CSS像素，fraction 是实际 scrollHeight 减 clientHeight 范围的10%，端点截停，三种单位不替换。内容版本、top / clientHeight / scrollHeight 和几何在观察、verify、dispatch 严格匹配；同高的工具审计状态不另行使正文控件失效。流式正文或布局变化仍可拒绝旧观察，需要先重新 observe。

verify 无副作用，原 main sealed prepare / commit.begin / 观察消费 / settlement 顺序保留；dispatch 只发一次。renderer 仅在实际 owner mutation 前调用 beginApply，边界后的抛错、timeout、取消、导航或丢回执按 unknown / commit_unknown；明确未修改的拒绝按 not-dispatched。超过请求期限的迟到回执不接受，unknown 不重发，也不降级 AX。成功回执含 inputMethod=omniflow-control，仍需后续截图 / AX 与独立验收确认界面变化。原 AX 点击策略不变。

真实验收只使用开发版、win（libraryId=3、本机 macOS MinIO），Session `3367c2e9-1037-4ef3-bd7b-07242829ef38`。AF Run `b67ac3c2-9c81-4544-96ec-b5c53b8103f1` 与 AG Run `31f9033a-2339-40c0-b80a-fa4b8a5da774` 均由内部 Agent 完成 observe → 两行中文 / emoji 替换 → observe → 末尾追加 → observe → 清空 → observe，共7工具、3写。回执为 dispatched / committed、inputMethod=omniflow-control，逐图检查真实 Composer 的两行、追加和清空，最终独立 CUA 读取为空；没有提交草稿。两轮 window.isFocused 端点均为true、pointerMoved=false，因此虽能确认文字闭环，不能计为后台验收。

AH Run `d23ebd54-3253-4744-84f3-7995b8282744` 的有效控件在 main preparing 状态被过窄 Run guard 拒绝，修复为复用既有 active Run 判定。AI Run `747eca22-97f3-4199-b4ca-6557c6fb6236` 进一步确认不是身份或正文 revision 漂移：verify 时 available=true，revision / bounds / operations / registration 均未变，scrollHeight 8289→8324、top 7004.5→7035.5，临时独立准备行和自动跟随使严格几何失效。拒绝发生在派发前，两轮没有误滚动。

修复不放宽几何：main 精确确认的内置来源初始 preparing 可以提前提供有限展示分类，使其保持在同一电脑操作组；不伪造 prepared action / approval / result。运行和准备期间的过程状态位置固定31px，无文案仅隐藏内容，避免思考提示消失导致 extent 改变。pending approval / interaction 与 unknown 仍独立；原 Workspace scroll / follow owner 及所有严格复验保持。

修后 AJ Run `e46975cf-5b58-4da5-b8e6-7f969342cca5`（`COMPUTER_FIRST_PARTY_SCROLL_AJ_20261011`）completed，13工具全部 completed，6写依次上下 page、上下 step、上下 fraction，均 dispatched / committed、inputMethod=omniflow-control。验收者逐张实看7张2048×1058 window原图：page移至较早报告并恢复；step小幅移动并恢复；fraction明显移动且幅度大于step，随后恢复。窗口侧栏与Composer固定，仅正文滚动；截图只含获准OmniFlow窗口。6写 pointerMoved=false，但 applicationFocused / targetFocused 前后均为true，不能计为后台通过。最终 CUA 读取任务完成且空草稿，展开过程后只有一个13条电脑操作组；6条滚动只显示“已发送滚动”，最后observe展开有截图缩略图和“AX · 已截断”，缩略图打开聊天共用的大图预览并实看同一单窗图像。

AK Run `6c1ae81e-5c83-45ad-a263-c2bdbb05b0d1`（`COMPUTER_FIRST_PARTY_BACKGROUND_AK_20261011`）完成19工具，3次文字与6次滚动均为第一方 dispatched / committed。验收者实看10张2048×1058单窗原图，确认文字替换 / 追加 / 清空及 page / step / fraction 三对真实移动和恢复；最终独立 CUA 读取为空草稿、任务已结束。用户报告持续使用 Codex、OmniFlow被覆盖，但9次活动事件投影和 window.isFocused 端点均为true、指针端点未变，活动采样与用户场景不一致，不能计为后台焦点通过，也不能据该缓存否定用户所见。

诊断通过 `OMNIFLOW_COMPUTER_CONTROLS_DEBUG=1` 显式开启 verify拒绝后的最多一次只读observe，只记固定差异布尔和滚动数值，不含正文、ID、scope或原生身份；诊断失败不覆盖原拒绝，也不派发或重试。已有 applicationFocused 字段仍是 Electron did-become-active / did-resign-active 事件投影，未观察事件时明确unknown。另增加调试专用 `nativeApplicationFocusKnownBefore/After`、`nativeApplicationFocusedBefore/After`：main直接启动固定 `--parent-activity` helper，无输入，实时读取 NSWorkspace 当前前台PID与getppid比较，复验父PID未变，只回传 known / active 布尔；不调用AX、CG捕获、键鼠、激活或权限请求。每次上限500ms / 512B，失败为unknown，不借事件缓存补齐；普通运行不增加诊断进程。派发前采样等待后重新核对窗口 / frame / 注册，取消或导航不派发；派发后用独立短期信号采样，失败不改变权威回执。两端采样不是原子焦点事务，不证明期间持续隔离；用户并发移动指针时端点变化也不能归因于Agent。最新自动门禁和真实结果以[验证矩阵](frontend-validation-matrix.md)为准，第一方成功不代替外部滚动兼容性。

原生实时诊断版本的 AL Run `5a6ceebd-2534-40fc-80d5-b75a3877ee5d`（`COMPUTER_FIRST_PARTY_NATIVE_BACKGROUND_AL_20261011`，本地10:47:24～10:50:00）completed，19工具全部completed，3写文字及6写滚动均为 omniflow-control / dispatched / committed。9次原生采样前后均known=true、active=false，证明各采样端点系统前台是其他应用；指针端点均已知且未变。与此同时旧活动事件与window焦点仍为true，确认在本场景不能单独据它们判断前台。10张2048×1058存储原图同target、window scope，逐图实看输入两行中文 / emoji、末尾追加、清空，以及上下page / step / fraction的真实移动与三对恢复；侧栏和Composer固定，截图只含获准OmniFlow窗口。最终独立CUA读取空草稿、任务结束；展开后一个19条computer组，3条文字和6条滚动只显示操作文本，observe详情包含截图缩略图 / AX截断标签，缩略图打开聊天共用大图预览并实看同一图像，随后关闭预览并收起过程。SQLite Tool输入未保存text参数；原聊天和获准图像仍按既有规则保存。限定这两个第一方控件的后台闭环已通过，不证明同控件并行编辑、持续焦点隔离或任意第三方软件兼容。原图副本与白名单证据 `/tmp/omniflow-first-party-native-background-qa-20261011/`，运行日志 `/tmp/omniflow-first-party-native-background-dev-20261011.log`；临时副本可能随系统清理，持久Run和附件可按RunID追查。

## 独立模块边界与新增语义输入（2026-10-10）

电脑操作独立为应用内部模块，暂不创建 npm 包、常驻服务或另一套 Agent 框架。`src/shared/computer-use/computer-use-contract.ts` 只定义有限操作、文本模式 / 限额和纯校验；`electron/platform/computer-use/index.ts` 是单窗口平台 facade，不依赖 Agent 会话、权限或 UI，也不导出旧显示器能力。Swift 拆为 common 窗口 / 身份发现、semantic 能力 / 输入策略与固定 main dispatch，构建指纹覆盖全部源文件。`electron/service/agent/computer/` 独占 Run 许可、观察、随机 ID、附件与提交结算；`tools/computer-tools.ts` 只注册有限工具。renderer 展示主进程投影；新增第一方控件桥仅能注册固定控件及回复 main 请求，没有任意桌面输入 IPC。

`computer.setText({observationId,elementId,text,mode})` 的 replace 只设置确认可写的 AXValue，空文本用于清空；insert 只设置实际确认可写的 AXSelectedText，必须冻结并复验 UTF-16 选区。AXSelectedText 并非所有控件都可写，模型只能在当前 elements.operations 含 insertText 时请求插入，不能据 replaceText 推定插入也可用。输入最多 4096 Unicode scalar / 16 KiB UTF-8，不 trim、不经剪贴板或全局键盘，不设置焦点。AXTextField 只接受明确的 AXTextField / AXSearchField 子角色，缺失、空或 AXUnknown 均不签发该字段的文本能力；AXTextArea 接受已成功读取或确认缺失且不含 Secure 的子角色，因此可包含 AXUnknown，但必须证明从冻结窗口到控件的完整祖先链无 AXWebArea、Secure 角色或无法确认的节点。任何语义读取失败均拒绝对应能力，不放宽为网页文本。不得据 AXValue 可写推定网页 input/change 事件、IME 或快捷键已支持。观察和执行不为身份读取输入正文；后续截图仍可能包含用户实际输入内容，沿获准窗口图像规则发送和保存。

`computer.scroll({observationId,elementId,direction,unit})` 的 page / step 路线一次只选择对应控件真实声明的 AXScroll*ByPage 或 AXScrollBar 的 AXIncrement / AXDecrement；滚动条必须复验 vertical/horizontal，increment 不冒充翻页。没有坐标、任意动作名、像素量或批量次数；page / step 不设置滚动条值、不补发滚轮事件。direction 为 up/down/left/right；本轮 ABI 另加入 unit=fraction 与四个明确的 Fraction operations，实施与验收边界见下一节。无名滚动条只有在前后完整扫描、整个候选集合稳定且同方向可操作滚动条恰好一个时，才以“本窗口唯一可操作的垂直 / 水平滚动条”签发 ID，并标 labelSource=unique-actionable-scrollbar；此标签不写回 AX 指纹，也不证明不可操作滚动条不存在。部分扫描或同方向多个无名条不推定目标。无名滚动区不借用子条的 page 能力。

新候选的 operations、文本子角色 / 选区、滚动方向、私有 enabledState / scrollState，以及成对的 identityProfile / descriptionDeclared 都纳入稳定指纹。enabledState 只允许 enabled / absent，私有字段保存在 main 候选和 sealed binding，不投影为模型可执行的授权字段。点击坐标先在所有可操作候选中选唯一叶节点，再要求 press，不能穿透非点击文本 / 滚动子控件去点击父控件。旧 helper 缺 operations 仅兼容 press，不产生文本或滚动能力；没有新 enabledState 的旧候选也不授权文本 / 滚动。

两类写动作都绑定单窗口、观察、elementId、许可及私有控件指纹，沿 serial prepare→执行前复验→一次提交→回执→observe 生命周期。每份观察 60 秒内只能用于一次动作，dispatch 后重新 `observe({})`；未知不能更换路线或重放。dispatched / committed 只证明 AX 调用完成，需要新截图验证界面是否变化；到滚动边界可能无变化。取消跨提交边界仍等待受限结算并保留 authoritative receipt。

文本公开 action 和回执只含模式、Unicode scalar 数 / UTF-8 字节数及目标身份，没有正文、预览或正文 hash。原文只保留 main 私有 binding 并参与 canonical seal；SQLite Tool input、renderer 事件 / 审批、历史与后续 Active Context 的参数投影移除正文。敏感凭据检查仍针对原始输入，不能靠投影绕过。截图与用户原始聊天消息遵循各自既有保存规则，不宣称它们不含文字。

验收夹具由 `node tools/computer-use/build-appkit-qa.mjs` 仅编译到临时目录；通过界面启动返回的 `.app`，只使用真实标准 AppKit 文本 / 长文滚动控件，窗口关闭丢弃内容，不访问用户文件。此夹具用于区分驱动正向验收与第三方兼容性；默认不随应用启动或打包。

## 比例滚动与原生文本身份的本轮补齐（2026-10-10）

本轮已在源代码将 `unit=fraction` 接入既有单窗模块，原生定向检查及该版本全量 lint / test / build 通过，universal helper 已重建；实际 AA2 观察没有签发 Fraction 候选，尚无内置 Agent 滚动成功证据。operations 分别为 scrollUpFraction / scrollDownFraction / scrollLeftFraction / scrollRightFraction；一次只沿实际轴移动已确认 AX 数值范围的 10%，在边界截停，不表示一页、一步、像素量或可视区域的 10%，模型不能提供自定义幅度。保留原 page / step，三者分别声明能力和批准；旧许可不授予新的 Fraction operations，任何失败后都不自动切换路线。

原生接入门槛是实际 AXScrollBar、明确 enabled、已确认 vertical / horizontal，以及 Value / MinValue / MaxValue 均成功读取为非 Boolean 的有限数值、有效范围和 AXValue 实际可写。不能给缺失 MinValue / MaxValue 填 0 / 1。三值只保存为 main 私有 scrollState（value / minValue / maxValue），并与 operations、轴、enabledState 纳入指纹 / sealed binding；观察前后、prepare 和原生派发前严格复验，数值漂移即拒绝旧观察。实际写调用后的错误仍为 unknown，不用新 ID 重放；成功回执仍需新截图和 AX 确认内容变化。内置 Agent 往返验收尚待本轮收口，不由旧 W3 / Z 代替；当前自动门禁详见[验证矩阵](frontend-validation-matrix.md)。

TextEdit 先增加固定角色、拒绝阶段、错误数值和布尔诊断，定位 Y2 / AB 的候选拒绝位置，随后补齐下述预选文本身份 profile。roleKind=1 / 2 / 3 对应 TextArea / TextField / ScrollBar；stage / axError 保留实际拒绝位置，probeStage / probeAXError 独立保留第一能力探针失败，stage 代码以 Swift NativeCandidateStage 为准，Description 为 17、Identifier 为 18。字段仅记录 settable、subrole、enabled、range 等能力布尔，新增 identifierDeclared / identifierReadable / identifierNonEmpty / textIdentityProfile 四布尔。日志为 subsystem=com.omniflow.agent.computer-use、category=candidate-capability，每次扫描独立封顶 32 条，耗尽不标 truncated、不改变候选能力；prepare / final 单目标诊断仍可记录。日志不记录用户文字、原生 Identifier、窗口身份、动态角色名或滚动条的实际三值。该原生轮次尚未接入第一方桥；2026-10-11 的固定控件实现见下一节，不能由原生 AXValue 可写推定网页事件、任意编辑器已经兼容。

新验收准备使用 `/tmp/omniflow-computer-qa-cyzUeg/Omniflow Computer QA.app` 及本轮新建空 TextEdit“未命名”文档，之前开发进程与旧夹具已退出。独立 CUA 将夹具垂直 AXValue 从 0 设置为 0.1 后，内容出现 row013 / row014，再恢复为 0；这只证明对照路线可移动该夹具，不能计为内置 Agent fraction 通过。夹具后续已关闭；AA2 / AB / AC 的观察阶段没有完成 TextEdit 输入，后续重建版本的 AE 编辑及清理结果见下文。

新 TextEdit 空测试文档的独立 CUA setValue 对照已写入合成中文 / emoji / 两行文字，再清空；AX 保留完整 Unicode，CUA 将 TextArea / First Text View 报为 settable。该对照说明该窗口存在原生 setter，不能据此记内置 Agent 文字通过或放宽 Description；本机 helper 的实际拒绝阶段已由 AB 定位，见下文。系统自动保存出的 iCloud“未命名.rtf”在 AE 后通过系统“移到”功能移动至测试临时目录并关闭，最终清理见下文；该操作不是另存副本。

AA 首轮误选标题为“Window”的目标，由验收者取消，未捕获也未执行输入。正确选择 QA 的 AA2 Run `f3c7e816-6f6f-4327-80cf-5af34a1f1979`、Session `3367c2e9-1037-4ef3-bd7b-07242829ef38` 取得 windows 与 observe 成功结果，imageId=`83b1b3a7-81fc-4811-bf81-c47c30bbf4b0`。滚动条 AXValue=0、enabled=true，诊断确认 valueNumeric / valueSettable=true，但真实 MinValue / MaxValue getter 返回 -25205（attributeUnsupported）；没有 Fraction 候选，也没有 scroll 派发。此结果只计窗口发现与观察，不计 fraction 通过。不能由 CUA Value 对照或滚动条角色猜默认 0 / 1；本轮未取得外部 App 数值范围的通用保证。

同一 Session 的 TextEdit AB Run `f1b8ce4f-9616-48e2-8d94-fa6a03d53861` observe 成功，imageId=`207398fb-c17c-411b-bb3a-646174ffdf07`；roleKind=1、stage=17，已声明 Description 的真实 getter 返回 -25200。nativeContext、文本角色、Value / SelectedText settable 与 enabled confirmed-absence 等门槛均通过，实际拒绝发生在 Description 身份读取，没有执行 TextEdit 写入。此证据不应归因于原生 setter 不存在，也不使真实 getter 失败变成字段缺失。

AB 后已接入私有 identityProfile=`native-text-identifier-v1`，与 descriptionDeclared 布尔成对封存。只有完整非网页原生祖先链中的 AXTextArea、有效 textState、operations 全为 replaceText / insertText 且无 press、title 精确为空串、AXIdentifier 在支持列表中声明，才在 Description getter 之前预选此 profile。随后 Identifier getter 必须成功、返回 CFString，完整原值通过 256 字节和字符安全校验且 trim 非空；保留完整原值比较，不 trim 后绑定，也不将失败 / 缺失 / 非法值降级到 Description。此 profile 禁止携带 Description 字段；descriptionDeclared 仅冻结支持列表的存在性，不声称 getter 成功或将真实错误变成 absence。默认和 Press 身份策略保持严格 Description getter。

profile、descriptionDeclared、完整 Identifier 及其余原候选指纹均参与 parser / 前后扫描 / main prepare seal / native 执行复验。prepare 明确 requiredProfile，最终派发前重新读取完整 profile candidate 并严格匹配，不触碰 Description；资格或字段发生变化即拒绝，不能切换身份路线。main 只有前后完整扫描、候选集合完全稳定且可操作原生 TextArea 恰好一个时，才派生“本窗口唯一可操作的原生文本区域”、labelSource=unique-actionable-native-textarea；不公开 Identifier、profile 或声明标志，也不证明不可操作文本区不存在。部分扫描或多个文本区不能取得这个唯一标签；空白 / 非法 Identifier 仍不能成为此 profile 的目标。AD 后新增的通用文本区图像边界路线见下文。

文本 profile 冻结后的平台专项 280 项、runtime 专项 173 项、Swift 双架构类型检查及独立 TS / native review 通过；该版本全量 lint / test / build 均 exit 0，471 文件 / 4506 项通过、3 文件 / 7 项沿用跳过，universal helper 已重建。日志及耗时见[验证矩阵](frontend-validation-matrix.md)。这些源码门禁不能代替实际 TextEdit setter 验收。夹具关闭前两轴值均为 0，已通过 CUA 关闭且不再运行。

实际 AC Run `38711990-fe91-4b23-820c-792b856dd743` 属于 Session `3367c2e9-1037-4ef3-bd7b-07242829ef38`，取得 imageId=`424e94d5-ec6c-408b-96dd-8b7df747e2e8`。原生目标文本 profile 两次 accepted=true，identifierDeclared / identifierReadable / identifierNonEmpty=true，Description 错误计数为 0；已实际确认 Identifier 身份路线受到该 TextEdit 文本区支持，不能把这些布尔写为已执行 setter 或已读取 Description。

同次窗口候选扫描为 48 nodes / 18 candidates、maxDepth=3 / maxChildren=17，truncated=true、firstAXError=-25205；未触发 children / depth 限额，optional attribute names / Description / Identifier 错误计数均为 0。全局候选完整性仍不足，所以 main 未签发“唯一原生文本区域”的 elementId，Agent 没有发送 setText，TextEdit 编辑仍未通过验收。此次不能再归因于目标 Identifier 不支持；其他 getter 的实际拒绝门槛尚未确认，不能放宽完整扫描规则来推定唯一性。

后续已增加 generic roleKind=0 的固定失败诊断，只在有明确 stage 且真实非 success 错误时记录，不记动态角色名；正常无受支持 operation 或已确认 disabled 不占 32 条额度。stage 1～18 保持不变，追加 role=19、position=20、size=21、childrenCopy=22、windowsCopy=23；这仅定位失败，不改变扫描门槛。

AD Run `1f56155d-a060-411b-8018-07611a04436a` 的 2026-10-10 23:02:11 诊断出现 roleKind=0 / stage=13（enabled）/ axError=-25205，导致整窗候选扫描仍为 partial，而目标 TextArea identity 仍 accepted。其 observe imageId=`b220897d-f554-4305-a37c-9a3418cc956b`，candidateScanComplete=false、textReady=false，与 AC 的图像分开记录。AD 确认了另一个节点的 enabled getter 不支持，不能据此把它当作启用，也不把目标 profile accepted 记为输入完成。

AD 后已冻结 labelSource=native-text-screenshot-bounds 的源码：同一获准截图前后独立确认、私有身份指纹稳定的上述 text-only profile，在与前后两次扫描中已知的其他可操作 TextArea 均无重叠时，可给通用标签“原生文本区域”和 screenshotBounds（x / y / width / height）。边界以同一保存附件左上角为原点，按归一化图片实际像素换算并限制在图片内，供模型结合该图辨认该 elementId。部分扫描或已知多个文本区不宣称全窗唯一，也不证明未扫描控件不存在；已知重叠文本区不签发此标签。操作仍限实际声明的 replaceText / insertText，边界不是点击坐标授权，不增加 press、不改变 coordinateClickReady 或 candidateScanComplete，native prepare / final 指纹门槛不变。runtime 定向 187 项及最终全量 lint / test / build 通过，471 文件 / 4522 项通过、3 文件 / 7 项沿用跳过；最新日志见[验证矩阵](frontend-validation-matrix.md)，不借用旧 4506 项 gate 代替。

## TextEdit AE 限定编辑闭环（2026-10-10）

AE Run `cf5e6e65-6208-456c-b981-521e362e00ff`、Session `3367c2e9-1037-4ef3-bd7b-07242829ef38` completed，使用开发版、win / libraryId=3、本机 macOS MinIO，对“文本编辑 / 未命名”单窗批准一次。初始观察 candidateScanComplete=false、textReady=true，AXTextArea 标签为“原生文本区域”、labelSource=native-text-screenshot-bounds，screenshotBounds={x:0,y:200,width:1172,height:764}；整体 partial 没有被改写为完整，稳定文本目标独立取得 ID。

| 阶段 | 图像 ID | 实看状态 |
| --- | --- | --- |
| 初始观察 | 70efc3aa-897a-45b9-9d04-d24cae0c583b | 空测试文档，稳定原生文本区可用。 |
| replace | 9999549e-4114-42c0-ab67-89d0bcb05b86 | 两行合成文字“QA 原生中文😀”与“第二行”。 |
| insert | 827cb735-8085-48ef-a4f2-525451897f98 | 加入“＋插入🪟”，原有两行保留。 |
| replace 空值 | a2c7cbd2-6b3f-4f2f-b393-f438b36fd548 | 文本已清空。 |

验收者逐个查看保存 PNG，AX 摘要与替换 / 插入 / 清空对应；独立 CUA 也在插入后读到完整两行及新增内容，最后确认清空。三次写入均 dispatched / committed；23:11:59.241、23:12:07.493、23:12:15.866 的原生日志 axError=0，前后 frontmostKnown=true、targetFrontmost=false、frontmostChanged=false、pointerMoved=false。确认该 macOS TextEdit 测试文本区 replace / insert / clear 的后台闭环；端点证据不证明持续零干扰或同窗口状态隔离，也不宣称其他 App、Electron / 网页输入通用可用。page / step / fraction 滚动仍未通过，first-party Electron 桥仍为后续研究。

AE 结束后文档为空。验收者通过 GUI“文件 → 移到 → 其他”将它移动到 `/tmp/omniflow-computer-qa-cyzUeg/未命名.rtf`，文档 URL 确认改为该临时位置，再关闭文档；原 iCloud“未命名.rtf”路径已不存在。保留的 RTF 为 219 字节，只含格式头、没有正文，没有删除文档或写入用户文档。随后自动打开的文件面板已取消；夹具已关闭。开发版保持打开 win / libraryId=3 的最新 AE 已完成任务。

## 执行契约

`computer.windows({query?,application?})` 只搜索当前可共享窗口的元数据，不截图、扫描 AX 或请求权限。大小写不敏感子串匹配，query 查应用名 / 窗口名，application 限应用名；公开 applicationLabel、windowLabel 与 opaque windowRef，最多 64 条并标 truncated。引用绑定同 Run / Session / owner / library / WebContents / AI destination / 能力快照，闲置十分钟失效，Run 结束清理；每 Run 64 引用、全局 32 Run，有界 LRU 保证窄搜索可发现新目标。引用淘汰不重绑定；解析前复验精确窗口、进程启动、标题与几何。窗口列表不是全部进程或已安装软件列表，也不授予观察或操作许可。

`computer.observe({windowRef})` 精确选择发现结果，仍走首次或切换单窗口批准；不能同时传 application / windowTitle。空参数默认沿用本任务已共享窗口，首次默认 OmniFlow owner 窗口；旧的 application / windowTitle 精确名称选择继续兼容。模型不能提交 PID、CGWindowID、任意 source ID 或 app-wide 捕获过滤器。结果共同包含 `captureScope: 'window'`、main 签发的 `targetId`、应用 / 窗口标签、`observationId`、观察时间及 readiness。mode=ax / both 可提供本次确认的 elements；mode=screenshot 没有操作控件。仅 screenshot / both 返回截图像素尺寸与 `imageId`，图像经精确宿主内置注册身份进入附件解析并自动送模型，普通 Tool JSON 不带 base64。仅 ax / both 读取同窗 AX，后置扫描可提供成对的 `axTree / axTreeTruncated`；both 的后置扫描位于截图后，ax 位于第二次独立快照，无权限或摘要失败可缺失，旧 helper 无字段保持兼容，不用前置旧树代替当前结果。

AX 摘要只遍历匹配的获准窗口，不进入异 PID、嵌套其他 AXWindow / AXApplication。以缩进和 JSON 引号输出 AXRole、title / description、enabled、短 value 和支持动作，屏蔽 secure text 的值、控制及双向文本字符，不提供 PID、窗口 ID、私有路径或可执行句柄。整窗摘要对 AXTextField 仅允许明确的非安全 `AXSearchField` 子角色读取 value；局部观察在父链、候选、摘要和值读取前统一确认 `AXSearchField` 或 `AXTextField`。nil、空、AXUnknown、自定义或安全子角色均不读取，局部也不遍历其子项；Web 上下文不授原生文字写能力。独立上限为 12 KiB UTF-8、2048 节点、32 层、每节点 64 子项、每字段 200 输出 Unicode scalar / 256 字节（最多检查 1024 输入 scalar，定期检查 deadline）及最多 1 秒额外扫描，并受原 helper 截止时间及 64 KiB JSON 剩余预算约束。截断明确标记，不能将缺失控件理解为不存在；摘要截断和候选不完整分开结算，摘要文字不授予点击能力。

`computer.click({observationId,elementId})` 优先按本次观察的控件身份激活。elements 包含两次独立快照各自严格确认、指纹稳定且有可辨认标签的 AX 控件，每条显式声明有限 operations，click 仅接受其中含 press 的控件，最多 128 个；每条公开随机 elementId、role、label 和可选 description，不公开原生 identifier 或路径。空白 title 可回退非空白 description，仍保留原指纹精确值；匿名 AXButton 不签发语义 ID，不能按 AX 树或列表顺序猜测目标。即使其他控件读取失败或遍历有界截断，已确认控件仍可按 ID 直接复验；不能把未列出的控件视为不存在。摘要截断不删减这份独立候选列表。main 直接选择封存候选；AX-only 的 V3 按身份和实际 AXPress 复验，不产生坐标。both 的 V2 用候选中心作为原生复验点，public action / 回执保留派生 x/y 兼容展示核对。

兼容 `computer.click({observationId,x,y,button?,clickCount?})`，使用窗口图片左上角为原点的整数像素坐标；elementId 与坐标必须二选一。`button` 只接受 `left`、`clickCount` 只接受 `1`；旧历史 action 继续可以解析右键/双击，不能据历史格式执行当前不支持的动作。main 将坐标转换到冻结窗口的全局 points，包含 Retina、归一化图像比例及负窗口原点。像素定位仍只选择 AX 候选，没有原生像素输入回退。

ax模式两次独立扫描、both模式截图前后分别扫描冻结窗口的有界 AX 候选；仅窗口 ID、PID、进程启动时间、layer、几何和标题保持一致时保留两次均稳定的控件。`clickReady` 表示点击 ID 或坐标路径至少一项可用；`textReady / scrollReady` 独立表示有已签发 ID 的对应能力；`candidateScanComplete` 表示前后全窗口候选遍历均完整；局部只报告独立的 `scopeScanComplete`，不授坐标或全窗口唯一性。`coordinateClickReady` 还要求两次全窗口完整候选集合完全一致。完整稳定扫描中的匿名控件仍留在私有坐标命中列表，不能因 ID 列表过滤而错选重叠父控件。部分扫描或其他控件变化不会抹去已确认 ID，但 prepare 和正式执行都拒绝坐标点击。任一扫描失败或窗口不匹配时不签发操作能力；三种 readiness 均为 false 时仍只供查看，不能因点击不可用推定文本和滚动也不可用。捕获期间窗口身份 / 几何变化则拒绝该截图。其他应用的前台或 z-order 变化不改变单窗口授权。坐标路径先在所有可操作候选中选唯一包含该点的叶节点，再要求该节点具有 press；ID 路径直达已确认控件，不推断缺失的其他控件。窗口身份及控件路径/指纹只在 main 私有 observation 和 sealed binding 中持有。

默认候选及 Press 的 Description 身份路线直接调用公开 getter：成功时精确有界校验，`attributeUnsupported / noValue` 表示没有该字段，真实失败拒绝该控件并标记扫描不完整。不能仅依据 `AXUIElementCopyAttributeNames` 没列它就省略：计算器实测支持列表不完整，但 Description getter 正常。Identifier 先核对支持名再严读；支持名上限 128 项、每项 128 UTF-8 字节、总计 8 KiB，逐步检查截止时间。只有上述严格 text-only 原生 TextArea 可以在读取前预选 Identifier profile，禁止错误后 fallback。AXPress 生产候选不采集非必要的 Subrole，避免其兼容错误使已确认按钮不可用；旧 subrole 解析和严格身份约束保留，不能放宽旧请求。原生点击复用原读取规则；真实失败不当作 absence。诊断仅输出固定类别、阶段、能力布尔、计数与错误码。

候选读取按角色、祖先链、真实动作和可写属性确认有限 operations，再核对 AXEnabled 并读取标题、几何和语义；没有 AXPress 的文本或滚动控件也可以成为候选。正常路径要求成功读取 CFBoolean true，私有 enabledState=enabled。仅当 getter 明确返回 attributeUnsupported / noValue 且结果为 nil 时，允许两种窄例外：已按原生祖先链和 settable 确认文本能力的 AXTextArea，以及实际声明 AXScroll*ByPage 的 AXScrollArea；私有 enabledState=absent，过滤掉 press 及其他不适用操作。缺失 AXEnabled 不授予 TextField、ScrollBar 步进或点击能力，也不把成功返回 nil 当确认缺失。Boolean false 仍不可操作；真实读取错误、非法类型或矛盾的非 nil 结果继续拒绝并保守标记扫描不完整。已确认没有任何受支持操作的节点可以正常跳过；可操作控件若身份/动作数组/几何缺失、类型非法、超预算、含控制文本或不可确认，则标记部分扫描。不能静默省略超长标题的重叠子控件后仍开放坐标点击。扫描与执行复验共用读取策略，纯协议检查与真实控件验收分开记录。

截图及 elementId 有效期 60 秒，仅能用于一次点击、文本或滚动动作；每次发送前重查 Run 的单窗授权、截图身份、辅助功能和窗口身份，native 再复验进程启动身份、窗口 ID/几何、唯一 AX 窗口、候选路径和指纹、enabledState 与该操作对应的实际动作或可写属性。指纹纳入 role / title / bounds、明确观察的 description / identifier、operations 及 AXEnabled 的 presence / 状态；enabled 与 absent 在截图前后和派发前必须严格一致，不能把字段从缺失变可读当作同一状态。文本还复验子角色 / 选区，滚动条步进复验方向，旧显式 subrole 仍严格比较。缺失与空串区别，字段超限或不安全时拒绝候选，不能截短成碰撞身份。路径复验每层只读到冻结索引的有界子项前缀（最多 64），不因其他兄弟超过 64 而拒绝已确认目标；最终控件、窗口唯一性与坐标完整度门槛不变。目标已移动、关闭、重建或控件变化则拒绝，不能按过期坐标触发其他窗口。

过期错误明确此次点击未发送，要求空参数 observe 后重新定位新控件；已消费观察则先观察上次结果，勿直接重复点击。动作回执返回 nextAction=observe、retryAllowed=false；系统不自动刷新后复用旧坐标或重试未知动作。

Provider 的 observe / windows 单条结果预算提高为 40,000 estimated tokens，覆盖原生有界 128 控件＋12 KiB AX / 64 窗口最大中文标签，而非此前通用 1,024 tokens。正常预算交付完整的有界宿主结果，经原敏感内容清洗；不是无上限全树。上下文不足时采用专用投影：完整观察身份与 elementId / windowRef / 标签不截短，列表只按完整记录裁减并报告 elementsTruncated / omittedElements 或 truncated / omittedWindows，AX 独立缩短并更新 axTreeTruncated；完全省略 AX 时另标 axTreeOmittedForContext。连最小观察身份也放不下则明确失败，不向模型伪造可用标识。UI 保存并展示宿主有界摘要，低预算模型可见文本可能更短；真实 Provider 续轮的最大列表、中文 AX 和最小预算边界有自动化验证。

跨 Run 的执行事实中，只有可信内置 V2 `computer.observe` 使用同一专用投影，保留 scope / scopeScanComplete 与局部无坐标、无全窗完整性的语义；单项仍沿历史约 1,024 tokens 预算。范围损坏、缺少新范围必需的控件数组或预算不足时省略该条事实，继续保留更早的有效事实，不让旧记录阻断新 Run。历史 ID 不恢复操作许可。

共享许可、冻结窗口和最新 observation 只在 main 持有，绑定 owner、backend、library、WebContents、Session、Run、AI destination 与能力快照。观察 / 点击准备动作使用严格 V2 单窗口契约，新增文本 / 滚动动作使用各自的 V1 单窗口契约，均封存进既有执行 capability；旧 observe / click V1 屏幕动作仅保留历史解析，不可授权或执行当前窗口版操作。renderer 仅展示 main public action，不从模型 input 拼授权目标，也不能直接调用 helper。

所有观察/输入共用生产 runtime 的串行队列。窗口截图 helper 最多 15 秒、stdout 最多 12 MiB，返回有界 JSON/base64 后严格检查单窗身份、PNG 签名 / IHDR 尺寸、最长边 2048 与解码后 8 MiB 上限；取消会终止截图 helper，迟到结果不会导入附件。元数据 / AX helper 最多 5 秒；status/click 输出最多 4 KiB，windows/window-targets 输出最多 64 KiB。元数据最多 64 窗口 / 12 KiB 文本；单窗口 AX 扫描最多 128 候选、2048 节点、32 层路径、每节点 64 子项和 12 KiB 文本，公开 AX 窗口匹配最多读取 32 个窗口，扫描 deadline 3.2 秒。超预算明确 truncated，不能据部分候选猜测点击。只在获批的 window-targets 执行入口启用 OmniFlow 自身 Electron 可访问性支持，不在 import/status/windows/prepare 或单纯 capture 时启用，也不改第三方 App 的 AX 配置。停止取消尚未发送的操作，已经开始的 AX 动作等待原生回执结算，不因普通取消丢弃其结果。

OmniFlow 自身窗口被遮挡时，Electron 默认后台节流可能让控件状态已改变而截图和可访问性名称仍停在旧帧。正式获准观察在窗口复验后获取临时渲染租约：只有目标 PID 等于当前 main 进程、owner WebContents 对应 BrowserWindow、CGWindowID 精确一致时才调用 `setBackgroundThrottling(false)`。外部应用和其他窗口不改设置；prepare/status 不获取租约，不激活或置前窗口。同一 WebContents 引用计数并保存原设置，换目标、取消、观察失败或 Run 释放时归还，最后一份恢复原值。迟到释放和窗口销毁不触碰替代窗口；首次获取异常回滚并保留原错误。该租约只保证自有 renderer 能继续渲染，真实图像与 AX 更新仍需重新观察确认。

点击、文本和滚动进入既有 main commit settlement：`dispatched` 映射 `committed`，只代表 AX 调用返回成功；`not-dispatched` 映射 `uncommitted`，只用于实际写调用之前明确拒绝的情况。一旦进入 AXUIElementSetAttributeValue 或 AXUIElementPerformAction，所有非 success 返回均为 `unknown / commit_unknown`，不能据错误码判断没有副作用；本地诊断只新增数值 axError，不记录输入正文。不重试 AX、不补坐标点击。停止不抹去已发送或未知结果。工具提示重新截图核对，未知结果不能换新 ID 盲重试；历史恢复不重新授权或重放动作。

观察的 64 KiB JSON 上限同时计入窗口 / scope 元数据、候选完整记录、路径、能力与转义开销。候选按原扫描顺序保留完整前缀，超出部分标记 `truncated=true`；AX 摘要只使用完整封套剩余的编码预算，摘要截断独立标记，不因候选过大丢弃整次观察。

文字输入的隐私投影依据 Run 启动时冻结的可信内置注册身份，与模型过滤后的执行能力分离。即使模型不支持图片或返回被过滤的 `computer.setText` / Provider 名称 `computer_setText`，拒绝路径的 SQLite、IPC 和续轮历史也不保存输入正文；实际执行仍按原能力快照拒绝，不因隐私识别恢复工具权限。

## 图像与清理

截图通过既有 AttachmentStore 归一化到最长边 2048，并绑定 Session，维持当前 Run 的模型续轮图像。每 Run 最多 32 张、合计 64 MiB，同时服从附件的单文件 8 MiB、本机总量 512 MiB / 4096 文件限制。截图属于本机会话附件，停止释放共享许可和观察身份，不删除已保存的会话图片；永久删除会话时释放其图像，包括没有用户上传附件的截图会话。

导入或绑定后取消/失败会回滚新绑定并删除草稿。截图与屏幕文字作为外部内容，不授予操作权限。后续 Run 不继承共享许可，恢复历史也不自动重新发送旧截图。

连续的可信内置窗口观察 / 点击 / 文本输入 / 滚动合为一个操作折叠组，已有审批与错误仍保持可见，等待批准和 unknown 操作不混入普通组。Tool 记录展开后通过既有 owner/backend/library/session 绑定的附件预览接口显示真实截图缩略图；点击缩略图复用聊天图片大图预览，支持缩放和 Esc 关闭。折叠、隐藏工作区或切换身份后释放当前图片并拒绝迟到响应。可信 V2 单窗观察结果中的摘要以“AX”单独展开，截断时标注，正文使用有界滚动的纯文本 pre；收起或隐藏即释放正文。成功输入动作仅显示对应的一行“已发送点击 / 已发送文本输入 / 已发送滚动”，失败或 unknown 保留详情，不重复渲染成功回执正文；文本正文不进入展示。来源校验与受控展示契约见 [Agent UI](built-in-agent-ui-contract.md)。

## 原生与构建

- 平台 adapter：`electron/platform/computer-use/desktop-computer.ts`。`getAgentComputerWindows` 获取无像素的窗口元数据；`getAgentComputerWindowTarget` 只扫描绑定窗口；`captureAgentComputerWindow` 捕获该窗口。当前 Tool 不调用 `desktopCapturer.getSources`，因为它没有 source ID 过滤器，会为多个窗口刷新缩略图；不能先采集再在 JS 挑选，零尺寸也不作为严格无捕获保证。
- 原生 helper：同目录 `macos-click.swift` 承接窗口 / 捕获及共享基础，`macos-semantic.swift` 承接有限语义能力 / 输入，`main.swift` 固定分发命令。`--windows` 不调用 AX 或图像 API；`--window-targets` 接收严格单窗 JSON；`--window-capture` 用 `SCContentFilter(desktopIndependentWindow:)` 与 `SCScreenshotManager.captureImage`，只按冻结 window ID/PID/进程启动时间选择并复验窗口，拒绝 app-wide 或 display 过滤器。关闭光标、音频、窗口阴影和额外 child windows，保留完整窗口表面。`--status` / `--request-permission` / `--click` / `--set-text` / `--scroll` 使用固定 AX 契约，不执行任意 shell、不注入全局键鼠事件。
- 原有 `--targets` 与 Display adapter 仅保留兼容 / 自动测试入口，不属于当前公开 Tool 的观察范围，不是窗口捕获失败后的 fallback。
- `predev / prebuild` 调用 `tools/computer-use/prepare.mjs`，需要 macOS Xcode Command Line Tools，编译最低 macOS 11 的 arm64+x86_64 universal，按源码/script 哈希缓存。ScreenCaptureKit 自动弱链接且 capture 受 macOS 14 availability guard 保护；旧系统可运行 helper 的其他自检，不能执行新窗口截图。非 macOS 跳过。
- 开发路径为 `build/native/computer-use/darwin-<arch>/omniflow-click`；mac 打包资源路径为 `Resources/computer-use/omniflow-click`，通过 `mac.extraResources` 和 `mac.binaries` 接入现有签名流程。未执行本次签名或发布。

## 验证与限制

自动化覆盖严格 action / 审批投影、非视觉模型过滤、跨身份拒绝、单次/过期截图、Retina/负原点、权限自检期间几何变化/撤销、取消清理、输入回执、helper 固定启动与截图取消/超时。原生 helper 已完成双架构编译，33 个结构无效输入探针均以 `invalid_request / dispatched:false` 拒绝。另一个边界探针坐标笔误实际仍位于候选内部，进入只读 preflight 后因测试 PID 不存在而拒绝；不计入解析器验证，未查询目标窗口或执行 AX 动作。

此前显示器截图 / AX 修复与缩略图阶段的全量 lint、test、build 通过（463 个测试文件 / 3787 项通过，3 个文件 / 7 项跳过）。集成测试使用真实图片水化流程验证图像传给下一 Provider turn，且仅截图会话删除时释放附件；截图捕获/存储耗时计入有效期。这些记录不代替本次单窗口版本的验收。

单窗口 platform 当前 136 项 mock 通过，覆盖原有 AX 绑定与未知结算，以及无像素元数据、获准单窗精确身份、截图不退回 Electron / 显示器、不同 PID/启动时间/几何拒绝、base64/PNG/字节/尺寸预算、截图取消与 15 秒超时。定向 ESLint 和窗口版 smoke 的 `node --check` 通过；增加 SCK 的 Swift 已编译 arm64+x86_64 universal，确认弱链接。最终全量检查和本轮真机截图 / 后台动作结果由集成验收另记，未签名打包或发布。

真实闭环 fixture 位于 `tools/computer-use/smoke.cjs`，使用独立 userData、不含资料库的测试窗口。通过 `BrowserWindow.getMediaSourceId()` 的 CGWindowID 与本进程 PID 绑定该窗，`showInactive` 不要求前台；当前脚本只走单窗 capture，不用 fullscreen 覆盖整屏。`--capture-only` 验证窗口 PNG、不扫描 AX 或发送动作；普通模式还验证 AXPress 只改变一次业务状态并再次截取该窗。物理指针、前台 PID 与目标 App 自行改变焦点仍须单独检查，不能以原全局鼠标版的 trusted mouse event 断言代替。权限或目标不满足须明确 skipped / blocked，不采集或点击其他窗口。`--fixture-only` 仅验证本地渲染，不能计为 OS 窗口捕获成功。

2026-10-09 的独立完整 smoke 因测试 Electron 屏幕录制权限 `denied` 返回 blocked，在截图和点击前停止；fixture-only 渲染通过。亮暗授权卡完整真机交互、多显示器与签名安装包的权限归属尚未验收。后续资料库联调仍必须用本机 macOS MinIO 的非第一个资料库，优先 Win。

同日内部 Agent 联调限定开发版、win（libraryId=3）、真实 gpt-5.5 / medium 和测试 Session `0c43a3a4-94e3-49e7-ac30-dc24b4c415be`，选择“完全访问”。测试仅折叠/展开宿主目录树，不操作资料库内容。首次 Run `05c2d167-5ad4-48e4-8817-62be362dd0af` 及授权 Electron 后的重试 Run `7559e941-984d-46a3-9feb-1f71b9ec6567` 均有真实 `computer.observe`、`ask / approved` 记录，但因录屏预检失败停止，无成功截图或 `computer.click`；两次结果只能证明模型调用和批准链，不能计为点击通过。下一次测试继续使用开发版和完全访问；测试账号按用户要求仅保存在 git 忽略的 `docs/test-account.local`，不进入共享文档。

用户随后开启实际请求主体 ChatGPT/Codex 的屏幕录制权限。重启开发 Electron 后，标记 `COMPUTER_USE_QA_20261009_A_GRANTED` 的 Run `22e29c2d-6597-419f-aea5-ad05a987d120` 完成真实 `observe → click → observe`，三条 ToolRun 均 completed，初次共享 ask/approved，点击 dispatched/committed，目录树实际折叠并出现“展开目录树”。该结果验证早期全局鼠标版的真实闭环，不能证明当前 AX 后台点击版已手验。

用户发现鼠标争用后曾要求停止该轮实机测试，AX-only 修复阶段仅继续源码、编译与自动验证。随后用户要求共享后仅查看对应应用 / 窗口并恢复验证，形成当前窗口限定版本；新版本实机结果须单独记录，不能借用旧全局鼠标版通过结论。后续核验被遮挡窗口完整截图、前台切换后仍触发获准窗口按钮、物理指针不移动、目标自身焦点行为、移动 / 失效控件拒绝，以及缩略图亮暗和折叠生命周期。

新增 AX 摘要与 32 层扫描后，开发版 win（id=3、本机 MinIO）、真实 gpt-5.5 / medium 的 Run `dfa5e8c4-75bb-4bd5-a266-d6524a9566f7`（`COMPUTER_WINDOW_QA_20261009_H_AX`）完成当前 V2 的 `observe → click → observe`：三工具 completed，首次共享 ask/approved，两次同 targetId、2048×1257、`captureScope: window`，点击 `(123,26)` 为 AXPress dispatched/committed。批准后 Raise WebStorm 遮挡目标，随后第二张截图实际显示左侧资料库树收起，且两张大图只包含 OmniFlow，没有 IDE 或显示器内容。此轮没有其他 Tool 或资料库内容写入。

用户要求的 AX 对照在该轮实查通过目标和主要控件语义：CUA 的“切换按钮 / 折叠目录树 / Value:0”对应内置 `AXCheckBox description="折叠目录树" value="0"`，点击后两边均为“展开目录树 / 1”；另核对四个模式入口、返回库列表、上传中心、回收站、设置以及目录 Outline → Row → Button/Image/Text 的关系。CUA 会压缩无标签容器并本地化角色，原生摘要保留 AXRole 和额外容器，故比较角色、名称、状态和有意义的父子关系，不要求编号、缩进或全文字节相同。两次摘要为 12048 / 12173 UTF-8 字节且明确 `axTreeTruncated:true`；不能把这次匹配写成整棵完整树均已验证。

同一真实 Run 实查只有一个 computer-use 折叠组，展开为查看 / 已发送点击 / 查看；成功点击无详情按钮。两个观察各有真实缩略图和“AX · 已截断”，展开 AX 为纯文本树；两张缩略图均打开聊天附件共用大图预览（66%）且可以关闭。AX 预览的折叠 / 隐藏释放、来源防伪与独立预算有自动化覆盖；亮色、极窄布局、全部缩放交互与跨平台尚未逐项手验。

后续 Run `a7645840-a7d4-469d-a218-ee125834a02d`（`COMPUTER_WINDOW_QA_20261009_I_POINTER`）五步观察/点击均 completed。批准后实际聚焦 WebStorm 编辑器；两次原生 AXPress 诊断均 `frontmostKnownBefore/After=true`、`targetFrontmostBefore/After=false`、`frontmostChanged=false`、`pointerMoved=false`。诊断只读公开前台应用与指针端点并输出布尔，不记录 PID / 坐标、不发送新输入；只能证明该轮动作前后端点一致，不能排除用户并发短暂移动后返回原点，也不能保证其他 App 自身不会置前。

该轮反向恢复没有通过新图核对：第三图仍为收起状态，AX 值为 0、description 却仍为“展开目录树”；CUA 在后台读到的也是这组信息。把窗口置前并聚焦后才显示展开目录树和“折叠目录树 / 0”。内置 Agent 如实报告未通过，不能把两次 dispatched 或端点不变写成完整恢复成功。主窗口使用 Electron 默认后台节流，旧帧问题的修复和重新验收单独记录。

临时渲染租约与真实 Run abort 清理接线后，Run J `0b534949-caa1-432a-91be-0e6679dc147c`（`COMPUTER_WINDOW_QA_20261009_J_RENDER`）五工具全部 completed，首次 ask/approved。三份已保存的新窗口截图均为 2048×1257、同 targetId：左树展开 → 收起 → 恢复展开；三份内置 AX 为 `AXCheckBox` 的“折叠目录树 / 0 → 展开目录树 / 1 → 折叠目录树 / 0”，没有旧帧的名称/value错配。CUA 随后在未置前目标的情况下读到“折叠目录树 / 0”和相同目录 Row 与底栏按钮。三图只含 OmniFlow；末图在任务结束后任何置前操作前已落盘，不能归因于验收者置前刷新。两次点击目标前后均为后台、前台未变；第一次鼠标端点未变，第二次 `pointerMoved=true`，只能确认采样端点有变化，不能归因于 AXPress，也不能计入固定指针通过。

最终源码全量门禁 `npm run lint`、`npm test`（465 文件 / 4049 项通过，3 文件 / 7 项沿用跳过）、`npm run build` 通过。渲染租约 116 项专项和正式审批链增加的 3 项生产取消回归已纳入全量；后者覆盖首工具成功并断开 signal 转发后，stop / owner release / shutdown 仍同步释放租约，迟到截图不导入。首次获取异常回滚与独立只读 review 通过。未签名打包、发布或验证其他平台。

固定鼠标复测 Run K `69c6b466-a75d-4b47-8754-e6f8492e95f9`（`COMPUTER_WINDOW_QA_20261009_K_POINTER`）五工具 completed、首次 ask/approved；批准后实际聚焦 WebStorm 编辑器，直至运行结束没有操作目标窗口。23:35:41 / 23:35:48 两次 AXPress 均前台信息可用、目标前后在后台、`frontmostChanged=false / pointerMoved=false`。三图同 targetId、window scope、2048×1257，内置 AX 再次为“折叠/0 → 展开/1 → 折叠/0”；第二、第三张存储原图实看分别收起与恢复，且只含 OmniFlow。结束后未置前时 CUA 读到“折叠目录树 / 0”和对应底栏控件，与最终内置 AX 一致。摘要分别 12048 / 12173 / 12048 UTF-8 字节、明确已截断；该轮证实目标及主要控件语义和鼠标/前台端点一致，不宣称完整 AX 树或所有应用的焦点行为。

Run K 的展示复验只有一个五工具折叠组，依次三条观察、两条无详情的“已发送点击”。末次观察可展开真实缩略图与“AX · 已截断”，AX 展开是纯文本。缩略图共用聊天大图预览，实测放大 66%→76%、缩小回 66%，Esc 关闭并恢复缩略图焦点；收起任务过程释放详情。亮色、极窄布局、多显示器和其他大图交互仍未逐项手验。

## 第三方应用验收（2026-10-10）

本轮沿用开发版、win（libraryId=3、本机 macOS MinIO）、gpt-5.5 / medium 和完全访问，只让内置 Agent 调用 `computer.observe / computer.click`。未操作第一个资料库、安装版、资料库文件、系统权限或第三方驱动。访达仅打开本次在临时目录创建的一个测试文本文件所在窗口，不打开或编辑文件；计算器保留原计算与历史。

| 测试 | 真实结果与边界 |
| --- | --- |
| L：计算器，Run `f6281051-4f48-4c8a-acff-206603fd35ee` | 首次单窗观察成功，230×408、`clickReady=true`，AX 2628 bytes / 38 行且未标记截断。“显示边栏”点击返回 dispatched / committed，但重复按旧标题观察报“目标应用窗口当前不可用”。CUA 随后读到边栏仍关闭；不能计为业务动作通过。点击前后目标在后台、前台与指针端点未变。 |
| L2：计算器，Run `8a0997bc-d4a6-4df1-a528-31ce58ea67a4` | 仅传应用名时明确拒绝多个匹配窗口。没有点击，说明必须补窗口发现入口，不能由 CUA 的 AX 主窗口标题推定 CG 元数据中只有一个同名窗口。 |
| M：访达，Run `03060a04-ae37-41d7-b763-7daa688ec3ea` | 获准单窗截图成功且 `clickReady=true`；模型在截图约 85 秒后发起点击，超过 60 秒有效期，prepare 拒绝，未发送 AXPress。不能归为 AX 截断或第三方控件动作失败。 |
| N：访达，Run `cd934d32-35fe-47e5-8cac-5835a14222d1` | 新建短会话后五工具全部 completed，三份已保存原图实看“图标 → 列表 → 图标”，两次 AXPress dispatched / committed，完成恢复。 |

N 的 Session 为 `956cad52-9b78-40bd-a2af-fb996a8eb920`。首次共享 ask / approved，后续观察不传参数，沿用相同 target；三图均 `captureScope: window`、1259×649，只含测试访达窗口。AX 的图标 / 列表 value 为 `1/0 → 0/1 → 1/0`，摘要 8393 / 10238 / 8393 bytes 且均标记 truncated。10:08:33 / 10:08:51 两次原生点击前后目标均在后台、前台信息可用，`frontmostChanged=false / pointerMoved=false`；点击距新图分别约 3 秒和 14 秒。根 Agent 实看三份保存原图，结束后未置前目标读取 CUA，确认图标视图 value=1、列表视图 value=0 和测试文件图标，与内置 AX 一致。端点诊断仍不保证所有应用自身永不激活。

L 首图包含系统共享控件；模型选择的 `(49,26)` 位于截图共享图标，而可见边栏图标约位于 `(124,26)`。宿主却接受了 AXPress 候选，业务效果未确认。当前 AX 前扫 → 短生命周期 SCK 截图 → AX 后扫，不能排除截图期间标题栏共享控件改变布局、前后扫描又恢复的情况；这只是待验证解释，未确认根因，也未扩大为所有窗口均坐标错误。CUA 单独点击真正的边栏元素可以展开并恢复，已恢复计算器初始状态；该对照不计为内置 Agent 通过。

## 窗口发现与控件 ID 的本轮验证（2026-10-10）

窗口发现、windowRef、elementId、Provider 预算与恢复提示已经落地。Q 后的修复已通过真实计算器和访达的控件 ID 闭环；早期失败与新的业务结果分开记录，坐标版访达 N 不代替语义版验收。

- O / P：发现两份计算器窗口，精确 windowRef 能选到主窗口，单窗截图与未截断 AX 摘要正常；两个控件声明 Subrole 却返回读取错误，旧完整候选门槛使 `clickReady=false`，没有发送点击。P Run `11b7b5b0-962d-408a-b7e1-6791f0272d48` 的数值诊断为 37 节点、22 候选、两个 subroleReadErrors，既不是 AX 摘要截断，也不是权限拒绝。
- Q Run `5d73625a-0152-4e50-9596-99f20964fcbe`：部分扫描 ID 路径已有能力，但 AX 支持列表漏列 Description，导致 22 个控件全部被投影成同名 AXButton。模型错误选择第一个 ID，实际按了“删除”，显示值少一位；后续截图和 AX 识别到异常并停止。只发送一次 AXPress，本轮明确失败。原表达式、完整显示值和隐藏边栏状态已通过既有历史记录恢复，没有创建或删除计算历史；恢复操作不算内部 Agent 验收通过。
- Q 后修复：直接严读主要 Description、生产不采集非必要 Subrole；保留其他严格身份字段。公开 ID 只发给有可辨认 title / description 的稳定控件，匿名角色不发 ID。坐标仍使用未过滤的完整私有集合，扫描不完整或集合漂移时拒绝；否则不能因匿名子控件过滤而误选父控件。原生路径改为冻结索引前缀读取，其他兄弟超过上限不再让已确认目标不可复验。
- 用户随后明确暂停屏幕测试并锁屏；不继续读屏或点击，开发进程停止后只做代码、纯协议测试与构建。用户要求继续后恢复开发版，并先做只读观察，再测试控件 ID；测试始终使用 win（id=3、本机 macOS MinIO）、gpt-5.5 / medium、完全访问，没有新增系统权限或修改资料库内容。
- R 只读 Run `8216ffac-e3e5-4936-adff-a2f7af7f429a`：搜索返回主窗口与名为 Window 的小窗，按 windowRef 精确选择“计算器”。观察返回 22 个有准确标签的 ID，包含“删除”“显示边栏”“模式”；与 CUA 的同窗名称一致，AX 摘要未截断，扫描完整且两种点击能力可用。只执行 windows / observe，没有点击。
- S Run `749967a7-3f45-4088-aef2-8f0f7d27c215`：新的搜索和单窗批准后，按“显示边栏”ID 点击，空参数观察，再按新观察内“隐藏边栏”ID 点击并观察。六个工具 completed，两次 dispatched/committed；三份保存原图实见隐藏→显示→隐藏，原表达式和完整显示值保持，末次 CUA 同窗读取一致。展开时历史列表超过子项预算，AX 摘要和候选扫描均截断，坐标能力关闭，但独立确认的“隐藏边栏”ID仍可用。工具结束后的模型总结因 `net::ERR_CONNECTION_CLOSED` 失败，因此 Run 状态为 failed；业务操作与恢复已由原图、AX和回执确认，不能把该 Run 写为整体 completed，也没有重放点击。
- T Run `977929de-7b17-4780-832c-944e866f39ad`：搜索专用访达窗口 `omniflow-external-qa-20261010`，按 windowRef 批准，只用准确“列表视图”/“图标视图”ID完成六工具闭环，Run completed。三份保存原图实见图标→列表→图标，AX 内容区与单选 value 对应为图标/1→列表/1→图标/1；最终 CUA 后台读取一致，未打开、编辑、移动或删除文件。三次观察同 targetId、window scope，摘要标截断，独立候选扫描完整。
- S / T 四次原生点击的前台信息均可用，目标前后均在后台，`frontmostChanged=false / pointerMoved=false`。证据只比较发送前后端点，不证明持续零干扰或同一个应用内部状态隔离；目标应用自身可能改变焦点。计算器和访达原图只含获准窗口，不含遮挡应用或其他显示器。
- T 实看连续 observe→click→observe 合成一个折叠组，成功点击只有“已发送点击”且无详情；模型中间说明作为正常消息边界另起下一组。观察详情有真实缩略图和“AX · 已截断”，缩略图进入聊天共用大图（缩放按钮可见），Esc 关闭后焦点回到缩略图。
- 后续复核修复“非法/超预算候选被省略却仍报完整扫描”的坐标门禁，停止开发版后重跑全量门禁、重建 universal helper并重启。U Run `07ec78ff-d439-40da-ac16-a8d7acc4036d` 的计算器 ID 点击再次完成隐藏→显示→隐藏，三份保存原图和最终 CUA 确认数值保持。模型点击后两次显式复用旧 windowRef，因边栏改变窗口宽度被安全拒绝；重新 windows/observe 后确认实际状态，没有重复发送点击。点击后应优先 `observe({})`，windowRef 是选择时的冻结元数据，不能当永远有效的窗口句柄。U 后续只查询访达，尚未截图或点击时遭遇 `Upstream HTTP/2 stream failed`，Run failed，不能计为两应用整体完成。
- V Run `f7eaba03-f8d1-4788-8019-18538de05d49` 仅重新启动尚未执行的访达测试，六工具和 Run completed，按 ID 再次完成图标→列表→图标；点击后使用空参数 observe。三份保存原图、AX 内容区/单选 value 和最终 CUA 一致，未操作文件；结束仅关闭专用测试窗口，保留既有下载窗口。最终 helper 对计算器和访达均保守标部分候选扫描，`coordinateClickReady=false / clickReady=true`，准确 ID 闭环仍正常。
- U / V 四次点击均为目标后台、前台与指针端点不变；三图仍只有各自的获准窗口。上游网络偶发中断与输入回执分开结算，不能因模型总结失败重放已执行动作。本轮开发版最终停在 win 的 Agent 会话可继续使用。

自动化覆盖部分前扫/后扫及集合漂移时稳定 ID 可用、坐标 prepare/dispatch 双门槛、身份漂移拒绝、匿名控件不发 ID、完整匿名坐标可用、匿名子控件坐标命中不误选父项、空白 title 回退 description 保留原指纹，以及 Provider 对两种点击能力和扫描完整度的预算投影。原生属性和路径测试使用实际 Swift 纯策略源码与模拟读值，不调用真实 AX 或截图 API。最新门禁结果记录在[验证矩阵](frontend-validation-matrix.md)。

## 标准 AppKit 文本与滚动的 W2 实测（2026-10-10）

W2 Run `ae706994-bb65-4a1d-a6d4-a7124948dfcf` 取得两张 1000×632、captureScope=window 的标准 AppKit 夹具截图，但没有执行任何写动作。真实 TextArea / ScrollArea 的 AXEnabled getter 返回 attributeUnsupported，原来要求 Boolean true 的统一门槛使扫描标记部分结果且 elements 为空。此结果只能计为该夹具的单窗口捕获，不能计为文本或滚动验收通过，也不能据此认定 AX 文本 / 滚动 API 本身已经执行失败。

针对该兼容点，新增上述有限角色 / 能力下的 enabledState=absent 私有绑定与严格复验；不放宽显式禁用、真实读取失败或 press 的原门槛。修改后的文字闭环由下列 W3 单独验收，W2 不提供其通过证据；修后滚动 Z 仍未生效，另记实际结果。

## 文本 W3、滚动 X / Z 与外部输入的真实结果（2026-10-10）

W3 Run `d5aefeb5-95fa-4dc0-8ddf-4b0f8a5116c8`、Session `af23f334-401f-498b-9318-22043207165e` completed；八个工具均 completed，依次由一次 windows、四次 observe 和三次 setText 组成。四张保存原图均为 1000×632、captureScope=window，仅含标准 AppKit 测试窗口；实看初始状态 → 中文、emoji、两行与 TAB 的替换文本 → 插入 → 清空，最后 CUA 同窗读取为空。AX 保留实际 Unicode；夹具字体对 🪟 显示缺字 glyph，不将其当作字符丢失。replace 回执为 14 个 Unicode scalar / 27 UTF-8 bytes，insert 为 4 / 13，清空为 0 / 0。公开操作审计只含身份和 counts，没有 text / textHash。此轮 enabledState 窄兼容使 textReady / scrollReady=true，而 clickReady=false；滚动 readiness 不等于滚动验收通过。

W3 三次原生文本操作的目标前后均在后台，frontmostChanged=false、pointerMoved=false。结合原图、AX、回执及最后 CUA，确认该夹具的文本替换 / 插入 / 清空闭环；端点诊断仍不能证明操作期间持续零干扰、同窗口状态隔离或所有 App 兼容。

在最新开发版打开 W3 历史核对展示：windows 单独成卡，第一组连续三个 observe 与两个成功文本输入共五工具合组；成功输入仅显示“已发送文本输入”，没有详情按钮。模型中间说明形成正常消息边界，最后的 clear 与 observe 另起一组。说明中的参数拒绝发生在调用前，八个实际 ToolRun 均 completed，不能记为真实文本写入失败。观察详情显示真实缩略图与“AX · 已截断”；缩略图进入聊天共用大图预览，缩放控制可用，Esc 关闭并将焦点归还缩略图。AX 纯文本展开可读 QA TextArea；最后收起外层任务释放详情。本轮只核对该历史任务的这些展示路径，不代表所有页面视觉验收。

X Run `2675158b-bf13-493d-84a9-93ceceaf72c2` cancelled。三次 Page 请求实际进入 AXUIElementPerformAction，却被错误归为 not-dispatched / uncommitted；此前三次观察的垂直值均为 0。结束后验收者没有通过 CUA 发送滚动，仅读取到 vertical=0.06529651038321559，截图首部为 row009。该证据不能证明回调错误时没有副作用，也不支持将这些请求当作确定未发送后重放。后续已统一实际 AX 写调用的非 success 返回为 unknown / commit_unknown，调用前的明确拒绝保持原分类，并在本地增加数值 axError 诊断。验收者随后通过独立 CUA Scroll Up 将夹具垂直值从 0.06529651038321559 恢复为 0；该恢复不计内置 Agent 通过，W3 的 scrollReady=true 也不提供滚动成功证据。

修后 Z Run `79801ac5-4ad6-4682-8204-eb6924725f99` completed，五工具为 windows、初始 observe、恰好一次 down / page、两次后观察；scroll Tool failed，但 Run completed，没有重发。原生 17:37:07.902 的 scrollDownPage 已实际调用，返回 axError=-25205（attributeUnsupported），正确结算 unknown / commit_unknown、nextAction=observe、retryAllowed=false。三张 1000×632 保存原图仅含获准夹具；初始及两次后观察的两轴滚动条值均为 0，后两张原图实看 row001 未变，最终独立 CUA 后台 AX / 截图也为两轴 0、row001。目标前后均为后台，frontmostChanged=false、pointerMoved=false。此次失败不是过期、权限或 AX 截断导致的 prepare 拒绝；未知分类闭环已验证，滚动没有生效，四向 page / step 仍未通过真机验收。

控件声明 action 不保证真实回调可用，实际调用后的错误仍不能保证无副作用，故未知结果只重新观察、不重放。Z 阶段没有实现 AX 滚动条 Value 写入；随后 fraction 补齐另立明确策略与量纲，不能冒充 page / step，其本轮状态见前文。

未知分类修复冻结后的全量 lint / test 均通过，471 个文件 / 4420 项通过，3 个文件 / 7 项沿用跳过；专项 229 项和 Swift 双架构类型检查通过。最终 npm run build exit 0，arm64+x86_64 universal helper 已重建；构建日志为 `/tmp/omniflow-computer-unknown-final-build-20261010.log`，其余日志和历史版本区分见[验证矩阵](frontend-validation-matrix.md)。

TextEdit 发现测试 Y Run `2458c376-a9eb-416f-a54b-03d34216efdf` completed，但仅两次 application=TextEdit 的 windows 查询均为空，没有观察或输入，不计兼容通过。后续按 query=未命名 已发现应用标签为中文“文本编辑”的目标；实际观察见 Y2，不能将发现成功写为输入成功。

Y2 Run `a7a9e88d-d9c9-495f-bbc8-93384c3b593d` completed，只有 windows 与两次 observe 共三个工具。两张 603×505 图像均为正确的“文本编辑”临时窗口；扫描没有签发文本或滚动候选，descriptionReadErrors=1、firstAXError=-25200。没有执行写动作，只能计窗口发现与捕获，不能计文本 / 滚动兼容通过，也不能据此次扫描直接判定 TextEdit 的所有 AX 输入能力不受支持。

W3 / Z 轮次始终使用开发版及 win（libraryId=3、本机 macOS MinIO），未新增系统权限、启动安装版或使用第一个资料库。夹具最终确认文本为空、两轴滚动条值为 0 后关闭。TextEdit 仅使用该轮创建的空测试文档：测试阶段未保存；清理时为保留空产物，通过 GUI 另存到 `/tmp/omniflow-computer-qa-bUwOTZ/omniflow-textedit-input-qa.rtf`（219 字节）并关闭，没有删除文档，也没有写入用户文档；旧 autosave 是否移除未验证。该轮结束时开发版停在 win 的 W3 历史任务，任务已折叠且无 active Run；后续补齐前已退出该开发进程与旧夹具。

该轮已完成窗口发现 / 控件ID及标准AppKit、TextEdit文本编辑，page / step / fraction当时尚未通过。最新2026-10-12已补上AX-only、长文定位、TextEdit页子按钮往返、Finder按需截图及局部AX新ID点击/输入/翻页的后台闭环，外部step / fraction仍未验收，其他App / Electron / 网页编辑器不由这些结果推定兼容，状态见[本轮实际验收](#本轮实际验收)与[验证矩阵](frontend-validation-matrix.md)。交互长等待/取消和运行前 / idle 绘制的源码修复已完成，后续重点转为 GUI 复验、复杂应用失效节点以及按实际应用扩展快捷键 / 菜单；右键、双击和拖动尚未接入。稳定捕获会话与截图 / AX布局一致性继续按单应用验证；仅在明确未发送的过期场景重新观察，未知动作不重放。

调研证据与 Codex 的驱动边界见 [调研记录](agent-computer-use-research.md)。增加操作、平台或 AX 时继续复用主进程授权/生命周期，并扩展此契约和验证矩阵。
