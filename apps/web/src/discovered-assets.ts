import type { AssetReferenceDto, Diagnostic, DiscoveryResult, SharedAssetNodeDto, SourceAssetSummaryDto, SourceContainerDto } from './contracts'
import type { AssetKind, FullAsset } from './domain'

export type ReferenceSummary = {
  key: string
  state: AssetReferenceDto['state']
  targetAssetId: string
  targetKind: AssetReferenceDto['targetKind']
  references: AssetReferenceDto[]
}

export type DiscoveredAssetRow = {
  id: string
  label: string
  source: string
  nodeType: 'config' | 'shared'
  kind: string
  scope: SourceAssetSummaryDto['officialScope']
  path: string
  writable: boolean
  readOnlyReason?: string
  parseStatus: SourceAssetSummaryDto['parseStatus']
  profileVersion: string
  diagnostics: Diagnostic[]
  references: AssetReferenceDto[]
  referenceSummaries: ReferenceSummary[]
  outgoingReferences: number
  incomingReferences: number
  unresolvedReferences: number
}

export type DiscoveryIssueGroup = {
  key: string
  severity: Diagnostic['severity']
  title: string
  diagnostics: Diagnostic[]
}

const pathName = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path
const sourceFromPath = (path: string) => path.match(/^(agt_[^/]+)/)?.[1] ?? '受管 Agent 配置'
const sharedKindMap: Partial<Record<SharedAssetNodeDto['kind'], AssetKind>> = {
  rule: 'Rules', skill: 'Skill', mcp: 'MCP', sop: 'SOP', hook: 'Hook', command: 'Command', output_profile: 'OutputProfile',
}

export function projectSharedAssets(assets: SharedAssetNodeDto[]): FullAsset[] {
  return assets.flatMap((asset) => {
    const kind = sharedKindMap[asset.kind]
    if (!kind) return []
    const path = asset.locator.relativePath ?? asset.locator.displayPath
    return [{
      id: asset.id,
      name: asset.id,
      kind,
      teamId: asset.teamId,
      owner: '共享资产',
      scope: 'Team 共享',
      refs: 0,
      path,
      status: asset.parseStatus === 'parsed' ? '已发现' : '解析失败',
      sourceType: '显式共享',
      summary: pathName(path),
      content: '',
      references: [],
    } satisfies FullAsset]
  })
}

export function groupAssetReferences(references: AssetReferenceDto[]): ReferenceSummary[] {
  const groups = new Map<string, ReferenceSummary>()
  for (const reference of references) {
    const key = `${reference.state}:${reference.targetAssetId}:${reference.targetKind}`
    const current = groups.get(key)
    if (current) {
      current.references.push(reference)
    } else {
      groups.set(key, {
        key,
        state: reference.state,
        targetAssetId: reference.targetAssetId,
        targetKind: reference.targetKind,
        references: [reference],
      })
    }
  }
  return [...groups.values()]
}

export function projectDiscoveredAssets(result: DiscoveryResult): DiscoveredAssetRow[] {
  const containers = new Map(result.containers.map((container) => [container.id, container] as const))
  const configRows = result.assets.map((asset) => {
    const outgoing = result.references.filter((reference) => reference.sourceAssetId === asset.id)
    return projectAsset(asset, containers.get(asset.containerId), result.profileVersion, outgoing)
  })
  const sharedRows: DiscoveredAssetRow[] = result.sharedAssets.map((asset) => {
    const incoming = result.references.filter((reference) => reference.targetAssetId === asset.id)
    const path = asset.locator.relativePath ?? asset.locator.displayPath
    return {
      id: asset.id,
      label: pathName(path),
      source: '共享资产',
      nodeType: 'shared',
      kind: asset.kind,
      scope: 'bandi',
      path,
      writable: false,
      readOnlyReason: '共享资产本体当前仅提供可信只读索引',
      parseStatus: asset.parseStatus,
      profileVersion: 'shared-asset-v1',
      diagnostics: asset.diagnostics,
      references: incoming,
      referenceSummaries: groupAssetReferences(incoming),
      outgoingReferences: 0,
      incomingReferences: incoming.length,
      unresolvedReferences: incoming.filter((reference) => reference.state !== 'resolved').length,
    }
  })
  return [...configRows, ...sharedRows]
}

export function groupDiscoveryDiagnostics(diagnostics: Diagnostic[]): DiscoveryIssueGroup[] {
  const groups = new Map<string, DiscoveryIssueGroup>()
  for (const item of diagnostics) {
    const missingPackageFile = item.source && item.code.endsWith('_missing')
    const key = missingPackageFile
      ? `${item.severity}:${item.source}:package-files-missing`
      : `${item.severity}:${item.code}:${item.source ?? ''}`
    const current = groups.get(key)
    if (current) {
      current.diagnostics.push(item)
      continue
    }
    groups.set(key, {
      key,
      severity: item.severity,
      title: missingPackageFile
        ? `${item.source} 缺少配置文件`
        : item.code === 'shared_asset_root_not_initialized'
          ? '共享资产尚未启用，不影响查看受管 Agent 配置'
          : item.message,
      diagnostics: [item],
    })
  }
  const priority = { error: 0, warning: 1, info: 2 }
  return [...groups.values()].sort((left, right) => priority[left.severity] - priority[right.severity])
}

function projectAsset(
  asset: SourceAssetSummaryDto,
  container: SourceContainerDto | undefined,
  profileVersion: string,
  references: AssetReferenceDto[],
): DiscoveredAssetRow {
  const path = container?.locator.relativePath ?? container?.locator.displayPath ?? '来源容器缺失'
  const missingContainer: Diagnostic[] = container ? [] : [{
    code: 'asset_container_missing',
    severity: 'error',
    message: '资产来源容器不存在',
    field: 'containerId',
    remediation: '重新刷新受管配置索引',
  }]
  return {
    id: asset.id,
    label: pathName(path),
    source: sourceFromPath(path),
    nodeType: 'config',
    kind: asset.kind,
    scope: asset.officialScope,
    path,
    writable: asset.writable && Boolean(container?.writable),
    readOnlyReason: container?.readOnlyReason,
    parseStatus: asset.parseStatus,
    profileVersion,
    diagnostics: [...asset.diagnostics, ...missingContainer],
    references,
    referenceSummaries: groupAssetReferences(references),
    outgoingReferences: references.length,
    incomingReferences: 0,
    unresolvedReferences: references.filter((reference) => reference.state !== 'resolved').length,
  }
}
