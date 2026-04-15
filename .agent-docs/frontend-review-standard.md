# OmniFlow App Frontend Review Standard

更新时间：2026-04-15

适用范围：`omniflow-app` 前端、Electron renderer / preload / main、IPC、工作区交互和前端文档相关改动的代码评审。

目标：用一份短文统一前端 review 的判断顺序、风险重点、验证门禁和输出格式，避免“功能能跑，但边界和生命周期慢慢变形”。

详细架构、专题边界和验证矩阵请分别参考：

- `AGENTS.md`
- `docs/frontend-architecture-baseline.md`
- `docs/embedded-browser-architecture.md`
- `docs/library-detail-workspace.md`
- `docs/file-explorer-file-viewer-boundary.md`
- `docs/frontend-validation-matrix.md`

## 1. Review 顺序

每次 review 按下面顺序判断，前一层不过，后一层不算过：

1. 黑盒行为和用户心智是否稳定
2. 分层与职责边界是否干净
3. 状态 owner 是否单一、可推导
4. 生命周期与热路径性能是否可靠
5. 主题、布局、浮层和桌面宿主细节是否一致
6. 验证与文档是否收口

## 2. 重点风险面

### 2.1 黑盒行为回归

优先关注：

- 路由、页面入口、工作区模式切换是否漂移
- API / IPC 字段、错误提示、恢复行为是否变化
- 双击、右键、拖拽、返回、关闭 tab 等核心交互是否变化

默认高风险：

- 用户操作路径没变，但结果或反馈变了
- 只改局部功能，却影响别的模式、tab、库或页面
- 原本来自后端或主进程的错误，被前端表现成“像代码坏了”

### 2.2 分层与边界

默认依赖方向：

```text
views -> features -> components / hooks -> service / bridge -> backend or electron
```

优先关注：

- 页面或通用组件里是否散落原始 IPC / Electron 调用
- `service` 是否开始拼页面状态机
- `features` 是否偷偷承担页面总控
- `electron` 是否反向承担 renderer 业务编排

### 2.3 状态双源

优先关注：

- 派生状态是否被重复存储
- 同一业务事实是否同时存在于页面、feature、ref、宿主投影等多处
- tab、workspace、browser view、tree expansion、selection、draft input 是否各有唯一 owner

默认高风险：

- prop 看似受控，实际只在 mount 时生效一次
- 本地数组镜像主进程或后端状态，靠补丁式 `setState` 维持
- 草稿或临时状态泄漏到另一个实例
- 为了“看起来快”缓存了一份状态，但没有清晰失效条件

### 2.4 生命周期与热路径

优先关注：

- 高频事件里是否有明显 O(n) DOM 工作
- `useEffect` / `useLayoutEffect` 是否被无关 rerender 反复触发
- timer、event listener、upload task、browser tab、WebContentsView、session 是否回收
- 异步回调是否会把旧页面 / 旧 tab / 旧库结果写回当前界面

默认高风险：

- 每次 rerender 都全量扫描目录树、tab 或 DOM
- 原生 view 已隐藏，但资源和事件还活着
- 用“收起再展开”掩盖同步问题，却影响拖拽或命中体验

### 2.5 主题、布局与桌面细节

优先关注：

- 亮色 / 暗色 / 跟随系统是否都成立
- 标题栏安全区、浮层、右键菜单、分栏拖拽是否稳定
- 浏览器模式、文件模式、搜索主页切换时布局节奏是否突变
- overlay / modal / context menu 是否会被原生 view 遮挡

### 2.6 验证缺口

优先关注：

- 是否执行了 `npm run lint`
- 是否执行了 `npm run build`
- 是否按 `docs/frontend-validation-matrix.md` 覆盖本次改动对应的主路径和边界路径
- 是否同步更新了真正受影响的文档

## 3. 最低验证门禁

前端 review 的最低门禁：

1. `npm run lint`
2. `npm run build`
3. 对本次改动涉及的关键交互做一次人工验证
4. 涉及工作区、文件树、文件预览、上传、embedded browser、资源捕捉、主题或浮层时，至少验证一条边界路径
5. 更新真正受影响的文档或明确说明为什么不用更新

如果没有执行这些验证，不代表不能 review；但必须把未验证风险明确写出来。

## 4. Review 输出格式

Review 结论按这个顺序写：

1. Findings，按严重度排序
2. Open questions / assumptions
3. Change summary

Findings 优先关注：

- 行为回归
- 边界不清
- 状态双源
- 生命周期泄漏
- 热路径性能问题
- 主题 / 布局 / 浮层一致性问题
- 验证缺口

如果没有问题，要明确写“未发现问题”，并补一句残余风险或未验证项。

## 5. 一票否决项

出现以下任一情况，默认不建议合并：

- 破坏用户黑盒行为且未明确说明
- 同一业务事实出现双 source of truth 且无收口计划
- 把原始 IPC / Electron 实现细节散到页面、组件或通用 hook 层
- 在拖拽、滚动、选择、resize 等热路径里引入明显 O(n) DOM 工作
- 用全局主题、窗口配置或禁用安全能力去掩盖局部问题
- 原生资源、事件监听、定时器、异步任务没有明确回收

## 6. 维护规则

这份文档只保留 review 判断标准，不承担架构导览或专题说明。

出现以下情况时，先更新本文，再继续正式 review：

- 最近连续出现、本文还没覆盖的同类 finding
- 前端主要风险面发生变化
- 构建、验证或 review 输出方式发生真实变化

目标不是把文档越写越长，而是让它持续代表“现在这套前端 review 最该盯住什么”。
