# AI 服务架构

更新时间：2026-10-23
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
- `listModels({ forceRefresh?: boolean }?)` -> `ai-service:list-models`
- `getModelCapabilities(model)` -> `ai-service:model-capabilities`：返回精确连接版本与模型的只读 Fast 请求能力，不发网络请求。
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
  - 显式推理强度使用 `reasoning_effort`；OpenAI 精确命中内置目录时按型号允许 `low | medium | high | xhigh | max`，其他连接保留 `low | medium | high`
- `claude`
  - `x-api-key` 与 `anthropic-version: 2023-06-01`
  - `GET /models`
  - `POST /messages`
  - 显式推理强度使用 `output_config.effort: low | medium | high`

因此 UI 可以保留统一的“读取模型”动作，但不能假设所有厂商只有 URL 前缀不同。新增 provider 时必须在主进程适配请求头、请求体和响应解析，不在业务工具里增加分支。

模型菜单与 Agent 共用 main 的 `aiServiceModelDiscoveryCache` 成功发现快照：按 provider、Base URL 和凭据 SHA256 隔离，最多 32 个连接、5 分钟新鲜度，只保留 ID 与经过白名单校验的模型元数据。模型列表成功读取后发布到这里，Agent 优先复用；AI 服务层不依赖 Agent 执行模块。普通列表请求优先返回五分钟内的缓存并合并同连接在途请求；过期后重新读取，网络请求限时十秒。显式 `forceRefresh: true` 绕过缓存、启动新请求并报告真实失败，失败或畸形响应不清空已有成功结果；合法空目录会清空旧身份，请求序号防止旧响应覆盖较新成功。Agent 独立发现的超时、失败冷却与静默回退由自己的 wrapper 管理，不扩散到普通 AI 工具。

随包发布的 `src/shared/ai-model-catalog.json` 固定 Codex SHA，同时保存窗口和单 Agent 推理档位。档位仅要求 OpenAI 服务商与精确模型 ID 命中，可同步计算，打开推理菜单不触发网络请求；未命中或其他服务商保留自动/低/中/高，切换后不支持的偏好归自动。Ultra 与子代理能力不进入目录。窗口采用更严格的身份门槛：必须当前服务类型为 OpenAI、该连接发现列表确实包含模型 ID，并精确命中静态表，才采用其默认窗口；不会把静态表全部变成账号的可选模型。最大可配置窗口不自动生效，当前服务档案仍没有用户可编辑的模型窗口字段，详见[模型预算](agent-model-context-and-reliability.md)。

推理强度由具体 AI 工具选择，不属于 provider 档案。`auto` 表示省略推理字段；字幕工具同时不提供固定 `temperature`，让模型或服务端采用默认行为。显式选择当前型号支持的档位时由主进程按上述协议映射，并忽略可能同时提供的 `temperature`。这个字段只表达请求偏好，模型是否支持仍以 provider 响应为准。

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

`AI 字幕翻译` 只保存模型、推理强度、Fast 偏好、上下文窗口和预设提示词。Base URL、API Key 和 provider 类型均来自 AI 服务档案，不在字幕配置中重复维护。

### 6.1 模型与推理选择器（2026-10-23）

Agent 与字幕共用 `AIModelSettingsControl`：一个 256px 宽、默认 96px 高的浮层，顶部档位与模型名、右上重置，下方离散滑杆；浮层与底部触发按钮中轴对齐，仅在 overlay / viewport 交集边缘按 12px 安全边距夹紧，窄视口相应收缩。点击模型名在同一浮层显示模型列表，选择后回到滑杆。重置只将推理强度归自动，保留模型。字幕额外的“上下文窗口”仍是前后字幕条数 0～10，不是 token 预算。

`ReasoningEffortSlider` 只持有本次手势预览；拖动松手才调用原偏好 owner，pointercancel、丢失捕获、窗口失焦、工作区隐藏及 Escape 丢弃预览。圆球位置与填充宽度使用相同的 160ms 缓出过渡，快速反向接续当前画面，减少动效时关闭过渡；不以动画延迟偏好提交。箭头 / Home / End 可逐档选择，Enter 完成；不会新增 Run 或服务配置状态源。浮层复用应用 portal 与主题表面，模型列表加载失败保留旧列表，显式刷新贯通 `forceRefresh`。推理档位依然同步取共享本地目录。

最高受支持档位的 `ReasoningStarfield` 独立绘制蓝紫色场和 14 个缓慢漂移白点。开启 Fast 后，各档位的已选区间均显示横穿粒子，滑块右侧保留未选档位圆点；低于最高档时继续使用主题主色底。画布保持整条轨道宽度，以与滑块相同的 160ms 过渡裁切到已选区间，右侧圆点使用互补裁切；拖动预览只改变可见范围，不缩放、重挂载画布或重启粒子。Fast 关闭时，低档恢复普通填充和圆点，最高档恢复星空；Fast 偏好与请求仍独立生效。Fast 闪电关闭时描边、开启时使用当前强调色实心填充。装饰使用单 WebGL 画布，不逐帧更新 React；无效果、隐藏和离开视口停止帧循环，减少动效只绘静态色场，不生成白点动画。WebGL 失败时最高档使用静态渐变兜底；卸载释放 GPU、observer、监听与帧任务。

取证目标为本机 `/Applications/ChatGPT.app/Contents/Resources/app.asar`（内部 `openai-codex-electron`，26.1016.62342，SHA256 `5b5cf52887cfd4de19cb5862155a8ef6cf58830c0a2fc592b72060cfcc3be869`）。REA 静态模块 `webview/assets/impl-791cfbad45b4.js`（SHA256 `bb9128732af275cf7c3e36a0910cc301802caa09a6a2bf4e56689d1cf52a80a9`）与 `impl-9597edf4b611.css` 证明：普通星点约 1.28～3.2 秒调整目标，横向偏移不超过锚点 ±4px；Fast 约 1.58～2.375 秒匀速从右向左横穿，没有长拖尾。“加速感”来自原星点 / 刻度退出、流动层接管。该方向是所核对版本的实际坐标，不根据录屏推测。父证据 `ev_af2ef50e5988aeee44d869fce0ed2c9b3f8944898875871e3905980f9339bb8b`、摘要 `ev_a47f3e4e1121571958d0798b8401371afdc55cb4e32009f75aad1d2b5aa68ad8`，8788 AST 节点、解析无失败；部分无关 unpacked native 文件与 ASAR integrity 元数据不符，采用 record-and-continue 静态分析，不能声称整包完整性或全应用行为已验证。OmniFlow 按这些参数独立重写组件，不携带上游 bundle。

### 6.2 Fast 请求边界

Fast 与推理档位分开保存，仅 OpenAI provider 开放。服务档位与推理档位共用 `src/shared/ai-model-catalog.json`：精确匹配的已知型号直接使用内置 `service_tiers`，不要求官方域名，也不要求先成功读取 `/models`。自定义连接的 ID-only 列表、目录缺失或过期不会抹掉已知型号的本地能力；未知型号、大小写 / 后缀别名不会模糊套表。

当前连接五分钟内的成功目录若为精确型号提供合法 `service_tiers`，该字段优先于本地表；`priority` / `fast` 可请求加速，显式空数组或仅 `default` 保留否决含义。字段缺失或解析失败回退本地；未知型号仍必须有新鲜远端能力。连接身份继续按 provider / URL / 凭据隔离，读取能力不主动发网络请求。renderer 对 profile ID、更新时间、模型及请求代次作一致性核对，隐藏 / 切来源后迟到响应失效，打开选择器轻量重读，刷新模型才强制网络发现。

该规则修正了首版误加的“非官方 URL 必须远端声明”限制。对照固定 Codex SHA `d6817454d76885e9d0e118bbf82e507aed6f715a`：`models-manager/src/manager.rs` 初始化载入内置 `models.json`；普通自定义 `base_url` 不清空该目录，TUI 根据精确型号的 `service_tiers` 和 feature 显示命令，app-server `model/list` 投影相同字段。其远程目录是完整 `ModelInfo` 协议，不等同普通 OpenAI ID 列表；显式 `model_catalog_url` 才禁止内置补齐。OmniFlow 未实现该独立目录配置，采用上面的字段级远端覆盖，不能称为完全复制 Codex 的整项替换 / 权威目录规则。此处依据 CLI / app-server 源码，既有桌面 REA 滑杆取证不替代目录来源证明。

main 重新验证请求，优先发送 `service_tier: priority`，仅声明 fast 的连接使用 `fast`。显式关闭且连接支持时发送 `default`，不支持的连接不附加字段；旧调用缺少 fastMode 时保留旧协议。显式开启却不支持时在发请求前拒绝，不静默降级。Agent 冻结请求选项，持久化 requested / effective Fast 偏好；续轮与协议回退沿同一冻结档位。字幕批处理沿原 RunSession 冻结能力，避免目录 TTL 导致同一批中途换档。Fast 开关覆盖 Agent 主请求及工具续轮、字幕请求；辅助会话摘要、Run 内压缩与标题继续省略 service_tier，遵循服务端默认策略，不能称为强制 default。

这表示请求优先处理，不保证服务端实际加速或固定倍数；响应仍可能回退到 default，不能用本地开关或动画证明实际服务档位。能力与协议依据为 OpenAI [Fast mode](https://developers.openai.com/api/docs/guides/fast-mode) 及所核对 Codex 目录，具体自动化与实机范围见验证矩阵。

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
