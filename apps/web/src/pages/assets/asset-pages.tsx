import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Funnel, Plus, RefreshCw, Save, Search, Trash2, X } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Button } from '../../components/ui/button'
import { AppDialog } from '../../components/ui/dialog'
import { EmptyState, EntityNotFound, EntityTabs, FieldRow, MockBoundaryNote, MonoPath, PageHeader, PathActions, StatusBadge, toneForStatus } from '../../components/app/page'
import { ErrorNotice, errorFromCause, type UserFacingError } from '../../components/app/error-notice'
import { useApp } from '../../state'
import { useUnsavedChangesGuard } from '../../hooks/use-unsaved-changes-guard'
import { validateSopSteps } from '../../sop-validation'
import type { AssetKind, FullAsset, SopStep } from '../../domain'
import type { ParameterDefinition } from '../../component-parameters'
import { pluginInstallationStatusLabels, pluginScopeLabels } from '../../plugin-installation'
import { SkillDetail } from './skill-detail'
import { discoverConfig, isDesktopRuntime } from '../../desktop-bridge'
import { countDiscoveredAssetCategories, filterDiscoveredAssets, groupDiscoveryDiagnostics, projectDiscoveredAssets, projectSharedAssets, type AssetCategory, type DiscoveryIssueGroup, type DiscoveredAssetRow } from '../../discovered-assets'
import { DiscoveredAssetsList, DiscoveryIssues } from './discovered-assets-table'
import { assetKindLabel, assetParseStatusLabel, assetScopeLabel } from '../../presentation'

const kinds: AssetKind[] = ['Skill', 'Memory', 'Rules', 'MCP', 'SOP', 'CLAUDE.md', 'Settings', 'Hook', 'Command', 'OutputProfile', 'Plugin']
const desktopFilterKeys = ['q', 'owner', 'scope', 'health'] as const
const assetCategoryMeta: Record<AssetCategory, { label: string; title: string; description: string; search: string }> = {
  overview: { label: '概览', title: '全部配置', description: '当前 Team 的 Agent 配置和共享资产。', search: '搜索名称、Agent 或路径…' },
  skills: { label: 'Skills', title: 'Skills', description: 'Agent Skill 配置与 Team 共享 Skill。', search: '搜索 Skill、Agent 或路径…' },
  mcp: { label: 'MCP', title: 'MCP', description: '查看 MCP 配置和引用；这里不连接或测试 MCP。', search: '搜索 MCP、Agent 或路径…' },
  rules: { label: 'Rules', title: 'Rules', description: 'Agent 规则配置与 Team 共享规则。', search: '搜索 Rule、Agent 或路径…' },
  sop: { label: 'SOP', title: 'SOP', description: '管理长期流程定义；Desktop 不执行或推进流程。', search: '搜索 SOP、Agent 或路径…' },
  other: { label: '其他', title: '其他配置', description: 'Instructions、Context、权限及扩展配置。', search: '搜索配置、Agent 或路径…' },
}
const assetCategories = Object.keys(assetCategoryMeta) as AssetCategory[]

export function AssetsPage() {
  const { state, dispatch } = useApp()
  const desktop = isDesktopRuntime()
  const [params, setParams] = useSearchParams()
  const [createOpen, setCreateOpen] = useState(false)
  const [discovered, setDiscovered] = useState<DiscoveredAssetRow[]>([])
  const [issues, setIssues] = useState<DiscoveryIssueGroup[]>([])
  const [loading, setLoading] = useState(desktop)
  const [loaded, setLoaded] = useState(!desktop)
  const [error, setError] = useState<UserFacingError>()
  const started = useRef(false)
  const val = (key: string) => params.get(key) ?? ''
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next)
  }
  const refresh = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      const result = await discoverConfig({ requestId: 'discover-assets', includeClaudeUserRoot: false })
      setDiscovered(projectDiscoveredAssets(result))
      setIssues(groupDiscoveryDiagnostics(result.diagnostics))
      dispatch({ type: 'HYDRATE_SHARED_ASSETS', assets: projectSharedAssets(result.sharedAssets) })
      setLoaded(true)
    } catch (cause) {
      setError(errorFromCause(cause, '无法读取配置资产', '现有文件没有变化。请检查本地服务后重试。'))
    } finally {
      setLoading(false)
    }
  }, [dispatch])
  useEffect(() => {
    if (!desktop || state.hydration.sharedAssets === 'loading' || started.current) return
    started.current = true
    void refresh()
  }, [desktop, refresh, state.hydration.sharedAssets])

  const currentTeam = state.teams.find((team) => team.id === state.currentTeamId)
  const teamName = currentTeam?.name ?? '当前 Team'
  const teamAgents = state.agents.filter((agent) => agent.teamId === state.currentTeamId)
  const agentNames = useMemo(() => new Map(state.agents.map((agent) => [agent.id, agent.name])), [state.agents])
  const requestedCategory = val('tab') as AssetCategory
  const category = assetCategories.includes(requestedCategory) ? requestedCategory : 'overview'
  const teamRows = filterDiscoveredAssets(discovered, { teamId: state.currentTeamId, category: 'overview' })
  const categoryRows = filterDiscoveredAssets(teamRows, { teamId: state.currentTeamId, category })
  const discoveredRows = filterDiscoveredAssets(teamRows, {
    teamId: state.currentTeamId,
    category,
    query: val('q'),
    owner: val('owner'),
    scope: val('scope'),
    health: val('health'),
    agentNames,
    teamName,
  })
  const categoryCounts = countDiscoveredAssetCategories(teamRows)
  const categoryTabs = assetCategories.map((id) => ({
    id,
    label: id === 'overview' ? `${assetCategoryMeta[id].label} ${teamRows.length}` : `${assetCategoryMeta[id].label} ${categoryCounts[id]}`,
  }))
  const categoryInfo = assetCategoryMeta[category]
  const selectCategory = (next: string) => {
    const nextParams = new URLSearchParams(params)
    if (next === 'overview') nextParams.delete('tab')
    else nextParams.set('tab', next)
    nextParams.delete('kind')
    setParams(nextParams)
  }
  const demoRows = state.assets.filter((item) => (!val('q') || `${item.name} ${item.summary} ${item.path}`.toLowerCase().includes(val('q').toLowerCase())) && (!val('kind') || item.kind === val('kind')) && (!val('owner') || item.owner === val('owner')) && (!val('scope') || item.scope === val('scope')) && (!val('health') || item.status === val('health')))
  const owners = desktop ? [...new Set(teamRows.flatMap((item) => item.agentId ?? []))] : [...new Set(state.assets.map((item) => item.owner))]
  const scopes = desktop ? [...new Set(categoryRows.map((item) => item.scope))] : [...new Set(state.assets.map((item) => item.scope))]
  const statuses = desktop ? [...new Set(categoryRows.map((item) => item.parseStatus))] : [...new Set(state.assets.map((item) => item.status))]
  const activeFilterCount = desktopFilterKeys.filter((key) => val(key)).length
  const filtered = activeFilterCount > 0
  const clear = () => setParams(category === 'overview' ? {} : { tab: category })

  const desktopFilters = teamRows.length > 0 && <>
    <div className="flex flex-col gap-3 border-b border-border p-4 md:flex-row md:items-start">
      <label className="relative min-w-0 flex-1"><span className="sr-only">搜索配置资产</span><Search className="absolute left-3 top-2.5 text-muted-foreground" size={16} aria-hidden="true" /><input className="h-9 w-full pl-9 pr-3" value={val('q')} onChange={(event) => set('q', event.target.value)} placeholder={categoryInfo.search} /></label>
      <details className="group relative md:w-36"><summary className="flex h-9 cursor-pointer list-none items-center justify-center gap-2 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Funnel size={15} aria-hidden="true" />筛选{activeFilterCount > 0 ? ` ${activeFilterCount}` : ''}</summary><div className="mt-2 grid gap-2 rounded-lg border border-border bg-card p-3 shadow-lg md:absolute md:right-0 md:z-20 md:w-72"><Filter label="所属 Agent" value={val('owner')} onChange={(value) => set('owner', value)} values={owners} formatValue={(id) => agentNames.get(id) ?? id} /><Filter label="作用域" value={val('scope')} onChange={(value) => set('scope', value)} values={scopes} formatValue={assetScopeLabel} /><Filter label="状态" value={val('health')} onChange={(value) => set('health', value)} values={statuses} formatValue={assetParseStatusLabel} /></div></details>
    </div>
    {filtered && <div className="flex items-center justify-between border-b border-border bg-muted/35 px-4 py-2 text-xs"><span>已应用 {activeFilterCount} 项筛选</span><button onClick={clear} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X size={13} aria-hidden="true" />清除全部</button></div>}
  </>

  return <><PageHeader title="配置资产" description={desktop ? `查看 ${teamName} 的 Agent 配置、共享资产和待处理问题。` : '在当前页面中演示查看和管理技能、长期记忆、规则、MCP、SOP 与 Claude Code 配置。'} action={<div className="flex flex-wrap gap-2">{desktop ? <Button variant="outline" disabled={loading} aria-busy={loading} onClick={refresh}><RefreshCw size={16} aria-hidden="true" />{loading ? '正在刷新' : '刷新'}</Button> : <><Button asChild variant="outline"><Link to="/assets/skills">管理演示技能</Link></Button><Button onClick={() => setCreateOpen(true)}><Plus size={16} aria-hidden="true" />新建演示资产</Button></>}</div>} />{desktop && <EntityTabs tabs={categoryTabs} active={category} onChange={selectCategory} scope="asset-category" ariaLabel="配置资产分类" variant="segmented" className="mb-5" />}<section id={desktop ? `asset-category-panel-${category}` : undefined} role={desktop ? 'tabpanel' : undefined} aria-labelledby={desktop ? `asset-category-tab-${category}` : undefined} className="panel overflow-hidden">{desktop && <div className="border-b border-border px-5 py-4"><h2 className="font-semibold">{categoryInfo.title}</h2><p className="mt-1 text-sm text-muted-foreground">{categoryInfo.description}</p></div>}{desktop && <details className="border-b border-border bg-muted/20 px-5 py-3 text-sm text-muted-foreground"><summary className="cursor-pointer font-medium text-foreground">关于配置资产</summary><p className="mt-2">这里只显示 Bandi 管理的 Agent 配置和当前 Team 的共享资产。Bandi 不会读取其他目录。共享资产新增、导入和更新当前尚未接入。</p></details>}{desktop ? desktopFilters : <div className="grid gap-3 border-b border-border p-4 md:grid-cols-2 xl:grid-cols-5"><label className="relative"><Search className="absolute left-3 top-2.5 text-muted-foreground" size={16} aria-hidden="true" /><input aria-label="搜索配置资产" className="h-9 w-full pl-9 pr-3" value={val('q')} onChange={(event) => set('q', event.target.value)} placeholder="搜索标识或路径…" /></label><Filter label="类型" value={val('kind')} onChange={(value) => set('kind', value)} values={kinds} formatValue={assetKindLabel} /><Filter label="所有者" value={val('owner')} onChange={(value) => set('owner', value)} values={owners} /><Filter label="作用域" value={val('scope')} onChange={(value) => set('scope', value)} values={scopes} formatValue={assetScopeLabel} /><Filter label="状态" value={val('health')} onChange={(value) => set('health', value)} values={statuses} /></div>}{error && <ErrorNotice error={error} className="rounded-none border-x-0 border-t-0" />}{desktop && <DiscoveryIssues groups={issues} global />}{desktop ? (!loaded && error ? null : <DiscoveredAssetsList rows={discoveredRows} loading={loading} filtered={filtered && categoryRows.length > 0} hasAgents={teamAgents.length > 0} hasTeamAssets={teamRows.length > 0} categoryLabel={categoryInfo.label} teamName={teamName} agentNames={agentNames} clear={clear} refresh={refresh} />) : demoRows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left"><thead className="bg-muted text-xs"><tr>{['资产', '类型', '所有者 / 作用域', '引用', '路径', '状态'].map((item) => <th key={item} className="px-5 py-3">{item}</th>)}</tr></thead><tbody className="divide-y divide-border">{demoRows.map((asset) => <tr key={asset.id} className="hover:bg-muted"><td className="px-5 py-4"><Link className="font-semibold hover:underline" to={`/assets/${asset.id}`}>{asset.name}</Link><small className="mt-1 block max-w-64 text-muted-foreground">{asset.summary}</small></td><td>{assetKindLabel(asset.kind)}</td><td>{asset.owner}<small className="block text-muted-foreground">{assetScopeLabel(asset.scope)}</small></td><td>{asset.references.length}</td><td><MonoPath>{asset.path}</MonoPath></td><td><StatusBadge tone={toneForStatus(asset.status)}>{asset.status}</StatusBadge></td></tr>)}</tbody></table></div> : <div className="p-5"><EmptyState title="没有匹配资产" description="请调整或清除筛选。" action={<Button variant="outline" onClick={clear}>清除筛选</Button>} /></div>}</section>{!desktop && <CreateAssetDialog open={createOpen} onOpenChange={setCreateOpen} />}</>
}
function Filter({ label, value, onChange, values, formatValue = (item) => item }: { label: string; value: string; onChange: (v: string) => void; values: string[]; formatValue?: (value: string) => string }) { return <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-full px-3"><option value="">全部{label}</option>{values.map((item) => <option key={item} value={item}>{formatValue(item)}</option>)}</select> }

function CreateAssetDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) { const { dispatch } = useApp(); const navigate = useNavigate(); const [kind, setKind] = useState<'SOP' | 'Rules' | 'Skill'>('SOP'); const [name, setName] = useState(''); const submit = () => { if (!name.trim()) return; const id = `${kind.toLowerCase()}-${crypto.randomUUID()}`; const asset: FullAsset = { id, name: name.trim(), kind, owner: '当前用户', scope: kind === 'SOP' ? 'Project' : 'Agent 自有', refs: 0, path: kind === 'SOP' ? `.claude/sops/${id}.md` : `~/.bandi/assets/${id}`, status: kind === 'Skill' ? '演示已安装' : '演示未写盘', sourceType: 'Bandi 自有', summary: `${assetKindLabel(kind)}演示资产`, content: '', references: [], version: kind === 'SOP' ? 'v1' : undefined, objective: kind === 'SOP' ? '待补充目标' : undefined, steps: kind === 'SOP' ? [] : undefined, skill: kind === 'Skill' ? { source: { kind: 'local', path: `~/.bandi/assets/${id}` }, delivery: { kind: 'standalone' }, installation: { status: 'installed', installedVersion: '0.1.0', availableVersion: '0.1.0', previousVersions: [] }, review: { permissions: ['未声明额外权限'], impact: ['仅创建当前页面中的演示安装记录'], files: ['SKILL.md'] } } : undefined }; dispatch({ type: 'CREATE_ASSET', asset }); onOpenChange(false); navigate(`/assets/${id}`) }; return <AppDialog open={open} onOpenChange={onOpenChange} title="新建演示资产" description="SOP、规则和技能可创建演示配置；长期记忆请在 Agent 页面直接编辑。" size="md" footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button disabled={!name.trim()} onClick={submit}>创建演示资产</Button></>}><label className="block text-sm font-medium">类型<select className="mt-2 h-10 w-full px-3" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>{['SOP', 'Rules', 'Skill'].map((item) => <option key={item} value={item}>{assetKindLabel(item)}</option>)}</select></label><label className="mt-4 block text-sm font-medium">名称<input className="mt-2 h-10 w-full px-3" value={name} onChange={(e) => setName(e.target.value)} /></label><div className="mt-5"><MockBoundaryNote /></div></AppDialog> }

const genericTabs = [['overview', '概览'], ['content', '内容 / 配置'], ['references', '引用'], ['files', '文件']].map(([id, label]) => ({ id, label }))
const sopTabs = [['overview', '概览'], ['steps', '步骤定义'], ['responsibility', '责任主体'], ['io', '输入输出'], ['dependencies', '依赖'], ['approval', '确认 / 升级条件'], ['references', '引用'], ['files', '文件']].map(([id, label]) => ({ id, label }))
export function AssetDetailPage() { const { id } = useParams(); const { state } = useApp(); const asset = state.assets.find((item) => item.id === id); if (!asset) return <EntityNotFound entity="资产" backTo="/assets" />; return asset.kind === 'SOP' ? <SopDetail asset={asset} /> : asset.kind === 'Skill' && asset.skill ? <SkillDetail asset={asset} /> : asset.kind === 'Plugin' && asset.plugin ? <PluginDetail asset={asset} /> : asset.kind === 'Hook' || asset.kind === 'Command' || asset.kind === 'OutputProfile' ? <TypedAssetDetail asset={asset} /> : <GenericDetail asset={asset} /> }
function TypedAssetDetail({ asset }: { asset: FullAsset }) {
  const { state } = useApp()
  const definition = asset.hook ?? asset.command ?? asset.outputProfile
  const parameters = definition?.parameters ?? []
  const pluginId = asset.hook?.pluginAssetId ?? asset.command?.pluginAssetId
  const installation = pluginId ? state.pluginInstallations.find((item) => item.pluginId === pluginId) : undefined
  return <><PageHeader backTo="/assets" title={asset.name} description={`${assetKindLabel(asset.kind)}结构化定义 · 不提供执行能力`} /><div className="grid gap-5 lg:grid-cols-[1fr_340px]"><section className="panel p-5"><FieldRow label="用途">{asset.hook?.purpose ?? asset.command?.purpose ?? asset.summary}</FieldRow>{asset.hook && <FieldRow label="事件">{asset.hook.event}</FieldRow>}{asset.command && <FieldRow label="命令 ID">{asset.command.commandId}</FieldRow>}{asset.outputProfile && <><FieldRow label="格式">{asset.outputProfile.format} · {asset.outputProfile.language}</FieldRow><FieldRow label="必需章节">{asset.outputProfile.requiredSections.join('、') || '无'}</FieldRow><FieldRow label="证据要求">{asset.outputProfile.evidenceRequirement}</FieldRow><FieldRow label="输出目的地">仅响应（response）</FieldRow></>}<ParameterDefinitions definitions={parameters} /></section><aside className="space-y-5"><section className="panel p-5"><b>来源与兼容</b><FieldRow label="来源">{pluginId ? state.assets.find((item) => item.id === pluginId)?.name ?? pluginId : asset.sourceType}</FieldRow>{pluginId && <FieldRow label="插件安装记录">{installation ? `${pluginInstallationStatusLabels[installation.status]} · ${installation.installedVersion ?? '未安装'}` : '缺失'}</FieldRow>}<FieldRow label="路径"><MonoPath>{asset.path}</MonoPath></FieldRow></section><MockBoundaryNote>{asset.kind === 'OutputProfile' ? '输出格式只约束响应格式，不提供文件、网络、Webhook 或外部投递能力。' : '这里仅管理定义和参数；不会执行钩子或命令，也不接受命令行、工作目录、环境变量或可执行程序。'}</MockBoundaryNote></aside></div></>
}

function ParameterDefinitions({ definitions }: { definitions: ParameterDefinition[] }) {
  return <div className="mt-6 border-t border-border pt-5"><b>非敏感参数定义</b><div className="mt-3 space-y-2">{definitions.map((definition) => <div key={definition.id} className="rounded-lg border border-border p-3 text-sm"><b>{definition.label}</b><p className="mt-1 text-xs text-muted-foreground">{definition.id} · {definition.type}{definition.required ? ' · 必填' : ''}{definition.type === 'enum' ? ` · ${definition.options.join(' / ')}` : ''}{definition.type === 'number' ? ` · ${definition.min ?? '不限'}–${definition.max ?? '不限'}` : ''}</p></div>)}{!definitions.length && <p className="text-sm text-muted-foreground">没有参数定义。</p>}</div></div>
}

function PluginDetail({ asset }: { asset: FullAsset }) {
  const { state, dispatch } = useApp()
  const desktop = state.runtime === 'desktop'
  const installation = state.pluginInstallations.find((item) => item.pluginId === asset.id)
  const components = (asset.plugin?.componentAssetIds ?? []).map((id) => state.assets.find((item) => item.id === id)).filter((item): item is FullAsset => Boolean(item))
  const action = (type: 'install' | 'update' | 'rollback' | 'uninstall', version?: string) => dispatch({ type: 'APPLY_PLUGIN_ACTION', pluginId: asset.id, action: type, version })
  return <><PageHeader backTo="/assets" title={asset.name} description="插件内容、安装记录和 Agent 组件使用位置相互独立" /><div className="grid gap-5 lg:grid-cols-[1fr_360px]"><section className="panel p-5"><b>组件清单</b><p className="mt-2 text-sm text-muted-foreground">安装不会自动将组件加入 Agent；卸载也不会删除既有使用位置。</p><div className="mt-4 space-y-2">{components.map((component) => <Link key={component.id} to={`/assets/${component.id}`} className="flex items-center justify-between rounded-lg border border-border p-3 hover:bg-muted"><span><b>{component.name}</b><small className="mt-1 block text-muted-foreground">{assetKindLabel(component.kind)} · {component.path}</small></span><StatusBadge tone="neutral">定义</StatusBadge></Link>)}{components.length !== (asset.plugin?.componentAssetIds.length ?? 0) && <p role="alert" className="text-sm text-danger">组件清单不完整，缺少定义。</p>}</div></section><aside className="space-y-5"><section className="panel p-5"><b>插件安装记录</b>{installation ? <><FieldRow label="状态">{pluginInstallationStatusLabels[installation.status]}</FieldRow><FieldRow label="安装范围">{pluginScopeLabels[installation.scope]}级</FieldRow><FieldRow label="当前版本">{installation.installedVersion ?? '未安装'}</FieldRow><FieldRow label="可用版本">{installation.availableVersion}</FieldRow><FieldRow label="兼容性">{installation.compatible ? '兼容' : '不兼容'}</FieldRow><FieldRow label="组件完整性">{installation.componentsComplete ? '完整' : '不完整'}</FieldRow>{!desktop && <div className="mt-4 flex flex-wrap gap-2">{installation.status === 'available' && <Button onClick={() => action('install')}>模拟安装</Button>}{installation.status === 'update-available' && <Button onClick={() => action('update')}>模拟更新</Button>}{installation.previousVersions.map((version) => <Button key={version} variant="outline" onClick={() => action('rollback', version)}>模拟回滚到 {version}</Button>)}{installation.status !== 'available' && <Button variant="outline" onClick={() => action('uninstall')}>模拟卸载</Button>}</div>}</> : <p className="mt-3 text-sm text-danger">缺少独立安装记录。</p>}</section><MockBoundaryNote>{desktop ? 'Desktop 当前只读展示插件定义与安装记录，不提供安装、更新、回滚或卸载。' : '所有操作仅修改当前页面中的插件安装记录；不会检查本机安装状态、下载文件、运行安装脚本、写入文件或加载到当前工具。'}</MockBoundaryNote></aside></div></>
}

function GenericDetail({ asset }: { asset: FullAsset }) { const { dispatch } = useApp(); const [params, setParams] = useSearchParams(); const [editing, setEditing] = useState(false); const [content, setContent] = useState(asset.content); const [confirmOpen, setConfirmOpen] = useState(false); const dirty = editing && content !== asset.content; const unsavedDialog = useUnsavedChangesGuard({ dirty, resetDraft: () => { setContent(asset.content); setEditing(false) } }); const raw = params.get('tab') ?? 'overview'; const tab = genericTabs.some((item) => item.id === raw) ? raw : 'overview'; const commit = () => { dispatch({ type: 'UPDATE_ASSET', assetId: asset.id, changes: { content }, message: `已更新${asset.sourceType === '显式共享' ? '共享资产 ' : ' '}${asset.name} · 目标：${asset.path} · 仅在当前页面有效 · 未写入文件` }); setEditing(false); setConfirmOpen(false) }; const save = () => { if (asset.kind === 'Memory') return; if (asset.sourceType === '显式共享') { setConfirmOpen(true); return } commit() }; return <><PageHeader backTo="/assets" title={asset.name} description={`${assetKindLabel(asset.kind)} · ${asset.owner} · ${assetScopeLabel(asset.scope)}`} action={asset.kind !== 'Memory' ? <Button variant="outline" onClick={() => { if (editing) setContent(asset.content); setEditing((value) => !value) }}>{editing ? '取消编辑' : '编辑资产'}</Button> : undefined} /><EntityTabs tabs={genericTabs} active={tab} onChange={(next) => setParams(next === 'overview' ? {} : { tab: next })} />{tab === 'overview' && <section className="panel p-5"><FieldRow label="摘要">{asset.summary}</FieldRow><FieldRow label="来源">{asset.sourceType}</FieldRow><FieldRow label="作用域">{assetScopeLabel(asset.scope)}</FieldRow><FieldRow label="状态"><StatusBadge tone={toneForStatus(asset.status)}>{asset.status}</StatusBadge></FieldRow><FieldRow label="路径"><MonoPath>{asset.path}</MonoPath></FieldRow>{asset.kind === 'MCP' && <FieldRow label="凭据">未读取 · 浏览器演示不连接或测试 MCP</FieldRow>}</section>}{tab === 'content' && <section className="panel p-5">{asset.kind === 'Memory' ? <MockBoundaryNote>长期记忆不能在这里编辑；请前往对应 Agent 的“长期记忆”页面修改。</MockBoundaryNote> : editing ? <><textarea aria-label="资产内容" className="min-h-72 w-full p-4" value={content} onChange={(e) => setContent(e.target.value)} /><Button className="mt-4" onClick={save}><Save size={15} />保存到当前页面</Button></> : <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted p-5 text-sm leading-7">{asset.content || '暂无内容'}</pre>}</section>}{tab === 'references' && <ReferenceList asset={asset} />}{tab === 'files' && <section className="panel p-5"><MonoPath>{asset.path}</MonoPath><div className="mt-4"><PathActions path={asset.path} /></div></section>}<AppDialog open={confirmOpen} onOpenChange={setConfirmOpen} title="确认共享影响" description="保存会更新所有显式引用该资产的演示配置。" footer={<><Button variant="outline" onClick={() => setConfirmOpen(false)}>返回编辑</Button><Button onClick={commit}>确认并保存</Button></>}><div className="rounded-lg border border-warning/30 bg-warning/5 p-4 text-sm leading-6"><b>{asset.name}</b><p className="mt-2 text-muted-foreground">当前有 {asset.references.length} 个显式引用。确认后只更新 React 当前页面，不写入 {asset.path}，也不修改真实 Agent 配置。</p></div></AppDialog>{unsavedDialog}</> }

function SopDetail({ asset }: { asset: FullAsset }) { const { dispatch } = useApp(); const [params, setParams] = useSearchParams(); const raw = params.get('tab') ?? 'overview'; const tab = sopTabs.some((item) => item.id === raw) ? raw : 'overview'; const [editing, setEditing] = useState(false); const [steps, setSteps] = useState(asset.steps ?? []); const [confirmOpen, setConfirmOpen] = useState(false); useEffect(() => setSteps(asset.steps ?? []), [asset.steps]); const errors = useMemo(() => validateSopSteps(steps), [steps]); const dirty = editing && JSON.stringify(steps) !== JSON.stringify(asset.steps ?? []); const unsavedDialog = useUnsavedChangesGuard({ dirty, resetDraft: () => { setSteps(asset.steps ?? []); setEditing(false) } }); const update = (id: string, key: keyof SopStep, value: string | string[]) => setSteps((items) => items.map((item) => item.id === id ? { ...item, [key]: value } : item)); const commit = () => { dispatch({ type: 'UPDATE_ASSET', assetId: asset.id, changes: { steps }, message: `已更新${asset.sourceType === '显式共享' ? '共享 ' : ' '}SOP ${asset.name} · 目标：${asset.path} · 仅在当前页面有效 · 未写入文件` }); setEditing(false); setConfirmOpen(false) }; const save = () => { if (errors.length) return; if (asset.sourceType === '显式共享') { setConfirmOpen(true); return } commit() }; const move = (index: number, delta: number) => { const next = [...steps]; const target = index + delta; if (target < 0 || target >= next.length) return; [next[index], next[target]] = [next[target], next[index]]; setSteps(next) }; return <><PageHeader backTo="/assets" title={asset.name} description={`SOP 配置定义 · ${asset.version} · 不在 Desktop 中运行`} action={<Button variant="outline" onClick={() => { if (editing) setSteps(asset.steps ?? []); setEditing((value) => !value) }}>{editing ? '取消编辑' : '编辑 SOP'}</Button>} /><EntityTabs tabs={sopTabs} active={tab} onChange={(next) => setParams(next === 'overview' ? {} : { tab: next })} />{tab === 'overview' && <section className="panel p-5"><FieldRow label="目标">{asset.objective}</FieldRow><FieldRow label="版本">{asset.version}</FieldRow><FieldRow label="步骤">{steps.length}</FieldRow><FieldRow label="路径"><MonoPath>{asset.path}</MonoPath></FieldRow><MockBoundaryNote>SOP 是给外部 AI 编程工具中的相关 Agent 解析的配置定义；Desktop 不选人、不运行、不推进步骤，也不产生任务待办。</MockBoundaryNote></section>}{tab === 'steps' && <section className="panel overflow-hidden"><div className="flex items-center justify-between border-b border-border p-4"><b>结构化步骤</b>{editing && <Button size="sm" variant="outline" onClick={() => setSteps((items) => [...items, { id: `step-${items.length + 1}`, title: '新步骤', objective: '', input: '', output: '', owner: '', dependsOn: [] }])}><Plus size={14} />添加步骤</Button>}</div><div className="divide-y divide-border">{steps.map((step, index) => <div key={step.id} className="p-5">{editing ? <SopStepEditor step={step} index={index} errors={errors} update={update} move={move} remove={() => setSteps((items) => items.filter((item) => item.id !== step.id))} /> : <><b>{index + 1}. {step.title}</b><p className="mt-2 text-sm text-muted-foreground">{step.objective} · {step.owner}</p></>}</div>)}</div>{!steps.length && <div className="p-5"><EmptyState title="还没有 SOP 步骤" description={editing ? '添加第一步，定义标题、目标、责任主体和依赖关系。' : '编辑 SOP 后即可添加结构化步骤。'} /></div>}{Boolean(errors.length) && <div role="alert" className="border-t border-danger/30 bg-danger/5 p-4 text-sm text-danger"><b>请修复以下问题后保存：</b><ul className="mt-2 list-disc space-y-1 pl-5">{errors.map((error) => <li key={error}>{error}</li>)}</ul></div>}{editing && <div className="border-t border-border p-4"><Button onClick={save}><Save size={15} />保存 SOP 定义</Button></div>}</section>}{tab === 'responsibility' && <List title="责任主体" values={(asset.steps ?? []).map((item) => `${item.title}：${item.owner}`)} />}{tab === 'io' && <List title="输入输出" values={(asset.steps ?? []).map((item) => `${item.title}：${item.input} → ${item.output}`)} />}{tab === 'dependencies' && <List title="依赖关系" values={(asset.steps ?? []).map((item) => `${item.title} ← ${item.dependsOn.join('、') || '无'}`)} />}{tab === 'approval' && <section className="grid gap-5 lg:grid-cols-2"><List title="需用户确认的条件" values={asset.approvalConditions ?? []} /><List title="升级条件" values={asset.escalationConditions ?? []} /></section>}{tab === 'references' && <ReferenceList asset={asset} />}{tab === 'files' && <section className="panel p-5"><MonoPath>{asset.path}</MonoPath><div className="mt-4"><PathActions path={asset.path} /></div></section>}<AppDialog open={confirmOpen} onOpenChange={setConfirmOpen} title="确认共享 SOP 影响" description="保存会更新所有显式引用该 SOP 的演示配置。" footer={<><Button variant="outline" onClick={() => setConfirmOpen(false)}>返回编辑</Button><Button onClick={commit}>确认并保存</Button></>}><div className="rounded-lg border border-warning/30 bg-warning/5 p-4 text-sm leading-6"><b>{asset.name}</b><p className="mt-2 text-muted-foreground">当前有 {asset.references.length} 个显式引用。确认后只更新 React 当前页面，不写入 {asset.path}，也不运行或推进 SOP。</p></div></AppDialog>{unsavedDialog}</> }
function SopStepEditor({ step, index, errors, update, move, remove }: { step: SopStep; index: number; errors: string[]; update: (id: string, key: keyof SopStep, value: string | string[]) => void; move: (index: number, delta: number) => void; remove: () => void }) {
  const number = index + 1
  const field = (key: 'title' | 'objective' | 'owner' | 'dependsOn', label: string, value: string, onChange: (value: string) => void) => {
    const id = `sop-step-${step.id || number}-${key}`
    const fieldErrors = errors.filter((error) => key === 'title' ? error === `步骤 ${number}缺少标题。` : key === 'owner' ? error === `步骤 ${number}缺少责任主体。` : key === 'dependsOn' ? error.includes(`步骤“${step.id}”`) : false)
    const errorId = `${id}-error`
    return <div><label htmlFor={id} className="text-sm font-medium">{label}</label><input id={id} value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={fieldErrors.length > 0 || undefined} aria-describedby={fieldErrors.length ? errorId : undefined} className="mt-2 h-10 w-full px-3" />{fieldErrors.length > 0 && <span id={errorId} className="mt-1 block text-xs text-danger">{fieldErrors.join(' ')}</span>}</div>
  }
  return <div className="grid gap-3 sm:grid-cols-2">{field('title', '标题', step.title, (value) => update(step.id, 'title', value))}{field('objective', '目标', step.objective, (value) => update(step.id, 'objective', value))}{field('owner', '责任主体', step.owner, (value) => update(step.id, 'owner', value))}{field('dependsOn', '依赖步骤 ID（逗号分隔）', step.dependsOn.join(','), (value) => update(step.id, 'dependsOn', value.split(',').map((item) => item.trim()).filter(Boolean)))}<div className="flex gap-2"><Button variant="ghost" size="icon" aria-label={`上移步骤 ${number}`} onClick={() => move(index, -1)}><ArrowUp size={15} aria-hidden="true" /></Button><Button variant="ghost" size="icon" aria-label={`下移步骤 ${number}`} onClick={() => move(index, 1)}><ArrowDown size={15} aria-hidden="true" /></Button><Button variant="ghost" size="icon" aria-label={`删除步骤 ${number}`} onClick={remove}><Trash2 size={15} aria-hidden="true" /></Button></div></div>
}
function ReferenceList({ asset }: { asset: FullAsset }) { return <section className="panel divide-y divide-border">{asset.references.map((item) => <Link key={`${item.type}-${item.id}`} to={`/agents/${item.id}`} className="flex justify-between p-5 hover:bg-muted"><b>{item.label}</b><span className="text-sm text-muted-foreground">Agent · 显式引用</span></Link>)}{!asset.references.length && <p className="p-5 text-sm text-muted-foreground">暂无引用。</p>}</section> }
function List({ title, values }: { title: string; values: string[] }) { return <section className="panel p-5"><b>{title}</b><div className="mt-4 space-y-2">{values.map((item) => <div key={item} className="rounded-lg border border-border p-3 text-sm">{item}</div>)}{!values.length && <p className="text-sm text-muted-foreground">未设置。</p>}</div></section> }
