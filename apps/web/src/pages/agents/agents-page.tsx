import { Plus, Search, Upload, X } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '../../components/ui/button'
import { EmptyState, PageHeader, StatusBadge, toneForStatus } from '../../components/app/page'
import { AgentAvatar } from '../../components/agents/agent-avatar'
import { useApp } from '../../state'
import { agentFunctionLabel, agentFunctionLabels, type FullAgent } from '../../domain'
import { getAgentConfigStatus, getConfigurationStatusSummary } from '../../domain-selectors'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { groupDiscoveryDiagnostics } from '../../discovered-assets'
import { DiscoveryIssues } from '../assets/discovered-assets-table'

const filterKeys = ['q', 'function', 'health', 'lifecycle'] as const
const lifecycleLabels: Record<FullAgent['status'], string> = { active: '启用', inactive: '停用', archived: '归档' }

export function getAgentListTarget(agent: FullAgent, status: string = agent.config) {
  if (status === '配置缺口') return `/agents/${agent.id}?tab=rules`
  if (status !== '外部变化') return `/agents/${agent.id}`
  const params = new URLSearchParams({ tab: 'package' })
  const changedFile = agent.files.find((file) => file.status.includes('外部变化'))
  if (changedFile) {
    params.set('path', changedFile.path)
    params.set('view', 'preview')
  }
  return `/agents/${agent.id}?${params}`
}

export function AgentsPage() {
  const { state } = useApp()
  const [params, setParams] = useSearchParams()
  const value = (key: typeof filterKeys[number]) => params.get(key) ?? ''
  const set = (key: typeof filterKeys[number], next: string) => { const copy = new URLSearchParams(params); if (next) copy.set(key, next); else copy.delete(key); setParams(copy) }
  const agentStatus = (agent: FullAgent) => getAgentConfigStatus(state, agent)
  const teamAgents = state.agents.filter(
    (agent) => agent.teamId === state.currentTeamId,
  )
  const assetNames = new Map(state.assets.map((asset) => [asset.id, asset.name]))
  const rows = teamAgents.filter((agent) => {
    const q = value('q').trim().toLocaleLowerCase()
    const references = [...agent.skillRefs, ...agent.mcpRefs]
    const searchable = [
      agent.name,
      agentFunctionLabel(agent.functionId),
      agent.mission,
      ...agent.responsibilities,
      ...references,
      ...references.map((id) => assetNames.get(id) ?? ''),
    ].join(' ').toLocaleLowerCase()
    return (!q || searchable.includes(q))
      && (!value('function') || agent.functionId === value('function'))
      && (!value('health') || agentStatus(agent).level === value('health'))
      && (!value('lifecycle') || agent.status === value('lifecycle'))
  })
  const clear = () => setParams({})
  const createAgentAction = <Button asChild><Link to="/agents/new"><Plus size={16} aria-hidden="true" />添加 Agent</Link></Button>
  const createActions = <DropdownMenu.Root><DropdownMenu.Trigger asChild><Button><Plus size={16} aria-hidden="true" />添加 Agent</Button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content align="end" sideOffset={6} className="z-50 min-w-40 rounded-lg border border-border bg-card p-1 text-sm shadow-lg"><DropdownMenu.Item asChild><Link className="flex min-h-10 items-center gap-2 rounded-md px-3 outline-none data-[highlighted]:bg-muted" to="/agents/new"><Plus size={15} aria-hidden="true" />新建 Agent</Link></DropdownMenu.Item><DropdownMenu.Item asChild><Link className="flex min-h-10 items-center gap-2 rounded-md px-3 outline-none data-[highlighted]:bg-muted" to="/agents/new?mode=import"><Upload size={15} aria-hidden="true" />导入 Agent</Link></DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
  const currentTeam = state.teams.find((team) => team.id === state.currentTeamId)
  const firstUse = getConfigurationStatusSummary(state).phase === 'first-use'
  return <>
    <PageHeader title="Agent" description={`${currentTeam?.name ?? '当前 Team'} · ${teamAgents.length} 个 Agent。按职能查找并管理长期配置。`} action={firstUse ? undefined : createActions} />
    {firstUse ? <EmptyState className="max-w-2xl p-6 text-left" title="当前 Team 还没有 Agent" description="添加一个长期 Agent，或导入已有配置。" action={<div className="flex flex-wrap gap-2">{createAgentAction}<Button variant="outline" asChild><Link to="/agents/new?mode=import"><Upload size={16} aria-hidden="true" />导入已有 Agent</Link></Button></div>} /> : <section className="panel overflow-hidden">
      {state.agentDiagnostics.length > 0 && <DiscoveryIssues groups={groupDiscoveryDiagnostics(state.agentDiagnostics)} />}
      <div className="grid gap-3 border-b border-border p-4 md:grid-cols-2 xl:grid-cols-4">
        <label className="relative md:col-span-2"><span className="mb-1 block text-xs font-medium text-muted-foreground">搜索 Agent</span><Search className="absolute left-3 top-8 text-muted-foreground" size={16} aria-hidden="true" /><input value={value('q')} onChange={(event) => set('q', event.target.value)} className="h-9 w-full pl-9 pr-3" placeholder="名称、职能、职责或能力" /></label>
        <Filter label="职能" value={value('function')} onChange={(next) => set('function', next)} options={Object.entries(agentFunctionLabels)} />
        <Filter label="配置状态" value={value('health')} onChange={(next) => set('health', next)} options={[['healthy', '配置完整'], ['warning', '需要注意'], ['error', '配置缺口']]} />
        <Filter label="使用状态" value={value('lifecycle')} onChange={(next) => set('lifecycle', next)} options={Object.entries(lifecycleLabels)} />
      </div>
      {filterKeys.some((key) => value(key)) && <div className="flex items-center justify-between border-b border-border bg-muted/35 px-4 py-2 text-xs"><span>已应用组合筛选</span><button onClick={clear} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"><X size={13} />清除全部</button></div>}
      {rows.length ? <div className="agent-table-scroll overflow-x-auto" role="region" tabIndex={0} aria-label="Agent 列表，可横向滚动"><table className="w-full min-w-[940px] table-fixed text-left"><thead className="bg-muted/60 text-xs text-muted-foreground"><tr>{['Agent', '职能', '使命', '使用状态', '配置状态', '最近编辑'].map((heading) => <th className="px-5 py-3 font-medium" key={heading}>{heading}</th>)}</tr></thead><tbody className="divide-y divide-border">{rows.map((agent) => <tr key={agent.id} className="group relative hover:bg-muted/40 focus-within:bg-muted/40"><td className="px-5 py-4"><Link className="relative z-10 inline-flex items-center gap-3 rounded-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" to={getAgentListTarget(agent, agentStatus(agent).label)} aria-label={`查看 ${agent.name} Agent 详情${agentStatus(agent).level === 'healthy' ? '' : `，${agentStatus(agent).label}`}`}><AgentAvatar agent={agent} />{agent.name}</Link></td><td className="px-5 py-4 text-sm">{agentFunctionLabel(agent.functionId)}</td><td className="px-5 py-4 text-sm text-muted-foreground">{agent.mission || '未设置'}</td><td className="px-5 py-4"><StatusBadge tone={toneForStatus(agent.status)}>{lifecycleLabels[agent.status]}</StatusBadge></td><td className="px-5 py-4"><StatusBadge tone={agentStatus(agent).level === 'healthy' ? 'success' : agentStatus(agent).level === 'warning' ? 'warning' : 'danger'}>{agentStatus(agent).label}</StatusBadge></td><td className="px-5 py-4 text-muted-foreground">{agent.updated}</td></tr>)}</tbody></table></div> : <div className="p-5"><EmptyState title={state.agentDiagnostics.length && !state.agents.length ? `发现 ${state.agentDiagnostics.length} 项 Agent 配置问题` : '没有匹配的 Agent'} description={state.agentDiagnostics.length && !state.agents.length ? '请按上方说明处理配置文件，然后重新读取。' : '调整搜索内容或筛选条件后重试。'} action={teamAgents.length ? <Button variant="outline" onClick={clear}>清除筛选</Button> : undefined} /></div>}
      <div className="border-t border-border px-5 py-3 text-xs text-muted-foreground">显示 {rows.length} 个，共 {teamAgents.length} 个 Agent</div>
    </section>}
  </>
}

function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: ReadonlyArray<readonly [string, string]> }) {
  return <label className="text-xs text-muted-foreground"><span className="mb-1 block font-medium">{label}</span><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="h-9 w-full px-3 text-sm text-foreground"><option value="">全部{label}</option>{options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
}
