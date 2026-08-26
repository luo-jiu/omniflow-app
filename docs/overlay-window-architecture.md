# Overlay 窗口架构与迁移规范

更新时间：2026-08-26

适用范围：`omniflow-app` 的跨 renderer 浮层子系统(overlay BrowserWindow),及其承载的弹框 / 右键菜单 / 气泡等迁移流程。

---

## 1. 背景与动机

嵌入浏览器通过 `targetWindow.contentView.addChildView(WebContentsView)` 挂载(见 `electron/service/embeddedBrowserMainController.ts`)。`WebContentsView` 是 OS 级原生视图,绘制在 renderer DOM 之上。

这导致一个**无法靠 z-index / React portal 解决**的问题:

- 主窗口 renderer 里的 Semi `Modal` / `Popover` / `Popconfirm` / 自研浮层
- 以及 `src/utils/popup-container.ts` 的 `getAppPopupContainer()` 返回的挂点(`#app-overlay-root` / `#root` / `document.body`,全部在主窗口 `document` 内)

**只要弹框的可视区矩形与浏览器视图矩形重叠,就必然被遮。** 用户触发上传确认、右键菜单、删除二次确认等操作时,按钮被浏览器视图挡住又点不到,周围又被 mask 置灰,只能按 ESC 取消。

业内参考实现(Discord、Slack、Figma Desktop、`electron-overlay-window`)已收敛到同一答案:

> 一个**长期存在的、透明的、跟随主窗口的子 `BrowserWindow`**,配**声明式 IPC + 组件注册表**,承载所有需要覆盖原生视图的浮层。

本项目的 overlay 子系统就是这个答案的落地版本。

---

## 2. 架构全景

### 2.1 窗口

- overlay 是一个子 `BrowserWindow`,`parent: mainWindow`,`transparent: true`,`frame: false`,`skipTaskbar: true`,`hasShadow: false`,`focusable: true`,`show: false`(启动时不可见,第一次有 spec 才 show)
- 默认 `setIgnoreMouseEvents(true, { forward: true })` 让所有点击穿透到主窗口
- 有浮层时关穿透(接管事件),浮层关闭后恢复穿透
- bounds 跟随主窗口的 `getContentBounds()` 同步,用 `setContentBounds()`(比 `setBounds` jitter 更小)
- 主窗口生命周期事件全部显式监听(`parent` 选项跨平台行为不一致):

| 主窗口事件 | overlay 动作 |
|---|---|
| `move` / `resize` / `maximize` / `unmaximize` | `syncBoundsFromMain()`(coalesced 到下一 tick) |
| `enter-full-screen` / `leave-full-screen` | 立即 sync + 300ms 后再 sync 一次(mac 全屏动画延迟) |
| `minimize` / `hide` | overlay `hide()` |
| `restore` / `show` | overlay 如有浮层则 show + sync |
| `close`(或 closed) | `overlayController.destroy()` |
| `screen.on('display-metrics-changed')` | `syncBoundsFromMain()`(多显示器兜底) |
| `app.on('before-quit')` | `overlayController.destroy()` |

### 2.2 IPC 契约

| channel | 方向 | 类型 | payload |
|---|---|---|---|
| `overlay:open` | 主 renderer → main | `handle` | `{ requestId?, type, props }` → `Promise<result>` |
| `overlay:update` | 主 renderer → main | `handle` | `{ requestId, props }` → `Promise<boolean>` |
| `overlay:host:resolve` | overlay → main | `on` | `{ requestId, result }` |
| `overlay:host:dismiss` | overlay → main | `on` | `{ requestId, reason }` |
| `overlay:host:show` | main → overlay | `send` | `{ requestId, type, props }` |
| `overlay:host:update` | main → overlay | `send` | `{ requestId, props }` |
| `overlay:host:dismiss-from-main` | main → overlay | `send` | `{ requestId }` |

一次性 `openOverlay` 的 `requestId` 仍由 main 生成。需要渐进更新 props 时，`openOverlaySession` 在主 renderer 生成 UUID 并随 `overlay:open` 传入，使调用方在长 Promise 结算前可以调用 `updateProps`。main 只接受原始 sender 对当前或排队中同一请求的更新；请求结算、超时或 sender 销毁后更新返回 `false`。overlay host 对相同 `requestId` 只替换 props，不重建当前 overlay 请求。

`ipcMain.handle('overlay:open')` 的 handler 返回一个长 Promise，main 在收到 `overlay:host:resolve` 时 resolve 这个 Promise，作为 `invoke` 的返回值回到主 renderer。

**并发策略**:串行队列,`currentRequest` + `queue`。并发 open 调用会排队等前一个结算后才显示,不支持栈叠(MVP)。

**清理保障**:每个 pending 挂 `senderContents.once('destroyed', ...)` 和 10 分钟 timeout;overlay 进程崩溃时 `resetAll()` 把所有 pending reject,恢复 click-through。

### 2.3 主 renderer 侧 API

`src/service/overlay/overlay.api.ts` 提供类型安全的唯一入口:

```ts
import { openOverlay } from '@/service/overlay/overlay.api';
import type { UploadConfirmResult } from '@/service/overlay/types';

const result = await openOverlay('upload-confirm', { fileSummaries, targetNode });
// result: { type: 'confirm' } | { type: 'cancel' }
```

需要先展示再更新进度或探活结果时，使用受控会话，状态 owner 仍留在主 renderer：

```ts
const session = openOverlaySession('node-properties', loadingProps);
void loadStatistics().then((statistics) => session.updateProps(buildProps(statistics)));
const result = await session.result;
```

### 2.4 overlay 渲染进程结构

```
overlay.html
  ↓
src/overlay/main.tsx
  ├─ OverlayThemeBridge        (localStorage + matchMedia + 'storage' 事件同步主题)
  └─ OverlayHost                (订阅 onShow / onDismissFromMain,查 registry,渲染)
       └─ registry.tsx          (type → component 映射)
             └─ UploadConfirmOverlayAdapter
                  └─ UploadConfirmModal  (复用原组件,props 已 serializable 化)
             └─ DeleteConfirmOverlayAdapter
                  └─ DeleteConfirmModal  (删除二次确认,居中覆盖原生视图)
             └─ DirectoryContextMenuOverlayAdapter
                  └─ DirectoryContextMenu  (右键动作通过 result 回主 renderer 执行)
```

### 2.5 主题同步

overlay 和主窗口是同 origin 的两个 renderer,`localStorage` 共享。主窗口 `ThemeContext`(`src/contexts/ThemeContext.tsx`)写 `app-theme` 时,`OverlayThemeBridge`:

1. 初次 mount 从 `localStorage.getItem('app-theme')` 读取
2. 订阅 `window.addEventListener('storage', ...)` 接收主窗口写入
3. 订阅 `matchMedia('(prefers-color-scheme: dark)')` 接收系统主题变化
4. 把 resolved theme 写到 `document.body[theme-mode]`,Semi UI CSS 变量自动更新

---

## 3. 什么时候要走 overlay

### 3.1 必须走 overlay

浮层可视区**可能**与嵌入浏览器矩形重叠 → 必须走 overlay。包括但不限于:

- 所有居中或靠近视口中心的 Modal
- 文件 / 文件夹属性弹窗
- 拖拽区域在浏览器范围内的浮层(拖拽上传确认)
- 右键菜单打开在浏览器之上时
- 业务操作的确认弹框(删除、清空、批量操作等)
- 资源选择 / 目标目录选择等需要接管主视图的浮层

### 3.2 可以保留 DOM 层

明确**绝不会**覆盖浏览器区域的轻量浮层,可保留 `getAppPopupContainer()` 挂点:

- 永远位于侧边栏、标题栏等固定非浏览器区域的 Tooltip
- 下拉选择器且下拉面板在非浏览器区域内
- 状态提示类(Toast 除外,Toast 是全局,保持主 renderer)

---

## 4. 强约束(15 条,违反即不得合并)

迁移任何弹框到 overlay 之前,逐条过以下清单。**任何一条违反都必须先消除违反,再迁**。

### ① props 必须 JSON serializable

通过 IPC 结构化克隆能跨进程的值:原始类型、`Array`、纯对象、`null`。**禁止**`Date`、`Map`、`Set`、`RegExp`、class instance、`Blob`、`File`、`ArrayBuffer` 的直接传递(如必须,用字符串/base64/数字时间戳序列化)。

### ② 禁止跨进程传 File / Blob / ReactNode / function / DOM ref

- **File / Blob**:留在主 renderer 闭包,overlay 只收摘要(`{name, size, relativePath}` 等)
- **ReactNode**:不能序列化,组件内容由 overlay 侧根据 props 自行渲染
- **function / 回调**:用 result payload 返回值代替;复杂状态机用多次 `openOverlay` 拆分
- **DOM ref / HTMLElement**:主窗口的 DOM 在 overlay 里拿不到

### ③ 必须在 `src/overlay/registry.tsx` 注册 type

无注册的 type 会走 OverlayHost 的 fallback,立刻以 `{type:'cancel', reason:'unknown overlay type'}` resolve。每个 type 都需要显式注册 adapter。

### ④ 必须在 `src/service/overlay/types.ts` 定义 props 与 result 类型

更新 `OverlayPropsMap` 和 `OverlayResultMap`,确保 `openOverlay(type, props)` 有类型推断、调用方拿到的 result 有收敛的联合类型。

### ⑤ 迁移后必须删除旧 state 与旧 Modal 挂载 JSX

不留"双写":不要同时在主 renderer DOM 层再挂一个 fallback Modal。迁完就删。

### ⑥ 禁止引用主 renderer 的 React Context / Redux / Zustand store

overlay 是独立 React 树,主 renderer 的 Provider 对它不可见。需要数据 → 通过 props 传(已序列化);需要推送 → 通过 IPC。

### ⑦ Semi UI 主题依赖 `document.body[theme-mode]`

overlay 已在 `OverlayThemeBridge` 统一处理,组件**不要**自己写 `setAttribute('theme-mode', ...)` 或从外部注入 theme 值。

### ⑧ styled-components / emotion theme 必须通过 OverlayThemeBridge 注入

如果迁的组件依赖 `ThemeProvider` 提供的 theme object,应在 `OverlayThemeBridge` 内部 wrap `ThemeProvider`,不在单个组件里单独 wrap。

### ⑨ 不要用 `getPopupContainer: getAppPopupContainer`

`getAppPopupContainer()` 查询的是**主窗口** `document` 里的 `#app-overlay-root`,在 overlay 里为 null。overlay 内的 Semi 组件直接让默认挂 `document.body` 即可(overlay 自己的 body)。如需自定义容器,用 overlay 内的 DOM ref。

### ⑩ overlay 内禁止调 Toast / Notification

Semi 的 `Toast` 单例容器和主窗口独立,overlay 里调只会在 overlay 自己的透明窗口内显示(用户看不出所谓反馈)。**业务反馈走 result payload**,主 renderer 拿到结果后调 Toast。例:

```ts
// overlay 组件里 ❌ Toast.success('上传成功')
// 正确: onResolve({ type: 'confirm' })

// 主 renderer ✅
if (result.type === 'confirm') {
  Toast.info('正在准备上传队列');
  // ... 启动上传
}
```

### ⑪ 组件必须 presentational (dumb component)

只使用 React 内置 hooks(`useState` / `useEffect` / `useMemo` / `useCallback` / `useRef`)。**禁止**:`useNavigate` / `useRoute` / `useSelector` / `useDispatch` / 访问 websocket 连接单例 / 访问 HTTP 请求单例。要异步交互 → 请求数据由主 renderer 预先准备好,overlay 只展示。

### ⑫ 必须处理 onCancel(ESC / 点击外部 / 主动 dismiss)

每个迁移组件都必须在 props 里消费 `onCancel`,不能"静默"让用户无法退出。OverlayHost 默认把 ESC / unknown type fallback 映射到 `{type:'cancel'}`,组件内部的 Semi Modal 的 `onCancel` 也要接到 adapter 的 `onCancel`。

### ⑬ result 必须 JSON serializable(强调)

同 ①,但单独列出强调:result payload 会走 IPC 回到主 renderer,**禁止**函数 / class instance / Date。用字符串字段表达状态,用数字表达时间戳。

### ⑭ 禁止向 Semi UI 组件传 `getPopupContainer={undefined}`

在已验证的 `UploadConfirmModal` 迁移中,adapter 没传 `getPopupContainer`,但组件的 props 接口定义了 `getPopupContainer?: () => HTMLElement`,Semi 的 `<Modal getPopupContainer={undefined}/>` 会**静默不挂载到 DOM**(没有报错,Modal 就是不渲染)。

**规则**:

- 在 overlay 里渲染的组件,**直接删除** `getPopupContainer` prop 及其向下传递
- 让 Semi 组件的 `getPopupContainer` 用默认值(`document.body`,即 overlay 自己的 body)
- 如果确实需要自定义容器,用条件展开:`{...(container ? { getPopupContainer: container } : {})}`,而不是 `getPopupContainer={container}`

### ⑮ overlay renderer 的 React root 禁止包 `React.StrictMode`

Semi UI Modal 的内部 portal 在 StrictMode 的 dev 双挂 cleanup 中会被销毁,remount 不恢复,导致 Modal 静默不渲染(DOM 里连 `.semi-modal-wrap` 都没有)。**`src/overlay/main.tsx` 已明确不包 `React.StrictMode`,不要加回来。**

如未来引入的组件依赖其他可能与 StrictMode 冲突的库(例如某些 portal/animation 库),请在本规范补充记录并评估是否需要迁移时做兼容修改,而不是重新开启 StrictMode。

主 renderer 的 `src/main.tsx` 仍然保留 `React.StrictMode`,这条约束只作用于 overlay entry。

---

## 5. 迁移步骤(以 `UploadConfirmModal` 为标准样板)

以下是本次样板迁移的完整流程,新增弹框照抄即可。

### Step 1:评估组件是否满足第 4 节强约束

例:`UploadConfirmModal` 原 props 含 `files: UploadCandidateFile[]`,其中 `file: File` 不可序列化 → 必须先改造。

### Step 2:定义 props 与 result 类型

在 `src/service/overlay/types.ts` 追加:

```ts
export type UploadConfirmOverlayProps = {
  fileSummaries: OverlayFileSummary[];
  targetNode: OverlayTargetNode;
};

export type UploadConfirmResult =
  | { type: 'confirm' }
  | { type: 'cancel' };
```

并更新 `OverlayPropsMap` / `OverlayResultMap`。

### Step 3:改造组件 props 使其 serializable

把不可序列化字段替换为摘要/ID/base64 等可序列化形态。例:

```ts
// 原
interface UploadConfirmModalProps {
  files: UploadCandidateFile[];  // ❌ file: File 不可序列化
  ...
}

// 改造后
interface UploadConfirmModalProps {
  fileSummaries: OverlayFileSummary[];  // ✅ {name, size, relativePath}
  ...
}
```

组件内部引用同步替换(`item.file.name` → `item.name` 等)。

### Step 4:把组件注册到 overlay registry

`src/overlay/components/UploadConfirmOverlayAdapter.tsx`:

```tsx
export const UploadConfirmOverlayAdapter: React.FC<
  OverlayComponentProps<UploadConfirmOverlayProps, UploadConfirmResult>
> = ({ props, onResolve, onCancel }) => (
  <UploadConfirmModal
    visible
    fileSummaries={props.fileSummaries}
    targetNode={props.targetNode}
    onConfirm={() => onResolve({ type: 'confirm' })}
    onCancel={onCancel}
  />
);
```

`src/overlay/registry.tsx` 里追加:

```ts
export const overlayRegistry: Record<string, OverlayRegistryEntry> = {
  'upload-confirm': { component: UploadConfirmOverlayAdapter },
  // 其他迁移项...
};
```

### Step 5:替换调用方

调用点从 `<MyModal state+callbacks/>` 改为 `await openOverlay`:

```ts
// 原 hook state + JSX 渲染 + onConfirm / onCancel callback
const [modalState, setModalState] = useState({ visible: false, ... });
<MyModal visible={modalState.visible} onConfirm={handleConfirm} onCancel={handleCancel} />

// 改造后:没有 state,没有 JSX
const result = await openOverlay('upload-confirm', {
  fileSummaries: files.map(f => ({ name: f.name, size: f.size, relativePath: f.relativePath })),
  targetNode,
});
if (result.type === 'confirm') {
  // 原 handleConfirm 的逻辑
  Toast.info('正在准备上传队列');
  void startUploadInBackground(files, targetNode);
}
// cancel 分支:什么都不做,丢弃 await 的闭包
```

**File[] 等不可序列化数据留在 `await` 的闭包里**,绝不跨进程传。

### Step 6:删除旧 state 与旧 Modal JSX

删干净,不留双写。删除后:

- hook 返回值缩减(`handleConfirm`、`handleCancel`、`modalState` 不再返回)
- 组件 JSX 里的 `<MyModal/>` 挂载删除
- 如无其他地方用,连 import 一起删

### Step 7:验证

- `npm run lint && npm run build` clean
- 按第 6 节验证 checklist 手工走一遍

---

## 6. 验证 Checklist

每次新增或迁移组件到 overlay 都要过一遍:

### 核心行为

- [ ] 打开 → overlay 显示在浏览器之上(开浏览器模式后验证,这是存在意义的根本验证)
- [ ] 确认按钮 → result resolve,主 renderer 收到正确 payload
- [ ] 取消按钮 → result `{type:'cancel'}`
- [ ] ESC 键 → 等同取消
- [ ] 点 backdrop → 等同取消(Semi Modal 的 maskClosable 属性保留即可)
- [ ] 未知 type(调错 type 字符串)→ 立即 cancel,不卡住

### 窗口生命周期

- [ ] 拖动主窗口 → overlay 跟随无明显 jitter
- [ ] 缩放主窗口 → overlay 跟随
- [ ] 最大化 / 还原 → overlay 跟随
- [ ] 全屏进/出 → overlay 正确覆盖(全屏动画结束也正确)
- [ ] 最小化 → overlay 隐藏
- [ ] 还原 → overlay 回到正确位置(若浮层还在)
- [ ] 关闭主窗口 → overlay 跟随销毁,进程不泄漏

### 多环境

- [ ] 多显示器:主窗口拖到副屏 → overlay 跟随 + bounds 正确(含不同 DPI)
- [ ] 主题切换:浅色 ↔ 深色 ↔ 跟随系统 → overlay 内组件即时换色
- [ ] 并发触发:连续两次 openOverlay → 队列顺次显示,不丢 result

### 容错

- [ ] 10 分钟不操作 → pending timeout reject(主 renderer 收到 error,可自行兜底)
- [ ] 主 renderer reload / crash → pending 清理,overlay 恢复 click-through
- [ ] overlay renderer crash → 所有 pending reject,主 renderer 收到 error

### 浏览器专属

- [ ] 浏览器未激活(文件模式)→ 弹框行为一致
- [ ] 浏览器正在播放视频(macOS + Windows)→ 弹框依然可见可点(Windows DWM + GPU overlay 场景冒烟)

---

## 7. 已知限制 & 风险

### 平台

- **macOS**:overlay 拿 focus 时主窗口会短暂失焦(标题栏变灰);关闭后 `mainWindow.focus()` 归还。属正常视觉副作用。
- **macOS 12 / 13 / 14**:`transparent + parent + setIgnoreMouseEvents` 组合在 Big Sur 早期版本有过红绿灯渲染异常的历史,Sonoma+ 已修复。测试覆盖 12/13/14 三档。
- **Windows**:`transparent` 窗口与 DWM 合成在 GPU 硬件加速 video overlay 场景下,click-through 有极小概率失效。建议迁移新浮层时做一次冒烟。
- **Linux / Wayland**:`setIgnoreMouseEvents` 的支持较新且依赖合成器实现,best effort。

### 架构边界

- MVP 只支持**串行队列**,不支持栈叠浮层。如将来需要(如 Modal 上再开右键菜单),需要扩展 OverlayHost 为栈式状态 + main 侧 currentRequest 升级为栈。
- overlay 不使用窗口级 `vibrancy`(`transparent:true` 下 macOS vibrancy 行为 undefined),视觉质感由 CSS `backdrop-filter` 决定。如未来需要更强的原生毛玻璃,要调研 `setVibrancy` 动态切换的闪烁风险。
- overlay bundle 独立打包,不要 import uploadManager、websocket 连接等"主 renderer 业务单例",否则 bundle 会膨胀且产生两套状态机。

### Bundle 卫生

- overlay entry 导入组件时,凡是**纯展示**组件可以复用;一旦组件树里偷偷 import 到业务单例(如 `uploadManager`、`apiRequest`、router),会把整个依赖图拖进 overlay bundle。迁移时用 `npm run build` + bundle analyzer 验证一下。

---

## 8. 高风险变更点

后续改动以下地方时必须额外小心,改动后回写本文:

1. `electron/service/overlayWindowController.ts` — 窗口生命周期与 bounds 同步的单点
2. `electron/service/overlayWindowIpc.ts` — IPC 契约 + pending 管理
3. `electron/preload.ts` 的 `electronOverlay` / `electronOverlayHost` 命名空间
4. `src/overlay/registry.tsx` — 新增 / 重命名 type 必须同步调用方
5. `src/service/overlay/types.ts` — 类型契约破坏性修改要全局搜索调用方

---

## 9. 维护规则

出现以下变化时必须回写本文:

- IPC channel 名、payload 结构、或 result schema 变化
- overlay 窗口生命周期规则变化(事件监听、click-through 规则、bounds 策略)
- 主题同步机制变化
- 并发策略从串行队列改为其他模式
- 新增跨窗口能力(如拖拽跨窗口、文件拖入 overlay 等)

后续扩展方向:

- `DirectoryContextMenu` 已迁移到 overlay 子窗口；后续仍可迁移 `library-context-menu`
- Tooltip / Select 下拉的条件迁移
- 栈叠支持(如需在 Modal 上再开右键菜单)
- macOS 动态 vibrancy 实验
