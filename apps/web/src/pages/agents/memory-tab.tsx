import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import type { FullAgent } from '../../domain'
import type { LoadedMemoryDto, SaveMemoryResult } from '../../contracts'
import { Button } from '../../components/ui/button'
import { EmptyState, StatusBadge } from '../../components/app/page'
import { DiagnosticList, ErrorNotice, errorFromCause, type UserFacingError } from '../../components/app/error-notice'
import { discoverMemorySpaces, isDesktopRuntime, loadMemory, recoverMemoryRevision, saveMemory } from '../../desktop-bridge'
import { useApp } from '../../state'
import { MemoryRevisionHistory } from './memory-revision-history'

async function hashContent(content: string): Promise<`sha256:${string}`> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
  return `sha256:${Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function resultError(result: Exclude<SaveMemoryResult, { kind: 'saved' }>): UserFacingError {
  const titles = {
    baseline_changed: '长期记忆未保存',
    revision_pending: '长期记忆已写入，版本待补记',
    validation_failed: '长期记忆未保存',
    save_failed: '长期记忆保存失败',
  } as const
  const descriptions = {
    baseline_changed: '文件已在本次编辑期间发生变化。Bandi 没有覆盖它，你的修改仍保留，请加载文件当前内容后重新核对。',
    revision_pending: '正文已经安全写入，请先补记版本，不要重复保存。',
    validation_failed: '提交内容未通过校验，请按处理建议修正后重试。',
    save_failed: 'Bandi 未能完成安全保存。你的修改仍保留，请检查技术详情后重试。',
  } as const
  return { title: titles[result.kind], description: descriptions[result.kind] }
}

export function MemoryTab({ agent }: { agent: FullAgent }) {
  const { state, dispatch } = useApp()
  const desktop = isDesktopRuntime()
  const webSpace = state.memorySpaces.find((item) => item.scopeKey.agentId === agent.id)
  const [memory, setMemory] = useState<LoadedMemoryDto>()
  const [content, setContent] = useState(webSpace?.content ?? '')
  const [busy, setBusy] = useState(desktop)
  const [error, setError] = useState<UserFacingError>()
  const [result, setResult] = useState<Exclude<SaveMemoryResult, { kind: 'saved' }>>()

  const applyMemory = (loaded: LoadedMemoryDto) => {
    setMemory(loaded)
    setContent(loaded.content)
    setError(undefined)
    setResult(undefined)
  }

  const reload = async () => {
    if (!desktop) return
    setBusy(true)
    setError(undefined)
    try {
      const discovered = await discoverMemorySpaces({ requestId: `discover-memory-${agent.id}`, agentId: agent.id })
      if (discovered.spaces.length !== 1) {
        setMemory(undefined)
        setError({
          title: discovered.spaces.length ? '长期记忆数据异常' : '暂无长期记忆',
          description: discovered.spaces.length ? '检测到多个长期记忆空间，Bandi 不会猜测应编辑哪一个。' : '该 Agent 尚未建立长期记忆空间。',
        })
        return
      }
      applyMemory(await loadMemory({ requestId: `load-memory-${agent.id}`, spaceId: discovered.spaces[0].id, agentId: agent.id }))
    } catch (cause) {
      setError(errorFromCause(cause, '无法加载长期记忆', 'Bandi 没有读取或修改正文，请检查本地数据后重试。'))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!desktop) {
      setContent(webSpace?.content ?? '')
      return
    }
    let active = true
    setBusy(true)
    setError(undefined)
    void discoverMemorySpaces({ requestId: `discover-memory-${agent.id}`, agentId: agent.id })
      .then(async (discovered) => {
        if (discovered.spaces.length !== 1) {
          if (!active) return
          setMemory(undefined)
          setError({
            title: discovered.spaces.length ? '长期记忆数据异常' : '暂无长期记忆',
            description: discovered.spaces.length ? '检测到多个长期记忆空间，Bandi 不会猜测应编辑哪一个。' : '该 Agent 尚未建立长期记忆空间。',
          })
          return
        }
        const loaded = await loadMemory({ requestId: `load-memory-${agent.id}`, spaceId: discovered.spaces[0].id, agentId: agent.id })
        if (active) applyMemory(loaded)
      })
      .catch((cause) => { if (active) setError(errorFromCause(cause, '无法加载长期记忆', 'Bandi 没有读取或修改正文，请检查本地数据后重试。')) })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [agent.id, desktop, webSpace?.content])

  const canonical = desktop ? memory?.content ?? '' : webSpace?.content ?? ''
  const dirty = content !== canonical
  const save = async () => {
    if (!dirty || busy) return
    if (!desktop) {
      if (webSpace) dispatch({ type: 'SAVE_MEMORY', spaceId: webSpace.id, content })
      return
    }
    if (!memory) return
    setBusy(true)
    setError(undefined)
    setResult(undefined)
    try {
      const saved = await saveMemory({
        requestId: `save-memory-${agent.id}-${crypto.randomUUID()}`,
        spaceId: memory.space.id,
        agentId: agent.id,
        content,
        contentHash: await hashContent(content),
        expectedBaseline: memory.baselineRef,
      })
      if (saved.kind === 'saved') applyMemory(saved.memory)
      else {
        setResult(saved)
        setError(resultError(saved))
      }
    } catch (cause) {
      setError(errorFromCause(cause, '长期记忆保存失败', 'Bandi 没有确认保存完成，你的修改仍保留，请重试。'))
    } finally {
      setBusy(false)
    }
  }

  const recover = async () => {
    if (!memory || result?.kind !== 'revision_pending') return
    setBusy(true)
    try {
      const recovered = await recoverMemoryRevision({ requestId: `recover-memory-${agent.id}`, journalId: result.journalId, spaceId: memory.space.id, agentId: agent.id })
      if (recovered.kind === 'saved') applyMemory(recovered.memory)
      else { setResult(recovered); setError(resultError(recovered)) }
    } catch (cause) {
      setError(errorFromCause(cause, '版本补记失败', '正文不会被重复写入，请保留当前页面并重试补记。'))
    } finally {
      setBusy(false)
    }
  }

  if (!desktop && !webSpace) return <section className="panel p-5"><EmptyState title="暂无长期记忆" description="该 Agent 尚未建立长期记忆空间。" /></section>
  if (desktop && !memory && busy) return <section className="panel p-5"><p role="status" className="text-sm text-muted-foreground">正在加载长期记忆…</p></section>
  if (desktop && !memory) return <section className="panel p-5">{error && <ErrorNotice error={error} />}<Button className="mt-3" variant="outline" size="sm" onClick={() => void reload()}>重新加载</Button></section>

  const path = memory?.space.storageLocator.displayPath ?? webSpace!.path
  const revisionId = memory?.space.currentRevisionId
  return <section className="panel overflow-hidden">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/25 px-5 py-4"><div><b>长期记忆</b><p className="mt-1 text-xs text-muted-foreground">保存位置：{path}；内容变更时会生成不可修改的新版本。</p></div><div className="flex gap-2"><Button variant="outline" disabled={!dirty || busy} onClick={() => setContent(canonical)}>取消</Button><Button disabled={!dirty || busy || result?.kind === 'revision_pending'} onClick={() => void save()}><Save size={15} aria-hidden="true" />{busy ? '保存中…' : desktop ? '保存' : '保存到当前页面'}</Button></div></div>
    <div className="p-5"><label className="block text-sm font-medium">长期记忆正文<textarea className="mt-2 min-h-72 w-full p-4 font-mono text-sm leading-6" value={content} onChange={(event) => setContent(event.target.value)} /></label>
      {error && <ErrorNotice className="mt-3" error={error} />}
      {result && 'diagnostics' in result && <DiagnosticList className="mt-3 text-sm" items={result.diagnostics} />}
      {result?.kind === 'baseline_changed' && <Button className="mt-3" variant="outline" size="sm" onClick={() => applyMemory(result.current)}>加载文件当前内容</Button>}
      {result?.kind === 'revision_pending' && <Button className="mt-3" variant="outline" size="sm" disabled={busy} onClick={() => void recover()}>补记版本</Button>}
      <div className="mt-4 flex items-center justify-between gap-3"><StatusBadge tone={revisionId ? 'success' : 'neutral'}>{revisionId ? '已生成版本' : '尚无版本'}</StatusBadge>{desktop && memory && <MemoryRevisionHistory agentId={agent.id} memory={memory} onRestored={applyMemory} onRevisionPending={(pending) => { setResult(pending); setError(resultError(pending)) }} />}</div>
    </div>
  </section>
}
