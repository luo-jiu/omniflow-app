# OmniFlow App 前端交接说明

更新时间：2026-04-15

适用对象：继续维护 `omniflow-app` 前端、Electron 主进程、IPC、桌面交互和前端文档的开发者或 Coding Agent。

## 1. 当前结论

`omniflow-app` 是 OmniFlow 的桌面客户端。所有开发都必须优先保持用户可感知行为、API/IPC 契约、状态所有权和 Electron 边界稳定。

当前技术栈：

- React 18
- TypeScript 5
- Vite 5
- Electron 30
- Semi UI
- styled-components

## 2. 入口与目录

- 应用入口：`src/main.tsx`
- 根组件：`src/App.tsx`
- 路由：`src/router/`
- 页面：`src/views/`
- 业务域：`src/features/`
- 通用组件：`src/components/`
- 全局上下文：`src/contexts/`
- 请求封装：`src/service/request/`
- 上传中心：`src/modules/upload-center/`
- Electron 主进程：`electron/main.ts`
- Electron preload：`electron/preload.ts`
- IPC 注册：`electron/ipc/`
- Electron 原生能力：`electron/service/`
- 前端 review 标准：`.agent-docs/frontend-review-standard.md`

## 3. 分层边界

默认职责方向：

```text
views -> features -> components / hooks -> service / bridge -> backend or electron
```

必须遵守：

- `views` 负责页面级编排、路由落点、模式切换。
- `features` 负责业务域状态编排和交互逻辑。
- `components/ui` 保持通用，不知道具体业务语义。
- `service` 收敛 HTTP、IPC、上传、认证头和错误映射。
- `electron` 收敛窗口、浏览器视图、下载、会话、本地文件等宿主能力。
- `utils` 保持纯函数或轻量工具，不偷偷持有跨模块状态。

禁止：

- 页面或通用组件散落原始 IPC channel 名称。
- UI 组件直接理解后端响应外壳。
- `service` 反向拼接页面状态机。
- 为局部交互修改全局主题、窗口或 Electron 安全配置。

## 4. API / IPC 契约

- HTTP 请求优先通过 `src/service/request/` 收敛。
- IPC 能力必须通过 `electron/preload.ts` 暴露的桥接 API 使用。
- 新增 IPC channel 时必须同时确认 main、preload、renderer 三端 payload 稳定。
- Renderer 不直接依赖 main process 内部状态结构。
- 鉴权、登录态失效、错误映射不得在页面中分散实现。

## 5. 状态与生命周期

每份状态都必须能回答：

- 谁拥有？
- 谁写入？
- 谁只是消费？
- 何时清理？

重点关注：

- tab、workspace、browser view、tree expansion、selection、draft input 的 owner。
- 目录树、标签栏、浏览器资源捕捉、上传任务、音频播放的失效与清理。
- timer、event listener、IPC listener、upload task、WebContentsView 是否释放。
- 异步回调是否会把旧 tab、旧页面、旧库的结果写回当前界面。

## 6. 高风险区域

后续改动时优先补验证：

1. 嵌入式浏览器资源捕捉：网络、fetch/XHR、JSON、MSE、manifest、下载与合并。
2. Electron browser view 生命周期：激活、隐藏、关闭、窗口尺寸、事件解绑。
3. 上传中心：任务状态机、取消、重试、进度、并发、失败提示。
4. 文件树与标签页：选择、展开、路径定位、拖拽、跨库切换。
5. API/IPC 错误：登录失效、后端错误、主进程错误、上传错误。
6. 主题与布局：暗色/亮色、标题栏安全区、浮层、右键菜单、分栏拖拽。

## 7. 构建与验证

常规改动至少执行：

```bash
npm run lint
npm run build
```

如果暂时不能执行，最终回复必须说明原因和未验证风险。

涉及主题、拖拽、浮层、浏览器视图、目录树、上传、资源捕捉时，必须写清楚手工验证了哪些路径。

## 8. 文档职责

前端文档是 Agent 的外部长期记忆。新增或修改以下内容时，必须同步更新文档：

- API/IPC 契约
- Electron 桥接与宿主能力
- 嵌入式浏览器资源捕捉
- 上传中心状态机
- 复杂工作区、文件树、标签页行为
- 主题、布局、交互规则
- 构建、验证、发布方式

详细规则见：`.agent-docs/frontend-documentation-standard.md`。
