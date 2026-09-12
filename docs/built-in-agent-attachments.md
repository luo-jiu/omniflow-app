# Agent 图片与文本附件

## 当前范围

图片预览遮罩采用70%黑色压暗与10px backdrop blur，只虚化背后的界面，图片和操作控件保持清晰；不对预览容器使用 filter:blur，遮罩点击关闭和缩放行为不变。

输入框上方按加入顺序显示图片缩略图和文件名称，支持粘贴图片、选择多个文件、拖入文件及逐项移除。附件准备中或失败时不能发送；纯文本粘贴仍交给 textarea。允许只发送附件。PNG/JPEG/WebP 和 UTF-8 文本可直接读取；PDF/DOCX/XLSX/PPTX 通过文档工具处理，其他二进制保留副本但明确报告没有读取能力。详见 [文档处理调研与实现](agent-document-processing.md)。

Composer 附件区上/左/右留 10px，与下方文字区间隔 10px，单行排列且不换行；图片框 82×72px，仅显示缩略图（名称保留在 tooltip/alt），其他文件为 164×72px，左侧文件图标、右侧单行文件名，超长省略。文件卡给移除按钮留独立空间；准备中保留占位，失败原因仍可见。超出输入框宽度时在附件行下方、textarea 上方横向滚动，复用 workspaceScrollbarStyles。历史附件复用同一图像/文件展示结构但不显示移除按钮。草稿 previewKind 只预留图片布局，不作为文件格式或执行权限事实，导入完成以 main 返回的 kind 为准。

## 所有权与持久化

点击已准备好的图片使用 Semi ImagePreview 打开遮罩预览，支持缩放、Esc/遮罩/关闭按钮退出并恢复焦点。先展示缩略图，再通过 `agent:attachment:preview` 读取主进程保存的归一化 PNG（最长边 2048px）；失败明确提示仅有缩略图。该 IPC 仅允许主窗口调用，验证 owner/library/id；已提交图片还必须提供匹配的 sessionId，未提交草稿无会话绑定时才允许不带 sessionId。关闭或切换 scope 后迟到结果不更新 UI，不向 renderer 返回宿主路径，也不触发模型请求。

当前布局：附件横向间距10px，上/左各10px；附件区下方文字区顶部padding为10px，不重复叠加旧的18px输入padding。文字区域（含42px底栏及2px外框）初始120px、最大320px，独立于附件区计高，正文超限内部滚动。移除按钮18px、X图形10px，距上/右各2px，padding清零并居中。输入placeholder为“从这里开始...”。

- renderer 的附件草稿由 useAgentAttachments 管理；每个异步导入先占据固定位置，完成顺序不改变展示顺序。移除、切库或卸载后晚到的导入结果会清理，不写回新上下文。发送失败的正文和附件由 useAgentDraftRecovery 作为完整草稿排队，只有当前输入为空且没有准备/执行任务时恢复；用户期间输入的新正文或附件保持独立，不与失败消息混合。新建/切换会话及卸载时清理未恢复队列。
- 主进程经 requireMainWindow 限定 attachment import/discard IPC；仅接受有大小上限的字节，不接受任意宿主路径。主进程重新检测格式、校验 UTF-8，并生成 opaque ID。原文件移动不会改变已附加副本。
- 每个附件绑定 backend/account/library；提交时从主进程解析 ID，renderer 不能伪造附件 metadata。读取正文及生成视觉请求还需校验 session 绑定。
- agent_runs.attachments_json 是用户轮次的规范附件记录，通过 run_id 投影到 AgentMessage；迁移仅补列，不清空原会话。缩略图和描述持久化，原始图片正文不进入会话 JSON。
- 绑定返回本次新增引用的回执。Run 尚未创建而启动取消/失败时仅撤销这些新增引用，保留字节用于重试，之后可按草稿正常移除；批量绑定中途失败也回滚已完成部分。已有会话引用不撤销。若 createRun 返回失败但数据库中已有该 Run，则保留绑定；数据库无法确认提交结果时也不冒险解绑。
- 原始字节保存在 userData/agent-attachments；metadata 通过临时文件 rename 写入。未发送副本在移除、卸载或正常退出时清理，过期草稿和崩溃孤儿在后续导入时回收；会话删除后释放没有其他会话引用的附件。

## 模型与工具

图片在每次请求前从 main 管理的副本读取，OpenAI-compatible 使用 image_url 内容块，Claude 使用 image/base64 内容块。只在真实请求里生成 Base64，不让上下文摘要、消息截断或日志把编码串当文本处理。附件清单与视觉内容的顺序一致，模型的附件指令保持用户资料权限，不升级为系统规则。

文本文件不自动全文注入。attachment.read 接受 id、offset、column、limit、revision，PDF/PPTX 另外支持 page，XLSX 支持 sheet/range，使用 Run 内只读工具预算。attachment.inspect 检查格式、页数、工作表及支持操作；attachment.query 提供 XLSX 筛选和数字统计；attachment.view 返回原图片或 PDF/PPTX 页面视觉结果（PPTX 需要本机 LibreOffice）。公式只读取缓存值，不重新计算；缺失缓存明确标记。图片不是可按行读取的文本。

保留图片的历史轮次重建请求时重新加载同一副本；文本摘要只保留附件清单和已有对话结论，不声称看到未传入摘要请求的图片像素。明确标注不支持视觉的模型在发送前拒绝图片，不静默删除。未知兼容模型由真实 Provider 接口确定能力。

## 边界与验证

每条消息最多 12 个附件、总计 32 MiB，单文件最多 8 MiB。图片最长边归一到 2048px，缩略图最长边 128px，拒绝超过 4000 万像素的图片。存储总配额 512 MiB（含 metadata）、最多 4096 个附件，未绑定草稿 TTL 24 小时；已提交附件随会话引用保留。图片预算当前按每张 4096 token 估计，不冒充实际计量，沿用服务端 usage 校正。

回归覆盖异步顺序、失败恢复、切库和移除后的清理、跨 owner/library/session 拒绝、SQLite 重开恢复、分页读取、过期草稿回收、OpenAI/Claude 实际图片内容块及已知非视觉模型拒绝。桌面验收必须选择非第一个资料库，验证多图片加文本、Cmd+V、图片顺序、attachment.read、发送失败保留及会话恢复。

2026-09-10 在 win 资料库使用现有 gpt-5.5 连接实测：选择图片、附加文本，再从系统预览 Cmd+C/Cmd+V 粘贴第二张图片，顺序和缩略图正确；模型识别两张图的不同颜色及几何形状，并通过 attachment.read 返回文本中的测试编号和数量；刷新客户端后会话的三个附件与回答完整恢复。
