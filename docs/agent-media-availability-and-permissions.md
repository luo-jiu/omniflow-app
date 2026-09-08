# Agent 媒体、权限与过程展示

更新时间：2026-09-07

## 1. 操作偏好

默认优先在当前资料库内完成任务。这是提示词中的选择偏好，不是禁止本机操作的运行时规则；内部工具不适合、能力缺失或本机方案更合理时，Agent 可以选择已有 Shell 和文件桥，并说明选择原因。原有 Schema、owner、文件身份、Shell Policy 和执行凭据校验继续生效。

`media-extract-audio` Skill 激活后在同一 Run 的下一次 Provider 调用中继续，不要求用户再发“开始”。Skill 声明 `shell.run / file.stage / file.publish / file.upload` 为可选备选工具；它们由宿主初始化延迟注册。内置 Skill 注册器只对这四个已知名字允许延迟声明，其他未知工具仍拒绝。Run 快照中缺失的可选工具使 Skill 降级而非使整个 Run 初始化失败；可见工具始终取冻结 Tool 快照与 allowlist 的交集，不能凭 Skill 声明执行未注册工具。

## 2. 三类事实

- **元数据存在**：Agent 感知保留文件的 `storage.providerAlias / providerLabel / availability / observedAt`。仅投影存储身份和状态，不传递完整 Provider 配置、Endpoint、Key 或签名链接。单次感知按 alias 合并检查，复用已有存储健康服务。该状态是最近观察到的存储节点状态，不是文件内容已读取的证明。
- **源文件可读**：媒体 prepare 明确区分源存储不可达和无法取得配置，不再用目标存储健康掩盖源文件故障。执行期 main 对已签发的 loopback claim 做有超时的 `GET Range: bytes=0-0` 检查并取消响应体；不接受任意远端 URL 作为探测入口。源不可读时不启动媒体处理，更换输出位置不能解决来源问题。
- **目标可以写入**：源状态通过后，依次使用健康的源 Provider、格式路由、默认 Provider 和其他已知健康 Provider。输出默认是当前资料库，找不到可写目标时明确返回 `destination_unavailable`，不静默改成本机。Agent 可用 `media.extractAudio.destination=local` 选择本机，也可提供匹配格式的 `fileName`；本机是可选路径而非固定禁区。

`media.extractAudio` 现在同时要求 `media.ffmpeg` 和 `media.ffprobe` 能力。main 在创建输出前独立检查真实媒体与音轨，不依赖模型是否先调用了 `media.inspect`。`hasAudio` 从完整 ffprobe 流列表计算，不能因展示只保留前 32 个媒体流而误判没有音轨。执行前再次检查源 claim，处理期间失败则释放临时产物。

错误使用固定分类：`source_unreachable / source_not_found / source_access_denied / source_unknown / no_audio / invalid_media / processing_failed / destination_unavailable`。HTTP 状态和有限进程诊断模式可以映射到分类，但原始 stderr、内部路径、访问链接与凭据不返回模型或 UI；未知进程故障保留通用分类与退出码，不猜测原因。Renderer 对已知分类移除 Electron IPC 包装文案，结果带 `failureCode`。

共享下载代理保留原有失败 HTTP 502 行为，并仅在源站错误响应时附加由代理生成的 `X-OmniFlow-Source-Status` 数值头；Agent 在已签发的 loopback claim 上读取该头，区分源站 401 / 403 / 404 / 416。该字段不包含上游响应体、路径或凭据，不把源站任意同名头透传给调用方。

## 3. 完全访问

资料库目标现在支持 `directoryPath` / `parentId`，可直接保存到非当前 UI 目录。准备和执行分别校验目标身份与规范路径，详情见 [Agent 资料库目录发现](agent-library-discovery.md)。目录查询只读元数据，不依赖存储在线；内容处理仍必须检查实际源可读性。

现有 `ask / auto / full-access` 设置继续在 Run 启动时冻结，沿用当前存储和 IPC 名称，不新增另一份权限 owner。

`full-access` 下，已通过原有校验的非破坏性内置操作可以自动授权：

- `directory.create`
- `media.extractAudio`，但不包括 `replace`
- `file.stage / file.publish / file.upload`，沿用只允许失败或重命名的冲突策略

权限调整发生在 prepared action 封装和签发前；运行记录真实保存 `permissionBehavior=allow`，不伪造用户 approval。prepare、目标验证、不可变绑定、一次性能力、提交状态和审计不跳过。`ask / auto` 的内置写入确认行为保持不变。明确 deny、未知 Tool、破坏性风险、媒体覆盖和 `memory.propose` 不因本规则自动放行；Shell 继续使用自己的 Policy Engine。

Save As 的位置选择、覆盖提示和缺少必要信息的交互不是重复授权，仍可能出现。界面切换权限只影响新 Run，不反向放宽在途动作。

## 4. 无框展示

文件读取、媒体检查、Skill 加载和一般工具过程使用无边框紧凑行；读取结果显示“已读取 + 文件名”，文件名只通过既有 `tree.revealNode` 中心 action 定位，不生成任意链接。已生成的目录或音频结果同样显示文件名与受控定位动作。

成功详情默认收起，用户可展开；失败、取消、中断和正在等待的交互保持可见。审批与交互使用无框内联表单，仍只有一个可编辑实例，保留 busy、防重入、稳定 key 和恢复语义。工具组件历史文件名中的 `Card` 不再表示 UI 带有卡片外观。

本机目标可以切回资料库目录选择；初始目标不代表其他目标不可用。没有合法目录 ID 时不能批准，最终可写性由 main 重新 prepare 验证，不由 UI 猜测。

## 5. 验证

覆盖源离线且另一个目标在线、路由与默认目标均不可用但其他节点在线、元数据读取失败、Range 请求取消、403 / 404 / 502、无音轨、超过 32 个媒体流、错误脱敏，以及 `ask / full-access` 的提取、上传、身份拒绝和防重放链路。

UI 使用隔离模拟数据检查紧凑行、展开详情、目录定位、无框审批、目标切换、亮暗主题和窄宽窗口。真实媒体播放、MinIO 写入、原生保存对话框和真实 Provider 决策仍需独立验收；测试不得使用第一个资料库。

2026-09-07 验证结果：lint 与完整构建通过，1,911 项测试通过、7 项跳过。Playwright 在 `1120 x 720` 亮色与 `1440 x 900` 暗色下检查六个工具 / 审批表面均无外框、读取行默认收起、目录定位 action、详情展开 / 收起、资料库 / 本机切换及批准回调；无页面异常、横向溢出或真实外部请求。本轮未访问真实资料库、播放媒体或使用真实模型。
