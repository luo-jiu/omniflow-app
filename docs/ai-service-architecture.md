# AI 服务架构

更新时间：2026-08-20
适用范围：`src/features/ai-services/`、`electron/service/aiServiceStore*`、`electron/ipc/aiService.ts` 及其 preload bridge。

## 1. 概述

`AI 服务配置` 用于管理当前设备上的 AI provider 连接档案，并为 AI 工具提供受控的模型列表与补全请求入口。它不负责模型选择、提示词、翻译语言或具体 AI 任务编排。

当前边界：

- 配置仅在本机生效，不写入后端，也不跨设备同步。
- Electron main 是档案和密文的唯一 owner。
- renderer 常态只持有可展示的只读投影；进入已有档案的编辑页后，可在当前编辑草稿中短暂持有该档案的已解密 API Key。
- `AI 字幕翻译` 使用当前启用档案读取模型；批量任务开始时由 main 创建运行会话，冻结当时的 provider、Base URL 和已解密 Key，后续请求只引用会话 ID，避免批处理中途切换或编辑服务导致连接漂移。

## 2. 本地状态

主进程把配置写入：

```text
Electron userData/ai-services.json
```

文件格式版本为 `2`，保存：

- `activeProfileId`
- `profiles[].id`
- `profiles[].name`
- `profiles[].baseUrl`
- `profiles[].providerType`
- `profiles[].encryptedApiKey`（可选）
- `profiles[].createdAt / updatedAt`

加载时会丢弃缺少稳定 ID、名称、Base URL 或合法 provider type 的条目；active ID 无效时回退到第一条有效配置。

当前 provider type 为 `deepseek / openai / claude / local`，唯一类型清单位于 `src/shared/ai-service-provider-types.ts` 的 `AI_SERVICE_PROVIDER_TYPES`；renderer 业务类型与图标定义、main 持久化校验均从该清单派生。加载旧版文件时，`ollama` 会迁移为 `local`，`openai-compatible` 会迁移为 `openai`；档案、active ID 和已加密 API Key 均保留。

## 3. 密钥边界

API Key 使用 Electron `safeStorage.encryptString()` 加密后才写盘：

- macOS 由系统 Keychain 支撑。
- Windows 由系统 DPAPI 支撑。
- 系统加密能力不可用时，允许保存不含 Key 的本地服务，但拒绝保存新 Key。

renderer 的列表投影只有 `hasApiKey: boolean`。主进程不会通过列表、保存、复制、启用或删除响应返回 `encryptedApiKey`，也不会在这些常规响应中返回已保存 Key 的明文。进入已有配置的编辑页时，通过独立的 `revealApiKey(id)` 立即解密指定档案，并以真实 password value 生成与 Key 长度一致的掩码；眼睛只切换显示和隐藏。明文仅进入当前编辑草稿，取消或保存后立即丢弃，不写入 `localStorage`、用户偏好或日志。

所有 `electronAIService` IPC 都只接受当前主窗口 main frame。overlay、独立视频窗口和其他 WebContents 即使复用同一 preload，也会在 main 侧被拒绝，不能列出配置、读取 Key 或发起模型请求。renderer 快速关闭并切换编辑对象时，以单调请求序号废弃旧 Key 响应；旧请求不得清除新请求的 loading，也不得覆盖新草稿。

真正发起 AI 请求时，仍由 main 进程读取目标 profile、解密 Key 并注入请求，AI 任务不接收 Key。编辑页是唯一允许读取明文 Key 的 renderer 路径：必须由进入单个已有档案的编辑页触发、必须指定已存在的 profile ID、不得批量读取。除该编辑动作外，不得扩散新的明文 Key IPC，也不得把 Key 移入 `localStorage`、用户偏好表或日志。

字幕翻译旧配置 `subtitle-translation-preferences:v1` 曾包含 Base URL 和明文 Key。当前读取时只迁移模型、上下文和提示词到 `v2`，并立即删除旧 key。

## 4. IPC 契约

preload 通过 `window.electronAIService` 暴露：

- `list()` -> `ai-service:list`
- `revealApiKey(id)` -> `ai-service:reveal-api-key`
- `save(input)` -> `ai-service:save`
- `setActive(id)` -> `ai-service:set-active`
- `reorder(orderedIds)` -> `ai-service:reorder`
- `duplicate(id)` -> `ai-service:duplicate`
- `delete(id)` -> `ai-service:delete`
- `listModels()` -> `ai-service:list-models`
- `beginRun(profileId)` -> `ai-service:run:begin`
- `endRun(runSessionId)` -> `ai-service:run:end`
- `complete(input)` -> `ai-service:complete`

所有修改操作都返回完整的安全投影 `AIServiceSnapshot`，renderer 用返回值替换当前快照，不自行拼补 main 状态。`revealApiKey` 是唯一例外，它只在进入单个已有档案的编辑页时返回指定档案的明文 Key，不改变主进程状态。

`listModels / complete` 由 `electron/service/aiServiceClient.ts` 执行，API Key 不经过 preload。单句 `complete` 必须携带已在 renderer 安全投影中可见的 profile ID，主进程重新查找真实档案和密文。批量任务先调用 `beginRun`，main 在内存 registry 中保存不可变连接快照并返回仅属于当前 renderer 的随机会话 ID；后续 `complete` 同时校验会话 ID、profile ID 和 WebContents owner。每个会话登记自己的在途请求；正常结束会释放会话，停止任务或 owner renderer 销毁时会先通过 `AbortController` 取消仍在执行的 `net.fetch`，再释放配置锁。

运行会话只存在于 main 内存，不写入 `ai-services.json`。会话有效期间允许切换 active profile 和调整列表顺序，但禁止编辑或删除其来源档案；主进程返回“配置正在被任务使用”，而不是让后续字幕静默换连接或逐行失败。复制档案不会修改来源档案，因此不受锁限制。

## 5. Provider 协议适配

模型列表的路径约定统一为当前 `Base URL + /models`，但鉴权头和补全协议按 provider 区分：

- `openai / deepseek / local`
  - `Authorization: Bearer <API Key>`（Key 为空时省略）
  - `GET /models`
  - `POST /chat/completions`
  - 显式推理强度使用 `reasoning_effort: low | medium | high`
- `claude`
  - `x-api-key` 与 `anthropic-version: 2023-06-01`
  - `GET /models`
  - `POST /messages`
  - 显式推理强度使用 `output_config.effort: low | medium | high`

因此 UI 可以保留统一的“读取模型”动作，但不能假设所有厂商只有 URL 前缀不同。新增 provider 时必须在主进程适配请求头、请求体和响应解析，不在业务工具里增加分支。

推理强度由具体 AI 工具选择，不属于 provider 档案。`auto` 表示省略推理字段；字幕工具同时不提供固定 `temperature`，让模型或服务端采用默认行为。显式选择 `low / medium / high` 时由主进程按上述协议映射，并忽略可能同时提供的 `temperature`。这个字段只表达请求偏好，模型是否支持仍以 provider 响应为准。

## 6. UI 与任务边界

工具区左侧使用稳定 ID `ai-services`。页面位于 `src/features/ai-services/AIServiceWorkspace.tsx`，负责：

- 展示 active profile 和服务摘要。
- 管理新增、编辑的工作区内联页面；进入已有档案编辑页时立即读取 Key 并显示真实长度的掩码，点击眼睛后可查看和修改，保存修改值会覆盖密文，清空后保存会删除密文；取消或保存时直接丢弃包含明文 Key 的 renderer 草稿并回到档案列表。
- 触发启用、复制和删除命令。
- 展示主进程错误。

新增配置默认使用 `Local` 和 `http://localhost:11434/v1`。切换 provider 时，只有 Base URL 为空或仍等于上一个 provider 的默认值才会同步替换；用户自定义 URL 不会被覆盖。服务商选择器当前展示 DeepSeek、OpenAI、Claude 和 Local 的图标与名称。

档案列表使用实际 provider 图标作为左侧标识，摘要只显示 Base URL，不重复显示 provider 名称或 Key 保存状态。编辑、复制、删除操作默认隐藏，未启用档案的“启用”也默认隐藏，行悬停或键盘焦点进入时显示；操作说明使用按钮原生 `title`，不叠加额外 Tooltip。列表占满工作区可用宽度。

列表排序复用 `dnd-kit`，以左侧 provider 图标作为拖拽入口，同时支持 Pointer 和 Keyboard Sensor。renderer 在拖拽结束后提交完整 ID 排列，main 校验它必须是现有档案 ID 的完整无重复排列，再按该顺序写回同一个 `ai-services.json`；排序不改变 active profile、Key 密文或其他档案字段。

它不直接访问文件系统、`safeStorage` 或原始 IPC channel；所有调用先经过 `ai-service.api.ts`。

`AI 字幕翻译` 只保存模型、推理强度、上下文窗口和预设提示词。Base URL、API Key 和 provider 类型均来自 AI 服务档案，不在字幕配置中重复维护。

## 7. 验证

自动化至少覆盖：

- 非法名称和 URL 被拒绝。
- active profile 失效后的确定性回退。
- 旧 `ollama / openai-compatible` provider 的无损迁移。
- 完整排序会保留 active profile 与密文，缺失、重复或陌生 ID 会被拒绝。
- 运行会话冻结连接快照并绑定 profile 与 renderer owner；会话结束或 renderer 销毁后释放，停止和 owner 销毁会取消在途请求，存在期间编辑和删除来源档案会被拒绝。
- 未触碰 Key 输入框时保存会保留原有密文；显示后修改会覆盖，清空后保存会删除。
- 复制和删除 active profile 的状态变化。
- renderer 列表和修改响应不包含密文或明文；明文只允许在进入单个已有档案编辑页时由 `revealApiKey(id)` 单次返回。
- overlay、独立视频窗口和非主 frame 调用 AI IPC 时被拒绝；快速切换编辑对象时旧 Key 响应不覆盖新草稿或 loading。
- OpenAI-compatible 与 Claude 请求分别使用正确的路径、鉴权头和响应解析。
- `auto` 不发送推理字段；显式强度按 provider 使用正确字段，且不与 `temperature` 同时发送。

手工至少验证：

- 无配置空态与新增第一条。
- 进入编辑页后显示与真实 Key 长度一致的掩码；点击眼睛可查看，修改后保存会覆盖，清空后保存会删除，未触碰则保留。
- 复制、切换启用、删除当前配置。
- 重启应用后配置和 active profile 恢复。
- 亮色和暗色主题下列表、弹框与操作按钮可见。
- macOS 与 Windows 各保存并查看一次带 Key 的配置；关闭编辑页后再次进入必须恢复为掩码状态。
- 使用当前启用服务读取模型，并完成一次单句翻译。
- 分别以“自动”和服务支持的显式推理强度完成一次单句翻译；不支持时能看到 provider 原始错误并可切回“自动”。
- 切换启用服务后重新进入字幕工具，标题栏服务名称和模型列表来源同步变化。

## 8. 维护规则

出现以下变化时必须更新本文：

- 新增 provider 协议或持久化字段。
- 修改 API Key 的加密、解密或可见边界。
- AI 工具开始消费 active profile。
- 配置改为跨设备同步。
- 新增模型读取、连通性测试或统一 AI 请求网关。
