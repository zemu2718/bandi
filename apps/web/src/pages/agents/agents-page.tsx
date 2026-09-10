import { ArchiveRestore, Filter as FilterIcon, MoreHorizontal, Plus, Search, Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Button } from '../../components/ui/button'
import { AppDialog } from '../../components/ui/dialog'
import { EmptyState, PageHeader, StatusBadge } from '../../components/app/page'
import { AgentAvatar } from '../../components/agents/agent-avatar'
import { AiClientIcon } from '../../components/ai-clients'
import { useApp } from '../../state'
import { agentFunctionLabel, agentFunctionLabels, type FullAgent } from '../../domain'
import { getAgentConfigStatus, getConfigurationStatusSummary } from '../../domain-selectors'
import { groupDiscoveryDiagnostics } from '../../discovered-assets'
import { DiscoveryIssues } from '../assets/discovered-assets-table'
import { lifecycleSuccessMessage, saveAgentLifecycle } from './agent-lifecycle'

const filterKeys = ['q', 'function', 'health', 'lifecycle'] as const
const lifecycleLabels: Record<FullAgent['status'], string> = { active: '已启用', inactive: '已停用', archived: '已归档' }
const healthLabels = { healthy: '配置正常', warning: '外部有修改', error: '需要处理' } as const
const SEARCH_THRESHOLD = 6
const FILTER_THRESHOLD = 16
const menuContentClass = 'z-50 min-w-52 rounded-lg border border-border bg-card p-1 text-sm shadow-lg'
const menuItemClass = 'flex min-h-10 w-full cursor-default items-center gap-2 rounded-md px-3 text-left outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-muted'

export function getAgentListTarget(agent: FullAgent, status: string = agent.config) {
  if (status === '配置缺口') return `/agents/${agent.id}`
  if (status !== '外部变化') return `/agents/${agent.id}`
  return getAgentConfigIssueTarget(agent, 'warning', status) ?? `/agents/${agent.id}`
}

export function getAgentConfigIssueTarget(agent: FullAgent, level: string, label: string) {
  if (level === 'healthy') return undefined
  if (label !== '外部变化') return `/agents/${agent.id}`
  const params = new URLSearchParams({ tab: 'package' })
  const changedFile = agent.files.find((file) => file.status.includes('外部变化'))
  if (changedFile) {
    params.set('path', changedFile.path)
    params.set('view', 'preview')
  }
  return `/agents/${agent.id}?${params}`
}

export function AgentsPage() {
  const { state, dispatch } = useApp()
  const [params, setParams] = useSearchParams()
  const hasFilters = filterKeys.some((key) => params.has(key))
  const hasAdvancedFilters = ['function', 'health', 'lifecycle'].some((key) => params.has(key))
  const [filtersExpanded, setFiltersExpanded] = useState(hasAdvancedFilters)
  const [lifecycleAction, setLifecycleAction] = useState<{ agent: FullAgent; status: FullAgent['status'] }>()
  const [lifecycleSaving, setLifecycleSaving] = useState(false)
  const [lifecycleError, setLifecycleError] = useState('')
  const lifecycleRequestId = useRef<string | undefined>(undefined)
  const value = (key: typeof filterKeys[number]) => params.get(key) ?? ''
  const set = (key: typeof filterKeys[number], next: string) => {
    const copy = new URLSearchParams(params)
    if (next) copy.set(key, next); else copy.delete(key)
    setParams(copy)
  }
  const teamAgents = state.agents.filter((agent) => agent.teamId === state.currentTeamId)
  const assetNames = new Map(state.assets.map((asset) => [asset.id, asset.name]))
  const matches = (agent: FullAgent) => {
    const q = value('q').trim().toLocaleLowerCase()
    const references = [...agent.skillRefs, ...agent.mcpRefs]
    const searchable = [agent.name, agentFunctionLabel(agent.functionId), agent.mission, ...agent.responsibilities, ...references, ...references.map((id) => assetNames.get(id) ?? '')].join(' ').toLocaleLowerCase()
    const status = getAgentConfigStatus(state, agent)
    return (!q || searchable.includes(q))
      && (!value('function') || agent.functionId === value('function'))
      && (!value('health') || status.level === value('health'))
      && (!value('lifecycle') || agent.status === value('lifecycle'))
  }
  const currentRows = teamAgents.filter((agent) => agent.status !== 'archived' && matches(agent))
  const archivedRows = teamAgents.filter((agent) => agent.status === 'archived' && matches(agent))
  const resultCount = currentRows.length + archivedRows.length
  const archivedOnly = value('lifecycle') === 'archived'
  const showSearch = teamAgents.length >= SEARCH_THRESHOLD || hasFilters
  const showFilterButton = teamAgents.length >= FILTER_THRESHOLD || hasAdvancedFilters
  const clear = () => { setParams({}); setFiltersExpanded(false) }
  const currentTeam = state.teams.find((team) => team.id === state.currentTeamId)
  const firstUse = getConfigurationStatusSummary(state).phase === 'first-use'
  const createAgentAction = <Button asChild><Link to="/agents/new"><Plus size={16} aria-hidden="true" />添加 Agent</Link></Button>
  const createActions = <DropdownMenu.Root><DropdownMenu.Trigger asChild><Button aria-label="添加 Agent"><Plus size={16} aria-hidden="true" /><span className="max-sm:hidden">添加 Agent</span></Button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content align="end" sideOffset={6} className={menuContentClass}><DropdownMenu.Item asChild><Link className={menuItemClass} to="/agents/new"><Plus size={15} aria-hidden="true" />新建 Agent</Link></DropdownMenu.Item><DropdownMenu.Item asChild><Link className={menuItemClass} to="/agents/new?mode=import"><Upload size={15} aria-hidden="true" />导入已有 Agent</Link></DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
  const startLifecycle = (agent: FullAgent, status: FullAgent['status']) => { setLifecycleError(''); lifecycleRequestId.current = undefined; setLifecycleAction({ agent, status }) }
  const closeLifecycle = () => { if (!lifecycleSaving) { setLifecycleAction(undefined); setLifecycleError(''); lifecycleRequestId.current = undefined } }
  const confirmLifecycle = async () => {
    if (!lifecycleAction || lifecycleSaving) return
    setLifecycleSaving(true); setLifecycleError('')
    try {
      lifecycleRequestId.current ??= `save-lifecycle-${lifecycleAction.agent.id}-${crypto.randomUUID()}`
      const result = await saveAgentLifecycle({ agent: lifecycleAction.agent, status: lifecycleAction.status, requestId: lifecycleRequestId.current, dispatch })
      if (result.kind === 'saved') {
        if (!state.runtime || state.runtime !== 'desktop') dispatch({ type: 'SHOW_NOTICE', notice: { tone: 'success', title: lifecycleSuccessMessage(lifecycleAction.agent.status, lifecycleAction.status) } })
        setLifecycleAction(undefined); setLifecycleError(''); lifecycleRequestId.current = undefined
      } else {
        setLifecycleError(result.kind === 'baseline_changed' ? 'Agent 配置已在外部修改，Bandi 未自动覆盖。请进入详情处理。' : result.message)
      }
    } catch (error) { setLifecycleError(error instanceof Error ? error.message : String(error)) }
    finally { setLifecycleSaving(false) }
  }

  return <>
    <PageHeader title="Agent" description={`管理 ${currentTeam?.name ?? '当前 Team'} 中的长期 Agent。`} action={firstUse ? undefined : createActions} />
    {firstUse ? <EmptyState className="max-w-2xl p-6 text-left" title="当前 Team 还没有 Agent" description="添加一个长期 Agent，或导入已有配置。" action={<div className="flex flex-wrap gap-2">{createAgentAction}<Button variant="outline" asChild><Link to="/agents/new?mode=import"><Upload size={16} aria-hidden="true" />导入已有 Agent</Link></Button></div>} /> : <section className="panel overflow-hidden">
      {state.agentDiagnostics.length > 0 && <DiscoveryIssues groups={groupDiscoveryDiagnostics(state.agentDiagnostics)} />}
      {showSearch && <div className="border-b border-border p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative min-w-0 flex-1"><span className="sr-only">搜索 Agent</span><Search className="absolute left-3 top-2.5 text-muted-foreground" size={16} aria-hidden="true" /><input value={value('q')} onChange={(event) => set('q', event.target.value)} className="h-10 w-full pl-9 pr-3" placeholder="搜索名称或职责说明" /></label>
          {showFilterButton && <Button type="button" variant="outline" aria-expanded={filtersExpanded} onClick={() => setFiltersExpanded((open) => !open)}><FilterIcon size={16} aria-hidden="true" />筛选</Button>}
          {hasFilters && <Button type="button" variant="ghost" onClick={clear}><X size={15} aria-hidden="true" />清除筛选</Button>}
        </div>
        {filtersExpanded && <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Filter label="职能" value={value('function')} onChange={(next) => set('function', next)} options={Object.entries(agentFunctionLabels)} />
          <Filter label="配置状态" value={value('health')} onChange={(next) => set('health', next)} options={Object.entries(healthLabels)} />
          <Filter label="使用状态" value={value('lifecycle')} onChange={(next) => set('lifecycle', next)} options={Object.entries(lifecycleLabels)} />
        </div>}
        {hasFilters && <p className="mt-3 text-xs text-muted-foreground">找到 {resultCount} 个 Agent</p>}
      </div>}
      {!archivedOnly && (currentRows.length ? <AgentList agents={currentRows} onLifecycle={startLifecycle} /> : <div className="p-5"><EmptyState title={hasFilters ? '没有匹配的 Agent' : '当前列表没有 Agent'} description={hasFilters ? '调整搜索内容或筛选条件后重试。' : '可以从已归档列表移回 Agent，或添加新的 Agent。'} /></div>)}
      {(archivedRows.length > 0 || archivedOnly) && <details open={archivedOnly || undefined} className="border-t border-border">
        <summary className="cursor-pointer px-5 py-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">已归档 {archivedRows.length}</summary>
        {archivedRows.length ? <AgentList agents={archivedRows} onLifecycle={startLifecycle} /> : <div className="px-5 pb-5 text-sm text-muted-foreground">没有匹配的已归档 Agent。</div>}
      </details>}
    </section>}
    <LifecycleDialog action={lifecycleAction} saving={lifecycleSaving} error={lifecycleError} onClose={closeLifecycle} onConfirm={confirmLifecycle} />
  </>
}

function AgentList({ agents, onLifecycle }: { agents: FullAgent[]; onLifecycle: (agent: FullAgent, status: FullAgent['status']) => void }) {
  const { state, dispatch } = useApp()
  return <ul className="divide-y divide-border" aria-label="Agent 列表">{agents.map((agent) => {
    const config = getAgentConfigStatus(state, agent)
    const configTarget = getAgentConfigIssueTarget(agent, config.level, config.label)
    return <li key={agent.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center hover:bg-muted/35 focus-within:bg-muted/35">
      <div className="flex min-w-0 items-start gap-3"><AgentAvatar agent={agent} /><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Link className="rounded-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" to={`/agents/${agent.id}`} aria-label={`查看 ${agent.name} Agent 详情`}>{agent.name}</Link><span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{agentFunctionLabel(agent.functionId)}</span></div><p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">{agent.mission || '尚未设置一句话描述'}</p></div></div>
      <div className="col-start-1 flex flex-wrap items-center gap-2 pl-11 sm:col-start-auto sm:max-w-52 sm:pl-0"><StatusBadge tone={agent.status === 'active' ? 'success' : 'neutral'}>{lifecycleLabels[agent.status]}</StatusBadge>{configTarget ? <Link className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" to={configTarget} aria-label={`处理 ${agent.name} 的${healthLabels[config.level as keyof typeof healthLabels]}`}><StatusBadge tone={config.level === 'warning' ? 'warning' : 'danger'}>{healthLabels[config.level as keyof typeof healthLabels]}</StatusBadge></Link> : <StatusBadge tone="success">配置正常</StatusBadge>}</div>
      <AgentActions agent={agent} onLifecycle={onLifecycle} onClient={(clientId) => dispatch({ type: 'OPEN_DIALOG', dialog: { kind: 'client-guide', clientId, agentId: agent.id } })} />
    </li>
  })}</ul>
}

function AgentActions({ agent, onLifecycle, onClient }: { agent: FullAgent; onLifecycle: (agent: FullAgent, status: FullAgent['status']) => void; onClient: (clientId: string) => void }) {
  const { state } = useApp()
  return <DropdownMenu.Root><DropdownMenu.Trigger asChild><Button type="button" variant="ghost" className="col-start-2 row-span-2 row-start-1 size-11 self-center p-0 sm:col-start-auto sm:row-span-1 sm:row-start-auto" aria-label={`更多操作：${agent.name}`}><MoreHorizontal size={18} aria-hidden="true" /></Button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content align="end" sideOffset={6} className={menuContentClass}>
    {agent.status !== 'archived' && <><DropdownMenu.Label className="px-3 py-2 text-xs font-medium text-muted-foreground">在 AI 工具中使用</DropdownMenu.Label>{state.aiClients.map((client) => <DropdownMenu.Item key={client.id} disabled={agent.status !== 'active'} className={menuItemClass} onSelect={() => onClient(client.id)}><AiClientIcon client={client} size={17} />{client.name}</DropdownMenu.Item>)}<DropdownMenu.Separator className="my-1 h-px bg-border" /></>}
    {agent.status === 'active' && <DropdownMenu.Item className={menuItemClass} onSelect={() => onLifecycle(agent, 'inactive')}>停用 Agent</DropdownMenu.Item>}
    {agent.status === 'inactive' && <DropdownMenu.Item className={menuItemClass} onSelect={() => onLifecycle(agent, 'active')}>重新启用</DropdownMenu.Item>}
    {agent.status !== 'archived' && <DropdownMenu.Item className={menuItemClass} onSelect={() => onLifecycle(agent, 'archived')}>归档 Agent</DropdownMenu.Item>}
    {agent.status === 'archived' && <DropdownMenu.Item className={menuItemClass} onSelect={() => onLifecycle(agent, 'inactive')}><ArchiveRestore size={16} aria-hidden="true" />移回当前 Agent</DropdownMenu.Item>}
  </DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
}

function LifecycleDialog({ action, saving, error, onClose, onConfirm }: { action?: { agent: FullAgent; status: FullAgent['status'] }; saving: boolean; error: string; onClose: () => void; onConfirm: () => void }) {
  if (!action) return null
  const restoring = action.agent.status === 'archived' && action.status === 'inactive'
  const title = restoring ? `移回 ${action.agent.name}` : action.status === 'archived' ? `归档 ${action.agent.name}` : action.status === 'inactive' ? `停用 ${action.agent.name}` : `重新启用 ${action.agent.name}`
  const button = restoring ? '移回当前 Agent' : action.status === 'archived' ? '归档 Agent' : action.status === 'inactive' ? '停用 Agent' : '重新启用 Agent'
  return <AppDialog open onOpenChange={(open) => { if (!open) onClose() }} title={title} description="此操作会保存到 Agent 主配置。" footer={<><Button variant="outline" onClick={onClose}>取消</Button><Button variant={action.status === 'archived' ? 'danger' : 'default'} disabled={saving} onClick={onConfirm}>{saving ? '保存中…' : button}</Button></>}><div className="rounded-lg border border-border bg-muted/35 p-4 text-sm leading-6"><b>保留与影响</b><p className="mt-2 text-muted-foreground">Agent 配置、长期记忆和版本历史都会保留。停用或归档后，此 Agent 不能用于新的 AI 工具启动；已有引用不会自动删除。</p>{restoring && <p className="mt-2 text-muted-foreground">移回后保持停用，需要重新启用才能使用。</p>}</div>{error && <div role="alert" className="mt-4 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger"><p>{error}</p><Button className="mt-3" variant="outline" size="sm" asChild><Link to={`/agents/${action.agent.id}?tab=identity`}>进入详情处理</Link></Button></div>}</AppDialog>
}

function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: ReadonlyArray<readonly [string, string]> }) {
  return <label className="text-xs text-muted-foreground"><span className="mb-1 block font-medium">{label}</span><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-full px-3 text-sm text-foreground"><option value="">全部{label}</option>{options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
}
