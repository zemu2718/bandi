import { useState } from 'react'
import { History } from 'lucide-react'
import { AppDialog } from '../../components/ui/dialog'
import { Button } from '../../components/ui/button'
import { MonoPath, StatusBadge } from '../../components/app/page'
import { listMemoryRevisions } from '../../desktop-bridge'
import type { MemoryRevisionDto } from '../../contracts'
import { formatDisplayTimestamp } from '../../presentation'

type MemoryRevisionHistoryProps = {
  spaceId: string
  currentRevisionId?: string
}

export function MemoryRevisionHistory({ spaceId, currentRevisionId }: MemoryRevisionHistoryProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [revisions, setRevisions] = useState<MemoryRevisionDto[]>([])
  const [error, setError] = useState('')

  const showHistory = async () => {
    setOpen(true)
    setLoading(true)
    setError('')
    try {
      setRevisions(await listMemoryRevisions({
        requestId: `list-memory-revisions-${spaceId}`,
        spaceId,
      }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }

  return <>
    <Button variant="ghost" size="sm" onClick={showHistory}>
      <History size={14} aria-hidden="true" />版本历史
    </Button>
    <AppDialog
      open={open}
      onOpenChange={setOpen}
      title="长期记忆版本历史"
      description="长期记忆的内容发生变化时会生成不可修改的新版本，并与其他配置的版本分开记录。"
      size="xl"
      footer={<Button variant="outline" onClick={() => setOpen(false)}>关闭</Button>}
    >
      {loading && <p role="status" className="text-sm text-muted-foreground">正在加载版本历史…</p>}
      {!loading && error && <div role="alert" className="rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm text-danger">{error}</div>}
      {!loading && !error && revisions.length === 0 && <p className="text-sm text-muted-foreground">长期记忆暂无历史版本。</p>}
      {!loading && !error && revisions.length > 0 && <div className="space-y-3" role="list" aria-label="长期记忆版本历史">
        {revisions.map((revision) => <article key={revision.id} role="listitem" className="rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0"><b className="block text-sm">{formatDisplayTimestamp(revision.writtenAt)}</b></div>
            <StatusBadge tone={revision.id === currentRevisionId ? 'success' : 'neutral'}>{revision.id === currentRevisionId ? '当前版本' : '历史版本'}</StatusBadge>
          </div>
          <details className="mt-3"><summary className="cursor-pointer text-xs font-medium text-muted-foreground">版本详情</summary><dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
            <div><dt className="text-muted-foreground">版本 ID</dt><dd className="mt-1 font-mono break-all">{revision.id}</dd></div>
            <div><dt className="text-muted-foreground">基于版本</dt><dd className="mt-1 font-mono break-all">{revision.parentRevisionId ?? '首个版本'}</dd></div>
            <div><dt className="text-muted-foreground">内容校验值</dt><dd><MonoPath>{revision.contentHash}</MonoPath></dd></div>
          </dl></details>
        </article>)}
      </div>}
    </AppDialog>
  </>
}
