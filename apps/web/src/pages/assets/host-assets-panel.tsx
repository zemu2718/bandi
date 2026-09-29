import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Eye, RefreshCw, Search } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { EmptyState, FieldRow, MonoPath, StatusBadge } from '../../components/app/page'
import { DiagnosticList, ErrorNotice, errorFromCause, type UserFacingError } from '../../components/app/error-notice'
import { AiClientIcon } from '../../components/ai-clients'
import { listHostAssetCatalog, loadHostAssetDetail, scanHostAssets } from '../../desktop-bridge'
import type { Diagnostic, HostAssetCatalogEntryDto, HostAssetDetailDto, HostAssetSummaryDto, HostAssetToolScanDto } from '../../contracts'
import { catalogByTool, filterHostAssets, scanDiagnostics } from '../../host-assets'
import type { BuiltInClientId } from '../../client-adapters'
import type { AiClient } from '../../mock'
import { HostAssetImportDialog } from './host-asset-management'

const supportLabels = { supported: '完整支持', degraded: '有限支持', unsupported: '不支持' }
const kindLabels = { instructions: 'Instructions', skill: 'Skill' }

export function HostAssetsPanel({ teamId, clients, embedded = false, refreshBandiAssets = async () => {} }: { teamId: string; clients: AiClient[]; embedded?: boolean; refreshBandiAssets?: () => Promise<void> }) {
  const [catalog, setCatalog] = useState<HostAssetCatalogEntryDto[]>([])
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [tools, setTools] = useState<HostAssetToolScanDto[]>([])
  const [assets, setAssets] = useState<HostAssetSummaryDto[]>([])
  const [scanNotes, setScanNotes] = useState<Diagnostic[]>([])
  const [generation, setGeneration] = useState<string>()
  const [selectedTools, setSelectedTools] = useState<BuiltInClientId[]>([])
  const [checkState, setCheckState] = useState<'not_checked' | 'checking' | 'ready' | 'failed'>('not_checked')
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('')
  const [toolId, setToolId] = useState('')
  const [error, setError] = useState<UserFacingError>()
  const [detail, setDetail] = useState<HostAssetDetailDto>()
  const [detailLoading, setDetailLoading] = useState(false)
  const [importAsset, setImportAsset] = useState<HostAssetSummaryDto>()
  const detailRequest = useRef(0)
  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true); setError(undefined)
    try {
      const { tools: next } = await listHostAssetCatalog()
      setCatalog(next)
      setSelectedTools(next.filter((item) => item.capabilities.canScan).map((item) => item.toolId))
    } catch (cause) {
      setCatalog([])
      setError(errorFromCause(cause, '无法读取外部工具能力', '尚未扫描任何外部目录。请重试。'))
    } finally { setCatalogLoading(false) }
  }, [])
  useEffect(() => { void loadCatalog() }, [loadCatalog])
  const clearScan = () => {
    detailRequest.current += 1
    setTools([]); setAssets([]); setScanNotes([]); setGeneration(undefined)
    setDetail(undefined); setDetailLoading(false); setImportAsset(undefined)
  }
  const scan = async () => {
    if (!selectedTools.length) return
    clearScan(); setCheckState('checking'); setError(undefined)
    try {
      const result = await scanHostAssets({ requestId: crypto.randomUUID(), toolIds: selectedTools })
      setTools(result.tools); setAssets(result.assets); setScanNotes(result.diagnostics); setGeneration(result.scanGeneration); setCheckState(result.tools.length > 0 && result.tools.every((item) => item.checkState === 'failed') ? 'failed' : 'ready')
    } catch (cause) { clearScan(); setCheckState('failed'); setError(errorFromCause(cause, '无法扫描外部资产', '未修改外部文件。请检查本地服务后重试。')) }
  }
  const changeSelectedTool = (id: BuiltInClientId, checked: boolean) => {
    setSelectedTools((items) => checked ? [...items, id] : items.filter((item) => item !== id))
    setToolId(''); setDetail(undefined); setImportAsset(undefined)
  }
  const capabilities = catalogByTool(catalog)
  const rows = useMemo(() => filterHostAssets(assets, { query, kind, toolId }), [assets, kind, query, toolId])
  const diagnostics = scanDiagnostics(tools, scanNotes)
  const openDetail = async (asset: HostAssetSummaryDto) => {
    if (!generation) return
    const request = ++detailRequest.current
    setDetail(undefined); setDetailLoading(true); setError(undefined)
    try {
      const next = await loadHostAssetDetail({ requestId: crypto.randomUUID(), hostInstanceId: asset.hostInstanceId, scanGeneration: generation })
      if (request === detailRequest.current) setDetail(next)
    } catch (cause) {
      if (request === detailRequest.current) setError(errorFromCause(cause, '无法读取外部资产详情', '扫描结果可能已过期，请重新扫描。'))
    } finally { if (request === detailRequest.current) setDetailLoading(false) }
  }
  const afterImport = async () => { await refreshBandiAssets(); await scan() }
  const panelClassName = embedded ? '' : 'panel'
  const toolSelector = <div className="grid gap-2 text-left sm:grid-cols-2">{catalog.map((entry) => { const client = clients.find((item) => item.id === entry.toolId); const selected = selectedTools.includes(entry.toolId); return <label key={entry.toolId} className={`flex items-center gap-3 rounded-lg border p-3 text-sm focus-within:ring-2 focus-within:ring-ring ${selected ? 'border-foreground bg-muted/35' : 'border-border'}`}><input type="checkbox" disabled={!entry.capabilities.canScan || checkState === 'checking'} checked={selected} onChange={(event) => changeSelectedTool(entry.toolId, event.target.checked)} className="sr-only" />{selected && <span className="grid size-5 shrink-0 place-items-center rounded-full bg-foreground text-background" aria-hidden="true"><Check size={13} strokeWidth={2.5} /></span>}{!selected && <span className="size-5 shrink-0 rounded-full border border-border" aria-hidden="true" />}{client && <AiClientIcon client={client} size={30} tile />}<span className="min-w-0"><b>{client?.name ?? entry.toolId}</b><small className="mt-1 block text-muted-foreground">{supportLabels[entry.supportLevel]}{!entry.capabilities.canScan ? ' · 不提供扫描' : ''}</small></span></label> })}</div>
  if (checkState === 'not_checked') return <section className={`${panelClassName} p-6`}>{error && <ErrorNotice error={error} className="mb-4" />}<EmptyState title={catalogLoading ? '正在读取外部工具能力…' : '尚未扫描外部工具'} description="只有你明确选择工具并开始扫描后，Bandi 才会读取固定 catalog 声明的配置资产位置。不会读取凭据、会话、日志或任意路径。" action={catalogLoading ? undefined : catalog.length ? <div className="mx-auto max-w-xl">{toolSelector}<Button className="mt-4" disabled={!selectedTools.length} onClick={scan}>扫描所选工具</Button></div> : <Button variant="outline" onClick={loadCatalog}>重试读取工具能力</Button>} /></section>
  return <section className={`${panelClassName} overflow-hidden`}><div className="border-b border-border px-5 py-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">外部工具资产</h2><p className="mt-1 text-sm text-muted-foreground">只读展示本次扫描结果；仅可解析的 Skill 可导入为 Bandi 独立副本。</p></div><Button variant="outline" disabled={checkState === 'checking' || !selectedTools.length} aria-busy={checkState === 'checking'} onClick={scan}><RefreshCw size={15} aria-hidden="true" />{checkState === 'checking' ? '正在扫描' : '重新扫描'}</Button></div><details className="mt-4 text-sm"><summary className="cursor-pointer font-medium">调整扫描工具（已选 {selectedTools.length} 项）</summary><div className="mt-3">{toolSelector}</div></details></div>
    {error && <ErrorNotice error={error} className="rounded-none border-x-0 border-t-0" />}{diagnostics.length > 0 && <details className="border-b border-border bg-warning/5 px-5 py-3 text-sm"><summary className="cursor-pointer font-medium">部分工具有 {diagnostics.length} 项说明</summary><DiagnosticList items={diagnostics} className="mt-3" /></details>}
    <div className="grid gap-3 border-b border-border p-4 md:grid-cols-[1fr_180px_180px]"><label className="relative"><span className="sr-only">搜索外部资产</span><Search size={16} aria-hidden="true" className="absolute left-3 top-2.5 text-muted-foreground" /><input className="h-9 w-full pl-9 pr-3" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、工具或相对位置…" /></label><select aria-label="资产类型" value={kind} onChange={(event) => setKind(event.target.value)} className="h-9 px-3"><option value="">全部类型</option><option value="instructions">Instructions</option><option value="skill">Skill</option></select><select aria-label="外部工具" value={toolId} onChange={(event) => setToolId(event.target.value)} className="h-9 px-3"><option value="">全部工具</option>{tools.map((tool) => <option key={tool.toolId} value={tool.toolId}>{clients.find((client) => client.id === tool.toolId)?.name ?? tool.toolId}</option>)}</select></div>
    {checkState === 'checking' ? <p role="status" aria-busy="true" className="p-5 text-sm text-muted-foreground">正在扫描所选工具…</p> : !assets.length ? <div className="p-5"><EmptyState title={checkState === 'failed' ? '扫描未完成' : '没有发现外部资产'} description={checkState === 'failed' ? '请查看诊断并重新扫描。' : '所选工具的声明位置中没有可管理资产。'} /></div> : !rows.length ? <div className="p-5"><EmptyState title="没有匹配的外部资产" description="调整搜索或筛选条件后重试。" action={<Button variant="outline" onClick={() => { setQuery(''); setKind(''); setToolId('') }}>清除筛选</Button>} /></div> : <ul className="divide-y divide-border">{rows.map((asset) => { const capability = capabilities.get(asset.toolId)?.capabilities; const client = clients.find((item) => item.id === asset.toolId); const readable = asset.parseStatus === 'parsed' && capability?.canReadEntrypoint; const importable = asset.kind === 'skill' && asset.parseStatus === 'parsed' && capability?.canImportToBandi; return <li key={asset.hostInstanceId} className="flex flex-wrap items-center gap-3 px-5 py-4">{client && <AiClientIcon client={client} size={30} tile />}<div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><b>{asset.name}</b><StatusBadge tone={asset.parseStatus === 'parsed' ? 'success' : 'danger'}>{asset.parseStatus === 'parsed' ? '可读取' : '需处理'}</StatusBadge></div><p className="mt-1 text-xs text-muted-foreground">{client?.name ?? asset.toolId} · {kindLabels[asset.kind]} · {asset.relativeLocation}</p></div><div className="flex flex-wrap gap-2">{readable && <Button variant="outline" disabled={detailLoading} onClick={() => openDetail(asset)}><Eye size={15} aria-hidden="true" />查看资产</Button>}{importable && <Button variant="outline" onClick={() => setImportAsset(asset)}>导入到 Bandi</Button>}</div></li> })}</ul>}
    {(detailLoading || detail) && <aside className="border-t border-border bg-muted/15 p-5" aria-busy={detailLoading}>{detailLoading ? <p role="status" className="text-sm text-muted-foreground">正在加载资产详情…</p> : detail && <><div className="flex items-center justify-between gap-3"><b>{detail.name}</b><Button variant="ghost" size="sm" onClick={() => setDetail(undefined)}>关闭详情</Button></div><div className="mt-4 grid gap-x-6 md:grid-cols-2"><FieldRow label="入口文件"><MonoPath>{detail.package.entrypoint}</MonoPath></FieldRow><FieldRow label="文件与大小">{detail.package.fileCount} 个文件 · {detail.package.totalBytes} 字节</FieldRow><FieldRow label="包指纹"><MonoPath>{detail.package.packageFingerprint}</MonoPath></FieldRow><FieldRow label="来源">{detail.toolId} · {detail.relativeLocation}</FieldRow></div>{detail.entrypointContent !== undefined && <pre className="mt-4 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-4 text-sm">{detail.entrypointContent}</pre>}<details className="mt-4 text-sm"><summary className="cursor-pointer font-medium">文件清单 {detail.files.length}</summary><ul className="mt-2 space-y-1 font-mono text-xs text-muted-foreground">{detail.files.map((file) => <li key={file.relativePath}>{file.relativePath} · {file.size} B</li>)}</ul></details></>}</aside>}
    <HostAssetImportDialog asset={importAsset} scanGeneration={generation} teamId={teamId} open={Boolean(importAsset)} onOpenChange={(open) => { if (!open) setImportAsset(undefined) }} onSaved={afterImport} />
  </section>
}
