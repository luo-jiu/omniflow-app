# 前端验证矩阵

## Agent 后台快捷键、右键、双击与拖拽（2026-10-12）

- 新增独立 `computer.input@1` 四动作，沿原 main-only 单窗授权与一次性观察，不扩大旧 `computer.click` 或历史共享许可。自动化验证新审批 `inputOperations`、both / ax / screenshot / focus 能力交集、字母数字 Command / Control 要求、图片像素到 Retina / 负窗口原点的 points 映射、100～1000ms 不同起终点拖拽、sealed request、Run / owner / TTL 漂移，以及真实 builtin Tool → registry capability → broker → runtime 的提交结算。原生协议与 fake-child 测试验证首发前零投递、每种部分发送边界的唯一 up、同 PID 换窗 / 重启不释放到另一接收者、SIGTERM 退出宽限、坏回执及迟到成功不覆盖 unknown；它们不证明应用消费。
- 独立 AppKit 夹具实际走 NSEvent / CGEvent / 单次 PostToPid，原公开坐标路线虽然进程收到事件，但 local point 在窗口外且 NSView 未收到。补充 private `CGEventSetWindowLocation` 后，`/tmp/omniflow-input-qa-UV0D47/` 的接收记录确认真实 rightDown / rightUp、doubleDown 和 Command+B 业务计数；首次拖拽被用户输入中断，唯一 cleanup up 且 tracking=false，只计部分执行。新夹具 `/tmp/omniflow-input-qa-WErAxX/drag.log` 完整拖拽圆点从 `(140,150)` 到 `(300,210)`，10 条事件含 8 次真实 MouseDragged、1 次 up，目标后台。`cancel.log` 在新动作 down 后主动 SIGTERM，unknown / cancelled、eventCount=2、releaseSent=true，leftUps 恰好增加 1、tracking=false，未跳向未执行终点。`focus.log` 同进程第二窗变成 key window 后，原窗 focused_window_mismatch / operations=[]、零派发。夹具不证明任意 AppKit / Electron / 浏览器兼容。
- 持续回归需分别核对目标未置前与物理指针、实际业务前后效果；在目标改变前台、物理 modifier / 鼠标按住、同进程切窗、secure focused element、原窗最小化 / 销毁、菜单 / sheet 出现、首发前后取消和权限撤销时只执行允许的释放收尾，不重放 unknown。短手势端点日志不等于整个回调期间持续隔离。菜单等新表面不自动属于原单窗许可，不能把“打开菜单”计为菜单选择通过。
- TextEdit 1.20 / build415、macOS 26.5.2 / build25F84 的生产 profile 为 `textedit-415-25f84-v1`，其他 App 或系统 build 不自动放行；开发夹具 `appkit-fixture-v1` 保留独立实验资格。最终 helper 实际确认 Command+A 选中全文、双击得到 selectedText=`bravo`、拖拽得到 `alpha bravo charlie delta`，三项序列与释放回执通过。右键确实打开上下文菜单，但新递归临时表面 guard 在序列边界中止，回执为 unknown / transient_ui_active、eventCount=2、releaseSent=true，不能计作 dispatched / committed 或菜单选择通过；没有重放。独立菜单 gate 场景返回 unknown / focused_window_mismatch、eventCount=2、releaseSent=true，紧邻只读 readiness 为 false / transient_ui_active / operations=[]；延迟 probe 已在菜单关闭后，不计为活动菜单拒绝证据。证据位于 `/tmp/omniflow-window-input-textedit-20261012/acceptance.txt`、`native-window-input.log` 与 `final*.receipt.json` / `menu-gate*.receipt.json`，与既有 TextEdit AX 文字 / 页滚动的证据分开。
- 最终 review 发现并修复释放未确认后可借新观察再次输入的缺口：门禁由原 main runtime 按 Run 持有，阻断后续四动作的 prepare / execute，新观察、旧封存动作、旧共享批准及换窗重批均不能绕过；保留观察和 AX。正常及迟到 `releaseRun` 清理不会复活门禁，也不会把 unconfirmed 改为系统释放确认。新增 9 项回归，修后专项 5 文件 / 427 项通过；root 复核新门禁、sealed/broker 回归与文档，未发现剩余代码问题。
- 修后全量 `npm run lint` / `npm test` / `npm run build` 均 exit 0：489 文件 / 5449 项通过，3 文件 / 7 项沿用跳过，测试开始 22:43:14、耗时 33.38 秒。build 已重建 arm64 / x86_64 universal helper；开发进程未启动，构建与 dev 串行。最终日志为 `/tmp/omniflow-window-input-release-final-lint-20261012.log`、`/tmp/omniflow-window-input-release-final-test-20261012.log` 与 `/tmp/omniflow-window-input-release-final-build-20261012.log`；此前 5440 项是门禁修复前的记录，不代替本次结果。本轮仅本地提交，不推送或发布。
- 本轮验收使用可丢弃夹具与 `/tmp` 新 TextEdit 文档，未访问任何资料库，没有扩大系统权限；尚未通过开发版真实内部 AI 的新 Tool GUI 回归、亮暗 / 窄窗展示、签名安装包或 Windows / Linux。后续 GUI 必须只用开发版、非第一个资料库，Win / libraryId=3 可用时优先使用并连接本机 macOS MinIO。

## 工作区绘制与交互等待修复（2026-10-12）

- 本轮修复了两个源码问题：可见 `AgentWorkspace` 在没有 Session / Run 时注册 main-owned 绘制租约，并在隐藏、作用域变化、导航、崩溃、销毁和退出时释放；`interaction.request` 使用可信内置 registration identity、独立 30 分钟等待期限、30 秒 settlement grace 以及 broker Tool `AbortSignal`。普通 Tool 的 30 秒默认行为未改变。
- 自动化覆盖工作区注册的可信 frame、替换、迟到 token、导航 / crash / destroy / shutdown、与 Run / 窗口截图引用计数共存，以及交互提交、过期、stop、owner release、创建竞态、broker 超时和冒充 Tool 身份。定向 8 个测试文件 295 项通过，TypeScript、相关 ESLint 和 `git diff --check` 通过。
- 独立 review 发现并修复交互已过期落库、异步回执迟到期间停止的终态缺口：保留 `expired / failed`，按同 owner / 库 / Session / Tool 的持久化记录补齐 result / finishedAt，不覆盖已有结果或放宽 Store CAS。补充立即停止、超过 broker 6 秒取消预算及 broker 超时取消回执迟到断言；13 项交互定向与 `tsc --noEmit` 通过。工作区绘制专项独立 review 未发现问题，真实 React layout effect 采样确认 scope 切换顺序为旧注册清理 → owner release → 新注册。
- 修后统一 `npm run lint` / `npm test` / `npm run build` 均 exit 0：485 个测试文件 / 5282 项通过，3 个文件 / 7 项沿用跳过，测试开始 16:35:48、耗时 27.26 秒。最终日志为 `/tmp/omniflow-workspace-interaction-final-lint-20261012.log`、`/tmp/omniflow-workspace-interaction-final-test-20261012.log` 和 `/tmp/omniflow-workspace-interaction-final-build-20261012.log`；独立复核未发现剩余问题。开发进程已停止，构建与 dev 串行；本轮仅本地提交，不推送或发布。
- 本轮未新增 GUI 真机验收；运行前键盘焦点、idle 画面是否拿到 compositor 最后一帧、签名安装包、其他平台和发行环境仍不由自动化结论覆盖。此前 SCROLL4 的 30 秒超时作为历史记录保留，不代表修复后的内置交互行为。

## Computer Use 阶段审查与提交（2026-10-12）

- 本轮审查覆盖原生窗口身份 / 单窗捕获 / AX 写操作、Run 与 sealed binding / 取消结算、第一方控件桥、Provider / SQLite / IPC 投影，以及分组、AX 与图片预览。确认并修复两处问题：模型过滤后的文字工具拒绝路径仍持久化 / 续轮发送输入正文；合法候选的完整 JSON 超过 64 KiB 导致整次观察失败。修后独立复核未发现新增问题。
- 隐私回归同时覆盖 `computer.setText` / `computer_setText` 被非视觉模型过滤后的 SQLite、IPC 和同 Run 续轮正文去除、prepare / execute 零调用，以及来源冒充 / 独立别名不升级权限。历史拒绝别名的 renderer 投影也去除正文与伪造动作，不新增内置来源标记；旧输入不进入新 Run 的历史事实或摘要，无需修改真实 SQLite。原生纯数据回归覆盖深路径、中文 / 转义、scope / 窗口元数据、严格输出边界和摘要叠加，超限仍返回完整候选前缀并标记截断。
- 修后统一 `npm run lint` / `npm test` / `npm run build` 均 exit0：480 文件 / 5191 项通过，3 文件 / 7 项沿用跳过，测试开始 15:13:38、28.71 秒。专项 audit / orchestrator 162 项、renderer 36 项、原生纯策略 3 项及 arm64 / x86_64 完整 Swift typecheck 通过；独立 `tsc --noEmit` 通过。全量日志为 `/tmp/omniflow-stage-review-final-{lint,test,build}-20261012.log`。开发进程已停止，构建与 dev 串行。
- 本地按原生模块（`ce084fe`）、Agent 执行 / UI（`e2b6b95`）及文档分批提交，不推送。该批未新增 GUI 验证，之前本机开发版 Win / libraryId=3 的真实验收范围保留，不扩大为任意 App 或持续指针隔离。当时留下的运行前 / idle 后台绘制及 `interaction.request` 通用超时，后续源码修复见本页“工作区绘制与交互等待修复”；签名安装包、其他系统 / 架构真机、通用快捷键与拖拽仍未验收或未实现。

## Agent owner Run 后台绘制（2026-10-12）

- 为真实active Run在started前取得自有owner绘制租约，与获准自有共享目标共用一个WebContents引用计数manager；不新增renderer状态 / 续期IPC / 系统输入或共享许可。Run abort同步归还引用，终态 / 启动异常 / owner释放 / shutdown清理；销毁 / renderer crash清timer与监听，live crash恢复原值。最后引用归零后250ms有界绘制收尾再恢复原设置，新获取取消pending恢复并沿用原值，迟到回调不影响替代contents。它只提供绘制机会，不保证React终态或compositor最终帧ACK。
- 专项lease / runtime / orchestrator共467项、定向lint与tsc通过，独立只读复核未发现新增问题。统一lint / test / build均exit0，480文件 / 5184项通过、3文件 / 7项沿用跳过，27.80秒；日志 `/tmp/omniflow-computer-owner-render-{lint,test,build}-20261012.log`，build与dev串行。全量后补充启动失败资源清理断言时，发现frozen broker不可spyOn；仅测试改用真实注册生命周期核对，最终orchestrator147项、该文件lint / tsc均通过，生产未变，未签名或发布。
- 修后dev在发送任务之前仍存在旧帧与键盘焦点初始化问题，用户短暂点击开发窗口 / Agent输入框后才完成GUI提交；该阶段尚无active Run，不计入owner Run租约的覆盖。TEXT3 / SCROLL4启动后，正式首个共享批准卡、进度、等待核验卡与终态均自行更新，无再次人工刷新。SCROLL4结束后展开AX及点击缩略图，AX状态已更新为大图控件，但后台截图仍停留旧帧；idle已恢复默认节流，不计active Run回归，也不能称所有阶段绘制均解决。本轮未为idle预览新增租约。
- SCROLL4末尾`interaction.request`出现可见等待卡，但未提交，36.012秒后被broker默认30秒执行超时及6秒取消收敛中断，Run随后completed。准确错误为“工具 interaction.request 执行超时”，不是交互自身30分钟TTL。只读定位确认工具未声明timeoutMs，requestInteraction闭包沿外层Run signal等待，未使用broker替换的tool signal；待独立修复host-only等待预算与取消传递。本轮不计交互提交通过。

## Agent 局部 AX 观察（2026-10-12）

- 按用户安排停止自有 dev，锁屏期间只写代码和运行自动检查；未调用 CUA、捕获屏幕、输入或触发系统权限，完成后不自动启动开发版。
- `computer.observe.focus` 以最新有效的原生控件 ID 为锚点，读取自身或最多三级父区域；精确窗口 / Run / owner / TTL / 单次消费、完整原生指纹及父链复验保留，旧helper、越界、身份漂移或取消拒绝，不退回全窗。局部完整不升级全窗完整、匿名唯一标签或坐标权限，不混全窗第一方控件；both 图片仍为同一获准整窗。
- 自动验证覆盖 focus schema、scope越权 / 过期 / 已消费 / Run释放 / 窗口变化、区域回执 / 候选前缀、锚点指纹 / secure / web父链、绝对路径 / 深度 / 时间预算、跨区域或模式的diff baseline、Provider全量及预算缩减下的范围信息、旧结果兼容和AX局部标签 / 展开生命周期。原生纯策略和mock仅验证契约，不能替代实际AX效果。
- 最新统一 `npm run lint` / `npm test` / `npm run build` 均exit0，独立 `tsc --noEmit` 通过；480文件 / 5156项通过、3文件 / 7项沿用跳过，测试开始12:39:44、24.80秒。日志 `/tmp/omniflow-computer-focus-final-{lint,test,build}-20261012.log`；构建已重建arm64 / x86_64 universal helper，未启动dev、签名或发布。工具说明增长触及既有小上下文fixture边界，精简windows / observe重复表述后全文件与全量回归通过，没有增加预算或放宽断言。Provider历史观察沿约1024tokens单项预算保留范围，损坏/不足预算仅省略该条事实、不阻断当前Run。
- 解锁后仍只用开发版及win / libraryId=3 / 本机macOS MinIO。WebStorm AX1 Run `5547e177-f1bd-4fb6-924f-6b11a8adf672` completed：windows + 4 observe，无写动作。全窗125控件 / 摘要截断；以 `agent.types.ts`（`src/shared/agent`）准确AXRow为锚点，focus自身得到同名AXRow / AXStaticText共2控件、233 UTF-8 bytes且摘要未截断，与独立CUA一致。上溯2级和1级各96控件、摘要仍截断，和全窗按label / role / operations比较新增0，不计找回漏扫或修复“结构”按钮。四次scopeScanComplete均false；局部candidateScanComplete / coordinateClickReady均false，新ID逐观察轮换。最后both保存的2048×1058原图实看仅含整WebStorm获准窗口，不是局部裁图或整显示器。证据 `run-focus-ax1.json` 位于 `/tmp/omniflow-computer80-evidence-20261012/`。
- 计算器 CLICK2 Run `2a606291-4eed-4b54-8318-5c9871546d4b` completed：8工具，5次AX-only观察和2次V3点击；全窗边栏查询→focus自身→局部新ID点击→重新全窗→focus自身→局部新ID恢复→全窗确认。标签闭环“显示边栏→隐藏边栏→显示边栏”，无imageId，局部摘要均未截断，scopeScanComplete / candidateScanComplete / coordinateClickReady均false。两点击dispatched / committed、axError=0，均引用紧邻局部观察的新ID；目标前后后台、frontmostChanged=false，第1次pointerMoved=true、第2次false，只说明采样端点，不能归因驱动或称全程指针不变。独立CUA确认边栏关闭及原表达式 / 完整显示值保持。首个observe有正式ask / approved持久记录，记录不能识别批准人的具体点击来源。
- 本轮首个共享等待批准和Run终态展示发生后台旧帧，用户点开发版窗口后刷新；现有获准目标绘制租约没有覆盖首个批准等待阶段。停止已完成Run的开发进程后补充owner Run绘制租约，后续统一门禁及输入 / 滚动与审批卡刷新验收另记。WebStorm失效getter仍保持未通过，局部扫描不保证能修复。通用快捷键、右键 / 双击 / 拖动未实现，也未增加系统键鼠fallback或可见假光标。

- TextEdit TEXT3 Run `cc017160-07a7-4b1b-bbab-224bf5462c5b` completed：15工具、14成功；3次focus自身分别签发新正文ID，紧邻的两行Unicode替换、追加、80行替换均dispatched / committed、axError=0，无unknown、不走第一方桥。三写目标前后后台、frontmostChanged=false，pointerMoved依次false / false / true，末次不作归因。没有派发scroll。第15工具focus引用第13观察，而第14观察已经替代它，执行前以`observation_not_latest_or_wrong_window`拒绝；是旧ID安全拒绝，不是TTL或滚动驱动失败。10张图均253×46，保存图与独立CUA确认真实测试窗口被缩至一行高，没有合法页子按钮；验收者仅调整可丢弃窗口尺寸后继续新Run。
- TextEdit SCROLL4 Run `3654ae0c-98ac-41c1-b337-a2bfd771f80a` completed：12工具，前11成功、最后交互超时。局部上溯1层观察→新ID下/page，局部自身观察→新ID上/page，局部正文自身观察→新ID空值replace，三写全dispatched / committed、axError=0、无unknown。7张675×441保存原图逐张实看仅含获准TextEdit整窗；首可见行01→30→01→空白，局部观察仍不裁图。三写目标前后后台，frontmostChanged / pointerMoved均false，仅证明采样端点。局部scopeScanComplete / candidateScanComplete / coordinateClickReady均false，清空后全窗扫描完整。独立CUA读空白与滚动值0，GUI保存并关闭临时文档，磁盘确认0字节；清空计内部Agent成功，保存/关闭仅验收清理。
- 暗色UI实测：TEXT3成功连续observe / setText同组，旧ID失败卡独立；SCROLL4连续observe / scroll / setText同组，失败交互为边界。成功输入/滚动只显示操作行，无详情。局部详情有真实整窗缩略图，“AX · 局部 · 已截断”与“AX · 局部”分别对应摘要；展开说明控件自身/上溯1层与局部扫描不完整。TEXT3缩略图复用聊天大图、缩放按钮与Esc关闭/焦点回到缩略图通过；SCROLL4终态后的大图AX已出现但后台画面旧帧，视觉不另计通过。未覆盖亮色、窄布局或所有历史图片。
- 证据位于 `/tmp/omniflow-computer80-evidence-20261012/`：`run-focus-text3-summary.json`、`native-semantic-focus-text3.json`、`text3-image-paths.json`，以及对应scroll4文件。原输入正文不写入工具参数审计；限定结果不推定WebStorm失效getter、外部step / fraction或任意App兼容。

## Agent AX 优先与长文编辑（2026-10-12）

- 只用开发版、win / libraryId=3、本机 macOS MinIO；通过 CUA 发任务并批准准确测试窗口，由内部 Agent 执行。没有扩大系统权限或要求目标窗口置前。
- AX-only AQ `b4cbdf21-3361-4bad-b466-468aaa285af1` completed：10 个 ToolRun，3 次成功 mode=ax 观察、2 次 V3 语义点击、3 次窗口发现，另有 2 次旧 windowRef 因边栏改变窗口宽度被拒绝，均未派发。真实边栏关闭→显示→关闭、独立 CUA 核对恢复；该 Run 无截图附件。两次点击原生端点均 known / target 后台、frontmostChanged=false、pointerMoved=false；只证明端点。展开组后 V3 点击为无详情操作行；AX-only 详情仅 AX 与白名单控件，展开 AX 可读，没有截图缩略图。
- TextEdit AR `9795bf48-b8d7-4507-b745-a2daf3d9c1f1` completed：6 工具、80 行中文 / emoji replaceText 成功；长文后 textReady=true，能继续定位可见文本区域。唯一 scrollDownPage 实际调用返回 axError=-25205，正确结算 unknown / commit_unknown；Agent 只再观察并停止，未重发。保存图像与独立 CUA 均仍显示文首，不能计滚动通过。文字调用前后目标后台、前台未变，指针端点有变化，不能归因于驱动或称该次指针未变；未知滚动端点均未变。
- 独立文本 AS `67719a66-048b-49c8-a181-bc07ce0b2e0a` completed：8 工具、3 写全 completed，真实长文后两行中文 / emoji 短替换→按冻结选区插入→空值清空。四份保存原图与独立 CUA 一致，插入在第二行末尾；三写 axError=0、目标前后后台、前台和指针端点未变。AR / AS 的7张673×439保存原图逐张实看只含获准 TextEdit 窗口，未包含遮挡窗口或显示器。清空由内部 Agent 完成，验收者 CUA 保存，临时 txt 磁盘0字节。
- AX-only / screenshot-only / both、观察内查询 / 分页与有限变化、V3 strict action、长文可见区域及 UI 可信展示已通过自动化。正式 orchestrator 测试覆盖真实 registry→共享审批→runtime→持久化→Provider：AX-only 无捕获 / 附件读写，screenshot-only 无 AX 扫描且实际附件送 Provider。原生能力与调用采用 fixture/mock，不能据此替代上述真机验证。
- 本批源码门禁 lint / test / build 均 exit0；476 文件 / 4947 项通过，3 文件 / 7 项沿用跳过，universal helper 已编译。日志 `/tmp/omniflow-computer-ax-modes-{lint,test,build}-20261012.log`；白名单 Run 证据 `/tmp/omniflow-computer80-evidence-20261012/runs-aq-ar-as.json`。后续扫描优化的最新门禁与实机结果另记，未签名或发布。
- 后续有界 BFS 与 debug-only 滚动条子控件诊断完成后，停止自有 dev，再执行最新 lint / test / build，均 exit0；477 文件 / 4948 项通过，3 文件 / 7 项沿用跳过，46.61秒。日志 `/tmp/omniflow-computer80-final-{lint,test,build}-20261012.log`，universal helper 重建后仅重启开发版。BFS 生产纯策略回归验证大分支饥饿、原路径解析及节点/候选/文本/层级/子项/deadline预算；诊断纯策略验证固定类别、Enabled缺失门控、跨进程/窗口、web/secure/循环/深度和8次额度。诊断不新增动作能力。
- 最新 WebStorm AT `de4868dc-0a08-4272-aa8d-9c4b02d00489` completed：windows + AX-only query=结构 两工具，totalMatched=0、candidateScanComplete=false；未点击、未截图，独立 CUA 确认 IDE 状态没有改变。BFS 扫描304节点 / 128候选 / maxDepth7，仍有 Role / Actions getter 的 invalidUIElement=-25202；不以 BFS 回归通过推定 IDE 目标定位通过。
- TextEdit AU `88eb4409-69c8-4d4b-847e-100def26fead` completed：6工具、长文replace / clear两写成功，三份673×439单窗原图确认初始空白→80行→空白，CUA核对并保存空文件；没有发送 scroll。两次长文扫描的子控件诊断一致：增页 childKind3 声明真实 AXPress，立即父为同PID、enabled=true的竖轴ScrollBar，父链回到精确获准Window，实际子矩形在window内且parent包含；父矩形超window。箭头及减页子矩形当时invalid。此证据仅用于后续窄页按钮路线，不证明滚动有效。日志与Run证据在 `/tmp/omniflow-computer80-evidence-20261012/`。
- 新 `native-scroll-button-v1` 仅开放真实增页/减页子按钮对应方向的一次 Page operation，冻结父条轴向与真实父/子矩形，观察 / prepare / final 复验，不授press、不发送系统事件。三组纯Swift策略回归、双架构类型检查和TS/runtime定向699项通过，跨层复核未发现问题。统一最新 lint / test / build 均exit0，478文件 / 5035项通过、3文件 / 7项沿用跳过，26.66秒；universal helper已重建。日志 `/tmp/omniflow-computer80-page-final-{lint,test,build}-20261012.log`。全量门禁发现工具说明增长使两项小上下文预算回归提前超限，精简重复说明节省估算225 tokens后修复；未增预算或放宽断言。以下真机结果独立于源码门禁。
- TextEdit AV `138cc46b-dcae-4515-a6c7-22d77c93b6d2` completed（11:39:05～11:40:22），10工具 / 4写全completed、dispatched / committed：空白→80行→只选同截图右侧竖条的native-scroll-button下/page→首可见行01变30→新观察上/page→恢复01→新正文ID清空。验收者逐张实看5张673×439保存原图，只含同一批准窗口。长文后三次观察均candidateScanComplete=false / axTreeTruncated=true，位置派生标签保留真实子矩形而不宣称唯一。4写原生axError0、端点known、target后台、frontmostChanged=false / pointerMoved=false；此窄页按钮路线的真实往返通过，旧ScrollArea unknown和外部step / fraction未通过事实保持。独立CUA读空、保存0字节并关闭临时文档；Tool input不保存text。证据 `run-av.json` / `semantic-input-av.log` 位于上节证据目录。
- Finder AW `1bed1841-87b8-4898-b925-19b363226e8f` completed（11:44:26～11:45:44），6工具 / 2写全completed、dispatched / committed。新建合成目录窗口（40文件 / 3目录），首次AX-only query=视图返回4个准确AXRadioButton / press，无图片；V3点击列表→both保存图确认列头/文件列表→新ID V2点击图标→both保存图确认网格恢复。2张1259×649原图逐张实看只有获准窗口；三次观察partial / AX截断，准确控件可用，不扩大成全树完整或任意IDE兼容。2点击原生axError0、前后target后台、前台与指针端点不变；独立CUA确认图标值1 / 列表值0后关闭新建窗口。仅切换视图，没有打开或修改文件。证据 `run-aw.json` / `native-click-aw.log` 在同目录；没有扩大系统权限、置前目标或使用安装版。

## Agent 第三方简单 / 复杂应用抽样（2026-10-11）

- 只用开发版、win / libraryId=3、本机macOS MinIO；通过GUI让内部Agent执行5个Run / 16工具 / 3写，各Run已结束。用户正常使用Codex，不要求目标置前。本轮仅测试 / 文档，无源码修改，没有重复lint / test / build；沿用下一节最新原生诊断版本门禁。
- 计算器AP `5e3c251a-1fec-4830-b2c1-54c0bf78a7e0`：边栏开 / 关2次点击均committed，3张原图与独立CUA确认往返恢复；该控件后台闭环通过。
- TextEditAM `e789a881-b03c-4852-a9b6-b21198514bcc`：空临时txt替换80行中文 / emoji committed；4张原图与CUA确认写入。长文后文本候选bounds校验拒绝，textReady / scrollReady=false；未完成后续短替换、追加、清空或滚动。验收者CUA清空 / 关闭后临时文件0字节，清理不计内部Agent通过。
- WebStormAO `f06902fb-3792-41ad-acf4-e5afc8ce30e5`：精确发现 / 单窗观察及主要AX界面对应；“结构”按钮无ID，未点击。127个press候选来自Row / StaticText，另1个TextArea声明文字能力；不能说全部无press，也不能据textReady推定输入通过。scrollReady=false，IDE未改。
- ChromeAN / AN2：仅窗口发现，宽查询找到3窗但没有CUA当前W3C测试页标题；未observe或点击，原因未确定，浏览器控制尚未验证。测试标签关闭并恢复原标签；file协议的CUA策略拒绝不计OmniFlow失败。
- AM文字与AP两次点击的原生端点均known / target后台、frontmostChanged=false、pointerMoved=false；8张window原图逐张实看只包含获准窗口。仅端点结论，不声明持续零干扰。外部AX滚动仍未通过。RunID、候选诊断和证据位置见[第三方抽样](agent-computer-use.md#第三方应用抽样2026-10-11)。

## Agent 第一方后台文字与滚动（2026-10-11）

- 最新AL Run `5a6ceebd-2534-40fc-80d5-b75a3877ee5d` completed（本地10:47:24～10:50:00）：19工具 / 9写全部completed、omniflow-control/dispatched/committed。9次原生实时两端known=true / active=false，指针端点均已知且未变；旧活动事件与window焦点仍true，因此不能单独据它们判断前台。10张2048×1058、同target的window原图逐张实看两行中文/emoji替换、末尾追加、清空及上下page/step/fraction三对真实移动与恢复，仅含获准OmniFlow窗口。限定第一方后台闭环通过；不证明全过程持续隔离、同控件并行编辑或其他软件兼容。
- AL结束后独立CUA核对空草稿、任务结束、一个19条computer组；3文字 / 6滚动为无详情操作行，observe展开有缩略图及AX截断标签，缩略图打开聊天共用大图预览并实看同一单窗图像，最后关闭预览 / 收起过程。Tool input未保存text参数。证据副本 `/tmp/omniflow-first-party-native-background-qa-20261011/`、日志 `/tmp/omniflow-first-party-native-background-dev-20261011.log`；临时目录可清理，持久Run / 附件按RunID追查。
- 当前源码接入主窗口固定“Agent 输入 / Agent 对话区域”，source=omniflow-control；沿原共享批准、sealed prepare、一次观察消费和结算，不增加通用桌面输入 IPC，不授第一方press或任意脚本。文本走唯一草稿revision CAS，滚动走已有scroll/follow owner，page=一可视高度、step=40 CSS像素、fraction=真实可滚动范围10%。
- 最终源码门禁 `npm run lint` / `npm test` / `npm run build` 均exit0：475文件 / 4790项通过，3文件 / 7项沿用跳过，测试开始00:54:28、31.14秒。日志 `/tmp/omniflow-first-party-geometry-final-lint-20261011.log`、`/tmp/omniflow-first-party-geometry-final-test-20261011.log`、`/tmp/omniflow-first-party-geometry-build-20261011.log`；定向跨层review 215项通过、未发现问题。build与dev串行，保留原未提交改动。
- 原生实时诊断版本门禁（10:44:53）：lint / test / build均exit0，475文件 / 4826项通过、3文件 / 7项沿用跳过，29.05秒；platform306项、bridge59项及只读跨层review通过。日志 `/tmp/omniflow-native-activity-lint-20261011.log`、`/tmp/omniflow-native-activity-test-20261011.log`、`/tmp/omniflow-native-activity-build-20261011.log`。build前停止dev，完成后仅重启开发Electron。
- AF / AG：真实内部Agent各7工具，第一方输入replace两行中文/emoji、insert追加、replace空值均dispatched/committed；原图实看和独立CUA确认Composer变化与最终空值。window focused=true，不能计为后台通过。
- AH / AI：有效引用被准备态Run guard、临时工具行几何变化依次拒绝，全部在dispatch前。修复复用active Run判定、可信initial preparing归组和31px稳定过程状态占位；不放宽geometry、权限、CAS或unknown分类。AI诊断真实extent增加35 CSSpx、top变化31 CSSpx，身份 / 正文revision未变。
- AJ Run `e46975cf-5b58-4da5-b8e6-7f969342cca5` completed，13工具全部completed：上下page、上下step、上下fraction 6写，回执均omniflow-control/dispatched/committed。7张window原图逐图确认三种单位的真实移动与往返恢复；独立CUA核对完成、空草稿、一个13条computer组、成功滚动无详情、观察缩略图 / AX截断标签与共用大图预览。6写鼠标端点未变，应用前后均active=true，不计后台通过。
- AK Run `6c1ae81e-5c83-45ad-a263-c2bdbb05b0d1` completed，19工具 / 9写全部completed、omniflow-control/dispatched/committed；10张2048×1058 window原图逐图确认三写文字与三对滚动，最终CUA为空草稿、任务完成。用户持续在Codex使用电脑且报告窗口覆盖，但9次事件投影active=true、window focused=true、pointerMoved=false，后台焦点证据未闭环，不能以缓存否定用户场景。
- 为此新增debug-only原生实时端点：无输入固定 `--parent-activity` 读取NSWorkspace当前前台与getppid比较，只回known/active；500ms / 512B、失败unknown，不fallback事件缓存。pre等待后重新核对绑定，post用独立signal，失败不改变回执。遮挡 / window.isFocused仍不足以证明后台，端点也不证明持续零干扰。只用开发版、win（libraryId=3、本机macOS MinIO），仅空草稿合成文字且不提交；第一方滚动成功不代替外部AX page/step/fraction兼容性，后者仍未通过。

## Agent 文字输入、滚动与内部模块（2026-10-10）

- 已实现 `computer.setText` 的 replace / insert / 空值清空，以及 `computer.scroll` 的 up / down / left / right × page / step / fraction；新增 fraction ABI 的全量门禁通过，内置 Agent 验收未完成。仅操作观察内实际声明能力的原生 AX 控件；不使用全局键鼠、剪贴板、焦点设置或任意动作名。page 必须是真实翻页动作，step 必须是对应方向的滚动条增减动作，fraction 移动已确认 AX 数值范围的 10%，三者不互相冒充。
- 独立内部模块由纯 shared computer-use contract、main 单窗 platform facade 和固定 Swift helper 组成；平台不导入 Agent 会话 / 权限 / UI。Agent adapter 继续独占 Run 许可、60 秒一次性观察、私有指纹、附件与提交结算，无桌面输入 IPC，也不增加独立服务或发布包。
- 文字原文只参与 main 私有准备 / 执行 / seal；操作参数审计、SQLite、审批、renderer 事件及后续模型工具历史只含目标、模式与字符 / 字节计数。原始敏感检查保留；用户聊天和获准截图遵循既有规则，可能包含测试文字。普通工具的完整输入不受此投影影响。
- 自动验证覆盖实际 orchestrator / SQLite 的 allow / ask 链、原文执行与公开投影、同长度不同原文 seal、旧点击许可不扩权、操作能力 / 选区 / 可选字段存在性漂移、过期 / 单次观察、取消结算、未知回执不误报成功、非点击子控件的坐标阻断，以及完整稳定扫描中唯一匿名同轴滚动条的签发。
- AXEnabled 窄兼容修复冻结时的全量 `npm run lint` 与 `npm test` 通过：471 个文件 / 4419 项通过，3 个文件 / 7 项沿用跳过；该版本 `npm run build` exit 0，arm64+x86_64 universal helper 已重建，专项 228 项、runtime 138 项、Swift 双架构类型检查和独立 review 通过，临时 AppKit fixture 已编译。历史日志为 `/tmp/omniflow-computer-enabled-final-lint-20261010.log`、`/tmp/omniflow-computer-enabled-final-test-20261010.log`、`/tmp/omniflow-computer-enabled-final-build-20261010.log`，不代替下列 AX 写后未知分类修复的门禁。
- AX 实际写调用后的未知分类修复冻结后，最终全量 `npm run lint` / `npm test` 均 exit 0：471 文件 / 4420 项通过，3 文件 / 7 项沿用跳过，测试开始 17:22:14、耗时 30.33 秒。最终 `npm run build` exit 0，arm64+x86_64 universal helper 已重建；专项 229 项、Swift 双架构类型检查及定向 ESLint 通过。最终日志为 `/tmp/omniflow-computer-unknown-final-lint-20261010.log`、`/tmp/omniflow-computer-unknown-final-test-20261010.log` 与 `/tmp/omniflow-computer-unknown-final-build-20261010.log`，滚动实测结果以 Z 为准，不能借用 X 的未知副作用作为通过证据。
- 首轮真机 W2 `ae706994-bb65-4a1d-a6d4-a7124948dfcf` completed，但只执行 windows / observe / observe；两张保存原图均为 1000×632、window scope，仅包含测试 AppKit 窗口。标准 TextArea / ScrollArea 有实际文本 / 翻页能力，但 AXEnabled getter 不支持，旧统一 enabled=true 门槛使扫描 partial、elements=0、textReady/scrollReady=false；未发送任何写动作，不能计为输入 / 滚动通过。此前重复提问在共享批准前取消，同样无写动作。
- W2 后加入私有 enabledState=enabled/absent：仅确认 getter 的 attributeUnsupported / noValue 且 nil，且原生 TextArea 有实际可写文本能力或 ScrollArea 声明真实 Page 动作时允许 absent，剔除 press；false、错误类型、成功 nil 及真实读取错误仍拒绝。state 的存在性 / 值在前后观察与正式 dispatch 严格复验，不能把缺失改为启用后继续用旧 ID。修后原生检查、专项回归与最终全量门禁通过；文字 W3 与滚动 Z 分别记录，不用 W2 代替修后真机验证。
- W3 Run `d5aefeb5-95fa-4dc0-8ddf-4b0f8a5116c8`、Session `af23f334-401f-498b-9318-22043207165e` completed，windows 一次、observe 四次、setText 三次，共八工具全部 completed。四张保存原图均为 1000×632、window scope；实看初始 → 中文 / emoji / 两行 / TAB 替换 → 插入 → 清空，最后 CUA 同窗读为空。AX 保留 Unicode，夹具字体的 🪟 缺字 glyph 不计字符丢失。replace 的 scalar / bytes 为 14 / 27，insert 为 4 / 13，清空为 0 / 0；操作审计只含身份与 counts，无 text / textHash。textReady / scrollReady=true、clickReady=false，三次原生文本操作均目标后台、frontmostChanged=false、pointerMoved=false；只证明该夹具文字闭环和端点，不证明持续隔离或滚动成功。
- W3 最新开发版历史展示实看：windows 单独卡，首个连续组为三个 observe + 两个成功输入，共五工具；成功输入仅一行“已发送文本输入”，没有详情按钮。模型中间消息形成正常边界，末次 clear + observe 另起组；参数拒绝在调用前，八个实际 ToolRun 均 completed，不能记为真实 write 失败。观察详情显示真实缩略图及“AX · 已截断”，缩略图复用聊天大图与缩放控制，Esc 关闭后焦点回缩略图；AX 纯文本展开可读 QA TextArea。最后收起外层任务释放详情，仅此历史任务路径通过，不宣称全页面视觉手验。
- 滚动 X Run `2675158b-bf13-493d-84a9-93ceceaf72c2` cancelled。三次 Page 实际进入 AXUIElementPerformAction，却错误返回 not-dispatched / uncommitted；前三次观察垂直值均为 0。结束后 CUA 未发送滚动，仅只读到 vertical=0.06529651038321559，截图为 row009，不能证明回调错误无副作用。后续已将所有实际 AX 写调用后的非 success 返回统一为 unknown / commit_unknown，点击也复用；调用前的明确拒绝不变，本地日志新增数值 axError。之后验收者独立 CUA Scroll Up 将垂直值从 0.06529651038321559 恢复为 0，此恢复不计内置 Agent 通过，不重复发送未知请求。
- 修后滚动 Z Run `79801ac5-4ad6-4682-8204-eb6924725f99` completed，五工具为 windows / observe / 恰好一次 down-page / observe / observe，scroll Tool failed 但 Run completed，没有重发。17:37:07.902 的原生 scrollDownPage 返回 axError=-25205（attributeUnsupported），正确结算 unknown / commit_unknown、nextAction=observe、retryAllowed=false。三张 1000×632 图像只有夹具；初始及后两次观察的两轴滚动条值均为 0，后两张保存原图为 row001，最终独立 CUA 后台 AX / 截图也为两轴 0、row001。原生目标前后后台、frontmostChanged=false、pointerMoved=false。不是过期 / 权限 / AX 截断造成的 prepare 拒绝；未知分类通过实测，实际滚动未生效，四向 page / step 均未通过真机验收。
- 声明 action 不保证真实回调可用，调用后错误也不能据此保证无副作用。Z 阶段未实现 AX 滚动条 Value 写入；后续 fraction 补齐另立明确策略与量纲，不能冒充 page / step，当前状态见下列本轮补齐记录。
- TextEdit Y Run `2458c376-a9eb-416f-a54b-03d34216efdf` completed，仅两次 application=TextEdit 的 windows 查询为空，没有输入。随后 query=未命名 已发现中文“文本编辑”目标；实际观察见 Y2，发现成功不等于输入成功。
- TextEdit Y2 Run `a7a9e88d-d9c9-495f-bbc8-93384c3b593d` completed，仅 windows + 两次 observe 共三个工具；两张 603×505 截图均为正确的临时“文本编辑”窗口。没有文本 / 滚动候选，descriptionReadErrors=1、firstAXError=-25200，没有任何 write。仅发现与捕获通过，输入兼容未通过验收，不能据此次扫描推定所有 AX 输入不支持。
- W3 / Z 轮次始终使用开发版 / win（libraryId=3、本机 macOS MinIO），未新增系统权限、操作安装版或第一个资料库。夹具最终确认文本为空、两轴滚动条为 0 后关闭。TextEdit 只使用该轮创建的空测试文档，准备提问时复制的测试文字已清空；测试阶段未保存，清理时通过 GUI 保留空产物另存到 `/tmp/omniflow-computer-qa-bUwOTZ/omniflow-textedit-input-qa.rtf`（219 字节）并关闭，未删除文档、未写入用户文档，旧 autosave 是否移除未验证。该轮结束时开发版停在 win W3 历史任务，任务已折叠且无 active Run；下一轮补齐前已退出该开发进程与旧夹具。
- 本轮源代码已接入 unit=fraction 与 scrollUpFraction / scrollDownFraction / scrollLeftFraction / scrollRightFraction：实际 AXScrollBar、明确 enabled、匹配轴、Value / MinValue / MaxValue 三个非 Boolean 的 finite 数值与有效范围、AXValue 实际可写才可签发。缺 min / max 不默认 0 / 1；一次沿确认范围移动 10% 并在边界截停，没有自定义幅度。私有 scrollState 绑定 value / minValue / maxValue，观察前后 / prepare / native 派发前严格拒绝漂移；旧许可不授新 operations，也不在 page / step 失败后 fallback。内置 Agent 往返仍待收口，不使用旧 4420 项门禁代替本轮检查。
- TextEdit 先加固定角色 / 拒绝阶段 / error / bool 诊断，AB 定位后另加预选严格文本身份 profile；first-party Electron 受控输入桥仍只列调研计划。新夹具为 `/tmp/omniflow-computer-qa-cyzUeg/Omniflow Computer QA.app`，GUI 已创建新空 TextEdit“未命名”用于观察。独立 CUA 设置夹具 vertical 0 → 0.1，内容到 row013 / row014 后恢复 0，只计对照，不计内置 Agent 通过。
- fraction 原生冻结后，专项 253 项、Swift 双架构类型检查通过；TS 501 项及 UI 152 项定向回归此前通过。最新全量 lint / test / build 均 exit 0，471 文件 / 4464 项通过、3 文件 / 7 项沿用跳过，测试开始 22:32:27、耗时 48.30 秒；构建已重建 universal helper。日志为 `/tmp/omniflow-computer-fraction-lint-20261010.log`、`/tmp/omniflow-computer-fraction-test-20261010.log` 与 `/tmp/omniflow-computer-fraction-build-20261010.log`。固定角色诊断每次扫描独立限 32 条，仅限制日志，不改变 truncated 或能力；第一 probe 与最终拒绝分开，实际数值三值不进日志。新开发版已启动，真机结果另记。
- 新 TextEdit 的独立 CUA setValue 对照成功写入合成中文 / emoji / 两行文字后清空，AX Unicode 完整，CUA TextArea / First Text View 标 settable；只说明该窗口有原生 setter，helper 拒绝阶段已由 AB 确认为 Description，不计内置 Agent 文字通过。系统自动保存出的 iCloud“未命名.rtf”在 AE 后经 GUI“移到”移动至本轮临时目录并关闭，最终清理另记，不能称另存副本。
- AA 首轮误选标题“Window”，由验收者取消，未捕获、未执行。AA2 Run `f3c7e816-6f6f-4327-80cf-5af34a1f1979`、Session `3367c2e9-1037-4ef3-bd7b-07242829ef38` 正确选 QA，windows + observe 成功，imageId=`83b1b3a7-81fc-4811-bf81-c47c30bbf4b0`。AXBar 值 0、enabled=true，valueNumeric / valueSettable=true；实际 MinValue / MaxValue getter 为 -25205，未签发 Fraction 候选、没有 scroll 派发。发现与观察通过，fraction 未通过；外部缺范围仍不猜默认 0 / 1，本轮未取得通用范围保证。
- TextEdit AB Run `f1b8ce4f-9616-48e2-8d94-fa6a03d53861` 属于上述 Session，observe 成功，imageId=`207398fb-c17c-411b-bb3a-646174ffdf07`。roleKind=1 / stage=17 / axError=-25200，descriptionDeclared=true；nativeContext、文本角色、Value / SelectedText settable 及 enabled confirmed-absence 等均通过，真实拒绝点为 Description 身份 getter，没有 TextEdit write。不能据此断言 setter 不存在，也不能把真实失败按字段缺失放行。
- AB 后文本 profile 已冻结：private identityProfile=`native-text-identifier-v1` 与 descriptionDeclared 成对；仅非网页原生 TextArea / text-only / 有效 textState / title 精确空串 / AXIdentifier 已声明才在 Description getter 前预选。Identifier 必须 getter 成功、CFString、完整安全原值不超过 256 字节且 trim 非空，失败即拒绝、不 fallback，禁止 profile 携带 Description / press。prepare requiredProfile 与 final 完整候选复验封印路线及声明，Press 和默认 Description 规则不变。main 只有前后完整稳定集合中唯一可操作原生 TextArea 才派生 labelSource=unique-actionable-native-textarea；AD 后的通用图像边界标签另记，公开仍不露 Identifier / profile / 声明字段。
- 文本 profile 平台专项 280 项、runtime 专项 173 项、Swift 双架构类型检查及独立 TS / native review 通过；该版本全量 lint / test / build 均 exit 0，471 文件 / 4506 项通过、3 文件 / 7 项沿用跳过，测试开始 22:49:16、耗时 49.88 秒，构建包含新 native universal prepare。日志为 `/tmp/omniflow-computer-text-profile-lint-20261010.log`、`/tmp/omniflow-computer-text-profile-test-20261010.log`、`/tmp/omniflow-computer-text-profile-build-20261010.log`；开发版日志 `/tmp/omniflow-computer-text-profile-dev-20261010.log`。诊断新增 identifierDeclared / identifierReadable / identifierNonEmpty / textIdentityProfile 四布尔，32 条上限不变。自动 gate 不提供实际编辑成功证据，fraction 仍未通过。
- AC Run `38711990-fe91-4b23-820c-792b856dd743`、Session `3367c2e9-1037-4ef3-bd7b-07242829ef38`，imageId=`424e94d5-ec6c-408b-96dd-8b7df747e2e8`。目标原生文本 profile 两次 accepted=true，Identifier 声明 / 可读 / 非空均 true，Description 错误计数 0，真实证明此文本区支持 Identifier 身份路线；不计 setter 已执行或 Description 已读成功。
- AC 整窗候选扫描 48 nodes / 18 candidates、maxDepth=3 / maxChildren=17，truncated=true、firstAXError=-25205；children / depth 限额均未触发，optional names / Description / Identifier 错误计数为 0。因全局完整性不足，main 未签发唯一文本 elementId，Agent 未发送 setText，编辑未通过；另一个 getter 门槛由后续 AD 定位，4506 项门禁不代替后续诊断及标签路线改动。
- generic 固定诊断已接入 roleKind=0，仅明确 stage 与真实 non-success 才 log，正常无 operation / disabled 不占 32 条 cap；追加 role19 / position20 / size21 / childrenCopy22 / windowsCopy23，原 1～18 不变，不改变 gate。AD Run `1f56155d-a060-411b-8018-07611a04436a` 在 2026-10-10 23:02:11 出现 roleKind0 / stage13 enabled / -25205，导致整窗 partial；目标 TextArea identity accepted。AD observe imageId=`b220897d-f554-4305-a37c-9a3418cc956b`，candidateScanComplete=false、textReady=false；该图与 AC 分开，也不将 profile accepted 计为输入成功。
- AD 后 native-text-screenshot-bounds 源码已冻结：该 text-only profile 自身前后指纹稳定、与前后所有已知其他可操作 TextArea 无重叠，才签发通用“原生文本区域”与同附件像素 screenshotBounds，供模型结合图像选择 elementId。部分扫描不宣称唯一、不推定未扫描控件不存在，已知重叠不发布；不授 press / 坐标点击、不改扫描完整性或 prepare / final 复验。runtime 定向 187 项与 ESLint 通过。
- 图像边界路线最终全量 lint / test / build 均 exit 0：471 文件 / 4522 项通过、3 文件 / 7 项沿用跳过，测试开始 23:09:41、耗时 54.02 秒，构建正常完成。日志为 `/tmp/omniflow-computer-text-bounds-lint-20261010.log`、`/tmp/omniflow-computer-text-bounds-test-20261010.log`、`/tmp/omniflow-computer-text-bounds-build-20261010.log`；开发版日志 `/tmp/omniflow-computer-text-bounds-dev-20261010.log`。4506 项历史 gate 不代替此版本检查。
- AE Run `cf5e6e65-6208-456c-b981-521e362e00ff` / Session `3367c2e9-1037-4ef3-bd7b-07242829ef38` completed，开发版 / win / libraryId=3，对“文本编辑 / 未命名”单窗批准一次。初图 `70efc3aa-897a-45b9-9d04-d24cae0c583b` scanComplete=false、textReady=true，AXTextArea 的通用标签“原生文本区域”、labelSource=native-text-screenshot-bounds、screenshotBounds={x:0,y:200,width:1172,height:764}；没有放宽整窗扫描或点击门槛。
- AE replace 两行“QA 原生中文😀 / 第二行”后图 `9999549e-4114-42c0-ab67-89d0bcb05b86`，insert“＋插入🪟”后图 `827cb735-8085-48ef-a4f2-525451897f98`，replace 空值后图 `a2c7cbd2-6b3f-4f2f-b393-f438b36fd548`。三写均 dispatched / committed；验收者逐图检查，AX 摘要对应文字及清空，独立 CUA 在插入后读到完整两行和新增内容、最终确认空。原生 23:11:59.241 / 23:12:07.493 / 23:12:15.866 均 axError=0，frontmostKnown 前后 true、targetFrontmost 前后 false、frontmostChanged=false、pointerMoved=false。限定 TextEdit 文本区 replace / insert / clear 后台闭环通过，端点不证明持续或同窗口隔离，不宣布所有软件可用。
- 夹具关闭前两轴滚动条均为 0，已通过 CUA 关闭且不再运行。AE 后 TextEdit 为空测试文档，GUI“文件 → 移到 → 其他”移动到 `/tmp/omniflow-computer-qa-cyzUeg/未命名.rtf`，确认文档 URL 为该临时位置后关闭；原 iCloud“未命名.rtf”路径已不存在。219 字节 RTF 只含格式头、没有正文，未删除文档、未写入用户文档；自动打开的文件面板已取消。开发版保持打开 win / libraryId=3 的最新 AE 终态。该原生批次 fraction 和四向 page / step 未通过，任意 Electron / 网页编辑器输入不推定兼容；2026-10-11 第一方桥的独立实现与验证见本文件首节。

当前限定开发版 / win（libraryId=3、本机 macOS MinIO）的验收与待验项：

| 用例 | 核对标准 | 当前结果 |
| --- | --- | --- |
| AppKit 文字替换 → 插入 → 清空 | 只选择“QA 文本输入区”的准确 ID；中文、emoji、多行在新截图与 CUA 同窗读取一致，最终为空；insert 仅在明确声明 insertText 时执行，否则记录不支持。每次动作后空参数 observe，禁止重用旧 ID。 | W3 限定夹具通过；🪟 字体缺字与 Unicode 保留分别记录。 |
| fraction 垂直 / 水平往返 | 只用新观察明确声明的 Fraction operation；每次为冻结数值范围的 10%，截图 / AX / CUA 确认实际内容移动并恢复；数值漂移拒绝，缺范围不授权，失败不切换 page / step。 | AA2 的真实 Min / Max getter 不支持，未签发 Fraction 候选、未派发；CUA Value 对照不计内置 Agent 通过。 |
| 垂直 / 水平 step 往返 | 只选准确命名的滚动条；实际行号 / LEFT、RIGHT 位置变化后恢复，不以 dispatched 单独判成功。 | 四向 step 均未通过真机验收。 |
| page 往返 | 仅在观察明确声明对应 Page 能力时执行；未声明则记录不支持，不更换点击、键盘或滚轮路线。 | Z 一次 down/page 未生效；unknown 分类正确且没有重发，四向 page 均未通过真机验收。 |
| TextEdit 外部兼容 | 仅本次临时空文档，按实际 operations 验证 replace / insert / 清空；不打开或保存用户文档；比较原图、AX、CUA 与实际结果。AXSelectedText 不保证可写，insert 缺席不能降级键盘、焦点或写选区。 | AE 限定 TextEdit 文本区通过 replace / insert / clear 闭环，整窗 partial 仍保持；空测试文档已移动临时目录并关闭，其他 App 不推定兼容。 |
| 后台与展示 | 批准精确单窗后置前 WebStorm，核对动作前后前台 / 指针端点；检查连续操作合组、成功输入 / 滚动无详情、截图和 AX 预览，以及 SQLite 操作参数不含正文。端点证据不宣称持续隔离或同窗口状态隔离。 | W3 历史展示路径通过；AE 三次 TextEdit 写入后台端点稳定、保存图像与 AX / CUA 闭环通过。Z 滚动端点稳定，滚动成功展示未验收。 |

## Agent 窗口发现、控件 ID 与可读身份（2026-10-10）

- 新增 `computer.windows` 只读元数据搜索、Run 绑定 windowRef，以及 `observe → elementId click`。观察后旧引用、过期、一次性、切窗批准、身份复验与停止清理保持原链；公开列表不含 PID / 路径 / 原生 identifier。
- Provider 观察/窗口结果使用独立 40k estimated tokens 预算；真实续轮覆盖 128 控件＋12 KiB 中文 AX 和 64 个最大窗口标签。低上下文按完整条目裁减，保持 UUID / 标签与点击能力字段，明确标记省略。没有模型隐藏全树，AX 摘要仍有界。
- `candidateScanComplete`、`coordinateClickReady` 和 `clickReady` 分别表达扫描完整度、坐标门槛与任一路径可用。部分扫描保留两次严格确认的 ID；坐标要求完整且集合完全稳定，prepare / dispatch 均拦截。无可读标签不发 ID，完整私有坐标候选不受 ID 过滤影响，避免误选重叠父控件。
- 实机仅开发版 / win（id=3、本机 macOS MinIO）、gpt-5.5 / medium、完全访问，未新增系统权限。O / P 主窗发现和观察成功，但 Subrole 读取错误造成点击被拒绝；Q 部分 ID 路径实际误点了计算器“删除”，后图确认并停止，明确不计通过。原表达式、完整显示值与隐藏边栏已经恢复，计算历史未新增或删除。具体 Run 与根因见[实施专题](agent-computer-use.md#窗口发现与控件-id-的本轮验证2026-10-10)。
- Q 后修正主要 Description 的直接严格读取、非必要 Subrole 不采集、匿名角色不发 ID和冻结路径有界前缀；不吞真实失败、不降级全局鼠标。用户吃饭锁屏后暂停所有读屏/点击，仅完成非 GUI 工作；要求继续后恢复开发版验收，旧 N 访达坐标版结果不替代新版本。
- 新只读 R 返回计算器 22 个准确命名的 ID，与 CUA 同窗标签一致。S 完成六工具语义闭环，三份已保存原图证实计算器边栏隐藏→显示→隐藏、原数值保持；展开时 AX 与候选均截断，坐标能力关闭，仍成功使用独立确认的隐藏边栏 ID。S 最后模型总结遭遇连接中断，Run failed，六工具均 completed；不得写成整体 Run completed 或重放动作。
- 新语义 T `977929de-7b17-4780-832c-944e866f39ad` Run completed，访达六工具按 ID 完成图标→列表→图标。三图、AX 内容区和单选 value、最终 CUA 后台读取均一致；未改变文件。S / T 四次原生点击目标前后均在后台，前台与鼠标端点未变，只证明这些应用/操作的端点，不证明持续或同应用状态隔离。
- T 实看连续三步共享一个折叠组、成功点击无详情、截图缩略图和 AX 截断标记、大图预览及 Esc 焦点恢复；模型中间说明保留消息边界另起组。图像均为获准单窗。详细 Run、范围与恢复见实施专题。
- 广泛输入调研补充公开 AXShowMenu / AXConfirm、文字与滚动路线，以及定向像素、Unicode、快捷键、拖拽和浏览器适配的逐应用验证门槛；后续文字 / 滚动的实现及本轮验收状态见上节，其余输入路线仍未接入。源码与实施顺序见[研究](agent-computer-use-research.md#10-2026-10-10-更多后台输入能力的源码复核)。
- 后续独立复核发现超长 title / 非法 AX 读值静默省略候选而未标部分扫描，可能漏掉重叠子项并错误开放坐标；已修复生产候选读取，真实缺失/非法/超预算标 partial，明确无 AXPress / Boolean false 正常跳过。实际 Swift 纯策略测试覆盖长标题、控制文本、非法类型、动作数组、enabled、几何和正常省略，未调用真实 AX。
- 最新全量 `npm run lint`、`npm test`（470 文件 / 4162 项通过，3 文件 / 7 项沿用跳过）与 `npm run build` 通过；本轮构建前停止开发版，helper arm64+x86_64 universal 已重新生成，独立静态复核未发现剩余问题。构建后恢复开发版继续最新 helper 的实机复测，不签名打包或发布。
- 最新 helper 的 U 再次按 ID 完成计算器边栏展开/恢复，三图与 CUA 确认原数值保持；旧 windowRef 因窗口宽度变化被拒绝后重新搜索观察，不补发点击。后续访达只查询未操作时上游 HTTP/2 失败，U Run failed。V `f7eaba03-f8d1-4788-8019-18538de05d49` 仅执行未开始的访达测试，六工具与 Run completed，三图/AX/CUA 再次确认图标→列表→图标。两应用扫描被保守标 partial、坐标关闭、ID可用；U / V 四次原生点击目标均后台，前台与指针端点不变。结束关闭专用测试窗、保留原下载窗口，开发版留在 win Agent 会话。

## Agent 第三方窗口与后台控制调研（2026-10-10）

- 沿用开发版、win（id=3、本机 macOS MinIO）、gpt-5.5 / medium、完全访问。内置 Agent 只调用窗口观察 / 点击；未启动安装版、操作第一个资料库、修改资料库内容或新增系统权限。
- 计算器 L 首图和未截断 AX 摘要成功，AXPress 回执成功但后续旧标题选择失败；CUA 未确认边栏变化，不计业务通过。应用名唯一选择的 L2 因多个匹配窗口被拒绝，暴露公开窗口发现入口缺失。截图共享控件与边栏位置映射有疑点，根因未确认。
- 访达 M 首图成功，但约 85 秒的模型等待超过 60 秒截图有效期，点击在 prepare 被拒绝，未发送输入。不能计为 AX 截断造成失败。
- 干净会话 N `cd934d32-35fe-47e5-8cac-5835a14222d1` 完成五工具闭环。三份保存原图实看图标视图 → 列表视图 → 图标视图，仅测试访达窗口；AX 按钮 value 对应，虽然摘要截断但目标控件可读。两次点击目标前后在后台、前台和物理指针端点均未变；最终 CUA 未置前读取到相同视图状态。原图、时间与 Run 证据见 [实施专题](agent-computer-use.md#第三方应用验收2026-10-10)。
- Codex 官方后台 / 画中画、公开源码的驱动边界，以及 Cua / AXorcist / Peekaboo / axcli / OpenDesign 候选调研见 [调研专题](agent-computer-use-research.md#9-2026-10-10-后台控制复核与下一步建议)。只读调研不等于集成这些库，不宣称任意应用、画布或其他控制操作已通过。
- 本轮仅更新文档并进行上述实际开发版验收，未修改执行代码；未重复运行 lint / test / build，沿用上一轮门禁，未签名打包或发布。

## Agent 内置屏幕查看与点击（2026-10-09）

- 新增 macOS `computer.observe / computer.click`，首次共享确认和系统权限、图片自动进入现有视觉链、单次截图绑定 AX 控件激活、停止清理与输入回执。为避免争用用户鼠标，已去掉全局鼠标输入，不支持右键/双击或无 AX 动作控件。详细契约见 [屏幕查看与点击](agent-computer-use.md)。
- 自动化覆盖严格动作、授权卡内容与防伪目标、非视觉模型过滤、Run/owner/AI隔离、Retina/负屏幕原点、截图过期/一次性、权限等待期间屏幕变更/撤销、取消回滚、原生协议和观察/输入超时。原生 helper 双架构编译与拒绝输入通过。
- 早期全局鼠标版的全量 `npm run lint`、`npm test`、`npm run build` 通过：462 个测试文件 / 3670 项通过，3 个文件 / 7 项沿用跳过；diff 检查通过。包括真实图片水化进入下一 Provider turn、冒名注册不读取截图、仅截图会话删除清理，以及将捕获/存储耗时计入有效期；未签名打包或发布。这份旧版检查不代替后续 AX 修复的门禁。
- 完整独立 Electron smoke 因录屏权限 `denied` 返回 blocked，在创建显示 fixture、截图、点击前停止；fixture-only 的本地渲染和颜色标记通过，只计渲染验证。未访问资料库或修改系统权限。
- 内部 Agent 真实联调使用开发版、win（id=3）、gpt-5.5 / medium 和同一个测试会话。首次及完整重启后的重试均实际调用 `computer.observe`，共享审批为 `ask / approved`，随后因 OS 录屏拒绝停止，无截图成功或 `computer.click`。Electron 录屏和辅助功能已按用户批准开启；TCC 日志确认本次 CLI 开发启动链的录屏主体是主 ChatGPT/Codex 程序，仅授权 Electron 不足。Run 标识与环境处理见专题，不能把模型最终答复或已开启的系统开关计为点击通过。
- 用户随后授权实际请求主体 ChatGPT/Codex 的录屏权限，开发 Electron 重启后的 Run `22e29c2d-6597-419f-aea5-ad05a987d120` 完成真实 `observe → click → observe`（三工具 completed，初次 ask/approved，点击 dispatched/committed），目录树折叠且出现“展开目录树”。仅证明早期全局鼠标版内部 Agent 闭环通过。
- AX 修复自动测试覆盖截图前后窗口顺序/身份/进程启动时间/layer/几何稳定、AX 路径/角色/标题/几何漂移、遮挡窗/系统浮层不透传、候选重叠拒绝、后代选择、sealed 控件绑定和后台目标不随当前前台切换；已有 unknown 结算与一次性截图回归保留。
- AX 修复及缩略图最终全量门禁通过：`npm run lint`、`npm test`（463 文件 / 3787 项通过，3 文件 / 7 项沿用跳过）、`npm run build` 与 diff 检查；Swift helper 已编译 arm64+x86_64 universal，platform 的 86 项 mock 覆盖 UTF-8 分包、固定目标严格校验、扫描预算、AX 启用边界、unknown 和超时。未签名打包或发布。
- 上一阶段按用户要求暂停实机测试；本轮用户明确要求验证三项后恢复开发版 / win（id=3）验证。旧全局点击结果不作为新窗口 AX 路径通过的证据。
- 本轮切为 V2 单窗口 action，prepare 只列窗口元数据，SCK 只捕获获准窗口；macOS 14+ 无显示器回退。新增窗口、进程及几何漂移、owner 默认目标、精确选择/多窗拒绝、切窗重新批准、仅单窗 AX 前后观察、图片绑定回滚与最终异步复验期间释放/过期覆盖。正式 Orchestrator 的 6 项测试经过首次批准重新准备、封存执行和图片水化，验证稳定 targetId、窗口变化替换审批及伪造 requested action 不能换窗。
- 真实开发版首轮 prepare 找不到默认窗口，发现直接 npm/spawn 启动的 Electron 不一定有 `NSRunningApplication.launchDate`。改用公开 libproc 内核启动时间后单窗口选择及正式批准已进入执行；双架构编译、只读纯进程身份自检通过。测试 Session `d036338d-e27c-4dce-b9a4-f746f86b8938` 的 Run `eb28b912-14a5-4c64-b073-6f8d541311e0` 和 `4bba15f4-5541-477f-bed0-3f66982a58bb` 均实际 `ask / approved`，随后系统录屏拒绝，未调用 click、没有生成截图。
- TCC 证据显示当前 WebStorm 启动链的负责主体为 `com.jetbrains.WebStorm`；只读系统设置确认 WebStorm 辅助功能已开启、录屏列表尚无 WebStorm。Electron / ChatGPT 既有录屏开关不能代替该启动链授权，不能把本轮截图拒绝写成单窗口/后台点击通过。用户的新增系统授权与后续实际窗口验证单独记录，不移除预检或退回全屏截取。
- 本轮最终 `npm run lint`、全量 `npm test`（463 文件 / 3966 项通过，3 文件 / 7 项沿用跳过）、`npm run build` 和 diff 检查通过。platform 136 项、runtime 83 项及正式审批链回归已纳入全量；原生最终 libproc / SCK helper universal 编译通过。没有签名打包或发布，macOS 14.0/14.1 子窗口边界、发行包、其他平台和多显示器尚未实测。
- 后续按用户批准添加 WebStorm 录屏权限、退出重开 IDE 和开发版后，Run D 实际单窗截图成功。窗口匹配成功但 AX 16 层预算截断导致 clickReady=false 的问题，由 F / G 原生无正文计数定位；当前候选扫描和路径校验统一为 32 层，不取消节点、时间、字节或不完整扫描拒绝点击的边界。
- 增加同窗后置 `axTree / axTreeTruncated` 摘要，独立 12 KiB UTF-8、严格成对/Unicode/控制字符校验，不输出原生身份或私有路径。无权限、旧 helper、前置候选失败、窗口漂移、摘要截断、取消、释放、剩余 stdout 空间及安全输入值处理均有定向覆盖；摘要不参与点击授权。
- 真实开发版 win（id=3、本机 MinIO）、gpt-5.5 / medium 的 Run H `dfa5e8c4-75bb-4bd5-a266-d6524a9566f7` 完成 V2 三工具闭环，首次 ask/approved、点击 AXPress dispatched/committed，两图 2048×1257 且同 targetId / window scope。审批后 Raise WebStorm 遮挡，新的点击后截图实见目录树已收起；两图大图预览仅含 OmniFlow。未使用其他 Tool 或修改资料库内容。
- 用户新增 AX 一致性标准：CUA 与内置 Agent 的目标控件前后名称、角色和 value 均一致（折叠目录树/0 → 展开目录树/1），模式工具栏、返回/上传/回收站/设置以及 Outline→Row→Button/Image/Text 的语义层级也对应。CUA 的本地化角色和容器压缩不要求与原生文本编号/缩进相同。两份树均明确已截断，不能声称整棵 AX 完整性已通过；详细回执和残余边界见实施专题。
- Run I `a7645840-a7d4-469d-a218-ee125834a02d` 的五步工具均完成；聚焦 WebStorm 后两次 AXPress 原生诊断均前台信息可用、目标前后都在后台、`frontmostChanged=false / pointerMoved=false`。但第三图保留收起旧帧，AX description/value 不同步，窗口置前后才恢复，故该轮恢复未通过。端点诊断不保证所有应用自身永不激活，也不能排除用户短暂移动再回到原点。
- 对自有获准 owner 窗口增加临时后台渲染租约，不改全局默认或外部应用；仅正式观察的精确 PID/CGWindowID 匹配后获取，取消/失败/换目标/结束归还，同 WebContents 引用计数恢复原值。116 项 runtime/租约专项覆盖首次获取失败回滚、销毁、并发、重复/迟到释放和取消后的旧截图丢弃。实机恢复结果另记，不能用设置调用或工具 completed 代替新图核对。
- 新增 3 项正式审批执行链回归，覆盖首次 observe 已完成、其 Tool signal 转发已解除后，stop / owner release / shutdown 仍从真实 Run abort 同步恢复租约；迟到截图不导入，已发送点击结算路径保留。最终全量 lint / test（465 文件 / 4049 项通过，3 文件 / 7 项沿用跳过）/ build 与 diff 检查通过；独立源码 review 无剩余实质 finding。
- 修复后 Run J 的五工具与三份已保存窗口原图证实后台“展开→收起→恢复展开”，AX 名称/value 同步为“折叠/0→展开/1→折叠/0”。该轮第二次鼠标端点有变化，单独保留，不计作固定鼠标通过。Run K `69c6b466-a75d-4b47-8754-e6f8492e95f9` 经批准后实际聚焦 WebStorm 编辑器，五步再次完成；两次点击目标前后在后台、前台和鼠标端点均未变。第二、第三张存储原图在任何置前核验前已显示收起/恢复，只含 OmniFlow；结束后 CUA 在后台读到的主要 AX 名称、角色、value 和底栏控件对应。树明确截断，无法据此声称全文完整一致；回执、时间与范围见专题。

## Agent 屏幕 Tool 展示（2026-10-09）

- 本轮修正连续内置 `observe → click → observe` 的分组：不再被 resource-read / internal-operation 分类和第一次已批准的共享记录拆开。一个 computer-use 折叠组保留三个 ToolRun，pending、未知结果、插件及其他工具、不同 Run、commentary / assistant / user 均不跨越合并。
- 缩略图点击复用聊天附件的大图预览，可缩放并经 Esc / 遮罩关闭；收起卡片或组、隐藏工作区、切换读取身份及卸载时关闭大图并释放截图。V2 窗口截图要求 window captureScope 与 targetId 匹配，保留 V1 历史显示器截图的原展示。
- 成功 `computer.observe` 默认只显示状态行，展开时从已有、绑定当前 owner / backend / library / Session 的附件预览接口读取真实 PNG 缩略图；成功且身份与回执吻合的 `computer.click` 仅显示“已发送点击”一行。未知结果及失败保留详情，不把输入已发送当成目标界面成功。
- 展示来源要求 main 的内置工具标记、严格 prepared action、同库屏幕身份和有效 UUID；同名插件、缺失来源、非法图片引用、屏幕不匹配、伪造尺寸和非 PNG URL 均不能生成图片预览。来源标记不承担读取权限，main 仍验证附件账号、后端、资料库及会话绑定。
- 本轮定向验证 7 个文件、131 项测试通过，相关文件 ESLint 通过。覆盖新的单组与消息边界、V1/V2 来源校验、缩略图复用大图及大图的身份/隐藏释放、保留 DOM 的 Run 过程折叠，保留懒读取、卡片及保留 DOM 的工具组收起、各身份变化后的迟到响应隔离、缺失 owner / Session 拒绝读取、错误信息收口、成功点击单行和未知回执详情；这份记录不代替本轮最终全量 lint / test / build。
- 新增可信 `computer-ax` 展示块，观察详情中截图缩略图和 AX 独立展示，AX 以原生 details 展开为最多 132px 高的滚动纯文本。4 文件 / 101 项 UI 专项通过，覆盖非法/插件/V1来源、UTF-8预算、父层折叠和工作区隐藏释放。真实 Run H 实看只有一个含三条工具的折叠组、点击无详情、两张缩略图共用聊天大图、AX有截断标记且能展开。亮色、极窄布局和全部大图缩放交互未逐项手验。
- 本轮 macOS 开发版 / win（id=3）暗色实机已检查历史 Run `22e29c2d-6597-419f-aea5-ad05a987d120`：展开任务过程后只有一个电脑操作组，组内依次为“已查看屏幕 / 已发送点击 / 已查看屏幕”；点击没有详情开关。展开末次观察显示真实缩略图，点击进入聊天附件共用的大图预览（初始 68% 与缩放按钮），Esc 关闭后焦点回到原缩略图，收起任务过程后详情消失。此历史图片明确仍含旧显示器全屏，不会伪装成新的窗口截图。
- 亮色、极窄窗口比例/滚动及手工跨 owner 身份释放尚未逐项 GUI 复验；身份/隐藏/折叠释放与迟到结果由自动测试覆盖。本轮单窗捕获与后台点击另按上节记录，不借用历史全局点击结果。
- 最终 Run K 复验一个五工具组，三条观察有详情、两条成功点击无详情；末次观察同时显示真实窗口缩略图与可展开的“AX · 已截断”纯文本。缩略图打开聊天共用大图，放大 66%→76%、缩小回 66%、Esc 关闭与缩略图焦点恢复实测通过；最后收起任务过程。其他缩放、亮色和极窄布局未逐项手验。

## Agent 输入框与会话目录弱化外框（2026-10-09）

- Composer、会话目录卡片及收起气泡去掉常驻描边和阴影，保留主题背景、圆角及透明边框占位；尺寸、内部操作和键盘焦点样式保持原契约。
- 在当前源码的临时副本中串行运行 lint、全量测试（460 个文件 / 3563 项通过，3 个文件 / 7 项跳过）和 build，全部通过；未覆盖工作目录里的 Electron / 插件产物。diff 检查通过。
- 沿用用户不启动实际验证的要求，本轮未启动或重启应用，未访问资料库；亮暗主题与窄窗口实际观感待用户确认。

## 全项目存量改动审阅与分批提交（2026-10-09）

- 按开发缓存 / 桌面背景、目录图标、文件树拖拽与新建 overlay、Agent 资源整理、库级标签、媒体播放及研究文档分别审阅和提交；前后端一起核对节点条件更新、标签分页与增量写入契约。既有验证记录按原日期保留，不代表本轮重新执行。
- 审阅修复：音频时长探测加入 15 秒超时及切资源 / 卸载取消；后端媒体探测结束后锁定节点并合并最新 metadata，避免覆盖并发修改；视频切集通过一次性提示跨 tab 重建传递过渡动画；共享进度条在指针结束 / 取消后释放临时焦点，避免拦住视频快捷键和自动隐藏，同时抑制 blur 重复提交、保留键盘操作焦点。
- 最终 `npm run lint`、`npm test`（460 个文件 / 3563 项通过，3 个文件 / 7 项跳过）、`npm run build` 与 diff 检查通过。后端 `GOCACHE=/tmp/go-build go test ./...` 和 CLI 构建通过；节点条件更新批次的独立暂存快照也通过后端全量测试。
- 按用户本轮要求，未启动应用、服务或浏览器，未重新执行真实资料库、数据库迁移和手工交互验证；未操作第一个资料库。真实媒体播放 / 切集动画、跨平台窗口效果、Provider 执行及大规模数据性能仍以对应专题的既有证据和待验项为准，自动测试不能替代这些实机验收。

## 新建文件弹框被侧栏裁切（2026-10-08）

- 根因：目录树内的 fixed 弹框被 SidePanel 的 `backdrop-filter` 建立的 containing block 限制，`overflow: hidden` 进一步裁切。通过新增 `create-file` 类型接入既有 overlay 子窗口；主 renderer 负责 provider / 探活 / 创建 / 回滚，overlay 仅持有草稿，失败重开保留名称和所选存储桶。
- `OverlayHost` 以 requestId 隔离连续请求，原请求更新仍保留草稿。受控 overlay 会话新增带 sender 校验的取消能力，离库 / 账号变化 / 卸载同时取消当前或排队请求；新建流程的异步边界阻止旧作用域继续发起后续写入与删除。已发出的 HTTP 请求无法撤回，相关局限见[overlay 专题](overlay-window-architecture.md)。
- macOS 开发版在非第一个 Win（libraryId=3）实测：真实原生网页之上的全窗口居中及遮罩、存储桶下拉、选择 `local-minio` 后 Enter 创建成功并在目录树出现、空名称 Enter 不提交、文件模式居中、Escape / 取消关闭与主窗口回焦均正常。临时测试文件已移入回收站；未操作第一个资料库。构建前退出开发进程，完成后恢复 `npm run dev`，Win 进入及新建弹框再次打开 / 取消正常。
- lint、build、最终全量测试（459 文件 / 3550 项通过，3 文件 / 7 项跳过）及 diff 检查通过；新增回归覆盖按钮 / Enter 一致门禁、手选草稿保持、同批次新请求隔离、取消队列与 sender 校验、探活缓存、写入失败回滚及各异步边界账号切换。
- 未逐项手验：亮色主题、多显示器、窗口缩放 / 全屏切换、真实 401 失效、真实存储故障回滚和 Windows/Linux；取消队列、迟到结果、失败重试及作用域切换以自动化回归覆盖。


## 开发版进入资料库黑屏（2026-10-05）

- macOS Electron 在全新隔离 Vite 缓存及 `--force` 启动下，进入非第一个 Win（libraryId=3）复现灰黑空白。Console 首错为 `overlay.api.ts:16:1` 的 `ReferenceError: œœ is not defined`；删除该行意外字符，保留原 overlay 协议和本机数据。
- 退出开发进程后运行 lint、全量测试（455 文件 / 3505 项通过，3 文件 / 7 项跳过）与 build，均通过；构建完成后用普通 `npm run dev` 重启，实查库列表正常、Win 目录树和 Agent 工作区完整显示。没有验证 Windows / Linux 或发行安装包，也未复现并行构建竞争。源码、依赖缓存及共享构建产物的排查分流见[架构基线](frontend-architecture-baseline.md)。

## 资源整理首次请求误判为无需调整（2026-10-01）

- 只读核对用户已有两次本机 Agent 执行审计，未访问或改写真实资料库。第一次 `file.stat → file.list` 已完整返回 4 个歌曲目录及 2 个散文件，`hasMore=false`；没有调用 `skill.activate`，最终仅按目录配置合法判定无需整理。第二次读到同样 6 项，加载 `resource-organization@1.0.0`，读歌词、检查媒体、创建目录，再通过 `library.batch` 配置并移动两文件，3 项均 committed，末次查询确认目标内 2 文件。可见性、分页与配置写入不是此次漏整理的原因。
- v1.0.1 补充笼统整理请求的目标及 Skill 加载提示，区分配置正确与内容组织完成；说明按需读取散件归属、明确关系时继续归组、有实质歧义时才补问。裸媒体可合理保留，只检查 / 明确单字段配置不扩大为移动。可选依赖增加 `file.read / media.inspect`，不强制调用或授予权限。
- lint、build、全量测试（450 个文件 / 3479 项通过，3 个文件 / 7 项跳过）及 diff 检查通过，包含新摘要与完整正文预算、缺写能力仍可加载知识的回归。旧两次运行只证明问题和既有工具可完成组合，不证明新提示词已改善真实模型；需再次验证笼统整理能处理明确散件，同时保留合理裸媒体和检查请求的范围。

## Agent 内置类型、归档组织与多 Skill（2026-10-01）

- 系统提示词常驻基础字段语义，`resource-organization` 按需提供五类结构知识；没有必需写工具。明确单目录配置可直接执行，同一 Run 可追加多个 Skill，重复正文去重且不裁剪有效工具。规范审计、完整正文预算和无进展循环门禁保留。
- 查询与感知传递 `builtInType / archiveMode`，缺失保持未知。`node.configure` 与 `library.batch` 接入原授权、执行和提交三态；旧服务缺少配置拒绝写入。PUT 条件更新在后端行锁内检查资料库、原样版本和目录约束，DEF 自动关闭归档。
- 配置提交后读回核对；目录树消费实际配置，旧目录预览沿既有关闭链释放，父归档刷新。自动化覆盖 scope 隔离、其他 tab 与激活态保持、媒体释放、元数据缺失、非法参数、微秒版本冲突、网络未知结果、批量部分成功与多 Skill 预算 / 去重。
- 前端 lint、build、最终全量测试（450 个文件 / 3479 项通过，3 个文件 / 7 项跳过）及 diff 检查通过；后端全量 Go 测试与 CLI 构建通过。交叉 review 修复最终配置核对字段被早期提交回执覆盖的问题，并清理成功配置后的旧节点版本，防止同一 Run 下一次配置误用提交前状态；定向回归通过。
- 本轮未操作真实资料库，也未重启用户的 Go 服务或 Electron。真实 provider 的 Skill 选择、多个 Skill 组合、目录配置及归档展示待用户更新服务和重启主进程后试用；仅刷新 renderer 不足。试用须使用非第一个资料库，优先 Win 的本机 macOS MinIO 测试目录，不使用不可达的 Windows MinIO。

## 目录树外部拖拽命中错位修正（2026-09-30）

- 已定位并复现：父组件在 layout effect 中缓存 Semi Tree 行坐标时，Semi 的内部展开尚未完成；音乐子目录出现后，缓存仍对应折叠时的行位置，指针位于歌曲目录却命中 `other`，高亮和 drop 上传目标都会偏移。
- 移除行坐标缓存与逐行扫描，悬停 / drop 使用同一 `resolveVisibleTreeNodeAtPoint`，以当前 `clientX / clientY` 和实际 DOM 行命中当前可见节点 key；校验目录树视口与 DOM 归属。文件回溯父目录、归档阻断和既有上传确认 / 上传中心保持原契约。
- 12 项回归覆盖子组件晚渲染、滚动 / 尺寸变化、横纵越界 / 非有限坐标、空白 / 遮挡、收起中的旧行、drop 重新命中及文件父目录 / 归档约束。
- macOS 临时 Chromium 验证页使用正式 Semi Tree、目录树样式与命中 helper、合成目录，不读写资料库。旧实现展开音乐后，在 `最伟大的作品` 行中心 `101px / 258.5px` 复现命中并高亮 `other`；修复后同点命中、高亮与目标均为当前歌曲目录。实际拖拽测试文件到 `WATER` 行时 hover / drop 目标一致；视口变矮、目录树滚动 `95px` 后再次拖入仍命中 `WATER`。亮暗均检查，临时页面 / 视口已清理。
- lint、全量测试（447 个文件 / 3441 项通过，3 个文件 / 7 项跳过）、build 与 diff 检查通过。未逐项手验 Finder 原生文件进入完整应用后的上传确认 / 实际上传、内置浏览器来源和 Windows/Linux；本轮没有创建真实上传任务。

## 歌词从顶部推进到封面中心后滚动（2026-09-30）

- 宽布局封面向下偏移 `25px`，歌词滚动锚点取当前封面的实际中心，高亮位置比原舞台中线略高。开头歌词从顶部排列，高亮先逐句向下推进，超过锚点后才平滑滚动歌词舞台。尾部留白由舞台高度减去锚点位置计算，末句仍能水平对齐。窄布局取消封面偏移、回到舞台中线跟随。开头不使用顶部渐隐，滚动后才启用双向渐隐；回到开头、换歌词或无歌词状态恢复顶部。滚动 presenter 自持舞台 DOM，避免 `scrollIntoView` 带动外层播放页。
- 11 项回归覆盖开头不滚动、封面中心跟随、封面移动和播放器尺寸变化后的同句重定位、尾部空间、窄布局回退、中线跟随、倒退到开头、长句真实高度、同索引更换歌词、渐隐 / 空态清理、减少动态效果与 observer / RAF 释放。
- macOS 临时浏览器样例使用正式布局、定位 hook 和 presenter、18 句合成时间轴，不读写资料库。`1280px × 720px` 的封面中心与中段 / 末句中心约为 `333.5px`；`1526px × 907px` 约为 `422.7px`；`1310px × 891px` 约为 `415.4px`，三种尺寸误差均小于 `1px`，封面实际变换为向下 `25px`。首句和开头第3句保持零滚动，高亮逐步向下；返回首句恢复零滚动与顶部可见。亮暗、归档与普通音乐文件夹布局均检查。
- `320px × 700px` 下封面变换取消，长标题省略、长歌词换行。首句从 `378px` 舞台顶部开始，末句保持在距顶部约 `189px` 的中线，无横向溢出；切裸音频清空歌词并恢复“暂无歌词”。全部样例外层播放页滚动量保持零。临时页面和视口覆盖已清理。
- `npm run lint`、`npm run build` 与 `git diff --check` 通过；全量测试最终 446 个文件 / 3429 项通过，3 个文件 / 7 项跳过。首次全量中既有 C++ 高亮断言失败，该套件独立复跑及全量复跑均通过；本轮未修改高亮模块。
- 提交前 review 未发现问题；隔离既有未提交工作后，对实际提交快照再次执行 lint、build 与全量测试，445 个文件 / 3424 项通过，3 个文件 / 7 项跳过。实际同步播放和跨平台的验证限制仍按上文保留。
- 未验证：实际资料库歌词与音频同步播放、原生应用端到端 seek 和 Windows/Linux；合成时间轴不代替真实播放链路验收。

## 音频未播放歌词预览（2026-09-30）

- 当前展示歌曲决定歌词来源，归档无需播放成功即可发现并读取歌词；普通音乐文件夹复用直属资源发现，裸音频与直属媒体卡片不扫描伴随文件。歌词以资料库、入口资源、歌曲节点与内容 / reload 版本重置，播放时间变化或开始播放不清空同一首歌词。播放流程移除歌词请求，仍沿用全局播放器和 generation 仲裁。
- 新增 11 项真实歌词 hook 回归，覆盖零时刻加载 LRC / QRC XML、字级时间轴、播放时间推进不重取、普通目录候选复用、裸音频和直属卡片不扫描、资源版本变化、目录 / 文本旧请求迟到、无歌词清空、换库与卸载。原有播放成功 / 失败 / 过期请求回归通过。
- macOS 临时浏览器样例使用正式歌词 hook、解析器、滚动 presenter 与布局样式，目录与 QRC 文本为合成响应（libraryId=3，不读写实际资料库）。亮暗均检查；首次进入零时刻显示歌词文件名和三行歌词，仅请求当前目录及歌词链接，没有音频链接 / audio 元素。模拟时间推进不增加请求；切无歌词歌曲清空文件名与正文，再切回可重新加载。临时页面、服务和视口覆盖已清理。
- `npm run lint`、`npm test`（445 个文件 / 3418 项通过，3 个文件 / 7 项跳过）、`npm run build` 与 `git diff --check` 均通过。
- 未验证：实际资料库 QRC 文件的存储链接 / Electron 文本读取、原生应用端到端播放与 Windows/Linux；合成响应不代替这些链路的实机验收。

## 音频展开页分栏与歌词定位（2026-09-30）

- 三种音频入口共用左右等宽布局，以中央播放键作为虚拟轴；封面与歌词在轴两侧对称留白，间距随容器宽度为 `64px～112px`，不显示分隔线。标题使用 `28px～36px`，右侧区域基线位于整个应用窗口高度的 `1/4`，标题、歌词文件名和歌词舞台整体上移 `25px`，内部间距与舞台尺寸保持原样，通过 viewer 的实际窗口顶部偏移扣除工具栏和标签栏占用。歌词使用下方剩余高度，开头顶部排列，尾部留白随舞台高度变化。容器不宽于 `760px` 时保留封面居中的上下排列，取消右侧区域的四分之一定位。
- macOS 开发版在非首个 win（ID 3）资料库检查过音频归档展开/收起及裸 M4A 的默认展开页、长名称省略、空封面/暂无歌词与未自动播放状态。本轮没有修改音频播放、音量或进度 owner。
- 该库样本没有歌词，最终间距与窗口四分之一定位使用正式 `UnifiedAudioViewerWrapper`、`useAudioExpandedLayout` 和封面 / 歌词 presenter 的临时浏览器样例核对，不创建资料库资源。亮暗均已检查；`1630px × 891px` 窗口、`320px` 侧栏中，标题区域基线为 `222.75px`、封面与歌词间距约 `92px`、歌词舞台约 `382px`。顶部区域从 `72px` 增至 `120px`、侧栏从 `320px` 收至 `200px` 后仍对齐窗口四分之一高度。`2125px × 1056px / 1120px × 752px / 1081px × 512px` 窗口的标题区域基线分别为 `264px / 188px / 128px`，两侧不跨播放键轴；`760px / 320px` 内容宽度保持上下排列，全部样例无横向溢出。布局监听停用后样式变量被清理，重新启用恢复定位。此前的长中文、无空格文本换行和首末 cue 居中样例检查通过；本次没有重跑真实歌词滚动。临时页面和视口覆盖已清理。
- 右侧内容整体上移后，正式样式样例在 `1310px × 891px`、顶部占用 `72px` 时，标题顶端为 `197.75px`、文件名顶端为 `247.05px`，均较原位上移 `25px`，二者间距仍为 `10px`；歌词舞台顶端为 `273.55px`，同样上移 `25px`、高度仍约 `382px`。亮暗均检查；`760px / 320px` 上下排列取消整体偏移，标题不压住封面，均无横向溢出。临时页面与视口覆盖已清理。
- 验证限制：未手验真实歌词文件加载、普通内置音乐目录的资源发现、播放/seek/频谱与 Windows/Linux；样例视觉结果不代表这些链路已经实测。
- 最终 `npm run lint`、`npm test`（444 个文件 / 3407 项通过，3 个文件 / 7 项跳过）、`npm run build` 与 `git diff --check` 均通过。

## 会话组目录范围表单（2026-09-30）

- 以“资料库访问范围 / 目录内自动允许”说明组内自动模式，保留0～32目录及原提交协议；根据用户反馈，辅助说明收进标题旁问号Tooltip，每个目录只显示完整路径（根为`/`），不再拆名称/路径或追加描述。路径左对齐、过长换行，图标和移除按钮固定宽度，长列表内部滚动。
- 本轮简化后重跑`npm run lint`、`npm test`（444文件、3407项通过，3文件/7项跳过）、`npm run build`和`npm run theme:audit`均通过。权限标题用label/htmlFor关联select，问号按钮作为相邻控件；Tooltip复用Semi的hover/focus/aria关联，不维护独立业务状态。
- macOS开发版在非第一个Win资料库（ID 3）实测暗色空态、两个问号说明浮层、Esc只收起提示并保留表单、目录选择器打开/返回以及`/视频`与`/图集`两行完整路径。键盘Tab可聚焦问号且焦点环可见。上一轮还检查过根目录选择、移除后恢复空态及select/取消按钮焦点。全部操作停留在未保存表单，不新增实际组或扩大持久权限。
- 未覆盖：亮色主题、极长嵌套路径、32项列表滚动与上限、跨平台及保存后的真实Agent执行。原生select的菜单在自动化操作时收起，未将仅读取切换实测记为通过；读取/写入权限实现没有改动。

## 音频控制台与频谱宽度（2026-09-26）

- 裸音频、普通 `AUDIO` 文件夹与音频归档进入统一音频 viewer 后，共用浮动控制台和 SVG 轨迹进度条；裸音频仍保留 10 秒快退/快进语义。
- 频谱和控制台共用音频 viewer 容器宽度基准，频谱不超过控制台；窄容器通过同一自定义宽度变量收缩。
- 展开页频谱与浮动控制台之间保持收紧后的垂直距离，桌面与窄窗口均不与控制台重叠；控制台位置和高度语义不因这次间距调整改变。
- 三种音频入口自动循环重播时，控制台轨迹进度动画保持一致。
- 本次未 build、重启或控制页面；音频组件定向测试 6 个文件 / 43 项通过，相关文件 lint 与 diff 检查通过。真实普通 AUDIO 文件夹、归档、裸音频及窄窗口视觉仍待实机验收。

## Agent 会话目录宽度（2026-09-23）

- 会话目录由 380px 收至 300px，常驻和气泡展开共用宽度；预留空间同步为 324px、收起阈值为 1246px，拖拽边界及滑出距离继续由共享常量派生。
- 回归覆盖 1265px 工作区保持常驻、到达新阈值收起以及原有拖拽/分组行为。全量测试 3329 项通过、7 项跳过，本次文件 lint 与 diff 检查通过；全局 lint 被未涉及的 `theme-foundation.tsx` 中 8 项 Fast Refresh 警告阻断。
- 按既有约束未 build、重启或控制页面；300px 下底栏按钮、长标题和真实拖拽/收起动画尚待实机视觉验收。

## Agent 切页保留（2026-09-23）

- 同库首次进入后保留 Agent，切页仅隐藏，返回不得重播会话目录入场动画；验证草稿、阅读位置、分组开合、展开更多数量及拖动位置保留。离库/换身份仍释放，后台任务与资料库生命周期不由可见性改变。
- 自动验证实际目录行实例与展开更多/分组状态保留、首次懒挂载、身份边界释放、模型/权限菜单隐藏、后台波纹暂停及原离库任务释放。全量测试 3317 项通过、7 项跳过；随后索引生命周期定向 2 项通过。lint、无输出 TypeScript 与 diff 检查通过。
- 按既有约束未 build、重启或控制页面；真实切页动画、气泡拖动位置、图片/目录弹框焦点及长任务后台执行仍需在非首个 Win 资料库实测，不用组件测试代替视觉验收。

## 设置连续分类布局（2026-09-23）

- 设置首页（仓库页及资料库内）改为固定左导航、右侧连续内容；验证分类平滑定位、上下滚动高亮、滚动到底、管理详情返回原分类、窄容器换行、亮暗主题以及减少动态效果设置。所有分类持续挂载，切换分类不得取消外观预览。
- 自动回归覆盖滚动高亮/末尾、仅内容容器定位、减少动态效果、返回分类、内容高度变化重测及监听清理。全量测试 3286 项通过、7 项跳过；lint、无输出 TypeScript 检查通过。
- 按用户既有要求未 build 或重启。原生 UI 自动化连接不稳定且期间页面发生切换，未完成新布局的实机视觉与交互验收；不将窄窗口、亮暗主题或动画手验记为通过。
- 后续按截图收紧：移除设置视图的重复头部，取消末分类整屏最小高度，正文末尾仅留 24px。定向滚动导航回归通过；本次未 build、重启或控制页面，视觉结果待用户查看。
- 导航位置再次按截图调整：紧贴正文左侧并与正文整体居中，去掉独立底色和竖向分隔线，保留右缘滚动条。全量测试 3318 项通过、7 项跳过，lint 与 diff 检查通过；遵守既有约束未 build、重启或控制页面，导航位置、窄窗口与亮暗主题仍待实机视觉验收。
- 后续密度调整：分类按钮从 40px 收至 32px、行间距从 4px 收至 2px，导航右侧加入上下留白的 1px 主题分隔线，背景继续统一。再次全量测试 3318 项通过、7 项跳过，lint 与 diff 检查通过；未 build 或控制页面，实际密度和分隔线观感待实机验收。
- 正文增加 600px 最小宽度：目录树拉宽后只在正文容器内横向滚动，分类导航固定，避免表单持续受挤压。全量测试 3318 项通过、7 项跳过，lint 与 diff 检查通过；遵守既有要求未 build、重启或控制页面，目录树最大宽度下的横向滚动及最右侧控件可达性仍待实机验收。

## W3 文件产物与回执查询（2026-09-22）

本批限定 macOS 正常链路通过：独立安装/读取/产物/Tool 批准、真实 gpt-5.5 读取指定 Win/local-minio 合成 CSV、范围及产物批准、新文件出现在目录并打开 JSON 预览。新对象实际 5974 字节、2 列表头和 205 行，正文 SHA 与批准一致；PG/SQLite 回执对应同一 operation，源节点及对象元数据基线未变。真实 Electron＋合成服务另验证完全访问 JSON、拒绝、CSV 丢响应核对、源漂移重批准、重名不覆盖五类。证据入口为 [W3](plugin-system-w3-file-output.md)，不借用 W0～W2 结果代替。

显式未知“查询回执”UI 的显示、固定动作、owner/revision 门禁、终态 CAS 与原结果保留有自动化；真机故障和重启后的查询点击未手验。产物卡目录优先显示宿主名称；该低影响展示收尾由确认卡与产物服务定向回归核验。长时性能、其他平台、发行包、多产物和自动续作/撤销未纳入本批完成声明。最终完整门禁数字见 W3 专题。

## W0～W2 受控插件改名（2026-09-22）

最近一次全量：401 个测试文件通过、3 个跳过，3087 项通过、7 项跳过；lint/build 通过。后端全量 Go 测试与 CLI 构建通过；最后启动恢复收尾另通过 79 项 Store/session/bootstrap 回归并重新构建，不累计测试数。

已通过 SDK/权限/元数据隔离、准备身份/目标替换拒绝、稳定 operation ID、微秒条件、HTTP 回执校验、主进程取消结算、SQLite 严格约束和确认卡/结果投影回归。真实 macOS Electron 运行独立插件 ZIP、PluginManager、沙箱、Agent Orchestrator 与 SQLite，使用合成模型/HTTP/libraryId=3，覆盖批准、拒绝、响应丢失、完全访问仍要求确认，以及提交期间取消后保留 committed/commit_unknown。另以真实 PG 单连接临时影子表验证实际 SQL、唯一索引、dry-run/冲突回滚和持久回执逻辑，最后回滚且不触碰用户节点或 sequence。复现与证据边界见 [W0～W2](plugin-system-w0-w2-rename.md)。

本批限定 macOS 功能验收已完成：新版 8850、管理页安装/启用、独立提案/Tool 权限、真实 gpt-5.5 调用及 Win/local-minio 两份新增合成 TXT 的范围确认→完整预览→提案批准→原子改名通过。目录立即显示新名，原打开 a 文件的预览标签与底部名称同步，正文保持 fixture A；PG 与 SQLite 核对同一 committed operation。首次试运行在范围批准前停止，Run/Tool/批准均 cancelled 且无提交。Tool-only 空 Viewer 白屏已修复并刷新确认。证据 ID 保留在 W0～W2 专题。

持续回归：批准前变化要求重新确认、同名/过期条件全批拒绝、撤权与取消结算、历史会话只刷新父目录而不广播旧名称。50 项列表完整性有自动化断言，实际视觉验证为暗色两项卡片；亮/暗 50 项长列表及滚动点击尚未手验。小时性能、发行包、其他平台、跨重启自动回执核对及撤销未覆盖，不纳入本次有限完成声明。不可用合成 HTTP 或组件数据测试宣称主题视觉或未做的人工组合已通过。

启动恢复已有本机 Store/session/bootstrap 自动回归：running＋approved 且来源有效的改名保守保存 interrupted/commit_unknown 与 operation ID；审批前不标未知，已提交 ToolRun 回执保持不变；所属活跃 Run 不再建议直接重发，同一 Run 有未知改名时优先要求核对。重复初始化幂等，损坏来源不授予可信提交事实。该测试不执行自动网络核对或真实进程崩溃后重新提交。

## AT2 插件故障与恢复（2026-09-22）

2834项测试通过、7项跳过，lint/types/build通过；原生Electron故障实验63项断言通过，覆盖撤权/管理变更/崩溃/死循环/超时/重复终态/四槽回收。修复故障原因被取消覆盖、重复终态抢占和离库未释放pure-main Run。实际win（ID 3）中，插件等待单文件授权时离库，Run/插件ToolRun/授权均取消；返回后来源审计恢复且无旧批准按钮，macOS既定范围完成。不把13秒循环视为长时内存验收。见 [AT2](plugin-system-at2-fault-recovery.md)。

## AT1 Agent 插件调用（2026-09-22）

全量2805项通过、7项跳过，lint/types/build通过；真实Electron+生产Agent+插件沙箱+SQLite+回环SSE/存储的合成查询通过，零Viewer。更换有效Key后，真实gpt-5.5的合成资源链路通过；实际win库（ID 3/local-minio）也完成安装双批准、单文件读取确认、205行CSV查询及来源详情核对，未打开Viewer。AT2完整故障与长时性能后续验证。范围与复现见 [AT1](plugin-system-at1-agent-tools.md)。

## AT0 隔离 Tool（2026-09-22）

全量 2720 项通过、7 项跳过，lint/build 通过；macOS 隐藏 CSV Tool 与旧 Viewer 共存、输出、跨实例拒绝、撤权广播、取消和路由释放完成 17 项 Electron 合成验证。本段为AT0底座验收；后续真实模型、会话目录和ToolRun接线与UI验收已在AT1完成。完整范围见 [AT0 实验](plugin-system-at0-tool-runtime.md)。

## E1 目录插件（2026-09-22）

全量 2618 项通过、7 项跳过，lint/build 通过；macOS 隔离 Electron 合成链路 11 项通过并检查亮暗截图。已在 win（ID 3）12 页漫画样本验证接管、默认打开方式、关闭重开/工作区恢复、overlay、撤权、停用回退及重新启用；长漫画、大图和持续资源趋势待验收，不使用第一个资料库。契约、复现命令和完整边界见 [E1 目录查看器](plugin-system-e1-directory-viewer.md)。

## macOS全屏标题栏留白（2026-09-14）

- 原生全屏时目录树开关left从75px变为10px，退出恢复；拖拽区域、点击保护区及侧栏折叠后的工具栏留白同步。平台DOM标记来自主进程全屏事件与初始只读查询，页面不按尺寸猜测。
- 新增测试覆盖已全屏时页面初始化、进入/退出、旧初始回复晚到、订阅释放和主窗口主frame隔离；当前工作区全量2608项通过、7项跳过，lint、无输出TypeScript与diff检查通过。
- 按用户既有要求未build或重启，原生事件与新增preload接口需重新加载新版主进程后生效；未将实际全屏点击验收记为通过。后续验证全屏进入/退出、全屏中重新加载，以及侧栏展开/收起的开关命中和标题栏拖动。

## 文件入口常态可用（2026-09-14）

- 顶部文件夹按钮（含浏览器模式入口）不再依赖activeTabId禁用，统一“打开文件模式”；无文件时进入现有WelcomeView，有文件时继续当前预览。系统视图从文件空态打开后，关闭时也返回文件空态。
- 相关工作区测试9项、lint、无输出TypeScript与diff检查通过，未build或重启。当前计算机控制未取得有效页面可访问树，点击没有获得可确认的切换结果，不记为实际点击验收通过。

## 侧边会话逐次展开（2026-09-13）

- 动画补充：新增会话行使用220ms grid高度展开与淡入，已有行保持挂载；关闭分组时保留当前行，下次打开才重置显示数量，减少动态效果偏好下不播放新增行动画。补充后相关9项测试、组件lint与diff检查通过；未build，实际动画流畅度待页面复核。

- 各组默认显示5条，“展开更多”每次增加5条，剩余不足5条时显示全部并移除按钮；收起后重置，组之间独立。已缓存条目直接展开，跨数据页才请求下一页，续页失败重试保留原游标。
- 组件与分组查询测试覆盖5→10→12、按钮消失、收起重置、组间独立、续页请求与迟到响应；9项通过，lint、无输出TypeScript和diff检查通过。未build；本轮实际页面点击受用户同步操作中断，未记为已验收。

## 会话面板固定高度与图标（2026-09-13）

- 面板固定480px高（仅可用空间不足时缩小），分组图标为1.25px细线打开/关闭文件夹，历史图标移到下方会话管理前，面板与Composer使用20px圆角。
- 开发版win（ID 3）实际展开/收起验收组，面板上下边界和底栏位置保持不变，文件夹图标切换正确；聊天输入框及面板圆角已截图检查。相关测试41项、lint、无输出TypeScript和diff检查通过，未build或重启。

## 主窗口快速缩放底色（2026-09-13）

- 后续纠正：整窗实色遮住了macOS目录树毛玻璃，已恢复MainLayout透明，并让启用vibrancy的原生窗口使用透明底色。实色聊天背景仅由ContentArea/AgentRoot持有；无vibrancy平台保留主题底色。新增回归验证毛玻璃窗口在亮暗主题均保持透明。原先全窗涂黑的做法不再有效，也不能作为快速resize灰底已解决的证据。
- 纠正后窗口底色/Windows平台定向测试5项通过，lint、无输出TypeScript与diff检查通过；未build或重启。连续原生resize露底仍待验证，不能以牺牲目录树透明度解决。
- 全量2371项通过、7项跳过，lint、无输出TypeScript检查与diff检查通过。遵守用户不build、不重启、不控制页面要求，未进行真实快速窗口缩放验收；原生窗口底色改动需下次加载新主进程后验证。

## 本机会话组与归档（2026-09-13）

- 补充实际验收：用户授权后，在运行中的开发版win（ID 3）完成分组创建/移组、归档只读与恢复、真实组内读写、组外批准读取、未分组与只读组拒绝、运行中权限变更拦截、页面重新加载、ID 4隔离及亮暗主题宽窄布局。修复新组/选择组弹框初始可见挂载导致的StrictMode Portal丢失。修复后全量2372项通过、7项跳过，lint、无输出TypeScript与diff检查通过。详细记录及未覆盖项见 [会话组实际验收](agent-session-groups-live-acceptance.md)。

- 自动化：当前工作区全量2369项通过、7项跳过；末轮删除条件原子校验及归档页样式调整后，相关Store、orchestrator和会话UI共180项再次通过，lint与`tsc --noEmit --incremental false`再次通过，`git diff --check`通过。
- 覆盖：本地组和归档重开保留、owner/library隔离、禁止嵌套与跨组越权、运行中改组/归档拒绝、版本冲突、归档恢复及删除门禁、组分页与迟到响应、组内读取/读写与组外审批、未知文档工具、目录祖先漂移、媒体上传提交前复验。
- 未执行：仍未build或完整重启应用；指针自由拖动在当前控制中无可确认位移，不记为通过。连续原生窗口缩放、精确阈值、Windows及真实媒体长上传未验收；永久删除和大量分页由自动测试覆盖。后续继续使用非第一个资料库与当前环境可达的本机MinIO。
- 当前契约：[本机会话组与访问](agent-session-groups-and-access.md)。纯客户端数据不会跨设备同步，目录授权不是OS沙箱；真实网络与目录并发变更仍需场景验收。

## Agent 目录发现补充验收

- 阶段收尾：验证候选答案在delta、Session快照和失败/取消路径均不泄漏，核对期仅显示“正在核对结果”，正式答案只出现一次；主进程仍可在核对后继续工具。验证5/10/20/40/60秒有界抖动退避、Retry-After秒数/日期及60秒上限、等待期间取消，正文恢复后隐藏过时重连提示。回环Electron烟测和真实8文件验收见 [运行恢复](agent-run-reliability.md)。

- 运行恢复：注入真实 Electron `Error('net::ERR_CONNECTION_CLOSED')`，验证首字前有界重试与取消；已显示文本不原样重放，未尝试非只读工具时至多2次新轮次续接，取消/非只读/超限均停止。长任务候选结尾核对仅一次，不重复成功工具或将片段误存为 final；见 [运行恢复](agent-run-reliability.md)。
- 正式窗口真实回归已完成：32个本机合成文件，33次只读调用（含1次按列续读），逐文件前250行覆盖无缺口；发生重连并成功压缩1次，最终范围与总额正确，候选总额错误被完成核对纠正。该验收不覆盖MinIO长任务或写操作中断。

- 活动状态行：文件读取 preparing/running 时“图标 + 准备读取/正在读取 文件名”，不显示完整路径或重复执行状态；终态不扫光。工具执行/流式正文/审批时不重复通用等待行，压缩状态来自 main currentStep，不伪造历史压缩事件或 reasoning。解锁后检查亮暗主题扫光方向/对比度、窄窗长文件名、reduced-motion、终态停用和用户向上阅读时不抢滚动；本轮锁屏期间未做视觉或真实 UI 验收。

- 2026-09-09 解锁实测已验证短文件读取、等待/终态与真实压缩状态出现；发现并修复扫光缺少固定底色造成字形消失、摘要24条上限造成长任务中断。摘要超额条目只允许校验后无损合并，不截断事实；固定预算前250行的压力任务已触发真实压缩，但修复后的全程续跑受上游连接关闭及模型提前结束影响，尚未通过。完整记录见 [旧正文清理](agent-context-pruning.md)。

- 旧正文清理：同一超预算 fixture 对照启用/禁用清理，验证摘要调用次数减少，近期两个完整 Tool 轮次与约40k输出保护、至少20k收益门槛、失败/写回执/Skill/未消费及未读完结果不清理。原始 ToolRun 不变，摘要失败不提交暂存清理，计量经既有回调重建基准。见 [旧正文清理](agent-context-pruning.md)。

- 手动付费压缩验收：`OMNIFLOW_CONTEXT_LIVE=1 node tools/agent-context-live/run.mjs` 使用隔离消息预算、合成读取历史和真实 gpt-5.5，覆盖未压缩基线、正文清理后回读、三轮连续摘要及版本变化恢复；不改变模型正式窗口。该验收不是 UI/IPC/权限/MinIO 端到端测试，详细范围及报告字段见 [旧正文清理](agent-context-pruning.md)。

- 当前 Run 有序摘要：跨普通用户/助手文字合并 Tool 候选时，原始文字原对象和相对顺序不变；真实内部摘要与伪造前缀分开处理；受保护/未消费轮次不跨越，摘要输入超预算拆批，失败原子回滚。付费 fixture 的三个摘要检查点各只调用一次模型，并追加“已报告变化但尚未重读，当前值未知”的时序探针。

- file.read 省略 limit 时不受 200/2000 行限制，按默认 10000-token 与剩余上下文输出；覆盖超过2000行的单次读取、长行续读和小预算完整 envelope。成功记录仅“已读取 文件名.后缀”，无完整路径、“可继续”、展开按钮或详情 DOM，失败与审批仍可见。

- 上下文统计验证：请求前估算、响应后实测基准与增量、工具续接、压缩失效、usage 缺失、缓存输入及会话恢复继续有效；Run revision 连续递增。Composer 暂不显示统计行或占位，最后的单数字展示留待 UI 收尾；累计用量和当前占用必须分开，见 [上下文计量](agent-context-accounting.md)。

- 模型适配验证：未知模型保持协议回退，已知模型省略不支持的 effort；远端提示词不进入 system，能力 false 能收窄 Tool 与 Skill，工具禁用时模型返回调用也不得执行；Run 续接保持同一适配快照，模型切换不修改在途 Run。详见 [模型执行适配](agent-model-adaptation.md)。

- 验证 file.search 的 glob 内外一致，空候选匹配页仍能续页；file.grep 验证路径、行号、上下文、版本、跨文件续搜和累计 skippedFiles。无匹配但未扫描完或存在不可读文件时不得显示完整无结果；host 搜索审批显示模式，file.grep 工具行保持无框。详见 [文件与正文搜索](agent-file-search.md)。

- 内部正文同一 Run 续读在强 ETag 未变时使用 304，不重复传输正文；权限撤销、存储离线、内容变化不能静默使用缓存。覆盖缓存 Run 隔离、TTL、16 MiB / 16 项上限及 Run 结束清理。上传返回完整扩展名与实际 path，模型直接读取该路径，不猜 basename；补全路径失败仍报告 committed。实测记录与未覆盖项见 [统一文件读取](agent-unified-file-reading.md)。

- `file.read` 内外 UTF-8 读取具有相同行号与续读字段；长 Unicode 行续读无缺失，内容版本变化拒绝续读；host ask/auto 确认、full-access 放行。目录最多 100 条，超大内部页自动缩页而不跳过节点，host 路径不生成资料库定位动作。详细限制和验证见 [统一文件读取](agent-unified-file-reading.md)。

- 使用隔离 fixture 或非第一个 macOS 资料库，验证不展开目录即可分页列举、搜索并精确定位 `/音乐`；离线存储不阻止元数据查询。
- 搜索节点后调用媒体检查；合并写操作返回的节点后，先前发现仍可使用。跨库节点、缺失路径、重名路径与游标条件变化必须拒绝。
- 向非当前 UI 目录提取音频，验证实际目标节点且保持 UI 目录；准备后重命名或移动目标应停止提交，不改存本机。
- 列表结果过大时缩小 limit 从原 cursor 重试，不能静默截断后跳页；工具过程保持紧凑无框展示。
- 本机真实 gpt-5.5、MinIO、PostgreSQL 目录分页 / 子树搜索 / 路径解析、内部音频保存及离线源提示已验收，记录见 [Agent 资料库目录发现](agent-library-discovery.md)。视频提取与重名保护追加验收受模型余额不足阻塞；全部主题、尺寸和云端部署未覆盖。

更新时间：2026-09-03

适用范围：`omniflow-app` 前端、Electron、IPC、工作区、文件树、文件预览、上传、内置浏览器和资源捕捉相关改动的提测、自测与 review 验证。

## 1. 概述

当前仓库已有 Viewer Session 纯 TypeScript 单元测试，但还没有覆盖完整 UI 和 Electron 交互的自动化门禁，所以“验证矩阵”仍是前端工程约束的一部分。

它的目标不是替代自动化，而是让每次改动至少回答 3 个问题：

- 我改的是哪一类能力？
- 这一类能力的主路径和失败路径是什么？
- 我这次至少手工确认了哪些路径？

## 2. 通用基线

查看器贡献的同 tab 切换、旧恢复 key、不同 viewerId 的 Warm/Cold 隔离、缺失回退及节点清理见 [B2 验收](plugin-system-b2-viewers.md)。文件写入权限仍未开放；第三方隔离候选已通过 C1 开发实验自动验证及 macOS 原生交互验收，见 [C1 SDK 与隔离实验](plugin-system-c1-sdk-isolation.md)。

第一方 CSV 的真实授权、206 行分页、撤权销毁、关闭重开恢复、工具区往返、亮暗主题和原文件属性 overlay 已在第三个 win 资料库的本机 MinIO 验证，见 [C2 验收](plugin-system-c2-csv-viewer.md)。自动回归覆盖跨库/撤权/版本/迟到回包，不使用第一个资料库；保留合成 CSV 供复测。


外观系统的配色/目录图标组合、预览取消、账号隔离、保存恢复、CodeMirror 与 overlay 快照检查见 [A1 验收记录](plugin-system-a1-acceptance.md)；实际未完成项不能被单元测试结果替代。

只要涉及 `omniflow-app` 代码，默认先做：

```bash
npm run lint
npm test
npm run build
```

`npm run build` 只做 TypeScript、renderer、Electron main/preload 编译，不调用 `electron-builder` 或代码签名。平台安装包只在明确进行打包、发布或安装验证时通过 `build:mac`、`build:win` 或正式发布脚本生成，不属于每次前端改动的默认门禁。

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
- `/libraries` 仓库文件夹素材在亮色、暗色和跟随系统主题下保持透明背景；暗色校准只作用于文件夹像素，PNG 透明区必须与页面 `--app-bg` 完全一致，不出现包围素材的矩形色块。名称在文件夹下方居中展示，长中文、长英文和无空格名称均最多换行三行并在超出后省略，网格行高不因名称长短跳动。收藏与更多只在指针进入文件夹实际图形区域或操作按钮取得键盘焦点时出现，始终显示在素材上层，移入按钮不闪退，移到名称或图形外空白处不提前触发。右键“重命名”在同一名称槽行内编辑且自动全选，不再打开弹框；`Enter` 或失焦只提交一次，`Escape` 取消，失败后保留草稿，成功刷新页面后名称仍保持
- `/login` 在亮色、暗色和跟随系统主题下保持冷色背景、玫瑰面板、主卡与品牌强调的对应层级；未保存过主题且账号未配置主题偏好时默认跟随系统，已有明确亮色 / 暗色选择继续保留。粉色面板右上角的太阳 / 月亮按钮直接切换目标主题，支持鼠标与键盘且不影响表单提交。React 首次渲染直接使用已保存主题和系统偏好，避免挂载后的明暗跳变；背景、卡片、中心形体和登录 / 注册表单平滑过渡，新增表单控件轻微错峰进入，`prefers-reduced-motion` 下取消水滴形变、液化滤镜、旋转、缩放与错峰动画；登录 / 注册两态及 `920px`、`560px`、`320px` 视口均不发生遮挡或溢出，窄屏始终保留切换到另一认证状态的入口且隐藏入口不进入 Tab 顺序

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
- 文件与设置等系统视图共用标签栏：在两种模式间切换时保持可见，当前高亮正确；无文件 tab 时仍显示系统 tab；关闭最后一个系统 tab 回到来源工作区，工具/Agent 模式不保留标签栏占位。
- 从 Agent、工具或浏览器点击左下设置，设置 tab 打开且顶部第二个资源库 / 文件图标同步选中；重复点击复用同一 tab，关闭最后一个系统 tab 后导航高亮随来源工作区恢复。
- 除左侧目录树外，宿主滚动容器在内容溢出时常驻显示主题滑块；移开鼠标并停止操作后仍可见，未溢出时无空滚动条。文件标签顶部横条与内容同步，空标签→首次打开、全部关闭→重新打开后，尺寸测量和 Shift+滚轮仍生效；不重复显示底部横条。目录树保留按交互显隐，隔离插件/网页内部遵循自身样式。
- 工具区内部导航可在 `57px～240px` 内拖动，默认 `208px` 并显示排序手柄；收窄时名称单行省略，最窄状态只保留图标且悬停可查看全称，键盘调整边界正确；达到 `180px` 后显示排序手柄，鼠标 / 键盘重排与工具点击互不误触，松手后持久化并可由同账号另一平台恢复。分割线左侧顶部双箭头可平滑收至同一纯图标形态且按钮纵向位置不跳动，手动拖到 `57px` 时箭头也转为展开方向，再次点击恢复收起前的宽度
- 点击双箭头收起时，卡片、文字省略、拖拽点隐藏、按钮位移和箭头旋转随真实宽度连续变化；工具图标固定在左侧 `28px` 中心线且卡片始终保持 `32px` 高，不允许先在旧宽度中间跳出纯图标再整体左移。按钮常态无背景，悬停为圆形高亮，展开态与排序拖拽点同轴，纯图标态与工具图标同轴。分割线连续拖动期间不逐帧触发整个工具工作区 React 重渲染，松手后只提交一次宽度
- 目录树、工具导航和工具内局部分隔线的鼠标命中区都收敛到边界中心 `6px`；连续交替拖动三者并快速折叠/展开目录树和工具导航时，分隔线不抢事件、不出现宽区域误命中、文本误选、卡顿、宽度跳回或残留 `col-resize` 光标。任一拖拽结束或组件卸载只清理自身拖拽会话
- 纯图标态的视觉框仍为 `32px`，但每个工具入口约有 `40px × 38px` 透明点击热区；相邻入口不误触，最上方入口不遮挡折叠按钮，最下方入口在侧栏边界内仍可点击
- 页面切走再回来，workspace 缓存恢复正常

2026-09-23 设置导航高亮修正：资源库 / 文件入口与共享标签栏统一由 `file-viewer` / `system` 模式推导。macOS、非首个 Win 资料库（id=3）实测 Agent→设置→关闭返回 Agent、工具→设置→重复点击复用→关闭返回工具，第二个导航图标与当前工作区一致。`lint`、全量测试（421 文件/3282 项通过，3 文件/7 项跳过）和 `build` 通过；本轮未单独手验浏览器来源及其他系统视图。

2026-09-23 收尾验证：macOS、Win（libraryId=3）实际通过文件→设置→文件→设置、仅系统 tab、关闭最后一个系统 tab，以及工具→设置→关闭返回工具。插件命令页已验证亮暗主题下滚动，右侧没有默认亮色轨道；外观字段说明在亮暗模式可读，验证后恢复原跟随系统模式。`lint`、全量测试（421 文件/3282 项通过，3 文件/7 项跳过）及 `build` 通过；本轮未逐一手验嵌套来源/提案列表与独立工具审批区，也未重跑全部系统视图。

2026-09-23 滚动条常驻验证：macOS、Win（libraryId=3）实际确认插件命令页、QQ 歌曲列表在鼠标移出并停止操作后滑块仍可见，目录树原交互显隐保留；设置页亮暗模式及合成 JSON 的 CodeMirror 横条可见，文件/设置标签切换正常，验证后恢复跟随系统并关闭临时验证文件标签。`lint`、全量测试（421 文件/3282 项通过，3 文件/7 项跳过）及 `build` 通过。未逐一手验全部归档、歌词遮罩、浏览器弹框与文件标签溢出/Shift+滚轮组合；本次不覆盖 Windows/Linux，也不改变隔离插件或网页内部 CSS。

边界路径：

- 关闭最后一个 browser tab
- 当前没有 active file 时退出 browser
- system tab 重复打开同一入口不创建第二份视图
- 打开 system view 后，正在播放的音频 / 视频不中断
- 上传中心 system view 打开 / 关闭不影响后台上传队列
- 回收站 system view 恢复 / 彻底删除 / 清空后列表更新，目录树快照标记刷新；彻底删除和清空会清理当前账号下可识别节点的 Text draft，无法枚举完整子树时显示明确警告
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

- 根节点和子节点能正常展开；首次懒加载在 children 就绪后才播放展开动画，同一点连续点击不会漏掉展开或折叠
- 目录树名称全部容纳时不出现横向滚动条；检查纵向溢出、名称接近右边界、侧栏缩窄/放宽和折叠长名称所在目录。真实长名称仍可横滚至末尾，放宽或折叠后横条消失且横向位置回到有效范围；侧栏持续拖动期间横纵滑块不随悬停边界切换透明色，松手后恢复目录树交互显隐规则。开发环境完整刷新后也须正常测量宽度。
- 非归档内置类型目录首次需右键“打开原始目录”；授权后折叠与再次展开均保留 children 和动画，侧栏重新挂载或目录配置变化后恢复为未授权状态
- 双击文件能正确打开
- 普通点击文件名、文件图标和同一行空白都能切换为单选并清掉旧范围；先单击一个节点，再按住 `Shift` 点击另一节点时首尾都被选中，反向范围同样成立；按住 `Cmd/Ctrl` 可增量切换，点击展开箭头只展开目录而不改变选区
- 上传成功后节点出现在预期父目录
- 从内置浏览器拖拽图片、媒体或明确下载文件到目录树可进入上传确认；普通本地文件拖拽上传仍走原链路，普通网页链接不误触发上传
- 拖拽上传确认框使用紧凑宽高和接近新建节点弹框的左右留白，标题按来源显示“上传文件”或“上传文件夹”；文件摘要位于内容首位且没有独立边框或背景，上传目录显示 `/` 开头的完整逻辑路径。文件摘要、目录、存储桶和文件夹统计之间保持适中间距并左右对齐，单文件上传不显示重复统计，确认按钮文案为“确定”。上传确认和新建文件的存储桶触发器、下拉行高均保持紧凑，只显示 alias 且不保留默认勾选图标列，默认标记优先于本机标记。新建文件弹框比原布局更紧凑，新建文件夹尺寸不变；亮暗主题下关闭与下拉图标均为细线，`24px` 关闭热区及 hover 背景居中且不影响底部按钮
- 新建文件和上传确认的 provider 前显示与资源监测相同的绿 / 红 / 中性探活状态。新建文件自动选择遵循“绿色 > 默认 > 未知 > 红色”，多个绿色中默认优先，用户手动选择后不被探活刷新覆盖；上传确认仍自动选择默认 provider，不套用绿色优先，并在弹框保持打开期间跟随应用级探活 runtime 原位刷新状态点。健康 provider 可创建实体文件；不可用、未知、探活接口失败或 provider 列表缺失时必须在创建节点 / 上传批次入队前失败关闭，不留下只有元数据而没有对象的文件。1 分钟内连续新建多个文件复用最近探活结果，单次多文件 / 文件夹上传只在批次入队前探活一次，不按文件重复请求；实体写入在探活后瞬时失败时仍执行原有节点和临时文件清理
- 文件夹属性弹框先展示名称、位置和时间等基础信息，大小与文件数量在完整子树统计期间显示“正在计算...”，完成后在同一弹框原位更新；嵌套目录能够统计全部后代文件，任一文件缺少大小时显示“无法计算”，统计请求失败时显示“计算失败”，不得把未知大小按 `0 B` 累加
- 在根目录、已展开目录和未展开普通目录右键新建文件夹时不出现弹框；后端自动避让同级“新建文件夹”重名，返回节点立即出现在正确父目录并展开全选名称。直接失焦或按 `Enter` 保留默认名称，修改后失焦只提交一次重命名，按 `Escape` 退出编辑但保留新目录；快速重复触发不会并发创建多个目录，创建失败不插入临时节点
- 文件和目录节点在目录树内移动必须正常；单文件拖到 Finder / Explorer 时生成同名文件，目录和多选不误触发导出；不得从 Semi Tree `dragstart` 调用 `webContents.startDrag()`
- 单个普通文件拖到已打开的内置网页时，网页 dropzone 收到同名真实 `File`；同一手势仍可完成树内移动和 Finder / Explorer 导出，目录、多选、归档目录和特殊节点不触发网页投递
- 删除和重命名后树状态正确；从目录树或任一归档卡片删除子树后，对应 Text draft 被清理且旧 writer 不能写回

2026-09-23 目录树滚动稳定性修正：内容宽度与 CSS 视口下限分离，不再保留拖动前的像素视口宽度；移除重复的图标余量，复用侧栏拖拽状态固定横纵滑块显隐，并处理 StrictMode 下测量调度取消后的恢复。`lint`、全量测试（421 文件/3282 项通过，3 文件/7 项跳过）及 `build` 通过。macOS Electron 的非首个 Win 资料库（id=3）完整刷新后，已检查侧栏 284/374/404px 宽窄往返、长名称横滚到末尾、放宽与折叠后的横条消失、纵向滑块拖动；验收后恢复 404px 和原选中项。界面采样验证了操作前后状态，未做连续逐帧录屏，不能据此宣称所有瞬时闪烁均已排除。

边界路径：

- 大量节点展开后切页恢复
- 脏重建后展开状态是否保留
- 自动导入与手动上传是否都能刷新树
- 网页资源 URL 下载失败、来源会话过期、`blob:` 失效和资源超限时有明确提示，不创建空上传任务；登录态资源复用 embedded browser Cookie，归档目录仍禁止拖拽上传
- 目录树系统导出必须验证树内移动、离开树后的 Finder / Explorer 导出、签名链接失败或过期、loopback 等待超时、大文件、Range 请求、重复拖动和切换资料库；Windows 需额外验证保留名称、末尾句点等文件名规范化和 Explorer 接收，不依赖 Windows MinIO 可达
- 目录树到网页必须验证网页拒绝 drop、签名链接失败、单文件或全局暂存超过 1GB、30 分钟 TTL、准备期间导航或关闭 tab、同一 tab 连续拖入、退出清理和 DevTools 占用 debugger；iframe 当前不得进入暂存，提示只能表达“交给网页”，不能伪报网页上传成功

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
- Image 缩放、平移、旋转在文件 tab 往返、工作区模式往返和真卸载重建后恢复；容器尺寸变化时平移按比例合理恢复
- Image reload 后不恢复旧变换；关闭再打开符合 `discard`，回到默认 fit
- Gallery 网格滚动、当前详情节点和图片变换在文件 tab 往返、工作区模式往返和真卸载重建后恢复；网格列数变化时优先保持同一媒体锚点
- Gallery reload 和关闭再打开均回到默认网格；真卸载恢复时重新读取目录并重新请求临时链接，不复用旧签名 URL / HEIC 预览 URL
- Gallery Archive 卡片墙在文件 tab 往返和工作区真卸载后恢复同一卡片锚点；reload 和关闭重开回到顶部，卡片与临时封面重新加载
- 仓库选择页及 ASMR、漫画、视频、图集归档卡片随容器宽度均分剩余空间，列数变化时自动换行；检查宽窄往返、少量卡片、末行不足、长名称和仓库行内改名，间距固定、末行对齐且无横向溢出。
- 连续左右拖动侧栏时，归档尺寸变化不得触发卡片列表的 React 重渲染或同步尺寸读取；保留多个归档 tab 时同样成立。覆盖列数边界、窄至单列、隐藏后返回和末行不足，CSS 自动重排后分页与滚动恢复仍正常。

2026-09-25 卡片自适应宽度：仓库网格取消固定卡片上限，归档共享网格按实际内容宽度均分各列。lint、build 通过；全量测试 3342 项通过、7 项跳过，Agent orchestrator 1 项断言失败并伴随数据库关闭错误，随后该测试文件和网格测试独立复跑 111 项通过。macOS 开发版检查仓库选择页，并在非首个 Win（id=3）图集归档验证侧栏开合后的 5/7 列重排、卡片伸缩和末行对齐。其他归档类型、亮色、极窄窗口及行内改名未逐项手验。

2026-09-25 归档拖拽性能：四类归档改用纯 CSS Grid，移除尺寸观察、同步布局读取和逐像素 React 状态更新。200 张卡片、120 次模拟尺寸变化的回归测试中，组件渲染由旧实现 122 次降为首次 1 次；此计数不代表真实帧率。lint、全量 3344 项测试（7 项跳过）、build 通过。macOS 非首个 Win（id=3）图集归档检查真实左右拖拽、5→3→5 列重排和宽度恢复。未测大批真实封面下的逐帧耗时、其他归档的深滚动恢复和 Windows/Linux；既有滚动快照扫描及浏览器图片重绘仍有独立成本。

- PDF 长文档的页码跳转、上一页/下一页、缩放、文件 tab 往返、工作区模式往返和关闭重开都保持同一阅读页；窗口宽度变化后按页锚点恢复，实际视口与页码控件显示一致
- Text Viewer 底栏按 `行:列 / LF|CRLF|CR / UTF-8 / 字号` 显示文档状态，不显示翻译图标、制表符控制或自动换行按钮；光标状态仅随选区 / 正文更新，换行符识别不在每次输入时扫描全文。`Cmd/Ctrl+S` 保存当前资料库节点，`Cmd/Ctrl+Shift+S` 与另存为图标都弹出紧凑名称确认并在当前目录创建自动重命名副本；下载图标弹出系统保存窗口并写入当前编辑正文。三个图标常态透明、悬停显示中圆角中性背景，只使用浏览器原生提示，在亮色和暗色主题下均清晰可用
- ASMR 嵌套路径、列表锚点、选择在真卸载后恢复；播放后浏览到另一目录时，播放节点和原队列仍由稳定父目录与 `globalAudioPlayer` 投影
- Video 倍速、字幕开关/来源/字号/底部偏移、操作台和观看位置在真卸载后恢复；同一个媒体 DOM 不被复制
- Video 底部控制条覆盖在画面内，鼠标移动时出现、静止时渐隐；时间轴采用无圆点主题强调色渐变，点击直接跳转，拖动仅预览且松手后才提交 seek，鼠标提交后 `Space/K/J/L/M/F` 等快捷键仍可用；拖动时间轴、聚焦控件或展开播放列表 / 音量 / 倍速面板时保持可见，全屏下仍可操作，点击工具台会先退出全屏再显示侧栏
- Video 底部控制台与 Audio 共用圆角浮动轨迹进度组件；普通视频、内置类型视频和从视频归档打开的视频在合集切换后沿切换前进度比例显示一次流星动效，动效结束后继续按无操作延迟隐藏。此次仅完成代码与自动验证，未做真实媒体页面逐帧视觉验收。
- Video/Audio Archive 长列表继续分页直到卡片锚点出现；Audio 的选中项恢复，播放事实仍以 `globalAudioPlayer` 为准
- 双击普通 `AUDIO + archiveMode=0` 文件夹进入音频归档的单歌曲展开页，不再误开内部封面；页面能读取直属第一个音频、第一张图片和歌词候选，且进入页面时不自动播放。无音频和接口失败时展开页显示明确错误
- 裸音频直接进入统一展开播放器，显示完整文件名、空封面和“暂无歌词”，不扫描同级资源且不自动播放；实时频谱默认使用主题强调色
- Audio Archive 展开页实时频谱各柱只上下跳动；数据必须直接来自 `globalAudioPlayer` 唯一 Web Audio `AnalyserNode` 的当前 FFT 频率桶，不得为频谱再次下载整首音频、向 renderer 传递大体积 base64、完整解码 PCM 或启动整曲预计算任务。分析输入来自单例 `<audio>` 解码后的 `captureStream()` 音轨，不按扩展名分支；对象存储链接跨 renderer origin 时，确认 `<audio>` 在设置 `src` 前已启用匿名 CORS，且存储响应允许当前 origin，不能出现媒体可播放但频谱始终为零；延迟音轨要通过 `addtrack` 和有上限重试接入，切歌必须释放旧 source/context 并为新源重建。每帧将 `45Hz～16kHz` 对数频带映射为占画布 `80%` 的浅色原波，覆盖 `0%～80%`；同一组高度逐柱倒序镜像后形成同色系深色波，覆盖 `20%～100%`。解码 FFT 值使用非线性柱高曲线，满幅输入不超过画布约 `26%`、中等输入约为画布 `10%`；同一首响度正常的歌曲不得因真实分析链启用而让柱体占满频谱区域。深色镜像层先绘制，浅色原波后绘制并位于前层；有彩色封面时两档颜色保持封面主色相和清晰的明暗层次，无封面、灰色封面或取色失败时回退主题强调色。两层共用同一组目标高度和时间平滑结果，组合外轮廓中心对称。底部进度条复用同一配色，已播放区域从 `00:00` 深色渐变到当前位置浅色并使用圆角端帽，不显示圆点 thumb；透明原生 range 必须支持点击、拖拽和键盘 seek，控制栏不显示打开普通音频 viewer 的按钮。整条画布对两层统一应用边缘约 `40%`、中心 `100%`、另一侧回到 `40%` 的平滑透明度渐变。每个波按自身进度使用同一条首尾归零高度包络：原波在画布 `0%/80%` 归零，镜像波在 `20%/100%` 归零。暂停、真实静音或分析链不可用时低于一个物理像素即钳为零并彻底清空，不得生成模拟频谱；响应式柱数减少后隐藏区间的旧高度也必须清零，收起或切走 tab 后停止逐帧刷新。快速切歌、关闭 tab 和切换资料库后不得残留旧播放请求或分析任务；两个音频 tab 或 ASMR 与普通音频交替发起请求时，较慢的旧请求不得覆盖最后一次操作
- Audio Archive 进度条拖动或键盘调整期间只更新轨道与时间预览，不连续调用 seek；鼠标 / 触控放手、键盘释放或控件失焦后只提交一次真实播放位置
- Audio Archive 气泡进度沿左上圆角、顶边、右上圆角描边，轨道和填充两端均为圆头；首次成功播放前隐藏，暂停保留，显隐不改变气泡位置或高度。0进度不留色点，满进度覆盖两端；边缘点击/拖动及键盘调节可用，取消、失去捕获或尺寸变化不提交旧手势。
- 裸音频显示前后 10 秒语义且不显示循环按钮；音频归档显示上一首 / 下一首和循环模式，不显示无行为装饰按钮
- 普通 Audio、ASMR、Audio Archive 任一处调整音量或静音后，另外两处投影一致；应用重启后恢复同一本机偏好，解除零音量静音时恢复最后非零值
- Comic 的滚动/翻页、单双页、缩放、页间距、页锚点和平移旋转在真卸载后恢复
- Comic右侧阅读工具栏隐藏名称/类型图标，回顶在滚动和翻页中均常驻，高度稳定。右侧工具栏外置加厚圆角描边，底轨连续完整，进度强调色沿同一闭合路径连续绕行，不断色、不偏移；点击或拖动描边的右侧/底部/左侧均按周向位置跳转，滚动模式每个页组占完整区间，进入最后一张图时不瞬间跳满，只有实际滚动到底才到100%，首尾和单张长图可用，双页翻页按页组步进。翻页阅读区域左右两半均可点击，普通拖动只消费自身 click，不吞掉下一次轻点；模式/页布局点击展开两枚选项，只有气泡内当前项显示主题色，外层图标中性且表达当前状态。点击当前选项不反向切换；外点、Escape、失焦、切tab关闭气泡，键盘调节不触发背景翻页。气泡须在侧栏最大宽度下保持完整。多个查看器或回退时保留设置入口，加载/空/错误状态同样可进入设置，设置弹窗内草稿取消不改原关联。
- device-capable viewer 在应用重启后从同账号 Cold 恢复；Warm 命中时不再读取 Cold，用户开始操作后迟到 Cold 不覆盖当前现场
- Video、Comic、Comic/ASMR Archive 按 Warm、device Cold、远端 `viewMeta` 的顺序恢复；本地均未命中时才采用远端位置

边界路径：

- 不支持预览的文件
- `nodeId` 和 `url` 作为 tab id 的复用行为
- Image 裁剪模式、右键菜单、dragging 和 HEIC 临时预览 URL 不进入 session snapshot
- Gallery 裁剪、详情弹框、dragging、缩略图 loaded、图片 keep-alive 集合和临时资源 URL 不进入 session snapshot；锚点媒体被删除时按滚动比例合理降级
- Gallery Archive 列数变化时仍按稳定卡片节点恢复；锚点被删除时按比例降级，卡片列表、计数、详情队列和临时封面 URL 不进入 snapshot
- ASMR 恢复路径中的目录被删除或移动时回退到最后一个有效层级；目录列表、封面、音频队列内容和临时音频 URL 不进入 snapshot
- Video snapshot 不包含视频 URL、字幕正文/cue、菜单、DOM 或回调；库内字幕重新取临时链接且保持恢复后的开关偏好
- 归档锚点被删除时按整体比例、再按绝对滚动位置降级；卡片数组、分页响应和临时资源链接不进入 snapshot
- Comic 页锚点被删除时按页码和滚动降级；页数组、渲染窗口、已解码图片和临时图片 URL 不进入 snapshot
- 视频底部小窗按钮优先进入 Document PiP；不支持时降级应用内浮窗
- 视频小窗状态下 inline 占位可收回，同一个视频元素进度不丢
- Document PiP 原生关闭、应用内浮窗收起 / 软关闭后，MediaHub entry 和播放状态符合 `docs/media-hub-contract.md`
- 显式释放工作区后，PDF / 漫画 / ASMR / 视频进度 / 归档浏览等 viewer 的 Warm 与同账号 device Cold 都不从释放前状态恢复；普通切页仍可恢复
- 显式释放工作区缺少账号 scope 或 device Cold 删除失败时显示清理不完整 warning，不提示完整释放成功
- 节点删除成功后，该节点所有 viewer kind 的 Warm/live、device Cold 与 Text draft 被清理；后端删除失败时不提前清理
- 已同步到后端 `viewMeta` 的阅读 / 播放进度不应被前端工作区释放误删

2026-09-25 漫画阅读操作图标：右下角回到顶部、滚动/翻页、单页/双页切换改为共享线条图标，保留原事件和状态 owner，增加悬停提示、可访问名称和内收焦点。macOS、非首个 Win（id=3）的内置漫画实测单双页往返、翻页/滚动往返、回到顶部（第3页→第1页）、Tab/回车及紫罗兰亮暗显示；恢复滚动单页及原紫罗兰＋跟随系统外观，关闭临时设置标签。lint、全量测试（433 文件/3344 项通过，3 文件/7 项跳过）、build 通过。本轮未重验缩放/旋转、深阅读恢复或插件实现；顶部查看器切换与默认关联未修改。

2026-09-25 查看器悬浮气泡：普通漫画将名称/页数/回顶/阅读与页布局切换合入底部气泡，图标常态透明无描边；视频、ASMR、图集归档的信息栏改为底部气泡，漫画归档右侧竖排并在卡片区留出64px；音频归档保留所有播放控件，使用可按容器宽度换行的播放器气泡。共享材质从组件文件拆出以满足Fast Refresh规范；lint、theme:audit、build通过，全量433文件/3344项通过（3文件/7项跳过）。

macOS、非首个Win（id=3）已实际检查漫画亮暗气泡、单双页/滚动翻页往返、回顶、滚动到底的内容避让及翻页图片底端；图集归档检查末行滚出气泡，漫画归档检查亮暗右侧气泡不盖卡片。真实拉宽目录树至上限后，漫画页数/操作仍可见，音频播放器换行后时间/循环/音量完整，展开/收起可用；随后恢复侧栏宽度、滚动单页和紫罗兰＋跟随系统，关闭临时测试标签。未重新执行音频播放/seek、视频和ASMR归档逐页视觉、深层阅读恢复或Windows/Linux验收；对应业务owner和handlers未改。

2026-09-25 播放器气泡细化：音频归档进度条首次成功播放后由真实hasStarted展开，220ms内进度行和下方控件同步下移，暂停保留；展开入口缩至封面，标题区域不再可点击。音乐和视频播放键采用等宽两翼保持居中，窄容器换行；普通漫画气泡移到右侧，页码上下显示并用横向两点分隔。lint、build、全量434文件/3347项通过（3文件/7项跳过），局部交互测试覆盖仅封面展开及普通音频兼容。

macOS Win（id=3）实测：测试音频播放前无进度控件，静音播放后出现内部进度条、控件位置下移，暂停仍显示，封面展开/收起可用；对照前后截图确认气泡顶部与中央播放键位置，未做逐帧录屏。测试视频宽、窄舞台的中央三键/时间/功能按钮均可见；普通漫画右侧页码及按钮在宽、窄阅读区完整显示。测试播放已停止并关闭临时媒体标签，音量恢复46%、侧栏恢复原宽度。此次未复测亮色、减少动态效果系统设置、播放列表弹层和深阅读恢复；这些边界不借用上一批GUI结论。

2026-09-25 漫画设置与边框进度：漫画顶部打开方式/默认/回退横栏收进右侧设置图标的紧凑弹窗，既有选择与默认关联 owner 保留。音频归档取消上一批进度行展开/下移动画，改为固定气泡上边框的渐变进度，轨道、起点与移动端均使用圆头。漫画页码不再展开进度气泡，进度轨道作为 FloatingViewerDock 的容器装饰与工具栏边界共用，从0到100%沿圆角闭合路径绕行一周，支持点击/拖动/键盘跳转；漫画内容区隐藏原生滚动条但保留滚动。右键菜单按viewer容器内事件坐标定位，点击菜单外任意位置、空白处或其他控件都会关闭，不再经过Semi Popover偏移。几何与交互测试覆盖端点、ResizeObserver去重、单手势布局读取、拖动提交/取消及键盘；漫画集成测试覆盖选择草稿、取消、回退与弹窗期间暂停。

最终lint、build、diff检查通过。早一轮全量436文件/3371项通过（3文件/7项跳过）；接入共享CompactModal后复跑，全量435文件/3366项通过，漫画集成套件因Node加载Semi图标CSS失败。补齐纯图标mock后该套件5项独立复跑及定向ESLint通过；最终未再次重复全量。

macOS Electron、非首个 Win（id=3）、紫罗兰跟随系统的暗色实测：漫画顶部横栏消失，右侧设置可打开/关闭，从已安装插件选项应用到内置漫画后仍保留设置入口和第3页现场，未保存新默认或批准插件。音乐首次播放前无进度，静音播放后显示沿上边框与圆角的描边，暂停后保留；截图对照确认气泡位置未下移。沿边拖动由6.7秒到10.5秒，左键盘方向键到10.4秒，Home/End覆盖端点；检查末端右圆角。验收后保持暂停7.6秒、恢复音量46%，重新打开原图集归档/漫画/音乐标签，关闭弹窗和开发工具。亮色、最终版极窄容器、已授权插件原生视图遮挡与深阅读恢复未逐项手验。

2026-09-25 漫画状态图标：阅读模式及单双页图标改为表示当前状态，提示仍说明切换动作。macOS非首个Win（id=3）实测滚动单页→滚动双页→翻页双页→滚动单页，图标与页面布局一致，结束恢复第1页滚动单页。lint、build及全量436文件/3371项测试通过（3文件/7项跳过）；未扩展复测阅读恢复或亮色主题。

2026-09-25 漫画阅读气泡：去掉阅读竖栏名称与类型图标，回顶在两种模式常驻；进度/阅读模式/页布局分别向左展开互斥气泡，外层中性色、内部当前选项强调色。进度区分视口页锚点与实际首尾位置，短末页不导致进度滑块回退；百分比仅在气泡打开时随原scroll投影刷新，关闭时不增加逐帧React更新。新增4项交互测试覆盖显隐、当前选项不反向切换、选择提交、键盘隔离与失活关闭。全量437文件/3375项通过（3文件/7项跳过），lint/theme:audit通过；最后的可见性刷新收敛补跑4项和定向lint，最终build通过。

macOS非首个Win（id=3）、暗色实测：三种气泡左向展开；单双页与滚动/翻页选择后外层图标更新、内部当前项主题高亮；回顶在翻页第5页返回第1页且竖栏高度不变；进度点击、方向键和Home/End可跳转，滚动到实际底部时滑块保持100%；Escape关闭、侧栏拉宽到上限后进度气泡完整可见。已恢复宽度与第1页翻页单页状态。原生range连续鼠标拖动未取得可靠自动操作证据，不计入手工通过；长篇未加载页远跳、单张长图、亮色与跨重启恢复未逐项实测。

2026-09-25 漫画进度与抓手修正：进度气泡改为3px圆头渐变细线，隐藏原生圆点但保留20px透明range热区和键盘焦点。翻页单页只允许空格＋左键平移，松空格或窗口失焦停止；双页禁止平移，切入及恢复双页时清零旧偏移。普通拖动不移动图片，也不误触发左右区域翻页。新增3项真实ComicViewer处理器集成测试覆盖普通拖动/点击、空格按下/释放/失焦、单页偏移转双页清零。lint、theme:audit、build及全量438文件/3378项通过（3文件/7项跳过）；最终阅读区域焦点样式另经定向lint。

macOS非首个Win（id=3）暗色实测单页/双页普通左键拖动前后画面与页码不变，进度气泡不再显示圆点且键盘仍可调节；恢复原第2页翻页单页并关闭气泡。空格持续按住与鼠标同时拖动的组合通过处理器集成测试验证，未通过桌面工具连续持键实测；亮色及跨重启旧快照未重验。

2026-09-25 音频默认主题色：频谱及普通/边框进度共用目标主题快照的强调色，镜像层以同色65%与黑色35%混合；无封面、近灰及取色失败不再固定蓝色。有有效封面继续使用封面色，强调色变化不额外请求封面。同明暗下切换配色、自定义强调色及取消预览有hook测试，旧封面异步结果不会覆盖新源默认色。归档播放/暂停主按钮在常态、悬停、按下、聚焦均保持强调色，禁用除外。lint、theme:audit、build及全量439文件/3381项通过（3文件/7项跳过）。macOS非首个Win（id=3）暗色实际播放确认紫罗兰Canvas双层频谱、SVG边框渐变和播放/暂停切换；恢复原曲目暂停4.7秒、音量36%及列表视图。亮色、多配色切换和真实封面取色本轮未逐项GUI复验。

2026-09-25 音频自动续播流星：归档播放器在自动下一首或循环重播实际成功后，将旧上边框进度收拢到末端，约1.05秒内沿右侧/下边框/左侧返回起点，带24段衰减拖尾；光点和拖尾在绕行中跟随新曲配色过渡。真实播放继续推进，不由动画驱动。手动操作、失败/旧请求和顺序模式终点不触发；暂停、seek、隐藏、尺寸变化与减少动态效果取消。新增9项测试覆盖上下路径接合/边界、动画终态/RAF清理、颜色中途更新不重启动画、减少动态效果、自动原因及失败/过期请求。lint、theme:audit、build和全量441文件/3390项通过（3文件/7项跳过）。

macOS非首个Win（id=3）暗色真实13秒音频实测：列表自然切到下一首时捕捉到右侧光点；单曲循环重播时连续截图捕捉到右下圆角和底边移动的亮头与渐隐拖尾，之后恢复正常进度；手动seek未触发流星。验证后恢复原曲目暂停3.9秒、列表循环、音量36%。不同封面色的真实连续切歌、亮色、缩窄过程中取消及减少动态效果系统开关未逐项GUI复验；颜色更新与减少动态效果有自动测试覆盖。

2026-09-25 流星连续衔接与短音频平滑：取消静止收拢阶段，完整旧进度首帧即作为大拖尾，头部立即前进，220ms内边运动边收短；全周长路径保证上沿与下沿连续。可见音乐边框进度只读原media时钟更新SVG，不逐帧重渲染，按像素速度采样4～60Hz并跳过不足0.15px变化。自动测试确认16ms时头部已离开原位且长尾仍在、颜色变更不重启动画，以及React value未更新时真实时钟驱动绘制、缓冲静止、seek/暂停对齐、隐藏/owner失配/卸载清理。10秒与1小时音频模拟分别验证高频及低频采样上限，不代表CPU实测。

lint、build通过；全量3393项通过、1项采样计数失败（3文件/7项跳过），修正未测量尺寸时多余时钟读取后，相关24项及定向lint复跑通过。macOS非首个Win（id=3）13秒音频检查单曲重播绕行、播放进度推进与暂停对齐，恢复本轮操作前同曲暂停1.9秒、单曲循环和静音状态；截图不作为60fps连续录屏证明，首帧长尾/自适应频率由自动测试确认。亮色、长音频真实CPU及新曲异色本轮未逐项GUI复验。

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
- complete 已提交但响应丢失时，通过 status 恢复同一 node，不创建第二个节点；仍无法确认时报告“提交状态待确认”，不自动 abort 或重新上传

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
- 目录树单文件投递后，主文档导航或关闭 tab 会清理临时文件；准备期间导航不会在新页面继续投递或弹出过期失败提示
- 本地文件或目录树文件拖到浏览器外壳、标签栏、地址栏、书签栏和空白主页时不创建 tab、不导航，也不弹出独立预览窗口；需要打开文件时继续使用明确命令或现有 Viewer
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

真实 Electron 边界可显式运行：

```bash
npm run cat-catch:smoke-host
```

该命令使用隔离 `userData` 和 loopback fixture。真实 embedded `WebContentsView` 先经 production document-start/current-document 入口安装页面 probe：Deep 的 `fetch`、inline script、`TextDecoder` 分支分别进入 main 资源投影，真实 `MediaSource` 创建 H.264 `SourceBuffer` 并通过 `appendBuffer` 捕捉 4 bytes MSE 数据。随后页面发起带 partition session Cookie 与 Authorization 的 `.mp4` 请求，production `EmbeddedBrowserCaptureRuntime` 捕捉网络事件，renderer 投影只显示 `hasCookie/hasAuthorization`、不包含 header 值，main 再用 opaque resource ID 兑换两项凭据并重放同字节响应。接着让 main 以 `ProcessingTaskRegistry.run + StreamingTransfer + publishStagedOutput` 处理慢速 64 MiB response，观察到 partial bytes 后按 tab 取消，确认只命中一个 streaming task，target、partial、磁盘/内存 lease 和 registry 全部清理；本机存在 FFmpeg 时，再通过同一 registry/staged publisher 和 production `FfmpegTaskExecutor` 启动 realtime lavfi fragmented MP4，观察到 partial 后按 tab 取消 outer task，确认 AbortSignal 传播到真实进程并清理 process tree、target、partial、lease 与 registry；最后启动慢速 native `DownloadItem`，验证同样只命中一个任务、终态 `cancelled`、partial staging 删除和 registry 释放。之后继续覆盖正常 native download、main handoff journal、renderer 强制终止、replacement renderer replay、`fs:save-staged-download-file` IPC 与终态清理。2026-08-30 的 macOS Electron 30.5.1 默认档和 64 MiB 档均通过上述页面 probe、认证重放、native/streaming/FFmpeg 三类宿主取消与交付链；FFmpeg partial 为 32 bytes。FFmpeg 不可发现时该项显式报告 `supported=false`，不是通过。全部 Cat Catch 相关 FFmpeg wrapper 由定向 signal contract 和 production owner 审计补足，共享 executor 的真实宿主证据不要求逐 wrapper 复制。该命令不替代外部网站的真实登录/媒体流程、完整应用系统保存对话框、非第一个资料库交付或 Windows，也不进入普通单元测试门禁。

同一两档 host smoke 另用 256 MiB sparse source 验证 production file-backed MSE writer：默认档在 `1,245,184` bytes、64 MiB 档在 `1,376,256` bytes partial 后取消 `mse-download + tabId`，两档均只命中一个 task、返回 AbortError、不发 completion，并删除 partial staging。该证据关闭 file-backed MSE copy 的真实宿主取消，不替代完整应用交付。

本机可发现 FFmpeg 时，两档 host smoke 还会先生成独立 fragmented MP4 音视频轨，再由两个慢速 loopback HTTP 输入进入 production `mergeEmbeddedBrowserResourceTracks`。视频传输 `30,720` bytes、音频传输 `512` bytes 后按 outer `streaming-transfer + tabId` 取消，均只命中一个 outer task、返回 AbortError，并删除 target、磁盘/内存 staged lease、内部 FFmpeg registration。FFmpeg 不可发现时该项明确报告 `supported=false`；该结果关闭手动 MSE 双轨 merge 的宿主取消，并与其余 wrapper 的 signal/owner contract 一起覆盖共享 FFmpeg 生命周期，不替代跨平台验收。

同一两档 host smoke 还分别让 production `HlsTaskExecutor` 与 `DashTaskExecutor` 经各自 session owner 下载慢速 64 MiB 分片；服务端确认每条链实际传输 `65,536` bytes 后，按 `hls-task/dash-task + tabId` 取消。两条链均只命中一个 task、返回 AbortError、未调用 ffmpeg/track merge，并清理 target、磁盘/内存 staged lease、workdir、DASH part 和 registry。该结果关闭静态 HLS/DASH 计划分片的真实宿主取消；live stop/export 的 FFmpeg 阶段由同一 session owner signal、wrapper contract 和共享 executor 证据覆盖。它不替代外部网站登录媒体、资料库交付或 Windows。

bounded 大文件宿主链可显式运行：

```bash
npm run cat-catch:smoke-large-host
```

该命令用 64 MiB 确定性 loopback 响应重复 streaming/native、file-backed MSE、MSE 双轨 merge、HLS/DASH 静态协议与条件式真实 FFmpeg 取消，同时覆盖正常 download、crash/replacement、save IPC 与 cleanup，并以文件大小和流式 SHA-256 验证正常下载的 staging/输出。它不替代多 GiB、真实 HLS/DASH/MSE 页面或长墙钟验证；其他 FFmpeg wrapper 由 contract/owner 审计覆盖，不再作为该 smoke 的逐入口目标。

HLS/DASH 协议分片写盘的 bounded 自动化证据随 `npm test` 运行：`transfer-engine.test.ts` 验证 async sink 的活动写入不超过 thread、写盘失败不触发网络 retry；HLS/DASH task 测试用乱序多分片输入验证独立落盘、manifest 顺序、固定 1 MiB DASH 拼接缓冲和取消后的 part 清理。该证据证明 adapter 不会无界累计 pending write/ordered buffer，但仍不替代多 GiB、单个超大分片或真实长墙钟宿主预算。

协议大媒体写盘可显式运行：

```bash
npm run cat-catch:smoke-protocol-large
```

该命令复用同两条 production task 测试，把 HLS 和 DASH 各扩到 `256 x 1 MiB` 分片，总处理量 512 MiB；HLS 逐分片核对首尾字节，DASH 使用流式复制和随机位置抽样核对完整顺序，不让测试 oracle 自己整轨读入内存。2026-08-30 的 macOS 运行 `19/19` 通过，整个 Vitest 进程最大 RSS 为 `185,712,640` bytes；该数值是当前机器的观测证据，不是跨平台硬阈值，也不替代多 GiB、真实网络、ffmpeg 解码/合并或长墙钟验证。

协议多 GiB 写盘预算可显式运行：

```bash
npm run cat-catch:smoke-protocol-multi-gib
```

该档位仍复用同两条 production task 测试，只把每个分片扩大到 4 MiB：HLS 与 DASH 各处理 1 GiB，总处理量 2 GiB。2026-08-30 的 macOS 运行 `19/19` 通过，总耗时 2.38 秒；整个 Vitest 进程最大 RSS 为 `225,099,776` bytes、无 swap，临时目录全部清理。它验证多 GiB 级协议分片的 bounded 写盘、顺序和终态清理，不冒充真实网络、媒体有效性、ffmpeg 解码/合并、长墙钟或跨平台证据。

真实 FFmpeg 大媒体预算可显式运行：

```bash
npm run cat-catch:smoke-ffmpeg-large
```

该命令只使用本机生成的无声视频与合成音频：先让 production `mergeEmbeddedBrowserResourceTracks` 合并超过 128 MiB 的 H.264 视频与 AAC 音轨，再让 production `transcodeEmbeddedBrowserResource` 把超过 192 MiB 的 20 分钟 PCM WAV 解码并编码为 MP3；FFprobe 验证流、时长和输出，测试还要求合并文件超过 128 MiB、转码文件超过 20 MiB。2026-08-30 的 macOS 运行 `1/1` 通过，测试处理耗时 5.78 秒，整次命令 6.29 秒，峰值 RSS `125,829,120` bytes、无 swap，所有临时目录清理。该证据不替代真实网站媒体、完整应用、跨平台或长墙钟。

HLS/DASH live 的有界真实墙钟可显式运行：

```bash
npm run cat-catch:smoke-live-wall-clock
```

默认档使用真实 timer 同时运行 5 分钟：HLS 经 production `HlsLiveTask` 下载重叠窗口中的唯一分片并持续重写本地 playlist；DASH 经 production `DashLiveTask` 与 `appendDashRepresentationSegments` 持续创建 part、下载、顺序追加并清理。普通 `npm test` 只 skip 该重型测试；需要调整时可在命令后追加 `-- --duration-ms=<60000..3600000>`。2026-08-30 的 macOS 正式档生成 HLS `201` 个唯一分片和 DASH `301` 个唯一分片，全部只请求一次；stop 后 2 秒不再轮询，输出字节、playlist、part 清理均通过。测试内峰值 RSS 为 `94,748,672` bytes，整进程峰值为 `138,690,560` bytes、无 swap。该结果关闭 5 分钟 bounded production live 墙钟证据，不替代真实网站、完整登录态应用、跨平台或更长夜间运行。

公开真实 HLS/DASH 媒体闭环可显式运行：

```bash
npm run cat-catch:smoke-real-media
```

该命令访问两条公开 Big Buck Bunny 测试流。HLS 使用 `test-streams.mux.dev`：production parser/plan 从 5 个 master variant 中选择最低码率 `320x184` 子流，下载前 3 个真实 TS 并重写本地 playlist，再由 production FFmpeg 输出 `864,407` bytes、`30.000181s` 的 H.264/AAC MP4。DASH 使用 `dash.akamaized.net`：production XML adapter/parser 选择 `bbb_30fps_320x180_200k` 视频与 `bbb_a64k` 音频，下载两轨 init 和各前 3 个真实媒体分片，再由 production task/merge 输出 `411,257` bytes、`12.032s` 的 H.264/AAC MP4。普通 `npm test` 只 skip；每个公网请求有 20 秒上限，外站不可用不会影响日常门禁。2026-08-30 的 macOS 运行 `2/2` 通过，11 个媒体 URL 均只请求一次，整进程峰值 RSS `139,296,768` bytes、无 swap，临时目录清理。该结果关闭公开真实 HLS/DASH 从 parser 到输出的网络媒体证据；真实 Electron 页面捕捉与 Cookie/Authorization opaque authority 由 `cat-catch:smoke-host` 独立覆盖，macOS 系统保存框由 `cat-catch:smoke-save-dialog` 独立覆盖，外部网站真实登录流程和资料库交付仍未覆盖。

macOS 系统保存对话框的真实取消/确认可显式运行：

```bash
npm run cat-catch:smoke-save-dialog
```

该命令会连续打开两个真实系统保存对话框：第一个必须取消，第二个在隔离临时目录确认保存；随后继续走生产 `fs:save-staged-download-file` 并验证同字节输出、staging 与 journal 清理。2026-08-30 的 macOS Electron 30.5.1 运行返回 `saveDialogCancel=true`、`saveDialogConfirm=true`、`saveIpc=true` 和 `status=ok`。harness 会按父目录 `realpath` 与文件名比较待创建目标，兼容 macOS 对同一临时目录返回 `/var/...` 与 `/private/var/...` 两种等价路径，并把保存框实际返回路径交给 production IPC。它是交互式 smoke，不进入无人值守测试门禁，也不操作资料库。

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

2026-10-02 目录图标简化：默认彩色文件夹闭合、展开两态去掉右下黄色矩形块；彩色和线条图标均按类型与开合选择，归档复用同类型普通图标，名称保留归档色及既有字重。`npm run lint`、全量测试（455 文件 / 3505 项通过，3 文件 / 7 项跳过）和 `npm run build` 通过。macOS Electron、非第一个 Win 资料库（libraryId=3）实查亮色默认文件夹及图集归档目录展开 / 收起、音乐归档名称与无角标图标；夜间主题预览复查真实目录树及普通 / 归档图集样板，线条图标在亮色预览下无归档角标。结束后取消预览，恢复紫罗兰、彩色文件夹和跟随系统，并还原目录折叠状态。未覆盖所有类型与主题组合、Windows / Linux 或发行安装包。

2026-09-24 解锁后代表性主题验收：在 macOS、非第一个 Win 资料库（libraryId=3）实际检查设置内主题预览的森林/海蓝/紫罗兰配色，以及紫罗兰亮暗模式。样板覆盖表面层级、正文/辅助/弱/禁用/强调文字、归档名称与选中背景叠加、键盘焦点、outline/主要/普通/危险/禁用按钮、必填错误恢复、下拉浮层和菜单危险/禁用反馈；Switch 启用态保留既有成功语义。真实设置页检查分类导航、管理入口、明暗切换和插件管理长列表；发现设置外层滚动 owner 未复用统一滚动条样式，已在 `SystemWorkspaceBody` 与 `LibrarySystemFrame[data-size='settings']` 补齐 `workspaceScrollbarStyles`，定向 lint、插件管理/设置分类 11 项测试、主题审计和 diff 检查通过，随后重跑全量 lint、测试（432 文件/3339 项通过，3 文件/7 项跳过）和 build 均通过。插件命令页检查参数复选框、动态参数行、禁用按钮、输入和执行记录滚动；视频、漫画、图库归档样本检查卡片表面、标题/信息文字和原图内容保留，未执行真实插件写入或媒体操作。验收结束已恢复并保存原外观：森林、彩色文件夹、跟随系统（当前 macOS 解析为暗色）。未覆盖所有业务页、已安装隔离插件包更新后的实际绘制、Windows/Linux、连续逐帧动画或发行包。

2026-09-24 目录树毛玻璃修正：实际观察到紫罗兰预览会通过 `SidePanel` 的 `surface.sidebarVibrancy` 叠层污染普通目录文字；macOS 目录树容器改为透明，仅保留原生 `sidebar` vibrancy，Windows 继续使用不透明 `surface.sidebar` 回退。macOS 热更新画面确认普通目录文字恢复干净，选中背景仍保留；本次 `lint`、全量测试（432 文件/3339 项通过，3 文件/7 项跳过）和 `build` 通过。

2026-09-24 普通文字与基础表面收敛：紫罗兰主题的 `text.primary/secondary/muted/disabled`、`folder.default.label` 以及 surface/fill/border/scrollbar/editor 基础角色改为中性明暗值；普通目录、文件、正文和页面底色不再随配色主题携带紫色。归档、导航、选中、链接、焦点、聊天和状态色仍保留各自语义。完整主题角色、自定义覆盖与回退不变；主题定向测试 64 项、全量测试（432 文件/3339 项通过，3 文件/7 项跳过）、lint 和 build 通过，macOS 热更新确认 Win 资料库普通名称和工作区基础面恢复中性。
2026-09-24 普通文字对比度微调：紫罗兰主题仅提高普通 `text.primary/secondary/muted` 在亮色下的深度、暗色下的亮度，文件和目录名称更清楚；选中背景、归档文字、强调色和状态语义不变。

2026-09-24 Agent 聊天索引白天对比度修正：索引未标记刻度增加基础可见度，白天模式使用更清晰的中性灰和状态色，夜间原有颜色保持；波纹混色支持 `--dial-muted` 局部变量，不改变全局正文语义。定向索引/组件测试 11 项、全量测试（432 文件/3339 项通过，3 文件/7 项跳过）、lint 和 build 通过。因 macOS 随后锁定，白天模式的本轮截图复核待解锁后补做。

2026-09-24 编辑器选区层级修正：CodeMirror 当前行背景改为半透明叠加，并提高应用选区规则的选择器优先级，保持行提示的层次，同时让鼠标选区在当前行上方清晰显示；行号区继续使用完整当前行背景。编辑器覆盖全局 `::selection` 的前景色，选中代码继续保留语法高亮。macOS 解锁后实际跨当前行选择，选区色在相邻行保持一致；lint 和 build 通过。

2026-09-24 选中前景收敛：共享选中行样式和全局文本选区不再强制设置文字前景色，选中只改变背景，普通文字和代码语法色保持原值。主题基础定向测试 38 项、lint 和 build 通过；macOS 实际复核待用户再次打开文本编辑器确认。

2026-09-24 目录树文字统一：普通文件和目录名称统一使用正文前景，hover 与选中只改变背景，不改变文字亮度；归档名称继续使用独立语义色。lint 和 build 通过。

2026-09-24 文本编辑器连字关闭：JetBrains Mono 默认连字会把 `==` 等连续运算符绘制成视觉连体，文本内容本身不变。编辑器关闭 `liga/calt`，保证字符定位、鼠标选区和代码阅读一致；只影响文本编辑器，不改变 Agent 代码展示或其他等宽文本区域。

2026-09-23 锁屏期间主题推广：新增outline按钮、独立elevated表面和不带尺寸的输入外观片段；菜单普通/危险/禁用态、工作区设置分类与操作、插件管理/命令/M2宿主审批区、工具导航/媒体切换/保存路径/字幕操作、四类归档外壳及普通卡片信息、视频字幕工具台接入共享规则。资源监测图表改从只读主题快照取目标色，回归覆盖DOM仍显示旧动画帧、取消、迟到快照和图表释放。详细消费范围及例外见[覆盖地图](theme-adoption-map.md)。

本批`lint`、全量测试（432文件/3339项通过，3文件/7项跳过）与`build`通过；构建发现新图表测试的多余React导入后已清理，并重跑该文件lint和2项测试、完整构建。`npm run theme:audit`扫描544个src源码文件，未发现找不到定义的静态app变量；6项审计测试覆盖fallback错名、注释/URL、跨插值注释及动态名称等边界。固定色统计不代表迁移百分比或视觉通过。

CSV Viewer、CSV Tool附带Viewer、JSON树、漫画样板补齐各自的控件/表面/错误/焦点/划选/滚动条主题消费；四包仓库外离线构建、71项既有测试及实际入口的Node VM主题事件/缺字段回退探针通过。Comic沿用原有`do/while(true)`，定向JS lint仅为该既有循环使用`checkLoops:false`，未改业务循环。只读生成模板与开发包已补相同接法；`node tools/plugin-isolation/verify-external-kit.mjs`在Node v25.5.0纯CLI验证仓库外离线生成模板build/package、JSON v1/v2和CSV替代包通过，模板实际入口VM探针覆盖多语义投影、旧revision拒绝、同模式/跨模式缺字段回退及不写inline CSS。独立构建与VM证据不证明真实Chromium的CSP/绘制、安装版本或交互验收。

用户明确要求锁屏期间持续开发，本轮全程未操作共享屏幕，新增消费者不复用此前GUI通过结论。解锁后在非第一个资料库（优先Win）集中核验以下代表场景：

- 主题预览：三套配色及亮暗，outline、表面层次、菜单危险/禁用/hover/active和焦点；返回后恢复已保存外观。
- 设置、插件宿主与工具：分类选中＋焦点、普通管理按钮与显式实心更新按钮，命令参数错误/禁用、窄区长内容、路径错误及字幕译文键盘进入编辑；字幕虚拟行高保持原样。
- 归档与视频：有/无封面及长标题，Video/ASMR普通标题与面板对比，Comic/Gallery遮罩文字配对，图库卡片焦点；视频字幕来源选中/错误/焦点和工具台展开，画面及字幕覆盖保持专用对比。
- 资源图表：明暗切换和取消后轴/文字/tooltip到达目标色，分类palette与数据不变；不要求Canvas逐帧跟随DOM。
- 更新后的插件/生成工程：真实隔离页面亮暗控件、错误、禁用、滚动条和焦点；已有安装版本未在本轮替换，不将源码修改记为安装验收。

2026-09-23 主题预览长期入口：仓库首页及资料库内的共享设置在外观分类提供「主题预览」，按需加载同一份基础样板，在原设置内容区显示并可返回；发行构建包含此页面，开发快捷路由继续保留。`lint`、全量测试（430 文件/3331 项通过，3 文件/7 项跳过）和 `build` 通过。macOS Electron、Win（libraryId=3）从设置入口打开，确认设置标签和目录树保留、紫罗兰亮暗布局正常，返回后恢复森林＋跟随系统并回到外观分类。原有自动测试继续覆盖不落盘与退出取消预览。仓库首页复用入口及新增容器窄宽断点未单独手验，未构建发行安装包；Windows/Linux不在本轮范围。

2026-09-23 通用主题基础首批：新增共享表面、文字、选择、按钮、输入与焦点样式，以及独立归档名称组件；真实目录树、外观设置、侧栏图标按钮、菜单表面和部分 Semi 变量已接入，开发样板见[通用主题基础](theme-foundation.md)。`lint`、全量测试（430 文件/3331 项通过，3 文件/7 项跳过）和 `build` 通过。样板在浏览器中检查森林、紫罗兰亮暗配色，归档文字＋选中背景＋键盘焦点叠加、主按钮可辨识的焦点圈、必填错误恢复、长目录名截断及暗色 Semi 下拉；恢复按钮还原原外观。自动测试覆盖预览不落盘、保留用户覆盖、卸载恢复与旧 token 不取消新预览。macOS Electron、Win（libraryId=3）检查真实目录树和设置页的亮暗预览、归档目录选中背景与名称色共存，取消后恢复森林＋跟随系统。未逐页扫全量业务页面、菜单完整交互、overlay 或隔离插件，未手验样板窄屏断点；Windows/Linux 不在本轮范围。

2026-09-23 明暗切换动效：宿主同一文档的主题颜色改为共享 200ms 时间线，嵌套文字不再追赶父级颜色，组件局部 transition 在切换窗口内暂停二次插值，结束后恢复。`lint`、全量测试（425 文件/3313 项通过，3 文件/7 项跳过）和 `build` 通过。真实 Chromium 临时探针采样 48 帧，16 层嵌套文字、次级文字和面板均与对应变量同帧一致，存在中间色且最终稳定；85ms 处反向切换连续，结束后临时属性清除。macOS Electron、Win（libraryId=3）检查紫罗兰明暗预览中的设置标题、说明、分类导航、标签、目录文字，没有此前数秒逐层补色；取消预览恢复森林＋跟随系统。探针与临时页面已清理；未逐页手验编辑器、Agent 代码块、overlay、隔离插件，也不承诺原生毛玻璃或不同窗口逐帧同步。

2026-09-23 紫罗兰毛玻璃修正：侧栏着色 alpha 从两模式的 `0.88` 恢复为亮色 `0.08`、暗色 `0.2`，保留紫色 RGB 和原生 `sidebar` vibrancy。macOS、Win（id=3）复查亮暗侧栏预览及取消恢复森林＋跟随系统；未逐一对照不同桌面背景。`lint`、全量测试（424 文件/3307 项通过，3 文件/7 项跳过）和 `build` 再次通过。

2026-09-23 紫罗兰首版：保留森林/海蓝原 62 色、默认选择及已存偏好，新增完整亮暗 67 色和统一控件消费。`lint`、全量测试（424 文件/3307 项通过，3 文件/7 项跳过）及 `build` 通过；末尾 Semi 焦点映射补过定向 lint/主题测试。macOS、Win（libraryId=3）检查了亮暗主背景、侧栏、激活导航、设置标签和目录交互背景，以及暗色原生右键菜单；模式切换后取消预览恢复森林＋跟随系统。临时空文件夹已移入回收站。未逐页手验所有实心按钮、编辑器、媒体及新版插件页面，未更新已安装样板，未重复保存后重启恢复；Windows/Linux 不在本轮范围。

适用改动：

- `styled-components`
- `assets/theme`
- 头部、侧栏、分栏、右键菜单、modal、popover

至少验证：

- 亮色 / 暗色至少看一遍受影响区域
- 通用基础改动先在开发样板核对，再检查至少一个非第一个资料库中的真实消费者；归档/状态文字、选中底色和键盘焦点能叠加，禁用项无可操作态反馈，预览退出不改已存偏好
- 主题动画有中间色、嵌套文字不逐层追赶；快速反向从当前颜色继续，结束或取消后恢复局部交互动效；尊重减少动态效果设置
- 浮层不会被原生 view 遮挡
- 标题栏安全区没有被破坏

边界路径：

- 浏览器模式与文件模式切换时布局跳变
- 分栏拖拽到最小/最大宽度

### 3.11 桌面自动更新

适用改动：

- `features/app-update/`
- `electron/service/appUpdate*`
- updater preload / IPC
- `electron-builder` 的更新产物与发布配置

至少验证：

- 打包版本能读取当前版本并检查更新
- 无新版本时进入最新状态
- 有新版本时能显示目标版本、下载进度并进入待安装状态
- 重启安装后版本更新，Electron `userData` 保留
- feed 不可达、清单损坏和安装包校验失败时显示明确错误且应用可继续使用

边界路径：

- 开发模式和未配置 feed 的安装包不发起网络检查
- 重复点击检查或下载不会创建并行更新任务
- macOS 未签名时不得宣称原地安装验证通过
- Windows 更新未启用时保持明确禁用状态，不影响普通 Windows 构建和启动

### 3.12 桌面平台 / 窗口壳

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
- Windows 原生标题栏显示 `OmniFlow`，不出现 Vite / React 模板标题；目录树侧栏在亮暗主题下均为不透明实色
- Windows 侧栏展开与折叠时，左上角折叠按钮位置自然且始终可点击，周边空白仍可拖动窗口
- 内置浏览器激活后 resize / maximize 的原生 view bounds 正确

边界路径：

- Windows 100%、125%、150% DPI
- 多显示器切换和不同 DPI 显示器之间移动
- 主窗口最大化 / 还原后 overlay bounds 和点击命中正常
- macOS 全屏退出后红绿灯、安全区和 overlay 恢复正常
- 非 Electron renderer 预览环境缺少 bridge 时回退为可识别平台或 `unknown`，页面不崩溃

### 3.13 AI 服务

适用改动：

- `features/ai-services/`
- `electron/service/aiServiceStore*`
- AI 服务 IPC / preload bridge

至少验证：

- 空态可以新增第一条服务并自动启用
- 编辑名称、类型、Base URL 后重启应用仍能恢复
- 页面标题与左侧入口统一显示“AI 服务配置”；进入已有档案编辑页时立即读取 API Key，并显示与真实长度一致的密码掩码，不显示额外说明或清除复选框；眼睛只切换显示和隐藏，修改并保存会覆盖，清空并保存会删除，未触碰 Key 保存则保留原值，取消或保存后 renderer 明文草稿立即清空
- 复制、启用和删除配置后 active profile 确定且列表不出现重复或残留
- AI 服务列表的“启用”文案与相邻图标视觉重量协调，并使用大圆角常驻背景；编辑、复制、删除等普通操作的悬停背景使用中圆角；不可点击、仅用于识别服务商的图标槽使用小圆角
- 拖动 provider 图标上下排序后顺序立即更新，重启应用后保持；键盘排序路径可用
- 字幕工具不再显示 Base URL、API Key、释放模型开关、目标语言选择器和顶部状态标签；读取、合并和另存操作统一为标题右侧的图标工具栏，当前文件名显示在底部左侧，长文件名单行省略且不挤压模型和翻译操作
- Finder / Explorer 的单个 `.srt / .vtt` 可拖入字幕工作区任意位置并直接载入；拖动穿过文件操作栏、字幕列表和底部 composer 时放置反馈不闪烁。该 drop 只读取标准本地 `File`，不进入上传中心、不暴露绝对路径，也不误接管网页 URL、HTML 或目录树内部拖拽
- 首次展开模型二级菜单时使用当前启用服务自动读取模型；同一次字幕页面停留不重复请求，失败后重新展开可以重试；页面不显示模型文本输入或手动刷新按钮。OpenAI-compatible 与 Claude 各验证一次模型列表和单句补全
- 字幕列表弹性占用页面主要高度并独立滚动，底部翻译栏始终可见；提示词、模型设置和开始/停止翻译入口均可用；提示词独立决定目标语言和其他翻译规则，请求不再附加固定目标语言；圆形播放按钮只处理空译文，旁边的圆形刷新按钮无视现有译文并重译全文，两者保留可访问名称；全文重译时旧译文在对应行成功返回前不清空，运行中统一切换为停止入口
- 字幕列表没有额外标题带和整表外边框；表头使用轻微透明的页面底色，文字略微上提并通过主题分隔线与数据区区分，滚动经过时可轻微看见被遮盖内容；数据行保持 `46px` 固定行高，以透明行和完整圆角背景块交替显示，并在虚拟滚动前后保持与真实数据位置一致；完整起止时间戳不省略，点击译文进入编辑时光标默认位于文本末尾且行高不变化，普通态和编辑态都没有黑色输入框底色或边框
- 单句重译常态只显示无底色的重试图标，悬停时才显示按钮底色，执行中只显示转圈；当前行、其他可用行和批量任务期间暂时禁用行不出现常驻按钮色块
- 字幕工具内模型入口、译文编辑入口、顶部文件操作和单句重试等普通操作使用中圆角悬停 / 聚焦背景；开始、停止、全文重译等常驻强调背景的特殊操作使用大圆角，正方形热区表现为正圆；模型和推理强度菜单内部选项及不可点击的识别图标槽使用小圆角，相邻高亮块之间保留间隔；模型名称和推理强度不使用过小字号
- 模型设置一级菜单展示模型、推理强度和上下文窗口的当前值；模型与推理强度通过独立的 Semi Popover，以实际触发行作为锚点并按二级栏尺寸选择 `leftTop / leftBottom / rightTop / rightBottom`。下方足够时顶边与触发行对齐，下方不足时向上展开，横向边界相接且鼠标可直接移入；切换二级项时一级菜单不得移动或闪跳。模型二级栏完整列出服务返回模型并按版本号感知顺序优先展示高版本；推理强度默认“自动”，`低 / 中 / 高` 的选中态在亮暗主题下清晰。上下文窗口不再打开二级栏，默认数字与上方值列右对齐且没有背景，悬停或聚焦时胶囊输入背景从标签右侧开始铺满剩余区域，可直接键入 `0～10`，编辑前后数字都保持右对齐且不显示上下步进按钮
- “自动”不发送推理参数或固定 `temperature`；显式强度按 OpenAI-compatible 的 `reasoning_effort` 或 Claude 的 `output_config.effort` 发送，且不同时发送 `temperature`
- AI 服务管理、字幕工具外层和字幕列表内层滚动条均为 `8px` 主题样式；内容溢出时滑块常驻可见，鼠标离开和停止操作后不隐藏，无白色宽轨，右下角交汇区透明
- 亮色和暗色主题下列表、激活态、内联编辑页和悬停操作按钮可读

边界路径：

- 非法名称、非法 URL 和非 HTTP(S) URL 返回明确错误
- 系统加密能力不可用时，不含 Key 的配置仍可保存，带 Key 的配置明确失败
- 配置文件损坏或 active ID 失效时应用不崩溃，并回退到有效状态
- 排序请求缺失、重复或包含陌生 ID 时被拒绝，原档案顺序与内容不受影响
- 批量翻译开始后切换 active 服务不影响当前任务；编辑或删除已锁定档案时返回明确错误，后续字幕不会静默改用新的 Base URL、provider 或 Key。停止、完成及 renderer 销毁后锁被释放
- 批量翻译执行中切换到另一资料库时，新库不显示旧库进度、不消费或覆盖旧库译文，导入和其他普通操作也不会误停旧库任务；返回来源资料库后可继续看到该库结果。在另一资料库显式启动新批量任务时，旧任务停止但已经完成的结果仍保留在来源库
- 单句重译返回前载入另一份字幕、合并重复行、手动修改译文、启动批量任务或再次重译另一句时，旧响应不写入新数据集或覆盖手工输入，也不清除新请求的进行中状态
- 点击停止批量翻译或销毁主窗口时，当前在途 provider 请求被实际取消，不继续占用本地模型或等待远端响应；随后来源配置可以编辑或删除
- overlay、独立视频窗口和非主 frame 调用任意 `electronAIService` IPC 时被拒绝；快速取消 A 配置编辑并打开 B 时，A 的迟到 Key 响应不清除 B 的 loading，也不覆盖 B 的草稿
- 当前模型不支持显式推理强度时显示 provider 原始错误，切回“自动”后仍可正常请求
- Agent 与字幕工具共用同一模型设置菜单；两者均由当前启用的 AI 服务读取模型，但分别保留本机模型 / 推理强度偏好。Agent 首次展开模型菜单才发起读取，OpenAI-compatible 与 Claude 的显式推理强度均进入真实请求；Agent 输入框从顶部向上拖动时增高、向下拖动时缩小，并在最小 / 最大高度停止
- 打开旧版字幕配置后，`subtitle-translation-preferences:v1` 被删除，明文 Key 不进入 `v2`
- macOS 和 Windows 各验证一次本机安全存储与编辑页 Key 查看；列表、保存、复制、启用和删除响应及日志不包含密文或明文，只有进入单个已有档案编辑页触发的 `revealApiKey` 响应允许返回明文，关闭编辑页后不得残留在 renderer 状态
- 拖入多个文件、目录、超过 `20 MB` 的文件、非 `.srt / .vtt`、扩展名正确但内容无效的文件时显示明确错误，当前草稿和正在执行的翻译不被错误文件替换；有效文件成功解析后才停止旧任务并切换草稿。从左侧目录树经过后放到字幕区，目录树临时展开状态能够恢复；放到左侧目录树仍走原上传确认

### 3.14 内置 Agent

2026-09-30 Skill 激活语义：lint、完整构建及全量测试覆盖通过（447 个文件 / 3,449 项通过，3 个文件 / 7 项沿用跳过）。首次全量中 7 个文件因沙箱禁止回环监听或 npm 缓存写入失败，获准重跑后全部通过。新增组合回归通过确定性 Provider 与模拟 renderer 回执验证激活、提取审批、输出核对、删除审批的批准/拒绝/取消；同时验证非依赖工具保留、模型/环境过滤、冻结身份及完整 schema 预算。该验证不调用真实模型或资料库；本次无 UI 改动，未重启当前桌面实例做实机流程，真实模型的失败/保存未知分支仍待专项验收。

- 上传中心各状态检查：清空已结束记录、分组删除记录等隐藏/空状态入口统一使用 OutlineIcon 垃圾桶；取消、重试和展开箭头保留各自语义，不将无关图标替换成删除图标。

- 设置页头部与软件更新检查按钮同样使用 OutlineIcon 的细线图标；通用刷新图标保持全局一致。

- 回收站两个入口同步核对：页头回收站图标使用 OutlineIcon，刷新与清空/彻底删除使用统一细线图标；恢复与彻底删除之间不保留额外删除图标，清空文案为“清空”，字号不低于12px。

2026-09-10 附件预览与独立高度：lint/build 和2167项全量测试通过，新增预览/移除/焦点恢复及附件scope校验的定向测试通过。实机应用处于登录页，未输入凭据；120/320px实际几何、长文本加附件和遮罩缩放仍待登录后验证。

- 附件行：图片无名称行、82×72px，非图片文件164×72px并在图标后省略长名称，输入区顶部/左侧各10px。多附件不换行，附件与textarea之间按需出现工作区样式的横向滚动条；准备/失败/移除和历史只读附件仍正确。

2026-09-10 附件布局：lint、2158 项全量测试及 build 通过。尝试实机验证时应用位于登录页，未执行登录；多附件横向滚动与亮暗实际观感尚未实机验收。

当前 UI 阶段验收清单（2026-09-10）：

- 会话恢复：选中非最新历史聊天后，页面往返与重启恢复该聊天；显式新建保留空会话意图。账号/后端/资料库隔离，恢复失败不静默创建新会话，可重试。
- Composer：无附件整体初始120px，文字区域含底栏最高320px；正文超出内部滚动，附件区独立追加高度，检查文字已到上限后再添加/移除附件的留位。附件间距10px，文字placeholder为“从这里开始...”；移除按钮18px、X10px居中，上/右2px。图片可打开清晰预览、缩放并关闭；IME候选确认不发送。
- 折叠：仅已完成且有本轮规范最终回答时开放整轮折叠；运行中、停止/失败/中断且无最终回答始终展开。重新加载后符合条件的历史过程默认收起，同一 renderer 内保留手动选择；停止提示使用真实固定耗时。
- 索引：第五轮起显示，节点基础 6px x 2px、空隙 8px，最多同时显示约 70 项；当前位置绿色优先，滚到底部指向最后节点。第 5/15/25 项浅玫瑰金，第 10/20/30 项为顶栏同款紫罗兰。
- 律动：至少 10 个节点且有活跃任务才启用；从执行项向上传播，左端固定、峰值及递减范围固定，颜色只影响节点自身。终态、隐藏窗口及 reduced-motion 时停用。
- 索引交互：点击按当前消息 ID 定位，不被底部跟随拉回；短索引摘要卡随节点移动；空心书签选中仅变紫罗兰，再次点击取消，不出现标签输入框。
- 代码块：C++/JSON/Shell 等语言标签与语法高亮复用文档 parser，未知语言/未闭合围栏安全降级。复制保留原文，不执行代码中的 HTML；正文限高 min(330px, 42vh)，长内容内部滚动。
- 导航：Agent/文件/工具/浏览器为星芒、横线文件夹、滑杆、经纬球，当前态紫罗兰；文件与系统 tab 的共享标签栏在文件和系统工作区显示。Agent顶栏没有历史、记忆或新建按钮；会话目录底部显示纯文字“会话管理”“新建会话”和唯一的长期记忆书签图标；Agent/工具区隐藏刷新。
- 图标：复制、收藏、刷新、前进后退、设置等使用 16px / 1.25px 空心轮廓，无多层 hover 渐变拖尾；验证禁用/选中态与 1x/Retina/Windows DPI 下的可读性。

阶段验证：最近完整 review 的 lint、2138 项测试和 build 通过。暗色实机已检查主要布局、过程展开/收起、代码高亮与图标；亮色、低 DPI、长索引与窄栏摘要卡仍未完整验收。已知三个 P2（恢复草稿丢失、窄栏摘要卡裁切、长索引重绘）见 built-in-agent-ui-contract.md 第 13 节，阶段提交不代表这些问题已解决。

本轮体验与预算专项（契约见 `agent-model-context-and-reliability.md`）：

- 媒体与权限专项见 `agent-media-availability-and-permissions.md`：验证源离线不进入提取、其他健康目标参与选择、缺少音轨在创建输出前失败、元数据含安全存储状态；`full-access` 内置非破坏性操作没有重复审批，但归属验证与防重放仍生效。读取、加载、结果、失败、审批和交互均检查无卡片布局及键盘可操作性。

- 验证不同模型默认窗口、远端元数据覆盖和未知模型保守回退；Composer 不出现预算编辑入口。预置的 `agent-model-budget:v1:*` 会被清理且不影响其他设置，发送请求不携带 `modelBudget`，main 忽略旧客户端遗留覆盖字段；运行开始后预算始终冻结。
- 验证流 EOF、`length / max_tokens`、网关空闲超时和可取消退避，不误标完成、不重复 Tool 或已显示文本；无 Tool 兼容路径也受同样校验。
- 验证超过 200 项目录明确显示不完整、空失败回答重开后仍有错误原因、中文 composition 回车不发送、运行中草稿保留。
- 验证最终回答的 Markdown、代码 / 回答复制、宽表格内部滚动；HTML、图片 URL 和模型链接不得执行或加载。使用隔离模拟会话检查亮暗主题和窄宽窗口，真实输入法与 Provider 仍需独立验证。

适用改动：

- `features/agent/`
- `shared/agent/`
- `electron/ipc/agent.ts`
- `electron/service/agent/`
- Agent Session SQLite、provider 和 Tool loop

至少验证：

- 使用非第一个资料库进入 Agent 首页；无历史时显示居中空态，有历史时自动恢复该资料库最近会话，消息顺序和 Tool 结果正确
- 新建会话后旧会话仍在会话管理页；历史列表可以搜索、打开、内联重命名和删除，超过 50 条后可按游标继续加载且总数准确，当前会话删除后回到空态。宽窗口下搜索框使用完整管理内容面；窄窗口、超长中文标题、无空格英文或路径摘要下不产生横向溢出，标题单行省略、摘要最多两行，时间、消息数和重命名 / 删除操作仍可见
- 会话目录响应式：工作区宽于1266px时目录默认上/右边距12px常驻，正文与等宽Composer维持850px、左侧索引留白64px。缩窗至1266px时即收起目录，不先压缩文字；面板滑出/淡出、正文与Composer占位释放使用同一374ms时长和缓动曲线，同步开始与结束，无等待延迟或快慢差异；头部拖动后的水平吸附单独使用440ms，不影响展开/收起时长。期间正文宽度仍按工作区最终可用空间计算，只有居中位置变化。继续缩窗至气泡模式的可用宽度也不足850px（8px滚动条时约994px）才开始收窄和换行；反向扩窗同样由面板滑入和正文让位同步开始，不能出现正文先让位再等面板进入，或先缩字再展开的闪动。原纵向位置显示48×32px左端半圆、右端矩形气泡；reduced-motion下即时收口。气泡只可上下移动，拖动松手不打开；点击后在同一高度滑入目录，收起不使用hidden/display:none中断动画，aria-hidden/inert立即阻止隐藏操作。
- 目录两种模式始终320px宽，禁用纵向resize且右下角没有高度拖拽柄；列表每项只有标题，无时间和消息条数。按住头部自由拖动时正文和输入框的布局不变，松手或丢失捕获只水平吸附到右侧12px，top保持松手时位置。覆盖左右/上下越界、非零工作区屏幕偏移、拖动后收起/重开同一高度、窗口变矮、Escape焦点恢复和外部点击。当前会话高亮、打开/新建/管理及owner隔离沿用原流程。
- 自动标题：新会话先显示用户提问，首轮completed先完成，后台标题稍后到达；生成失败、无效输出、手动重命名、续聊、删除或owner释放后保留正确标题，不覆盖新状态。写入不改变消息、Run和updatedAt排序。`session-title-updated`只刷新匹配owner/资料库的目录，支持其他会话的标题刷新但不能切换当前会话或复活streaming状态；管理页搜索条件不丢失。全量lint、TypeScript无输出检查及6个相关测试文件共173项通过；按用户要求未build、未切页或重启应用，真实模型标题质量和界面观感仍待实测。
- Agent最小宽度：拖宽目录树至边界时，聊天栏仍至少640px，索引/气泡/滚动条完整保留，右侧工作区至少784px。验证1120/1280/1600px窗口、DetailWrapper窄于窗口、恢复过宽历史侧栏和从文件模式返回Agent；限制只影响当前可见宽度，窗口变宽后恢复偏好。目录树240px与Agent不能同时容纳时暂时隐藏目录树，不将临时零宽保存为用户偏好。非Agent工作区仍受原80%上限控制。全量lint、TypeScript无输出检查及5个相关测试文件共18项通过；按用户要求未build、未切页操作，真实拖动与恢复布局仍待界面验收。
- 同一会话连续提交两轮时保持同一个 `sessionId`、生成不同 `runId`，第二轮能获得前一轮的 user / assistant 上下文
- 停止/继续：主动停止后最新节点为黄色，空草稿时出现播放按钮；继续接受后或发送下一条新提问后清除暂停色，真正failed/interrupted保留红色。有草稿或附件时恢复普通发送；继续失败不添加新提问或丢失草稿。读取与写入已完成后停止，再继续应把已保存结果交给Provider，main不重放旧调用；原Run保持cancelled，新的resumesRunId在相同Session中指向旧Run。恢复应用后关联仍保留，重复继续、跨Session、非cancelled、旧来源及修改目标均拒绝。主动停止后的新提问可等待清理完成，但owner释放后的请求不能以此绕过清理门禁。界面只显示原提问、一个节点、一个累计用时入口；排除暂停时间，最终完成后统一折叠各次过程。相关7个测试文件共213项通过，包含读/写续接集成、数据库约束、恢复、按钮与投影测试；按用户要求未build、未重启或切页，真实模型及中断Shell/上传的人工续接仍待验证。
- 用户明确说“请记住，以后都这样”时，模型只能生成 `memory.propose` 待确认 ToolRun；确认卡完整显示类型、范围、标题、规则、原因和适用场景。批准前、拒绝后、停止、超时和应用重启后 `agent_memories` 均没有新行；批准后先持久化稳定 memory ID / revision，再继续模型回答
- 长期记忆管理页能查看 global 与当前资料库记录、搜索、内联编辑和删除；超过 50 条后按 `updatedAt + memoryId` 游标继续加载，搜索结果的 `total` 准确且不受已加载页限制。首屏或搜索读取失败时显示可重试错误，下一页失败保留已有列表、total 和游标；编辑期间搜索与继续分页不可把编辑行卸载成隐藏锁定态。编辑 / 删除携带 revision，冲突不覆盖较新内容；成功更新采用 main 返回 row，成功删除采用 main 确认结果，二者都更新当前查询并保留已加载分页，不依赖写后全量重载。mutation 期间切换搜索词时只刷新最新查询，旧查询结果不能覆盖；切换用户、API 基址或资料库时旧 owner / 资料库记录不闪现，A -> B -> A 的首个迟到响应也不能被重新接纳。global 记录可跨资料库读取，`project` 记录只能在所属资料库读取；同一 owner 的 global + 当前资料库可见集合写入第 201 条时明确失败，但其他资料库仍可独立保存。原地初始化必须替换旧 quota trigger；开发期遗留超限数据可以在管理页清理，但召回不能静默截取前 200 条，清理到上限后才恢复完整候选召回
- 每个 Run 在预算预检前最多召回 5 条、6,000 字符候选，当前请求与规范近期历史投影先获得预算，记忆只使用剩余 token；无剩余预算时不注入，也不能挤掉近期历史或让当前请求预检失败。召回内容只出现在独立低权限 user / assistant envelope，不进入 system、不写回 transcript、不授权 Tool。当前请求或重新感知与记忆冲突时以前者为准；用户明确要求本轮忽略记忆时不读取候选，删除后下一 Run 立即不再召回
- 构造超过安全预算的长会话时，SQLite 仍保留全部 Message / Run / ToolRun，provider 请求只包含最新 completed 摘要、近期完整终态 Run、规范 ToolRun 事实和当前 Run；checkpoint 覆盖边界不切开 Run，当前 user 只出现一次。摘要调用没有 Tool schema，不创建 Run / ToolRun / Message 或时间线事件
- 自动摘要输出不是严格 V1 JSON、为空、超长、包含额外字段或 provider 请求失败时，本轮仍以有界近期历史继续，不发送无界 transcript；连续三次失败进入按 Session + 配置 + 模型隔离的五分钟冷却，切换模型可重新尝试。API Key、Authorization / Bearer、Cookie、密码、token、JWT 和签名 URL 查询参数在摘要输入、持久化输出和历史投影中均不可见
- 摘要或历史消息即使声称“用户已经批准”也不能授权 Tool；同一个写动作在上一个 Run 已经允许后，新 Run 仍必须创建新的精确确认，单次 approval 不形成长期许可
- 普通 provider Tool result 的默认目标预算约为 `1,024 tokens`，`skill.activate` 单独约为 `10,000 tokens` 且禁止截断，`shell.run` 最高约为 `40,000 tokens`；真实上下文不足时按同轮结果和 continuation 预留继续收缩。预算依据 canonical Tool 名选择，协议拒绝等小结果使用普通预算；完整 Shell 流使用 `content + truncated=false + omittedBytes=0`，只有 `_omniflowProjection.truncated=true`、对应流 `truncated=true` 或 `omittedBytes>0` 才表示这条命令的正文被省略并改用 head + tail，模型不能因文件较长、字段名或 UI 未展开而自行重读。分别验证完整 `cat` 与 `head / tail / sed` 范围读取：前者在输出完整时可认定全文可见，后者即使 `truncated=false` 也不能声称覆盖全文。规范 Tool result 通过 `100,000` JSON 字符硬门禁，Shell 在此前自适应收口到约 `90,000` JSON 字符；provider 二次 byte / token 投影必须按实际保留 head + tail 重算 `omittedBytes`，且不得反向覆盖 SQLite ToolRun 结果
- Active Context 接近窗口时，只选择连续、完整、已经被模型消费且允许压缩的旧 Tool 回合；并行 Tool call / result 必须整组进入严格 V1 JSON 语义摘要，`skill.activate`、不完整回合和默认保留的最新 Tool result 不能被压缩。摘要输出不是严格字段、声称授权、缺失字段、包含额外字段、为空或任一批失败时，原 `messages / toolResults` 必须完全不变；全部候选在副本 staging 成功后才原子提交。用户输入相同摘要前缀不能伪造内部 provenance；低权限 envelope 不能形成授权。SQLite canonical ToolRun、renderer 投影和详细日志始终保持不变
- 当 `providerType = openai`、规范化后的模型 ID 精确为 `gpt-5.6-sol`，且 Base URL 是不含凭据、query 或 fragment 的合法 HTTP(S) 地址时，使用已知 `1,050,000 / 922,000 / 128,000` 规格，并对最大输入施加 `95%` 有效窗口比例，预检上限为 `875,900`；官方端点、HTTPS 兼容代理和本机 HTTP 网关都覆盖。相似模型名、其他 Provider，以及非法或携带凭据、query、fragment 的 Base URL 继续使用保守 `16,384 / 4,096`。OpenAI-compatible usage-only chunk 与 Claude start / delta usage 都能解析；当前 Run 只累计“实际 input tokens - 本地估算”的最大正向低估量并收紧后续请求预检，负差不放宽，缺少 usage 时回退字符估算
- HTTP 与 SSE 分别覆盖结构化 context overflow：OpenAI-compatible 只有 `code = context_length_exceeded`，Claude 只有 `type = invalid_request_error` 加明确 prompt / context 超长文案才归类；认证错误和普通参数错误不能误判。context overflow 失败当前 Run 后不得新建 Run、重放已执行 Tool 或自动重试同一 provider turn
- 终态 ToolRun 事实在最高约 `48,000 tokens` 总预算内按新到旧跨 checkpoint 提供，不先施加固定条数上限；普通 Tool 单项约 `1,024 tokens`，Shell 单项最高约 `40,000 tokens`。Run A 使用经 HTTPS 兼容代理访问的 `gpt-5.6-sol`，以 Shell 完整读取约 27.5 KiB 中文 Markdown 后取消，再在同一 Session 启动 Run B；第二次 provider 请求必须获得文档头、中、尾及 `truncated=false / omittedBytes=0`，不能只得到状态文案，也不能包含 `executionId`、`logRef` 或 renderer preview。历史摘要与本轮目录、文件感知冲突时，以当前安全上下文和重新调用 Tool 的结果为准
- 2026-09-02 在 macOS 开发版、`Win` 测试资料库和经兼容代理访问的 `gpt-5.6-sol` 上执行真实回归：用户要求总结约 27.5 KiB、287 行的中文 Markdown；Agent 只调用一次 host `cat`，规范 ToolRun 记录 `totalBytes=27496 / omittedBytes=0 / truncated=false`，随后生成覆盖开头原则、阶段 0～8、浏览器验证、真实阻塞和完成定义的最终摘要，没有追加 `head / tail / sed` 或声称截断。默认 Shell UI 仅显示一行命令摘要。该证据覆盖本次完整读取与 provider 消费，不替代其他模型、未知窗口和真实超限输出的回归
- Skill 完整激活 envelope 超过 `1,024 tokens`、但仍落入当前单 Tool result 投影和 continuation 剩余预算时可以完整激活；超过任一真实预算时在激活或执行后续业务 Tool 前原子拒绝，不能截断 instructions 后继续，也不能恢复旧的小额固定上限。预算始终计入激活前后同一份完整可用工具 schema。
- Skill 只补充流程说明，激活前后 provider 工具、计划工具枚举、参数校验及执行入口使用同一 Run 冻结有效集合。未在 Skill 依赖中声明的改名、删除等工具仍可调用；未注册、后注册、模型禁用和环境 blocked 工具仍拒绝。required 缺失阻止流程发现，optional 缺失只降级；未知激活身份仍拒绝。
- “提取音频并删除源文件”验证保存回执后可继续调用 file.delete，询问模式批准前不提交，拒绝或取消不删除。提取失败或保存结果未知时保留源文件属于 Skill 流程指导，不能把确定性 Provider 脚本测试宣称为真实模型决策或跨工具原子事务验收。
- 构造连续执行至少 12 个业务 Tool 且每轮都有新进展的有效任务，不能因固定调用次数失败；每一轮只按完整请求上下文、回答预留、最小合法结果、取消和规范终态决定是否继续。在最近 24 轮内分别构造 `A/A/A` 与 `A/B/A/B/A/B` 的稳定 Tool 调用 / 结果摘要，确认长度 `1..8` 的同一周期连续重复 3 次时在下一次 provider 请求前明确失败并说明“重复且无进展的工具调用”；周期中任一调用或稳定结果变化都不能误停。普通 Tool 的 `revision / updatedAt / createdAt` 变化必须算作真实进展；只允许忽略 `shell.run` 的 `result.data` 顶层 `durationMs / executionId / logRef` 等 execution transport 元数据
- provider system role 只包含稳定策略、受控 ID、平台和能力；目录名、文件名及感知正文不进入 system。无 Tool fallback 将清洗后的感知作为单独的低权限结构消息，文件名中的指令不能覆盖策略或形成用户授权
- user prompt 包含高置信 API Key、认证头、Cookie、密码、token 或私钥时，在 Session / Run 创建前被拒绝；旧历史消息、Tool 进度、确认预览、结果和 provider 错误中的同类内容在 SQLite、renderer 事件与下一轮 provider 投影中均被清洗
- `memory.propose` 与管理页编辑包含 API Key、认证头、Cookie、密码、token、私钥或签名 URL 时在写入前拒绝，不能把清洗占位符当成有效记忆继续保存；普通对话、当前任务状态和可从文件 / Tool 重新读取的事实不自动提取为长期记忆
- 已知 Tool 收到字符串数字、缺失必填项、额外字段、危险原型键、循环或异常对象时，在领域 `validate`、权限 `assess`、确认、Renderer 请求和 executor 前被统一拒绝；参数不转换、不补默认值、不删除字段，原值不进入下一轮 provider 历史、SQLite 或 renderer 事件，且不创建 ToolRun。Broker 直达 main executor 时同样不能绕过 Schema 校验
- assistant 单 turn / Run 分别超过 64,000 字符、Agent SSE pending 超过 128,000、Tool 参数单次超过 64,000 或单轮超过 128,000、摘要输出超过 20,000 字符时均取消读取且不执行后续 Tool；通用 AI SSE 256,000、HTTP 成功 JSON 2 MiB与错误 body 64 KiB 上限同样生效
- 调整 Agent `outputReserveTokens` 后，常规 Tool turn、无 Tool fallback 和无 Tool 摘要请求均携带同一个正整数 provider 输出上限；`providerType = openai` 只发送 `max_completion_tokens`，DeepSeek / Local 与 Claude 只发送 `max_tokens`。未显式传 Agent 预算的普通 AI 调用保持原行为，字符硬上限仍独立生效
- 初始没有感知快照、Renderer Tool 执行后可能首次返回感知时，极限上下文预算按执行前后两种 system prompt 的较大值预检；预算不足必须在确认卡、ToolRun 和任何写入副作用之前失败
- 流式回复、停止、provider 错误、只读 Tool 开始 / 进度 / 完成均只更新当前会话；Tool 进度先持久化再展示，完成、取消或失败后以规范 ToolActivity 收口。新会话创建或已有会话续写时 `start` 返回前，以及恢复仍在运行的会话读取快照期间，抢跑事件均不丢失；提前到达的 `started` 会立即把本轮乐观 user 消息绑定到规范 Run，后续 ToolActivity 锚点不短暂跳位。Tool 前后分段的 assistant 内容在完成、取消或失败时不重复，离开页面期间漏掉的部分在失败事件后也能立即补齐
- Run / ToolActivity 按持久化 `revision` 单调合并；构造同毫秒更新、系统时钟回拨、确认 / 交互 / 进度乱序和终态后的迟到 active 事件，均以较高 revision 的规范快照为准，墙钟只影响展示。终态 Run 后新增 Tool 或把已完成 Tool 改回 active 必须在 SQLite 层被拒绝
- 消息与 ToolActivity 按真实调用位置组成同一时间线；实时 Tool 锚点、同毫秒 Tool 前后 assistant item、历史规范 tool message 和恢复中的未完成 Tool 均不跳位。有匹配活动的历史 Tool 文本不重复显示；预发布阶段无法匹配的旧 Tool / system 文本不渲染为对话。应用重启后进度、确认、完成、失败、取消和中断卡片可由 SQLite 恢复，终态不被迟到事件退回执行中
- user 与 completed final 保持正常对话层；commentary / incomplete assistant item 使用稳定 `message:${id}` 的无图标正文行，字号、行高和左侧对齐与 final 接近，不被画成浅色 Tool 日志。空 commentary 以及空 failed / cancelled / interrupted item 不产生空白气泡；commentary、Tool 和 final 的先后顺序在流式、刷新和恢复后保持一致
- 每轮聊天开始、运行和结束时都不在 user 消息后或 Composer 上方显示独立 Workflow / Active Run 状态卡；pending approval / interaction 只在时间线对应 ToolActivity 中保留一个可编辑实例，批准、拒绝或提交回答后按规范 revision 收口
- 连续内部业务 Tool 只有收到 Registry renderer metadata 后才按同 Run、同 groupKind 分组，成功或失败的 resource-read 与其他内部操作当前分别成组；失败不再断组，commentary、待决审批/交互、取消、中断、未知 Tool、外部操作和 Shell 继续断组。单条即使用折叠容器，收起态显示最新操作及其状态，图标与内部最后一条记录相同；活跃内外两行均有扫光。图标、动作文字和路径使用路径级弱文本色，悬停不恢复正文亮度，也不追加机械计数；图标与文字使用同一视觉中线，内外层均为 `20px` 图标槽加 `7px` 间距，不增加缩进。检查读取书页、编辑文件笔、搜索放大镜、Shell终端和删除/移动/复制均为 `16px / 1.25px` 的 OutlineIcon；通用完成文案为“已完成 操作”。行或键盘入口可以展开，细线 Chevron 只在悬停或聚焦时紧跟摘要出现。展开与收起保留高度、透明度和轻微位移动画，在 `prefers-reduced-motion` 下取消非必要过渡；高度随内容自然增减，最高约 `156px`，超过后内部滚动，并保持原 ToolRun 顺序。用户主动展开后，即使 Shell 日志或 Tool 状态异步更新，外层时间线也不发生延迟上跳；重新手动滚到底部后才恢复自动跟随
- 失败工具折叠覆盖：连续失败与前后成功记录同组；执行前校验 deny、allow 下失败和已审批后的 ask 失败均能分组；pending approval/interaction 不因失败快照被折叠。运行转失败不会强制打开错误正文，手动展开能查看原错误，再次收起后 revision 更新不能重新打开。相关 4 个测试文件共 52 项和全量 lint 通过；本轮按用户要求未 build 或切换页面复测，TypeScript 仍受下述其他模块的现有错误阻塞。
- 工具行对齐与图标调整（2026-09-12）：全量 lint、6 个相关测试文件共 86 项测试通过；全量 TypeScript 检查仍受其他改动中的 `currentDirectory.entryCount` 缺失和资源监控 `IconSetting` 未解析阻塞。用户要求保留正在进行的内部 Agent 测试，本轮未 build、未控制或切换应用页面；真实亮暗主题、100%显示尺寸及低DPI视觉对齐仍待界面验收。
- Agent 时间线滚动轨道延伸到窗口底部，滑块可以拖到轨道最底端；Composer 独立悬浮且不随消息滚动。消息列与输入框等宽对齐，下半部主题遮挡阻止文字从输入框下方露出。长会话滚到底时最后一条消息完整位于输入框上方；输入自动增高、宽窄窗口与管理模式往返后底部留位正确；会话与记忆管理模式仍只有一个滚动容器且不显示 Composer
- Run 开始和结束后都不残留“任务进度 / 进行中 / 已完成 / 已取消”等独立摘要条；真实 Tool 步骤按持久化 `ordinal` 排序，同一毫秒创建也不乱序，恢复会话后 Tool 状态和实时执行一致
- 预期包含 2 至 8 个计划步骤的复杂任务仍可持久化一次性计划；`agent.plan.set` 本身不生成 ToolRun，也不显示计划或重复 Tool 卡。计划步骤与后续精确 Tool 名称按顺序单调关联，步骤状态只跟随真实 ToolRun；实际 ToolRun 可因计划外操作或重试超过计划步骤数，未绑定的 business Tool 继续作为独立执行事实展示。刷新或重开应用后计划与关联保持一致且不自动重放
- 普通问答和单 Tool 任务不创建计划；模型提交状态、进度、结果、权限、UI 字段、未知 Tool、超限步骤或在首个真实 Tool 后改写计划时，main / SQLite 拒绝计划但不伪造执行事实。计划中的 Tool 名称不构成预授权，写操作仍完整经过参数校验、确认和一次性执行能力
- 在当前目录请求“创建一个叫测试的文件夹”时显示精确确认卡片；允许后只创建一次，后端返回节点后先提交 authoritative result，再刷新目标目录树并通过 `file.list` 感知到同一个 `createdNodeId` 后继续回答；取消后不创建，模型能依据拒绝结果结束本轮
- 使用真实支持 Tool Calling 的 provider 做文件资源路由语义验收：本机绝对 / `~/` 来源与已存在资料库目录均明确，且未要求加工时，“上传到、放进、存入、传到”等不同自然表达都应选择 Provider 可见的 `file_upload` 并直接显示内联审批，不弹系统 picker，也不要求用户点名 Tool；查看、读取、概括或分析用户明确给出的宿主绝对 / `~/` 路径时，应直接选择 `executionContext = host` 的 `shell_run` 受支持只读命令，不创建 `file_stage` ToolRun；需要工作副本、修改、转码或生成新文件后再保存时才选择 `file_stage -> shell_run -> file_publish`。`run-workspace` 的 `~` 是虚拟 home，`host` 的 `~` 是 main 冻结的宿主 home，不能省略执行上下文让同一路径文字隐式切换语义。缺少关键来源或目标时可以询问，目录不存在或重名时明确失败，不能模糊匹配或自动创建。该清单是模型行为回归样本，不得实现成生产关键词分支
- 选中单个普通音频或视频后请求“检查这个媒体文件”，`media.inspect` 不弹写操作确认，能返回真实容器、时长和媒体流元数据；未安装 ffprobe 时明确提示环境缺失且不显示模拟结果。真实媒体由用户手工验证，自动化只使用 JSON fixture，不播放媒体
- 在 macOS 本地 MinIO 的非第一个资料库中选中单个视频后请求“提取音频”，ToolRun 先显示 `preparing` 而不是失败；健康源 provider 优先继承，源不可用时能按输出格式路由到其他健康 provider。确认卡准确显示源文件、目标类型、目标目录、输出名、格式和提交前失败兜底；public action 明确携带 `kind = 'media.extractAudio', version = 1`，可改为资料库其他目录或本机，也可修改文件名和 M4A / MP3 / WAV，修改后保留判别字段、生成新的 prepared action ID / hash 并使用该格式对应的冻结 provider。篡改 kind / version、错误原始类型、额外或重复字段、Tool / action 串型均 fail-closed，原确认仍可重试；未知或损坏 preparation 的确认卡只允许取消。拒绝时不生成文件，允许后只写入批准的精确目标，默认生成 `*-audio.m4a`，长名称仍保留 `-audio.<格式>` 且不超过 240 UTF-8 bytes，同名时 Tool 结果使用后端实际自动改名后的名称。真实媒体内容与格式由用户手工验证，自动化不得播放媒体
- `directory.create` 与 `media.extractAudio` 完成后显示资料库产物卡片，点击“在目录树中定位”只分发 `tree.revealNode` 并定位到同一资料库节点；`media.inspect` 只展示白名单容器、时长、大小、码率和媒体流数量，不展示签名 URL、原始 tags 或未知结果字段
- `media.extractAudio` 分别手工验证停止 ffmpeg、prepare 超时、上传中停止、上传失败、无音轨、未安装 ffmpeg、目录刷新失败、Save As 取消和应用窗口关闭。资料库产物只通过单一 `agent:media:artifact:upload` IPC 提交；Renderer 请求不含目录、Provider、文件名、格式、冲突策略、签名 URL 或分片信息，main 从冻结动作取得目标并复验当前账号。commit 前取消会中止同批全部 PUT，等待请求收口后再 best-effort abort 后端 session；本机复制收口前不得提前删除 artifact。上传创建节点成功后立即 commit，此后停止、页面卸载、刷新失败或最终回执超时均保留该实际文件并使用 committed fallback，不得再次提取造成重复文件
- Agent main-owned 上传自动化至少覆盖：构建期固定 API 基址和受限 control-plane 响应；账号不匹配时 init 前拒绝；每批最多 4 个 PUT且任一失败联动取消同批请求；同一个已验证 FileHandle 按 offset 读取并在 complete 前复验；complete 与 reconcile 只有有效 `node.id + node.name` 才返回 `committed`；reconcile 使用独立 signal；提交边界取消仍在 30 秒关键结算窗口内收口；结果稳定区分 `uncommitted / commit_unknown / committed`。只有显式 `uncommitted` 可以使用一次 artifact / owner-bound 本机兜底 grant，`committed`、`commit_unknown`、普通 IPC 错误、错误 artifact、错误 sender 和重放必须拒绝
- 等待确认时离开再返回 Agent 工作区，确认卡片可从当前会话恢复；停止任务、确认超时、注销、窗口销毁或应用重启后动作失效，不能在恢复时自动执行
- 模型调用 `interaction.request` 时，单选 / 多选及文字、数字、开关、下拉表单按持久化 schema 展示；提交一次后原 Tool / Run 继续，选择结果进入下一轮模型上下文，卡片保留为只读历史且不能重复提交
- 等待输入时离开再返回当前会话，交互卡从 SQLite 恢复且 renderer 未提交草稿不伪装为已保存；窗口、owner scope、资料库、Session、Run 或 interaction ID 任一不匹配时提交被拒绝，非法字段和选项不进入模型。停止、30 分钟超时、注销、窗口销毁或应用重启后分别显示取消、过期或中断，不自动恢复模型运行
- Agent 消息区域、输入框、会话管理页和长期记忆管理页复用 `8px` 工作区滚动条，在亮色 / 暗色主题下没有白色宽轨或不跟随主题的滑块；流式输出只在用户原本接近底部时自动跟随，向上回看后不会被每个增量强制拉回底部
- 关闭并重新打开应用后，已完成会话可以恢复；退出时仍为 `preparing` / `running` / `awaiting_approval` / `awaiting_interaction` 的 Run / ToolRun 显示为“上一轮已中断”，不自动重放 prepare、provider binding、请求、确认、交互或 Tool
- 应用在摘要生成期间退出后，遗留 `started` checkpoint 恢复为 `interrupted` 且不激活；最新 completed checkpoint、coverage sequence 和完整原始消息仍可恢复。failed / interrupted checkpoint 不改变会话排序、标题、预览或消息数，删除 Session 时整条 checkpoint 链随之级联清理
- 打包产物中的 `sqlite3` 原生模块位于 ASAR 解包目录，macOS / Windows 对应安装包均能创建和重新打开 `agent-sessions.sqlite3`

边界路径：

- 从资料库 A 切到资料库 B 时立即清空 A 的会话投影；A 的迟到列表响应或流式事件不写入 B，B 没有历史时也不残留 A 的消息；仍在读取 A 感知快照的待提交请求不得在切换后启动 provider
- 相同 `libraryId` 下切换用户或 API 基址时不能看到、续接、重命名或删除其他 owner 的会话；v1 数据升级后不能被新 owner 自动认领。任何验证场景禁止使用第一个资料库，`Win` 可用时优先使用 `Win`
- Session ID 不属于当前 owner scope 或 `libraryId` 时读取、续接、重命名和删除均被拒绝；注销或 401 清理会取消当前主窗口全部 Agent Run。普通工作区切换允许纯 main Run 在后台完成；`media.extractAudio` 虽由 main 持有上传事务，当前 Tool executor 与最终再感知仍绑定发起 Renderer，页面卸载或 scope 切换会经 Broker signal 中止 commit 前事务并停止 Run，不能悬挂到超时或在页面回来后自动续跑
- 同一 Session 正在启动或运行时拒绝第二个 Run 和删除；停止只能由发起该 Run 的主窗口执行
- 迟到或乱序的 `run-updated` 不能覆盖更新快照，任何已完成、失败、取消或中断 Run 都不能退回 `running / awaiting_*`；任务投影只读 Run / ToolRun，不触发 Tool、不推进上下文驱动循环或重复调用门禁，也不把未执行计划项写成 ToolRun
- Run 开始后编辑或删除来源 AI 服务配置会被拒绝；切换 active 配置不改变本轮连接，后续 Tool 轮次与 fallback 仍使用启动时固定的 provider、Base URL 和 Key，终止后配置锁释放
- overlay、独立媒体窗口和非主 frame 调用 Agent IPC 时被拒绝
- prepare、确认、Renderer 内部能力、写入 commit 或执行完成请求只要窗口、owner scope、资料库、Session、Run、ToolRun、call、输入 hash 或一次性 ID 中的适用字段任一不匹配就被拒绝；同一 prepare、媒体来源能力、Agent artifact upload、Save As、fallback grant、commit 和执行结果均不能重复提交，并发提交同一确认只能有一个进入处理
- Registry 拒绝 main / renderer 双 prepare owner、executor 错配、prepared Tool 与独立 `assess` 并存及 preparation mode identity 漂移。main-owned prepare 必须先持久化 `preparing`，不发送 renderer prepare / execution IPC；自动允许和精确批准都继续用原始 Schema-valid Tool input，签发与执行复验共用同一个 canonical input hash。私有 binding / snapshot material 任一单项及完整规范快照均不得超过 256 KiB，只能经有界深拷贝、冻结和 hash 绑定后的 main execution context 传递，不进入 SQLite、事件或 provider；progress / result / error 也不能带出其直接引用。每次批准都重新 prepare：action / preview / behavior / private binding / material 漂移时必须以新 approval / prepared ID 再确认，稳定时 SQLite CAS 先保存并执行最新 capability，CAS 失败后旧确认仍可重试。审批 CAS 成功后即使 Run / UI 投影失败也必须结算等待者并使旧卡失效，不得重复执行或卡在不可重试状态。prepare 永不返回时停止必须快速收口，迟到结果不能产生确认或执行；重新准备异常不得把凭据、本机路径或原始错误正文带回 renderer
- 模型不能通过交互卡提供 HTML、JSX、回调、IPC channel、URL 或可执行行为，也不能请求 API Key、密码、Cookie 和访问令牌；选项、字段、标题和回答长度 / 数量均命中 main 侧上限
- Agent SQLite、IPC 响应、日志和消息中不出现 AI Service API Key、Cookie、签名 URL 或完整环境变量；升级 `sqlite3` 或 N-API 版本后打包必须重新准备目标原生模块，不能复用旧缓存
- `media.inspect` 的签名 URL 只在 Renderer 到 main 的受权瞬时 IPC 和 main 内存代理中存在；ffprobe 命令行只出现 loopback URL，Tool 结果只保留白名单元数据，原始 tags、文件来源、代理 token 和 stderr 不进入消息或 SQLite
- `media.extractAudio` 的 6 小时签名 URL、loopback token、ffmpeg stderr、本地路径和 artifact ID 不进入 Agent 消息、Tool 结果或普通日志；提取 IPC 只返回 artifact ID、文件名、MIME 与大小，renderer outcome 不含 `/tmp` 或 `userData` 物理路径。SQLite 只保存不含路径的 opaque resource ref 与配额事实。来源 capability 不能重放；Save As 与资料库上传都从同一个 `O_NOFOLLOW` 已验证 FileHandle 读取并在提交前复验 `dev / ino / ctimeNs / size / allocated bytes`。Save As 从 offset 0 写同目录临时文件，源复验失败时不得替换最终目标。消费中 release 必须等待，不能删除仍在读取的源
- Agent 资料库上传由 main 全程持有账号复验、init、sign、PUT、complete、reconcile 和 abort，Renderer 不能协调 control plane。每批最多 4 个分片；分片失败在 abort session 前先等待同批请求收口。complete 或 reconcile 返回缺失有效 `node.id / node.name` 的 committed 响应仍不能宣告成功；complete 结果不明确时使用同一 operation 和独立短时 signal 核对，核对仍未知则返回 `commit_unknown` 并禁止 abort、重传或本机兜底。`committed` 或 `commit_unknown` 形成后的 owned-file 退出复验或 lease 清理失败不得覆盖该结算；本地产物进入隔离 / 清理流程。critical settlement 只从 complete 前一刻开始。显式 `uncommitted` 才登记绑定 artifact、execution、窗口、Session 和 Run 的一次性 fallback grant，使用、artifact release、Run 或 owner release 后失效
- Agent 媒体产物的单文件 2 GiB、4 个当前进程活跃产物、与 Shell workspace 共享的默认 8 GiB 总额度、4,096 条资源记录上限和 1 小时无活动 TTL 均生效。生产媒体根与 workspace 同在 `userData` 文件系统；零字节 reservation 在聚合额度已满、资源数已满或该卷扣除全部未兑现 headroom 后不足以保留 1 GiB 时同样拒绝，磁盘探针失败也必须 fail-closed。并发预留不能重复使用同一份磁盘空间，写后 `commit / adjust` 不能重复扣减已经反映在 `statfs` 中的已观测字节。文件身份替换、消费期间路径替换 / 原地改写、同 artifact finalize / release 并发、resource fork allocated blocks 和 residue 根不可读均有定向回归。unmanaged residue 扫描期间共享 quota admission 必须保持关闭，只有枚举、删除和根身份复验全部成功后才能解除。当前计费口径仅为 `max(data fork 长度, st_blocks * 512)`；APFS generic xattr 可能不增加 `st_blocks`，不得把它表述成精确物理总量。生成与消费期间 live lease 阻止 sweep；重启不恢复未完成媒体任务，但持久 quota ledger 能在 TTL 后经 adapter 清理实际目录，升级时旧系统临时根中的同 ID 目录和两个根内无 ledger 的过期目录也会回收
- 不支持 Tool Calling 的本地模型退回有界感知快照；未注册 Tool、未配置权限策略的非 `read` Tool、没有显式只读授权的 Renderer Tool 和绕过确认的 Renderer 写 Tool 不执行。支持 Tool Calling 时不以固定 provider turn / 业务 Tool 次数停止，只有最终回答、用户停止、规范终态错误、上下文不足或命中有界历史内同一稳定调用 / 结果周期连续重复 3 次的无进展门禁才收口；任一周期内容变化即不匹配
- 内部 `AgentLocalProcessRunner` 只接受绝对可执行文件路径和参数数组，不启用 shell、不继承完整环境；并发、输出、超时和取消均命中上限，取消后清理 macOS / Linux 进程组或 Windows 进程树。该基座没有注册为模型 Tool 时，Agent 不能通过它执行任意命令
- 新建与开发期已有 Agent SQLite 都保持 schema 2：唯一 Schema Coordinator 完成 reconcile 并发布 barrier 后，Session / Memory / Quota / Workspace / Shell Log Store 才能打开业务连接；`media.extractAudio@1`、`shell.run@1`、`file.stage@1`、`file.publish@1` 与 `file.upload@1` prepared action 分别按 `kind / version` 进入独立 strict branch，Shell command hash 必须对应精确 command bytes，文件桥的逻辑路径、本机来源路径、大小和 SHA-256 也在 trigger 中复验。`prepared_action_id / prepared_action_json / prepared_snapshot_hash / approval_input_hash` 保持 `text`，审批 hash 与冻结快照 hash 必须一致。直接 Store 写入禁用环境变量、SQL 单列篡改、command/hash 漂移、文件桥额外 / 重复字段、路径穿越或把 ASCII JSON / ID / hash 写成 BLOB 都会在 trigger 或 bootstrap main normalizer 边界被拒绝；旧媒体 action 原地回填且损坏行使 bootstrap 整体回滚。workspace / quota / log ledger 幂等补齐，quota ledger 原地增加 unknown occupancy 标志并重建受影响 trigger，不新增 schema 3 / 4

#### Agent Shell macOS 开发预览与剩余门禁

长历史投影还需构造两类边界：保守 `16,384` token fallback 下，最新长 Shell 事实应按当前对话和 envelope 后的真实余量缩成带截断标记的 head + tail，不能整条消失；大窗口下放入数百条长 Shell ToolRun 时，达到约 `48,000 tokens` 事实预算后必须停止读取更旧结果，不能在 Electron main 同步重投影全部历史。超长 prepared command 的历史关联应先有界并明确标记省略，再为同一事实的结果保留预算。

macOS 系统 Zsh 探测成功后，生产 Service Runtime 会动态注册 `shell.run@1`，Orchestrator 把 Provider 快照与 main-owned 本机设置中的权限模式冻结进 Run。自动化已覆盖 main prepare、动态 prepared risk、三权限策略、execution lease、binding resolver、spawn preflight、Process Supervisor、Runtime、日志、执行期配额与退出 settlement；Process Supervisor 测试继续使用 fake child，不以自动化冒充真实用户 Shell 或安装包验收。

当前 macOS 单次执行必须验证：exact command bytes / hash、path-free Provider public identity、冻结 Run snapshot、AI destination、受控环境，以及 PreparationService 在 Quota live lease 下对五个逻辑根运行 25 秒有界 scanner v3；任一 owner、workspace generation / content、cwd realpath、Provider、AI destination、analyzer / policy revision 或批准后的重新 prepare 发生漂移时拒绝。执行前必须建立默认 512 MiB growth reservation 与 workspace live lease，TTL 至少覆盖命令 timeout 加 60 秒；默认每 500 ms 的轻量扫描按 `max(logical size, st_blocks * 512)` 计量，拒绝链接、硬链接、特殊文件、超深、超条目、超单文件和超额度，结束后完整重扫并原子结算 reservation。超限或无法可信计量时取消进程、隔离 workspace 并返回 `quota_exceeded`。应用退出必须等待受管进程、日志 flush、最终扫描和配额 settlement 后再释放 workspace。generic xattr、ACL、file flags 与 path-based root guard 的同用户 TOCTOU 是明确残余风险，`persistentRuleEligible` 必须保持 `false`。Windows content identity 与 Job Object 尚未验收，Provider 发现不能解除 fail-closed。下面是稳定发布前的剩余门禁：

- 已有自动化持续保证 dispose 与尚未进入 mutation queue 的 create / prepare / cleanup 并发时，先关闭新准入并等待已接纳操作完整收口，再关闭 adapter 和 persistence；迟到 adapter 回调被拒绝。重复 dispose 返回同一 Promise，closing 后公开异步方法稳定拒绝、同步 `get()` 返回 `null`
- 当前确定性 Analyzer 使用 `@vscode/tree-sitter-wasm` 的 runtime、Bash grammar 与 PowerShell grammar；静态已知子集必须生成稳定 `analysisIdentity / authorizationIdentity`，动态语法、未知命令或参数、link-producing copy、交互参数、Zsh `=command`、named-home 展开和 Parser / WASM 故障均 fail-closed。Vite 必须把该依赖保留为 Electron main 的外部 CommonJS 包，electron-builder 只打入许可证、包元数据、`wasm/tree-sitter.js` 和三份 WASM；unpacked macOS 包必须能够正常启动，并由打包 Electron runtime 从 ASAR 实际加载两种 grammar、分别解析无错误 Bash / PowerShell fixture。普通 `npm run build` 或源码目录 Vitest 不能替代该检查
- 已落地的 `ask / auto / full-access` 三态 Policy、main-owned 本机设置、模式 UI 与 Run capability identity 继续保持：对 `cat / du / file / head / ls / stat / tail / wc` 等 Analyzer 已支持的宿主绝对路径只读命令，`ask / auto` 都进入确认，`full-access` 直接执行；`auto` 仍只对完整分析且 main 已证明全部路径位于 Run workspace 的普通操作自动放行，分析未完成时三种模式都拒绝，interactive、detached 和 privilege escalation 仍不可执行。模式切换只创建新 Run snapshot，不修改活跃 Run，`auto` 不调用第二个模型

- macOS Zsh、Linux Bash 和 Windows PowerShell 分别覆盖 Unicode、空格路径、多行、管道、重定向、条件、替换、解析失败和非零退出；Provider、cwd、env、timeout 或 workspace generation 在批准后漂移时拒绝旧动作。外部进程在批准后直接改写 cwd 时，spawn 前 rehash / execution generation 必须失效，不能只信任 generation 计数
- 权限规则按带版本的 canonical matcher 绑定 AST token、原子操作、重定向、网络目的地、cwd、Provider、风险分面及 analyzer / policy / env policy revision；`npm test` 不匹配 `npm test && rm ...`，也不能跨另一个项目内容身份复用。动态 head、嵌套解释器、encoded PowerShell、外部路径、未知语法和无法证明 read set 的工作区不能生成 Session / 长期规则，deny 始终优先
- `file.stage` 只接受本 Run 已感知、用户显式选择，或用户在当前请求中明确给出绝对 / `~/` 路径的普通文件；它只服务需要工作副本、修改、转码或生成流程的输入，不作为明确宿主绝对路径只读查看的前置步骤。明确路径显示内联审批且不再弹系统 picker。资料库 fetch 前和原子 commit 前分别重验读取 grant、node revision、content identity / ETag 与 storage binding；本机路径在 prepare 与 execute 分别以 `lstat / realpath / O_NOFOLLOW / fstat` 重验单链接普通文件 identity，撤权或漂移时删除半文件并废止 capability。Shell allow 规则同时绑定 staged source content hash、完整 workspace content identity 与 AI profile / 配置 revision / provider / Base URL identity，切换本地与远端 AI、暂存同名新内容、网络下载或前序命令改写项目后重新 ask
- PATH / HOME / loader / credential 环境不能被模型覆盖；`run-workspace` 的 `HOME / ~` 固定指向 Run 虚拟 home，`host` 的 `HOME / ~` 指向 main 冻结的宿主 home，模型不能自行覆盖或跨上下文复用。API Key、Cookie、token、签名 URL、物理 workspace / log 路径和未清洗输出不进入 SQLite、时间线或 provider 投影
- stdout / stderr 经 carry decoder 后持续 drain；Supervisor 的 `1 MiB` main-only head / tail 诊断采集超限只丢中段，不终止命令。只有再经过 control parser / secret redactor 的安全 frame 才按单调 sequence 进入日志、最多 `160,000` UTF-8 bytes 的安全模型源和 UI tail；诊断采集与安全模型源均同时限制 retained bytes 与 retained object count，使用大量一字节 / 小 chunk 输出验证对象数和处理耗时有界，热路径不依赖数组头部搬移。Shell 规范结果在 Broker 的 `100,000` JSON 字符硬门禁前自适应收口到约 `90,000` JSON 字符；provider 投影最高约 `40,000 tokens`，普通 Tool 约 `1,024 tokens`，`skill.activate` 约 `10,000 tokens` 且禁止截断。renderer 每个 stdout / stderr 摘要最多 `4 KiB`，但非审批 Shell 默认只显示无框单行最低状态和 main public prepared action 中的命令摘要，不展示输出、耗时、退出码或预览截断，也不得从 `call.input` 回退拼命令；审批态仍显示完整确认卡。只有具备 owner-bound 结果的行可以点击，展开区最高约 `156px` 且内部滚动；日志真实过期或存在不可恢复缺口时只在展开区弱提示。事件同时绑定 Session / Run / ToolRun / execution，单 frame / batch / flush 频率 / 未 ack IPC 队列均命中固定上限。慢 renderer 触发 live batch 丢弃后不堵塞进程，跨 chunk UTF-8、秘密、PowerShell 编码、ANSI / OSC、二进制、输出洪泛、重复 batch、sequence gap、`afterSequence` replay、cursor 失效和日志过期均有确定行为。分别验证普通 Tool 截断、Shell 长输出、Shell byte / token 二次投影的真实 `omittedBytes`、Skill 完整激活、Active Context 严格 JSON 语义摘要，以及诊断采集、renderer 摘要与详细日志分页；原始诊断采集不得进入 SQLite、provider 或 renderer，默认单行不能倾倒模型投影或日志第一页。详细日志只剩前缀、tail 只剩远端最新区间时，`availableRanges / nextAvailableSequence / unavailableThrough` 明确标出中间缺口并允许 resolved 水位继续；SQLite ToolRun 只保存安全的有界 provider source、显示摘要、水位、截断与 opaque logRef，配额内的有界全流日志由 main TTL Store 托管
- 停止、超时、注销、窗口销毁和应用退出会按 Tool 专用 settle budget 收口受管进程；单纯页面卸载时纯 main Shell 继续，返回后从规范 ToolRun 和 tail 恢复。Windows 必须验证禁用 breakaway 的 Job 收口，不能以 `taskkill` 失败后的直接子进程 fallback 通过；POSIX daemonize 逃逸按专题记录为残余风险
- `file.stage`、`file.publish` 与 `file.upload` 已作为三个规范 `business` strict Registry Tool 接入 macOS 开发预览：本机 picker 不接受 path；用户明确的本机来源 path 只进入 stage / upload 的 strict input、public action、确认卡和 SQLite 审计，并且不再次弹 picker。一次只处理普通单链接文件；临时文件、SHA-256、同名自动改名、generation、manifest / provenance、共享 reservation 与最终 scanner v3 结算必须一致。Save As 只读取 `output/...`，从 `O_NOFOLLOW` owned handle 复制并在消费前后复验来源身份，取消不写文件，成功结果只返回 basename。确认卡可从 SQLite 恢复且未知 action 只允许取消；底层系统错误、canonical path 和 workspace 物理 path 不得投影
- 资料库 `file.stage`、`file.publish` 与 `file.upload` 通过窗口绑定的一次性 authority 获取节点快照、从根逐段解析的绝对目录、签名 URL 或凭据，严格绑定 owner / library / Session / Run / ToolRun；prepare 不取正文能力，execute 重新授权。目录缺失、重名、文件段、跨库或层级漂移必须失败，不模糊匹配且不自动创建。stage 在下载前后重验节点身份并清理半文件；publish / upload 复用 main-owned 上传事务和 `committed / uncommitted / commit_unknown` 三态。自动化覆盖 authority 重放、错误窗口与身份、stage 成功与来源漂移、publish / upload 三态、Run / 应用关闭等待结算、strict Schema / prepared action / SQLite branch。commit 后只允许正常刷新 / 新 Tool 再感知，不回写终态 ToolRun 或续跑旧 Run；真实资料库验证仍禁止第一个资料库，媒体命令只使用无声 fixture
- Shell 落地仍保持 schema 2：现有 `shell.run@1 / file.stage@1 / file.publish@1 / file.upload@1` strict branch 与 Schema Coordinator barrier 必须保持幂等；未来 Rule Store 仍须加入同一 barrier。Shell ToolRun audit、日志水位和规则索引幂等补齐并重建受影响 trigger。删除 Session 后的 Shell workspace / 日志资源由唯一 Quota Manager 经 Store adapter 删除，并通过 `deleting` ledger 在崩溃后继续回收

### 3.15 QQ 音乐歌词工具

适用改动：

- `features/tool-workspace/ToolWorkspaceQQMusicLyrics.tsx`
- `features/tool-workspace/qqmusic-lyrics.preferences.ts`
- `features/tool-workspace/ToolWorkspaceNav.tsx`
- `shared/qqmusic-lyrics/`
- `electron/ipc/qqMusicLyrics.ts`
- `electron/service/qqMusicLyricsService.ts`
- timed-text QRC parser

至少验证：

- 仅使用非第一个资料库；`Win` 可用时优先使用 `Win`，公司环境保存到 macOS 本机 MinIO。
- macOS 有 QQMusicMac 数据库时显示缓存可用；打开工具自动按最近访问顺序列出本地已有 QRC，切换全部曲库后按歌名/歌手搜索能区分已缓存和未缓存歌曲，刷新后能看到 QQ 音乐刚生成的缓存。
- 真实 `文字(start,duration)` QRC 解析后首词、末词和总行数完整，逐字时间不向后错位；播放、暂停和拖动时间轴时当前行按音乐播放器相同方式从左到右连续扫色，不整词瞬时变色；句间空隙聚焦下一句。舞台使用稳定 cue 滚筒，相邻播放切句时舞台和时间轴分别在自身容器内平滑居中，初次载入、换歌、跨多句 seek 和减少动态效果偏好即时定位；长歌词跟随不带动外层工作区且页面布局不跳动。
- 日间与暗色主题下，刷新、搜索、视图切换、描边保存和播放图标常态均无深色背景并使用弱文本色，悬停后按 AI 服务配置的行内操作样式切换为正文色和清晰的中圆角中性底色，不出现外投影、位移或发虚边缘；必要说明只使用浏览器原生提示。QQ 音乐工具图标在导航展开/折叠、选中/未选中时均保持 `#ec4141` 识别色；歌曲名输入框内部没有音乐装饰图标。进度条没有圆点 thumb 和悬浮时间提示，已播放区域为播放器同类渐变，同时保留点击、拖拽和键盘 seek。
- 歌曲列表分隔线的 `6px` 命中区可以从初始最大宽度拖到最小宽度；常规工作区范围为 `260px～34%`，紧凑工作区为 `220px～40%`，方向键和 `Home / End` 边界正确。拖动期间歌曲列表和全部歌词行不逐帧重渲染，松手只提交一次宽度；歌词播放期间交替拖动目录树、工具导航和歌曲列表仍保持跟手。
- 歌词舞台横向分隔线的 `6px` 命中区可以从初始最大高度 `42%` 向上拖到最小高度 `156px`，方向键和 `Home / End` 边界正确；它与歌曲列表、目录树和工具导航拖拽互不抢事件，松手或取消后不残留纵向拖动光标与文本禁选状态。
- 预览标题栏先显示 QRC 标签，再显示紧邻成组的中圆角文件/列表视图切换和描边保存图标，底部没有常驻保存表单；文件图标打开标题栏以下全区域只读 XML 预览，内容支持语法高亮、自动换行、滚动、选择和复制但不可修改，进入时停止模拟播放，列表图标返回时间轴并保留舞台高度。点击保存后打开紧凑弹窗，文件名可编辑，缺少 `.qrc.xml` 时保存自动补齐，超长中文名按 UTF-8 字节安全截断且保留扩展名；保存目录字段能打开资料库目录选择器并选择嵌套目录，确认后关闭/重开保存弹窗或重开工具仍默认同一路径，且不同资料库互不串用；删除已记忆目录或让节点类型/资料库不匹配后，保存前清除旧偏好并回退到当前目录、当前文件父目录或资料库根目录，未经再次确认不上传。弹窗每次打开都选中后端默认 storage provider，也能只针对本次保存切换 Provider；使用非默认 Provider 保存成功后再次打开必须恢复后端默认值。下拉选项和目录选择器不被工作区边界遮挡；真实文本 staging 路径可通过上传准入校验，上传使用 `auto_rename`，成功后刷新对应目录。
- 歌曲标题为 `13px`，歌手、SongID、范围计数、状态、标题说明、时间戳和播放时间至少为 `12px`，时间轴歌词为 `13px`；目录选择器面包屑、节点名称和行尾操作至少为 `12px`。歌曲结果只显示实际可预览的 `QRC / 无 QRC`，不把尚未接入预览的翻译、音译或普通 LRC 缓存显示成能力标签；在歌曲列表最小/最大宽度、长歌手、毫秒时间戳和紧凑工作区下，搜索框与结果 meta 通过列表自身 container query 重排，不重叠、不裁切关键数字，放大后的行高和时间列仍保持稳定对齐。
- 主流程只读 QQMusicMac 数据库，不落地 plist/加密 QRC，不读取登录态，不调用 sidecar，也不把本机路径交给 Go 后端。

边界路径：

- Windows / Linux 显示不支持；非 Electron renderer 缺少 bridge 时页面不崩溃。
- 曲库数据库缺失、cache 数据库缺失、歌曲没有 QRC、binary plist 损坏、hex 非法和 QRC 解密失败均显示对应错误，不覆盖已保存文件。
- overlay、独立媒体窗口和非主 frame 调用 `electronQQMusicLyrics` IPC 时被拒绝。
- 搜索 `%`、`_`、反斜杠和超长文本不扩大匹配范围；SongID 非正整数被拒绝。
- 全部曲库超过 2050 首时继续加载能进入下一页，不重复第 2001～2050 首；offset 超过 `100000` 时明确返回 `INVALID_REQUEST`。列表搜索不读取缓存 BLOB，预览仍能读取并解密目标 QRC。
- 连续提交两个搜索或快速点击两首缓存歌曲时，只允许后一次响应更新页面；先完成的请求不得提前清除后一次请求的 loading。
- 历史 `(start,duration)文字` QRC 与当前 `文字(start,duration)` QRC 均保持正确逐字时间，末段不越过所在行结束时间。

## Agent 图片与文本附件

- 文档工具另见 [文件处理调研与实现](agent-document-processing.md)：检查 PDF 页数、分页读取和 DOCX 中文正文；无文字页通过 attachment.view 渲染并验证模型收到图像。覆盖坏 ZIP、页码越界、取消、超时及跨会话读取拒绝。Node/Electron、macOS arm64 目录包内 worker 和真实 gpt-5.5 inspect/read/view 联调已通过；Windows 仍未实测。

- 在非第一个资料库选择图片、文本，再 Cmd+V 粘贴第二张图片，确认上方附件顺序固定，文字输入、模型设置和权限控件正常。
- 让模型描述两张图并用 attachment.read 核对文本中不能从文件名推断的内容；刷新客户端后附件及回答恢复，后续请求仍能加载原副本。
- 附件准备中禁止发送；移除、切库、发送失败、正常退出以及会话删除按 [附件契约](built-in-agent-attachments.md) 清理或保留。跨账号、跨库和跨会话读取必须失败。
- 超大文件、不支持的文档格式和已知非视觉模型不能静默漏发附件；草稿失败可移除后重试，普通文本粘贴不被截获。
- 2026-09-10 macOS 暗色实测多图加文本、Cmd+V、真实 gpt-5.5 视觉及文本工具读取、刷新恢复通过；Windows 剪贴板和亮色桌面仍未实测。

## 资料库标签（2026-10-02）

当前自动验证：`npm run lint`、`npm test`（455 个文件通过、3 个文件跳过；3505 项通过、7 项跳过）及 `npm run build` 通过。构建发现的测试类型错误修正后，新增管理页、API、分页和选择器的 20 项测试与定向 ESLint 再次通过。Agent 与 ASMR 的 21 项专项测试覆盖服务端游标、范围校验、增量保存、部分成功与提交结果不明。

后端全量 Go 测试与 CLI/server 构建通过；真实 PostgreSQL 的 9 组事务验证覆盖库权限、同名冲突、分页、partial 更新、delta、旧 `viewMeta` 不覆盖关系、失效标签回显及 dry-run。最终复核使用连接内 TEMP 表与合成数据，Win 库仅用于读取真实权限，事务结束后独立连接确认公共表无测试夹具。迁移与规模验证见[库标签契约](../../omniflow-go/docs/architecture/library-tags.md)。

本轮实际界面验收被 macOS 锁屏阻断，未声称亮暗主题或真实 ASMR 交互通过。解锁后在非首个 Win 资料库补验：

- 设置中的标签管理能够选择当前库，创建、搜索、编辑中文分类及启停；独立设置页不默认选择第一个资料库。
- 快速搜索、翻页及切库清除旧结果，旧响应不覆盖当前草稿；空列表与请求失败分别显示。
- ASMR 选择器按页搜索且保留跨页选择，已选停用/删除标签仍能移除；仅改标签不会覆盖封面或编号。
- 亮暗主题下检查长名称、取色器、紧凑弹框和窄窗口弹层，保存中控件锁定；未知提交不直接重试。

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

## 本地插件管理（D1）

管理页面、安装预检/过期拒绝、启用与读取批准分离、真实 CSV 打开、更新、回滚、恢复模式、停用后内置回退及卸载保留说明已在 macOS 验证。仅使用第三个 win 资料库的既有合成 CSV；测试本地包已从实际 profile 移除，设置/阅读快照保留。恶意 ZIP、死循环、内存限额、本机文件选择拦截、70 次 session 复用和持久化恢复在临时宿主自动验收。详见 [D1](plugin-system-d1-management.md)。

## 独立插件开发交付（D2）

JSON 树、工程生成器、仓库外离线构建/ZIP、独立更新及同格式 CSV 候选已验证，宿主未添加专属分支。实际验收仅用第三个 win 的合成 JSON（759 节点）及既有 CSV，覆盖精确数字、节点详情、展开/分页恢复与默认选择；测试插件已移除，用户数据保留。结果和平台限制见 [D2](plugin-system-d2-external-development.md)。

## 手动插件命令（M1）

后续修改命令入口或执行链时，至少覆盖：文件菜单捕获选择→宿主参数表单→准备→完整预览→拒绝或批准→结果与目录同步。手动能力与 Agent 批准独立，菜单打开后停用/升级要拒绝旧入口；切工具后提交仍广播文件变更，离库/注销取消，未知结果保留原 operation 且不自动重试。macOS Win/local-minio JSON 样板的真实拒绝/保存已通过，故障/重启和另两类手动写入的范围见 [M1](plugin-system-m1-manual-commands.md)。

## 插件独立工具工作区（M2）

后续修改工作区贡献或隔离页面时，至少覆盖：导航动态贡献→宿主选择源文件并显式打开→插件业务参数与预览→宿主目标冻结→M1 准备和批准→目录刷新及结果打开。目录选择浮层、准备和批准期间须隐藏原生页面；拒绝后可返回仍存活的页面，切工具/离库/注销须释放原生实例与句柄，迟到打开不得留下孤立视图。停用、撤权和包更新须拒绝旧实例，Agent Tool 未批准不影响获准的手动能力。

macOS Win/local-minio 的 JSON 样板已验证字段选择、空选择拒绝、目录浮层隐藏/恢复、提案拒绝后保留选择、批准创建 49 字节新文件、目录自动刷新及切回内置预览读取结果。自动化覆盖权限、目标冻结、取消与迟到结果；亮色/极窄布局、执行中真机撤权和故障/重启查询未手验，完整范围见 [M2](plugin-system-m2-tool-workspaces.md)。
