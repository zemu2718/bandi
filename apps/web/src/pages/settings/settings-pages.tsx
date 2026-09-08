import { useEffect, useRef, useState } from 'react'
import { Info, Plus } from 'lucide-react'
import type { BackupScope, ConfigurationEnvironment } from '../../domain'
import { AppDialog } from '../../components/ui/dialog'
import { Link, useSearchParams } from 'react-router-dom'
import { AiClientManagementSection } from '../../components/ai-clients'
import { Button } from '../../components/ui/button'
import { Switch } from '../../components/ui/switch'
import { EntityTabPanel, EntityTabs, FieldRow, MockBoundaryNote, MonoPath, PageHeader, StatusBadge } from '../../components/app/page'
import { useApp, type NetworkProxySettings } from '../../state'
import { validateNetworkProxy } from '../../network-proxy-model'
import { createDemoSnapshot, buildBackupPreview, describeBackupScope } from '../../backup-policy'
import { configurationEnvironmentPath } from '../../configuration-environment-model'
import { pluginInstallationStatusLabels, pluginScopeLabels } from '../../plugin-installation'
import { PersonalizationSection } from './personalization-section'
import { normalizeTerminalId, terminalOptions } from '../../terminal-model'
import { isDesktopRuntime } from '../../desktop-bridge'
import { DesktopBackupPanel } from './desktop-backup-panel'
import { FactoryResetPanel } from './factory-reset-panel'
import { ToolsConfigurationSection } from './tools-configuration-section'
import { formatDisplayTimestamp } from '../../presentation'

const settingsSections = [['tools', '工具与交接'], ['terminal', '终端'], ['recovery', '数据与恢复'], ['appearance', '外观']] as const
const sectionAliases: Record<string, string> = { 'ai-clients': 'tools', network: 'tools', data: 'recovery', backup: 'recovery' }

export function SettingsPage() {
  const [params, setParams] = useSearchParams()
  const requested = params.get('section') ?? 'tools'
  const section = sectionAliases[requested] ?? (settingsSections.some(([id]) => id === requested) ? requested : 'tools')
  useEffect(() => {
    if (requested === section) return
    setParams(section === 'tools' ? {} : { section }, { replace: true })
  }, [requested, section, setParams])
  const usesTabbedWorkspace = section === 'appearance' || section === 'recovery'
  return <div className={usesTabbedWorkspace ? 'lg:flex lg:h-[calc(100dvh-6.5rem)] lg:min-h-0 lg:flex-col lg:overflow-hidden min-[1281px]:h-[calc(100dvh-7rem)]' : undefined}>
    <PageHeader title="设置" description="管理工具交接、终端偏好、本机数据恢复与外观。" />
    <div className={`grid min-w-0 gap-5 lg:grid-cols-[220px_minmax(0,1fr)] ${usesTabbedWorkspace ? 'lg:min-h-0 lg:flex-1' : ''}`}>
      <nav className="panel h-fit p-2" aria-label="设置分类">{settingsSections.map(([id, label]) => <button type="button" aria-current={section === id ? 'page' : undefined} key={id} onClick={() => setParams(id === 'tools' ? {} : { section: id })} className={`w-full rounded-md px-3 py-2.5 text-left text-sm ${section === id ? 'bg-foreground font-medium text-background' : 'hover:bg-muted'}`}>{label}</button>)}</nav>
      <div className={`min-w-0 ${usesTabbedWorkspace ? 'lg:min-h-0' : 'space-y-5'}`}><SettingsSection section={section} /></div>
    </div>
  </div>
}

function SettingsSection({ section }: { section: string }) {
  const { state, dispatch } = useApp()
  const desktop = isDesktopRuntime()
  if (section === 'tools') return <>{desktop ? <ToolsConfigurationSection /> : <AiClientManagementSection />}{!desktop && <><NetworkProxyPanel /><PluginInstallationSummary /></>}</>
  if (section === 'terminal') {
    const savedTerminal = desktop ? normalizeTerminalId(state.uiPreferences.terminal) : normalizeTerminalId(state.settings.terminal)
    return <SettingsDraftPanel key="terminal" title="终端" saveLabel={desktop ? '保存终端偏好' : '保存演示设置'} fields={{ terminal: savedTerminal }} onSave={(changes) => desktop ? dispatch({ type: 'UPDATE_UI_PREFERENCES', preferences: { ...state.uiPreferences, terminal: changes.terminal } }) : dispatch({ type: 'UPDATE_SETTINGS', changes })}>{({ draft, update }) => <><label className="block text-sm font-medium">默认终端<select className="mt-2 h-10 w-full px-3" value={draft.terminal} onChange={(event) => update('terminal', event.target.value as typeof draft.terminal)}>{terminalOptions().map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><p className="mt-3 text-xs leading-5 text-muted-foreground">{desktop ? '保存在当前设备的白名单界面偏好中；不进入 Agent 配置、版本历史或配置文件快照。' : '当前选择只保存在页面内存，刷新后恢复默认值；Web 请复制路径后手动继续。'}</p></>}</SettingsDraftPanel>
  }
  if (section === 'recovery') return <ConfigurationAndBackupSection />
  return <PersonalizationSection />
}

const webDataTabs = [
  { id: 'profiles', label: '配置方案' },
  { id: 'storage', label: '存储位置' },
  { id: 'snapshots', label: '快照与恢复' },
  { id: 'remote', label: '远程备份' },
] as const
const desktopDataTabs = [
  { id: 'storage', label: '本地数据' },
  { id: 'snapshots', label: '配置文件快照' },
  { id: 'restart', label: '重新开始' },
] as const

type DataTabId = typeof webDataTabs[number]['id']

function ConfigurationAndBackupSection() {
  const { state, dispatch } = useApp()
  const desktop = isDesktopRuntime()
  const tabs = desktop ? desktopDataTabs : webDataTabs
  const contentRef = useRef<HTMLDivElement>(null)
  const [activeTab, setActiveTab] = useState<DataTabId>(desktop ? 'storage' : 'profiles')
  const [agentRootDraft, setAgentRootDraft] = useState(state.settings.agentRoot)
  const [repositoryDraft, setRepositoryDraft] = useState(state.backupSettings.gitConnection.status === 'connected-demo' ? state.backupSettings.gitConnection.repository : '')
  const showTab = (tab: DataTabId) => {
    setActiveTab(tab)
    if (typeof contentRef.current?.scrollTo === 'function') contentRef.current.scrollTo({ top: 0 })
  }
  return <div className="flex min-h-0 min-w-0 max-w-full flex-col lg:h-full">
    <EntityTabs tabs={[...tabs]} active={activeTab} onChange={(tab) => showTab(tab as DataTabId)} scope="configuration-backup" ariaLabel="配置与备份分类" variant="segmented" className="mb-5 shrink-0" tabListClassName="min-[720px]:w-full min-[720px]:min-w-0 [&>button]:min-[720px]:min-w-0 [&>button]:min-[720px]:flex-1" />
    <div ref={contentRef} data-testid="configuration-backup-scroll-area" className="min-h-0 min-w-0 flex-1 space-y-5 pb-8 lg:overscroll-contain lg:overflow-y-auto lg:pr-2">
      {!desktop && <EntityTabPanel tabId="profiles" activeTab={activeTab} scope="configuration-backup"><ConfigurationProfilesPanel /></EntityTabPanel>}
      <EntityTabPanel tabId="storage" activeTab={activeTab} scope="configuration-backup">{desktop ? <LocalAccessBoundaryPanel /> : <StorageLocationPanel value={agentRootDraft} savedValue={state.settings.agentRoot} onChange={setAgentRootDraft} onReset={() => setAgentRootDraft(state.settings.agentRoot)} onSave={() => dispatch({ type: 'UPDATE_SETTINGS', changes: { agentRoot: agentRootDraft } })} />}</EntityTabPanel>
      <EntityTabPanel tabId="snapshots" activeTab={activeTab} scope="configuration-backup"><SnapshotRecoveryPanel /></EntityTabPanel>
      {desktop && <EntityTabPanel tabId="restart" activeTab={activeTab} scope="configuration-backup"><RestartPanel /></EntityTabPanel>}
      {!desktop && <EntityTabPanel tabId="remote" activeTab={activeTab} scope="configuration-backup"><RemoteBackupPanel repository={repositoryDraft} onRepositoryChange={setRepositoryDraft} /></EntityTabPanel>}
    </div>
  </div>
}

function StorageLocationPanel({ value, savedValue, onChange, onReset, onSave }: { value: string; savedValue: string; onChange: (value: string) => void; onReset: () => void; onSave: () => void }) {
  const { state, dispatch } = useApp()
  const dirty = value !== savedValue
  return <div className="space-y-5"><Panel title="存储位置"><label className="text-sm font-medium">Agent 根目录<input className="mt-2 h-10 w-full px-3" value={value} onChange={(event) => onChange(event.target.value)} /></label><p className="mt-3 text-xs leading-5 text-muted-foreground">所有受管 Agent 配置的统一存放位置。每个 Agent 使用独立目录，不随 Team 或工作区变化。</p><p className="mt-2 text-xs leading-5 text-muted-foreground">保存只更新当前页面，不创建、移动或扫描真实目录。</p><div className="mt-5 flex justify-end gap-2"><Button variant="outline" disabled={!dirty} onClick={onReset}>取消</Button><Button disabled={!dirty} onClick={onSave}>保存演示设置</Button></div></Panel><LocalAccessBoundaryPanel /><Panel title="外部变化保护"><Select label="演示检查频率" value={state.settings.externalChangeInterval} values={['手动', '5 分钟', '15 分钟']} onChange={(next) => dispatch({ type: 'UPDATE_SETTINGS', changes: { externalChangeInterval: next as typeof state.settings.externalChangeInterval } })} /><p className="mt-3 text-xs leading-5 text-muted-foreground">多个终端或编辑器的并发修改统一表现为相对编辑基线的外部变化，并通过差异对比处理；Bandi 不识别或展示终端与会话状态。浏览器演示不会执行扫描。</p></Panel></div>
}

function LocalAccessBoundaryPanel() {
  const { state } = useApp()
  const unique = (paths: string[]) => [...new Set(paths.filter(Boolean))]
  const managed = unique(state.agents.filter((agent) => agent.packageSource.kind === 'bandi-managed' || agent.packageSource.kind === 'claude-agent-import').map((agent) => agent.packagePath.replace(/\/$/, '')))
  const imports = unique(state.agents.flatMap((agent) => agent.packageSource.kind === 'claude-agent-import' ? [agent.packageSource.sourcePath] : []))
  const references = unique(state.agents.flatMap((agent) => agent.packageSource.kind === 'external-reference' ? [agent.packageSource.externalPath] : []))
  const groups = [
    ['Bandi 受管 Agent 配置', managed, 'Bandi 自有受管副本；只在明确保存、恢复等配置操作中写入。'],
    ['Agent 导入来源', imports, '当前支持 Claude Code Agent 文件；只在选择、预览和确认导入时读取，后续编辑受管副本，不写回来源。'],
    ['历史外部 Agent 引用', references, '仅展示历史记录；不枚举、读取、复制或修改目录内容，也不再支持添加。'],
  ] as const
  return <Panel title="本地访问边界"><p className="text-sm leading-6 text-muted-foreground">这里展示已有的文件与目录访问边界，不是整盘权限，也不会扩大 Bandi 的访问范围。</p><div className="mt-4 space-y-3">{groups.map(([label, paths, description]) => <section key={label} className="rounded-lg border border-border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><b className="text-sm">{label}</b><StatusBadge tone={paths.length ? 'neutral' : 'warning'}>{paths.length} 项</StatusBadge></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>{paths.length ? <ul className="mt-3 space-y-2">{paths.map((path) => <li key={path} className="min-w-0 overflow-x-auto rounded-md bg-muted/50 px-3 py-2"><MonoPath>{path}</MonoPath></li>)}</ul> : <p className="mt-3 text-xs text-muted-foreground">暂无记录。</p>}</section>)}</div><MockBoundaryNote>{state.runtime === 'desktop' ? 'Bandi 不会在首次启动时扫描用户文件。外部文件或目录只在你发起具体操作并通过系统选择器选择后处理。' : '浏览器演示只展示当前页面中的示例数据，不表示浏览器已读取本机文件或获得本机访问权限。'}</MockBoundaryNote></Panel>
}
function NetworkProxyPanel() {
  const { state, dispatch } = useApp()
  const [draft, setDraft] = useState(state.settings.networkProxy)
  const errors = validateNetworkProxy(draft)
  const dirty = JSON.stringify(draft) !== JSON.stringify(state.settings.networkProxy)
  const update = <K extends keyof NetworkProxySettings>(key: K, value: NetworkProxySettings[K]) => setDraft((current) => ({ ...current, [key]: value }))
  const field = (key: 'httpProxy' | 'httpsProxy' | 'socksProxy', label: string, placeholder: string) => <label className="block text-sm font-medium">{label}<input className="mt-2 h-10 w-full px-3" value={draft[key]} placeholder={placeholder} onChange={(event) => update(key, event.target.value)} aria-invalid={Boolean(errors[key]) || undefined} aria-describedby={errors[key] ? `${key}-error` : undefined} />{errors[key] && <span id={`${key}-error`} className="mt-1.5 block text-xs text-danger">{errors[key]}</span>}</label>
  return <Panel title="网络与代理"><label className="block text-sm font-medium">代理模式<select className="mt-2 h-10 w-full px-3" value={draft.mode} onChange={(event) => update('mode', event.target.value as NetworkProxySettings['mode'])}><option value="system">跟随系统（默认）</option><option value="none">不使用代理</option><option value="manual">手动配置</option></select></label>{draft.mode === 'manual' && <div className="mt-5 grid gap-4 sm:grid-cols-2">{field('httpProxy', 'HTTP 代理', 'http://127.0.0.1:7890')}{field('httpsProxy', 'HTTPS 代理', 'http://127.0.0.1:7890')}{field('socksProxy', 'SOCKS 代理', 'socks5://127.0.0.1:7891')}<label className="block text-sm font-medium">不走代理的地址<textarea className="mt-2 min-h-24 w-full p-3" value={draft.noProxy} onChange={(event) => update('noProxy', event.target.value)} aria-invalid={Boolean(errors.noProxy) || undefined} aria-describedby={errors.noProxy ? 'noProxy-error' : undefined} placeholder={'localhost\n127.0.0.1\n.example.com'} />{errors.noProxy && <span id="noProxy-error" className="mt-1.5 block text-xs text-danger">{errors.noProxy}</span>}</label></div>}<p className="mt-4 text-xs leading-5 text-muted-foreground">“跟随系统”只记录选择意图。当前浏览器演示不读取或应用系统代理，也不修改环境变量或重启进程。</p><div className="mt-5 flex justify-end gap-2"><Button variant="outline" disabled={!dirty} onClick={() => setDraft(state.settings.networkProxy)}>取消</Button><Button disabled={!dirty || Object.keys(errors).length > 0} onClick={() => dispatch({ type: 'UPDATE_SETTINGS', changes: { networkProxy: draft } })}>保存演示设置</Button></div></Panel>
}

function ConfigurationProfilesPanel() {
  const { state, dispatch } = useApp()
  const [createOpen, setCreateOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<ConfigurationEnvironment>()
  const [mode, setMode] = useState<'new' | 'copy'>('new')
  const [name, setName] = useState('')
  const [sourceId, setSourceId] = useState(state.currentConfigurationEnvironmentId)
  const normalizedName = name.trim()
  const duplicateName = state.configurationEnvironments.some((item) => item.id !== renameTarget?.id && item.name.trim().toLowerCase() === normalizedName.toLowerCase())
  const closeEditor = () => { setCreateOpen(false); setRenameTarget(undefined); setMode('new'); setName(''); setSourceId(state.currentConfigurationEnvironmentId) }
  const create = () => {
    if (!normalizedName || duplicateName || (mode === 'copy' && !sourceId)) return
    const suffix = state.configurationEnvironments.length + 1
    const slug = normalizedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    const id = slug && !state.configurationEnvironments.some((item) => item.id === slug) ? slug : `configuration-${suffix}`
    dispatch({ type: 'CREATE_CONFIGURATION_ENVIRONMENT', environment: { id, name: normalizedName, clientIds: [], evidence: 'memory-only' }, sourceEnvironmentId: mode === 'copy' ? sourceId : undefined })
    closeEditor()
  }
  const rename = () => {
    if (!renameTarget || !normalizedName || duplicateName) return
    dispatch({ type: 'SAVE_CONFIGURATION_ENVIRONMENT', environment: { ...renameTarget, name: normalizedName } })
    closeEditor()
  }
  const openRename = (environment: ConfigurationEnvironment) => { setRenameTarget(environment); setName(environment.name) }
  return <><section className="panel overflow-hidden"><div className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-5"><div><b>配置方案</b><p className="mt-1 text-sm leading-6 text-muted-foreground">集中管理方案与版本；工具加入或移出请前往“AI 编程工具”。</p></div><Button onClick={() => setCreateOpen(true)}><Plus size={15} />新建配置方案</Button></div><div className="divide-y divide-border">{state.configurationEnvironments.map((environment) => { const path = configurationEnvironmentPath(environment); const revisions = path ? state.configRevisions.filter((item) => item.ownerType === 'configuration-environment' && item.ownerId === environment.id && item.path === path) : []; const current = environment.id === state.currentConfigurationEnvironmentId; return <div key={environment.id} className="grid gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div><div className="flex flex-wrap items-center gap-2"><b>{environment.name}</b>{current && <StatusBadge tone="success">当前</StatusBadge>}</div><p className="mt-1 text-xs text-muted-foreground">已加入 {environment.clientIds.length} 个工具 · {revisions.length} 个演示版本</p></div><div className="flex flex-wrap gap-2">{!current && <Button size="sm" variant="outline" onClick={() => dispatch({ type: 'SELECT_CONFIGURATION_ENVIRONMENT', environmentId: environment.id })}>切换</Button>}<Button size="sm" variant="outline" onClick={() => openRename(environment)}>重命名</Button><Button size="sm" variant="outline" disabled={!path} onClick={() => path && dispatch({ type: 'OPEN_DIALOG', dialog: { kind: 'config-history', ownerType: 'configuration-environment', ownerId: environment.id, path } })}>查看版本</Button></div></div> })}</div><div className="border-t border-warning/20 bg-warning/8 px-5 py-3 text-xs leading-5 text-warning">方案只保存 Bandi 的名称和工具关联信息，不包含宿主工具真实配置，也不从公司、工作区、Agent 配置或插件自动继承。</div></section><AppDialog open={createOpen || Boolean(renameTarget)} onOpenChange={(open) => { if (!open) closeEditor() }} title={renameTarget ? '重命名配置方案' : '新建配置方案'} description={renameTarget ? '名称变化会形成新版本，方案 ID 保持不变。' : '创建后会切换到新方案；不会初始化或复制真实工具配置。'} footer={<><Button variant="outline" onClick={closeEditor}>取消</Button><Button disabled={!normalizedName || duplicateName || (!renameTarget && mode === 'copy' && !sourceId)} onClick={renameTarget ? rename : create}>{renameTarget ? '保存演示名称' : '创建演示方案'}</Button></>}>
    {!renameTarget && <label className="block text-sm font-medium">创建方式<select className="mt-2 h-10 w-full px-3" value={mode} onChange={(event) => setMode(event.target.value as 'new' | 'copy')}><option value="new">创建空白方案</option><option value="copy">复制现有方案</option></select></label>}
    <label htmlFor="configuration-profile-name" className={`${renameTarget ? '' : 'mt-4 '}block text-sm font-medium`}>方案名称</label><input id="configuration-profile-name" autoFocus className="mt-2 h-10 w-full px-3" value={name} onChange={(event) => setName(event.target.value)} aria-invalid={duplicateName || undefined} aria-describedby={duplicateName ? 'configuration-profile-name-error' : undefined} />{duplicateName && <p id="configuration-profile-name-error" className="mt-2 text-xs text-danger">方案名称已存在。</p>}
    {!renameTarget && mode === 'copy' && <label className="mt-4 block text-sm font-medium">复制来源<select className="mt-2 h-10 w-full px-3" value={sourceId} onChange={(event) => setSourceId(event.target.value)}>{state.configurationEnvironments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    <p className="mt-4 text-xs leading-5 text-muted-foreground">空白方案不预选工具；复制方案只复制工具关联，不复制版本历史、组织关系、存储、备份策略或个性化设置。</p>
  </AppDialog></>
}

function PluginInstallationSummary() { const { state } = useApp(); return <Panel title="插件安装概览"><p className="text-sm leading-6 text-muted-foreground">这里只查看独立的插件安装记录；安装、更新、回滚和卸载统一在插件资产详情管理。</p><div className="mt-4 space-y-2">{state.pluginInstallations.map((installation) => { const plugin = state.assets.find((item) => item.id === installation.pluginId); return <Link key={installation.pluginId} to={`/assets/${installation.pluginId}`} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 hover:bg-muted"><span><b>{plugin?.name ?? installation.pluginId}</b><small className="mt-1 block text-muted-foreground">{installation.installedVersion ?? '未安装'} · {pluginScopeLabels[installation.scope]}级</small></span><StatusBadge tone={installation.compatible && installation.componentsComplete ? installation.status === 'available' ? 'neutral' : 'success' : 'warning'}>{pluginInstallationStatusLabels[installation.status]}</StatusBadge></Link> })}{!state.pluginInstallations.length && <p className="text-sm text-muted-foreground">暂无插件安装记录。</p>}</div><p className="mt-3 text-xs text-muted-foreground">这里只显示安装记录，不表示插件已在当前工具中启用。</p></Panel> }
function Panel({ title, children }: { title: string; children: React.ReactNode }) { return <section className="panel p-5"><b>{title}</b><div className="mt-5">{children}</div></section> }
function SettingsDraftPanel<T extends Record<string, string>>({ title, fields, onSave, children, saveLabel = '保存演示设置' }: { title: string; fields: T; onSave: (changes: T) => void; children: (props: { draft: T; update: <K extends keyof T>(key: K, value: T[K]) => void }) => React.ReactNode; saveLabel?: string }) { const [draft, setDraft] = useState(fields); const dirty = JSON.stringify(draft) !== JSON.stringify(fields); const reset = () => setDraft(fields); return <Panel title={title}>{children({ draft, update: (key, value) => setDraft((current) => ({ ...current, [key]: value })) })}<div className="mt-5 flex justify-end gap-2"><Button variant="outline" disabled={!dirty} onClick={reset}>取消</Button><Button disabled={!dirty} onClick={() => onSave(draft)}>{saveLabel}</Button></div></Panel> }
function Select({ label, value, values, onChange }: { label: string; value: string; values: string[]; onChange: (v: string) => void }) { return <label className="block text-sm font-medium">{label}<select className="mt-2 h-10 w-full px-3" value={value} onChange={(e) => onChange(e.target.value)}>{values.map((item) => <option key={item}>{item}</option>)}</select></label> }
function RestartPanel() {
  return <div className="space-y-5">
    <Panel title="重新查看使用引导"><p className="text-sm leading-6 text-muted-foreground">重新了解 Agent、工作区与工具交接的核心流程，不修改任何现有数据或首次使用状态。</p><Button asChild variant="outline" className="mt-4"><Link to="/guide">查看使用引导</Link></Button></Panel>
    <FactoryResetPanel />
  </div>
}

function SnapshotRecoveryPanel() {
  if (isDesktopRuntime()) return <><DesktopBackupPanel /><MockBoundaryNote>配置文件快照只保护你明确选择的可写受管配置文件，不包含 Bandi 本机数据、组织与工作区记录、完整 Agent 配置、正式记忆、工具方案、个性化或凭据，也不能恢复整个 Bandi。</MockBoundaryNote></>
  return <DemoSnapshotRecoveryPanel />
}

function DemoSnapshotRecoveryPanel() {
  const { state, dispatch } = useApp()
  const [createOpen, setCreateOpen] = useState(false)
  const createTriggerRef = useRef<HTMLButtonElement>(null)
  return <div className="space-y-5"><section className="panel flex flex-wrap items-start justify-between gap-4 p-5"><div><b>快照与恢复</b><p className="mt-1 text-sm leading-6 text-muted-foreground">仅管理当前页面中的备份设置和快照记录；不会读取或写入文件。</p></div><Button ref={createTriggerRef} onClick={() => setCreateOpen(true)}><Plus size={15} />创建快照</Button></section><section className="panel overflow-hidden"><div className="border-b border-border p-5"><b>快照历史</b></div><div className="divide-y divide-border">{state.backupSnapshots.map((snapshot) => <div key={snapshot.id} className="grid min-w-0 gap-4 p-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto]"><div><b>{snapshot.id}</b><p className="mt-1 text-xs text-muted-foreground">{snapshot.kind} · {formatDisplayTimestamp(snapshot.createdAt)}</p><MonoPath>{snapshot.localPath}</MonoPath></div><div className="text-sm text-muted-foreground">{describeBackupScope(snapshot.scope, state)}<small className="mt-1 block">{snapshot.deviceName} · {snapshot.hash} · {snapshot.integrity === 'demo-verified' ? '已校验' : '未校验'}</small><small className="mt-1 block">排除：{snapshot.excludes.join('、')}</small></div><Button variant="outline" size="sm" onClick={() => dispatch({ type: 'OPEN_DIALOG', dialog: { kind: 'backup-restore', snapshotId: snapshot.id } })}>预览恢复</Button></div>)}</div></section><Panel title="自动快照"><div className="flex items-center justify-between gap-4"><div><b className="text-sm">启用自动快照</b><p className="mt-1 text-xs text-muted-foreground">不会启动定时任务或创建文件。</p></div><Switch aria-label="启用自动快照" checked={state.settings.autoSnapshot} onCheckedChange={(autoSnapshot) => dispatch({ type: 'UPDATE_SETTINGS', changes: { autoSnapshot } })} /></div></Panel><CreateBackupDialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) requestAnimationFrame(() => createTriggerRef.current?.focus()) }} /></div>
}

function RemoteBackupPanel({ repository, onRepositoryChange }: { repository: string; onRepositoryChange: (value: string) => void }) {
  const { state, dispatch } = useApp()
  const connect = () => { if (!repository.trim()) return; dispatch({ type: 'UPDATE_BACKUP_SETTINGS', changes: { gitConnection: { status: 'connected-demo', visibility: 'private', repository: repository.trim() } } }) }
  return <div className="space-y-5"><Panel title="Private Git 约束"><FieldRow label="仓库可见性"><StatusBadge tone="success">Private（固定）</StatusBadge></FieldRow><label className="mt-4 block text-sm font-medium">仓库地址<input value={repository} onChange={(event) => onRepositoryChange(event.target.value)} placeholder="github.com/org/private-config" className="mt-2 h-10 w-full px-3" /></label><Button className="mt-4" variant="outline" disabled={!repository.trim()} onClick={connect}>记录 Private Git 连接</Button><p className="mt-3 text-xs text-muted-foreground">不收集凭据、不验证仓库、不执行 Git 或上传。</p><div className="mt-5 flex items-center justify-between gap-4 border-t border-border pt-5"><div><b className="block text-sm">远程备份包含正式记忆</b><p className="mt-1 text-xs text-muted-foreground">当前不会上传；启用后也只记录当前页面中的备份策略。</p></div><Switch aria-label="远程备份包含正式记忆" checked={state.backupSettings.formalMemoryRemote === 'confirmed'} onCheckedChange={(checked) => dispatch({ type: 'UPDATE_BACKUP_SETTINGS', changes: { formalMemoryRemote: checked ? 'confirmed' : 'excluded' } })} /></div></Panel><div className="flex gap-3 rounded-lg border border-warning/30 bg-warning/8 p-4 text-sm"><Info size={18} aria-hidden="true" /><span>凭据、Token、钥匙串、聊天、工具、Todo、日志和执行过程永不备份。</span></div></div>
}

function CreateBackupDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { state, dispatch } = useApp()
  const [step, setStep] = useState<1 | 2>(1)
  const [scope, setScope] = useState<BackupScope>({ kind: 'all' })
  const [filePaths, setFilePaths] = useState<string[]>([])
  const availableFiles = [...new Set(state.agents.flatMap((agent) => agent.files.map((file) => `${agent.id}/${file.path}`)))]
  const effectiveScope: BackupScope = scope.kind === 'files' ? { kind: 'files', paths: filePaths } : scope
  const preview = buildBackupPreview(state, effectiveScope)
  const chooseKind = (kind: BackupScope['kind']) => {
    if (kind === 'team') setScope({ kind, teamId: state.teams[0]?.id ?? '' })
    else if (kind === 'agent') setScope({ kind, agentId: state.agents[0]?.id ?? '' })
    else if (kind === 'files') setScope({ kind, paths: [] })
    else setScope({ kind: 'all' })
  }
  const close = () => { onOpenChange(false); setStep(1); setScope({ kind: 'all' }); setFilePaths([]) }
  const create = () => {
    if (!preview) return
    dispatch({ type: 'CREATE_DEMO_BACKUP_SNAPSHOT', snapshot: createDemoSnapshot(preview, { id: `snap-demo-${String(state.backupSnapshots.length + 1).padStart(3, '0')}`, createdAt: '刚刚', remoteConnected: state.backupSettings.gitConnection.status === 'connected-demo' }) })
    close()
  }
  return <AppDialog open={open} onOpenChange={(next) => { if (!next) close() }} title="创建快照" description={`第 ${step} 步，共 2 步 · ${step === 1 ? '选择范围' : '确认预览'}`} size="lg" footer={<>{step === 2 && <Button variant="outline" onClick={() => setStep(1)}>上一步</Button>}<Button variant="outline" onClick={close}>取消</Button>{step === 1 ? <Button disabled={!preview} onClick={() => setStep(2)}>查看预览</Button> : <Button onClick={create}>确认创建快照</Button>}</>}>
    {step === 1 ? <><label className="block text-sm font-medium">备份范围<select className="mt-2 h-10 w-full px-3" value={scope.kind} onChange={(event) => chooseKind(event.target.value as BackupScope['kind'])}><option value="all">全部配置</option><option value="team">Team</option><option value="agent">Agent</option><option value="files">指定文件</option></select></label>{scope.kind === 'team' && <label className="mt-4 block text-sm font-medium">Team<select className="mt-2 h-10 w-full px-3" value={scope.teamId} onChange={(event) => setScope({ kind: 'team', teamId: event.target.value })}>{state.teams.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}{scope.kind === 'agent' && <label className="mt-4 block text-sm font-medium">Agent<select className="mt-2 h-10 w-full px-3" value={scope.agentId} onChange={(event) => setScope({ kind: 'agent', agentId: event.target.value })}>{state.agents.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}{scope.kind === 'files' && <fieldset className="mt-4"><legend className="text-sm font-medium">指定文件（至少一项）</legend><div className="mt-2 max-h-64 space-y-2 overflow-auto rounded-lg border border-border p-3">{availableFiles.map((path) => <label key={path} className="flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={filePaths.includes(path)} onChange={(event) => setFilePaths((current) => event.target.checked ? [...current, path] : current.filter((item) => item !== path))} /><MonoPath>{path}</MonoPath></label>)}</div>{!filePaths.length && <p className="mt-2 text-xs text-danger">请选择至少一个文件。</p>}</fieldset>}</> : preview && <><FieldRow label="范围">{preview.label}</FieldRow><FieldRow label="将包含">{preview.includes.join('、')}</FieldRow><FieldRow label="正式记忆">当前浏览器演示可展示该策略，但不会读取或打包任何正式记忆文件</FieldRow><FieldRow label="永不包含">{preview.excludes.join('、')}</FieldRow><FieldRow label="本地演示路径"><MonoPath>~/.bandi/backups/snap-demo-...</MonoPath></FieldRow><FieldRow label="远端状态">{state.backupSettings.gitConnection.status === 'connected-demo' ? 'Private Git 演示连接' : '仅本地 · Private Git 未连接'}</FieldRow><MockBoundaryNote>确认后只新增当前页面中的演示记录，不读取、打包、上传或写入文件。</MockBoundaryNote></>}
  </AppDialog>
}
