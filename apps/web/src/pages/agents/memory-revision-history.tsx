import { useState } from 'react'
import { History } from 'lucide-react'
import { AppDialog } from '../../components/ui/dialog'
import { Button } from '../../components/ui/button'
import { MonoPath, StatusBadge } from '../../components/app/page'
import { ErrorNotice, errorFromCause, type UserFacingError } from '../../components/app/error-notice'
import { listMemoryRevisions, readMemoryRevisionContent, restoreMemoryRevision } from '../../desktop-bridge'
import type { LoadedMemoryDto, MemoryRevisionDto, SaveMemoryResult } from '../../contracts'
import { formatDisplayTimestamp } from '../../presentation'

type MemoryRevisionHistoryProps = {
  agentId: string
  memory: LoadedMemoryDto
  onRestored: (memory: LoadedMemoryDto) => void
  onRevisionPending: (result: Extract<SaveMemoryResult, { kind: 'revision_pending' }>) => void
}

export function MemoryRevisionHistory({ agentId, memory, onRestored, onRevisionPending }: MemoryRevisionHistoryProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [revisions, setRevisions] = useState<MemoryRevisionDto[]>([])
  const [selected, setSelected] = useState<MemoryRevisionDto>()
  const [selectedContent, setSelectedContent] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState<UserFacingError>()

  const selectRevision = async (revision: MemoryRevisionDto) => {
    setLoading(true)
    setError(undefined)
    try {
      const content = await readMemoryRevisionContent({ requestId: `read-memory-revision-${revision.id}`, spaceId: memory.space.id, agentId, revisionId: revision.id })
      setSelected(revision)
      setSelectedContent(content)
      setConfirmed(false)
    } catch (cause) {
      setError(errorFromCause(cause, '无法读取历史版本', 'Bandi 没有使用该历史内容，请重新加载版本列表后重试。'))
    } finally {
      setLoading(false)
    }
  }

  const showHistory = async () => {
    setOpen(true)
    setLoading(true)
    setError(undefined)
    setSelected(undefined)
    try {
      const items = await listMemoryRevisions({ requestId: `list-memory-revisions-${memory.space.id}`, spaceId: memory.space.id, agentId })
      setRevisions(items)
      if (items[0]) await selectRevision(items[0])
    } catch (cause) {
      setError(errorFromCause(cause, '无法加载版本历史', '长期记忆没有改变，请关闭后重试。'))
    } finally {
      setLoading(false)
    }
  }

  const restore = async () => {
    if (!selected || !confirmed || selectedContent === memory.content) return
    setLoading(true)
    setError(undefined)
    try {
      const result = await restoreMemoryRevision({
        requestId: `restore-memory-revision-${selected.id}-${crypto.randomUUID()}`,
        spaceId: memory.space.id,
        agentId,
        revisionId: selected.id,
        expectedBaseline: memory.baselineRef,
        baseContent: memory.content,
        confirmed: true,
      })
      if (result.kind === 'saved') {
        onRestored(result.memory)
        setOpen(false)
      } else if (result.kind === 'revision_pending') {
        onRevisionPending(result)
        setOpen(false)
      } else {
        const description = result.kind === 'baseline_changed'
          ? '文件已在恢复确认后变化，Bandi 没有覆盖它。请关闭历史并重新加载。'
          : 'Bandi 未完成恢复，当前页面仍保留原内容。'
        setError({ title: '长期记忆未恢复', description, technicalDetails: result.diagnostics.map((item) => `${item.code}: ${item.message}`).join('\n') })
      }
    } catch (cause) {
      setError(errorFromCause(cause, '长期记忆未恢复', 'Bandi 没有确认恢复完成，请重新加载后重试。'))
    } finally {
      setLoading(false)
    }
  }

  return <>
    <Button variant="ghost" size="sm" onClick={() => void showHistory()}><History size={14} aria-hidden="true" />版本历史</Button>
    <AppDialog open={open} onOpenChange={setOpen} title="长期记忆版本历史" description="历史版本不可修改；恢复会生成新版本，不会覆盖或删除旧历史。" size="xl" footer={<><Button variant="outline" onClick={() => setOpen(false)}>关闭</Button><Button disabled={!selected || selectedContent === memory.content || !confirmed || loading} onClick={() => void restore()}>恢复为新版本</Button></>}>
      {loading && !selected && <p role="status" className="text-sm text-muted-foreground">正在加载版本历史…</p>}
      {error && <ErrorNotice error={error} />}
      {!loading && !error && revisions.length === 0 && <p className="text-sm text-muted-foreground">长期记忆暂无历史版本。</p>}
      {revisions.length > 0 && <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="space-y-2" role="list" aria-label="长期记忆版本历史">{revisions.map((revision) => <button key={revision.id} type="button" role="listitem" onClick={() => void selectRevision(revision)} className={`w-full rounded-lg border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected?.id === revision.id ? 'border-foreground bg-muted' : 'border-border hover:bg-muted/60'}`}><b className="block text-sm">{formatDisplayTimestamp(revision.writtenAt)}</b><span className="mt-2 block"><StatusBadge tone={revision.id === memory.space.currentRevisionId ? 'success' : 'neutral'}>{revision.id === memory.space.currentRevisionId ? '当前版本' : '历史版本'}</StatusBadge></span><details className="mt-3" onClick={(event) => event.stopPropagation()}><summary className="cursor-pointer text-xs text-muted-foreground">版本详情</summary><MonoPath>{revision.contentHash}</MonoPath></details></button>)}</div>
        <div className="min-w-0"><div className="grid gap-3 sm:grid-cols-2"><section className="min-w-0 rounded-lg border border-border"><div className="border-b border-border bg-muted px-3 py-2 text-xs font-semibold">磁盘当前内容</div><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words p-3 text-xs leading-6">{memory.content}</pre></section><section className="min-w-0 rounded-lg border border-border"><div className="border-b border-border bg-muted px-3 py-2 text-xs font-semibold">所选历史内容</div><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words p-3 text-xs leading-6">{selectedContent}</pre></section></div>{selected && selectedContent !== memory.content && <label className="mt-4 flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>我已核对当前内容与目标历史内容，确认恢复并生成新版本。</span></label>}</div>
      </div>}
    </AppDialog>
  </>
}
