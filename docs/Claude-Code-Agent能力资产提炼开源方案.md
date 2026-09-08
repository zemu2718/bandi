# Claude Code Agent 能力资产提炼：从个人需求到开源产品方案

> 调研与方案日期：2026-09-04  
> 文档目标：记录需求起点、方案演变、市场现状，并给出一个适合开源、展示个人能力且可逐步落地的产品建议。

## 一、最开始的想法

最初的问题很直接：

> 能否扫描本地 Claude Code 记录过的工作目录，从所有会话、记忆和配置中，提取真正有用的信息，用于另一台电脑的初始化？

这里想迁移的并不是 Claude Code 的全部数据，也不是简单压缩 `~/.claude`。真正希望保留的是长期使用过程中逐渐形成的协作成果，例如：

- 用户偏好、表达习惯和编码原则；
- Claude 被反复纠正后形成的有效工作方式；
- 项目中稳定、非显而易见的架构约束和历史决策；
- 可复用的提示词、检查清单和标准操作流程；
- 已安装或自定义的 Rules、Skills、Commands、Hooks、Agents；
- MCP 的能力声明、安装方式和配置模板；
- 权限边界及安全规则；
- 项目记忆和跨项目通用记忆。

同时，迁移结果不应该包含：

- Token、Cookie、API Key、OAuth 凭据等秘密；
- 缓存、日志、临时 Todo 和无长期价值的执行状态；
- 大量原始聊天全文；
- Claude Code 默认能力和通用编程常识；
- 已过期、相互冲突或只能在旧机器路径下成立的配置；
- 无法说明来源、仅由模型猜测出来的“记忆”。

因此，这个需求的本质不是“备份数据”，而是：

> 把用户与 Claude Code 长期磨合形成的有效上下文和协作能力，从旧机器中提炼出来，形成可审查、可迁移、可复用的资产。

## 二、需求如何演变为一个 Skill

进一步讨论后，目标从“新电脑初始化”演变成了更清晰的能力模型：

> 为指定 Agent 赋予与其职责对应的能力。

例如，一个前端 Agent 需要的不是全部历史信息，而是一组经过选择的资产：

```yaml
agent: frontend-engineer
instructions:
  - user-collaboration-style
  - frontend-engineering-boundary
rules:
  - coding-quality
  - accessibility-baseline
memory:
  - user-preferences
  - target-project-architecture
skills:
  - frontend-master
  - ui-ux-review
mcp:
  - context7
permissions:
  - read-project
  - edit-web-source
  - run-web-tests
hooks:
  - pre-commit-check
```

这说明最终产物不应是一个巨大提示词，而应该是一个可组合的 **Agent 能力资产库**。

### 2.1 能力资产分类

| 资产类型 | 解决的问题 | 典型内容 |
|---|---|---|
| Instructions | Agent 的身份、职责和工作原则 | 角色说明、目标、禁止事项 |
| Rules | 稳定且必须遵守的行为约束 | 编码规范、安全边界、工具选择规则 |
| Memory | Agent 需要长期知道的事实与经验 | 用户偏好、项目背景、历史决策、踩坑记录 |
| Skills | 可重复执行的专业流程 | 审查、发布、调研、设计、迁移流程 |
| MCP | 连接外部系统的实际工具能力 | 文档、数据库、浏览器、设计平台等连接器 |
| Permissions | Agent 可以做什么、不能做什么 | 工具、目录、命令和外部操作权限 |
| Hooks | 在生命周期节点自动执行的约束 | 启动加载、保存校验、提交前检查 |
| References | 支撑工作但不应常驻上下文的资料 | 模板、规范、范例和检查清单 |

### 2.2 为什么适合先做成 Skill

Skill 是这个需求较合适的第一种产品形态，因为它可以完成一条有限而完整的工作流：

```text
发现本地 Claude Code 数据
→ 只读扫描配置与会话
→ 脱敏和去重
→ 提取能力候选
→ 展示来源证据和冲突
→ 用户审核
→ 输出可迁移能力包
```

与一开始就开发桌面应用相比，Skill 具有几个优势：

- 能直接运行在 Claude Code 的真实使用环境中；
- 可以调用本地脚本读取 JSONL 和配置文件；
- 开发范围小，容易形成完整 MVP；
- 用户能看到扫描、提炼、审核和导出的全过程；
- 适合作为开源案例展示提示词工程、Agent 工程、数据治理和安全设计能力；
- 后续如有真实需求，再将核心扫描器和资产模型复用于 CLI 或桌面应用。

但 Skill 只是入口，不应该把所有逻辑都写进提示词。更合理的结构是：

```text
Claude Code Skill
├── SKILL.md              # 工作流、交互和安全约束
├── scripts/              # 确定性的扫描、脱敏、校验和导出
├── schemas/              # 能力候选和 Agent Profile 数据模型
├── references/           # 分类规则和输出规范
└── templates/            # 迁移清单、配置模板和报告模板
```

原则是：模型负责语义判断，脚本负责确定性工作，用户负责最终批准。

## 三、市场调研结果

### 3.1 总体判断

截至 2026 年 9 月，市场上已经存在配置管理器、跨机同步器、会话搜索器、记忆提炼系统以及规则分发工具，但尚未发现一个成熟产品完整覆盖：

```text
多来源资产扫描
→ 会话证据提炼
→ 人工审核与冲突治理
→ Rule / Memory / Skill 等资产版本化
→ 按稳定长期 Agent 组合
→ 脱敏、可回滚的跨机迁移
```

因此，这不是一个完全空白的市场，也不是已有工具可以直接替代的需求。更准确的说法是：

> 单点工具已经较多，但“从历史证据提炼能力资产，再按长期 Agent 装配和迁移”的连接层仍然缺失。

### 3.2 主要候选

#### OpenSunstar：最接近完整桌面管理产品

项目：[alisunstar/OpenSunstar](https://github.com/alisunstar/OpenSunstar)

已覆盖：

- 管理 Claude Code、Codex、Gemini、OpenCode、OpenClaw、Hermes 等客户端；
- 扫描和恢复本地 Session；
- 管理项目级 `CLAUDE.md`、Skills、Hooks、MCP 和 Subagents；
- 项目绑定；
- WebDAV、S3 等跨设备同步。

主要局限：

- 未形成“Session → 候选记忆/规则 → 人工审核 → 能力资产”的完整闭环；
- AI Insight 偏向项目健康、Git 和周报分析，不能等同于能力资产提炼；
- 缺少以稳定 Agent 身份为中心的来源、版本和归属治理。

判断：**最强的部分匹配，也是桌面产品方向最值得研究的竞品。**

#### ccsync：Claude Code 全状态搬家

项目：[aoprisan/ccsync](https://github.com/aoprisan/ccsync)

已覆盖：

- Sessions、项目 Memory、Todos；
- `CLAUDE.md`、Rules、Skills、Agents、Commands；
- Settings 和 MCP；
- 脱敏快照、Manifest、历史、回滚和路径重映射；
- Git 或加密归档迁移；
- Profile 形式的配置组合。

主要局限：

- 迁移已有数据，不负责从会话中提炼知识；
- Profile 不等于具有稳定身份和长期资产归属的 AgentPackage；
- 项目 `.mcp.json`、Hooks 等覆盖仍有限。

判断：**迁移环节的强部分匹配，可重点借鉴 Manifest、脱敏、路径映射和回滚设计。**

#### cass + cass_memory_system：会话搜索与记忆提炼

项目：

- [Dicklesworthstone/coding_agent_session_search](https://github.com/Dicklesworthstone/coding_agent_session_search)
- [Dicklesworthstone/cass_memory_system](https://github.com/Dicklesworthstone/cass_memory_system)

`cass` 为 Claude Code、Codex、Cursor、Gemini CLI、Aider、Cline、OpenCode、Pi 等提供统一会话索引，支持 BM25、可选本地 Embedding、多机采集和导出。

`cass_memory_system` 将 Session 逐步处理为：

```text
Session
→ Diary
→ Playbook Rule / Anti-pattern / Outcome
→ 合并、冲突处理和弃用
```

它的关键价值是提炼结果可以保留历史证据，而不是生成无法追溯的摘要。

主要局限：

- 不管理 Skills、Hooks、MCP 和 AgentPackage；
- 不负责完整跨机配置同步；
- 集成到其他开源产品前需要单独核查许可证。

判断：**最值得参考的“历史证据 → 候选规则/记忆”底层链路。**

#### claude-sync：持续跨设备同步

项目：[tawanorg/claude-sync](https://github.com/tawanorg/claude-sync)

已覆盖：

- Sessions、Auto-memory、History、Plans、Tasks；
- Skills、Agents、Plugins、Rules、Settings、全局 `CLAUDE.md`；
- R2、S3/GCS、WebDAV；
- gzip、age 加密、`${HOME}` 替换和路径映射。

主要局限：

- 不做语义提炼和能力分类；
- 不根据 Agent 职责组合资产；
- 最后写入优先不等于语义冲突解决；
- Hooks、MCP 的独立结构化治理能力有限。

判断：**适合参考持续同步和跨机路径处理，不适合作为提炼引擎。**

#### cc-sessions：从重复提示词发现资产候选

项目：[FlorianBruniaux/cc-sessions](https://github.com/FlorianBruniaux/cc-sessions)

已覆盖：

- 分析 Claude Code 历史会话中的重复 Prompt；
- 通过统计、Jaccard 或 `claude --print` 识别重复模式；
- 建议将重复需求转化为 `CLAUDE.md` Rule、Skill 或 Command。

主要局限：

- 产物以建议为主，没有完整审核和版本生命周期；
- 只面向 Claude Code；
- 不管理 MCP、权限、AgentPackage 和跨机迁移。

判断：**最接近轻量“能力发现 Skill”的项目，可作为 MVP 的直接对照。**

### 3.3 规则和能力分发工具

#### Rulesync / Ruler

- [dyoshikawa/rulesync](https://github.com/dyoshikawa/rulesync)
- [intellectronica/ruler](https://github.com/intellectronica/ruler)

这类工具负责维护统一规则源，再生成 Claude Code、Cursor、Copilot 等客户端所需的配置。它们解决“同一资产如何发布到多个客户端”，但不读取历史会话，也不提炼记忆。

#### Claude Code Plugin

官方文档：[Claude Code Plugins](https://code.claude.com/docs/en/plugins)

Plugin 是目前较接近官方能力分发容器的机制，可以封装 Skills、Commands、Agents、Hooks 和 MCP 配置。但它不负责：

- 从历史会话挖掘能力；
- 审核和治理长期记忆；
- 为不同长期 Agent 维护个性化能力组合。

判断：**适合作为导出目标之一，而不是完整产品本身。**

### 3.4 能力覆盖对比

| 方案 | 会话扫描 | 语义提炼 | Rules/Skills/MCP | 按 Agent 组合 | 跨机迁移 |
|---|---:|---:|---:|---:|---:|
| OpenSunstar | 强 | 弱 | 强 | 部分 | 强 |
| ccsync | 搬运 | 无 | 强 | 部分 | 强 |
| cass + memory system | 强 | 强 | 无 | 弱 | 弱 |
| claude-sync | 搬运 | 无 | 强 | 弱 | 强 |
| cc-sessions | 强 | 建议级 | 部分 | 无 | 无 |
| Rulesync / Ruler | 无 | 无 | 规则为主 | 部分 | 强 |
| Claude Code Plugin | 无 | 无 | 强 | 部分 | 可分发 |

## 四、如果做成开源案例，最佳建议

## 4.1 产品定位

推荐把项目定位为：

> **Claude Code Agent Capability Curator**：从本地 Claude Code 历史和配置中，提炼有来源证据、经过人工审核的能力资产，并为指定 Agent 生成可迁移能力包。

中文可以表达为：

> **Agent 能力策展器**，不是聊天记录备份器，也不是另一套 Agent 执行平台。

这个定位比“Claude Code 配置同步工具”更有辨识度，也能避开与 ccsync、claude-sync 的正面重复。

### 一句话介绍

> Turn your Claude Code history into reviewable, reusable Agent capability packs.

或：

> 从 Claude Code 历史中提炼可审查、可复用、可迁移的 Agent 能力包。

## 4.2 最值得展示的差异点

开源案例不应以“支持最多文件类型”作为核心卖点，而应重点展示以下四点：

### 1. 证据可追溯

每条候选资产都应保存：

- 来源会话和工作目录；
- 必要的脱敏片段或消息定位；
- 为什么被判定为长期有用；
- 建议转换成 Rule、Memory、Skill 还是其他类型；
- 置信度和发现方式。

### 2. 人工审核优先

不要让模型直接改写用户的全局配置。流程应是：

```text
发现候选 → 去重/冲突提示 → 用户接受、修改或拒绝 → 才生成能力包
```

这能体现对记忆污染、提示词注入和长期配置风险的理解。

### 3. 资产类型判断

同一段信息放错位置会降低效果：

- 稳定行为约束放 Rule；
- 长期事实和历史经验放 Memory；
- 可重复流程放 Skill；
- 外部连接能力放 MCP 模板；
- 自动生命周期动作放 Hook；
- 允许或禁止的行为放 Permission。

自动给出分类建议、解释理由，并允许用户改判，是项目最有展示价值的能力之一。

### 4. 按 Agent 装配，而不是全量复制

导出时让用户选择目标 Agent，再根据职责形成最小能力集：

```text
资产库
  ├── 全局通用资产
  ├── 角色资产
  ├── 领域资产
  └── 项目资产
          ↓
     Agent Profile
          ↓
  可安装能力包 / Claude Code Plugin
```

这样能够避免把所有上下文塞给所有 Agent，也更符合最小权限和最小上下文原则。

## 4.3 推荐的 MVP 边界

为了形成一个可信而不是庞杂的开源案例，第一版只做以下内容：

### 输入

- `~/.claude/CLAUDE.md`；
- `~/.claude/rules/`；
- `~/.claude/skills/`；
- `~/.claude/settings*.json` 中经过白名单筛选的结构；
- 各工作目录对应的 `memory/`；
- 各工作目录会话 JSONL；
- 项目级 `CLAUDE.md`、`.claude/rules/` 和 `.claude/skills/`；
- MCP 名称及配置结构，但不读取或导出秘密值。

### 处理

- 本地文件发现；
- 路径归一化；
- 秘密与个人敏感信息脱敏；
- 重复 Prompt 和反复纠正规则发现；
- 现有 Memory、Rule、Skill 清单化；
- 候选分类；
- 来源证据记录；
- 冲突和重复提示；
- 人工审核。

### 输出

- 一份 Markdown 审计报告；
- 一份结构化 `manifest.yaml` 或 `manifest.json`；
- 经审核的 Rules、Memory 和 Skill 候选；
- 一个目标 Agent Profile；
- 一份新电脑安装清单；
- 可选的 Claude Code Plugin 目录。

### 第一版明确不做

- 不同步完整原始 Session；
- 不开发云服务；
- 不做实时多机同步；
- 不保存任何凭据；
- 不自动覆盖目标机器已有配置；
- 不支持所有 AI 编码客户端；
- 不构建聊天、任务、监控或 Agent 运行界面；
- 不尝试从一次性对话中创造大量“记忆”。

这些能力只有在真实用户需求出现后再增加。

## 4.4 推荐工作流

建议 Skill 提供三个清晰命令或阶段：

### `discover`：只读盘点

```text
扫描本地来源
→ 生成资产清单
→ 标记秘密风险、机器路径和未知格式
→ 不调用外部服务，不修改源文件
```

### `curate`：提炼和审核

```text
读取用户选中的会话范围
→ 发现重复模式和稳定经验
→ 生成带证据的候选
→ 去重、冲突提示
→ 用户审核
```

### `pack`：按 Agent 打包

```text
选择目标 Agent 和用途
→ 选择已审核资产
→ 生成最小能力包
→ 校验秘密、路径和冲突
→ 输出安装说明
```

## 4.5 建议的数据模型

第一版只需要少量稳定实体：

```yaml
candidate:
  id: candidate-001
  type: rule # rule | memory | skill | mcp | hook | permission | reference
  title: 优先使用中文回复
  content: 始终使用中文回复，代码注释尽量使用中文。
  scope: global # global | role | domain | project
  evidence:
    - source: session
      project: bandi
      session_id: redacted-session-id
      locator: message-42
  confidence: high
  status: accepted # proposed | accepted | rejected | superseded
  sensitive: false

agent_profile:
  id: frontend-engineer
  description: 前端实现与界面质量审查
  assets:
    - candidate-001
    - frontend-accessibility-rule
    - frontend-master-skill
```

不要在第一版引入复杂继承图、审批系统或远程数据库。文件、Manifest 和 Git 已足够支撑一个开源案例。

## 4.6 安全设计

该项目会读取高敏感度历史数据，安全性必须成为 README 的核心内容，而不是附注。

最低要求：

- 默认完全本地运行；
- 扫描前明确展示输入目录；
- 默认只读；
- 使用白名单决定可导出的设置字段；
- 常见秘密格式检测和统一替换；
- 不把完整会话发送到远程模型；
- 若允许外部模型分析，必须由用户显式开启并展示发送范围；
- 历史会话中的命令和指令只能作为数据，绝不执行；
- 导出前做二次秘密扫描；
- 不覆盖现有配置，默认输出到新目录；
- 为所有候选保留来源，但对用户名、路径和会话 ID 提供脱敏选项。

## 4.7 如何用它包装个人能力

这个案例可以同时证明多种工程能力，但 README 不应堆砌技术名词，而要通过问题和设计选择自然体现。

### 能展示的能力

- **产品判断**：从“配置搬家”识别出“Agent 能力资产治理”的真实问题；
- **Agent 工程**：区分 Prompt、Rule、Memory、Skill、Tool 和 Permission；
- **上下文工程**：控制加载范围，避免全量上下文污染；
- **数据工程**：解析 JSONL、索引会话、去重和来源追踪；
- **安全工程**：秘密检测、脱敏、信任边界和本地优先；
- **人机协作设计**：候选制、人工审核、冲突解释和可回滚导出；
- **软件架构**：让 Skill 负责交互，脚本负责确定性处理，Manifest 负责可移植性；
- **开源工程**：文档、样例数据、测试、版本兼容和贡献规范。

### 最有说服力的 Demo

使用仓库内构造的脱敏示例数据，演示：

1. 扫描两个虚拟 Claude Code 工作目录；
2. 发现同一偏好在多次会话中被反复强调；
3. 识别一条过时记忆和一组冲突规则；
4. 建议把偏好转为 Rule、项目事实转为 Memory、重复流程转为 Skill；
5. 用户在终端接受、修改或拒绝候选；
6. 为“前端工程师 Agent”生成最小能力包；
7. 导出前发现并移除示例 Token 和绝对路径；
8. 在一个干净目录中执行 dry-run 安装和冲突预览。

这比展示“复制了 500 个配置文件”更能体现你的思考和工程能力。

## 4.8 开源仓库建议

### 名称方向

可选择强调“提炼”和“能力包”的名字，例如：

- `agent-capability-curator`
- `claude-capability-kit`
- `context-to-capability`
- `agent-packsmith`

使用 Claude 商标相关名称前，应在 README 中明确项目为社区项目，与 Anthropic 无隶属或背书关系。

### 仓库结构

```text
agent-capability-curator/
├── README.md
├── LICENSE
├── SECURITY.md
├── SKILL.md
├── scripts/
│   ├── discover.py
│   ├── redact.py
│   ├── curate.py
│   └── pack.py
├── schemas/
│   ├── candidate.schema.json
│   └── agent-profile.schema.json
├── templates/
│   ├── report.md
│   └── install-checklist.md
├── examples/
│   ├── synthetic-claude-home/
│   └── expected-output/
└── tests/
```

优先使用 Python 标准库实现文件发现、JSONL 解析、Hash、路径处理和基础脱敏。除非实际效果证明需要，否则第一版不要引入数据库、向量库、Web UI 或云服务。

## 五、推荐实施路线

### 阶段一：开源 MVP

目标：证明核心闭环，而不是覆盖所有 Claude Code 数据。

- 只支持 Claude Code；
- 扫描固定几类配置、Memory 和 JSONL；
- 生成带来源的候选资产；
- 终端人工审核；
- 输出 Agent Profile 和能力包；
- 提供 dry-run，不直接安装。

这是最适合用于个人作品展示的版本。

### 阶段二：可靠迁移

在有用户反馈后增加：

- 安装计划和冲突预览；
- 路径重映射；
- Manifest 校验；
- 增量更新；
- 回滚；
- Claude Code Plugin 导出。

可以借鉴 ccsync 和 claude-sync，但不需要复制完整 Session 同步能力。

### 阶段三：多 Agent 能力资产库

当单 Agent 打包已经稳定后，再增加：

- 多个稳定 Agent Profile；
- 角色、领域和项目作用域；
- 资产引用关系；
- 版本和弃用；
- 一个资产被修改时的影响预览。

### 阶段四：可选产品化

只有在 CLI/Skill 被真实用户持续使用后，再考虑：

- 桌面审核界面；
- 多客户端适配；
- 团队共享资产；
- 加密远程仓库；
- 更完整的本地语义检索。

## 六、最终建议

如果目标是做一个开源案例来展示个人能力，最佳选择不是开发另一款 Claude Code 全量管理器，而是做一个范围清晰的 **Skill + 本地 CLI**：

```text
Claude Code 历史和配置
        ↓
本地只读扫描、脱敏、归一化
        ↓
带来源证据的能力候选
        ↓
用户审核与冲突处理
        ↓
Rule / Memory / Skill 等正式资产
        ↓
指定 Agent 的最小能力包
        ↓
新电脑 dry-run 安装或 Plugin 导出
```

推荐把项目的核心承诺限制为三点：

1. **不迁移垃圾，只提炼长期有效的能力；**
2. **不让模型偷偷改配置，每一项都可追溯、可审核；**
3. **不把所有能力塞给所有 Agent，只生成职责所需的最小能力包。**

这既回应了最初“换电脑后不想重新磨合”的个人需求，又演变成了一个具备明确差异化、真实工程挑战和开源传播价值的项目。

最重要的是保持边界：它负责发现、提炼、审核和打包长期能力资产，不负责聊天、任务执行、人员调度或运行监控。这样既能形成完整案例，也不会落入再次开发一个庞大 Agent 平台的陷阱。

## 参考资料

- [OpenSunstar](https://github.com/alisunstar/OpenSunstar)
- [ccsync](https://github.com/aoprisan/ccsync)
- [coding_agent_session_search](https://github.com/Dicklesworthstone/coding_agent_session_search)
- [cass_memory_system](https://github.com/Dicklesworthstone/cass_memory_system)
- [claude-sync](https://github.com/tawanorg/claude-sync)
- [cc-sessions](https://github.com/FlorianBruniaux/cc-sessions)
- [Rulesync](https://github.com/dyoshikawa/rulesync)
- [Ruler](https://github.com/intellectronica/ruler)
- [sessions](https://github.com/nicknisi/sessions)
- [Claude Code Plugins 官方文档](https://code.claude.com/docs/en/plugins)
