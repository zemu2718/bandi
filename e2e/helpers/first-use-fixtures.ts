import path from 'node:path'
import { sandboxHome } from './paths.js'
export { appDataPath } from './paths.js'

export const teamId = 'team-first'
export const teamName = '首次团队'
export const taskBriefId = 'task-brief-first'
export const externalSentinelDirectory = path.join(sandboxHome, 'external-user-directory')
export const departmentId = 'department-engineering'
export const departmentName = '研发部'
export const managerAgentId = 'manager'
export const managerAgentName = '主管 Agent'
export const workerAgentId = 'worker'
export const workerAgentName = '执行 Agent'
export const managedAgentsPath = path.join(sandboxHome, '.bandi', 'agents')

export const team = {
  id: teamId,
  name: teamName,
  mission: '以可验证配置支持长期协作。',
  boundary: '组织身份不自动授予技术权限。',
  memberAgentIds: [],
  departmentIds: [],
  sharedAssetIds: [],
}

export const department = {
  id: departmentId,
  teamId,
  name: departmentName,
  mission: '维护可靠的软件配置。',
  responsibilities: ['配置实现与验证'],
  boundaries: ['不得扩大权限'],
  delegationDepth: 2,
  memberAgentIds: [managerAgentId, workerAgentId],
  ownedSopIds: [],
}

export const role = {
  id: 'role-engineer',
  teamId,
  departmentId,
  name: '配置工程师',
  status: 'active',
  mission: '交付可验证的配置变更。',
  responsibilities: ['维护 Agent 配置'],
  inputs: ['已确认的配置目标'],
  deliverables: ['配置文件与验证证据'],
  decisionBoundaries: ['不改变产品边界'],
  escalationConditions: ['权限不足'],
  completionDefinition: ['配置保存并通过验证'],
}

type AgentOptions = {
  id: string
  name: string
  managerAgentId?: string
}

function agentManifest({ id, name, managerAgentId }: AgentOptions) {
  return [
    'schemaVersion: 1',
    `id: ${JSON.stringify(id)}`,
    `name: ${JSON.stringify(name)}`,
    `roleId: ${JSON.stringify(role.id)}`,
    'status: "active"',
    `teamId: ${JSON.stringify(teamId)}`,
    `primaryDepartmentId: ${JSON.stringify(departmentId)}`,
    `managerAgentId: ${JSON.stringify(managerAgentId ?? '')}`,
    `mission: ${JSON.stringify('维护长期配置并提供验证证据。')}`,
    'responsibilities:',
    '  - "维护配置"',
    'deliverables:',
    '  - "配置与验证证据"',
    'decisionBoundaries:',
    '  - "不扩大权限"',
    'escalationConditions:',
    '  - "权限不足"',
    'prohibitions:',
    '  - "不得写入未授权目录"',
    'completionDefinition:',
    '  - "配置已验证"',
  ].join('\n')
}

const context = [
  'schemaVersion: 1',
  'contextPolicy:',
  '  enabled: true',
  '  triggerRatio: 0.8',
  '  targetRatio: 0.5',
  '  protectRecentTurns: 6',
  '  protectOpeningTurns: 2',
  'contextWindowTokens: 200000',
  'outputProfileId: ""',
  'outputParameterBindings: []',
].join('\n')

const permissions = [
  'schemaVersion: 1',
  'permissions:',
  '  files: "未授予"',
  '  commands: "未授予"',
  '  network: "未授予"',
  '  delegation: "未授予"',
].join('\n')

const orchestration = 'schemaVersion: 1\norchestration: {"enabled":false,"maxDelegationDepth":0,"allowedAgentIds":[],"allowedRoleIds":[],"allowedDepartmentIds":[],"requireSopMatch":true,"requireServiceGrantForCrossDepartment":true,"escalationConditions":[],"prohibitions":[]}'

export function managedAgent(options: AgentOptions) {
  const { id, name } = options
  return {
    id,
    name,
    role: role.name,
    department: departmentName,
    status: 'active',
    roleId: role.id,
    packageSchema: { schemaVersion: 1, compatibility: 'current' },
    teamId,
    primaryDepartmentId: departmentId,
    managerAgentId: options.managerAgentId,
    config: '配置完整',
    updated: '刚刚',
    mission: '维护长期配置并提供验证证据。',
    responsibilities: ['维护配置'],
    deliverables: ['配置与验证证据'],
    decisionBoundaries: ['不扩大权限'],
    escalationConditions: ['权限不足'],
    prohibitions: ['不得写入未授权目录'],
    completionDefinition: ['配置已验证'],
    serviceGrants: [],
    packagePath: `~/.bandi/agents/agt_${id}/`,
    packageSource: { kind: 'bandi-managed', packageId: `agt_${id}`, strategy: 'managed' },
    instructions: `你是${name}。`,
    skillRefs: [],
    ruleRefs: [],
    mcpRefs: [],
    contextPolicy: { enabled: true, triggerRatio: 0.8, targetRatio: 0.5, protectRecentTurns: 6, protectOpeningTurns: 2 },
    contextWindowTokens: 200000,
    outputParameterBindings: [],
    orchestrationPolicy: {
      enabled: false,
      maxDelegationDepth: 0,
      allowedAgentIds: [],
      allowedRoleIds: [],
      allowedDepartmentIds: [],
      requireSopMatch: true,
      requireServiceGrantForCrossDepartment: true,
      escalationConditions: [],
      prohibitions: [],
    },
    hookRefs: [],
    commandRefs: [],
    permissions: { files: '未授予', commands: '未授予', network: '未授予', delegation: '未授予' },
    sopRefs: [],
    files: [],
  }
}

export function agentFiles(options: AgentOptions) {
  return [
    { path: 'agent.yaml', content: agentManifest(options) },
    { path: 'instructions.md', content: `你是${options.name}。` },
    { path: 'config/context.yaml', content: context },
    { path: 'config/skills.yaml', content: 'schemaVersion: 1\nskills:\n  []' },
    { path: 'config/rules.yaml', content: 'schemaVersion: 1\nrules:\n  []' },
    { path: 'config/mcp.yaml', content: 'schemaVersion: 1\nmcp:\n  []' },
    { path: 'config/permissions.yaml', content: permissions },
    { path: 'config/sop.yaml', content: 'schemaVersion: 1\nsop:\n  []' },
    { path: 'config/orchestration.yaml', content: orchestration },
    { path: 'config/hooks.yaml', content: 'schemaVersion: 1\nhooks: []' },
    { path: 'config/commands.yaml', content: 'schemaVersion: 1\ncommands: []' },
  ]
}
