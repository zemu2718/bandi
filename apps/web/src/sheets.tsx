import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, FileDiff, ShieldAlert } from 'lucide-react'
import { ClientLaunchDialog } from './components/client-launch-dialog'
import { UsageGuideTopicContent, usageGuideTopics } from './components/usage-guide'
import { Button } from './components/ui/button'
import { AppDialog } from './components/ui/dialog'
import { ErrorNotice, errorFromCause, type UserFacingError } from './components/app/error-notice'
import { MonoPath, StatusBadge } from './components/app/page'
import { useApp } from './state'
import { buildBackupPreview, createDemoSnapshot, describeBackupScope } from './backup-policy'
import type { BackupScope } from './domain'
import { generateEntityId, isDesktopRuntime, saveTeamV4 } from './desktop-bridge'
import { formatDisplayTimestamp } from './presentation'
import { normalizeTeamMark, resolveTeamIdentity, TEAM_COLOR_PRESETS } from './team-identity'

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="grid gap-2 border-b border-border py-3 last:border-0 sm:grid-cols-[128px_1fr]"><div className="text-sm text-muted-foreground">{label}</div><div className="min-w-0 break-words text-sm">{children}</div></div>
}

export function GlobalSheets() {
  const { state, dispatch } = useApp()
  const navigate = useNavigate()
  const dialog = state.dialog
  const [confirmName, setConfirmName] = useState('')
  const [understood, setUnderstood] = useState(false)
  const [conflicts, setConflicts] = useState<Record<string, string>>({})
  const [restoreStep, setRestoreStep] = useState<1 | 2 | 3>(1)
  const [restoreScope, setRestoreScope] = useState<BackupScope>({ kind: 'all' })
  const [restoreFiles, setRestoreFiles] = useState<string[]>([])
  const [selectedRevisionId, setSelectedRevisionId] = useState<string>()
  const [restoreConfirmed, setRestoreConfirmed] = useState(false)
  const close = () => dispatch({ type: 'CLOSE_DIALOG' })
  const done = (text: string) => { close(); dispatch({ type: 'TOAST', text }) }

  useEffect(() => {
    setConfirmName('')
    setUnderstood(false)
    setConflicts({})
    setRestoreStep(1)
    setRestoreScope({ kind: 'all' })
    setRestoreFiles([])
    setSelectedRevisionId(undefined)
    setRestoreConfirmed(false)
  }, [dialog?.kind])

  const clientId = dialog?.kind === 'client-guide' ? dialog.clientId ?? 'claude-code' : 'claude-code'
  const client = state.aiClients.find((item) => item.id === clientId)
  const agentId = dialog && 'agentId' in dialog ? dialog.agentId : undefined
  const agent = state.agents.find((item) => item.id === agentId)
  const assetId = dialog && 'assetId' in dialog ? dialog.assetId : undefined
  const asset = state.assets.find((item) => item.id === assetId)
  const path = dialog?.kind === 'diff' && dialog.path ? dialog.path : asset?.path ?? (agent ? `${agent.packagePath}instructions.md` : '未指定路径')

  if (!dialog) return null

  if (dialog.kind === 'usage-guide') {
    const selectTopic = (topic: typeof dialog.topic) => dispatch({ type: 'OPEN_DIALOG', dialog: { kind: 'usage-guide', topic } })
    const openPage = (to: string) => { close(); navigate(to) }
    return <AppDialog open onOpenChange={(open) => { if (!open) close() }} title="使用指南" description="选择一个主题，查看说明和相关页面。" size="xl">
      <div className="grid gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="grid content-start gap-1 sm:grid-cols-2 md:grid-cols-1" aria-label="使用指南主题">
          {usageGuideTopics.map((topic) => <button key={topic.id} type="button" aria-current={dialog.topic === topic.id ? 'page' : undefined} onClick={() => selectTopic(topic.id)} className={`min-h-11 rounded-lg px-4 py-3 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${dialog.topic === topic.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>{topic.navLabel}</button>)}
        </nav>
        <div className="min-w-0 border-border md:border-l md:pl-6">
          <UsageGuideTopicContent topic={dialog.topic} onNavigate={openPage} />
        </div>
      </div>
    </AppDialog>
  }

  if (dialog.kind === 'client-guide') return client ? <ClientLaunchDialog client={client} initialAgentId={agent?.id} close={close} /> : <MissingDialog title="AI 编程工具不存在" close={close} />

  if (dialog.kind === 'config-history') {
    const revisions = state.configRevisions.filter((item) => item.ownerType === dialog.ownerType && item.ownerId === dialog.ownerId && item.path === dialog.path)
    const selected = revisions.find((item) => item.id === selectedRevisionId) ?? revisions[0]
    const current = revisions[0]
    const canRestore = Boolean(selected && selected.id !== current?.id && restoreConfirmed)
    return <AppDialog open onOpenChange={(open) => { if (!open) close() }} title={`配置历史 · ${dialog.path.split('/').at(-1)}`} description="历史版本不可变；恢复会生成一个新版本。" size="xl" footer={<><Button variant="outline" onClick={close}>关闭</Button><Button disabled={!canRestore} onClick={() => selected && dispatch({ type: 'RESTORE_CONFIG_REVISION', revisionId: selected.id })}>恢复为新版本</Button></>}>
      {revisions.length ? <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]"><div className="space-y-2" role="list" aria-label="配置版本">{revisions.map((revision, index) => <button key={revision.id} type="button" onClick={() => { setSelectedRevisionId(revision.id); setRestoreConfirmed(false) }} className={`w-full rounded-lg border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected?.id === revision.id ? 'border-foreground bg-muted' : 'border-border hover:bg-muted/60'}`}><span className="flex items-center justify-between gap-2"><b className="text-sm">{revision.id}</b>{index === 0 && <StatusBadge tone="success">当前</StatusBadge>}</span><small className="mt-1 block text-muted-foreground">{formatDisplayTimestamp(revision.savedAt)} · {revision.summary}</small><small className="mt-1 block text-muted-foreground">{revision.evidence === 'memory-only' ? '仅在当前页面有效' : '初始演示版本'}{revision.parentRevisionId ? ` · 基于版本 ${revision.parentRevisionId}` : ''}</small>{revision.restoredFromRevisionId && <small className="mt-1 block text-muted-foreground">恢复自 {revision.restoredFromRevisionId}</small>}</button>)}</div><div className="min-w-0"><div className="grid gap-3 sm:grid-cols-2"><div className="min-w-0 rounded-lg border border-border"><div className="border-b border-border bg-muted px-3 py-2 text-xs font-semibold">当前版本</div><pre className="max-h-80 overflow-auto whitespace-pre-wrap p-3 text-xs leading-6">{current?.content}</pre></div><div className="min-w-0 rounded-lg border border-border"><div className="border-b border-border bg-muted px-3 py-2 text-xs font-semibold">{selected?.id === current?.id ? '选择一个历史版本比较' : selected?.id}</div><pre className="max-h-80 overflow-auto whitespace-pre-wrap p-3 text-xs leading-6">{selected?.content}</pre></div></div><div className="mt-4 rounded-lg border border-warning/30 bg-warning/8 p-3 text-sm">恢复只会基于上方当前内容与目标内容生成新的配置版本；不会覆盖历史，也不会读取或写入文件。</div>{selected && selected.id !== current?.id && <label className="mt-4 flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={restoreConfirmed} onChange={(event) => setRestoreConfirmed(event.target.checked)} /><span>我已核对当前版本与目标版本的内容差异，确认恢复为新版本。</span></label>}</div></div> : <p className="text-sm text-muted-foreground">当前文件暂无演示版本。长期记忆的版本历史会单独记录。</p>}
    </AppDialog>
  }

  if (dialog.kind === 'source') {
    return <AppDialog open onOpenChange={(open) => { if (!open) close() }} title="配置来源" description={`${agent?.name ?? asset?.name ?? '配置对象'} / ${dialog.section ?? asset?.kind ?? '配置'}`} size="md" footer={<Button onClick={close}>关闭</Button>}>
      <section><div className="label">来源摘要</div><p className="mt-2 text-sm leading-6">当前配置来自 Agent 自有配置和它选择的共享资产。加入 Team 不会自动获得共享配置或权限。</p></section>
      <section className="panel mt-5 p-4"><InfoRow label="自身配置"><MonoPath>{asset?.path ?? agent?.packagePath ?? '—'}</MonoPath></InfoRow><InfoRow label="使用的共享资产">{agent ? `${agent.ruleRefs.length} 项规则 · ${agent.skillRefs.length} 项技能 · ${agent.mcpRefs.length} 项 MCP` : `${asset?.references.length ?? 0} 个使用位置`}</InfoRow><InfoRow label="安全限制">配置被其他位置修改、共享内容受影响或权限扩大时，需要你确认。Agent 不能放宽 Team 或全局安全限制。</InfoRow><InfoRow label="系统事实">{isDesktopRuntime() ? 'Bandi Desktop 根据已加载的本机配置显示以上信息。' : '浏览器演示不读取本机文件，以上为预置数据。'}</InfoRow></section>
      {(agent?.config === '外部变化' || asset?.status.includes('外部')) && <div className="mt-5 rounded-md border border-warning/30 bg-warning/8 p-4 text-sm text-warning">演示配置已在其他位置修改，当前页面尚未重新载入。</div>}
      <Button className="mt-4" variant="outline" onClick={() => dispatch({ type: 'OPEN_DIALOG', dialog: { kind: 'diff', agentId: agent?.id, assetId: asset?.id, path: asset?.path ?? (agent ? `${agent.packagePath}instructions.md` : undefined) } })}><FileDiff size={16} />查看差异</Button>
    </AppDialog>
  }

  if (dialog.kind === 'diff') {
    return <AppDialog open onOpenChange={(open) => { if (!open) close() }} title="检测到外部修改" description={path} size="xl" footer={<><Button variant="outline" onClick={() => done(`当前弹窗已显示待复制的编辑内容：${path} · 未访问剪贴板`)}>查看待复制内容</Button><Button onClick={() => done(`已在当前页面基于外部演示版本继续编辑：${path} · 未覆盖文件`)}>基于外部版本继续</Button></>}>
      <div className="grid gap-3 md:grid-cols-3">{[['编辑起点', '- 交付后汇报'], ['外部版本', '+ 交付后附验证证据'], ['你的编辑', '+ 交付后汇报并记录风险']].map(([title, content]) => <div className="min-w-0 rounded-lg border border-border" key={title}><div className="border-b border-border bg-muted px-3 py-2 text-xs font-semibold">{title}</div><pre className="overflow-x-auto p-3 text-xs leading-6">{content}</pre></div>)}</div><p className="mt-5 text-sm text-muted-foreground">三方内容为预置演示数据；不会读取、覆盖或写入任何文件。</p><Button className="mt-3" variant="outline" onClick={() => dispatch({ type: 'OPEN_DIALOG', dialog: { kind: 'conflict', agentId: agent?.id, assetId: asset?.id } })}>查看冲突演示</Button>
    </AppDialog>
  }

  if (dialog.kind === 'conflict') {
    const allResolved = Boolean(conflicts.a && conflicts.b)
    const choices = (key: string) => <div className="mt-3 flex flex-wrap gap-2">{['外部版本', '我的版本', '手动合并'].map((choice) => <Button key={choice} variant={conflicts[key] === choice ? 'default' : 'outline'} size="sm" onClick={() => setConflicts((value) => ({ ...value, [key]: choice }))}>{choice}</Button>)}</div>
    return <AppDialog open onOpenChange={(open) => { if (!open) close() }} title="解决配置文件冲突" description="同一文本区域被同时修改，无法安全自动合并。" size="lg" footer={<><Button variant="outline" onClick={close}>取消保存</Button><Button disabled={!allResolved} onClick={() => done('2 处示例冲突已逐项处理 · 结果仅在当前页面有效')}>{allResolved ? '完成演示' : `请先解决 ${2 - Object.keys(conflicts).length} 处冲突`}</Button></>}>
      {[['a', '生产发布必须由董事长批准', '生产发布由负责人批准'], ['b', '验证证据必须附在汇报中', '验证证据按需提供']].map(([key, external, mine], index) => <div key={key} className="mb-4 rounded-lg border border-danger/30 bg-danger/5 p-4"><div className="mb-3 flex items-center gap-2 text-danger"><AlertTriangle size={18} /><b>冲突 {index + 1}</b></div><div className="grid gap-3 sm:grid-cols-2"><section className="rounded-md border border-border bg-background p-3"><b className="text-xs">外部版本</b><p className="mt-2 text-xs leading-6">{external}</p></section><section className="rounded-md border border-border bg-background p-3"><b className="text-xs">你的修改</b><p className="mt-2 text-xs leading-6">{mine}</p></section></div>{choices(key)}</div>)}
    </AppDialog>
  }

  if (dialog.kind === 'shared') {
    if (!asset) return <MissingDialog title="共享资产不存在" close={close} />
    const confirmShared = () => {
      if (dialog.changes) dispatch({ type: 'UPDATE_ASSET', assetId: asset.id, changes: dialog.changes, message: dialog.message ?? `共享资产 ${asset.name} 已保存到当前页面；${asset.references.length} 个使用位置未变 · 未写入文件` })
      else dispatch({ type: 'TOAST', text: `已确认共享资产 ${asset.name} 的影响范围；未提交内容变更 · 未写入文件` })
      close()
    }
    return <AppDialog open onOpenChange={(open) => { if (!open) close() }} title="共享配置影响" description={`你正在修改 ${asset.path}`} size="lg" footer={<><Button variant="outline" onClick={close}>取消</Button><Button onClick={confirmShared}>确认影响并保存</Button></>}>
      <div className="rounded-lg bg-warning/8 p-4 text-warning"><b>会影响 {asset.references.length} 个使用位置</b></div><div className="mt-5 divide-y divide-border rounded-lg border border-border">{asset.references.map((item) => <div className="flex justify-between gap-4 p-3" key={`${item.type}-${item.id}`}><span>{item.label}</span><span className="shrink-0 text-muted-foreground">{item.type} · 正在使用</span></div>)}</div>
      <p className="mt-5 text-sm text-muted-foreground">保存后，以上位置会使用更新后的共享配置。</p>
    </AppDialog>
  }

  if (dialog.kind === 'permission') {
    if (!agent) return <MissingDialog title="Agent 不存在" close={close} />
    const nextFiles = dialog.nextFiles ?? '任意目录'
    const confirm = () => { dispatch({ type: 'SAVE_AGENT_CONFIG', input: { agentId: agent.id, kind: 'permissions', value: { ...agent.permissions, files: nextFiles } }, summary: '确认扩大长期权限' }); close() }
    return <AppDialog open onOpenChange={(open) => { if (!open) close() }} title="确认扩大 Agent 长期权限" description={`Agent：${agent.name}`} size="lg" footer={<><Button variant="outline" onClick={close}>取消</Button><Button variant="danger" disabled={confirmName !== agent.name || !understood} onClick={confirm}>确认扩大权限并保存</Button></>}>
      <div className="flex gap-3 rounded-lg border border-danger/30 bg-danger/5 p-4 text-danger"><ShieldAlert className="shrink-0" /><div><b>可能修改工作区外的文件或系统文件</b><p className="mt-1 text-sm">请确认新的文件权限范围符合长期安全边界。</p></div></div><div className="mt-5 panel p-4"><InfoRow label="变更前">{agent.permissions.files}</InfoRow><InfoRow label="变更后"><b className="text-danger">{nextFiles}</b></InfoRow><InfoRow label="全局边界">仍受不可突破的安全规则约束</InfoRow></div><label className="mt-5 block text-sm font-medium">请输入 Agent 名称“{agent.name}”确认<input className="mt-2 h-10 w-full px-3" value={confirmName} onChange={(event) => setConfirmName(event.target.value)} /></label><label className="mt-4 flex items-start gap-3"><input className="mt-1" type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} /><span>我理解这是权限扩大，不是普通配置更新</span></label>
    </AppDialog>
  }

  if (dialog.kind === 'backup-restore') {
    const snapshot = state.backupSnapshots.find((item) => item.id === dialog.snapshotId)
    if (!snapshot) return <MissingDialog title="快照不存在" close={close} />
    const effectiveScope: BackupScope = restoreScope.kind === 'files' ? { kind: 'files', paths: restoreFiles } : restoreScope
    const preview = buildBackupPreview(state, effectiveScope)
    const availableFiles = [...new Set(state.agents.flatMap((item) => item.files.map((file) => `${item.id}/${file.path}`)))]
    const restore = () => { if (!preview) return; dispatch({ type: 'SIMULATE_RESTORE', snapshotId: snapshot.id, beforeSnapshot: createDemoSnapshot(preview, { id: `before-${state.backupSnapshots.length + 1}`, createdAt: '刚刚', kind: '恢复前演示' }) }) }
    const chooseKind = (kind: BackupScope['kind']) => { if (kind === 'team') setRestoreScope({ kind, teamId: state.teams[0]?.id ?? '' }); else if (kind === 'agent') setRestoreScope({ kind, agentId: state.agents[0]?.id ?? '' }); else if (kind === 'files') setRestoreScope({ kind, paths: [] }); else setRestoreScope({ kind: 'all' }); setRestoreFiles([]) }
    return <AppDialog open onOpenChange={(open) => { if (!open) close() }} title="模拟范围恢复" description={`第 ${restoreStep} 步，共 3 步 · ${snapshot.id}`} size="lg" footer={<>{restoreStep > 1 && <Button variant="outline" onClick={() => setRestoreStep((step) => Math.max(1, step - 1) as 1 | 2 | 3)}>上一步</Button>}<Button variant="outline" onClick={close}>取消</Button>{restoreStep < 3 ? <Button disabled={restoreStep === 2 && !preview} onClick={() => setRestoreStep((step) => Math.min(3, step + 1) as 1 | 2 | 3)}>下一步</Button> : <Button variant="danger" disabled={!understood || !preview} onClick={restore}>确认模拟恢复</Button>}</>}>
      {restoreStep === 1 && <><InfoRow label="快照时间">{formatDisplayTimestamp(snapshot.createdAt)}</InfoRow><InfoRow label="快照范围">{describeBackupScope(snapshot.scope, state)}</InfoRow><label className="mt-5 block text-sm font-medium">恢复层级<select className="mt-2 h-10 w-full px-3" value={restoreScope.kind} onChange={(event) => chooseKind(event.target.value as BackupScope['kind'])}><option value="all">全部配置</option><option value="team">Team</option><option value="agent">Agent</option><option value="files">指定文件</option></select></label></>}
      {restoreStep === 2 && <>{restoreScope.kind === 'team' && <label className="block text-sm font-medium">Team<select className="mt-2 h-10 w-full px-3" value={restoreScope.teamId} onChange={(event) => setRestoreScope({ kind: 'team', teamId: event.target.value })}>{state.teams.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}{restoreScope.kind === 'agent' && <label className="block text-sm font-medium">Agent<select className="mt-2 h-10 w-full px-3" value={restoreScope.agentId} onChange={(event) => setRestoreScope({ kind: 'agent', agentId: event.target.value })}>{state.agents.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}{restoreScope.kind === 'files' && <fieldset><legend className="text-sm font-medium">指定恢复文件</legend><div className="mt-2 max-h-64 space-y-2 overflow-auto rounded-lg border border-border p-3">{availableFiles.map((path) => <label key={path} className="flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={restoreFiles.includes(path)} onChange={(event) => setRestoreFiles((items) => event.target.checked ? [...items, path] : items.filter((item) => item !== path))} />{path}</label>)}</div>{!restoreFiles.length && <p className="mt-2 text-xs text-danger">请选择至少一个文件。</p>}</fieldset>}{restoreScope.kind === 'all' && <p className="text-sm text-muted-foreground">该层级无需选择具体对象，将恢复全部演示配置范围。</p>}</>}
      {restoreStep === 3 && preview && <><InfoRow label="将恢复">{preview.label}</InfoRow><InfoRow label="包含">{preview.includes.join('、')}</InfoRow><InfoRow label="不受影响">范围外配置、Agent 引用关系和当前业务集合</InfoRow><InfoRow label="长期记忆">本地快照可以包含；远程备份仍需单独确认</InfoRow><InfoRow label="永不包含">{preview.excludes.join('、')}</InfoRow><InfoRow label="恢复前保护">先新增“恢复前演示”快照记录</InfoRow><label className="mt-4 flex items-start gap-3"><input className="mt-1" type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} /><span>我理解这是演示流程，不会读取或恢复真实文件，也不会修改 Agent、资产、Team 或工作区。</span></label></>}
    </AppDialog>
  }

  if (dialog.kind === 'organization') return <OrganizationDialog dialog={dialog} close={close} />
  return null
}

function OrganizationDialog({ dialog, close }: { dialog: Extract<NonNullable<ReturnType<typeof useApp>['state']['dialog']>, { kind: 'organization' }>; close: () => void }) {
  const { state, dispatch } = useApp()
  const navigate = useNavigate()
  const currentTeam = state.teams.find((item) => item.id === dialog.id)
  const [name, setName] = useState(currentTeam?.name ?? '')
  const [teamMark, setTeamMark] = useState(currentTeam?.mark ?? '')
  const [teamColor, setTeamColor] = useState(currentTeam?.color ?? TEAM_COLOR_PRESETS[0][1])
  const [mission, setMission] = useState(currentTeam?.mission ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<UserFacingError>()
  const desktop = isDesktopRuntime()
  const duplicate = state.teams.some((item) => item.id !== dialog.id && item.name === name.trim())
  const normalizedTeamMark = normalizeTeamMark(teamMark)
  const invalidTeamMark = Boolean(teamMark.trim() && !normalizedTeamMark)
  const teamIdentity = resolveTeamIdentity({ name, mark: normalizedTeamMark, color: teamColor })
  const save = async () => {
    setSaving(true); setError(undefined)
    try {
      const id = dialog.id ?? (desktop ? await generateEntityId('team', name) : `team-${crypto.randomUUID()}`)
      const team = { id, name: name.trim(), mark: normalizedTeamMark, color: teamColor, mission: mission.trim(), boundary: currentTeam?.boundary ?? 'Team 归属不自动授予权限。', memberAgentIds: state.agents.filter((agent) => agent.teamId === id).map((agent) => agent.id), sharedAssetIds: currentTeam?.sharedAssetIds ?? [] }
      if (desktop) { const persisted = await saveTeamV4(team); dispatch({ type: 'SYNC_PERSISTED_TEAMS', teams: [{ ...team, ...persisted }] }) }
      else dispatch(dialog.mode === 'create' ? { type: 'CREATE_TEAM', team } : { type: 'UPDATE_TEAM', teamId: id, changes: team })
      close()
      dispatch({ type: 'SHOW_NOTICE', notice: { tone: 'success', title: dialog.mode === 'create' ? 'Team 已创建' : 'Team 配置已保存', description: `${team.name} 的长期配置已更新。` } })
      if (dialog.mode === 'create') { dispatch({ type: 'SELECT_TEAM', teamId: id }); navigate(dialog.returnTo ?? `/organization/teams/${encodeURIComponent(id)}`, { replace: true }) }
    } catch (cause) { setError(errorFromCause(cause, `无法${dialog.mode === 'create' ? '创建' : '保存'} Team`, 'Team 配置没有变化。请检查本地服务后重试。')) }
    finally { setSaving(false) }
  }
  return <AppDialog open onOpenChange={(open) => { if (!open) close() }} title={`${dialog.mode === 'create' ? '创建' : '编辑'} Team`} size="md" footer={<><Button variant="outline" onClick={close}>取消</Button><Button disabled={saving || !name.trim() || duplicate || invalidTeamMark} onClick={save}>{saving ? '正在保存…' : desktop ? '保存配置' : '保存演示配置'}</Button></>}>
    <label className="block text-sm font-medium">名称<input className="mt-2 h-10 w-full px-3" value={name} onChange={(event) => setName(event.target.value)} aria-invalid={duplicate} />{duplicate && <span className="mt-1 block text-xs text-danger">已有名为“{name.trim()}”的 Team。</span>}</label>
    <div className="mt-4"><div className="flex items-center gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-xl text-xs font-semibold" style={{ backgroundColor: teamIdentity.color, color: teamIdentity.foreground }} aria-hidden="true">{teamIdentity.mark}</span><div><div className="text-sm font-medium">Team 标识</div><p className="mt-1 text-xs text-muted-foreground">默认根据名称生成，也可设置 1–2 个字母或数字。</p></div></div><label className="mt-3 block text-sm font-medium">文字标识<input className="mt-2 h-10 w-full px-3" value={teamMark} placeholder={teamIdentity.mark} maxLength={2} aria-invalid={invalidTeamMark} onChange={(event) => setTeamMark(event.target.value)} /></label>{invalidTeamMark && <p className="mt-1 text-xs text-danger">请输入 1–2 个字母或数字。</p>}<fieldset className="mt-4"><legend className="text-sm font-medium">标识颜色</legend><div className="mt-2 flex flex-wrap gap-2">{TEAM_COLOR_PRESETS.map(([colorName, color]) => <button key={color} type="button" aria-label={colorName} aria-pressed={teamColor === color} className="grid size-10 place-items-center rounded-lg border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" style={{ borderColor: teamColor === color ? color : undefined }} onClick={() => setTeamColor(color)}><span className="size-5 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" /></button>)}</div></fieldset></div>
    <label className="mt-4 block text-sm font-medium">使命<textarea className="mt-2 min-h-24 w-full p-3" value={mission} onChange={(event) => setMission(event.target.value)} /></label>{error && <ErrorNotice error={error} className="mt-4" />}<p className="mt-4 text-xs text-muted-foreground">{desktop ? 'Team 配置保存到 Bandi 本机数据；不会移动 Agent 配置或授予权限。' : 'Team 变更仅在当前页面更新，不移动 Agent 配置、不授予权限。'}</p>
  </AppDialog>
}

function MissingDialog({ title, close }: { title: string; close: () => void }) { return <AppDialog open onOpenChange={(open) => { if (!open) close() }} title={title} size="sm" footer={<Button onClick={close}>关闭</Button>}><p className="text-sm text-muted-foreground">要查看的内容已不存在，请关闭后重新选择。</p></AppDialog> }
