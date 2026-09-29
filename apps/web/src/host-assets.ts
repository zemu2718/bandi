import type { Diagnostic, HostAssetCatalogEntryDto, HostAssetSummaryDto, HostAssetToolScanDto } from './contracts'
import type { BuiltInClientId } from './client-adapters'

export type HostAssetFilters = {
  query?: string
  kind?: string
  toolId?: string
  status?: string
}

export function filterHostAssets(rows: HostAssetSummaryDto[], filters: HostAssetFilters): HostAssetSummaryDto[] {
  const query = filters.query?.trim().toLocaleLowerCase() ?? ''
  return rows.filter((row) => {
    const searchable = `${row.name} ${row.hostInstanceId} ${row.toolId} ${row.kind} ${row.relativeLocation} ${row.packageKey}`.toLocaleLowerCase()
    return (!query || searchable.includes(query))
      && (!filters.kind || row.kind === filters.kind)
      && (!filters.toolId || row.toolId === filters.toolId)
      && (!filters.status || row.parseStatus === filters.status)
  })
}

export function catalogByTool(entries: HostAssetCatalogEntryDto[]): Map<BuiltInClientId, HostAssetCatalogEntryDto> {
  return new Map(entries.map((entry) => [entry.toolId, entry]))
}

export function scanDiagnostics(tools: HostAssetToolScanDto[], diagnostics: Diagnostic[]): Diagnostic[] {
  return [...diagnostics, ...tools.flatMap((tool) => tool.diagnostics)]
}
