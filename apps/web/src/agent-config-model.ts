import { AGENT_PACKAGE_SCHEMA_VERSION } from './agent-package-schema'
import { isParameterBinding, type ParameterBinding } from './component-parameters'
import { agentFunctionLabels, type AgentFile, type ContextPolicy, type EvidenceKind, type FullAgent } from './domain'

export type AgentIdentityConfig = Pick<
  FullAgent,
  | 'id'
  | 'name'
  | 'status'
  | 'teamId'
  | 'avatarPath'
  | 'functionId'
  | 'mission'
  | 'responsibilities'
  | 'deliverables'
  | 'decisionBoundaries'
  | 'escalationConditions'
  | 'prohibitions'
  | 'completionDefinition'
> & { schemaVersion: typeof AGENT_PACKAGE_SCHEMA_VERSION }

export type AgentContextConfig = {
  policy: ContextPolicy
  contextWindowTokens: number
  outputProfileId?: string
  outputParameterBindings?: ParameterBinding[]
}

export type AgentConfigPayload =
  | { kind: 'identity'; value: AgentIdentityConfig }
  | { kind: 'instructions'; value: string }
  | { kind: 'context'; value: AgentContextConfig }
  | { kind: 'skills'; value: string[] }
  | { kind: 'rules'; value: string[] }
  | { kind: 'mcp'; value: string[] }
  | { kind: 'permissions'; value: FullAgent['permissions'] }
  | { kind: 'sop'; value: string[] }
  | { kind: 'hooks'; value: FullAgent['hookRefs'] }
  | { kind: 'commands'; value: FullAgent['commandRefs'] }

export type SaveAgentConfigInput = AgentConfigPayload & { agentId: string }

const rootScope = { kind: 'agent-root' } as const
const quote = (value: string) => JSON.stringify(value)
const yamlList = (values: string[], indent = '  ') => values.length ? values.map((item) => `${indent}- ${quote(item)}`).join('\n') : `${indent}[]`

export const defaultContextPolicy: ContextPolicy = {
  enabled: true,
  triggerRatio: 0.8,
  targetRatio: 0.5,
  protectRecentTurns: 6,
  protectOpeningTurns: 2,
}

export const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000

const agentUuidPattern = /^(?:agent[-_])?[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

export function normalizeAgentName(value: string): string {
  return value.trim()
}

export function validateAgentName(value: string): string | undefined {
  const name = normalizeAgentName(value)
  const length = Array.from(name).length
  if (!length) return '请输入 Agent 名称。'
  if (length < 2 || length > 40) return '名称应为 2～40 个字符。'
  if (agentUuidPattern.test(name)) return '名称不能使用 UUID 或系统生成的 Agent ID。'
  if (/^\p{N}+$/u.test(name)) return '名称不能全部是数字。'
  if (!/\p{L}/u.test(name)) return '名称至少应包含一个中文或英文字母。'
  return undefined
}

export function validateContextWindowTokens(value: number): string[] {
  return Number.isInteger(value) && value >= 1_000 && value <= 2_000_000
    ? []
    : ['规划上下文窗口必须是 1,000 到 2,000,000 之间的整数。']
}

export function validateContextPolicy(policy: ContextPolicy): string[] {
  const errors: string[] = []
  if (!Number.isFinite(policy.triggerRatio) || policy.triggerRatio < 0.5 || policy.triggerRatio > 0.95) errors.push('触发比例必须在 50% 到 95% 之间。')
  if (!Number.isFinite(policy.targetRatio) || policy.targetRatio < 0.2 || policy.targetRatio > 0.8) errors.push('目标比例必须在 20% 到 80% 之间。')
  if (policy.targetRatio > policy.triggerRatio - 0.1) errors.push('目标比例必须至少比触发比例低 10 个百分点。')
  if (!Number.isInteger(policy.protectRecentTurns) || policy.protectRecentTurns < 0 || policy.protectRecentTurns > 20) errors.push('保护最近轮次必须是 0 到 20 的整数。')
  if (!Number.isInteger(policy.protectOpeningTurns) || policy.protectOpeningTurns < 0 || policy.protectOpeningTurns > 10) errors.push('保护开头轮次必须是 0 到 10 的整数。')
  return errors
}

export function parseAgentContextConfig(content: string): AgentContextConfig | undefined {
  const scalar = (key: string) => content.match(new RegExp(`^\\s*${key}:\\s*(.+?)\\s*$`, 'm'))?.[1]
  const enabled = scalar('enabled')
  const triggerRatio = Number(scalar('triggerRatio'))
  const targetRatio = Number(scalar('targetRatio'))
  const protectRecentTurns = Number(scalar('protectRecentTurns'))
  const protectOpeningTurns = Number(scalar('protectOpeningTurns'))
  const contextWindowSource = scalar('contextWindowTokens')
  const contextWindowTokens = contextWindowSource === undefined ? DEFAULT_CONTEXT_WINDOW_TOKENS : Number(contextWindowSource)
  if (scalar('schemaVersion') !== String(AGENT_PACKAGE_SCHEMA_VERSION) || !['true', 'false'].includes(enabled ?? '')) return undefined
  const policy: ContextPolicy = { enabled: enabled === 'true', triggerRatio, targetRatio, protectRecentTurns, protectOpeningTurns }
  if (validateContextPolicy(policy).length || validateContextWindowTokens(contextWindowTokens).length) return undefined
  const profileSource = scalar('outputProfileId')
  const bindingsSource = scalar('outputParameterBindings')
  if (profileSource === undefined || bindingsSource === undefined) return undefined
  let outputProfileId: string
  let bindings: unknown
  try {
    outputProfileId = JSON.parse(profileSource) as string
    bindings = JSON.parse(bindingsSource)
  } catch {
    return undefined
  }
  if (typeof outputProfileId !== 'string' || !Array.isArray(bindings) || !bindings.every(isParameterBinding)) return undefined
  return { policy, contextWindowTokens, outputProfileId: outputProfileId || undefined, outputParameterBindings: bindings }
}

function parseCanonicalReferenceList(content: string, key: 'rules' | 'skills' | 'mcp' | 'sop'): string[] | undefined {
  const lines = content.split(/\r?\n/)
  if (lines[0] !== `schemaVersion: ${AGENT_PACKAGE_SCHEMA_VERSION}` || lines[1] !== `${key}:`) return undefined
  const body = lines.slice(2).filter((line) => line.length > 0)
  if (body.length === 1 && body[0] === '  []') return []
  const refs: string[] = []
  for (const line of body) {
    const match = line.match(/^ {2}- ("(?:[^"\\]|\\.)*")$/)
    if (!match) return undefined
    let value: unknown
    try {
      value = JSON.parse(match[1])
    } catch {
      return undefined
    }
    if (typeof value !== 'string' || !/^[A-Za-z0-9._-]+$/.test(value) || value === '.' || value === '..' || refs.includes(value)) return undefined
    refs.push(value)
  }
  return refs.length <= 500 ? refs : undefined
}

export const parseAgentRuleRefs = (content: string) => parseCanonicalReferenceList(content, 'rules')
export const parseAgentSkillRefs = (content: string) => parseCanonicalReferenceList(content, 'skills')
export const parseAgentMcpRefs = (content: string) => parseCanonicalReferenceList(content, 'mcp')
export const parseAgentSopRefs = (content: string) => parseCanonicalReferenceList(content, 'sop')

function isSafeComponentBinding(binding: ParameterBinding) {
  if (!isSafePathSegment(binding.parameterId)) return false
  if (binding.type === 'number') return Number.isFinite(binding.value)
  if (binding.type === 'boolean') return true
  if (binding.type === 'string-list') return binding.value.length <= 100 && binding.value.every((item) => item.length <= 4096 && !item.includes('\0'))
  return binding.value.length <= 4096 && !binding.value.includes('\0')
}

function isSafeComponentReferences(references: unknown): references is FullAgent['hookRefs'] {
  if (!Array.isArray(references) || references.length > 500) return false
  const assetIds = new Set<string>()
  for (const reference of references) {
    if (!isRecord(reference) || Object.keys(reference).some((field) => field !== 'assetId' && field !== 'parameterBindings')
      || typeof reference.assetId !== 'string' || !isSafePathSegment(reference.assetId) || assetIds.has(reference.assetId)
      || !Array.isArray(reference.parameterBindings) || reference.parameterBindings.length > 100
      || !reference.parameterBindings.every((binding) => isParameterBinding(binding) && isSafeComponentBinding(binding))) return false
    const parameterIds = new Set<string>()
    for (const binding of reference.parameterBindings) {
      if (!isSafePathSegment(binding.parameterId) || parameterIds.has(binding.parameterId)) return false
      parameterIds.add(binding.parameterId)
    }
    assetIds.add(reference.assetId)
  }
  return true
}

export function parseAgentComponentRefs(content: string, key: 'hooks' | 'commands'): FullAgent['hookRefs'] | undefined {
  const lines = content.split(/\r?\n/)
  if (lines.length !== 2 || lines[0] !== `schemaVersion: ${AGENT_PACKAGE_SCHEMA_VERSION}` || !lines[1].startsWith(`${key}: `)) return undefined
  let references: unknown
  try { references = JSON.parse(lines[1].slice(`${key}: `.length)) } catch { return undefined }
  return isSafeComponentReferences(references) ? references : undefined
}

export function parseAgentPermissions(content: string): FullAgent['permissions'] | undefined {
  const lines = content.split(/\r?\n/)
  const keys = ['files', 'commands', 'network', 'delegation'] as const
  if (lines.length !== 6 || lines[0] !== `schemaVersion: ${AGENT_PACKAGE_SCHEMA_VERSION}` || lines[1] !== 'permissions:') return undefined
  const permissions = {} as FullAgent['permissions']
  for (const [index, key] of keys.entries()) {
    const match = lines[index + 2]?.match(new RegExp(`^ {2}${key}: ("(?:[^"\\\\]|\\\\.)*")$`))
    if (!match) return undefined
    let value: unknown
    try { value = JSON.parse(match[1]) } catch { return undefined }
    if (typeof value !== 'string' || !value || value.length > 256 || value.includes('\0')) return undefined
    permissions[key] = value
  }
  return permissions
}

export function isSafePathSegment(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value) && value !== '.' && value !== '..'
}

export const agentRootConfigPaths = {
  identity: 'agent.yaml',
  instructions: 'instructions.md',
  context: 'config/context.yaml',
  skills: 'config/skills.yaml',
  rules: 'config/rules.yaml',
  mcp: 'config/mcp.yaml',
  permissions: 'config/permissions.yaml',
  sop: 'config/sop.yaml',
  hooks: 'config/hooks.yaml',
  commands: 'config/commands.yaml',
} as const satisfies Record<AgentConfigPayload['kind'], string>

export function getAgentConfigPath(payload: AgentConfigPayload): string {
  return agentRootConfigPaths[payload.kind]
}

export function snapshotAgentConfig(agent: FullAgent, kind: AgentConfigPayload['kind']): AgentConfigPayload {
  switch (kind) {
    case 'identity': return { kind, value: {
      schemaVersion: AGENT_PACKAGE_SCHEMA_VERSION,
      id: agent.id,
      name: agent.name,
      status: agent.status,
      teamId: agent.teamId,
      avatarPath: agent.avatarPath,
      functionId: agent.functionId,
      mission: agent.mission,
      responsibilities: agent.responsibilities,
      deliverables: agent.deliverables,
      decisionBoundaries: agent.decisionBoundaries,
      escalationConditions: agent.escalationConditions,
      prohibitions: agent.prohibitions,
      completionDefinition: agent.completionDefinition,
    } }
    case 'instructions': return { kind, value: agent.instructions }
    case 'context': return { kind, value: { policy: { ...agent.contextPolicy }, contextWindowTokens: agent.contextWindowTokens, outputProfileId: agent.outputProfileId, outputParameterBindings: agent.outputParameterBindings } }
    case 'skills': return { kind, value: agent.skillRefs }
    case 'rules': return { kind, value: agent.ruleRefs }
    case 'mcp': return { kind, value: agent.mcpRefs }
    case 'permissions': return { kind, value: agent.permissions }
    case 'sop': return { kind, value: agent.sopRefs }
    case 'hooks': return { kind, value: agent.hookRefs }
    case 'commands': return { kind, value: agent.commandRefs }
  }
}

export function applyAgentConfig(agent: FullAgent, payload: AgentConfigPayload): FullAgent | undefined {
  switch (payload.kind) {
    case 'identity': return payload.value.id !== agent.id
      || payload.value.schemaVersion !== AGENT_PACKAGE_SCHEMA_VERSION
      || validateAgentName(payload.value.name)
      || (payload.value.functionId !== undefined && !(payload.value.functionId in agentFunctionLabels))
      ? undefined
      : { ...agent, ...payload.value, name: normalizeAgentName(payload.value.name) }
    case 'instructions': return { ...agent, instructions: payload.value }
    case 'context': return validateContextPolicy(payload.value.policy).length || validateContextWindowTokens(payload.value.contextWindowTokens).length ? undefined : { ...agent, contextPolicy: { ...payload.value.policy }, contextWindowTokens: payload.value.contextWindowTokens, outputProfileId: payload.value.outputProfileId, outputParameterBindings: payload.value.outputParameterBindings ?? [] }
    case 'skills': return { ...agent, skillRefs: [...payload.value] }
    case 'rules': return { ...agent, ruleRefs: [...payload.value] }
    case 'mcp': return { ...agent, mcpRefs: [...payload.value] }
    case 'permissions': return { ...agent, permissions: { ...payload.value } }
    case 'sop': return { ...agent, sopRefs: [...payload.value] }
    case 'hooks': return { ...agent, hookRefs: payload.value.map((item) => ({ ...item, parameterBindings: [...item.parameterBindings] })) }
    case 'commands': return { ...agent, commandRefs: payload.value.map((item) => ({ ...item, parameterBindings: [...item.parameterBindings] })) }
  }
}

export function serializeAgentConfig(agent: FullAgent, payload: AgentConfigPayload): string | undefined {
  const applied = applyAgentConfig(agent, payload)
  if (!applied) return undefined
  switch (payload.kind) {
    case 'identity': return [
      `schemaVersion: ${AGENT_PACKAGE_SCHEMA_VERSION}`,
      `id: ${quote(applied.id)}`,
      `name: ${quote(applied.name)}`,
      `status: ${quote(applied.status)}`,
      `teamId: ${quote(applied.teamId)}`,
      ...(applied.avatarPath ? [`avatarPath: ${quote(applied.avatarPath)}`] : []),
      ...(applied.functionId ? [`functionId: ${quote(applied.functionId)}`] : []),
      `mission: ${quote(applied.mission)}`,
      'responsibilities:', yamlList(applied.responsibilities),
      'deliverables:', yamlList(applied.deliverables),
      'decisionBoundaries:', yamlList(applied.decisionBoundaries),
      'escalationConditions:', yamlList(applied.escalationConditions),
      'prohibitions:', yamlList(applied.prohibitions),
      'completionDefinition:', yamlList(applied.completionDefinition),
    ].join('\n')
    case 'instructions': return applied.instructions
    case 'context': return [
      `schemaVersion: ${AGENT_PACKAGE_SCHEMA_VERSION}`,
      'contextPolicy:',
      `  enabled: ${applied.contextPolicy.enabled}`,
      `  triggerRatio: ${applied.contextPolicy.triggerRatio}`,
      `  targetRatio: ${applied.contextPolicy.targetRatio}`,
      `  protectRecentTurns: ${applied.contextPolicy.protectRecentTurns}`,
      `  protectOpeningTurns: ${applied.contextPolicy.protectOpeningTurns}`,
      `contextWindowTokens: ${applied.contextWindowTokens}`,
      `outputProfileId: ${quote(applied.outputProfileId ?? '')}`,
      `outputParameterBindings: ${JSON.stringify(applied.outputParameterBindings)}`,
    ].join('\n')
    case 'skills': return `schemaVersion: ${AGENT_PACKAGE_SCHEMA_VERSION}\nskills:\n${yamlList(applied.skillRefs)}`
    case 'rules': return `schemaVersion: ${AGENT_PACKAGE_SCHEMA_VERSION}\nrules:\n${yamlList(applied.ruleRefs)}`
    case 'mcp': return `schemaVersion: ${AGENT_PACKAGE_SCHEMA_VERSION}\nmcp:\n${yamlList(applied.mcpRefs)}`
    case 'permissions': return [
      `schemaVersion: ${AGENT_PACKAGE_SCHEMA_VERSION}`,
      'permissions:',
      `  files: ${quote(applied.permissions.files)}`,
      `  commands: ${quote(applied.permissions.commands)}`,
      `  network: ${quote(applied.permissions.network)}`,
      `  delegation: ${quote(applied.permissions.delegation)}`,
    ].join('\n')
    case 'sop': return `schemaVersion: ${AGENT_PACKAGE_SCHEMA_VERSION}\nsop:\n${yamlList(applied.sopRefs)}`
    case 'hooks': return `schemaVersion: ${AGENT_PACKAGE_SCHEMA_VERSION}\nhooks: ${JSON.stringify(applied.hookRefs)}`
    case 'commands': return `schemaVersion: ${AGENT_PACKAGE_SCHEMA_VERSION}\ncommands: ${JSON.stringify(applied.commandRefs)}`
  }
}

export function describeAgentConfigFile(payload: AgentConfigPayload, evidence: EvidenceKind = 'memory-only'): AgentFile | undefined {
  const path = getAgentConfigPath(payload)
  if (!path) return undefined
  const descriptions: Record<AgentConfigPayload['kind'], string> = {
    identity: '稳定身份与职责',
    instructions: '主指令',
    context: '上下文与输出格式',
    skills: '使用的 Skills',
    rules: '使用的规则',
    mcp: '使用的 MCP 服务',
    permissions: '权限范围',
    sop: '使用的 SOP',
    hooks: '使用的 Hooks',
    commands: '使用的 Commands',
  }
  return {
    path,
    type: descriptions[payload.kind],
    status: evidence === 'memory-only' ? '页面内存记录' : '预置演示资料',
    evidence,
    scope: rootScope,
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string')

export function isAgentConfigPayload(value: unknown): value is AgentConfigPayload {
  if (!isRecord(value) || typeof value.kind !== 'string' || !('value' in value)) return false
  if (value.kind === 'instructions') return typeof value.value === 'string'
  if (value.kind === 'skills' || value.kind === 'rules' || value.kind === 'mcp' || value.kind === 'sop') return isStringArray(value.value)
  if (value.kind === 'hooks' || value.kind === 'commands') return Array.isArray(value.value)
    && value.value.length <= 500
    && value.value.every((item) => isRecord(item) && Object.keys(item).every((key) => key === 'assetId' || key === 'parameterBindings')
      && typeof item.assetId === 'string' && isSafePathSegment(item.assetId)
      && Array.isArray(item.parameterBindings) && item.parameterBindings.length <= 100
      && item.parameterBindings.every((binding) => isParameterBinding(binding) && isSafeComponentBinding(binding)))
  if (!isRecord(value.value)) return false
  const payloadValue = value.value
  if (value.kind === 'context') return isRecord(payloadValue.policy)
    && typeof payloadValue.contextWindowTokens === 'number'
    && validateContextWindowTokens(payloadValue.contextWindowTokens).length === 0
    && typeof payloadValue.policy.enabled === 'boolean'
    && typeof payloadValue.policy.triggerRatio === 'number'
    && typeof payloadValue.policy.targetRatio === 'number'
    && typeof payloadValue.policy.protectRecentTurns === 'number'
    && typeof payloadValue.policy.protectOpeningTurns === 'number'
    && validateContextPolicy(payloadValue.policy as ContextPolicy).length === 0
    && (payloadValue.outputProfileId === undefined || typeof payloadValue.outputProfileId === 'string')
    && (payloadValue.outputParameterBindings === undefined || (Array.isArray(payloadValue.outputParameterBindings)
      && payloadValue.outputParameterBindings.every(isParameterBinding)))
  if (value.kind === 'permissions') return ['files', 'commands', 'network', 'delegation'].every((key) => typeof payloadValue[key] === 'string')
  if (value.kind === 'identity') {
    return payloadValue.schemaVersion === AGENT_PACKAGE_SCHEMA_VERSION
      && ['id', 'name', 'mission', 'teamId'].every((key) => typeof payloadValue[key] === 'string')
      && (payloadValue.functionId === undefined
        || (typeof payloadValue.functionId === 'string' && payloadValue.functionId in agentFunctionLabels))
      && isSafePathSegment(String(payloadValue.teamId))
      && !validateAgentName(String(payloadValue.name))
      && ['active', 'inactive', 'archived'].includes(String(payloadValue.status))
      && ['responsibilities', 'deliverables', 'decisionBoundaries', 'escalationConditions', 'prohibitions', 'completionDefinition'].every((key) => isStringArray(payloadValue[key]))
      && (payloadValue.avatarPath === undefined || payloadValue.avatarPath === 'avatar.png')
  }
  return false
}

export function configPayloadEquals(left: AgentConfigPayload, right: AgentConfigPayload): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
