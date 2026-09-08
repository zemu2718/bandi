export const AGENT_PACKAGE_SCHEMA_VERSION = 1 as const

export type AgentPackageCompatibility =
  | 'current'
  | 'legacy'
  | 'future'
  | 'unverified'

export type AgentPackageSchema = {
  schemaVersion?: number
  compatibility: AgentPackageCompatibility
}

export type AgentPackageEditability = {
  editable: boolean
  reason?: string
}

export function getAgentPackageCompatibility(
  schemaVersion: number | undefined,
  verified: boolean,
): AgentPackageCompatibility {
  if (!verified) return 'unverified'
  if (schemaVersion === AGENT_PACKAGE_SCHEMA_VERSION) return 'current'
  if (schemaVersion === undefined || schemaVersion < AGENT_PACKAGE_SCHEMA_VERSION) return 'legacy'
  return 'future'
}

export function getAgentPackageEditability(
  schema: AgentPackageSchema,
): AgentPackageEditability {
  switch (schema.compatibility) {
    case 'current':
      return schema.schemaVersion === AGENT_PACKAGE_SCHEMA_VERSION
        ? { editable: true }
        : { editable: false, reason: 'Agent 配置的格式信息不一致。' }
    case 'legacy':
      return { editable: false, reason: '旧版 Agent 配置需升级后才能编辑。' }
    case 'future':
      return { editable: false, reason: '该 Agent 配置来自更高版本，当前版本不会降级保存。' }
    case 'unverified':
      return { editable: false, reason: '历史外部 Agent 引用未读取和验证，仅兼容查看。' }
  }
}

export function isAgentPackageSchema(value: unknown): value is AgentPackageSchema {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<AgentPackageSchema>
  return (candidate.schemaVersion === undefined
      || (Number.isInteger(candidate.schemaVersion) && Number(candidate.schemaVersion) > 0))
    && ['current', 'legacy', 'future', 'unverified'].includes(String(candidate.compatibility))
}
