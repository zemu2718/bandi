import { useRef, useState } from 'react'
import { Archive, ArchiveRestore, ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { AppDialog } from '../../components/ui/dialog'
import { MockBoundaryNote, EmptyState, EntityTabs, PageHeader } from '../../components/app/page'
import { ErrorNotice, errorFromCause, type UserFacingError } from '../../components/app/error-notice'
import { generateEntityId, isDesktopRuntime, removeTaskBriefV2, saveTaskBriefV2 } from '../../desktop-bridge'
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

  return <><PageHeader title="任务简报" description="整理可在外部 AI 编程工具中使用的任务背景和要求。" action={teamTasks.length > 0 && <Button onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" />新建简报</Button>} />
    {teamTasks.length ? <section className="panel min-w-0 overflow-hidden" aria-label="任务简报工作区">
      <EntityTabs tabs={[{ id: 'active', label: `当前 ${active.length}` }, { id: 'archived', label: `已归档 ${archived.length}` }]} active={view} onChange={(id) => selectView(id as TaskBriefView)} scope="task-briefs" ariaLabel="任务简报分类" className="mb-0 px-2 [&_[role=tab]]:border-b-0" />
      <div id={`task-briefs-panel-${view}`} role="tabpanel" aria-labelledby={`task-briefs-tab-${view}`} className="min-w-0 lg:grid lg:min-h-96 lg:grid-cols-[minmax(240px,300px)_minmax(0,1fr)]">
        <aside className={`${showMobileDetail ? 'hidden' : 'block'} min-w-0 border-border lg:block lg:border-r`} aria-label={`${view === 'active' ? '当前' : '已归档'}任务简报列表`}><TaskBriefList items={visibleTasks} selectedId={selected?.id} onSelect={selectTaskBrief} /></aside>
        <div className={`${showMobileDetail ? 'block' : 'hidden'} min-w-0 lg:block`}>{selected ? <TaskBriefDetail item={selected} onBack={() => setShowMobileDetail(false)} onEdit={() => setEditing(selected)} /> : <div className="flex min-h-72 items-center justify-center p-8 text-center text-sm text-muted-foreground">{view === 'active' ? '当前没有简报' : '没有已归档简报'}</div>}</div>
      </div>
    </section> : <EmptyState title="还没有任务简报" description="创建一份简报，整理任务背景、约束和期望产出。" action={<Button onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" />新建简报</Button>} />}
    {(creating || editing) && <TaskBriefForm initial={editing ?? undefined} teamId={state.currentTeamId} desktop={desktop} onClose={() => { setCreating(false); setEditing(null) }} onSaved={(taskBrief) => { dispatch({ type: 'UPSERT_TASK_BRIEF', taskBrief }); setView(taskBrief.archivedAt ? 'archived' : 'active'); setSelectedTaskBriefId(taskBrief.id); setCreating(false); setEditing(null) }} onRemoved={(taskBriefId) => { dispatch({ type: 'REMOVE_TASK_BRIEF', taskBriefId }); setSelectedTaskBriefId(undefined); setShowMobileDetail(false); setEditing(null) }} />}
    {!desktop && <div className="mt-5"><MockBoundaryNote /></div>}
  </>
}

function TaskBriefList({ items, selectedId, onSelect }: { items: TaskBriefDto[]; selectedId?: string; onSelect: (id: string) => void }) {
  if (!items.length) return <p className="p-6 text-center text-sm text-muted-foreground">此分类中没有简报</p>
  return <div className="divide-y divide-border">{items.map((item) => <button key={item.id} type="button" aria-current={item.id === selectedId ? 'true' : undefined} className="block min-h-16 w-full px-4 py-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-[current=true]:bg-muted" onClick={() => onSelect(item.id)}><b className="block truncate text-sm">{item.title}</b><span className="mt-1 block truncate text-xs text-muted-foreground">{item.brief || '未填写内容'}</span></button>)}</div>
}

function TaskBriefDetail({ item, onBack, onEdit }: { item: TaskBriefDto; onBack: () => void; onEdit: () => void }) {
  return <article className="min-w-0 p-5 sm:p-6" aria-labelledby="task-brief-detail-title">
    <Button variant="ghost" size="sm" className="mb-4 -ml-2 lg:hidden" onClick={onBack}><ArrowLeft size={15} aria-hidden="true" />返回简报列表</Button>
    <div className="flex flex-wrap items-start justify-between gap-3"><h2 id="task-brief-detail-title" className="break-words text-xl font-semibold">{item.title}</h2><Button variant="outline" size="sm" onClick={onEdit}>编辑</Button></div>
    <div className="mt-6 border-t border-border pt-5"><div className="text-xs font-medium text-muted-foreground">内容</div><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7">{item.brief || '未填写内容'}</p></div>
  </article>
}

function TaskBriefForm({ initial, teamId, desktop, onClose, onSaved, onRemoved }: { initial?: TaskBriefDto; teamId: string; desktop: boolean; onClose: () => void; onSaved: (taskBrief: TaskBriefDto) => void; onRemoved: (taskBriefId: string) => void }) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [brief, setBrief] = useState(initial?.brief ?? '')
  const [archivedAt, setArchivedAt] = useState(initial?.archivedAt)
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [confirmingRemoval, setConfirmingRemoval] = useState(false)
  const [error, setError] = useState<UserFacingError>()
  const titleRef = useRef<HTMLInputElement>(null)

  const save = async () => {
    setSubmitted(true)
    if (!title.trim()) { titleRef.current?.focus(); return }
    if (!teamId || saving) return
    setSaving(true); setError(undefined)
    try {
      const id = initial?.id ?? (desktop ? await generateEntityId('task', `${teamId}-${title.trim()}`) : `task-${crypto.randomUUID()}`)
      const taskBrief: TaskBriefDto = { id, teamId, title: title.trim(), brief: brief.trim() || undefined, archivedAt }
      onSaved(desktop ? await saveTaskBriefV2(taskBrief) : taskBrief)
    } catch (cause) { setError(errorFromCause(cause, '无法保存任务简报', '简报内容仍保留，请检查后重试。')) }
    finally { setSaving(false) }
  }
  const remove = async () => {
    if (!initial || removing) return
    setRemoving(true); setError(undefined)
    try {
      if (desktop) await removeTaskBriefV2(initial.id)
      onRemoved(initial.id)
    } catch (cause) {
      setError(errorFromCause(cause, '无法删除任务简报', '任务简报没有更改。请重试。'))
      setConfirmingRemoval(false)
    } finally { setRemoving(false) }
  }

  return <><AppDialog open onOpenChange={(open) => { if (!open && !saving && !removing) onClose() }} title={initial ? '编辑任务简报' : '新建任务简报'} description="保存目标、背景、约束和期望产出；不记录执行状态。" size="lg" footer={<><Button variant="outline" disabled={saving || removing} onClick={onClose}>取消</Button><Button disabled={saving || removing} aria-busy={saving} onClick={() => void save()}>{saving ? '正在保存…' : '保存简报'}</Button></>}><div className="grid gap-5"><div className="flex justify-end">{initial && <Button variant="ghost" size="sm" disabled={saving || removing} onClick={() => setConfirmingRemoval(true)}><Trash2 size={16} aria-hidden="true" />删除任务简报</Button>}</div><label className="text-sm font-medium" htmlFor="task-title">标题<div className="mt-2"><input ref={titleRef} autoFocus id="task-title" className="h-10 w-full px-3" value={title} onChange={(event) => setTitle(event.target.value)} aria-invalid={submitted && !title.trim()} aria-describedby={submitted && !title.trim() ? 'task-title-error' : undefined} /></div>{submitted && !title.trim() && <small id="task-title-error" className="mt-1 block text-danger">请输入标题。</small>}</label><label className="text-sm font-medium" htmlFor="task-brief">简报（可选）<textarea id="task-brief" className="mt-2 min-h-32 w-full resize-y p-3" value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="写明目标、背景、约束和期望产出" /></label>{initial && <Button type="button" variant="outline" className="justify-self-start" disabled={saving || removing} onClick={() => setArchivedAt(archivedAt ? undefined : now())}>{archivedAt ? <ArchiveRestore size={16} aria-hidden="true" /> : <Archive size={16} aria-hidden="true" />}{archivedAt ? '恢复任务简报' : '归档任务简报'}</Button>}{error && <ErrorNotice error={error} />}</div></AppDialog>
    <AppDialog open={confirmingRemoval} onOpenChange={(open) => { if (!open && !removing) setConfirmingRemoval(false) }} title="删除任务简报" description={initial ? `删除“${initial.title}”这份可复用工作简报。` : undefined} footer={<><Button variant="outline" disabled={removing} onClick={() => setConfirmingRemoval(false)}>取消</Button><Button variant="danger" disabled={removing} aria-busy={removing} onClick={() => void remove()}>{removing ? '正在删除…' : '删除任务简报'}</Button></>}><div className="rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm leading-6"><b>保留与影响</b><p className="mt-2 text-muted-foreground">Team、Agent 和电脑文件不会被删除。此操作不会终止任何 AI 编程工具会话或执行中的任务。</p></div></AppDialog>
  </>
}
