# Bandi Web 前端规则

本文件适用于 `apps/web/**`，并与项目根目录 `CLAUDE.md` 共同生效。根规则中的产品边界与安全约束不可放宽。

## 技术与职责

- 本目录是 React 19、TypeScript、Vite、Tailwind CSS v4 的界面实现。
- Web 端负责 9 个内置 AI 编程工具（Claude Code、Claude Desktop、Codex、Gemini、Grok、OpenCode、OpenClaw、Hermes、Pi）的 Team、长期 Agent、可选 Team-scoped TaskBrief（界面称“需求池 / 需求”）与配置资产的查看、编辑和明确反馈；应用内只展示 Bandi 自有受管配置，不读取或展示宿主配置内容。TaskBrief 必须属于一个 Team，只记录可交给外部客户端的目标、背景、约束和期望产出，不持久化 Agent，也不承担任务执行、聊天、终端、调度或运行监控。
- 当前模拟能力不得伪装成真实探测、安装、连接、保存、备份、命令执行或任何工具的 Session 启动。Bandi Desktop 中受管 AgentPackage 的创建、身份保存和头像读写属于已接入的窄能力；纯 Web 与外部引用仍保持演示/只读边界。工具方案只保存选择与配置，不自动安装任何工具集成。
- 未明确接入真实能力前，业务 mock 只保存在 React 当前页面内存；不得写入 `localStorage`、文件、Tauri 或后端。仅严格白名单、版本化的本机 `UiPreferences` 可使用单一 `localStorage` key；不得持久化整个 `State`、`SettingsState` 或业务对象。工作台 Logo 与背景图仅通过固定 `logo` / `background` 槽位保存到桌面应用数据目录，不接受任意路径或远程 URL，也不进入配置版本、备份或同步。

## 事实来源

- 当前路由实际引用的界面、交互和状态行为以 `apps/web/**` 的现有实现为基线；未被当前路由引用的旧实现不作为界面事实。
- 已确认的现有界面不得仅因文档描述不同而回退或重做。实现表达不完整、行为不确定或新增能力尚无界面依据时，再参考核心文档补足。
- `docs/产品与页面架构.md` 用于确认产品职责边界与首版范围，`docs/页面低保真线框图.md` 用于补充未确定的页面状态和交互，不能覆盖已经确认的现有界面。
- Local Service 职责与安全边界参考 `docs/技术架构.md`；尚未落地或存在歧义的 Rust / TypeScript 跨进程协议参考 `docs/本地服务与前端联调契约.md`。
- 本文件只保留长期实施护栏，不重复冻结页面入口、数量、像素、菜单动作或 DTO 字段。

## 界面与交互

- 保持克制、简单、明了、大气的黑白灰视觉；允许本机受控强调色用于主操作、选中态和焦点环，但不得覆盖成功、警告、危险等语义色。
- 复用 `src/styles.css` 的语义 Token、`src/components/ui/*` 和现有业务组件，不建立平行设计系统。
- 新增页面、导航、状态或流程前，确认其直接服务于 Team、Agent、TaskBrief 或长期配置管理；不得为 TaskBrief 增加执行进度、Todo、调度、审批、日志、监控、汇报或验收状态。
- Agent 长期 Memory 直接通过 Local Service 的受限安全保存链写入，界面只提供编辑、保存、冲突处理、历史和 recovery。
- 默认简单、按需展开，减少导航层级、默认信息密度、技术术语和主操作数量。用户可见文案与术语遵循 `docs/客户端文案体验审查.md`：默认界面说用户任务，风险确认说实际影响，协议标识和诊断证据只进入技术详情。
- 文案调整不得修改 route、action type、DTO 字段、稳定 code、枚举值、资源 kind、协议 ID、持久化 key 或测试 ID；这些标识通过显式 label map 转为界面文案，不得对任意自然语言做全文替换。未知协议值使用中性回退，不直接进入默认用户层。
- 错误主文案必须按稳定 code、状态或 typed result 结合当前操作映射，并说明什么未完成、用户能理解的原因和下一步；未知原始 message、reason、ID 和路径只能作为可展开技术详情。
- Overlay 按用途选择：邻近快速选择使用 Popover，简短表单和业务内容使用 Dialog，需要补充上下文的窄屏内容才使用 Sheet；具体布局和断点遵循当前应用壳与页面契约。
- 最近访问、选中态等导航上下文不得表达在线、运行、Session、任务或未读状态，也不得升级为执行期状态管理。
- 本地图片等 Bandi 自有受管资产只能通过既有窄接口和固定槽位读写；不得保存用户原路径、远程 URL、base64 或 Blob URL，不得借资产入口接受、访问、扫描、修改或删除任意用户目录。
- Host Integration 独立于 Client Launch v3；界面仅可在用户显式操作时提交固定 `clientId + install | reveal`，不得提交路径或复用上下文准备入口。九工具目标映射以联调契约为唯一事实源。
- 未完成真实 smoke 时必须显示“尚未验证”并保持 `not_checked`；只完成官方 UI 跳转等部分链路时显示 `degraded` 及下一步，不得把 reveal、入口已知或方案已保存写成“已安装”“已加载”或“可运行”。
- 品牌 Logo 使用本地官方资产或明确文字回退，不依赖远程 URL，不临摹品牌，不暗示官方背书。
- 页面 body 不得横向滚动，宽内容必须在自身容器内滚动。

## 可访问性与代码质量

- 图标按钮必须有可访问名称；装饰图标使用 `aria-hidden` 或空 `alt`。
- Dialog、Popover、Sheet 必须支持键盘操作、Escape、可见焦点和关闭后的合理焦点恢复。
- 表单必须有可见 label，错误紧邻字段并通过 ARIA 关联；状态不能只依赖颜色表达。
- 遵循 `prefers-reduced-motion`，动画应克制且服务于空间关系。
- TypeScript 保持严格类型；匹配现有命名、注释密度和组件风格。
- 简洁优先，复用公共逻辑，避免无必要的状态库、抽象层、Adapter、Repository 或未来假设。
- 不整文件覆盖并发改动明显的 `pages.tsx`、`router.tsx`、`mock.ts`、`state.tsx` 等文件；以当前工作树为基线增量合并。

## 验证

前端改动完成后按影响范围运行：

```text
pnpm --filter @bandi/web lint
pnpm --filter @bandi/web typecheck
pnpm --filter @bandi/web test
pnpm --filter @bandi/web build
git diff --check
```

界面改动还必须使用真实 Chromium 检查目标页面、亮暗主题、桌面和窄屏、键盘焦点、控制台错误及横向溢出。无法运行的验证必须明确说明。
