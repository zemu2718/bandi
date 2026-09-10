# Bandi Tauri 后端规则

本文件适用于 `apps/desktop/src-tauri/**`，并与项目根目录 `CLAUDE.md` 共同生效。根规则中的产品、数据和安全边界不可放宽。

## 技术与职责

- 本目录使用 Rust 与 Tauri 2，为 Bandi Desktop 提供最小化的桌面壳和经明确授权的本机能力。
- Desktop 的职责是支持 9 个内置 AI 编程工具（Claude Code、Claude Desktop、Codex、Gemini、Grok、OpenCode、OpenClaw、Hermes、Pi）的 Team、长期 Agent、可选 Team-scoped TaskBrief（界面称“需求池 / 需求”）与配置资产管理，不得演变为任务执行器、内嵌终端、聊天客户端、人员调度器或运行监控台。
- TaskBrief 必须属于一个 Team，只保存目标、背景、约束和期望产出，不持久化 Agent；所有实际任务下达、协作、工具调用、Todo、日志、调度、审批、汇报和验收继续留在用户自己的 AI 编程工具中。
- 不得返回伪造的本机检测、官方页面打开、配置位置 reveal、保存、备份或工具启动成功；检测和启动必须返回冻结的 typed result，不得把请求已提交提升为工具已完成初始化、登录或任务已开始。

## Tauri 与权限

- 新增 command、plugin、capability、Shell、进程或文件系统访问前，先确认其直接服务于配置管理，并采用最小权限、最小参数和最小暴露面。
- capability 只授权明确需要的窗口、命令、路径和操作；不得使用宽泛通配符作为方便性兜底。
- Client Launch v3 只接受固定工具、Adapter、终端枚举及稳定 `teamId / agentId / taskId?`；后端必须从 Bandi 受管数据重取并复核实体关系，构造受控上下文，再按固定命令和参数映射提交启动请求。不得接受调用方提供的 cwd、prompt、TaskBrief 正文、bundle ID、executable、argv、Shell、AppleScript、环境变量、stdin 或脚本；不得读取输出、保存 PID 或管理 Session。
- `/tools` 的宿主能力与 Client Launch v3 相互独立，只暴露工具状态、升级预览与确认、打开官方安装页和 reveal 配置位置等窄命令。请求只允许固定 `toolId`、`requestId`、后端签发的 `previewRef` 和确认值；后端 catalog 固定解析安装候选、版本源、升级动作、官方 URL 和配置相对位置，不接受路径、URL 或通用进程参数。
- macOS 本机检测可从受限 PATH 与 catalog 明确列出的包管理器、版本管理器目录发现固定工具，对命中项执行固定版本参数，并访问固定官方源查询最新版本；不得读取配置正文、任意递归扫描或接受调用方提供的 executable、argv、Shell、环境变量和脚本。单项升级必须先预览并独立确认，只能执行与已复核安装来源匹配的固定动作；不得下载并执行远程安装脚本。reveal 继续只允许既定且存在的配置位置。除这些窄例外外，不得暴露通用 opener、文件管理器、文件 API 或进程 API。
- 删除、覆盖、恢复或扩大权限属于高风险操作，必须在界面中展示真实影响并获得独立确认；删除与恢复仅处理 Bandi 自有数据。
- 普通配置和 Agent 长期 Memory 保存应执行受限目标校验、基线检查、外部变化检测、原子写入、重读验证、Revision 和 recovery；Memory 直接保存，不增加额外流程或状态机。失败时保留原文件并返回可理解的错误，不以备份替代安全写入。

## 数据与安全

- 凭据、Token、Cookie、私钥和钥匙串数据不得写入日志、错误详情、前端状态、普通配置、快照或远程备份。
- 执行过程、终端输出和 Claude Code 会话内容永不备份。
- Git 远程备份仅允许 Private 仓库；Agent 长期 Memory 加入远程备份前必须获得用户单独确认。
- Rust 错误应保留可诊断上下文，但返回前端的信息不得泄露敏感路径、环境变量或秘密值。后端负责返回真实结果、影响、处理阶段和稳定 code，不用面向用户的主文案替代结构化结果；前端结合页面操作提供主文案和下一步，原始 reason 仅作为必要的技术详情。
- 前端传入数据一律视为不可信；校验长度、枚举、标识符、路径和状态前置条件，不依赖 UI 已做校验。
- 旧非零开发数据库不迁移、不双读、不生成兼容投影，只返回恢复出厂并重启的要求；恢复出厂仅清理 Bandi 自有数据。
- 不引入与当前需求无关的后台服务、自动守护进程、遥测、网络请求或持久化层。

## Rust 实现

- 匹配现有 Rust 风格，函数职责单一，优先使用明确类型和小型纯逻辑函数，避免不必要的 trait、宏和抽象层。
- Tauri command 保持薄层：完成输入校验、调用领域逻辑并映射结构化结果，不堆积文件、进程和业务规则。
- 不使用 `unwrap()` 或 `expect()` 处理运行期外部输入及可恢复错误；应用启动处现有不可恢复错误可保持项目惯例。
- 新增依赖前确认标准库或现有依赖无法简洁解决，并说明引入理由。

## 验证

Tauri/Rust 改动完成后按影响范围运行：

```text
cargo fmt --check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
git diff --check
```

新增领域逻辑或 command 时补充针对成功、无权限、非法输入、外部变化和写入失败的测试。涉及真实文件、权限或进程的行为必须在隔离目标上验证；无法运行的验证必须明确说明。
