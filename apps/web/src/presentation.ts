const defaultDateTimeOptions: Intl.DateTimeFormatOptions = {
  dateStyle: 'medium',
  timeStyle: 'short',
}

export function formatDisplayTimestamp(
  value: string,
  locales: Intl.LocalesArgument = 'zh-CN',
  options: Intl.DateTimeFormatOptions = defaultDateTimeOptions,
): string {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Intl.DateTimeFormat(locales, options).format(timestamp) : value
}

export function formatRelativeExpiry(
  value: string,
  now = Date.now(),
  locales: Intl.LocalesArgument = 'zh-CN',
): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return '有效期未知'
  const milliseconds = timestamp - now
  if (milliseconds <= 0) return '已过期'
  if (milliseconds < 60_000) return '不到 1 分钟后过期'
  const minutes = Math.ceil(milliseconds / 60_000)
  const formatter = new Intl.RelativeTimeFormat(locales, { numeric: 'always' })
  return `约${formatter.format(minutes < 60 ? minutes : Math.ceil(minutes / 60), minutes < 60 ? 'minute' : 'hour')}过期`
}

const domainTerms: Array<[string, string]> = [
  ['ConfigRevision', '配置版本'],
  ['MemoryRevision', '记忆版本'],
  ['Backup', '备份'],
  ['Revision', '版本'],
]

export function localizeDomainText(value: string): string {
  return domainTerms.reduce((text, [term, label]) => text.replaceAll(term, label), value)
}

const memoryScopeLabels: Record<string, string> = {
  agent_long_term: 'Agent 长期记忆',
}

export function memoryScopeLabel(scopeType: string): string {
  return memoryScopeLabels[scopeType] ?? '未知记忆范围'
}

const assetKindLabels: Record<string, string> = {
  instructions: '主指令',
  context: '上下文',
  rules: '规则',
  rule: '规则',
  Rules: '规则',
  skills: '技能',
  skill: '技能',
  Skill: '技能',
  mcp: 'MCP',
  MCP: 'MCP',
  permissions: '权限',
  sop: 'SOP',
  SOP: 'SOP',
  orchestration: '协作策略',
  hooks: '钩子',
  hook: '钩子',
  Hook: '钩子',
  commands: '命令',
  command: '命令',
  Command: '命令',
  output_profile: '输出格式',
  OutputProfile: '输出格式',
  memory: '正式记忆',
  Memory: '正式记忆',
  settings: '设置',
  Settings: '设置',
  Plugin: '插件',
}

export function assetKindLabel(kind: string): string {
  return assetKindLabels[kind] ?? '未知资产类型'
}

const assetParseStatusLabels: Record<string, string> = {
  parsed: '已读取',
  invalid: '配置有误',
  unsupported: '版本不兼容',
  redacted: '已脱敏',
}

export function assetParseStatusLabel(status: string): string {
  return assetParseStatusLabels[status] ?? '未知状态'
}

const assetScopeLabels: Record<string, string> = {
  公司共享: 'Team 共享',
  公司安全边界: 'Team 安全边界',
}

export function assetScopeLabel(scope: string): string {
  return assetScopeLabels[scope] ?? scope
}
