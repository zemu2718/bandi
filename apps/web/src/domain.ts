import type { Agent, Asset } from './mock'
import type { AgentPackageSchema } from './agent-package-schema'
import type { ParameterBinding, ParameterDefinition } from './component-parameters'
import type { PluginInstallation } from './plugin-installation'

export type AgentLifecycle = 'active' | 'inactive' | 'archived'

export type { TaskBriefDto as TaskBrief, TeamDto as Team } from './contracts'

export type EvidenceKind = 'demo-fixture' | 'memory-only'

export type ContextPolicy = {
  enabled: boolean
  triggerRatio: number
  targetRatio: number
  protectRecentTurns: number
  protectOpeningTurns: number
}

export type ContextPolicyOverride = Partial<ContextPolicy>

export type OutputProfileDefinition = {
  format: 'markdown' | 'json' | 'text'
  language: string
  requiredSections: string[]
  evidenceRequirement: string
  destination: 'response'
  parameters: ParameterDefinition[]
}

export type ComponentReference = {
  assetId: string
  parameterBindings: ParameterBinding[]
}

export type ConfigurationEnvironment = {
  id: string
  name: string
  clientIds: string[]
  evidence: EvidenceKind
}

export type AgentPackageSource =
  | { kind: 'bandi-demo'; strategy: 'create-demo' }
  | { kind: 'bandi-managed'; packageId: string; strategy: 'managed'; identityBaseline?: string }
  | { kind: 'claude-agent-import'; packageId: string; strategy: 'managed-copy'; sourcePath: string; sourceBaselineHash: string; importedAt: string }
  | { kind: 'external-reference'; externalPath: string; strategy: 'reference-only' }

export type AgentFileScope = { kind: 'agent-root' }

export type AgentFile = {
  path: string
  type: string
  status: string
  scope: AgentFileScope
  evidence?: EvidenceKind
  revision?: string
}

export type FullAgent = Omit<Agent, 'status'> & {
  status: AgentLifecycle
  packageSchema: AgentPackageSchema
  teamId: string
  mission: string
  responsibilities: string[]
  deliverables: string[]
  decisionBoundaries: string[]
  escalationConditions: string[]
  prohibitions: string[]
  completionDefinition: string[]
  packagePath: string
  packageSource: AgentPackageSource
  avatarPath?: 'avatar.png'
  instructions: string
  skillRefs: string[]
  ruleRefs: string[]
  mcpRefs: string[]
  contextPolicy: ContextPolicy
  contextWindowTokens: number
  outputProfileId?: string
  outputParameterBindings: ParameterBinding[]
  hookRefs: ComponentReference[]
  commandRefs: ComponentReference[]
  permissions: { files: string; commands: string; network: string }
  sopRefs: string[]
  files: AgentFile[]
}

export type AssetKind = 'Skill' | 'Memory' | 'Rules' | 'MCP' | 'SOP' | 'CLAUDE.md' | 'Settings' | 'Hook' | 'Command' | 'OutputProfile' | 'Plugin'
export type AssetReference = { type: 'Agent'; id: string; label: string }
export type SopStep = { id: string; title: string; objective: string; input: string; output: string; owner: string; dependsOn: string[] }
export type SkillSource =
  | { kind: 'local'; path: string }
  | { kind: 'git'; repository: string; ref: string; subdirectory?: string }
  | { kind: 'marketplace'; provider: string; listingId: string; mockCatalog: true }
export type SkillInstallation = {
  status: 'available' | 'installed' | 'update-available'
  installedVersion?: string
  availableVersion: string
  previousVersions: string[]
}
export type SkillDetails = {
  source: SkillSource
  delivery: { kind: 'standalone' } | { kind: 'plugin'; pluginAssetId: string }
  installation: SkillInstallation
  review: { permissions: string[]; impact: string[]; files: string[] }
}
export type HookDefinition = {
  schemaVersion: 1
  event: string
  purpose: string
  parameters: ParameterDefinition[]
  pluginAssetId?: string
}

export type CommandDefinition = {
  schemaVersion: 1
  commandId: string
  purpose: string
  parameters: ParameterDefinition[]
  pluginAssetId?: string
}

export type PluginDetails = {
  schemaVersion: 1
  componentAssetIds: string[]
}

export type FullAsset = Asset & {
  kind: AssetKind
  teamId?: string
  sourceType: 'Bandi 自有' | '显式共享' | '跨公司授权' | '外部来源'
  summary: string
  content: string
  references: AssetReference[]
  version?: string
  objective?: string
  steps?: SopStep[]
  responsibilities?: string[]
  approvalConditions?: string[]
  escalationConditions?: string[]
  skill?: SkillDetails
  hook?: HookDefinition
  command?: CommandDefinition
  outputProfile?: OutputProfileDefinition
  plugin?: PluginDetails
}

export type ConfigRevision = {
  id: string
  ownerType: 'agent' | 'asset' | 'configuration-environment'
  ownerId: string
  path: string
  parentRevisionId?: string
  restoredFromRevisionId?: string
  content: string
  contentHash: string
  savedAt: string
  summary: string
  evidence: EvidenceKind
  payload?: unknown
}

export type MemoryScopeType = 'Agent 长期'
export type MemorySpace = {
  id: string
  scopeType: MemoryScopeType
  scopeKey: { kind: 'agent_long_term'; agentId: string }
  owner: string
  revision: string
  path: string
  content: string
}

export type BackupScope =
  | { kind: 'all' }
  | { kind: 'team'; teamId: string }
  | { kind: 'agent'; agentId: string }
  | { kind: 'files'; paths: string[] }

export type BackupSnapshot = {
  id: string
  createdAt: string
  kind: '手动演示' | '恢复前演示'
  scope: BackupScope
  includes: string[]
  excludes: string[]
  localPath: string
  deviceName: string
  hash: string
  integrity: 'demo-verified' | 'demo-unverified'
  remoteStatus: 'local-only' | 'private-git-not-connected' | 'private-git-demo-synced' | 'private-git-demo-failed'
  includesFormalMemory: boolean
}

const rootScope: AgentFileScope = { kind: 'agent-root' }
const defaultFiles = (id: string): AgentFile[] => [
  { path: 'agent.yaml', type: '稳定身份与状态', status: '预置演示资料', evidence: 'demo-fixture', scope: rootScope, revision: 'r1' },
  { path: 'soul.md', type: '长期行为原则', status: '预置演示资料', evidence: 'demo-fixture', scope: rootScope },
  { path: 'instructions.md', type: '主 Instructions', status: id === 'zhouce' ? '外部变化（演示）' : '预置演示资料', evidence: 'demo-fixture', scope: rootScope, revision: 'r8' },
  { path: 'config/rules.yaml', type: 'Rule 配置与引用', status: '预置演示资料', evidence: 'demo-fixture', scope: rootScope },
  { path: 'config/skills.yaml', type: 'Skill 配置与引用', status: '预置演示资料', evidence: 'demo-fixture', scope: rootScope },
  { path: 'config/context.yaml', type: '上下文与输出格式', status: '预置演示资料', evidence: 'demo-fixture', scope: rootScope },
  { path: 'memory/long-term.md', type: '长期正式记忆', status: '预置演示资料', evidence: 'demo-fixture', scope: rootScope, revision: 'r18' },
]

const lifecycleByStatus: Record<Agent['status'], AgentLifecycle> = {
  启用: 'active',
  停用: 'inactive',
  归档: 'archived',
}

const baseAgent = (agent: Agent, details: Partial<FullAgent>): FullAgent => ({
  ...agent,
  status: lifecycleByStatus[agent.status],
  packageSchema: { schemaVersion: 1, compatibility: 'current' },
  teamId: 'xinghe',
  mission: '依据长期配置完成可验证的交付。',
  responsibilities: ['维护自身长期配置资产'],
  deliverables: ['配置变更与验证证据'],
  decisionBoundaries: ['不扩大自身权限'],
  escalationConditions: ['权限不足', '目标冲突'],
  prohibitions: ['不得写入未授权目录', '不得泄露凭据'],
  completionDefinition: ['结果可验证'],
  packagePath: `~/.bandi/agents/agt_${agent.id}/`,
  packageSource: { kind: 'bandi-demo', strategy: 'create-demo' },
  instructions: `你是长期 Agent ${agent.name}。请按明确目标完成可验证交付，不得自行扩大权限。`,
  skillRefs: ['skill-review'], ruleRefs: ['rule-common'], mcpRefs: ['mcp-bandi'],
  contextPolicy: { enabled: true, triggerRatio: 0.8, targetRatio: 0.5, protectRecentTurns: 6, protectOpeningTurns: 2 },
  contextWindowTokens: 200_000, outputProfileId: 'output-verifiable-delivery',
  outputParameterBindings: [{ parameterId: 'include-summary', type: 'boolean', value: true }],
  hookRefs: [], commandRefs: [],
  permissions: { files: '仅当前工作区', commands: '构建、测试与版本控制', network: '仅已配置 MCP' },
  sopRefs: ['sop-delivery'], files: defaultFiles(agent.id), ...details,
})

export const initialConfigurationEnvironments: ConfigurationEnvironment[] = [
  {
    id: 'personal',
    name: '个人配置',
    clientIds: ['claude-code'],
    evidence: 'demo-fixture',
  },
  {
    id: 'team-demo',
    name: '团队配置（演示）',
    clientIds: ['claude-code', 'codex'],
    evidence: 'demo-fixture',
  },
]

export const initialTeams: import('./contracts').TeamDto[] = [
  { id: 'xinghe', name: '星河科技', mission: '以清晰的产品判断和可靠的软件交付创造长期价值。', boundary: 'Team 身份与组织关系不自动授予文件、命令、网络或委派权限。', memberAgentIds: ['zhiheng', 'zhouce', 'linxu', 'songyan'], sharedAssetIds: ['rule-common', 'skill-review', 'sop-delivery'] },
  { id: 'studio', name: '独立工作室', mission: '支持独立研究与实验性配置。', boundary: '与星河科技资产完全隔离，跨 Team 共享需单独注册授权。', memberAgentIds: [], sharedAssetIds: [] },
  { id: 'team-personal', name: '个人 Team', mission: '管理个人长期 Agent 与配置资产。', boundary: '个人 Team 不自动授予文件、命令或网络权限。', memberAgentIds: [], sharedAssetIds: [] },
]

export const initialAgents: FullAgent[] = [
  baseAgent({ id: 'zhiheng', name: '知衡', status: '启用', config: '配置完整', updated: '2 小时前' }, { mission: '按明确目标整理信息并汇总结果。' }),
  baseAgent({ id: 'zhouce', name: '周策', status: '启用', config: '外部变化', updated: '8 分钟前' }, { mission: '把已确认目标交付为可验证的软件成果。' }),
  baseAgent({ id: 'linxu', name: '林序', status: '启用', config: '缺少 Rules', updated: '昨天' }, {}),
  baseAgent({ id: 'songyan', name: '宋研', status: '归档', config: '配置完整', updated: '3 天前' }, {}),
]

export const initialAssets: FullAsset[] = [
  { id: 'output-verifiable-delivery', name: '可验证交付', kind: 'OutputProfile', owner: '星河科技', teamId: 'xinghe', scope: '公司共享', refs: 4, path: '~/.bandi/shared/output-profiles/verifiable-delivery.yaml', status: '已保存', sourceType: '显式共享', summary: '统一要求响应包含结果、验证与风险证据。', content: '', references: [], outputProfile: { format: 'markdown', language: 'zh-CN', requiredSections: ['结果', '验证', '风险'], evidenceRequirement: '所有完成声明必须附带最新验证证据。', destination: 'response', parameters: [{ id: 'include-summary', label: '包含摘要', type: 'boolean' }] } },
  { id: 'hook-config-saved', name: '配置保存声明', kind: 'Hook', owner: 'Productivity Plugin', scope: '用户级', refs: 0, path: 'plugin://productivity/hooks/config-saved', status: '演示已安装', sourceType: '外部来源', summary: '声明配置保存后的长期通知用途；Web mock 不执行。', content: '', references: [], hook: { schemaVersion: 1, event: 'config-saved', purpose: '向已接入客户端声明配置变更事件。', parameters: [{ id: 'include-path', label: '包含配置路径', type: 'boolean' }], pluginAssetId: 'plugin-productivity' } },
  { id: 'command-config-audit', name: '配置审计命令', kind: 'Command', owner: 'Productivity Plugin', scope: '用户级', refs: 0, path: 'plugin://productivity/commands/config-audit', status: '演示已安装', sourceType: '外部来源', summary: '包含 Claude Code 命令定义；Web 演示不执行。', content: '', references: [], command: { schemaVersion: 1, commandId: 'config-audit', purpose: '检查长期配置引用和兼容性。', parameters: [{ id: 'scope', label: '检查范围', type: 'enum', options: ['agent', 'project'] }], pluginAssetId: 'plugin-productivity' } },
  { id: 'sop-delivery', name: '软件功能交付', kind: 'SOP', owner: '星河科技', teamId: 'xinghe', scope: 'Team 共享', refs: 7, path: '.claude/sops/software-delivery.md', status: '已保存', sourceType: '显式共享', summary: '从确认目标到附带验证证据的软件交付定义。', content: '', version: 'v4', objective: '把确认的产品目标交付为可验证软件。', references: [{ type: 'Agent', id: 'zhouce', label: '周策' }], steps: [{ id: 'clarify', title: '澄清目标', objective: '确认范围和验收标准', input: '产品目标', output: '确认后的范围', owner: '相关 Agent', dependsOn: [] }, { id: 'design', title: '技术方案', objective: '形成可实施方案', input: '确认后的范围', output: '技术方案', owner: '相关 Agent', dependsOn: ['clarify'] }, { id: 'deliver', title: '实现与验证', objective: '交付带验证证据的软件', input: '技术方案', output: '软件与验证证据', owner: '相关 Agent', dependsOn: ['design'] }], responsibilities: ['相关 Agent 按自身长期配置完成工作'], approvalConditions: ['涉及既定权限边界或生产操作'], escalationConditions: ['目标、范围或验收标准需要重新确认'] },
  { id: 'rule-common', name: '公共安全边界', kind: 'Rules', owner: '星河科技', teamId: 'xinghe', scope: '公司共享', refs: 6, path: '~/.bandi/shared/rules/common.md', status: '已保存', sourceType: '显式共享', summary: '所有 Agent 不可突破的公司安全边界。', content: '禁止泄露凭据；生产发布必须确认；权限只能收紧，不能自行扩大。', references: [{ type: 'Agent', id: 'zhouce', label: '周策' }] },
  { id: 'skill-review', name: '代码审查', kind: 'Skill', owner: '星河科技', teamId: 'xinghe', scope: '公司共享', refs: 4, path: '~/.bandi/shared/skills/code-review', status: '演示已安装', sourceType: '显式共享', summary: '代码正确性与可维护性审查能力。', content: '按正确性、安全性、复杂度和验证证据进行审查。', references: [{ type: 'Agent', id: 'zhouce', label: '周策' }], skill: { source: { kind: 'local', path: '~/.bandi/shared/skills/code-review' }, delivery: { kind: 'standalone' }, installation: { status: 'installed', installedVersion: '1.4.0', availableVersion: '1.4.0', previousVersions: ['1.3.0'] }, review: { permissions: ['读取当前工作区代码'], impact: ['生成审查建议，不执行修改'], files: ['SKILL.md', 'references/checklist.md'] } } },
  { id: 'skill-release', name: '发布检查', kind: 'Skill', owner: '星河科技', teamId: 'xinghe', scope: '公司共享', refs: 1, path: '~/.bandi/shared/skills/release-check', status: '有演示更新', sourceType: '显式共享', summary: '发布前检查配置、测试与变更说明。', content: '预置 Git 来源 Skill。', references: [], skill: { source: { kind: 'git', repository: 'github.com/example/release-check', ref: 'v2.2.0' }, delivery: { kind: 'standalone' }, installation: { status: 'update-available', installedVersion: '2.1.0', availableVersion: '2.2.0', previousVersions: ['2.0.0'] }, review: { permissions: ['读取构建与测试结果'], impact: ['不执行发布'], files: ['SKILL.md'] } } },
  { id: 'skill-docs', name: '文档整理', kind: 'Skill', owner: '预置目录', scope: '可浏览', refs: 0, path: 'marketplace://demo/docs-organizer', status: '可演示安装', sourceType: '外部来源', summary: '整理项目文档结构和摘要。', content: '预置 Marketplace Mock 内容。', references: [], skill: { source: { kind: 'marketplace', provider: 'Bandi 预置目录', listingId: 'docs-organizer', mockCatalog: true }, delivery: { kind: 'standalone' }, installation: { status: 'available', availableVersion: '1.0.0', previousVersions: [] }, review: { permissions: ['读取显式选择的文档'], impact: ['可能生成文档修改建议'], files: ['SKILL.md'] } } },
  { id: 'plugin-productivity', name: 'Productivity Plugin', kind: 'Plugin', owner: '预置目录', scope: '用户级', refs: 0, path: 'marketplace://demo/productivity', status: '演示已安装', sourceType: '外部来源', summary: '提供一组配置辅助组件的预置 Plugin。', content: '', references: [], plugin: { schemaVersion: 1, componentAssetIds: ['skill-planning', 'hook-config-saved', 'command-config-audit'] } },
  { id: 'skill-planning', name: '方案规划', kind: 'Skill', owner: 'Productivity Plugin', scope: '用户级', refs: 0, path: 'plugin://productivity/planning', status: '演示已安装', sourceType: '外部来源', summary: '由预置 Plugin 提供的方案规划 Skill。', content: '', references: [], skill: { source: { kind: 'marketplace', provider: 'Bandi 预置目录', listingId: 'productivity/planning', mockCatalog: true }, delivery: { kind: 'plugin', pluginAssetId: 'plugin-productivity' }, installation: { status: 'installed', installedVersion: '1.1.0', availableVersion: '1.1.0', previousVersions: [] }, review: { permissions: ['读取用户提供的配置上下文'], impact: ['只生成规划建议'], files: ['skills/planning/SKILL.md'] } } },
  { id: 'mcp-bandi', name: 'Bandi MCP', kind: 'MCP', owner: '系统', scope: '用户级', refs: 13, path: '.claude.json', status: '已配置', sourceType: 'Bandi 自有', summary: '用户级 MCP 配置片段；实际位置由 Claude Code 配置根解析，当前 Web mock 未连接。', content: '{ "status": "demo-configured", "credentials": "not-read" }', references: [] },
]

export const initialConfigRevisions: ConfigRevision[] = [
  { id: 'cfg-zhouce-instructions-r8', ownerType: 'agent', ownerId: 'zhouce', path: 'instructions.md', parentRevisionId: 'cfg-zhouce-instructions-r7', content: initialAgents.find((item) => item.id === 'zhouce')?.instructions ?? '', contentHash: 'demo-instructions-r8', savedAt: '8 分钟前', summary: '补充可验证交付要求', evidence: 'demo-fixture' },
  { id: 'cfg-zhouce-instructions-r7', ownerType: 'agent', ownerId: 'zhouce', path: 'instructions.md', parentRevisionId: 'cfg-zhouce-instructions-r6', content: '你是软件开发部主管。负责研发交付，并向直属主管汇报。', contentHash: 'demo-instructions-r7', savedAt: '昨天', summary: '明确研发交付职责', evidence: 'demo-fixture' },
  { id: 'cfg-zhouce-instructions-r6', ownerType: 'agent', ownerId: 'zhouce', path: 'instructions.md', content: '你是软件开发部主管。', contentHash: 'demo-instructions-r6', savedAt: '3 天前', summary: '建立主 Instructions', evidence: 'demo-fixture' },
  { id: 'cfg-sop-delivery-r4', ownerType: 'asset', ownerId: 'sop-delivery', path: '.claude/sops/software-delivery.md', content: JSON.stringify(initialAssets.find((item) => item.id === 'sop-delivery')?.steps ?? []), contentHash: 'demo-sop-delivery-r4', savedAt: '昨天', summary: '补充实现与验证步骤', evidence: 'demo-fixture' },
  { id: 'cfg-rule-common-r3', ownerType: 'asset', ownerId: 'rule-common', path: '~/.bandi/shared/rules/common.md', content: initialAssets.find((item) => item.id === 'rule-common')?.content ?? '', contentHash: 'demo-rule-common-r3', savedAt: '3 天前', summary: '明确权限不可自行扩大', evidence: 'demo-fixture' },
]

export const initialPluginInstallations: PluginInstallation[] = [
  { pluginId: 'plugin-productivity', scope: 'user', status: 'installed', installedVersion: '1.1.0', availableVersion: '1.1.0', previousVersions: ['1.0.0'], compatible: true, componentsComplete: true, evidence: 'demo-fixture' },
]

export const initialMemorySpaces: MemorySpace[] = [
  { id: 'mem-agent-zhouce', scopeType: 'Agent 长期', scopeKey: { kind: 'agent_long_term', agentId: 'zhouce' }, owner: '周策', revision: 'r18', path: '~/.bandi/agents/agt_zhouce/memory/long-term.md', content: '长期记忆内容' },
]


export const initialBackupSnapshots: BackupSnapshot[] = [
  { id: 'snap-demo-001', createdAt: '今天 09:30', kind: '手动演示', scope: { kind: 'team', teamId: 'xinghe' }, includes: ['Agent 配置', '组织关系', '共享资产', '正式记忆'], excludes: ['凭据', 'Token', '钥匙串', '聊天与执行过程'], localPath: '~/.bandi/backups/snap-demo-001', deviceName: '当前设备（演示）', hash: 'demo-a84f2c1', integrity: 'demo-verified', remoteStatus: 'private-git-not-connected', includesFormalMemory: true },
]
