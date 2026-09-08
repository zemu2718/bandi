import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Check, FileDiff, ShieldAlert } from 'lucide-react'
import { ClientLaunchDialog } from './components/client-launch-dialog'
import { Button } from './components/ui/button'
import { AppDialog } from './components/ui/dialog'
import { DiagnosticList, ErrorNotice, errorFromCause, type UserFacingError } from './components/app/error-notice'
import { MonoPath, StatusBadge, toneForStatus } from './components/app/page'
import { useApp } from './state'
import { buildBackupPreview, createDemoSnapshot, describeBackupScope } from './backup-policy'
import type { BackupScope } from './domain'
import { generateEntityId, isDesktopRuntime, loadMemoryReview, recoverMemoryRevision, reviewMemoryCandidate, saveDepartmentV2, saveTeamV2 } from './desktop-bridge'
import type { MemoryReviewBundleDto, ReviewMemoryCandidateResult } from './contracts'
import { formatDisplayTimestamp, memoryScopeLabel } from './presentation'
import { normalizeTeamMark, resolveTeamIdentity, TEAM_COLOR_PRESETS } from './team-identity'

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="grid gap-2 border-b border-border py-3 last:border-0 sm:grid-cols-[128px_1fr]"><div className="text-sm text-muted-foreground">{label}</div><div className="min-w-0 break-words text-sm">{children}</div></div>
}

export function GlobalSheets() {
  const { state, dispatch } = useApp()
  const dialog = state.dialog
  const [confirmName, setConfirmName] = useState('')
  const [understood, setUnderstood] = useState(false)
  const [impact, setImpact] = useState<'local' | 'shared'>('shared')
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
    setImpact('shared')
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

  if (dialog.kind === 'client-guide') return client ? <ClientLaunchDialog client={client} initialAgentId={agent?.id} close={close} /> : <MissingDialog title="AI 编程工具不存在" close={close} />

  if (dialog.kind === 'config-history') {
    const revisions = state.configRevisions.filter((item) => item.ownerType === dialog.ownerType && item.ownerId === dialog.ownerId && item.path === dialog.path)
    const selected = revisions.find((item) => item.id === selectedRevisionId) ?? revisions[0]
    const current = revisions[0]
    const canRestore = Boolean(selected && selected.id !== current?.id && restoreConfirmed)
    return <AppDialog open onOpenChange={(open) => { if (!open) close() }} title={`配置历史 · ${dialog.path.split('/').at(-1)}`} description="历史版本不可变；恢复会生成一个新版本。" size="xl" footer={<><Button variant="outline" onClick={close}>关闭</Button><Button disabled={!canRestore} onClick={() => selected && dispatch({ type: 'RESTORE_CONFIG_REVISION', revisionId: selected.id })}>恢复为新版本</Button></>}>
      {revisions.length ? <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]"><div className="space-y-2" role="list" aria-label="配置版本">{revisions.map((revision, index) => <button key={revision.id} type="button" onClick={() => { setSelectedRevisionId(revision.id); setRestoreConfirmed(false) }} className={`w-full rounded-lg border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected?.id === revision.id ? 'border-foreground bg-muted' : 'border-border hover:bg-muted/60'}`}><span className="flex items-center justify-between gap-2"><b className="text-sm">{revision.id}</b>{index === 0 && <StatusBadge tone="success">当前</StatusBadge>}</span><small className="mt-1 block text-muted-foreground">{formatDisplayTimestamp(revision.savedAt)} · {revision.summary}</small><small className="mt-1 block text-muted-foreground">{revision.evidence === 'memory-only' ? '仅在当前页面有效' : '初始演示版本'}{revision.parentRevisionId ? ` · 基于版本 ${revision.parentRevisionId}` : ''}</small>{revision.restoredFromRevisionId && <small className="mt-1 block text-muted-foreground">恢复自 {revision.restoredFromRevisionId}</small>}</button>)}</div><div className="min-w-0"><div className="grid gap-3 sm:grid-cols-2"><div className="min-w-0 rounded-lg border border-border"><div className="border-b border-border bg-muted px-3 py-2 text-xs font-semibold">当前版本</div><pre className="max-h-80 overflow-auto whitespace-pre-wrap p-3 text-xs leading-6">{current?.content}</pre></div><div className="min-w-0 rounded-lg border border-border"><div className="border-b border-border bg-muted px-3 py-2 text-xs font-semibold">{selected?.id === current?.id ? '选择一个历史版本比较' : selected?.id}</div><pre className="max-h-80 overflow-auto whitespace-pre-wrap p-3 text-xs leading-6">{selected?.content}</pre></div></div><div className="mt-4 rounded-lg border border-warning/30 bg-warning/8 p-3 text-sm">恢复只会基于上方当前内容与目标内容生成新的配置版本；不会覆盖历史，也不会读取或写入文件。</div>{selected && selected.id !== current?.id && <label className="mt-4 flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={restoreConfirmed} onChange={(event) => setRestoreConfirmed(event.target.checked)} /><span>我已核对当前版本与目标版本的内容差异，确认恢复为新版本。</span></label>}</div></div> : <p className="text-sm text-muted-foreground">当前文件暂无演示配置版本。正式记忆使用独立的记忆版本。</p>}
    </AppDialog>
  }

  if (dialog.kind === 'source') {
    return <AppDialog open onOpenChange={(open) => { if (!open) close() }} title="来源与有效配置" description={`${agent?.name ?? asset?.name ?? '配置对象'} / ${dialog.section ?? asset?.kind ?? '配置'}`} size="md" footer={<Button onClick={close}>关闭</Button>}>
      <section><div className="label">有效值摘要</div><p className="mt-2 text-sm leading-6">当前有效值来自自身配置与显式引用；组织身份不形成隐式继承或权限授予。</p></section>
      <section className="panel mt-5 p-4"><InfoRow label="自身配置"><MonoPath>{asset?.path ?? agent?.packagePath ?? '—'}</MonoPath></InfoRow><InfoRow label="显式引用">{agent ? `${agent.ruleRefs.length} 项规则 · ${agent.skillRefs.length} 项技能 · ${agent.mcpRefs.length} 项 MCP` : `${asset?.references.length ?? 0} 个引用`}</InfoRow><InfoRow label="安全边界">外部变化、共享影响和权限扩大必须确认，Agent 不可放宽。</InfoRow><InfoRow label="系统事实">{isDesktopRuntime() ? 'Bandi Desktop 根据已加载的本机配置显示以上信息。' : '浏览器演示不读取本机文件，以上为预置数据。'}</InfoRow></section>
      {(agent?.config === '外部变化' || asset?.status.includes('外部')) && <div className="mt-5 rounded-md border border-warning/30 bg-warning/8 p-4 text-sm text-warning">演示数据标记为外部变化，尚未重新载入。</div>}
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
      {[['a', '生产发布必须由董事长批准', '生产发布由部门主管批准'], ['b', '验证证据必须附在汇报中', '验证证据按需提供']].map(([key, external, mine], index) => <div key={key} className="mb-4 rounded-lg border border-danger/30 bg-danger/5 p-4"><div className="mb-3 flex items-center gap-2 text-danger"><AlertTriangle size={18} /><b>冲突 {index + 1}</b></div><pre className="overflow-x-auto text-xs leading-6">{`<<<< 外部版本\n${external}\n====\n${mine}\n>>>> 你的编辑`}</pre>{choices(key)}</div>)}
    </AppDialog>
  }

  if (dialog.kind === 'shared') {
    if (!asset) return <MissingDialog title="共享资产不存在" close={close} />
    const confirmShared = () => {
      if (impact === 'local') { done(`已返回局部定制路径 · 未修改共享资产 ${asset.name}`); return }
      if (dialog.changes) dispatch({ type: 'UPDATE_ASSET', assetId: asset.id, changes: dialog.changes, message: dialog.message ?? `共享资产 ${asset.name} 已保存到当前页面；${asset.references.length} 个显式引用关系未变 · 未写入文件` })
      else dispatch({ type: 'TOAST', text: `已确认共享资产 ${asset.name} 的影响范围；未提交内容变更 · 未写入文件` })
      close()
    }
    return <AppDialog open onOpenChange={(open) => { if (!open) close() }} title="共享配置影响" description={`你正在修改 ${asset.path}`} size="lg" footer={<><Button variant="outline" onClick={close}>取消</Button><Button onClick={confirmShared}>{impact === 'shared' ? '确认影响并保存' : '返回局部定制'}</Button></>}>
      <div className="rounded-lg bg-warning/8 p-4 text-warning"><b>影响范围：{asset.references.length} 个显式引用</b></div><div className="mt-5 divide-y divide-border rounded-lg border border-border">{asset.references.map((item) => <div className="flex justify-between gap-4 p-3" key={`${item.type}-${item.id}`}><span>{item.label}</span><span className="shrink-0 text-muted-foreground">{item.type} · 显式引用</span></div>)}</div>
      <label className="mt-5 flex gap-3"><input type="radio" name="impact" checked={impact === 'local'} onChange={() => setImpact('local')} /><span>返回并为当前对象创建局部定制</span></label><label className="mt-3 flex gap-3"><input type="radio" name="impact" checked={impact === 'shared'} onChange={() => setImpact('shared')} /><span>修改共享本体并影响以上范围</span></label>
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

  if (dialog.kind === 'memory') {
    const candidate = state.memoryCandidates.find((item) => item.id === dialog.candidateId)
    if (!candidate) return <MissingDialog title="记忆修改建议不存在" close={close} />
    return <MemoryReviewDialog candidate={candidate} close={close} />
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
      {restoreStep === 3 && preview && <><InfoRow label="将恢复">{preview.label}</InfoRow><InfoRow label="包含">{preview.includes.join('、')}</InfoRow><InfoRow label="不受影响">范围外配置、Agent 引用关系和当前业务集合</InfoRow><InfoRow label="Memory 策略">本地正式记忆可包含；远端仍需单独确认</InfoRow><InfoRow label="永不包含">{preview.excludes.join('、')}</InfoRow><InfoRow label="恢复前保护">先新增“恢复前演示”快照记录</InfoRow><label className="mt-4 flex items-start gap-3"><input className="mt-1" type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} /><span>我理解这是演示流程，不会读取或恢复真实文件，也不会修改 Agent、资产、Team或工作区。</span></label></>}
    </AppDialog>
  }

  if (dialog.kind === 'organization') return <OrganizationDialog dialog={dialog} close={close} />
  return null
}

function MemoryReviewDialog({ candidate, close }: { candidate: ReturnType<typeof useApp>['state']['memoryCandidates'][number]; close: () => void }) {
  const { state, dispatch } = useApp()
  const [bundle, setBundle] = useState<MemoryReviewBundleDto>()
  const [result, setResult] = useState<ReviewMemoryCandidateResult>()
  const [loading, setLoading] = useState(isDesktopRuntime())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<UserFacingError>()
  const desktop = isDesktopRuntime()
  const demoSpace = state.memorySpaces.find((item) => item.id === candidate.spaceId)
  const proposer = state.agents.find((item) => item.id === candidate.proposerAgentId)
  const principal = bundle?.space.reviewPrincipal ?? candidate.reviewPrincipal
  const reviewerLabel = principal.kind === 'agent'
    ? state.agents.find((item) => item.id === principal.agentId)?.name ?? principal.agentId
    : `Team 负责人（${state.teams.find((item) => item.id === principal.teamId)?.name ?? principal.teamId}）`
  const selfReview = principal.kind === 'agent' && principal.agentId === candidate.proposerAgentId

  useEffect(() => {
    if (!desktop) return
    let active = true
    loadMemoryReview(`load-memory-${candidate.id}`, candidate.id)
      .then((value) => { if (active) setBundle(value) })
      .catch((cause) => { if (active) setError(errorFromCause(cause, '无法读取记忆修改建议', '内容没有变化。请检查本地服务后重新打开。')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [candidate.id, desktop])

  const reviewDemo = (status: '要求修改' | '已驳回' | '已写入演示版本') => {
    dispatch({ type: 'REVIEW_MEMORY_CANDIDATE', candidateId: candidate.id, status })
    close()
  }
  const reviewDesktop = async (decision: 'request_changes' | 'reject' | 'approve') => {
    if (!bundle || saving) return
    setSaving(true)
    setError(undefined)
    try {
      const next = await reviewMemoryCandidate({
        requestId: `review-memory-${candidate.id}-${decision}`,
        candidateId: bundle.candidate.id,
        decision,
        expectedCandidateVersion: bundle.candidate.version,
        expectedBaseline: bundle.candidate.submittedBaseline,
        expectedReviewPrincipal: bundle.candidate.reviewPrincipal,
      })
      setResult(next)
      dispatch({ type: 'SYNC_FORMAL_MEMORY_REVIEW', result: next })
      if (next.kind === 'saved' || next.kind === 'review_recorded') {
        dispatch({ type: 'SHOW_NOTICE', notice: { tone: 'success', title: next.kind === 'saved' ? '正式记忆已写入' : '审核决定已记录', description: next.kind === 'saved' ? `已生成记忆版本 ${next.revision.id}` : '正式记忆文件未发生变化。' } })
      }
    } catch (cause) {
      setError(errorFromCause(cause, '无法完成记忆审核', '审核决定没有提交。请检查本地服务后重试。'))
    } finally {
      setSaving(false)
    }
  }
  const recoverRevision = async () => {
    if (result?.kind !== 'revision_pending' || saving) return
    setSaving(true)
    setError(undefined)
    try {
      const next = await recoverMemoryRevision({ requestId: `recover-memory-${candidate.id}`, candidateId: result.candidate.id, recoveryRef: result.recoveryRef })
      setResult(next)
      dispatch({ type: 'SYNC_FORMAL_MEMORY_REVIEW', result: next })
      if (next.kind === 'saved') dispatch({ type: 'SHOW_NOTICE', notice: { tone: 'success', title: '记忆版本已补记', description: `已生成正式版本 ${next.revision.id}，未重复写入文件。` } })
    } catch (cause) {
      setError(errorFromCause(cause, '无法补记记忆版本', '正式记忆文件不会重复写入。请检查本地服务后重试补记。'))
    } finally {
      setSaving(false)
    }
  }
  const displayCandidate = bundle?.candidate
  const current = bundle?.currentContent ?? candidate.current
  const proposed = displayCandidate?.proposedContent ?? candidate.proposed
  const status = result && 'candidate' in result ? result.candidate.status : displayCandidate?.status ?? candidate.status
  const diagnostics = result && 'diagnostics' in result ? result.diagnostics : undefined
  const formalOwner = bundle?.space.owner
  const ownerLabel = formalOwner?.kind === 'agent'
    ? state.agents.find((item) => item.id === formalOwner.agentId)?.name ?? formalOwner.agentId
    : demoSpace?.owner ?? '—'

  return <AppDialog open onOpenChange={(open) => { if (!open) close() }} title={`审核正式记忆修改建议 ${candidate.id}`} description={desktop ? '审核关系、内容起点和写入结果由本地服务重新确认。' : '当前为浏览器演示，不会写入文件。'} size="xl" footer={<><Button variant="outline" disabled={loading || saving} onClick={() => desktop ? reviewDesktop('request_changes') : reviewDemo('要求修改')}>要求修改</Button><Button variant="outline" disabled={loading || saving} onClick={() => desktop ? reviewDesktop('reject') : reviewDemo('已驳回')}>驳回</Button><Button disabled={loading || saving || selfReview || Boolean(result && (result.kind === 'saved' || result.kind === 'review_recorded'))} onClick={() => desktop ? reviewDesktop('approve') : reviewDemo('已写入演示版本')}>{saving ? '正在处理…' : desktop ? '批准并写入正式记忆' : '批准并写入演示版本'}</Button></>}>
    {loading ? <p className="text-sm text-muted-foreground">正在读取正式记忆与审核起点…</p> : <><div className="grid gap-5 lg:grid-cols-[300px_1fr]"><div className="panel p-4"><InfoRow label="记忆范围">{bundle ? memoryScopeLabel(bundle.space.scopeType) : demoSpace?.scopeType ?? candidate.spaceId}</InfoRow><InfoRow label="所有者">{ownerLabel}</InfoRow><InfoRow label="归口">{state.agents.find((item) => item.id === bundle?.space.stewardAgentId)?.name ?? demoSpace?.steward ?? '—'}</InfoRow><InfoRow label="审核">{reviewerLabel}</InfoRow><InfoRow label="提议者">{proposer?.name ?? candidate.proposerAgentId}</InfoRow><InfoRow label="状态"><StatusBadge tone={toneForStatus(status)}>{status}</StatusBadge></InfoRow>{result?.kind === 'saved' && <InfoRow label="正式版本">{result.revision.id}</InfoRow>}</div><div className="grid grid-cols-2 overflow-hidden rounded-lg border border-border max-sm:grid-cols-1"><div><div className="bg-muted px-4 py-2 text-xs font-semibold">当前正式内容</div><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words p-4 text-sm text-muted-foreground">{current || '（空）'}</pre></div><div className="border-l border-border max-sm:border-l-0 max-sm:border-t"><div className="bg-primary/8 px-4 py-2 text-xs font-semibold">建议写回</div><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words p-4 text-sm">{proposed}</pre></div></div></div>{!selfReview ? <div className="mt-5 flex items-center gap-2 text-sm text-success"><Check size={17} aria-hidden="true" />提议者与审核者已分离。</div> : <div className="mt-5 text-sm text-danger">提议者不能自审，请先调整审核者。</div>}{result?.kind === 'baseline_changed' && <div className="mt-5 rounded-lg border border-warning/30 bg-warning/8 p-4 text-sm text-warning">正式内容已在审核期间变化，请关闭后基于当前内容重新提交修改建议。</div>}{result?.kind === 'revision_pending' && <div className="mt-5 rounded-lg border border-warning/30 bg-warning/8 p-4 text-sm text-warning"><p>文件已写入，但记忆版本尚待补记。请勿重复批准或重复写入。</p><Button className="mt-3" variant="outline" size="sm" disabled={saving} onClick={recoverRevision}>{saving ? '正在补记…' : '补记记忆版本'}</Button></div>}{diagnostics?.length ? <div role="alert" className="mt-4 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger"><DiagnosticList items={diagnostics} /></div> : null}{error && <ErrorNotice error={error} className="mt-4" />}</>}
  </AppDialog>
}

function OrganizationDialog({ dialog, close }: { dialog: Extract<NonNullable<ReturnType<typeof useApp>['state']['dialog']>, { kind: 'organization' }>; close: () => void }) {
  const { state, dispatch } = useApp(); const navigate = useNavigate(); const currentTeam = dialog.entity === 'team' ? state.teams.find((item) => item.id === dialog.id) : undefined; const currentDepartment = dialog.entity === 'department' ? state.departments.find((item) => item.id === dialog.id) : undefined
  const [name, setName] = useState(currentTeam?.name ?? currentDepartment?.name ?? ''); const [teamMark, setTeamMark] = useState(currentTeam?.mark ?? ''); const [teamColor, setTeamColor] = useState(currentTeam?.color ?? TEAM_COLOR_PRESETS[0][1]); const [teamId, setTeamId] = useState(currentDepartment?.teamId ?? state.currentTeamId ?? state.teams[0]?.id ?? ''); const [parentId, setParentId] = useState(currentDepartment?.parentDepartmentId ?? ''); const [mission, setMission] = useState(currentTeam?.mission ?? currentDepartment?.mission ?? ''); const [managerAgentId, setManagerAgentId] = useState(currentDepartment?.managerAgentId ?? ''); const [generatedId, setGeneratedId] = useState(''); const [saving, setSaving] = useState(false); const [error, setError] = useState<UserFacingError>(); const desktop = isDesktopRuntime(); const duplicate = dialog.entity === 'team' ? state.teams.some((item) => item.id !== dialog.id && item.name === name.trim()) : state.departments.some((item) => item.id !== dialog.id && item.teamId === teamId && item.name === name.trim()); const normalizedTeamMark = normalizeTeamMark(teamMark); const invalidTeamMark = dialog.entity === 'team' && Boolean(teamMark.trim() && !normalizedTeamMark); const teamIdentity = resolveTeamIdentity({ name, mark: normalizedTeamMark, color: teamColor })
  const departmentMembers = state.agents.filter((item) => currentDepartment?.memberAgentIds.includes(item.id) && item.teamId === currentDepartment.teamId && item.status === 'active')
  const invalidGovernanceAgent = dialog.entity === 'department' && Boolean(managerAgentId && !departmentMembers.some((item) => item.id === managerAgentId))
  const descendantIds = useMemo(() => { const result = new Set<string>(); if (!currentDepartment) return result; const visit = (id: string) => state.departments.filter((item) => item.parentDepartmentId === id).forEach((item) => { result.add(item.id); visit(item.id) }); visit(currentDepartment.id); return result }, [currentDepartment, state.departments]); const invalidParent = Boolean(parentId && (parentId === currentDepartment?.id || descendantIds.has(parentId)))
  const save = async () => { setSaving(true); setError(undefined); try { const id = dialog.id ?? (generatedId || (desktop ? await generateEntityId(dialog.entity, name) : `${dialog.entity}-${crypto.randomUUID()}`)); if (!dialog.id && !generatedId) setGeneratedId(id); if (dialog.entity === 'team') { const team = { id, name: name.trim(), mark: normalizedTeamMark, color: teamColor, mission: mission.trim(), boundary: currentTeam?.boundary ?? '组织身份不自动授予权限。', memberAgentIds: state.agents.filter((agent) => agent.teamId === id).map((agent) => agent.id), departmentIds: currentTeam?.departmentIds ?? [], sharedAssetIds: currentTeam?.sharedAssetIds ?? [] }; if (desktop) { const persisted = await saveTeamV2(team); dispatch({ type: 'SYNC_PERSISTED_TEAMS', teams: [{ ...team, ...persisted }] }) } else dispatch(dialog.mode === 'create' ? { type: 'CREATE_TEAM', team } : { type: 'UPDATE_TEAM', teamId: id, changes: team }); close(); dispatch({ type: 'SHOW_NOTICE', notice: { tone: 'success', title: dialog.mode === 'create' ? 'Team已创建' : 'Team配置已保存', description: `${team.name} 的组织配置已更新。` } }); if (dialog.mode === 'create') { dispatch({ type: 'SELECT_TEAM', teamId: id }); navigate(dialog.returnTo ?? `/organization?team=${encodeURIComponent(id)}`, { replace: true }) } } else { const department = { id, name: name.trim(), teamId, parentDepartmentId: parentId || undefined, parent: state.departments.find((item) => item.id === parentId)?.name, managerAgentId: managerAgentId || undefined, manager: state.agents.find((item) => item.id === managerAgentId)?.name, mission: mission.trim(), members: currentDepartment?.members ?? 0, responsibilities: currentDepartment?.responsibilities ?? [], boundaries: currentDepartment?.boundaries ?? ['不隐式授予权限'], delegationDepth: currentDepartment?.delegationDepth ?? 1, memberAgentIds: currentDepartment?.memberAgentIds ?? [], ownedSopIds: currentDepartment?.ownedSopIds ?? [] }; if (desktop) { const persisted = await saveDepartmentV2({ ...department, teamId: department.teamId }); dispatch({ type: 'SYNC_PERSISTED_DEPARTMENTS', departments: [{ ...department, ...persisted, teamId: persisted.teamId, members: persisted.memberAgentIds.length }] }) } else dispatch(dialog.mode === 'create' ? { type: 'CREATE_DEPARTMENT', department } : { type: 'UPDATE_DEPARTMENT', departmentId: id, changes: department }); close(); dispatch({ type: 'SHOW_NOTICE', notice: { tone: 'success', title: dialog.mode === 'create' ? '部门已创建' : '部门配置已保存', description: `${department.name} 的组织配置已更新。` } }); if (dialog.mode === 'create') navigate(`/organization?team=${encodeURIComponent(teamId)}&department=${encodeURIComponent(id)}`, { replace: true }) } } catch (cause) { setError(errorFromCause(cause, `无法${dialog.mode === 'create' ? '创建' : '保存'}${dialog.entity === 'team' ? 'Team' : '部门'}`, '组织配置没有变化。请检查本地服务后重试。')) } finally { setSaving(false) } }
  return <AppDialog open onOpenChange={(open) => { if (!open) close() }} title={`${dialog.mode === 'create' ? '创建' : '编辑'}${dialog.entity === 'team' ? 'Team' : '部门'}`} size="md" footer={<><Button variant="outline" onClick={close}>取消</Button><Button disabled={saving || !name.trim() || duplicate || invalidTeamMark || invalidParent || invalidGovernanceAgent || (dialog.entity === 'department' && !teamId)} onClick={save}>{saving ? '正在保存…' : desktop ? '保存配置' : '保存演示配置'}</Button></>}><label className="block text-sm font-medium">名称<input className="mt-2 h-10 w-full px-3" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={duplicate} aria-describedby={duplicate ? 'organization-name-error' : undefined} />{duplicate && <span id="organization-name-error" className="mt-1 block text-xs text-danger">{dialog.entity === 'team' ? `已有名为“${name.trim()}”的Team。` : `${state.teams.find((item) => item.id === teamId)?.name ?? '所选Team'}中已有名为“${name.trim()}”的部门。`}</span>}</label>{dialog.entity === 'team' && <div className="mt-4"><div className="flex items-center gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-xl text-xs font-semibold" style={{ backgroundColor: teamIdentity.color, color: teamIdentity.foreground }} aria-hidden="true">{teamIdentity.mark}</span><div><div className="text-sm font-medium">Team 标识</div><p className="mt-1 text-xs text-muted-foreground">默认根据名称生成，也可设置 1–2 个字母或数字。</p></div></div><label className="mt-3 block text-sm font-medium">文字标识<input className="mt-2 h-10 w-full px-3" value={teamMark} placeholder={teamIdentity.mark} maxLength={2} aria-invalid={invalidTeamMark} aria-describedby={invalidTeamMark ? 'team-mark-error' : 'team-mark-help'} onChange={(event) => setTeamMark(event.target.value)} /></label>{invalidTeamMark ? <p id="team-mark-error" className="mt-1 text-xs text-danger">请输入 1–2 个字母或数字。</p> : <p id="team-mark-help" className="mt-1 text-xs text-muted-foreground">留空时自动使用“{teamIdentity.mark}”。</p>}<fieldset className="mt-4"><legend className="text-sm font-medium">标识颜色</legend><div className="mt-2 flex flex-wrap gap-2">{TEAM_COLOR_PRESETS.map(([colorName, color]) => <button key={color} type="button" aria-label={colorName} aria-pressed={teamColor === color} className="grid size-10 place-items-center rounded-lg border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" style={{ borderColor: teamColor === color ? color : undefined }} onClick={() => setTeamColor(color)}><span className="size-5 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" /></button>)}</div></fieldset></div>}{dialog.entity === 'department' && <>{dialog.mode === 'create' ? <label className="mt-4 block text-sm font-medium">所属Team<select className="mt-2 h-10 w-full px-3" value={teamId} onChange={(e) => { setTeamId(e.target.value); setParentId('') }}>{state.teams.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : <div className="mt-4"><div className="text-sm font-medium">所属Team</div><div className="mt-2 rounded-lg border border-border bg-muted/35 px-3 py-2.5 text-sm">{state.teams.find((item) => item.id === teamId)?.name ?? '未找到所属Team'}</div><p className="mt-1 text-xs leading-5 text-muted-foreground">当前不能更改部门所属Team。</p></div>}<label className="mt-4 block text-sm font-medium">上级部门<select className="mt-2 h-10 w-full px-3" value={parentId} onChange={(e) => setParentId(e.target.value)}><option value="">顶级部门</option>{state.departments.filter((item) => item.teamId === teamId && item.id !== currentDepartment?.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{invalidParent && <span className="mt-1 block text-xs text-danger">不能移动到自身或后代部门，组织关系必须无环。</span>}</label></>}{dialog.entity === 'department' && dialog.mode === 'edit' && <label className="mt-4 block text-sm font-medium">部门主管<select aria-label="部门主管" className="mt-2 h-10 w-full px-3" value={managerAgentId} onChange={(event) => setManagerAgentId(event.target.value)}><option value="">未设置</option>{departmentMembers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{invalidGovernanceAgent && <span className="mt-1 block text-xs text-danger">当前主管已停用、归档或不再属于本部门，请清空或重新选择。</span>}<span className="mt-1 block text-xs leading-5 text-muted-foreground">仅可选择本部门已启用成员；设置主管关系不会授予文件、命令、网络或委派权限。</span></label>}<label className="mt-4 block text-sm font-medium">使命<textarea className="mt-2 min-h-24 w-full p-3" value={mission} onChange={(e) => setMission(e.target.value)} /></label>{error && <ErrorNotice error={error} className="mt-4" />}<p className="mt-4 text-xs text-muted-foreground">{desktop ? '组织关系保存到 Bandi 本机数据；不会移动 Agent 配置、授予权限或修改外部配置。' : '组织变更仅在当前页面更新，不移动 Agent 配置、不授予权限。'}</p></AppDialog>
}

function MissingDialog({ title, close }: { title: string; close: () => void }) { return <AppDialog open onOpenChange={(open) => { if (!open) close() }} title={title} size="sm" footer={<Button onClick={close}>关闭</Button>}><p className="text-sm text-muted-foreground">要查看的内容已不存在，请关闭后重新选择。</p></AppDialog> }
