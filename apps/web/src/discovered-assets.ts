import type { AssetReferenceDto, Diagnostic, DiscoveryResult, SharedAssetNodeDto } from './contracts'
import type { AssetKind, FullAsset } from './domain'

export type ReferenceSummary = {
  key: string
  agentId: string
  states: AssetReferenceDto['state'][]
  references: AssetReferenceDto[]
}

export type DiscoveredAssetRow = {
  id: string
  label: string
  source: string
  teamId: string
  kind: string
  scope: 'bandi'
  path: string
  writable: boolean
  readOnlyReason?: string
  parseStatus: SharedAssetNodeDto['parseStatus']
  profileVersion: string
  currentRevisionId?: string
  diagnostics: Diagnostic[]
  references: AssetReferenceDto[]
  referenceSummaries: ReferenceSummary[]
  incomingReferences: number
  unresolvedReferences: number
}

export type DiscoveryIssueGroup = {
  key: string
  severity: Diagnostic['severity']
  title: string
  diagnostics: Diagnostic[]
}

export type AssetCategory = 'overview' | 'skills' | 'mcp' | 'rules' | 'sop' | 'other'
export type AssetCategoryCounts = Record<Exclude<AssetCategory, 'overview'>, number>

export type DiscoveredAssetFilters = {
  teamId: string
  category: AssetCategory
  query?: string
  owner?: string
  scope?: string
  health?: string
  agentNames?: ReadonlyMap<string, string>
}

const assetCategories: Exclude<AssetCategory, 'overview'>[] = ['skills', 'mcp', 'rules', 'sop', 'other']

export function assetCategoryForKind(kind: string): Exclude<AssetCategory, 'overview'> {
  if (kind === 'skill' || kind === 'skills') return 'skills'
  if (kind === 'mcp') return 'mcp'
  if (kind === 'rule' || kind === 'rules') return 'rules'
  if (kind === 'sop') return 'sop'
  return 'other'
}

export function countDiscoveredAssetCategories(rows: DiscoveredAssetRow[]): AssetCategoryCounts {
  const counts = Object.fromEntries(assetCategories.map((category) => [category, 0])) as AssetCategoryCounts
  for (const row of rows) counts[assetCategoryForKind(row.kind)] += 1
  return counts
}

export function filterDiscoveredAssets(rows: DiscoveredAssetRow[], filters: DiscoveredAssetFilters): DiscoveredAssetRow[] {
  const query = filters.query?.trim().toLocaleLowerCase() ?? ''
  return rows.filter((row) => {
    if (row.teamId !== filters.teamId) return false
    if (filters.category !== 'overview' && assetCategoryForKind(row.kind) !== filters.category) return false
    const agentIds = row.referenceSummaries.map((item) => item.agentId)
    const agentNames = agentIds.map((id) => filters.agentNames?.get(id) ?? '').join(' ')
    const searchable = `${row.label} ${row.kind} ${agentNames} ${agentIds.join(' ')} ${row.id} ${row.path}`.toLocaleLowerCase()
    return (!query || searchable.includes(query))
      && (!filters.owner || agentIds.includes(filters.owner))
      && (!filters.scope || row.scope === filters.scope)
      && (!filters.health || row.parseStatus === filters.health)
  })
}

const sharedKindMap: Partial<Record<SharedAssetNodeDto['kind'], AssetKind>> = {
  rule: 'Rules', skill: 'Skill', mcp: 'MCP', sop: 'SOP', hook: 'Hook', command: 'Command', output_profile: 'OutputProfile',
}

function sourceLabel(source: SharedAssetNodeDto['source']): string {
  if (source.kind === 'authored') return 'Bandi 新增'
  if (source.kind === 'imported') return `导入自 ${source.fileName}`
  return '旧版共享资产'
}

export function projectSharedAssets(assets: SharedAssetNodeDto[], references: AssetReferenceDto[] = []): FullAsset[] {
  return assets.flatMap((asset) => {
    const kind = sharedKindMap[asset.kind]
    if (!kind) return []
    const incoming = references.filter((reference) => reference.targetAssetId === asset.id && reference.targetTeamId === asset.teamId)
    const seen = new Set<string>()
    return [{
      id: asset.id,
      name: asset.name,
      kind,
      teamId: asset.teamId,
      owner: '共享资产',
      scope: 'Team 共享',
      refs: new Set(incoming.map((item) => item.referrerId)).size,
      path: asset.locator.relativePath ?? asset.locator.displayPath,
      status: asset.parseStatus === 'parsed' ? '已发现' : '解析失败',
      sourceType: '显式共享',
      sharedParseStatus: asset.parseStatus,
      writable: asset.writable,
      summary: sourceLabel(asset.source),
      content: '',
      references: incoming.flatMap((item) => seen.has(item.referrerId) ? [] : (seen.add(item.referrerId), [{ type: 'Agent' as const, id: item.referrerId, label: item.referrerId }])),
      version: asset.currentRevisionId,
    } satisfies FullAsset]
  })
}

export function groupAssetReferences(references: AssetReferenceDto[]): ReferenceSummary[] {
  const groups = new Map<string, ReferenceSummary>()
  for (const reference of references) {
    const current = groups.get(reference.referrerId)
    if (current) {
      current.references.push(reference)
      if (!current.states.includes(reference.state)) current.states.push(reference.state)
    } else {
      groups.set(reference.referrerId, { key: reference.referrerId, agentId: reference.referrerId, states: [reference.state], references: [reference] })
    }
  }
  return [...groups.values()]
}

export function projectDiscoveredAssets(result: DiscoveryResult): DiscoveredAssetRow[] {
  return result.sharedAssets.map((asset) => {
    const incoming = result.references.filter((reference) => reference.targetAssetId === asset.id && reference.targetTeamId === asset.teamId)
    const source = sourceLabel(asset.source)
    return {
      id: asset.id,
      label: asset.name,
      source,
      teamId: asset.teamId,
      kind: asset.kind,
      scope: 'bandi',
      path: asset.locator.relativePath ?? asset.locator.displayPath,
      writable: asset.writable,
      readOnlyReason: asset.writable ? undefined : '此资产当前不可修改。',
      parseStatus: asset.parseStatus,
      profileVersion: 'shared-asset-v2',
      currentRevisionId: asset.currentRevisionId,
      diagnostics: asset.diagnostics,
      references: incoming,
      referenceSummaries: groupAssetReferences(incoming),
      incomingReferences: new Set(incoming.map((reference) => reference.referrerId)).size,
      unresolvedReferences: new Set(incoming.filter((reference) => reference.state !== 'resolved').map((reference) => reference.referrerId)).size,
    }
  })
}

export function groupDiscoveryDiagnostics(diagnostics: Diagnostic[]): DiscoveryIssueGroup[] {
  const groups = new Map<string, DiscoveryIssueGroup>()
  for (const item of diagnostics) {
    const missingPackageFile = item.source && item.code.endsWith('_missing')
    const key = missingPackageFile ? `${item.severity}:${item.source}:package-files-missing` : `${item.severity}:${item.code}:${item.source ?? ''}`
    const current = groups.get(key)
    if (current) current.diagnostics.push(item)
    else groups.set(key, {
      key,
      severity: item.severity,
      title: missingPackageFile ? `${item.source} 缺少配置文件` : item.code === 'shared_asset_root_not_initialized' ? '共享资产池尚未初始化' : item.message,
      diagnostics: [item],
    })
  }
  const priority = { error: 0, warning: 1, info: 2 }
  return [...groups.values()].sort((left, right) => priority[left.severity] - priority[right.severity])
}
