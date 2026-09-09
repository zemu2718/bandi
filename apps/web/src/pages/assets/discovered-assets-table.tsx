import { Link } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { EmptyState, MonoPath, StatusBadge } from '../../components/app/page'
import { DiagnosticList } from '../../components/app/error-notice'
import type { AgentConfigSection } from '../../agent-config-projection'
import type { DiscoveryIssueGroup, DiscoveredAssetRow } from '../../discovered-assets'
import { assetKindLabel, assetParseStatusLabel } from '../../presentation'

const severityLabels = { error: '错误', warning: '警告', info: '说明' }
const referenceStateLabels: Record<string, string> = {
  resolved: '已解析', unresolved: '尚无法确认', dangling: '目标不存在', type_mismatch: '类型不匹配', out_of_scope: '超出范围', target_invalid: '目标无效',
}
const agentSections: Partial<Record<string, AgentConfigSection>> = {
  instructions: 'instructions', context: 'context', skills: 'skills', rules: 'rules', mcp: 'mcp', permissions: 'permissions', sop: 'sop',
}

export function DiscoveryIssues({ groups, global = false }: { groups: DiscoveryIssueGroup[]; global?: boolean }) {
  const actionable = groups.filter((group) => group.severity !== 'info')
  const information = groups.filter((group) => group.severity === 'info')
  const informationCount = information.reduce((total, group) => total + group.diagnostics.length, 0)
  return <>
    {actionable.length > 0 && <div role={actionable.some((group) => group.severity === 'error') ? 'alert' : 'status'} className="border-b border-warning/30 bg-warning/8 px-5 py-4">
      {global && <><b className="text-sm">未归属的问题</b><p className="mt-1 text-xs text-muted-foreground">以下问题可能影响多个 Team，目前无法确定属于哪个 Team。</p></>}
      <ul className={global ? 'mt-3 space-y-2' : 'space-y-2'}>{actionable.map((group) => <IssueGroup key={group.key} group={group} />)}</ul>
    </div>}
    {informationCount > 0 && <details className="border-b border-border bg-muted/20 px-5 py-3 text-sm">
      <summary className="cursor-pointer font-medium">其他说明 {informationCount} 项</summary>
      <ul className="mt-3 space-y-2">{information.map((group) => <IssueGroup key={group.key} group={group} />)}</ul>
    </details>}
  </>
}

function IssueGroup({ group }: { group: DiscoveryIssueGroup }) {
  return <li className="text-sm"><div className="flex flex-wrap items-center gap-2"><StatusBadge tone={group.severity === 'error' ? 'danger' : group.severity === 'warning' ? 'warning' : 'neutral'}>{severityLabels[group.severity]}</StatusBadge><b>{group.title}</b>{group.diagnostics.length > 1 && <span className="text-muted-foreground">{group.diagnostics.length} 项</span>}</div><ul className="ml-1 mt-2 space-y-2">{group.diagnostics.map((item, index) => <DiagnosticItem key={`${item.code}-${item.path}-${index}`} item={item} />)}</ul></li>
}

type ListProps = {
  rows: DiscoveredAssetRow[]
  loading: boolean
  filtered: boolean
  hasAgents: boolean
  hasTeamAssets: boolean
  categoryLabel: string
  teamName: string
  agentNames: ReadonlyMap<string, string>
  clear: () => void
  refresh: () => void
}

export function DiscoveredAssetsList({ rows, loading, filtered, hasAgents, hasTeamAssets, categoryLabel, teamName, agentNames, clear, refresh }: ListProps) {
  if (loading) return <p role="status" aria-busy="true" className="p-5 text-sm text-muted-foreground">正在读取配置资产…</p>
  if (!rows.length) {
    if (filtered) return <div className="p-5"><EmptyState title="没有匹配的配置资产" description="调整搜索内容或筛选条件后重试。" action={<Button variant="outline" onClick={clear}>清除筛选</Button>} /></div>
    if (!hasAgents) return <div className="p-5"><EmptyState title="当前 Team 还没有 Agent" description="创建或导入 Agent 后，可在这里查看其配置资产。" action={<Button asChild><Link to="/agents/new">创建 Agent</Link></Button>} /></div>
    if (hasTeamAssets) return <div className="p-5"><EmptyState title={`当前 Team 还没有 ${categoryLabel} 配置`} description="切换到其他分类，或刷新后重新检查。" /></div>
    return <div className="p-5"><EmptyState title="还没有可查看的配置资产" description="当前 Team 的 Agent 还没有 Bandi 管理的配置。" action={<Button variant="outline" onClick={refresh}>刷新</Button>} /></div>
  }
  return <ul className="divide-y divide-border" aria-label="配置资产列表">{rows.map((asset) => <AssetItem key={asset.id} asset={asset} teamName={teamName} agentName={asset.agentId ? agentNames.get(asset.agentId) : undefined} />)}</ul>
}

function AssetItem({ asset, teamName, agentName }: { asset: DiscoveredAssetRow; teamName: string; agentName?: string }) {
  const problemCount = asset.diagnostics.filter((item) => item.severity !== 'info').length
  const statusTone = asset.parseStatus === 'parsed' ? (problemCount ? 'warning' : 'success') : asset.parseStatus === 'invalid' ? 'danger' : 'warning'
  const owner = asset.nodeType === 'shared' ? `${teamName} · Team 共享` : `${agentName ?? asset.agentId} · Agent 自有`
  const usage = asset.nodeType === 'shared' ? `${asset.incomingReferences} 个使用位置` : `${asset.outgoingReferences} 项共享资产引用`
  return <li><details className="group">
    <summary className="flex min-h-20 cursor-pointer list-none items-center gap-4 px-5 py-4 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-sm font-semibold" aria-hidden="true">{assetKindLabel(asset.kind).slice(0, 1)}</div>
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><b className="break-words text-sm">{asset.label}</b><StatusBadge tone={statusTone}>{assetParseStatusLabel(asset.parseStatus)}</StatusBadge>{problemCount > 0 && <StatusBadge tone="warning">{problemCount} 项需处理</StatusBadge>}{!asset.writable && <StatusBadge tone="neutral">仅供查看</StatusBadge>}</div><p className="mt-1 text-xs text-muted-foreground">{assetKindLabel(asset.kind)} · {owner}</p></div>
      <span className="hidden shrink-0 text-sm text-muted-foreground sm:block">{usage}{asset.unresolvedReferences > 0 ? ` · ${asset.unresolvedReferences} 项需处理` : ''}</span>
      <ChevronDown size={18} aria-hidden="true" className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" />
    </summary>
    <AssetDetails asset={asset} agentName={agentName} />
  </details></li>
}

function AssetDetails({ asset, agentName }: { asset: DiscoveredAssetRow; agentName?: string }) {
  const section = agentSections[asset.kind]
  return <div className="border-t border-border bg-muted/15 px-5 py-5"><div className="grid gap-x-8 gap-y-4 lg:grid-cols-2">
    <Detail label="完整标识"><MonoPath>{asset.id}</MonoPath></Detail>
    <Detail label="完整路径"><MonoPath>{asset.path}</MonoPath></Detail>
    <Detail label="配置版本">{asset.profileVersion}</Detail>
    <Detail label="访问范围">{asset.writable ? 'Bandi 可在受控范围内写入' : <>仅供查看，不会修改此资产{asset.readOnlyReason && <span className="block text-muted-foreground">{asset.readOnlyReason}</span>}</>}</Detail>
    <Detail label="诊断">{asset.diagnostics.length ? <ul className="space-y-3">{asset.diagnostics.map((item, index) => <DiagnosticItem key={`${item.code}-${index}`} item={item} />)}</ul> : '无'}</Detail>
    <Detail label="使用位置">{asset.referenceSummaries.length ? <ul className="space-y-2">{asset.referenceSummaries.map((summary) => <li key={summary.key}><b>{referenceStateLabels[summary.state] ?? summary.state} · {assetKindLabel(summary.targetKind)}</b><span className="block break-words text-muted-foreground">目标：{summary.targetAssetId}{summary.references.length > 1 ? ` · ${summary.references.length} 个使用位置` : ''}</span>{summary.references.length > 1 && <ul className="mt-1 list-disc pl-5 text-muted-foreground">{summary.references.map((item, index) => <li className="break-words" key={`${item.sourceAssetId}-${item.sourcePath}-${index}`}>{item.sourcePath}</li>)}</ul>}</li>)}</ul> : '无'}</Detail>
  </div>{asset.nodeType === 'config' && asset.agentId && section && <div className="mt-5 border-t border-border pt-4"><Button asChild variant="outline"><Link to={`/agents/${asset.agentId}?tab=${section}`} aria-label={`打开 ${agentName ?? asset.agentId} 的${assetKindLabel(asset.kind)}配置`}>打开{agentName ?? asset.agentId}的{assetKindLabel(asset.kind)}配置</Link></Button></div>}</div>
}

function DiagnosticItem({ item }: { item: DiscoveryIssueGroup['diagnostics'][number] }) {
  return <DiagnosticList items={[item]} />
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0"><b className="block text-xs text-muted-foreground">{label}</b><div className="mt-1 min-w-0 break-words text-sm">{children}</div></div>
}
