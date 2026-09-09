import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, FileDiff, History, KeyRound, Save, Search, ShieldCheck } from 'lucide-react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AiClientLaunchAction } from '../../components/ai-clients'
import { Button } from '../../components/ui/button'
import { AppDialog } from '../../components/ui/dialog'
import { Tooltip } from '../../components/ui/tooltip'
import { useUnsavedChangesGuard } from '../../hooks/use-unsaved-changes-guard'
import { ErrorNotice, errorFromCause, type UserFacingError } from '../../components/app/error-notice'
import { EmptyState, EntityNotFound, EntityTabPanel, EntityTabs, FieldRow, MonoPath, PageHeader, PathActions, StatusBadge, toneForStatus } from '../../components/app/page'
import { useApp } from '../../state'
import type { ContextPolicy, FullAgent } from '../../domain'
import { applyAgentConfig, normalizeAgentName, parseAgentContextConfig, parseAgentMcpRefs, parseAgentPermissions, parseAgentRuleRefs, parseAgentSkillRefs, parseAgentSopRefs, serializeAgentConfig, validateAgentName, validateContextPolicy, validateContextWindowTokens, type AgentContextConfig, type AgentIdentityConfig } from '../../agent-config-model'
import { getAgentConfigStatus, getLatestRevisionForAgent } from '../../domain-selectors'
import { useRegisterEditorSession } from '../../editor-session'
import { resolveAgentConfigRoute, type AgentConfigSection, type AgentFileView } from '../../agent-config-projection'
import { getDefaultAgentPackagePath } from '../../agent-package'
import { getAgentPackageEditability } from '../../agent-package-schema'
import { AgentPackageBrowser } from './agent-package-files'
import { AgentConfigNavigation } from './agent-config-navigation'
import { AgentDangerZone } from './agent-danger-zone'
import { AgentAvatar } from '../../components/agents/agent-avatar'
import { AgentAvatarPicker } from '../../components/agents/agent-avatar-picker'
import { MemoryRevisionHistory } from './memory-revision-history'
import { commitManagedAgentIdentity, discoverConfig, isDesktopRuntime, listConfigRevisions, loadConfigEditor, loadManagedAgentIdentity, readConfigRevisionContent, recoverConfigRevision, recoverManagedAgentIdentity, restoreConfigRevision, restoreManagedAgentIdentity, saveConfig, saveMemory } from '../../desktop-bridge'
import type { ConfigRevisionDto, DiscoveryResult, LoadEditorResult, SaveConfigResult, SaveManagedAgentIdentityResult, SourceAssetSummaryDto } from '../../contracts'
import { formatDisplayTimestamp } from '../../presentation'

function findManagedAgentAsset(
  discovery: DiscoveryResult,
  agent: FullAgent,
  relativePath: string,
  kind: SourceAssetSummaryDto['kind'],
  label: string,
) {
  const packageId = agent.packageSource.kind === 'bandi-managed' || agent.packageSource.kind === 'managed-agent-import' || agent.packageSource.kind === 'claude-agent-import'
    ? agent.packageSource.packageId
    : `agt_${agent.id}`
  const expectedPath = `${packageId}/${relativePath}`
  const containers = discovery.containers.filter((item) => item.locator.rootKind === 'managed' && item.locator.relativePath === expectedPath)
  if (containers.length === 0) throw new Error(`未发现该 Agent 的可编辑 ${label}（${expectedPath}）`)
  if (containers.length > 1) throw new Error(`该 Agent 的 ${label} 定位存在歧义：${expectedPath} 匹配到 ${containers.length} 个容器`)
  const assets = discovery.assets.filter((item) => item.agentId === agent.id && item.teamId === agent.teamId && item.kind === kind && item.containerId === containers[0].id)
  if (assets.length === 0) throw new Error(`未发现该 Agent 的可编辑 ${label}（${expectedPath}）`)
  if (assets.length > 1) throw new Error(`该 Agent 的 ${label} 定位存在歧义：${expectedPath} 匹配到 ${assets.length} 个资产`)
  return assets[0]
}

async function loadManagedAgentAssetEditor(
  agent: FullAgent,
  requestId: string,
  relativePath: string,
  kind: SourceAssetSummaryDto['kind'],
  label: string,
) {
  const discovery = await discoverConfig({ requestId: `discover-${requestId}`, includeClaudeUserRoot: false })
  const asset = findManagedAgentAsset(discovery, agent, relativePath, kind, label)
  return loadConfigEditor({ requestId: `load-${requestId}`, assetId: asset.id })
}

export function AgentDetailPage() {
  const { id } = useParams()
  const { state, dispatch } = useApp()
  const location = useLocation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const agent = state.agents.find((item) => item.id === id)
  const [routeNotice, setRouteNotice] = useState<string>()
  const route = useMemo(() => agent ? resolveAgentConfigRoute(agent, params) : undefined, [agent, params])
  const projectionContext = useMemo(() => ({ assets: state.assets, memorySpaces: state.memorySpaces }), [state.assets, state.memorySpaces])
  const configStatus = agent ? getAgentConfigStatus(state, agent) : undefined

  useEffect(() => {
    if (agent && agent.teamId !== state.currentTeamId) {
      dispatch({ type: 'SELECT_TEAM', teamId: agent.teamId })
    }
  }, [agent, dispatch, state.currentTeamId])

  const routeSearch = route?.canonicalParams.toString()
  const currentSearch = params.toString()
  useEffect(() => {
    if (!route || routeSearch === currentSearch) return
    setRouteNotice(route.notice)
    setParams(route.canonicalParams, { replace: true })
  }, [currentSearch, route, routeSearch, setParams])
  if (!agent || !route) return <EntityNotFound entity="Agent" backTo="/agents" />
  const identitySummary = state.teams.find((team) => team.id === agent.teamId)?.name ?? 'Team 未知'
  const packageMode = route.section === 'package'
  const lifecycleLabel = { active: '已启用', inactive: '已停用', archived: '已归档' }[agent.status]
  const updateParams = (update: (next: URLSearchParams) => void) => { const next = new URLSearchParams(location.search); update(next); navigate({ pathname: location.pathname, search: next.toString() ? `?${next}` : '' }) }
  const changeSection = (section: AgentConfigSection) => updateParams((next) => { if (section === 'overview') next.delete('tab'); else next.set('tab', section); if (section === 'package') { const path = getDefaultAgentPackagePath(agent.files); if (path) next.set('path', path); next.set('view', 'preview') } else { next.delete('path'); next.delete('view') } })
  const showFile = (path: string) => updateParams((next) => { next.set('tab', 'package'); next.set('path', path); next.set('view', 'preview') })
  const changeView = (view: AgentFileView) => updateParams((next) => next.set('view', view))
  const activeMode = packageMode ? 'package' : 'management'

  return <>
    <PageHeader backTo="/agents" backLabel="返回 Agent 列表" leading={<AgentAvatar agent={agent} className="size-12 text-lg" />} title={agent.name} description={identitySummary} action={<div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => dispatch({ type: 'OPEN_DIALOG', dialog: { kind: 'source', agentId: agent.id, section: route.section } })}><Search size={16} aria-hidden="true" />诊断来源</Button><AiClientLaunchAction agentId={agent.id} agentName={agent.name} disabled={agent.status !== 'active'} /></div>} />
    <section aria-label="Agent 状态与视图" className="panel mb-5 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div className="min-w-0 max-w-3xl"><div className="flex flex-wrap gap-2"><StatusBadge tone={toneForStatus(agent.status)}>{lifecycleLabel}</StatusBadge><StatusBadge tone={configStatus?.level === 'healthy' ? 'success' : configStatus?.level === 'warning' ? 'warning' : configStatus?.level === 'unknown' ? 'neutral' : 'danger'}>{configStatus?.label}</StatusBadge></div><p className="mt-3 leading-7 text-muted-foreground">{agent.mission || '尚未设置职责说明'}</p><div className="mt-2"><MonoPath>{agent.packagePath}</MonoPath></div></div>
        <EntityTabs tabs={[{ id: 'management', label: '管理视图' }, { id: 'package', label: '原始文件' }]} active={activeMode} onChange={(mode) => changeSection(mode === 'package' ? 'package' : 'overview')} scope="agent-mode" ariaLabel="Agent 配置视图" variant="segmented" />
      </div>
    </section>
    {routeNotice && <div role="status" className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/8 p-3 text-sm"><span>{routeNotice}</span><button type="button" className="min-h-11 rounded px-3 text-xs font-medium hover:bg-warning/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setRouteNotice(undefined)}>知道了</button></div>}
    <EntityTabPanel tabId="management" activeTab={activeMode} scope="agent-mode"><div className="grid min-w-0 gap-5 xl:grid-cols-[260px_minmax(0,1fr)]"><aside className="panel h-fit p-3"><AgentConfigNavigation active={route.section === 'package' ? 'overview' : route.section} onSelect={changeSection} /></aside><section aria-label={`${route.section} 配置`} className="min-w-0"><AgentConfigContent section={route.section} agent={agent} /></section></div></EntityTabPanel>
    <EntityTabPanel tabId="package" activeTab={activeMode} scope="agent-mode"><section aria-label="Agent 配置"><AgentPackageBrowser agent={agent} context={projectionContext} path={route.path} view={route.view} onSelect={showFile} onView={changeView} /></section></EntityTabPanel>
    {activeMode === 'management' && <AgentDangerZone agent={agent} />}
  </>
}

function AgentConfigContent({ section, agent }: { section: AgentConfigSection; agent: FullAgent }) {
  const { state } = useApp()
  if (section === 'overview') return <Overview agent={agent} />
  if (state.runtime === 'desktop') {
    const editability = getAgentPackageEditability(agent.packageSchema)
    const reason = agent.packageSource.kind === 'external-reference'
      ? '历史外部引用仅支持查看已有记录，不再支持添加或编辑。'
      : agent.packageSource.kind === 'bandi-demo'
        ? '演示 Agent 不属于 Desktop 正式可写配置。'
        : editability.editable
          ? undefined
          : editability.reason
    if (reason) return <ReadOnlyAgentConfig reason={reason} />
  }
  if (section === 'identity') return <IdentityTab agent={agent} />
  if (section === 'instructions') return <InstructionsTab agent={agent} />
  if (section === 'context') return <ContextTab agent={agent} />
  if (section === 'skills') return <SkillReferencesTab agent={agent} />
  if (section === 'memory') return <MemoryTab agent={agent} />
  if (section === 'rules') return <RulesTab agent={agent} />
  if (section === 'mcp') return <RulesTab agent={agent} mode="mcp" />
  if (section === 'permissions') return <PermissionsTab agent={agent} />
  return <SopTab agent={agent} />
}

function ReadOnlyAgentConfig({ reason }: { reason: string }) {
  return <section className="panel p-5"><StatusBadge tone="warning">只读</StatusBadge><h3 className="mt-4 font-semibold">当前 Agent 配置不可编辑</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{reason} 可切换到“原始文件”视图查看已有配置内容。</p></section>
}

function Overview({ agent }: { agent: FullAgent }) {
  const { state, dispatch } = useApp()
  const status = getAgentConfigStatus(state, agent)
  const latest = getLatestRevisionForAgent(state, agent.id)
  const externalChange = status.issues.some((issue) => issue.code === 'external-change')
  const memoryCount = state.memorySpaces.filter((item) => item.owner.includes(agent.name)).length
  const configAreas: Array<{ label: string; value: string; state: 'healthy' | 'optional' | 'issue' }> = [
    { label: '身份与职责', value: '完整', state: 'healthy' },
    { label: '主指令', value: agent.instructions ? '完整' : '需要处理', state: agent.instructions ? 'healthy' : 'issue' },
    { label: '上下文', value: agent.contextPolicy.enabled ? '已启用' : '可选 · 已关闭', state: agent.contextPolicy.enabled ? 'healthy' : 'optional' },
    { label: '技能', value: agent.skillRefs.length ? `已引用 ${agent.skillRefs.length} 项` : '可选 · 未配置', state: agent.skillRefs.length ? 'healthy' : 'optional' },
    { label: '长期记忆', value: memoryCount ? `已关联 ${memoryCount} 个空间` : '可选 · 未配置', state: memoryCount ? 'healthy' : 'optional' },
    { label: '规则', value: agent.ruleRefs.length ? `已引用 ${agent.ruleRefs.length} 项` : '可选 · 未配置', state: agent.ruleRefs.length ? 'healthy' : 'optional' },
    { label: '工具连接', value: agent.mcpRefs.length ? `已引用 ${agent.mcpRefs.length} 项` : '可选 · 未配置', state: agent.mcpRefs.length ? 'healthy' : 'optional' },
    { label: '标准流程', value: agent.sopRefs.length ? `已引用 ${agent.sopRefs.length} 项` : '可选 · 未配置', state: agent.sopRefs.length ? 'healthy' : 'optional' },
  ]
  return <section className="panel overflow-hidden"><div className="border-b border-border px-5 py-4">{status.issues.length ? <><div className="label">需要处理</div><ul className="mt-3 space-y-2 text-sm">{status.issues.map((issue, index) => <li key={`${issue.code}-${index}`} className="flex gap-2"><span aria-hidden="true">•</span><span>{issue.label}</span></li>)}</ul></> : <p className="text-sm font-medium text-success">配置完整 · 当前未发现配置缺口</p>}{externalChange && (state.runtime === 'desktop' ? <Button asChild className="mt-4" variant="outline" size="sm"><Link to={`/agents/${agent.id}?tab=instructions`}>打开主指令编辑器</Link></Button> : <Button className="mt-4" variant="outline" size="sm" onClick={() => dispatch({ type: 'OPEN_DIALOG', dialog: { kind: 'diff', agentId: agent.id, path: `${agent.packagePath}instructions.md` } })}><FileDiff size={14} aria-hidden="true" />查看差异</Button>)}</div><div className="border-b border-border p-5"><div className="label">配置状态</div><dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2 2xl:grid-cols-3">{configAreas.map((area) => <div key={area.label} className="min-w-0"><dt className="text-sm font-medium">{area.label}</dt><dd className={`mt-1 text-sm ${area.state === 'issue' ? 'text-danger' : 'text-muted-foreground'}`}>{area.value}</dd></div>)}</dl></div><div className="grid gap-6 p-5 lg:grid-cols-2"><div><div className="label">最近保存</div>{latest ? <><p className="mt-3 text-sm font-medium">最近一次配置版本保存于 {formatDisplayTimestamp(latest.savedAt)}</p><p className="mt-2"><MonoPath>{latest.path}</MonoPath></p></> : <p className="mt-3 text-sm leading-6 text-muted-foreground">首次保存配置后，可在 Agent 配置文件详情中查看和恢复历史版本。</p>}</div><div><div className="label">Agent 配置路径</div><p className="mt-3"><MonoPath>{agent.packagePath}</MonoPath></p><div className="mt-4"><PathActions path={agent.packagePath} /></div></div></div></section>
}

function IdentityTab({ agent }: { agent: FullAgent }) {
  const { state, dispatch } = useApp()
  const [editing, setEditing] = useState(false)
  const [lifecycleTarget, setLifecycleTarget] = useState<FullAgent['status']>()
  const canonical: AgentIdentityConfig = useMemo(() => ({ schemaVersion: 1, id: agent.id, name: agent.name, status: agent.status, teamId: agent.teamId, avatarPath: agent.avatarPath, mission: agent.mission, responsibilities: agent.responsibilities, deliverables: agent.deliverables, decisionBoundaries: agent.decisionBoundaries, escalationConditions: agent.escalationConditions, prohibitions: agent.prohibitions, completionDefinition: agent.completionDefinition }), [agent])
  const [draft, setDraft] = useState(canonical)
  const [avatar, setAvatar] = useState<File>()
  const [removeAvatar, setRemoveAvatar] = useState(false)
  const [saveError, setSaveError] = useState<string | UserFacingError>()
  const [identityEditor, setIdentityEditor] = useState<Awaited<ReturnType<typeof loadManagedAgentIdentity>>>()
  const [identityConflict, setIdentityConflict] = useState<Extract<SaveManagedAgentIdentityResult, { kind: 'baseline_changed' }>>()
  const [recoveryRef, setRecoveryRef] = useState<string>()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [revisions, setRevisions] = useState<ConfigRevisionDto[]>([])
  const [selectedRevision, setSelectedRevision] = useState<ConfigRevisionDto>()
  const [selectedContent, setSelectedContent] = useState('')
  const [restoreConfirmed, setRestoreConfirmed] = useState(false)
  const [lifecycleSaving, setLifecycleSaving] = useState(false)
  const saveRequestId = useRef<string | undefined>(undefined)
  const lifecycleRequestId = useRef<string | undefined>(undefined)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const normalizedName = normalizeAgentName(draft.name)
  const duplicateName = state.agents.some((item) => item.id !== agent.id && normalizeAgentName(item.name).toLocaleLowerCase() === normalizedName.toLocaleLowerCase())
  const nameError = validateAgentName(draft.name) ?? (duplicateName ? '已有同名 Agent，请使用其他名称。' : undefined)
  const managedAvatar = isDesktopRuntime() && agent.packageSource.kind !== 'external-reference' && agent.packageSource.kind !== 'bandi-demo' && agent.packageSchema.compatibility === 'current'
  useEffect(() => { if (!editing) { setDraft(canonical); setAvatar(undefined); setRemoveAvatar(false); setIdentityConflict(undefined) } }, [canonical, editing])
  const dirty = editing && (JSON.stringify(draft) !== JSON.stringify(canonical) || Boolean(avatar) || removeAvatar)
  const reset = () => { setDraft(canonical); setAvatar(undefined); setRemoveAvatar(false); setSaveError(undefined); setIdentityConflict(undefined); setIdentityEditor(undefined); saveRequestId.current = undefined; setEditing(false) }
  const unsavedDialog = useUnsavedChangesGuard({ dirty, resetDraft: reset })
  const update = <K extends keyof AgentIdentityConfig>(key: K, value: AgentIdentityConfig[K]) => setDraft((item) => ({ ...item, [key]: value }))
  const cancel = reset
  const beginEdit = async () => {
    setSaveError(undefined)
    if (managedAvatar) {
      try {
        setIdentityEditor(await loadManagedAgentIdentity(agent.id))
      } catch (error) {
        setSaveError(errorFromCause(error, '无法读取身份配置', '配置没有变化。请检查本地服务后重试。'))
        return
      }
    }
    setEditing(true)
  }
  const updateManagedAgent = (result: Extract<SaveManagedAgentIdentityResult, { kind: 'saved' | 'unchanged' }>, message: string) => {
    const packageSource = agent.packageSource.kind === 'managed-agent-import' || agent.packageSource.kind === 'claude-agent-import'
      ? agent.packageSource
      : { kind: 'bandi-managed' as const, packageId: agent.packageSource.kind === 'bandi-managed' ? agent.packageSource.packageId : `agt_${agent.id}`, strategy: 'managed' as const, identityBaseline: result.baselineRef.assetContentHash }
    dispatch({ type: 'UPSERT_MANAGED_AGENT', agent: { ...result.agent, packageSource }, message })
  }
  const reloadIdentityConflict = async () => {
    if (!identityConflict) return
    try { setIdentityEditor(await loadManagedAgentIdentity(agent.id)); setIdentityConflict(undefined); setSaveError(undefined) }
    catch (error) { setSaveError(error instanceof Error ? error.message : String(error)) }
  }
  const openIdentityHistory = async () => {
    if (!managedAvatar) return
    setHistoryLoading(true); setSaveError(undefined)
    try {
      const loaded = await loadManagedAgentIdentity(agent.id); const items = await listConfigRevisions(loaded.assetId)
      setIdentityEditor(loaded); setRevisions(items); setSelectedRevision(items[0]); setSelectedContent(items[0] ? await readConfigRevisionContent(items[0].id) : ''); setRestoreConfirmed(false); setHistoryOpen(true)
    } catch (error) { setSaveError(error instanceof Error ? error.message : String(error)) }
    finally { setHistoryLoading(false) }
  }
  const selectIdentityRevision = async (revision: ConfigRevisionDto) => {
    setHistoryLoading(true); setSaveError(undefined)
    try { setSelectedRevision(revision); setSelectedContent(await readConfigRevisionContent(revision.id)); setRestoreConfirmed(false) }
    catch (error) { setSaveError(error instanceof Error ? error.message : String(error)) }
    finally { setHistoryLoading(false) }
  }
  const restoreIdentityRevision = async () => {
    if (!identityEditor || !selectedRevision || !restoreConfirmed) return
    setHistoryLoading(true); setSaveError(undefined)
    try {
      const result = await restoreManagedAgentIdentity({ requestId: `restore-identity-${agent.id}`, agentId: agent.id, assetId: identityEditor.assetId, revisionId: selectedRevision.id, expectedBaseline: identityEditor.baselineRef, baseContent: identityEditor.canonicalContent, confirmed: true })
      if (result.kind === 'saved' || result.kind === 'unchanged') { updateManagedAgent(result, result.kind === 'saved' ? '身份与职责已恢复为新的配置版本' : '身份与职责已是目标版本'); setHistoryOpen(false); setSelectedRevision(undefined); setRevisions([]); setIdentityEditor(undefined) }
      else if (result.kind === 'baseline_changed') { setHistoryOpen(false); setEditing(true); setIdentityConflict(result); setSaveError('agent.yaml 已在恢复确认后发生变化。请基于磁盘当前内容重新核对。') }
      else setSaveError(result.diagnostics.map((item) => item.message).join('；') || '身份版本恢复失败')
    } catch (error) { setSaveError(error instanceof Error ? error.message : String(error)) }
    finally { setHistoryLoading(false) }
  }
  const recoverIdentityRevision = async () => {
    if (!identityEditor || !recoveryRef) return
    try {
      const result = await recoverManagedAgentIdentity({ requestId: `recover-identity-${agent.id}`, agentId: agent.id, assetId: identityEditor.assetId, recoveryRef })
      if (result.kind === 'saved' || result.kind === 'unchanged') { updateManagedAgent(result, '身份与职责配置版本已补记'); setRecoveryRef(undefined); setIdentityEditor(undefined); setEditing(false) }
      else setSaveError(result.diagnostics.map((item) => item.message).join('；') || '配置版本补记失败')
    } catch (error) { setSaveError(error instanceof Error ? error.message : String(error)) }
  }
  const saveLifecycle = async () => {
    if (!lifecycleTarget) return
    if (!managedAvatar) { dispatch({ type: 'SET_AGENT_LIFECYCLE', agentId: agent.id, status: lifecycleTarget }); setLifecycleTarget(undefined); return }
    setLifecycleSaving(true); setSaveError(undefined)
    try {
      const value = { ...canonical, status: lifecycleTarget }; const applied = applyAgentConfig(agent, { kind: 'identity', value }); const manifest = serializeAgentConfig(agent, { kind: 'identity', value })
      if (!applied || !manifest) throw new Error('生命周期配置无法序列化')
      const loaded = await loadManagedAgentIdentity(agent.id)
      lifecycleRequestId.current ??= `save-lifecycle-${agent.id}-${crypto.randomUUID()}`
      const commit = await commitManagedAgentIdentity(lifecycleRequestId.current, applied, manifest, loaded.baselineRef, loaded.canonicalContent, { kind: 'keep' })
      dispatch({ type: 'SYNC_AGENT_RECOVERY', operation: commit.operation, agent: commit.agent })
      const result = commit.identityResult
      if (result?.kind === 'baseline_changed') { setDraft(value); setIdentityEditor(loaded); setIdentityConflict(result); setEditing(true); setLifecycleTarget(undefined); lifecycleRequestId.current = undefined; setSaveError('agent.yaml 已在生命周期确认期间发生变化。请基于磁盘当前内容重新核对。') }
      else if (result?.kind === 'validation_failed' || result?.kind === 'save_failed') { if (result.kind === 'save_failed' && result.recoveryRef) { setIdentityEditor(loaded); setRecoveryRef(result.recoveryRef) }; setSaveError(result.diagnostics.map((item) => item.message).join('；') || '生命周期保存失败') }
      else if (commit.operation.status !== 'completed' || !commit.agent) { setSaveError(commit.operation.status === 'blocked' ? 'Agent 配置内容已发生变化，系统未自动覆盖；请从配置状态中的待处理项查看。' : '生命周期与组织关系尚未完整保存，可从配置状态中的待处理项继续修复。') }
      else { dispatch({ type: 'UPSERT_MANAGED_AGENT', agent: commit.agent, message: lifecycleTarget === 'archived' ? 'Agent 已归档' : lifecycleTarget === 'inactive' ? 'Agent 已停用' : 'Agent 已重新启用' }); setLifecycleTarget(undefined); lifecycleRequestId.current = undefined }
    } catch (error) { setSaveError(error instanceof Error ? error.message : String(error)) }
    finally { setLifecycleSaving(false) }
  }
  const save = async () => {
    if (!dirty) { setEditing(false); return }
    if (nameError) {
      nameInputRef.current?.focus()
      return
    }
    const value = { ...draft, name: normalizedName, avatarPath: avatar ? 'avatar.png' as const : removeAvatar ? undefined : draft.avatarPath }
    if (!managedAvatar) {
      dispatch({ type: 'SAVE_AGENT_CONFIG', input: { agentId: agent.id, kind: 'identity', value } })
      setEditing(false)
      return
    }
    const applied = applyAgentConfig(agent, { kind: 'identity', value })
    const manifest = serializeAgentConfig(agent, { kind: 'identity', value })
    if (!applied || !manifest) {
      setSaveError('身份配置无法序列化，请修正字段后重试。')
      return
    }
    setSaveError(undefined)
    try {
      const loaded = identityEditor ?? await loadManagedAgentIdentity(agent.id)
      setIdentityEditor(loaded)
      saveRequestId.current ??= `save-identity-${agent.id}-${crypto.randomUUID()}`
      const commit = await commitManagedAgentIdentity(
        saveRequestId.current,
        applied,
        manifest,
        loaded.baselineRef,
        loaded.canonicalContent,
        avatar ? { kind: 'replace', file: avatar } : removeAvatar ? { kind: 'remove' } : { kind: 'keep' },
      )
      dispatch({ type: 'SYNC_AGENT_RECOVERY', operation: commit.operation, agent: commit.agent })
      const result = commit.identityResult
      if (result?.kind === 'baseline_changed') {
        setIdentityConflict(result)
        setSaveError('agent.yaml 已被外部修改。Bandi 不会覆盖当前文件；你的修改仍保留，请比较三方内容后重新编辑。')
        return
      }
      if (result?.kind === 'validation_failed' || result?.kind === 'save_failed') {
        if (result.kind === 'save_failed' && result.recoveryRef) setRecoveryRef(result.recoveryRef)
        setSaveError(result.diagnostics.map((item) => item.message).join('；'))
        return
      }
      if (commit.operation.status !== 'completed' || !commit.agent) {
        setSaveError(commit.operation.status === 'blocked'
          ? 'Agent 配置内容已发生变化，系统未自动覆盖；请从配置状态中的待处理项查看。'
          : '身份与组织关系尚未完整保存，可从配置状态中的待处理项继续修复。')
        return
      }
      dispatch({ type: 'UPSERT_MANAGED_AGENT', agent: commit.agent, message: '身份与职责已保存' })
      saveRequestId.current = undefined
      setEditing(false)
    } catch (error) {
      setSaveError(errorFromCause(error, '无法保存身份与职责', '你的修改仍保留。请检查本地服务后重试。'))
    }
  }
  const copyAgentId = async () => {
    try {
      await navigator.clipboard.writeText(agent.id)
      dispatch({ type: 'SHOW_NOTICE', notice: { tone: 'success', title: 'Agent ID 已复制', description: agent.id } })
    } catch {
      dispatch({ type: 'SHOW_NOTICE', notice: { tone: 'error', title: '复制失败', description: '系统未允许访问剪贴板，请手动选择并复制。' } })
    }
  }
  const displayedAgentId = agent.id.length <= 16 ? agent.id : `${agent.id.slice(0, 8)}…${agent.id.slice(-4)}`
  useRegisterEditorSession(editing ? { id: `agent:${agent.id}:identity`, dirty, canSave: dirty && !nameError, save, cancel } : undefined)
  return <><section className="panel overflow-hidden"><TabHeader title="身份与职责" description="加入 Team 不会自动获得权限。" editing={editing} onEdit={beginEdit} onCancel={cancel} onSave={save} canSave={!nameError} saveLabel={managedAvatar ? '保存' : '保存到当前页面'} />
    <div className="p-5">{editing ? <div className="grid gap-5 sm:grid-cols-2"><AgentAvatarPicker name={draft.name} file={avatar} onChange={(file) => { setAvatar(file); if (file) setRemoveAvatar(false) }} disabled={!managedAvatar} help={managedAvatar ? undefined : '仅受管 Agent 支持替换头像。'} /><Labeled label="名称"><input ref={nameInputRef} value={draft.name} onChange={(e) => update('name', e.target.value)} aria-invalid={Boolean(nameError)} aria-describedby={nameError ? 'agent-name-error' : undefined} className="h-10 w-full px-3" />{nameError && <p id="agent-name-error" className="mt-1 text-xs text-danger">{nameError}</p>}</Labeled><Labeled label="Team"><select value={draft.teamId} onChange={(e) => update('teamId', e.target.value)} className="h-10 w-full px-3">{state.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></Labeled><Labeled label="使命"><textarea value={draft.mission} onChange={(e) => update('mission', e.target.value)} className="min-h-28 w-full p-3" /></Labeled><ListEditor label="主要职责" values={draft.responsibilities} onChange={(value) => update('responsibilities', value)} /><ListEditor label="交付物" values={draft.deliverables} onChange={(value) => update('deliverables', value)} /><ListEditor label="决策边界" values={draft.decisionBoundaries} onChange={(value) => update('decisionBoundaries', value)} /><ListEditor label="升级条件" values={draft.escalationConditions} onChange={(value) => update('escalationConditions', value)} /><ListEditor label="禁止事项" values={draft.prohibitions} onChange={(value) => update('prohibitions', value)} /><ListEditor label="完成定义" values={draft.completionDefinition} onChange={(value) => update('completionDefinition', value)} /></div> : <div><FieldRow label="Agent ID"><div className="flex min-w-0 flex-wrap items-center gap-2"><code className="break-all text-xs" title={agent.id}>{displayedAgentId}</code><Tooltip content="复制完整 Agent ID"><Button type="button" variant="outline" size="sm" aria-label="复制完整 Agent ID" onClick={() => void copyAgentId()}><Copy size={14} aria-hidden="true" />复制</Button></Tooltip></div></FieldRow><FieldRow label="Team">{state.teams.find((team) => team.id === agent.teamId)?.name ?? agent.teamId}</FieldRow><FieldRow label="使命">{agent.mission}</FieldRow><FieldRow label="主要职责">{agent.responsibilities.join('；')}</FieldRow><FieldRow label="交付物">{agent.deliverables.join('；')}</FieldRow><FieldRow label="决策边界">{agent.decisionBoundaries.join('；')}</FieldRow><FieldRow label="升级条件">{agent.escalationConditions.join('；')}</FieldRow><FieldRow label="禁止事项">{agent.prohibitions.join('；')}</FieldRow><FieldRow label="完成定义">{agent.completionDefinition.join('；')}</FieldRow></div>}
      {saveError && (typeof saveError === 'string' ? <div role="alert" className="mt-4 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger"><p>{saveError}</p>{recoveryRef && <Button className="mt-3" variant="outline" size="sm" onClick={recoverIdentityRevision}>补记配置版本</Button>}</div> : <ErrorNotice error={saveError} className="mt-4" />)}
      {identityConflict && <div className="mt-4"><div className="grid gap-3 lg:grid-cols-3" aria-label="身份配置外部变化比较">{([{ label: '原始内容', side: identityConflict.base }, { label: '文件当前内容', side: identityConflict.current }, { label: '你的修改', side: identityConflict.proposed }] as const).map(({ label, side }) => <section key={label} className="min-w-0 rounded-lg border border-border p-3"><b className="text-xs">{label}</b><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs leading-5">{side.content}</pre></section>)}</div><div className="mt-3 flex justify-end"><Button variant="outline" size="sm" onClick={reloadIdentityConflict}>使用文件当前内容继续编辑</Button></div></div>}
      {!editing && <div className="mt-6 flex flex-wrap gap-2"><Button variant="ghost" disabled={historyLoading} onClick={openIdentityHistory}><History size={15} aria-hidden="true" />{historyLoading ? '加载历史中…' : '版本历史'}</Button><Button variant="outline" onClick={() => setLifecycleTarget(agent.status === 'inactive' ? 'active' : 'inactive')}>{agent.status === 'inactive' ? '重新启用' : '停用 Agent'}</Button><Button variant="outline" onClick={() => setLifecycleTarget('archived')}>归档</Button></div>}
    </div></section><AppDialog open={Boolean(lifecycleTarget)} onOpenChange={(open) => { if (!open) setLifecycleTarget(undefined) }} title={lifecycleTarget === 'archived' ? '归档 Agent' : lifecycleTarget === 'inactive' ? '停用 Agent' : '重新启用 Agent'} description="此操作会把 Agent 状态保存到主配置文件。" footer={<><Button variant="outline" onClick={() => setLifecycleTarget(undefined)}>取消</Button><Button variant={lifecycleTarget === 'archived' ? 'danger' : 'default'} disabled={lifecycleSaving} onClick={saveLifecycle}>{lifecycleSaving ? '保存中…' : '确认更新'}</Button></>}><div className="rounded-lg border border-border bg-muted/35 p-4 text-sm leading-6"><b>保留与影响</b><p className="mt-2 text-muted-foreground">Agent 配置、长期记忆和版本历史都会保留。停用或归档后，此 Agent 不再用于新任务；已有引用不会自动删除。</p></div></AppDialog><AppDialog open={historyOpen} onOpenChange={(open) => { setHistoryOpen(open); if (!open) { setSelectedRevision(undefined); setRestoreConfirmed(false) } }} title="身份与职责版本历史" description="历史版本不可变；恢复仅写入完整的 Agent 主配置文件，并生成新的配置版本。头像文件不在历史中。" size="xl" footer={<><Button variant="outline" onClick={() => setHistoryOpen(false)}>关闭</Button><Button disabled={!selectedRevision || selectedContent === identityEditor?.canonicalContent || !restoreConfirmed || historyLoading} onClick={restoreIdentityRevision}>恢复为新版本</Button></>}>
      {revisions.length ? <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]"><div className="space-y-2" role="list" aria-label="身份配置版本">{revisions.map((revision) => <button key={revision.id} type="button" onClick={() => selectIdentityRevision(revision)} className={`w-full rounded-lg border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedRevision?.id === revision.id ? 'border-foreground bg-muted' : 'border-border hover:bg-muted/60'}`}><b className="block truncate text-sm">{revision.id}</b><small className="mt-1 block text-muted-foreground">{formatDisplayTimestamp(revision.savedAt)} · {revision.summary}</small></button>)}</div><div className="min-w-0"><div className="grid gap-3 sm:grid-cols-2"><section className="min-w-0 rounded-lg border border-border"><div className="border-b border-border bg-muted px-3 py-2 text-xs font-semibold">磁盘当前主配置</div><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words p-3 text-xs leading-6">{identityEditor?.canonicalContent}</pre></section><section className="min-w-0 rounded-lg border border-border"><div className="border-b border-border bg-muted px-3 py-2 text-xs font-semibold">{selectedRevision?.id ?? '选择历史版本'}</div><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words p-3 text-xs leading-6">{selectedContent}</pre></section></div><div className="mt-4 rounded-lg border border-warning/30 bg-warning/8 p-3 text-sm">恢复前会再次确认文件未被修改；历史中的头像路径必须与当前固定的 avatar.png 状态一致，否则不会写入。</div>{selectedRevision && selectedContent !== identityEditor?.canonicalContent && <label className="mt-4 flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={restoreConfirmed} onChange={(event) => setRestoreConfirmed(event.target.checked)} /><span>我已核对当前主配置与目标历史内容，确认恢复并生成新版本。</span></label>}</div></div> : <p className="text-sm text-muted-foreground">当前身份与职责暂无配置版本。</p>}
    </AppDialog>{unsavedDialog}</>
}

function InstructionsTab({ agent }: { agent: FullAgent }) {
  const { dispatch } = useApp()
  const desktopManaged = isDesktopRuntime() && agent.packageSource.kind !== 'external-reference' && agent.packageSource.kind !== 'bandi-demo' && agent.packageSchema.compatibility === 'current'
  const [editing, setEditing] = useState(false)
  const [canonical, setCanonical] = useState(agent.instructions)
  const [text, setText] = useState(agent.instructions)
  const [editor, setEditor] = useState<LoadEditorResult>()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const [conflict, setConflict] = useState<Extract<SaveConfigResult, { kind: 'baseline_changed' }>>()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [revisions, setRevisions] = useState<ConfigRevisionDto[]>([])
  const [selectedRevision, setSelectedRevision] = useState<ConfigRevisionDto>()
  const [selectedContent, setSelectedContent] = useState('')
  const [historyLoading, setHistoryLoading] = useState(false)
  const [restoreConfirmed, setRestoreConfirmed] = useState(false)
  const [recoveryRef, setRecoveryRef] = useState<string>()
  useEffect(() => { if (!editing) { setCanonical(agent.instructions); setText(agent.instructions); setEditor(undefined); setConflict(undefined); setError(undefined) } }, [agent.instructions, editing])
  const dirty = editing && text !== canonical
  const reset = () => { setText(canonical); setEditing(false); setEditor(undefined); setConflict(undefined); setError(undefined) }
  const unsavedDialog = useUnsavedChangesGuard({ dirty, resetDraft: reset })
  const beginEditing = async () => {
    if (!desktopManaged) { setEditing(true); return }
    setLoading(true); setError(undefined); setConflict(undefined)
    try {
      const loaded = await loadManagedAgentAssetEditor(agent, agent.id, 'instructions.md', 'instructions', '主指令资产')
      setEditor(loaded); setCanonical(loaded.canonicalContent); setText(loaded.canonicalContent); setEditing(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setLoading(false) }
  }
  const reloadConflictBaseline = async () => {
    if (!editor || !conflict) return
    setLoading(true); setError(undefined)
    try {
      const loaded = await loadConfigEditor({ requestId: `reload-${agent.id}`, assetId: editor.asset.id })
      const proposed = text
      setEditor(loaded); setCanonical(loaded.canonicalContent); setText(proposed); setConflict(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setLoading(false) }
  }
  const loadDesktopEditor = (requestId: string) => loadManagedAgentAssetEditor(agent, requestId, 'instructions.md', 'instructions', '主指令资产')
  const openHistory = async () => {
    if (!desktopManaged) {
      dispatch({ type: 'OPEN_DIALOG', dialog: { kind: 'config-history', ownerType: 'agent', ownerId: agent.id, path: 'instructions.md' } })
      return
    }
    setHistoryLoading(true); setError(undefined)
    try {
      const loaded = await loadDesktopEditor(`history-${agent.id}`)
      const items = await listConfigRevisions(loaded.asset.id)
      setEditor(loaded); setCanonical(loaded.canonicalContent); setText(loaded.canonicalContent)
      setRevisions(items); setSelectedRevision(items[0]); setSelectedContent(items[0] ? await readConfigRevisionContent(items[0].id) : '')
      setRestoreConfirmed(false); setHistoryOpen(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setHistoryLoading(false) }
  }
  const selectRevision = async (revision: ConfigRevisionDto) => {
    setHistoryLoading(true); setError(undefined)
    try {
      setSelectedRevision(revision); setSelectedContent(await readConfigRevisionContent(revision.id)); setRestoreConfirmed(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setHistoryLoading(false) }
  }
  const restoreRevision = async () => {
    if (!editor || !selectedRevision || !restoreConfirmed) return
    setHistoryLoading(true); setError(undefined)
    try {
      const result = await restoreConfigRevision({ requestId: `restore-${agent.id}`, assetId: editor.asset.id, revisionId: selectedRevision.id, expectedBaseline: editor.baselineRef, baseContent: canonical, confirmed: true })
      if (result.kind === 'saved' || result.kind === 'unchanged') {
        dispatch({ type: 'UPSERT_MANAGED_AGENT', agent: { ...agent, instructions: selectedContent }, message: result.kind === 'saved' ? '主指令已恢复为新的配置版本' : '主指令已是目标版本' })
        setCanonical(selectedContent); setText(selectedContent); setHistoryOpen(false); setRevisions([]); setSelectedRevision(undefined)
      } else if (result.kind === 'baseline_changed') {
        setHistoryOpen(false); setEditing(true); setText(selectedContent); setConflict(result); setError('主指令已在恢复确认后发生变化。请基于磁盘当前内容重新核对。')
      } else {
        setError(result.diagnostics.map((item) => item.message).join('；') || '配置版本恢复失败')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setHistoryLoading(false) }
  }
  const save = async () => {
    if (!dirty) { setEditing(false); return }
    if (!desktopManaged) {
      dispatch({ type: 'SAVE_AGENT_CONFIG', input: { agentId: agent.id, kind: 'instructions', value: text } })
      setEditing(false)
      return
    }
    if (!editor) { setError('编辑信息已过期。你的草稿仍保留，请重新打开编辑器后再保存。'); return }
    setSaving(true); setError(undefined); setConflict(undefined)
    try {
      const result = await saveConfig({ requestId: `save-${agent.id}`, assetId: editor.asset.id, expectedOwner: { agentId: agent.id }, change: { kind: 'instructions', value: text }, expectedBaseline: editor.baselineRef, baseContent: canonical })
      if (result.kind === 'saved' || result.kind === 'unchanged') {
        dispatch({ type: 'UPSERT_MANAGED_AGENT', agent: { ...agent, instructions: text }, message: result.kind === 'saved' ? '主指令已保存到 Agent 配置' : '主指令无变化' })
        setCanonical(text); setEditing(false); setEditor(undefined); setRecoveryRef(undefined)
      } else if (result.kind === 'baseline_changed') {
        setConflict(result); setError('主指令已被外部修改。Bandi 不会覆盖当前文件；你的修改仍保留，请比较三方内容后重新编辑。')
      } else {
        const message = result.diagnostics.map((item) => item.message).join('；') || '主指令保存失败'
        if (result.kind === 'save_failed' && result.recoveryRef) setRecoveryRef(result.recoveryRef)
        setError(result.kind === 'save_failed' && result.recoveryRef ? `${message}（恢复引用：${result.recoveryRef}）` : message)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setSaving(false) }
  }
  const recoverRevision = async () => {
    if (!editor || !recoveryRef) return
    setSaving(true); setError(undefined)
    try {
      const result = await recoverConfigRevision({ requestId: `recover-${agent.id}`, assetId: editor.asset.id, recoveryRef })
      if (result.kind === 'saved' || result.kind === 'unchanged') {
        dispatch({ type: 'UPSERT_MANAGED_AGENT', agent: { ...agent, instructions: text }, message: '主指令配置版本已补记' })
        setCanonical(text); setEditing(false); setEditor(undefined); setRecoveryRef(undefined)
      } else {
        setError(result.diagnostics.map((item) => item.message).join('；') || '配置版本补记失败')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setSaving(false) }
  }
  useRegisterEditorSession(editing ? { id: `agent:${agent.id}:instructions`, dirty, canSave: dirty && !saving, save, cancel: reset } : undefined)
  const description = desktopManaged ? `保存位置：${agent.packagePath}instructions.md` : `当前页面保存位置：${agent.packagePath}instructions.md`
  return <><section className="panel overflow-hidden"><TabHeader title="主指令" description={description} editing={editing} onEdit={beginEditing} onCancel={reset} onSave={save} canSave={!saving} saveLabel={desktopManaged ? (saving ? '保存中…' : '保存') : '保存到当前页面'} editDisabled={loading} /><div className="p-5">{loading && <p role="status" className="mb-4 text-sm text-muted-foreground">正在从 Agent 配置加载主指令…</p>}{editing ? <textarea value={text} onChange={(event) => setText(event.target.value)} className="min-h-72 w-full resize-y p-4 text-sm leading-7" aria-label="主指令正文" aria-describedby={error ? 'instructions-save-error' : undefined} /> : <div className="whitespace-pre-wrap rounded-lg bg-muted/40 p-5 text-sm leading-7">{canonical}</div>}{error && <div id="instructions-save-error" role="alert" className="mt-4 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger"><p>{error}</p>{recoveryRef && <Button className="mt-3" variant="outline" size="sm" disabled={saving} onClick={recoverRevision}>{saving ? '补记中…' : '补记配置版本'}</Button>}</div>}{conflict && <div className="mt-4"><div className="grid gap-3 lg:grid-cols-3" aria-label="主指令外部变化比较">{([{ label: '原始内容', side: conflict.base }, { label: '文件当前内容', side: conflict.current }, { label: '你的修改', side: conflict.proposed }] as const).map(({ label, side }) => <section key={label} className="min-w-0 rounded-lg border border-border p-3"><b className="text-xs">{label}</b><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs leading-5">{side.content}</pre></section>)}</div><div className="mt-3 flex justify-end"><Button variant="outline" size="sm" disabled={loading} onClick={reloadConflictBaseline}>{loading ? '重新加载中…' : '使用文件当前内容继续编辑'}</Button></div></div>}<div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"><span>Agent 自有正文 · 显式引用 {agent.ruleRefs.length} 条规则{desktopManaged ? ' · 桌面版受管文件' : ' · 仅当前页面'}</span><div className="flex flex-wrap gap-1"><Button variant="ghost" size="sm" disabled={historyLoading || editing} onClick={openHistory}><History size={14} aria-hidden="true" />{historyLoading ? '加载历史中…' : '版本历史'}</Button>{!isDesktopRuntime() && <Button variant="ghost" size="sm" onClick={() => dispatch({ type: 'OPEN_DIALOG', dialog: { kind: 'diff', agentId: agent.id, path: `${agent.packagePath}instructions.md` } })}><FileDiff size={14} aria-hidden="true" />查看差异</Button>}</div></div></div></section><AppDialog open={historyOpen} onOpenChange={(open) => { setHistoryOpen(open); if (!open) { setSelectedRevision(undefined); setRestoreConfirmed(false) } }} title="主指令版本历史" description="历史版本不可变；恢复会基于磁盘当前内容生成新的配置版本。" size="xl" footer={<><Button variant="outline" onClick={() => setHistoryOpen(false)}>关闭</Button><Button disabled={!selectedRevision || selectedContent === canonical || !restoreConfirmed || historyLoading} onClick={restoreRevision}>恢复为新版本</Button></>}>
      {revisions.length ? <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]"><div className="space-y-2" role="list" aria-label="主指令配置版本">{revisions.map((revision) => <button key={revision.id} type="button" onClick={() => selectRevision(revision)} className={`w-full rounded-lg border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedRevision?.id === revision.id ? 'border-foreground bg-muted' : 'border-border hover:bg-muted/60'}`}><b className="block truncate text-sm">{revision.id}</b><small className="mt-1 block text-muted-foreground">{formatDisplayTimestamp(revision.savedAt)} · {revision.summary}</small>{revision.restoredFromRevisionId && <small className="mt-1 block text-muted-foreground">恢复自 {revision.restoredFromRevisionId}</small>}</button>)}</div><div className="min-w-0"><div className="grid gap-3 sm:grid-cols-2"><section className="min-w-0 rounded-lg border border-border"><div className="border-b border-border bg-muted px-3 py-2 text-xs font-semibold">磁盘当前内容</div><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words p-3 text-xs leading-6">{canonical}</pre></section><section className="min-w-0 rounded-lg border border-border"><div className="border-b border-border bg-muted px-3 py-2 text-xs font-semibold">{selectedRevision?.id ?? '选择历史版本'}</div><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words p-3 text-xs leading-6">{selectedContent}</pre></section></div><div className="mt-4 rounded-lg border border-warning/30 bg-warning/8 p-3 text-sm">恢复前会再次确认文件未被修改；若磁盘发生变化，不会强制覆盖，草稿和历史均保留。</div>{selectedRevision && selectedContent !== canonical && <label className="mt-4 flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={restoreConfirmed} onChange={(event) => setRestoreConfirmed(event.target.checked)} /><span>我已核对磁盘当前内容与目标历史内容，确认恢复并生成新版本。</span></label>}</div></div> : <p className="text-sm text-muted-foreground">当前主指令暂无配置版本。</p>}
    </AppDialog>{unsavedDialog}</>
}

function ContextTab({ agent }: { agent: FullAgent }) {
  const { state, dispatch } = useApp()
  const desktopManaged = isDesktopRuntime() && agent.packageSource.kind !== 'external-reference' && agent.packageSource.kind !== 'bandi-demo' && agent.packageSchema.compatibility === 'current'
  const stateConfig: AgentContextConfig = useMemo(() => ({ policy: { ...agent.contextPolicy }, contextWindowTokens: agent.contextWindowTokens, outputProfileId: agent.outputProfileId, outputParameterBindings: agent.outputParameterBindings }), [agent.contextPolicy, agent.contextWindowTokens, agent.outputParameterBindings, agent.outputProfileId])
  const [canonical, setCanonical] = useState(stateConfig)
  const [canonicalContent, setCanonicalContent] = useState(() => serializeAgentConfig(agent, { kind: 'context', value: stateConfig }) ?? '')
  const [draft, setDraft] = useState(stateConfig)
  const [editor, setEditor] = useState<LoadEditorResult>()
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [conflict, setConflict] = useState<Extract<SaveConfigResult, { kind: 'baseline_changed' }>>()
  const [recoveryRef, setRecoveryRef] = useState<string>()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [revisions, setRevisions] = useState<ConfigRevisionDto[]>([])
  const [selectedRevision, setSelectedRevision] = useState<ConfigRevisionDto>()
  const [selectedContent, setSelectedContent] = useState('')
  const [restoreConfirmed, setRestoreConfirmed] = useState(false)
  useEffect(() => { if (!editing && !historyOpen) { const content = serializeAgentConfig(agent, { kind: 'context', value: stateConfig }) ?? ''; setCanonical(stateConfig); setCanonicalContent(content); setDraft(stateConfig); setEditor(undefined); setConflict(undefined); setError(undefined) } }, [agent, editing, historyOpen, stateConfig])
  const errors = [...validateContextPolicy(draft.policy), ...validateContextWindowTokens(draft.contextWindowTokens)]
  const proposedContent = serializeAgentConfig(agent, { kind: 'context', value: draft }) ?? ''
  const dirty = editing && proposedContent !== canonicalContent
  const reset = () => { setDraft(canonical); setEditing(false); setEditor(undefined); setConflict(undefined); setError(undefined) }
  const unsavedDialog = useUnsavedChangesGuard({ dirty, resetDraft: reset })
  const updatePolicy = <K extends keyof ContextPolicy>(key: K, value: ContextPolicy[K]) => setDraft((item) => ({ ...item, policy: { ...item.policy, [key]: value } }))
  const loadDesktopEditor = (requestId: string) => loadManagedAgentAssetEditor(agent, requestId, 'config/context.yaml', 'context', '上下文策略资产')
  const applyLoaded = (loaded: LoadEditorResult) => {
    const parsed = parseAgentContextConfig(loaded.canonicalContent)
    if (!parsed) throw new Error('无法在当前页面打开 context.yaml。文件内容没有改变，请检查文件格式后重试。')
    setEditor(loaded); setCanonical(parsed); setCanonicalContent(loaded.canonicalContent); setDraft(parsed)
  }
  const beginEditing = async () => {
    if (!desktopManaged) { setEditing(true); return }
    setBusy(true); setError(undefined)
    try { const loaded = await loadDesktopEditor(`context-${agent.id}`); applyLoaded(loaded); setEditing(true) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
  }
  const commitCanonical = (value: AgentContextConfig, message: string) => {
    dispatch({ type: 'UPSERT_MANAGED_AGENT', agent: { ...agent, contextPolicy: value.policy, contextWindowTokens: value.contextWindowTokens, outputProfileId: value.outputProfileId, outputParameterBindings: value.outputParameterBindings ?? [] }, message })
    setCanonical(value); setCanonicalContent(serializeAgentConfig(agent, { kind: 'context', value }) ?? ''); setDraft(value); setEditing(false); setEditor(undefined); setConflict(undefined); setRecoveryRef(undefined)
  }
  const save = async () => {
    if (!dirty || errors.length) { if (!dirty) setEditing(false); return }
    if (!desktopManaged) { dispatch({ type: 'SAVE_AGENT_CONFIG', input: { agentId: agent.id, kind: 'context', value: draft } }); setEditing(false); return }
    if (!editor) { setError('编辑信息已过期。你的修改仍保留，请重新打开编辑器后再保存。'); return }
    setBusy(true); setError(undefined); setConflict(undefined)
    try {
      const result = await saveConfig({ requestId: `save-context-${agent.id}`, assetId: editor.asset.id, expectedOwner: { agentId: agent.id }, change: { kind: 'context', value: proposedContent }, expectedBaseline: editor.baselineRef, baseContent: canonicalContent })
      if (result.kind === 'saved' || result.kind === 'unchanged') commitCanonical(draft, result.kind === 'saved' ? '上下文策略已保存到 Agent 配置' : '上下文策略无变化')
      else if (result.kind === 'baseline_changed') { setConflict(result); setError('context.yaml 已被外部修改。Bandi 不会覆盖当前文件；你的修改仍保留，请比较三方内容后重新编辑。') }
      else { if (result.kind === 'save_failed' && result.recoveryRef) setRecoveryRef(result.recoveryRef); setError(result.diagnostics.map((item) => item.message).join('；')) }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
  }
  const reloadConflict = async () => { if (!editor) return; setBusy(true); try { const loaded = await loadConfigEditor({ requestId: `reload-context-${agent.id}`, assetId: editor.asset.id }); const proposed = draft; applyLoaded(loaded); setDraft(proposed); setConflict(undefined); setError(undefined) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) } }
  const recoverRevision = async () => { if (!editor || !recoveryRef) return; setBusy(true); try { const result = await recoverConfigRevision({ requestId: `recover-context-${agent.id}`, assetId: editor.asset.id, recoveryRef }); if (result.kind === 'saved' || result.kind === 'unchanged') commitCanonical(draft, '上下文策略配置版本已补记'); else setError(result.diagnostics.map((item) => item.message).join('；')) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) } }
  const openHistory = async () => { if (!desktopManaged) { dispatch({ type: 'OPEN_DIALOG', dialog: { kind: 'config-history', ownerType: 'agent', ownerId: agent.id, path: 'config/context.yaml' } }); return } setBusy(true); setError(undefined); try { const loaded = await loadDesktopEditor(`context-history-${agent.id}`); applyLoaded(loaded); const items = await listConfigRevisions(loaded.asset.id); setRevisions(items); setSelectedRevision(items[0]); setSelectedContent(items[0] ? await readConfigRevisionContent(items[0].id) : ''); setRestoreConfirmed(false); setHistoryOpen(true) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) } }
  const selectRevision = async (revision: ConfigRevisionDto) => { setBusy(true); try { setSelectedRevision(revision); setSelectedContent(await readConfigRevisionContent(revision.id)); setRestoreConfirmed(false) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) } }
  const restoreRevision = async () => { if (!editor || !selectedRevision || !restoreConfirmed) return; const parsed = parseAgentContextConfig(selectedContent); if (!parsed) { setError('无法恢复所选版本，因为其内容格式不受当前页面支持。当前配置没有改变。'); return } setBusy(true); try { const result = await restoreConfigRevision({ requestId: `restore-context-${agent.id}`, assetId: editor.asset.id, revisionId: selectedRevision.id, expectedBaseline: editor.baselineRef, baseContent: canonicalContent, confirmed: true }); if (result.kind === 'saved' || result.kind === 'unchanged') { commitCanonical(parsed, result.kind === 'saved' ? '上下文策略已恢复为新的配置版本' : '上下文策略已是目标版本'); setHistoryOpen(false) } else if (result.kind === 'baseline_changed') { setHistoryOpen(false); setEditing(true); setDraft(parsed); setConflict(result); setError('context.yaml 已在恢复确认后发生变化。请重新核对。') } else setError(result.diagnostics.map((item) => item.message).join('；')) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) } }
  useRegisterEditorSession(editing ? { id: `agent:${agent.id}:context`, dirty, canSave: dirty && !errors.length && !busy, save, cancel: reset } : undefined)
  const outputProfiles = state.assets.filter((item) => item.kind === 'OutputProfile' && item.outputProfile)
  const outputProfileName = outputProfiles.find((item) => item.id === canonical.outputProfileId)?.name ?? '未设置'
  const description = `${desktopManaged ? '保存位置' : '当前页面保存位置'}：${agent.packagePath}config/context.yaml`
  const formatTokens = (value: number) => Math.round(value).toLocaleString('zh-CN')
  const triggerTokens = Math.round((editing ? draft.contextWindowTokens : canonical.contextWindowTokens) * (editing ? draft.policy.triggerRatio : canonical.policy.triggerRatio))
  const targetTokens = Math.round((editing ? draft.contextWindowTokens : canonical.contextWindowTokens) * (editing ? draft.policy.targetRatio : canonical.policy.targetRatio))
  return <><section className="panel overflow-hidden"><TabHeader title="上下文" description={description} editing={editing} onEdit={beginEditing} onCancel={reset} onSave={save} canSave={!errors.length && !busy} saveLabel={desktopManaged ? (busy ? '保存中…' : '保存') : '保存到当前页面'} editDisabled={busy} /><div className="p-5"><div className="rounded-lg border border-border bg-muted/35 p-4 text-sm leading-6 text-muted-foreground">这是供兼容的 AI 编程工具读取的长期上下文策略。Bandi 不读取当前会话、Token 使用或压缩次数，也不执行压缩。</div>{editing ? <div className="mt-5 grid gap-5 md:grid-cols-2"><label className="flex items-center gap-3 rounded-lg border border-border p-4 text-sm font-medium"><input type="checkbox" checked={draft.policy.enabled} onChange={(event) => updatePolicy('enabled', event.target.checked)} />启用上下文压缩策略</label><ContextNumberField id="context-window" label="规划上下文窗口（Token）" value={draft.contextWindowTokens} min={1000} max={2000000} onChange={(contextWindowTokens) => setDraft((item) => ({ ...item, contextWindowTokens }))} help="用于估算压缩阈值，不代表模型实际上限或当前会话用量。" /><Labeled label="输出格式"><select className="h-10 w-full px-3" value={draft.outputProfileId ?? ''} onChange={(event) => { const outputProfileId = event.target.value || undefined; setDraft((item) => ({ ...item, outputProfileId, outputParameterBindings: [] })) }}><option value="">未设置</option>{outputProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></Labeled><ContextNumberField id="context-trigger" label="触发比例（%）" value={draft.policy.triggerRatio * 100} min={50} max={95} onChange={(value) => updatePolicy('triggerRatio', value / 100)} help="相对于工具解析出的可用上下文预算。" /><ContextNumberField id="context-target" label="压缩后目标（%）" value={draft.policy.targetRatio * 100} min={20} max={80} onChange={(value) => updatePolicy('targetRatio', value / 100)} help="必须至少比触发比例低 10 个百分点。" /><ContextNumberField id="context-recent" label="保护最近对话轮次" value={draft.policy.protectRecentTurns} min={0} max={20} onChange={(value) => updatePolicy('protectRecentTurns', value)} help="一轮表示一次用户输入及其对应响应。" /><ContextNumberField id="context-opening" label="保护开头对话轮次" value={draft.policy.protectOpeningTurns} min={0} max={10} onChange={(value) => updatePolicy('protectOpeningTurns', value)} help="不会据此读取或修改当前会话。" /><div className="rounded-lg border border-border bg-muted/35 p-3 text-xs leading-5 text-muted-foreground md:col-span-2">{draft.policy.enabled ? `预计约在 ${formatTokens(triggerTokens)} Token（${Math.round(draft.policy.triggerRatio * 100)}%）触发，压缩后目标约 ${formatTokens(targetTokens)} Token。` : '策略已关闭，不会按此规划窗口触发。'} 当前尚未应用到 Claude Code。</div></div> : <div className="mt-5"><FieldRow label="状态">{canonical.policy.enabled ? '已启用' : '已关闭'}</FieldRow><FieldRow label="规划窗口">{formatTokens(canonical.contextWindowTokens)} Token</FieldRow><FieldRow label="预计触发与目标">{canonical.policy.enabled ? `约 ${formatTokens(triggerTokens)} Token（${Math.round(canonical.policy.triggerRatio * 100)}%）→ 约 ${formatTokens(targetTokens)} Token（${Math.round(canonical.policy.targetRatio * 100)}%）` : '策略已关闭'}</FieldRow><FieldRow label="保护最近">{canonical.policy.protectRecentTurns} 轮</FieldRow><FieldRow label="保护开头">{canonical.policy.protectOpeningTurns} 轮</FieldRow><FieldRow label="输出格式">{outputProfileName}</FieldRow><FieldRow label="输出参数">{canonical.outputParameterBindings?.length ? canonical.outputParameterBindings.map((item) => item.parameterId).join('、') : '使用格式默认值'}</FieldRow></div>}{errors.length > 0 && editing && <div id="context-errors" role="alert" className="mt-4 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger"><ul className="list-disc space-y-1 pl-5">{errors.map((item) => <li key={item}>{item}</li>)}</ul></div>}{error && <div role="alert" className="mt-4 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger"><p>{error}</p>{recoveryRef && <Button className="mt-3" variant="outline" size="sm" disabled={busy} onClick={recoverRevision}>补记配置版本</Button>}</div>}{conflict && <div className="mt-4"><div className="grid gap-3 lg:grid-cols-3" aria-label="上下文策略外部变化比较">{([{ label: '原始内容', side: conflict.base }, { label: '文件当前内容', side: conflict.current }, { label: '你的修改', side: conflict.proposed }] as const).map(({ label, side }) => <section key={label} className="min-w-0 rounded-lg border border-border p-3"><b className="text-xs">{label}</b><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs leading-5">{side.content}</pre></section>)}</div><div className="mt-3 flex justify-end"><Button variant="outline" size="sm" disabled={busy} onClick={reloadConflict}>使用文件当前内容继续编辑</Button></div></div>}<div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-xs leading-5 text-muted-foreground">上下文压缩产生的临时摘要不会自动写入长期记忆。需要长期保留的内容，请在“长期记忆”中编辑并保存。</p><Button variant="ghost" size="sm" disabled={busy || editing} onClick={openHistory}><History size={14} aria-hidden="true" />版本历史</Button></div></div></section><AppDialog open={historyOpen} onOpenChange={(open) => { setHistoryOpen(open); if (!open) { setSelectedRevision(undefined); setRestoreConfirmed(false) } }} title="上下文策略版本历史" description="历史版本不可变；恢复会生成新的配置版本，不表示当前会话已应用。" size="xl" footer={<><Button variant="outline" onClick={() => setHistoryOpen(false)}>关闭</Button><Button disabled={!selectedRevision || selectedContent === canonicalContent || !restoreConfirmed || busy} onClick={restoreRevision}>恢复为新版本</Button></>}>
    {revisions.length ? <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]"><div className="space-y-2" role="list" aria-label="上下文策略配置版本">{revisions.map((revision) => <button key={revision.id} type="button" onClick={() => selectRevision(revision)} className={`w-full rounded-lg border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedRevision?.id === revision.id ? 'border-foreground bg-muted' : 'border-border hover:bg-muted/60'}`}><b className="block truncate text-sm">{revision.id}</b><small className="mt-1 block text-muted-foreground">{formatDisplayTimestamp(revision.savedAt)} · {revision.summary}</small></button>)}</div><div className="min-w-0"><div className="grid gap-3 sm:grid-cols-2"><section className="min-w-0 rounded-lg border border-border"><div className="border-b border-border bg-muted px-3 py-2 text-xs font-semibold">磁盘当前内容</div><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words p-3 text-xs leading-6">{canonicalContent}</pre></section><section className="min-w-0 rounded-lg border border-border"><div className="border-b border-border bg-muted px-3 py-2 text-xs font-semibold">{selectedRevision?.id ?? '选择历史版本'}</div><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words p-3 text-xs leading-6">{selectedContent}</pre></section></div>{selectedRevision && selectedContent !== canonicalContent && <label className="mt-4 flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={restoreConfirmed} onChange={(event) => setRestoreConfirmed(event.target.checked)} /><span>我已核对当前内容与目标历史内容，确认恢复并生成新版本。</span></label>}</div></div> : <p className="text-sm text-muted-foreground">当前上下文策略暂无配置版本。</p>}
  </AppDialog>{unsavedDialog}</>
}

function ContextNumberField({ id, label, value, min, max, onChange, help }: { id: string; label: string; value: number; min: number; max: number; onChange: (value: number) => void; help: string }) {
  return <div className="block text-sm font-medium"><label htmlFor={id}>{label}</label><input id={id} type="number" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} aria-describedby={`${id}-help context-errors`} className="mt-2 h-10 w-full px-3" /><span id={`${id}-help`} className="mt-1.5 block text-xs font-normal leading-5 text-muted-foreground">{help}</span></div>
}

function SkillReferencesTab({ agent }: { agent: FullAgent }) {
  return <RulesTab agent={agent} mode="skills" />
}

function RulesTab({ agent, mode = 'rules' }: { agent: FullAgent; mode?: 'rules' | 'skills' | 'mcp' | 'sop' }) {
  const { state, dispatch } = useApp()
  const config = mode === 'rules'
    ? { field: 'ruleRefs' as const, label: '规则', assetKind: 'Rules', parseRefs: parseAgentRuleRefs }
    : mode === 'skills'
      ? { field: 'skillRefs' as const, label: '技能', assetKind: 'Skill', parseRefs: parseAgentSkillRefs }
      : mode === 'mcp'
        ? { field: 'mcpRefs' as const, label: 'MCP', assetKind: 'MCP', parseRefs: parseAgentMcpRefs }
        : { field: 'sopRefs' as const, label: 'SOP', assetKind: 'SOP', parseRefs: parseAgentSopRefs }
  const { field, label, assetKind, parseRefs } = config
  const relativeConfigPath = `config/${mode}.yaml`
  const agentRefs = agent[field]
  const desktopManaged = isDesktopRuntime() && agent.packageSource.kind !== 'external-reference' && agent.packageSource.kind !== 'bandi-demo' && agent.packageSchema.compatibility === 'current'
  const notMaterialized = desktopManaged && !agent.files.some((file) => file.path === relativeConfigPath)
  const [canonical, setCanonical] = useState([...agentRefs])
  const [canonicalContent, setCanonicalContent] = useState(() => serializeAgentConfig(agent, { kind: mode, value: agentRefs }) ?? '')
  const [refs, setRefs] = useState([...agentRefs])
  const [editor, setEditor] = useState<LoadEditorResult>()
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [conflict, setConflict] = useState<Extract<SaveConfigResult, { kind: 'baseline_changed' }>>()
  const [recoveryRef, setRecoveryRef] = useState<string>()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [revisions, setRevisions] = useState<ConfigRevisionDto[]>([])
  const [selectedRevision, setSelectedRevision] = useState<ConfigRevisionDto>()
  const [selectedContent, setSelectedContent] = useState('')
  const [restoreConfirmed, setRestoreConfirmed] = useState(false)
  const candidates = state.assets.filter((item) => item.kind === assetKind).filter((item) => mode !== 'skills' || item.skill?.installation.status !== 'available' || refs.includes(item.id))
  const proposedContent = serializeAgentConfig(agent, { kind: mode, value: refs }) ?? ''
  const emptyDescription = state.runtime === 'desktop'
    ? `当前没有可引用的共享${label}。Desktop 暂不支持创建或导入。`
    : `请先在资产页创建可供当前 Agent 引用的${label}。`
  const dirty = editing && proposedContent !== canonicalContent
  useEffect(() => { if (!editing && !historyOpen) { const content = serializeAgentConfig(agent, { kind: mode, value: agentRefs }) ?? ''; setCanonical([...agentRefs]); setCanonicalContent(content); setRefs([...agentRefs]); setEditor(undefined); setConflict(undefined); setError(undefined) } }, [agent, agentRefs, editing, historyOpen, mode])
  const reset = () => { setRefs([...canonical]); setEditing(false); setEditor(undefined); setConflict(undefined); setError(undefined) }
  const unsavedDialog = useUnsavedChangesGuard({ dirty, resetDraft: reset })
  const toggle = (id: string) => setRefs((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id])
  const loadDesktopEditor = (requestId: string) => loadManagedAgentAssetEditor(agent, requestId, relativeConfigPath, mode, `${label} 引用资产`)
  const applyLoaded = (loaded: LoadEditorResult) => { const parsed = parseRefs(loaded.canonicalContent); if (!parsed) throw new Error(`无法在当前页面打开${label}配置。文件内容没有改变，请检查格式后重试。`); setEditor(loaded); setCanonical(parsed); setCanonicalContent(loaded.canonicalContent); setRefs(parsed) }
  const beginEditing = async () => { if (!desktopManaged) { setEditing(true); return }; setBusy(true); setError(undefined); try { const loaded = await loadDesktopEditor(`${mode}-${agent.id}`); applyLoaded(loaded); setEditing(true) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) } }
  const commitCanonical = (value: string[], content: string, message: string) => { dispatch({ type: 'UPSERT_MANAGED_AGENT', agent: { ...agent, [field]: [...value] }, message }); setCanonical([...value]); setCanonicalContent(content); setRefs([...value]); setEditing(false); setEditor(undefined); setConflict(undefined); setRecoveryRef(undefined) }
  const save = async () => {
    if (!dirty) { setEditing(false); return }
    if (!desktopManaged) { dispatch({ type: 'SAVE_AGENT_CONFIG', input: { agentId: agent.id, kind: mode, value: refs } }); setEditing(false); return }
    if (!editor) { setError(`编辑信息已过期。你的${label}引用修改仍保留，请重新打开编辑器后再保存。`); return }
    setBusy(true); setError(undefined); setConflict(undefined)
    try { const result = await saveConfig({ requestId: `save-${mode}-${agent.id}`, assetId: editor.asset.id, expectedOwner: { agentId: agent.id }, change: { kind: mode, value: proposedContent }, expectedBaseline: editor.baselineRef, baseContent: canonicalContent }); if (result.kind === 'saved' || result.kind === 'unchanged') commitCanonical(refs, proposedContent, result.kind === 'saved' ? `${label} 引用已保存到 Agent 配置` : `${label} 引用无变化`); else if (result.kind === 'baseline_changed') { setConflict(result); setError(`${mode}.yaml 已被外部修改。Bandi 不会覆盖当前文件；你的修改仍保留，请比较三方内容后重新编辑。`) } else { if (result.kind === 'save_failed' && result.recoveryRef) setRecoveryRef(result.recoveryRef); setError(result.diagnostics.map((item) => item.message).join('；')) } } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
  }
  const reloadConflict = async () => { if (!editor) return; setBusy(true); try { const loaded = await loadConfigEditor({ requestId: `reload-${mode}-${agent.id}`, assetId: editor.asset.id }); const proposed = refs; applyLoaded(loaded); setRefs(proposed); setConflict(undefined); setError(undefined) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) } }
  const recoverRevision = async () => { if (!editor || !recoveryRef) return; setBusy(true); try { const result = await recoverConfigRevision({ requestId: `recover-${mode}-${agent.id}`, assetId: editor.asset.id, recoveryRef }); if (result.kind === 'saved' || result.kind === 'unchanged') commitCanonical(refs, proposedContent, `${label} 引用配置版本已补记`); else setError(result.diagnostics.map((item) => item.message).join('；')) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) } }
  const openHistory = async () => { if (!desktopManaged) { dispatch({ type: 'OPEN_DIALOG', dialog: { kind: 'config-history', ownerType: 'agent', ownerId: agent.id, path: relativeConfigPath } }); return }; setBusy(true); setError(undefined); try { const loaded = await loadDesktopEditor(`${mode}-history-${agent.id}`); applyLoaded(loaded); const items = await listConfigRevisions(loaded.asset.id); setRevisions(items); setSelectedRevision(items[0]); setSelectedContent(items[0] ? await readConfigRevisionContent(items[0].id) : ''); setRestoreConfirmed(false); setHistoryOpen(true) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) } }
  const selectRevision = async (revision: ConfigRevisionDto) => { setBusy(true); try { setSelectedRevision(revision); setSelectedContent(await readConfigRevisionContent(revision.id)); setRestoreConfirmed(false) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) } }
  const restoreRevision = async () => { if (!editor || !selectedRevision || !restoreConfirmed) return; const parsed = parseRefs(selectedContent); if (!parsed) { setError('无法恢复所选版本，因为其内容格式不受当前页面支持。当前配置没有改变。'); return }; setBusy(true); try { const result = await restoreConfigRevision({ requestId: `restore-${mode}-${agent.id}`, assetId: editor.asset.id, revisionId: selectedRevision.id, expectedBaseline: editor.baselineRef, baseContent: canonicalContent, confirmed: true }); if (result.kind === 'saved' || result.kind === 'unchanged') { commitCanonical(parsed, selectedContent, result.kind === 'saved' ? `${label} 引用已恢复为新的配置版本` : `${label} 引用已是目标版本`); setHistoryOpen(false) } else if (result.kind === 'baseline_changed') { setHistoryOpen(false); setEditing(true); setRefs(parsed); setConflict(result); setError(`${mode}.yaml 已在恢复确认后发生变化。请重新核对。`) } else setError(result.diagnostics.map((item) => item.message).join('；')) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) } }
  useRegisterEditorSession(editing ? { id: `agent:${agent.id}:${mode}`, dirty, canSave: dirty && !busy, save, cancel: reset } : undefined)
  return <><section className="panel overflow-hidden"><TabHeader title={mode === 'rules' ? '规则' : mode === 'skills' ? '技能' : mode === 'mcp' ? 'MCP' : 'SOP'} description={`${desktopManaged ? '保存位置' : '当前页面保存位置'}：${agent.packagePath}${relativeConfigPath}`} editing={editing} onEdit={beginEditing} onCancel={reset} onSave={save} canSave={!busy} saveLabel={desktopManaged ? (busy ? '保存中…' : '保存') : '保存到当前页面'} editDisabled={busy} />{notMaterialized && !editing && <div className="p-5"><EmptyState title={`尚未创建${label}配置文件`} description={`这是旧版 Agent 配置 的可恢复状态。点击编辑即可开始配置；首次产生变更并保存时会安全创建 ${relativeConfigPath}。`} action={<Button variant="outline" size="sm" disabled={busy} onClick={beginEditing}>开始配置</Button>} /></div>}{candidates.length === 0 && (!notMaterialized || editing) && <div className="p-5"><EmptyState title={`暂无可引用的${label}`} description={state.hydration.sharedAssets === 'loading' ? '正在读取共享资产。' : state.hydration.sharedAssets === 'failed' ? '无法读取共享资产。请返回“配置状态”重试。' : emptyDescription} /></div>}<div className="divide-y divide-border">{candidates.map((asset) => <div key={asset.id} className="flex items-center gap-4 px-5 py-4"><div className="min-w-0 flex-1"><Link to={`/assets/${asset.id}`} className="font-semibold hover:underline">{asset.name}</Link><p className="mt-1 text-xs text-muted-foreground">{asset.sourceType} · {asset.scope} · {asset.path}</p></div>{editing ? <input type="checkbox" checked={refs.includes(asset.id)} onChange={() => toggle(asset.id)} aria-label={`${refs.includes(asset.id) ? '移除' : '添加'} ${asset.name}`} /> : <StatusBadge tone={canonical.includes(asset.id) ? 'success' : 'neutral'}>{canonical.includes(asset.id) ? '已引用' : '未引用'}</StatusBadge>}</div>)}</div>{error && <div role="alert" className="border-t border-danger/30 bg-danger/5 p-4 text-sm text-danger"><p>{error}</p>{recoveryRef && <Button className="mt-3" variant="outline" size="sm" disabled={busy} onClick={recoverRevision}>补记配置版本</Button>}</div>}{conflict && <div className="border-t border-border p-4"><div className="grid gap-3 lg:grid-cols-3" aria-label={`${label} 引用外部变化比较`}>{([{ label: '原始内容', side: conflict.base }, { label: '文件当前内容', side: conflict.current }, { label: '你的修改', side: conflict.proposed }] as const).map(({ label, side }) => <section key={label} className="min-w-0 rounded-lg border border-border p-3"><b className="text-xs">{label}</b><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs leading-5">{side.content}</pre></section>)}</div><div className="mt-3 flex justify-end"><Button variant="outline" size="sm" disabled={busy} onClick={reloadConflict}>使用文件当前内容继续编辑</Button></div></div>}<div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4"><p className="text-xs leading-5 text-muted-foreground">这里只保存引用关系，不会安装、加载或运行 {label}。</p><Button variant="ghost" size="sm" disabled={busy || editing} onClick={openHistory}><History size={14} aria-hidden="true" />版本历史</Button></div></section><AppDialog open={historyOpen} onOpenChange={(open) => { setHistoryOpen(open); if (!open) { setSelectedRevision(undefined); setRestoreConfirmed(false) } }} title={`${label} 引用版本历史`} description={`历史版本不可变；恢复会生成新的配置版本，不会加载或执行 ${label}。`} size="xl" footer={<><Button variant="outline" onClick={() => setHistoryOpen(false)}>关闭</Button><Button disabled={!selectedRevision || selectedContent === canonicalContent || !restoreConfirmed || busy} onClick={restoreRevision}>恢复为新版本</Button></>}>
    {revisions.length ? <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]"><div className="space-y-2" role="list" aria-label={`${label} 引用配置版本`}>{revisions.map((revision) => <button key={revision.id} type="button" onClick={() => selectRevision(revision)} className={`w-full rounded-lg border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedRevision?.id === revision.id ? 'border-foreground bg-muted' : 'border-border hover:bg-muted/60'}`}><b className="block truncate text-sm">{revision.id}</b><small className="mt-1 block text-muted-foreground">{formatDisplayTimestamp(revision.savedAt)} · {revision.summary}</small></button>)}</div><div className="min-w-0"><div className="grid gap-3 sm:grid-cols-2"><section className="min-w-0 rounded-lg border border-border"><div className="border-b border-border bg-muted px-3 py-2 text-xs font-semibold">磁盘当前内容</div><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words p-3 text-xs leading-6">{canonicalContent}</pre></section><section className="min-w-0 rounded-lg border border-border"><div className="border-b border-border bg-muted px-3 py-2 text-xs font-semibold">{selectedRevision?.id ?? '选择历史版本'}</div><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words p-3 text-xs leading-6">{selectedContent}</pre></section></div>{selectedRevision && selectedContent !== canonicalContent && <label className="mt-4 flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={restoreConfirmed} onChange={(event) => setRestoreConfirmed(event.target.checked)} /><span>我已核对当前内容与目标历史内容，确认恢复并生成新版本。</span></label>}</div></div> : <p className="text-sm text-muted-foreground">当前 {label} 引用暂无配置版本。</p>}
  </AppDialog>{unsavedDialog}</>
}

function MemoryTab({ agent }: { agent: FullAgent }) {
  const { state, dispatch } = useApp()
  const space = state.memorySpaces.find((item) => item.scopeKey.agentId === agent.id)
  const [content, setContent] = useState(space?.content ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => setContent(space?.content ?? ''), [space?.content])
  if (!space) return <section className="panel p-5"><EmptyState title="暂无长期记忆" description="该 Agent 尚未建立长期 Memory 空间。" /></section>
  const dirty = content !== space.content
  const save = async () => {
    if (!dirty || saving) return
    if (!isDesktopRuntime()) {
      dispatch({ type: 'SAVE_MEMORY', spaceId: space.id, content })
      return
    }
    setSaving(true); setError('')
    try {
      const result = await saveMemory({ requestId: `save-memory-${agent.id}-${crypto.randomUUID()}`, spaceId: space.id, content })
      if (result.kind === 'saved' || result.kind === 'unchanged') dispatch({ type: 'SAVE_MEMORY', spaceId: space.id, content, revisionId: result.space.currentRevisionId })
      else setError(result.diagnostics.map((item) => item.message).join('；') || '长期记忆保存失败')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setSaving(false) }
  }
  return <section className="panel overflow-hidden"><TabHeader title="长期记忆" description={`保存位置：${space.path}；内容变更时会生成不可修改的新版本。`} editing={true} onEdit={() => {}} onCancel={() => setContent(space.content)} onSave={save} canSave={dirty && !saving} saveLabel={saving ? '保存中…' : isDesktopRuntime() ? '保存' : '保存到当前页面'} /><div className="p-5"><label className="block text-sm font-medium">长期记忆正文<textarea className="mt-2 min-h-72 w-full p-4 font-mono text-sm leading-6" value={content} onChange={(event) => setContent(event.target.value)} /></label>{error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}<div className="mt-4 flex items-center justify-between gap-3"><StatusBadge tone="success">{space.revision}</StatusBadge>{isDesktopRuntime() && <MemoryRevisionHistory spaceId={space.id} currentRevisionId={space.revision} />}</div></div></section>
}

function PermissionsTab({ agent }: { agent: FullAgent }) {
  const { dispatch } = useApp()
  const desktopManaged = isDesktopRuntime() && agent.packageSource.kind !== 'external-reference' && agent.packageSource.kind !== 'bandi-demo' && agent.packageSchema.compatibility === 'current'
  const [editing, setEditing] = useState(false)
  const [canonical, setCanonical] = useState(agent.permissions)
  const [draft, setDraft] = useState(agent.permissions)
  const [canonicalContent, setCanonicalContent] = useState(() => serializeAgentConfig(agent, { kind: 'permissions', value: agent.permissions }) ?? '')
  const [editor, setEditor] = useState<LoadEditorResult>()
  const [challengeRef, setChallengeRef] = useState<string>()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmName, setConfirmName] = useState('')
  const [understood, setUnderstood] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [recoveryRef, setRecoveryRef] = useState<string>()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [revisions, setRevisions] = useState<ConfigRevisionDto[]>([])
  const [selectedRevision, setSelectedRevision] = useState<ConfigRevisionDto>()
  const [selectedContent, setSelectedContent] = useState('')
  const [restoreConfirmed, setRestoreConfirmed] = useState(false)
  const [confirmationAction, setConfirmationAction] = useState<'save' | 'restore'>('save')
  const [conflict, setConflict] = useState<Extract<SaveConfigResult, { kind: 'baseline_changed' }>>()
  const dirty = editing && JSON.stringify(draft) !== JSON.stringify(canonical)
  const proposedContent = serializeAgentConfig(agent, { kind: 'permissions', value: draft }) ?? ''
  useEffect(() => {
    if (editing || historyOpen) return
    const content = serializeAgentConfig(agent, { kind: 'permissions', value: agent.permissions }) ?? ''
    setCanonical(agent.permissions); setDraft(agent.permissions); setCanonicalContent(content); setEditor(undefined); setError(undefined); setConflict(undefined)
  }, [agent, editing, historyOpen])
  const reset = () => { setDraft(canonical); setEditing(false); setEditor(undefined); setChallengeRef(undefined); setConfirmOpen(false); setError(undefined); setConflict(undefined); setRecoveryRef(undefined) }
  const unsavedDialog = useUnsavedChangesGuard({ dirty, resetDraft: reset })
  const loadDesktopEditor = (requestId: string) => loadManagedAgentAssetEditor(agent, requestId, 'config/permissions.yaml', 'permissions', 'Permissions 资产')
  const applyLoaded = (loaded: LoadEditorResult) => {
    const parsed = parseAgentPermissions(loaded.canonicalContent)
    if (!parsed) throw new Error('无法在当前页面打开权限配置。文件内容没有改变，请检查格式后重试。')
    setEditor(loaded); setCanonical(parsed); setDraft(parsed); setCanonicalContent(loaded.canonicalContent)
  }
  const beginEditing = async () => {
    if (!desktopManaged) { setEditing(true); return }
    setBusy(true); setError(undefined)
    try { applyLoaded(await loadDesktopEditor(`permissions-${agent.id}`)); setEditing(true) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  const commitValue = (value: FullAgent['permissions'], content: string, message: string, updateManagedAgent = true) => {
    if (updateManagedAgent) dispatch({ type: 'UPSERT_MANAGED_AGENT', agent: { ...agent, permissions: { ...value } }, message })
    setCanonical({ ...value }); setDraft({ ...value }); setCanonicalContent(content); setEditing(false); setEditor(undefined); setChallengeRef(undefined); setConfirmOpen(false); setConfirmName(''); setUnderstood(false); setConflict(undefined); setRecoveryRef(undefined)
  }
  const commit = (message: string, updateManagedAgent = true) => commitValue(draft, proposedContent, message, updateManagedAgent)
  const handleResult = (result: SaveConfigResult) => {
    if (result.kind === 'saved' || result.kind === 'unchanged') { commit(result.kind === 'saved' ? '长期权限已保存' : '长期权限没有变化'); return }
    if (result.kind === 'confirmation_required') { setChallengeRef(result.challenge.id); setConfirmationAction('save'); setConfirmOpen(true); return }
    if (result.kind === 'baseline_changed') { setConflict(result); setError('permissions.yaml 已在编辑期间发生变化。请基于磁盘当前内容重新编辑。'); return }
    if (result.kind === 'save_failed' && result.recoveryRef) setRecoveryRef(result.recoveryRef)
    setError(result.diagnostics.map((item) => item.message).join('；'))
  }
  const saveDesktop = async (confirmationRef?: string) => {
    if (!editor) { setError('编辑信息已过期。你的权限修改仍保留，请重新打开编辑器后再保存。'); return }
    setBusy(true); setError(undefined); setConflict(undefined)
    try { handleResult(await saveConfig({ requestId: `save-permissions-${agent.id}`, assetId: editor.asset.id, expectedOwner: { agentId: agent.id }, change: { kind: 'permissions', value: proposedContent }, expectedBaseline: editor.baselineRef, baseContent: canonicalContent, confirmationRef })) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  const save = () => {
    if (!dirty) { setEditing(false); return }
    if (desktopManaged) { void saveDesktop(); return }
    if (draft.files === '任意目录') { setConfirmOpen(true); return }
    dispatch({ type: 'SAVE_AGENT_CONFIG', input: { agentId: agent.id, kind: 'permissions', value: draft }, summary: '收紧长期权限' }); commit('长期权限已保存到当前页面', false)
  }
  const restoreRevision = async (confirmationRef?: string) => {
    if (!editor || !selectedRevision) return
    const parsed = parseAgentPermissions(selectedContent)
    if (!parsed) { setError('无法恢复所选权限版本，因为其内容格式不受当前页面支持。当前权限没有改变。'); return }
    setBusy(true); setError(undefined)
    try {
      const result = await restoreConfigRevision({ requestId: `restore-permissions-${agent.id}`, assetId: editor.asset.id, revisionId: selectedRevision.id, expectedBaseline: editor.baselineRef, baseContent: canonicalContent, confirmed: true, confirmationRef })
      if (result.kind === 'saved' || result.kind === 'unchanged') { commitValue(parsed, selectedContent, result.kind === 'saved' ? '长期权限已恢复为新的配置版本' : '长期权限已是目标版本'); setHistoryOpen(false); return }
      if (result.kind === 'confirmation_required') { setChallengeRef(result.challenge.id); setConfirmationAction('restore'); setConfirmOpen(true); return }
      if (result.kind === 'baseline_changed') { setHistoryOpen(false); setEditing(true); setDraft(parsed); setConflict(result); setError('permissions.yaml 已在恢复确认后发生变化。请重新核对。'); return }
      if (result.kind === 'save_failed' && result.recoveryRef) setRecoveryRef(result.recoveryRef)
      setError(result.diagnostics.map((item) => item.message).join('；'))
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  const confirm = async () => {
    if (desktopManaged) { if (challengeRef) { if (confirmationAction === 'restore') await restoreRevision(challengeRef); else await saveDesktop(challengeRef) }; return }
    dispatch({ type: 'SAVE_AGENT_CONFIG', input: { agentId: agent.id, kind: 'permissions', value: draft }, summary: '确认扩大长期权限' }); commit('长期权限已在当前页面扩大', false)
  }
  const openHistory = async () => {
    if (!desktopManaged) { dispatch({ type: 'OPEN_DIALOG', dialog: { kind: 'config-history', ownerType: 'agent', ownerId: agent.id, path: 'config/permissions.yaml' } }); return }
    setBusy(true); setError(undefined)
    try { const loaded = await loadDesktopEditor(`permissions-history-${agent.id}`); applyLoaded(loaded); const items = await listConfigRevisions(loaded.asset.id); setRevisions(items); setSelectedRevision(items[0]); setSelectedContent(items[0] ? await readConfigRevisionContent(items[0].id) : ''); setRestoreConfirmed(false); setHistoryOpen(true) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  const selectRevision = async (revision: ConfigRevisionDto) => { setBusy(true); try { setSelectedRevision(revision); setSelectedContent(await readConfigRevisionContent(revision.id)); setRestoreConfirmed(false) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) } }
  const recoverRevision = async () => { if (!editor || !recoveryRef) return; setBusy(true); try { const result = await recoverConfigRevision({ requestId: `recover-permissions-${agent.id}`, assetId: editor.asset.id, recoveryRef }); if (result.kind === 'saved' || result.kind === 'unchanged') commit('长期权限版本记录已补全'); else setError(result.diagnostics.map((item) => item.message).join('；')) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) } }
  const reloadConflict = async () => {
    if (!editor) return
    setBusy(true)
    try { applyLoaded(await loadConfigEditor({ requestId: `reload-permissions-${agent.id}`, assetId: editor.asset.id })); setConflict(undefined); setError(undefined) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  useRegisterEditorSession(editing ? { id: `agent:${agent.id}:permissions`, dirty, canSave: dirty && !busy, save, cancel: reset } : undefined)
  const confirmed = confirmName.trim() === agent.name && understood
  return <><div className="grid gap-5 lg:grid-cols-2"><section className="panel p-5"><div className="flex items-center gap-2"><ShieldCheck className="text-success" aria-hidden="true" /><b>长期权限</b></div><p className="mt-3 text-sm leading-6 text-muted-foreground">这里设置 Agent 可长期使用的权限范围和默认策略。当前任务中的工具调用，仍需在你选择的 AI 编程工具中授权。</p><FieldRow label="文件写入">{canonical.files === '未授予' ? '默认不允许' : canonical.files}</FieldRow><FieldRow label="命令">{canonical.commands}</FieldRow><FieldRow label="网络">{canonical.network}</FieldRow></section><section className="panel p-5"><div className="label">调整长期权限</div><p className="mt-3 text-sm leading-6 text-muted-foreground">{desktopManaged ? '缩小权限范围可直接保存；扩大范围需要再次确认，但不会批准当前任务中的任何工具调用。' : '浏览器演示只更新当前页面，不会写入真实配置或批准工具调用。'}</p>{editing ? <><label className="mt-5 block text-sm font-medium">文件写入<select value={draft.files} onChange={(event) => setDraft((value) => ({ ...value, files: event.target.value }))} className="mt-2 h-10 w-full px-3"><option value="未授予">默认不允许</option><option>只读当前工作区</option><option>仅当前工作区</option><option>任意目录</option></select></label><div className="mt-4 flex gap-2"><Button variant="outline" disabled={busy} onClick={reset}>取消</Button><Button disabled={!dirty || busy} onClick={save}>{busy ? '保存中…' : desktopManaged ? '保存长期权限' : '保存到当前页面'}</Button></div></> : <Button className="mt-5" variant="outline" disabled={busy} onClick={beginEditing}><KeyRound size={16} aria-hidden="true" />{busy ? '加载中…' : '调整长期权限'}</Button>}</section></div><div className="mt-4 flex justify-end"><Button variant="ghost" size="sm" disabled={busy || editing} onClick={openHistory}><History size={14} aria-hidden="true" />版本历史</Button></div>{error && <div role="alert" className="mt-5 rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm text-danger"><p>{error}</p>{recoveryRef && <Button className="mt-3" variant="outline" size="sm" disabled={busy} onClick={recoverRevision}>补记配置版本</Button>}</div>}{conflict && <div className="mt-5 panel p-4"><div className="grid gap-3 lg:grid-cols-3" aria-label="长期权限外部变化比较">{([{ label: '原始内容', side: conflict.base }, { label: '文件当前内容', side: conflict.current }, { label: '你的修改', side: conflict.proposed }] as const).map(({ label, side }) => <section key={label} className="min-w-0 rounded-lg border border-border p-3"><b className="text-xs">{label}</b><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs leading-5">{side.content}</pre></section>)}</div><div className="mt-3 flex justify-end"><Button variant="outline" size="sm" disabled={busy} onClick={reloadConflict}>加载磁盘当前内容</Button></div></div>}<AppDialog open={confirmOpen} onOpenChange={(open) => { setConfirmOpen(open); if (!open) { setConfirmName(''); setUnderstood(false) } }} title="确认扩大 Agent 长期权限" description={desktopManaged ? '本次确认只用于保存扩大的长期权限，确认信息随后失效。当前任务中的工具调用仍需在所选 AI 编程工具中授权。' : '仅在当前页面更新，不会写入真实配置或批准工具调用。'} footer={<><Button variant="outline" disabled={busy} onClick={() => setConfirmOpen(false)}>返回编辑</Button><Button variant="danger" disabled={!confirmed || busy || (desktopManaged && !challengeRef)} onClick={confirm}>{busy ? '保存中…' : '确认扩大长期权限'}</Button></>}><div className="rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm leading-6"><b>影响范围</b><p className="mt-2 text-muted-foreground">Agent：{agent.name}<br />文件写入：{canonical.files} → {draft.files}<br />{desktopManaged ? '只修改长期权限配置，不会改变当前任务的工具调用权限。' : '仅更新当前页面，刷新后恢复初始状态。'}</p></div><label className="mt-5 block text-sm font-medium" htmlFor="permission-confirm-name">输入 Agent 名称“{agent.name}”确认<input id="permission-confirm-name" className="mt-2 h-10 w-full px-3" value={confirmName} onChange={(event) => setConfirmName(event.target.value)} autoComplete="off" /></label><label className="mt-4 flex items-start gap-3 text-sm leading-6"><input className="mt-1" type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} /><span>我了解这会扩大 Agent 的长期权限，但不会批准当前任务中的工具调用。</span></label></AppDialog><AppDialog open={historyOpen} onOpenChange={(open) => { setHistoryOpen(open); if (!open) { setSelectedRevision(undefined); setRestoreConfirmed(false) } }} title="长期权限版本历史" description="历史版本不可修改。恢复会生成新版本；如果所选版本扩大了权限范围，你需要再次确认。恢复不会批准当前任务中的工具调用。" size="xl" footer={<><Button variant="outline" onClick={() => setHistoryOpen(false)}>关闭</Button><Button disabled={!selectedRevision || selectedContent === canonicalContent || !restoreConfirmed || busy} onClick={() => void restoreRevision()}>恢复为新版本</Button></>}>
    {revisions.length ? <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]"><div className="space-y-2" role="list" aria-label="长期权限配置版本">{revisions.map((revision) => <button key={revision.id} type="button" onClick={() => selectRevision(revision)} className={`w-full rounded-lg border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedRevision?.id === revision.id ? 'border-foreground bg-muted' : 'border-border hover:bg-muted/60'}`}><b className="block truncate text-sm">{revision.id}</b><small className="mt-1 block text-muted-foreground">{formatDisplayTimestamp(revision.savedAt)} · {revision.summary}</small></button>)}</div><div className="min-w-0"><div className="grid gap-3 sm:grid-cols-2"><section className="min-w-0 rounded-lg border border-border"><div className="border-b border-border bg-muted px-3 py-2 text-xs font-semibold">磁盘当前内容</div><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words p-3 text-xs leading-6">{canonicalContent}</pre></section><section className="min-w-0 rounded-lg border border-border"><div className="border-b border-border bg-muted px-3 py-2 text-xs font-semibold">{selectedRevision?.id ?? '选择历史版本'}</div><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words p-3 text-xs leading-6">{selectedContent}</pre></section></div>{selectedRevision && selectedContent !== canonicalContent && <label className="mt-4 flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={restoreConfirmed} onChange={(event) => setRestoreConfirmed(event.target.checked)} /><span>我已核对当前内容与目标历史内容，确认恢复并生成新版本。</span></label>}</div></div> : <p className="text-sm text-muted-foreground">当前长期权限暂无配置版本。</p>}
  </AppDialog>{unsavedDialog}</>
}

function SopTab({ agent }: { agent: FullAgent }) {
  return <RulesTab agent={agent} mode="sop" />
}
function TabHeader({ title, description, editing, onEdit, onCancel, onSave, canSave = true, saveLabel = '保存到当前页面', editDisabled = false }: { title: string; description: string; editing: boolean; onEdit: () => void; onCancel: () => void; onSave: () => void; canSave?: boolean; saveLabel?: string; editDisabled?: boolean }) { return <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/25 px-5 py-4"><div><b>{title}</b><p className="mt-1 text-xs text-muted-foreground">{description}</p></div>{editing ? <div className="flex gap-2"><Button variant="outline" onClick={onCancel}>取消</Button><Button disabled={!canSave} onClick={onSave}><Save size={15} />{saveLabel}</Button></div> : <Button variant="outline" size="sm" disabled={editDisabled} onClick={onEdit}>{editDisabled ? '加载中…' : '编辑'}</Button>}</div> }
function Labeled({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-sm font-medium">{label}<div className="mt-2">{children}</div></label> }
function ListEditor({ label, values, onChange }: { label: string; values: string[]; onChange: (values: string[]) => void }) { return <Labeled label={label}><textarea value={values.join('\n')} onChange={(event) => onChange(event.target.value.split('\n').map((item) => item.trim()).filter(Boolean))} className="min-h-28 w-full p-3" /></Labeled> }
