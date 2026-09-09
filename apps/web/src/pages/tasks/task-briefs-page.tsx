import { useRef, useState } from 'react'
import { Archive, ArchiveRestore, ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { AppDialog } from '../../components/ui/dialog'
import { MockBoundaryNote, EmptyState, EntityTabs, PageHeader } from '../../components/app/page'
import { ErrorNotice, errorFromCause, type UserFacingError } from '../../components/app/error-notice'
import { generateEntityId, isDesktopRuntime, removeTaskBriefV4, saveTaskBriefV4 } from '../../desktop-bridge'
import { useApp } from '../../state'
import type { TaskBriefDto } from '../../contracts'

const now = () => new Date().toISOString()
type TaskBriefView = 'active' | 'archived'

export function TaskBriefsPage() {
  const { state, dispatch } = useApp()
  const desktop = isDesktopRuntime()
  const [editing, setEditing] = useState<TaskBriefDto | null>(null)
  const [creating, setCreating] = useState(false)
  const [view, setView] = useState<TaskBriefView>('active')
  const [selectedTaskBriefId, setSelectedTaskBriefId] = useState<string>()
  const [showMobileDetail, setShowMobileDetail] = useState(false)
  const [archivingId, setArchivingId] = useState<string>()
  const [archiveError, setArchiveError] = useState<UserFacingError>()
  const teamTasks = state.taskBriefs.filter((item) => item.teamId === state.currentTeamId)
  const active = teamTasks.filter((item) => !item.archivedAt)
  const archived = teamTasks.filter((item) => item.archivedAt)
  const visibleTasks = view === 'active' ? active : archived
  const selected = visibleTasks.find((item) => item.id === selectedTaskBriefId) ?? visibleTasks[0]

  const selectView = (nextView: TaskBriefView) => {
    setView(nextView)
    setSelectedTaskBriefId(undefined)
    setShowMobileDetail(false)
  }
  const selectTaskBrief = (id: string) => {
    setSelectedTaskBriefId(id)
    setShowMobileDetail(true)
  }

  const archive = async (item: TaskBriefDto) => {
    if (archivingId) return
    setArchivingId(item.id); setArchiveError(undefined)
    try {
      const updated = { ...item, archivedAt: item.archivedAt ? undefined : now() }
      dispatch({ type: 'UPSERT_TASK_BRIEF', taskBrief: desktop ? await saveTaskBriefV4(updated) : updated })
      setView(updated.archivedAt ? 'archived' : 'active')
      setSelectedTaskBriefId(item.id)
    } catch (cause) {
      setArchiveError(errorFromCause(cause, item.archivedAt ? '无法移出归档' : '无法归档需求', '需求没有更改，请重试。'))
    } finally { setArchivingId(undefined) }
  }
  const createAction = <Button onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" />新建需求</Button>

  return <><PageHeader title="需求池" description="整理当前 Team 的需求，供外部 AI 编程工具使用。" action={teamTasks.length ? createAction : undefined} />
    {teamTasks.length ? <section className="panel min-w-0 overflow-hidden" aria-label="需求池工作区">
      <EntityTabs tabs={[{ id: 'active', label: `当前 ${active.length}` }, { id: 'archived', label: `已归档 ${archived.length}` }]} active={view} onChange={(id) => selectView(id as TaskBriefView)} scope="task-briefs" ariaLabel="需求分类" className="mb-0 px-2 [&_[role=tab]]:border-b-0" />
      <div id={`task-briefs-panel-${view}`} role="tabpanel" aria-labelledby={`task-briefs-tab-${view}`} className="min-w-0 lg:grid lg:min-h-96 lg:grid-cols-[minmax(240px,300px)_minmax(0,1fr)]">
        <aside className={`${showMobileDetail ? 'hidden' : 'block'} min-w-0 border-border lg:block lg:border-r`} aria-label={`${view === 'active' ? '当前' : '已归档'}需求列表`}><TaskBriefList items={visibleTasks} selectedId={selected?.id} onSelect={selectTaskBrief} /></aside>
        <div className={`${showMobileDetail ? 'block' : 'hidden'} min-w-0 lg:block`}>{selected ? <TaskBriefDetail item={selected} onBack={() => setShowMobileDetail(false)} onEdit={() => setEditing(selected)} onArchive={() => void archive(selected)} archiving={archivingId === selected.id} error={archiveError} /> : <div className="flex min-h-72 items-center justify-center p-8 text-center text-sm text-muted-foreground">{view === 'active' ? '当前没有需求' : '没有已归档需求'}</div>}</div>
      </div>
    </section> : <div className="first-use-empty grid place-items-center"><EmptyState className="w-full max-w-lg border-0" title="还没有需求" action={createAction} /></div>}
    {(creating || editing) && <TaskBriefForm initial={editing ?? undefined} teamId={state.currentTeamId} desktop={desktop} onClose={() => { setCreating(false); setEditing(null) }} onSaved={(taskBrief) => { dispatch({ type: 'UPSERT_TASK_BRIEF', taskBrief }); setView(taskBrief.archivedAt ? 'archived' : 'active'); setSelectedTaskBriefId(taskBrief.id); setCreating(false); setEditing(null) }} onRemoved={(taskBriefId) => { dispatch({ type: 'REMOVE_TASK_BRIEF', taskBriefId }); setSelectedTaskBriefId(undefined); setShowMobileDetail(false); setEditing(null) }} />}
    {!desktop && <div className="mt-5"><MockBoundaryNote /></div>}
  </>
}

function TaskBriefList({ items, selectedId, onSelect }: { items: TaskBriefDto[]; selectedId?: string; onSelect: (id: string) => void }) {
  if (!items.length) return <p className="p-6 text-center text-sm text-muted-foreground">此分类中没有需求</p>
  return <div className="divide-y divide-border">{items.map((item) => <button key={item.id} type="button" aria-current={item.id === selectedId ? 'true' : undefined} className="block min-h-16 w-full px-4 py-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-[current=true]:bg-muted" onClick={() => onSelect(item.id)}><b className="block truncate text-sm">{item.title}</b><span className="mt-1 block truncate text-xs text-muted-foreground">{item.goal}</span></button>)}</div>
}

function TaskBriefDetail({ item, onBack, onEdit, onArchive, archiving, error }: { item: TaskBriefDto; onBack: () => void; onEdit: () => void; onArchive: () => void; archiving: boolean; error?: UserFacingError }) {
  return <article className="min-w-0 p-5 sm:p-6" aria-labelledby="task-brief-detail-title">
    <Button variant="ghost" size="sm" className="mb-4 -ml-2 lg:hidden" onClick={onBack}><ArrowLeft size={15} aria-hidden="true" />返回需求列表</Button>
    <div className="flex flex-wrap items-start justify-between gap-3"><h2 id="task-brief-detail-title" className="break-words text-xl font-semibold">{item.title}</h2><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={archiving} onClick={onEdit}>编辑</Button><Button variant="outline" size="sm" disabled={archiving} aria-busy={archiving} onClick={onArchive}>{item.archivedAt ? <ArchiveRestore size={15} aria-hidden="true" /> : <Archive size={15} aria-hidden="true" />}{archiving ? (item.archivedAt ? '正在移出归档…' : '正在归档…') : (item.archivedAt ? '移出归档' : '归档需求')}</Button></div></div>
    {error && <div className="mt-4"><ErrorNotice error={error} /></div>}
    <dl className="mt-6 grid gap-5 border-t border-border pt-5">{[['想完成什么', item.goal], ['相关背景', item.context], ['任务要求', item.constraints], ['希望得到什么', item.expectedOutput]].map(([label, value]) => <div key={label}><dt className="text-xs font-medium text-muted-foreground">{label}</dt><dd className="mt-2 whitespace-pre-wrap break-words text-sm leading-7">{value || '未填写'}</dd></div>)}</dl>
  </article>
}

function TaskBriefForm({ initial, teamId, desktop, onClose, onSaved, onRemoved }: { initial?: TaskBriefDto; teamId: string; desktop: boolean; onClose: () => void; onSaved: (taskBrief: TaskBriefDto) => void; onRemoved: (taskBriefId: string) => void }) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [goal, setGoal] = useState(initial?.goal ?? '')
  const [context, setContext] = useState(initial?.context ?? '')
  const [constraints, setConstraints] = useState(initial?.constraints ?? '')
  const [expectedOutput, setExpectedOutput] = useState(initial?.expectedOutput ?? '')
  const [detailsOpen, setDetailsOpen] = useState(Boolean(initial && (initial.context.trim() || initial.constraints.trim() || initial.expectedOutput.trim())))
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [confirmingRemoval, setConfirmingRemoval] = useState(false)
  const [error, setError] = useState<UserFacingError>()
  const titleRef = useRef<HTMLInputElement>(null)
  const goalRef = useRef<HTMLTextAreaElement>(null)

  const save = async () => {
    setSubmitted(true)
    if (!title.trim()) { titleRef.current?.focus(); return }
    if (!goal.trim()) { goalRef.current?.focus(); return }
    if (!teamId || saving) return
    setSaving(true); setError(undefined)
    try {
      const id = initial?.id ?? (desktop ? await generateEntityId('task', `${teamId}-${title.trim()}`) : `task-${crypto.randomUUID()}`)
      const taskBrief: TaskBriefDto = { id, teamId, title: title.trim(), goal: goal.trim(), context: context.trim(), constraints: constraints.trim(), expectedOutput: expectedOutput.trim(), archivedAt: initial?.archivedAt }
      onSaved(desktop ? await saveTaskBriefV4(taskBrief) : taskBrief)
    } catch (cause) { setError(errorFromCause(cause, '无法保存需求', '需求内容仍保留，请检查后重试。')) }
    finally { setSaving(false) }
  }
  const remove = async () => {
    if (!initial || removing) return
    setRemoving(true); setError(undefined)
    try {
      if (desktop) await removeTaskBriefV4(initial.id)
      onRemoved(initial.id)
    } catch (cause) {
      setError(errorFromCause(cause, '无法删除需求', '需求没有更改，请重试。'))
      setConfirmingRemoval(false)
    } finally { setRemoving(false) }
  }

  return <><AppDialog open onOpenChange={(open) => { if (!open && !saving && !removing) onClose() }} title={initial ? '编辑需求' : '新建需求'} description="先说明想完成什么，再按需补充背景、任务要求和希望得到的结果。" size="lg" footer={<><Button variant="outline" disabled={saving || removing} onClick={onClose}>取消</Button><Button disabled={saving || removing} aria-busy={saving} onClick={() => void save()}>{saving ? (initial ? '正在保存…' : '正在创建…') : (initial ? '保存更改' : '创建需求')}</Button></>}><div className="grid gap-5"><div className="flex justify-end">{initial && <Button variant="ghost" size="sm" disabled={saving || removing} onClick={() => setConfirmingRemoval(true)}><Trash2 size={16} aria-hidden="true" />删除需求</Button>}</div><label className="text-sm font-medium" htmlFor="task-title">标题<div className="mt-2"><input ref={titleRef} autoFocus id="task-title" placeholder="例如：整理 2.0 版本发布说明" className="h-10 w-full px-3" value={title} onChange={(event) => setTitle(event.target.value)} aria-invalid={submitted && !title.trim()} aria-describedby={submitted && !title.trim() ? 'task-title-error' : undefined} /></div>{submitted && !title.trim() && <small id="task-title-error" className="mt-1 block text-danger">输入标题。</small>}</label><label className="text-sm font-medium" htmlFor="task-goal">想完成什么<textarea ref={goalRef} id="task-goal" placeholder="例如：汇总已验证的变更，形成可直接发布的说明" className="mt-2 min-h-24 w-full resize-y p-3" value={goal} onChange={(event) => setGoal(event.target.value)} aria-invalid={submitted && !goal.trim()} aria-describedby={submitted && !goal.trim() ? 'task-goal-error' : undefined} />{submitted && !goal.trim() && <small id="task-goal-error" className="mt-1 block text-danger">填写想完成什么。</small>}</label><details className="rounded-lg border border-border" open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}><summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">补充更多信息</summary><div className="grid gap-5 border-t border-border p-4"><label className="text-sm font-medium" htmlFor="task-context">相关背景（可选）<textarea id="task-context" placeholder="补充现状、原因或已有信息" className="mt-2 min-h-24 w-full resize-y p-3" value={context} onChange={(event) => setContext(event.target.value)} /></label><label className="text-sm font-medium" htmlFor="task-constraints">任务要求（可选）<textarea id="task-constraints" placeholder="说明范围、限制或必须遵守的要求" className="mt-2 min-h-24 w-full resize-y p-3" value={constraints} onChange={(event) => setConstraints(event.target.value)} /></label><label className="text-sm font-medium" htmlFor="task-expected-output">希望得到什么（可选）<textarea id="task-expected-output" placeholder="说明产出形式、内容或完成标准" className="mt-2 min-h-24 w-full resize-y p-3" value={expectedOutput} onChange={(event) => setExpectedOutput(event.target.value)} /></label></div></details>{error && <ErrorNotice error={error} />}</div></AppDialog>
    <AppDialog open={confirmingRemoval} onOpenChange={(open) => { if (!open && !removing) setConfirmingRemoval(false) }} title="删除需求" description={initial ? `删除“${initial.title}”后无法恢复。` : undefined} footer={<><Button variant="outline" disabled={removing} onClick={() => setConfirmingRemoval(false)}>取消</Button><Button variant="danger" disabled={removing} aria-busy={removing} onClick={() => void remove()}>{removing ? '正在删除…' : '删除需求'}</Button></>}><div className="rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm leading-6"><b>保留与影响</b><p className="mt-2 text-muted-foreground">只会删除此需求记录。Team、Agent 和电脑文件不会更改。</p></div></AppDialog>
  </>
}
