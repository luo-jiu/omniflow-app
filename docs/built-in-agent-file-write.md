# Agent 直接保存资料库文本

普通文本、Markdown、配置和源码默认使用 `file.write`，一次 Tool 调用完成保存；需要程序生成二进制、转换或复杂批处理时仍使用 Shell 和发布。明确本机目标时使用现有宿主 Shell，不限制 Agent 必须留在资料库。

## 工具契约

- `scope` 默认且仅支持 `library`；`path` 为当前资料库绝对文件路径，父目录必须存在。
- `content` 为完整 UTF-8 正文，最多 32000 字符，不含 `file.read` 的展示行号。文件名最多 240 字节，不允许首尾空白，避免暂存过程悄悄改名。
- 不传 `revision` 时仅新建；同名冲突失败，不自动改名或覆盖。
- 修改先读取正文，将 SHA-256 `revision` 和完整新正文传回。renderer 核对现有字节，再把节点详情的私有 `storageKey` 作为条件发送给独立条件保存端点。旧后端 404 不回退无条件更新。
- 新建和条件替换都属于普通 write；full-access 自动允许，其余模式沿用当前确认策略。版本校验仍不可跳过。

## 所有权与回执

复用 Tool Registry、Permission Gate、renderer Tool Broker 和权威 committed 回执。renderer 在异步准备后检查账号与取消状态。新建内部复用文本 staging 和上传会话，finally 清理暂存；模型无须管理 Run 工作副本。修改由后端事务锁和条件比较防止并发覆盖。

只有有效回执才能返回 `writeCommitState=committed`，模型结果包含路径、节点、父目录、新 revision 和字节数，不包含存储 key。上传初始化、租约、会话和 PUT 阶段失败属于 uncommitted；只有上传 complete 的不确定错误、无效提交回执或条件 PUT 的网络错误才属于 commit_unknown。

准备、读旧文件和上传阶段可以立即取消。renderer 在条件 PUT 前，或上传完成并即将调用 complete 前，通过现有 execution progress IPC 发送 `phase=committing`，等待 main 验证 owner、库、Run、execution 及 file.write 工具身份后再提交。只有这个阶段启用最多 30 秒的取消后回执等待；已确认未提交的结果也能提前结束等待。停止期间返回的 committed 结果优先于后续重复完成消息。

`committedAgentFileParent` 消费成功的 file.write 结果，复用现有目录树刷新所有者；工具行显示“已保存 文件名”。不新增目录树状态源。

收到有效保存回执后发送带账号、后端、资料库、节点身份的文件变更通知。FileViewerProvider 只刷新匹配的现存 tab，不激活或重建已关闭 tab；换账号或晚到的旧请求不能更新当前预览。文本 viewer 刷新前持久化内存草稿，复用原有冲突恢复交互。编辑器自身保存也校验读取时的正文 SHA-256，并使用条件 PUT 防止旧缓冲区覆盖新内容。

## 验证

自动测试覆盖新建、条件替换、版本变化、409、取消、账号范围、提交未知、回执投递失败和权限分级。真实验收必须使用非第一个资料库；检查保存后目录立即出现、重读新内容、旧 revision 被拒绝以及停止后不继续准备写入。
