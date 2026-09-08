import path from 'node:path'
import { sandboxHome } from './paths.js'
export { appDataPath } from './paths.js'

export const teamId = 'team-first'
export const teamName = '首次团队'
export const taskBriefId = 'task-brief-first'
export const externalSentinelDirectory = path.join(sandboxHome, 'external-user-directory')
export const managerAgentId = 'manager'
export const managerAgentName = '主管 Agent'
export const workerAgentId = 'worker'
export const workerAgentName = '执行 Agent'
export const managedAgentsPath = path.join(sandboxHome, '.bandi', 'agents')

export const team = {
  id: teamId,
  name: teamName,
  mission: '以可验证配置支持长期协作。',
  boundary: 'Team 归属不自动授予技术权限。',
  memberAgentIds: [],
  sharedAssetIds: [],
}

type AgentOptions = {
  id: string
  name: string
}

function agentManifest({ id, name }: AgentOptions) {
  return [
    'schemaVersion: 1',
    `id: ${JSON.stringify(id)}`,
    `name: ${JSON.stringify(name)}`,
    'status: "active"',
    `teamId: ${JSON.stringify(teamId)}`,
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

export function managedAgent({ id, name }: AgentOptions) {
  return {
    id,
    name,
    status: 'active',
    packageSchema: { schemaVersion: 1, compatibility: 'current' },
    teamId,
    config: '配置完整',
    updated: '刚刚',
    mission: '维护长期配置并提供验证证据。',
    responsibilities: ['维护配置'],
    deliverables: ['配置与验证证据'],
    decisionBoundaries: ['不扩大权限'],
    escalationConditions: ['权限不足'],
    prohibitions: ['不得写入未授权目录'],
    completionDefinition: ['配置已验证'],
    packagePath: `~/.bandi/agents/agt_${id}/`,
    packageSource: { kind: 'bandi-managed', packageId: `agt_${id}`, strategy: 'managed' },
    instructions: `你是${name}。`,
    skillRefs: [],
    ruleRefs: [],
    mcpRefs: [],
    contextPolicy: { enabled: true, triggerRatio: 0.8, targetRatio: 0.5, protectRecentTurns: 6, protectOpeningTurns: 2 },
    contextWindowTokens: 200000,
    outputParameterBindings: [],
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
    { path: 'config/hooks.yaml', content: 'schemaVersion: 1\nhooks: []' },
    { path: 'config/commands.yaml', content: 'schemaVersion: 1\ncommands: []' },
  ]
}
