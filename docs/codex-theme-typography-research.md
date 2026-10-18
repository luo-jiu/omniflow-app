# Codex 安装版主题与排版调研

更新时间：2026-10-16

适用范围：为 OmniFlow Agent 聊天可读性与侧栏密度提供参照；本文记录外部产品的安装包事实，不替代 OmniFlow 的[显示基线](ui-display-readability-baseline.md)与[Agent UI 契约](built-in-agent-ui-contract.md)。

## 1. 当前结论

Codex 将长文正文、主侧栏项目/聊天标题、文件树分别控制。默认聊天正文与主侧栏标题都是 14px，文件树为 13px。其文件树的文字没有更大，主要是行槽位更宽松；不能把某处 `text-sm` 推广为整个侧栏的字号，也不能把侧栏项目列表等同于文件树。

默认字体来自系统栈，并非默认启用 OpenAI Sans。macOS 默认开启 `antialiased`。清晰观感需要结合字体平滑、普通/强调字重、行高、段落结构和表面颜色共同判断，不能仅靠增大字号或把正文提高到纯白。

本文的数值均为安装包默认或静态公式推导，未读取当前用户窗口的 computed style；外观设置和自定义主题可以覆盖默认值。

## 2. 目标身份与证据边界

- 安装包：`/Applications/ChatGPT.app/Contents/Resources/app.asar`，包名 `openai-codex-electron`，产品名 `Codex`，版本 `26.1007.71326`。
- ASAR SHA-256：`2f231a64e6dd30111bcd09e03c149cd06c8679b25914842772423251c4608ded`。
- 使用 REA `analyze_javascript_application` 对 package、HTML、字体与侧栏相关的四个 JS 文件做定向静态分析，再只读提取 CSS 和相关 bundle 追踪真实样式消费者。后文大 bundle 的字符定位属于补充静态读取，不代表全部经过 REA 语义分析。
- 父 Evidence：`ev_b9d21d695ff0e1a08a396d3fa5aa6bfc22afca8724d90ef9cd00e1b9e08db457`。
- Summary Evidence：`ev_750338da9bab1ca83da717fc7c3180f84c649e1b8969455d63e04891b94f04a4`。
- REA 记录了七个 unpacked native helper 与包内完整性元数据不一致，使用 `record-and-continue` 保留限制；这些 native 文件未参与本次排版结论，不能据此声明整包完整性通过。定向语义分析外的 16234 个清单文件关系仍未知。
- 没有执行目标 JS、修改 Codex、读取账号数据库、重启或附加当前应用，也没有进入 OmniFlow 真实资料库。

下面定位均为资源文本的 **0-based UTF-16 字符偏移**，不是文件字节偏移。资源路径统一相对 ASAR 内的 `webview/assets/`：

| 缩写 | 资源 |
| --- | --- |
| I | `app-initial-1ab6fbe93c4f.js` |
| S | `app-shared-8340f229c2b3.js` |
| C | `app-shared-6ed15bfa827c.css` |
| M | `app-initial-99e8b4b455fa.css` |
| B | `base-file-tree-e2667730253e.js` |
| R | `review-file-tree-pane-79c06c8e9494.js` |

资源身份校验：I SHA-256 为 `f3d5fedc993d0ead2720c9877d8c72a82dc5fb2d935f13ad9426e6964fb6f105`，C 为 `8b4732f16ae0250887d3fe584652ac26fe67e1c8c576dbe364b5063b6324af33`，M 为 `1a75f9180b89d2457dc09e4efea288436c9cf6d44e5ba59b2c03d3d571b7bf61`。

## 3. 字体与聊天正文

| 项目 | 默认或规则 | 静态依据 |
| --- | --- | --- |
| UI 字号 | 14px；辅助层级 13px、12px | S@1986655 的 `sansFontSize.default=14`；I@9042525 按默认字号、减一、减二建立 token，并由 I@9039518 按用户设置缩放 |
| 聊天字号 | 跟随 UI，默认 14px；可单独覆盖 | C@1259628 的 `--codex-chat-font-size` 先取聊天覆盖，再取 `--font-ui-size`；I@9039518 写入 UI 设置 |
| 系统字体 | `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` | C@119500；C@119578 的内容字体可以独立覆盖，再回退 UI sans |
| OpenAI Sans | 不能视为默认字体 | I@9037512 附近有条件分支，但 I@9042478 的 `TVs` 守卫在此构建恒为 false；自定义主题字体另算 |
| 普通字重 | Electron body 的 CSS 名义值 430 | C@1251220、C@1261629；普通 Markdown 未单独覆盖，实际字形粗细仍取决于平台字体匹配 |
| 强调与标题 | semibold 600 | C@116741 标准 token；M@216605 的 Markdown 标题消费 semibold |
| macOS 字体平滑 | 默认 `antialiased` | S@1987106 `useFontSmoothing` 默认 true；I@9039657 仅 darwin 且设置开启时写入 |
| 普通正文行高 | 1.625，即默认 22.75px | C@116974 的 `--leading-relaxed`；M@221438 的 MarkdownRoot 用字号乘该值 |
| 代码字号 | 设置默认 12px；Markdown 小字还有下限公式 | S@1986807；M@221438 的 `max(host-small, font-size × .875)`，14px 正文对应最低 12.25px，不能把所有代码都称为固定 12px |

Markdown 的间距按字号建立 `--markdown-space = font-size / 4`，默认 3.5px。后续普通段落的 margin-top 可为 7px，直接相邻段落有 14px 的 margin-block 规则；中文相邻段落另有 4px margin-bottom 优化。列表默认 margin 为 0、缩进约一行高、相邻 li 不额外增加间距；列表内连续段落又有独立间距。不能把这些结构简化成“所有段距固定 14px”或“所有中文段距固定 4px”。相关规则在 M@217874、M@218106、M@219010、M@221438。

compact 用户气泡有“字号 + 4px”的行高和 `-.01em` 字距，位于 `user-message-f152e09d34c3.css`@1176；它不代表常规聊天正文。

## 4. 主侧栏与文件树

主侧栏项目调用链为 `Kbs → Yis → X4o`（I@8551930、I@8140827、I@7840011）；聊天标题走 `_1o → p1o/r1o → vzo`。这些实际消费者与通用文件树分别核对：

| 项目 | Codex 安装包默认 | 静态依据 |
| --- | --- | --- |
| 项目文字 | 14px，行高约 21px | I@7840810 的 `text-base`，C 的 base 行高 1.5 |
| 聊天标题 | 14px / 20px | I@7352267 的 `text-base leading-5`；C@550180 |
| 主侧栏行槽位 | 30px | I@8690119 祖先 `sidebar-navigation`；C@654686 局部覆盖 nav/row 高度，不能套用外层 31px 默认公式 |
| 聊天上下内距 | 通常各 5px；带次级内容分支为 6px/8px | I@7347866 的 `py-row-y` 或 `pt-1.5 pb-2`；C@1251391 的 row-y=spacing×1.25 |
| 项目上下内距 | 各 4px | X4o 的 `py-1` |
| 行间 gap / 区块 gap | 1px / 16px | I@8546328、I@8646831 的 `gap-px`；I@8660022 的 `gap-4`，浏览器变体另有覆盖 |
| 横向内距 | 8px | C@654686 的 sidebar 局部 token |
| 主图标 / 披露箭头 | 通常 16px / 14px | C@104702 的 `icon-xs`；C@313209 的 `icon-disclosure` |
| 递归缩进能力 | 每层包裹增加 16px | I@7325745 的 `ps-4`；不同聊天分组还可能预留 leading slot，不等于全部行统一递归缩进 |
| 独立文件树字体 | 13px、system-ui、400 | B@17919 的字号 override；I@5688185 的基础树样式 |
| 独立文件树行槽位 | 默认 28px；Review 调用为 29px | B@29421 的 `$e=28`；R@38962 调用与 R@40591 的 `Mn=29` |
| 文件树内距与图文 gap | 上下 0、左右 3px；横向图文 gap 5px | I@5707541；B@18525、B@18948。5px 是横向间距，不是纵向行距 |
| 文件树图标与行高 | 图标 16px；行内 height/line-height 跟随 row-height | I@5698554、I@5708101 |

文件树还包含压缩缩进的公式（B@19008），未测量实际 DOM，不将其简化成某个固定整像素缩进。

## 5. 主题与表面颜色

主题先由配置生成语义色，再由实际主题分支覆盖。以下只描述默认分支：

| 角色 | 默认暗色 | 默认亮色 | 证据类型 |
| --- | --- | --- | --- |
| 主表面 surface | `#181818` | `#ffffff` | I@5584184 的 Electron 默认主题，静态直接值 |
| 正文 | 默认 dark 特例为 `#dfdfdf` | 主题 ink 为 `#1a1c1f` | I@5614736、C@130442；自定义 dark 可使用自身 ink |
| 侧栏 under 表面 | 约 `#141414` | 约 `#f6f6f6` | C@125509 消费 under；I@5614998 的混色公式推算，非运行时取色 |

默认 dark 主题虽然将 ink 声明为白色，正文却有降至 `--gray-fixed-150` 的特殊处理。主表面与侧栏采用相近的中性色，不能据此将 OmniFlow 所有正文或彩色主题全局改成纯白。

气泡有至少两条路径：基础主题生成器使用正文色 5% 的透明混色；effective chat theme 存在时，Tba/dba 可覆盖为默认 dark 的 `rgb(50 50 50 / 85%)` 配白字、light 的 `rgb(233 233 233 / 50%)` 配 `#0d0d0d`。证据为 I@5606550、I@5603504、I@5596116。尚未确认当前截图实际走哪一条，不能把任意一条写成所有用户气泡的实机颜色。

## 6. OmniFlow 本轮采用与保留边界

OmniFlow 目录树当前为 13px / 17px，option 最低 20px，padding 1px 3px，见 `src/features/file-explorer/components/directory-tree/style.ts`。字号与 Codex 文件树相同，行槽位则更紧凑；本次调研没有修改目录树密度或全局主题。

聊天已由试调的 15px 收回 14px，保留普通字重 400、局部 `antialiased` 与 1.7 行高（23.8px）。这与 Codex 默认 22.75px 接近，仍给中文长文稍多空间。段落/列表 12px、相邻列表项 4px、强调 600，以及用户气泡较低的着色比例沿用现行试调；这些是 OmniFlow 的局部设计选择，不宣称逐项复刻 Codex。没有机械复制名义字重 430，也没有增大全局文字亮度或改动 850px 消息列。

本轮 lint、全量测试（509 文件 / 6221 项通过，3 文件 / 7 项跳过）、theme audit 与隔离完整 build 通过。真实 Timeline 的隔离 Chromium 页面核对三套配色亮暗、宽窄消息列、长文本/代码/表格无外层横向溢出；详见[验证矩阵](frontend-validation-matrix.md#314-内置-agent)。未验完整 Electron 工作区的实机观感、其他显示器或 Windows 字体栅格化。

## 7. 后续维护

升级 Codex 后应先重新核对包版本、摘要、设置覆盖链和真实组件消费者，再引用数值。若后续要调整 OmniFlow 目录树行高或全局主题，须单独验证虚拟列表高度、拖拽命中、截断、点击热区和亮暗主题，不能仅依据本表整体铺用。
