# Bandi GitHub 竞品与实现参考

> 调研日期：2026-09-09  
> 状态：当前开发参考，非产品能力契约  
> 用途：实现长期 Agent 配置管理能力前，优先复用成熟产品思路，减少重复设计和无效开发  
> 产品边界以[《产品与页面架构》](./产品与页面架构.md)、[《技术架构》](./技术架构.md)和[《本地服务与前端联调契约》](./本地服务与前端联调契约.md)为准；本报告不得覆盖这些契约。

## 1. 核心判断

Bandi 与现有 GitHub 项目的根本差异不是支持更多配置类型，而是管理对象不同：

```text
多数同类工具
一套配置 / 一个 Profile / 一个中央资产库
→ 转换、同步或安装到多个 AI 编程工具

Bandi
Team
→ 多个不同职责的长期 Agent
→ 每个 Agent 各自拥有配置、长期 Memory、权限边界和版本
→ 在用户选择的 AI 编程工具中使用
```

目前未发现一个成熟开源项目完整覆盖 Bandi 的组合：

- Team 下的多个不同长期 Agent；
- 稳定 `agent-id` 与逐 Agent AgentPackage；
- 每个 Agent 独立的 Instructions、Rules、Skills、MCP、Permissions、SOP 和长期 Memory；
- Agent 生命周期与逐 Agent 配置版本；
- baseline、外部变化保护、原子写入、重读验证和 recovery；
- 面向多个 AI 编程工具，但不承担任务执行、调度、聊天和 Session 管理。

因此，竞品应作为**局部实现参考**，不能直接成为 Bandi 的领域模型。

## 2. 使用本报告的规则

开发某项能力前按以下顺序处理：

1. 先确认该能力是否直接服务于“多个不同长期 Agent 各自的配置管理”；不服务则不实现。
2. 在本报告的“功能实现参考矩阵”中查找已有成熟方案，优先复用其交互和数据机制，而不是重新发明。
3. 只借鉴与 Bandi 边界兼容的部分；竞品中的宿主扫描、任意路径、直接覆盖、任务执行和 Session 状态不得带入。
4. 参考外部项目的代码前，必须重新核验当前版本、许可证和对应源码；本报告中的 Stars 与功能只是调研时快照。
5. 复制或改编代码时记录来源、许可证和修改范围；未知许可证仓库只能参考行为，不复制代码。
6. 若成熟方案已经解决当前问题，采用满足需求的最小实现；不要为了追平竞品而扩大首版范围。

## 3. 竞品分层

### 3.1 配置同步与转换工具

这类工具主要解决“一套配置如何服务多个宿主”，不是 Bandi 的直接产品同类，但最适合参考宿主 Adapter、格式转换和能力矩阵。

| 项目 | 调研时 Stars | 主要能力 | 对 Bandi 的参考价值 | 不应照搬 |
| --- | ---: | --- | --- | --- |
| [CC Switch](https://github.com/farion1231/cc-switch) | 131,755 | Provider、MCP、Prompt、Skills、多宿主同步、原子写入、备份 | 九工具能力矩阵、MCP 映射、写入与备份体验 | Provider 代理、宿主配置扫描、运行时故障转移 |
| [Rulesync](https://github.com/dyoshikawa/rulesync) | 1,403 | 从统一源生成 40+ 工具的 rules、MCP、commands、subagents、skills、hooks、permissions | Canonical schema、project/global scope、Adapter 能力声明 | 将全部 Agent 收敛为一套共享配置 |
| [Ruler](https://github.com/intellectronica/ruler) | 2,918 | instructions 单一事实源、嵌套规则、MCP、skills、subagents 分发 | 规则组合、目标选择、生成式 Adapter | 把宿主文件作为 Agent 身份 |
| [AI Config Sync Manager](https://github.com/slash9494/ai-config-sync-manager) | 37 | Claude Code 与 Codex 双向同步、dry-run、Diff、SHA-256 账本、风险分级 | Diff-first 保存、格式语义映射、冲突状态 | 双向扫描宿主目录、通用 apply |
| [Grimoire](https://github.com/grimoire-rs/grimoire) | 10 | Skills、Rules、Agents、MCP、Bundle、OCI、Digest Lock | 可复现配置包、未知字段失败关闭、客户端命名空间 | 为首版引入 OCI Registry 或复杂包发布系统 |

### 3.2 Skills、MCP 与配置资产管理器

这类工具适合参考资产库、来源、安装、更新和 Diff，但资产只是 Bandi AgentPackage 的组成部分。

| 项目 | 调研时 Stars | 主要能力 | 对 Bandi 的参考价值 | 不应照搬 |
| --- | ---: | --- | --- | --- |
| [SkillDock](https://github.com/wanghuan9/skilldock) | 534 | Skills、MCP、Plugin、Agents、Commands、Git 来源、Diff、冲突 | 资产来源展示、managed/unmanaged/conflict 状态、MCP 生命周期 | 扫描真实宿主目录、中央库符号链接到任意位置 |
| [Skills Manager](https://github.com/xingkongliang/skills-manager) | 4,567 | 桌面端与 CLI、中央 Skills 库、Workspace、Preset、Git 同步、快照 | Skills 列表、筛选、批量分配、来源更新与恢复体验 | 把 Skills 管理升级为产品主线 |
| [Vercel skills](https://github.com/vercel-labs/skills) | 30,714 | 多 Agent Skill 安装、自动检测、canonical copy、link/copy | `SKILL.md` 事实标准、目标工具适配、安装清单 | 自动扫描已安装 Agent、未经确认写宿主目录 |
| [ASM](https://github.com/luongnv89/asm) | 915 | Skill 安装、验证、安全检查、重复检测、Token 成本估算 | Skill 导入校验、安全诊断、重复提示 | 首版引入完整 Skill 市场和评估平台 |
| [SkillDeck](https://github.com/crossoverJie/SkillDeck) | 558 | macOS GUI、Skill 编辑、预览、仓库导入、按工具分发 | 编辑/预览/分配的低认知负担界面 | macOS 单平台结构、仅以 Skill 为中心 |
| [Claude Code Tool Manager](https://github.com/tylergraydev/claude-code-tool-manager) | 381 | MCP、Commands、Skills、Sub-Agents、Hooks、Profiles | 配置资产分组与编辑导航 | 仓库未发现 LICENSE；不要复制代码 |

### 3.3 多宿主环境与 Profile 工具

| 项目 | 主要能力 | 可参考 | 不应照搬 |
| --- | --- | --- | --- |
| [Gentle-AI](https://github.com/Gentleman-Programming/gentle-ai) | Persona、Memory、Skills、MCP、Permissions、工作流、同步前快照 | 完整配置组合、安装前快照、恢复入口 | 意见化环境整体部署、把同一 Persona 铺到所有宿主 |
| [AISW](https://github.com/burakdede/aisw) | 多 AI CLI 账户/Profile 隔离、仓库绑定、失败回滚 | Profile 切换的事务和回滚思路 | 凭据管理、账户目录接管 |
| [chezmoi](https://github.com/twpayne/chezmoi) | Source State、diff/apply、模板、Git 多设备同步 | 预览后应用、主机差异、私有 Git 同步 | 通用 dotfiles 路径和模板系统 |

### 3.4 运行时 Agent 平台：仅参考局部 UI

以下产品管理聊天、任务、Session 或 Agent 执行，不是 Bandi 的直接竞品：

- [Cline](https://github.com/cline/cline)
- [Continue](https://github.com/continuedev/continue)
- [Code UX](https://github.com/codeux-ai/codeux)
- [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm)
- [Open WebUI](https://github.com/open-webui/open-webui)
- [Zoo Code](https://github.com/Zoo-Code-Org/Zoo-Code)

可以参考 Agent persona 编辑、配置组合和渐进披露；不得引入任务拆分、参与 Agent 调度、聊天、终端、运行日志、Token 统计、Session、定时执行或验收流程。

[Langfuse](https://github.com/langfuse/langfuse) 不是 Agent 配置管理器，但其 Prompt 版本、标签、差异和回滚体验可用于版本历史设计参考。

## 4. 功能实现参考矩阵

### 4.1 多 Agent 与 AgentPackage

**Bandi 目标**

- Agent 是一等长期实体，而不是一个配置文件或当前 Profile。
- 每个 Agent 以稳定 `agent-id` 持有独立 AgentPackage、长期 Memory、权限和 Revision。
- Team 只表达长期归属，不表达执行团队。

**优先参考**

- Gentle-AI：观察 Persona 与多类配置资产如何组合；只参考配置组合，不采用整体环境部署模型。
- Claude Code Tool Manager：观察 Sub-Agent 配置导航；只参考信息分组。
- Grimoire：参考 bundle manifest 和明确的客户端扩展字段。

**实现约束**

- 不使用文件路径作为 Agent ID。
- 不让一个 Agent 同时属于多个 Team。
- 不把宿主侧 subagent 文件作为 Bandi 的第二事实源。
- 共享资产使用显式引用，不复制成多个可漂移事实。

### 4.2 Rules、Instructions 与跨工具 Adapter

**优先参考**

- Rulesync：canonical source、能力矩阵、project/global scope。
- Ruler：嵌套规则、目标工具选择和生成结果。
- AI Config Sync Manager：Claude/Codex 格式间的语义映射。

**建议实现方式**

1. Bandi AgentPackage 保持 canonical 配置。
2. 每个宿主 Adapter 显式声明支持、降级和不支持的字段。
3. 转换时保留来源和诊断，不静默丢字段。
4. 未知字段默认失败或返回明确 warning，不宣称完整兼容。
5. AI 工具页只检查固定安装候选、打开固定官方 URL，并在用户显式操作后 reveal 固定配置位置；不自动安装。

### 4.3 Skills 管理

**优先参考**

- Vercel skills：`SKILL.md` 兼容、安装目标和 canonical copy 思路。
- Skills Manager：来源、更新、Workspace、快照和冲突体验。
- ASM：frontmatter、结构和安全风险检查。
- SkillDeck：编辑、预览和工具分配界面。

**首版最小实现**

- Agent 选择或显式引用 Skill；
- 展示来源、版本/提交、兼容工具和诊断；
- 导入前验证 `SKILL.md` 与必要元数据；
- 安装到宿主前预览目标和影响；
- 不建设 Skill 市场、评分、推荐算法或自动更新守护进程。

### 4.4 MCP 管理

**优先参考**

- CC Switch：跨宿主 MCP 映射和启停体验。
- SkillDock：导入、编辑、启停、工具发现和生命周期。
- Rulesync：不同宿主的 MCP 能力矩阵。

**实现约束**

- MCP 定义属于 Agent 或显式共享资产，不能因 Team 归属自动获得。
- 凭据和 Token 不进入普通配置、Revision 或 Backup。
- 各宿主字段差异由 Adapter 显式转换，不能依赖字符串替换。
- 配置已保存、入口已安装和 MCP 已真实可用必须是三个不同状态。

### 4.5 配置 Diff、冲突与安全写入

**优先参考**

- AI Config Sync Manager：`status → dry-run → apply`、Diff 和风险等级。
- SkillDock：managed / unmanaged / conflict 状态。
- CC Switch：SQLite 单一数据源、原子写入和自动备份。
- Grimoire：Digest Lock 与未知字段失败关闭。
- chezmoi：source state、diff、apply 的用户心智。

**Bandi 采用**

- 编辑时持有服务签发的 baseline；
- 保存前复核当前内容；
- 外部变化时展示 base/current/proposed；
- 原子写入后重读验证；
- 成功才记录 ConfigRevision 或 MemoryRevision；
- 失败保留 draft 和原事实，进入明确 recovery；
- 不提供通用 force 覆盖。

现有安全写入契约已经比多数竞品更严格，后续优先完善 UI 证据，不另建第二套同步引擎。

### 4.6 版本、来源与恢复

**优先参考**

- Langfuse：版本号、标签、差异和回滚的可读性。
- Skills Manager：Git 来源、上游变化、快照与恢复。
- Grimoire：digest、lock 和可复现版本。
- Gentle-AI：安装或升级前自动快照。

**首版最小实现**

- ConfigRevision 和 MemoryRevision 分开记录；
- 列表展示时间、变更对象、来源和摘要；
- 恢复历史版本仍走当前 baseline 与安全写入链，并生成新 Revision；
- Backup 是独立设置能力，不代替每次保存的版本；
- 不引入发布环境标签、审批流或完整 GitOps。

### 4.7 权限

**优先参考**

- Rulesync：permissions 的跨工具支持矩阵。
- AI Config Sync Manager：权限字段映射与风险分级。
- Gentle-AI：Persona 配置中的权限组合。

**实现约束**

- 权限属于单个长期 Agent；Team 归属不自动授予权限。
- 扩大长期边界必须独立确认。
- Desktop 配置的是长期默认边界，不表示当前 Session 已获批准。
- 当前任务的一次性权限请求仍由外部 AI 编程工具处理。

### 4.8 多设备同步与备份

**优先参考**

- CC Switch：WebDAV 与云目录同步的用户体验。
- Skills Manager：私有 Git remote、冲突保留和快照。
- chezmoi：多机器差异与模板。

**Bandi 当前选择**

- 首版先完成本地手动/自动快照、历史和按范围恢复。
- Git 远程仅允许 Private 仓库。
- 凭据、Token、钥匙串数据和执行过程永不备份。
- Agent 长期 Memory 进入远程备份前单独确认。
- 不为“可能需要”提前实现 WebDAV、模板系统或后台同步守护进程。

### 4.9 AI 工具本机入口

竞品普遍扫描或直接修改 `~/.claude`、`~/.codex`、`~/.gemini` 等真实目录。Bandi 不采用该模式。

可参考各项目公开的固定安装候选、官方安装页和配置位置，但实现必须收敛到 `/tools` 的固定九工具 catalog。

不可参考：

- 任意路径或 URL 输入；
- 扫描 PATH、运行工具或自动扫描用户目录；
- 读取宿主配置正文或用符号链接遍历、接管宿主配置；
- 自动下载或安装工具、Plugin、MCPB、Skill 或其他集成；
- 把检测到文件、打开官方页面或 reveal 写成“已安装完成”“已加载”或“可运行”；
- 通用 Shell、opener、文件或进程 API。

## 5. 需要避免的重复开发

在没有真实需求或现有方案不足证据前，不建设：

- 自有 Skill 文件标准；优先兼容现有 `SKILL.md` 生态；
- 第二套 Rules DSL；先采用 canonical schema + Adapter；
- 通用 dotfiles 引擎；Bandi 只管理自身受管配置；
- OCI 配置市场；首版用本地 AgentPackage 与明确来源即可；
- 后台自动同步守护进程；首版使用用户触发与可检查结果；
- 自建 Git 实现；调用成熟 Git 能力并限制到 Private 仓库；
- 任务编排、聊天、Session 和运行监控；继续交给外部 AI 编程工具；
- 为每个宿主复制一套业务模型；共享 canonical 领域模型，仅 Adapter 不同。

## 6. 开发决策模板

实现新的配置能力时，在计划或 PR 描述中回答：

```text
目标 Agent：该能力属于哪个 Agent，是否会影响其他 Agent？
配置事实：canonical 数据保存在哪里，唯一事实源是什么？
参考实现：本报告中的哪个项目已经解决了相似问题？
采用部分：复用其哪个交互、格式或安全机制？
拒绝部分：哪些竞品做法违反 Bandi 边界？
宿主差异：各 Adapter 的 supported / degraded / unavailable / not_checked 是什么？
写入安全：baseline、Diff、原子写、重读验证、Revision、recovery 如何处理？
最小范围：这次明确不实现什么？
```

如果无法回答“目标 Agent”和“配置事实”，通常说明功能仍以宿主或文件为中心，不应直接进入实现。

## 7. 许可证与证据说明

调研时确认的主要宽松许可证包括：

- MIT：CC Switch、Rulesync、Ruler、SkillDock、Gentle-AI、AI Config Sync Manager、Skills Manager、Vercel skills、ASM、SkillDeck、AISW、chezmoi；
- Apache-2.0：Grimoire、Continue、Cline、Zoo Code。

需特别处理：

- Claude Code Tool Manager：调研时仓库未发现 LICENSE 文件，README 的许可证文字不能替代许可证文件；仅参考行为。
- Open WebUI：使用自定义许可证，不按标准宽松开源许可证处理。
- Langfuse：核心与企业目录许可不同，复制前必须核对目标文件。
- Stars、许可证和功能会变化；采用代码或协议前应再次核验仓库当前状态。

## 8. 重点来源

- [CC Switch](https://github.com/farion1231/cc-switch)
- [Rulesync](https://github.com/dyoshikawa/rulesync)
- [Ruler](https://github.com/intellectronica/ruler)
- [SkillDock](https://github.com/wanghuan9/skilldock)
- [Gentle-AI](https://github.com/Gentleman-Programming/gentle-ai)
- [AI Config Sync Manager](https://github.com/slash9494/ai-config-sync-manager)
- [Grimoire](https://github.com/grimoire-rs/grimoire)
- [Skills Manager](https://github.com/xingkongliang/skills-manager)
- [Vercel skills](https://github.com/vercel-labs/skills)
- [ASM](https://github.com/luongnv89/asm)
- [SkillDeck](https://github.com/crossoverJie/SkillDeck)
- [Claude Code Tool Manager](https://github.com/tylergraydev/claude-code-tool-manager)
- [Langfuse](https://github.com/langfuse/langfuse)
- [chezmoi](https://github.com/twpayne/chezmoi)
