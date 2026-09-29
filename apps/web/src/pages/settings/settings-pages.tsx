import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '../../components/ui/button'
import { MockBoundaryNote, MonoPath, PageHeader, StatusBadge } from '../../components/app/page'
import { useApp } from '../../state'
import { PersonalizationSection } from './personalization-section'
import { normalizeTerminalId, terminalOptions, type TerminalId } from '../../terminal-model'
import { isDesktopRuntime } from '../../desktop-bridge'
import { DesktopBackupPanel } from './desktop-backup-panel'
import { FactoryResetPanel } from './factory-reset-panel'
import { RemoteBackupPanel } from './remote-backup-panel'
import { useUnsavedChangesGuard } from '../../hooks/use-unsaved-changes-guard'
import { useRegisterEditorSession } from '../../editor-session'

const settingsSections = [['terminal', '终端偏好'], ['recovery', '数据与恢复'], ['appearance', '外观']] as const

export function SettingsPage() {
  const [params, setParams] = useSearchParams()
  const requested = params.get('section')
  const section = requested && settingsSections.some(([id]) => id === requested) ? requested : 'terminal'
  useEffect(() => {
    if (requested === null || requested === section) return
    setParams({}, { replace: true })
  }, [requested, section, setParams])
  const selectSection = (id: typeof settingsSections[number][0]) => setParams(id === 'terminal' ? {} : { section: id })
  return <div>
    <PageHeader title="设置" description="管理终端偏好、本机数据恢复与外观。" />
    <div className="grid min-w-0 gap-5 lg:grid-cols-[180px_minmax(0,1fr)]">
      <nav className="panel h-fit p-2" aria-label="设置分类">{settingsSections.map(([id, label]) => <button type="button" aria-current={section === id ? 'page' : undefined} key={id} onClick={() => selectSection(id)} className={`min-h-11 w-full rounded-md px-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${section === id ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}>{label}</button>)}</nav>
      <div className="min-w-0 max-w-5xl"><SettingsSection section={section} /></div>
    </div>
  </div>
}

function SettingsSection({ section }: { section: string }) {
  if (section === 'terminal') return <TerminalPreferencesSection />
  if (section === 'recovery') return <ConfigurationAndBackupSection />
  return <PersonalizationSection />
}

function TerminalPreferencesSection() {
  const { state, dispatch } = useApp()
  const desktop = isDesktopRuntime()
  const savedTerminal = desktop ? normalizeTerminalId(state.uiPreferences.terminal) : normalizeTerminalId(state.settings.terminal)
  const [draft, setDraft] = useState<Exclude<TerminalId, 'system'>>(savedTerminal)
  const canonicalRef = useRef(savedTerminal)
  const dirty = draft !== savedTerminal

  useEffect(() => {
    if (savedTerminal === canonicalRef.current) return
    canonicalRef.current = savedTerminal
    if (!dirty) setDraft(savedTerminal)
  }, [dirty, savedTerminal])

  const reset = () => setDraft(savedTerminal)
  const save = () => {
    if (!dirty) return
    if (desktop) dispatch({ type: 'UPDATE_UI_PREFERENCES', preferences: { ...state.uiPreferences, terminal: draft } })
    else dispatch({ type: 'UPDATE_SETTINGS', changes: { terminal: draft } })
    canonicalRef.current = draft
  }
  const unsavedDialog = useUnsavedChangesGuard({ dirty, resetDraft: reset })
  useRegisterEditorSession(dirty ? { id: 'settings:terminal', dirty, canSave: true, save, cancel: reset } : undefined)

  return <div className={`space-y-5 ${dirty ? 'pb-28' : 'pb-8'}`}>
    <Panel title="终端偏好">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(220px,320px)] sm:items-start">
        <div><label htmlFor="default-terminal" className="text-sm font-medium">默认终端</label><p className="mt-1 text-xs leading-5 text-muted-foreground">启动需要终端的 AI 工具时使用。</p></div>
        <select id="default-terminal" className="h-11 w-full px-3" value={draft} onChange={(event) => setDraft(event.target.value as Exclude<TerminalId, 'system'>)}>{terminalOptions().map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
      </div>
      <p className="mt-5 border-t border-border pt-4 text-xs leading-5 text-muted-foreground">{desktop ? '仅保存在这台设备；不进入 Agent 配置、版本历史或配置文件快照。' : '当前 Web 演示只保存在页面内存，刷新后恢复默认值。'}</p>
    </Panel>
    {dirty && <UnsavedActions testId="terminal-actions" onCancel={reset} onSave={save} />}
    {unsavedDialog}
  </div>
}

function UnsavedActions({ testId, onCancel, onSave }: { testId: string; onCancel: () => void; onSave: () => void }) {
  return <div data-testid={testId} role="status" aria-live="polite" className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-xl border border-border bg-card/95 p-4 shadow-lg backdrop-blur max-[959px]:static max-[959px]:flex-col max-[959px]:items-stretch"><p className="text-sm text-muted-foreground">有未保存的更改 · 仅当前设备</p><div className="flex gap-2 max-[959px]:grid max-[959px]:grid-cols-2"><Button className="max-[959px]:w-full" variant="outline" onClick={onCancel}>取消</Button><Button className="max-[959px]:w-full" onClick={onSave}>保存更改</Button></div></div>
}

const recoverySectionIds = {
  storage: 'recovery-storage',
  snapshots: 'recovery-snapshots',
  remote: 'recovery-remote',
  reset: 'recovery-reset',
} as const

function ConfigurationAndBackupSection() {
  const { state, dispatch } = useApp()
  const desktop = isDesktopRuntime()
  const [params] = useSearchParams()
  const [agentRootDraft, setAgentRootDraft] = useState(state.settings.agentRoot)
  const requestedTab = params.get('tab') as keyof typeof recoverySectionIds | null

  useEffect(() => {
    if (!requestedTab || !recoverySectionIds[requestedTab]) return
    const target = document.getElementById(recoverySectionIds[requestedTab])
    requestAnimationFrame(() => {
      if (typeof target?.scrollIntoView === 'function') target.scrollIntoView({ block: 'start' })
    })
  }, [requestedTab])

  return <div className="space-y-5 pb-8">
    <section id={recoverySectionIds.storage} className="scroll-mt-24">{desktop ? <LocalAccessBoundaryPanel /> : <StorageLocationPanel value={agentRootDraft} savedValue={state.settings.agentRoot} onChange={setAgentRootDraft} onReset={() => setAgentRootDraft(state.settings.agentRoot)} onSave={() => dispatch({ type: 'UPDATE_SETTINGS', changes: { agentRoot: agentRootDraft } })} />}</section>
    <section id={recoverySectionIds.snapshots} className="scroll-mt-24"><SnapshotRecoveryPanel /></section>
    <section id={recoverySectionIds.remote} className="scroll-mt-24"><RemoteBackupPanel /></section>
    {desktop && <section id={recoverySectionIds.reset} className="scroll-mt-24 rounded-xl border border-danger/25 bg-danger/5 p-1"><FactoryResetPanel /></section>}
  </div>
}

function StorageLocationPanel({ value, savedValue, onChange, onReset, onSave }: { value: string; savedValue: string; onChange: (value: string) => void; onReset: () => void; onSave: () => void }) {
  const { state, dispatch } = useApp()
  const dirty = value !== savedValue
  return <div className="space-y-5"><Panel title="存储位置"><label className="text-sm font-medium">Agent 根目录<input className="mt-2 h-10 w-full px-3" value={value} onChange={(event) => onChange(event.target.value)} /></label><p className="mt-3 text-xs leading-5 text-muted-foreground">所有受管 Agent 配置的统一存放位置。每个 Agent 使用独立目录，不随 Team 或工作区变化。</p><p className="mt-2 text-xs leading-5 text-muted-foreground">保存只更新当前页面，不创建、移动或扫描真实目录。</p><div className="mt-5 flex justify-end gap-2"><Button variant="outline" disabled={!dirty} onClick={onReset}>取消</Button><Button disabled={!dirty} onClick={onSave}>保存演示设置</Button></div></Panel><LocalAccessBoundaryPanel /><Panel title="防止覆盖其他修改"><Select label="演示检查频率" value={state.settings.externalChangeInterval} values={['手动', '5 分钟', '15 分钟']} onChange={(next) => dispatch({ type: 'UPDATE_SETTINGS', changes: { externalChangeInterval: next as typeof state.settings.externalChangeInterval } })} /><p className="mt-3 text-xs leading-5 text-muted-foreground">当配置已被其他终端或编辑器修改时，Bandi 会显示差异并让你选择如何处理，不会自动覆盖。Bandi 不识别或展示工具中的任务状态；浏览器演示不会检查电脑上的文件。</p></Panel></div>
}

function LocalAccessBoundaryPanel() {
  const { state } = useApp()
  const unique = (paths: string[]) => [...new Set(paths.filter(Boolean))]
  const managed = unique(state.agents.filter((agent) => agent.packageSource.kind === 'bandi-managed' || agent.packageSource.kind === 'managed-agent-import' || agent.packageSource.kind === 'claude-agent-import').map((agent) => agent.packagePath.replace(/\/$/, '')))
  const imports = unique(state.agents.flatMap((agent) => agent.packageSource.kind === 'managed-agent-import'
    ? [`${agent.packageSource.toolId} · ${agent.packageSource.sourceFileName}`]
    : agent.packageSource.kind === 'claude-agent-import' ? [agent.packageSource.sourcePath] : []))
  const references = unique(state.agents.flatMap((agent) => agent.packageSource.kind === 'external-reference' ? [agent.packageSource.externalPath] : []))
  const groups = [
    ['Bandi 受管 Agent 配置', managed, 'Bandi 自有受管副本；只在明确保存、恢复等配置操作中写入。'],
    ['Agent 导入来源', imports, '当前仅确认 Claude Code Agent 文件可导入；只在选择、预览和确认导入时读取，后续编辑受管副本，不写回来源。新记录不保存来源绝对路径。'],
    ['历史外部 Agent 引用', references, '仅展示历史记录；不会查找、读取、复制或修改文件夹内容，也不再支持添加。'],
  ] as const
  return <Panel title="本机数据"><p className="text-sm leading-6 text-muted-foreground">这里列出 Bandi 可以处理的受管位置。显示记录不会扩大访问范围。</p><div className="mt-4 divide-y divide-border rounded-lg border border-border">{groups.map(([label, paths, description]) => <section key={label} className="p-4"><div className="flex flex-wrap items-center justify-between gap-2"><b className="text-sm">{label}</b><StatusBadge tone="neutral">{paths.length} 项</StatusBadge></div>{paths.length ? <ul className="mt-3 space-y-2">{paths.map((path) => <li key={path} className="min-w-0 overflow-x-auto rounded-md bg-muted/50 px-3 py-2"><MonoPath>{path}</MonoPath></li>)}</ul> : null}<details className="mt-2"><summary className="cursor-pointer text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">查看访问规则</summary><p className="mt-2 text-xs leading-5 text-muted-foreground">{description}</p></details></section>)}</div><div className="mt-4"><MockBoundaryNote>{state.runtime === 'desktop' ? 'Bandi 不会在首次启动时扫描用户文件。外部文件或目录只在你发起具体操作并通过系统选择器选择后处理。' : '浏览器演示只展示当前页面中的示例数据，不表示浏览器已读取本机文件或获得本机访问权限。'}</MockBoundaryNote></div></Panel>
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) { return <section className="panel p-5"><b>{title}</b><div className="mt-5">{children}</div></section> }
function Select({ label, value, values, onChange }: { label: string; value: string; values: string[]; onChange: (v: string) => void }) { return <label className="block text-sm font-medium">{label}<select className="mt-2 h-10 w-full px-3" value={value} onChange={(e) => onChange(e.target.value)}>{values.map((item) => <option key={item}>{item}</option>)}</select></label> }
function SnapshotRecoveryPanel() {
  if (isDesktopRuntime()) return <><DesktopBackupPanel /><div className="mt-4"><MockBoundaryNote>配置文件快照只保护你明确选择的可写受管配置文件，不包含 Bandi 本机数据、组织与工作区记录、完整 Agent 配置、Agent 长期记忆、个性化或凭据，也不能恢复整个 Bandi。</MockBoundaryNote></div></>
  return <section className="panel p-5"><b>本机快照与恢复</b><p className="mt-2 text-sm leading-6 text-muted-foreground">本机文件快照仅在 Bandi Desktop 可用。浏览器不会读取、创建或恢复本机文件。</p></section>
}
