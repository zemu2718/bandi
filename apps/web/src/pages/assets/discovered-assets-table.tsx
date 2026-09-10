import { Link } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { EmptyState, MonoPath, StatusBadge } from '../../components/app/page'
import { DiagnosticList } from '../../components/app/error-notice'
import type { DiscoveryIssueGroup, DiscoveredAssetRow } from '../../discovered-assets'
import { assetKindLabel, assetParseStatusLabel } from '../../presentation'

const severityLabels = { error: '错误', warning: '警告', info: '说明' }
const referenceStateLabels: Record<string, string> = {
  resolved: '正常引用', unresolved: '尚无法确认', dangling: '目标不存在', type_mismatch: '类型不匹配', out_of_scope: '超出范围', target_invalid: '目标无效',
}
const agentTabs: Record<string, string> = { skill: 'skills', rule: 'rules', mcp: 'mcp', sop: 'sop' }

export function DiscoveryIssues({ groups, global = false }: { groups: DiscoveryIssueGroup[]; global?: boolean }) {
  const actionable = groups.filter((group) => group.severity !== 'info')
  const information = groups.filter((group) => group.severity === 'info')
  const informationCount = information.reduce((total, group) => total + group.diagnostics.length, 0)
  return <>
    {actionable.length > 0 && <div role={actionable.some((group) => group.severity === 'error') ? 'alert' : 'status'} className="border-b border-warning/30 bg-warning/8 px-5 py-4">
      {global && <><b className="text-sm">资产池问题</b><p className="mt-1 text-xs text-muted-foreground">以下问题可能影响当前共享资产的使用。</p></>}
      <ul className={global ? 'mt-3 space-y-2' : 'space-y-2'}>{actionable.map((group) => <IssueGroup key={group.key} group={group} />)}</ul>
    </div>}
    {informationCount > 0 && <details className="border-b border-border bg-muted/20 px-5 py-3 text-sm"><summary className="cursor-pointer font-medium">其他说明 {informationCount} 项</summary><ul className="mt-3 space-y-2">{information.map((group) => <IssueGroup key={group.key} group={group} />)}</ul></details>}
  </>
}

function IssueGroup({ group }: { group: DiscoveryIssueGroup }) {
  return <li className="text-sm"><div className="flex flex-wrap items-center gap-2"><StatusBadge tone={group.severity === 'error' ? 'danger' : group.severity === 'warning' ? 'warning' : 'neutral'}>{severityLabels[group.severity]}</StatusBadge><b>{group.title}</b>{group.diagnostics.length > 1 && <span className="text-muted-foreground">{group.diagnostics.length} 项</span>}</div><ul className="ml-1 mt-2 space-y-2">{group.diagnostics.map((item, index) => <li key={`${item.code}-${item.path}-${index}`}><DiagnosticList items={[item]} /></li>)}</ul></li>
}

type ListProps = {
  rows: DiscoveredAssetRow[]
  loading: boolean
  filtered: boolean
  hasTeamAssets: boolean
  categoryLabel: string
  agentNames: ReadonlyMap<string, string>
  clear: () => void
  refresh: () => void
  create: () => void
}

export function DiscoveredAssetsList({ rows, loading, filtered, hasTeamAssets, categoryLabel, agentNames, clear, refresh, create }: ListProps) {
  if (loading) return <p role="status" aria-busy="true" className="p-5 text-sm text-muted-foreground">正在扫描共享资产…</p>
  if (!rows.length) {
    if (filtered) return <div className="p-5"><EmptyState title="没有匹配的共享资产" description="调整搜索内容或筛选条件后重试。" action={<Button variant="outline" onClick={clear}>清除筛选</Button>} /></div>
    if (hasTeamAssets) return <div className="p-5"><EmptyState title={`当前 Team 还没有 ${categoryLabel}`} description="切换其他分类，或新增一项共享资产。" action={<Button onClick={create}>新增资产</Button>} /></div>
    return <div className="p-5"><EmptyState title="共享资产池还是空的" description="新增资产，或从本机文件导入受管副本。" action={<Button onClick={create}>新增资产</Button>} /></div>
  }
  return <ul className="divide-y divide-border" aria-label="共享资产列表">{rows.map((asset) => <AssetItem key={asset.id} asset={asset} agentNames={agentNames} refresh={refresh} />)}</ul>
}

function AssetItem({ asset, agentNames, refresh }: { asset: DiscoveredAssetRow; agentNames: ReadonlyMap<string, string>; refresh: () => void }) {
  const problemCount = asset.diagnostics.filter((item) => item.severity !== 'info').length
  const statusTone = asset.parseStatus === 'parsed' ? (problemCount ? 'warning' : 'success') : 'danger'
  return <li><details className="group">
    <summary className="flex min-h-20 cursor-pointer list-none items-center gap-4 px-5 py-4 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-sm font-semibold" aria-hidden="true">{assetKindLabel(asset.kind).slice(0, 1)}</div>
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><b className="break-words text-sm">{asset.label}</b><StatusBadge tone={statusTone}>{assetParseStatusLabel(asset.parseStatus)}</StatusBadge>{problemCount > 0 && <StatusBadge tone="warning">{problemCount} 项需处理</StatusBadge>}{!asset.writable && <StatusBadge tone="neutral">仅供查看</StatusBadge>}</div><p className="mt-1 text-xs text-muted-foreground">{assetKindLabel(asset.kind)} · {asset.source}</p></div>
      <span className="hidden shrink-0 text-sm text-muted-foreground sm:block">{asset.incomingReferences} 个 Agent 使用{asset.unresolvedReferences ? ` · ${asset.unresolvedReferences} 个需处理` : ''}</span>
      <ChevronDown size={18} aria-hidden="true" className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" />
    </summary>
    <div className="border-t border-border bg-muted/15 px-5 py-5"><div className="grid gap-x-8 gap-y-4 lg:grid-cols-2">
      <Detail label="稳定标识"><MonoPath>{asset.id}</MonoPath></Detail><Detail label="受管位置"><MonoPath>{asset.path}</MonoPath></Detail>
      <Detail label="当前版本">{asset.currentRevisionId ?? '尚无版本记录'}</Detail><Detail label="访问状态">{asset.writable ? '可在 Bandi 受管范围内更新' : asset.readOnlyReason}</Detail>
      <Detail label="诊断">{asset.diagnostics.length ? <ul className="space-y-3">{asset.diagnostics.map((item, index) => <li key={`${item.code}-${index}`}><DiagnosticList items={[item]} /></li>)}</ul> : '无'}</Detail>
      <Detail label="使用它的 Agent">{asset.referenceSummaries.length ? <ul className="space-y-2">{asset.referenceSummaries.map((summary) => <li key={summary.key}><Link className="font-medium hover:underline" to={`/agents/${summary.agentId}?tab=${agentTabs[asset.kind] ?? 'overview'}&asset=${asset.id}`}>{agentNames.get(summary.agentId) ?? summary.agentId}</Link><span className="ml-2 text-xs text-muted-foreground">{summary.states.map((state) => referenceStateLabels[state] ?? state).join('、')}</span></li>)}</ul> : '暂无 Agent 引用'}</Detail>
    </div><div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4"><Button asChild variant="outline"><Link to={`/assets/${asset.id}`}>查看并编辑</Link></Button><Button variant="ghost" onClick={refresh}>重新扫描</Button></div></div>
  </details></li>
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) { return <div className="min-w-0"><b className="block text-xs text-muted-foreground">{label}</b><div className="mt-1 min-w-0 break-words text-sm">{children}</div></div> }
