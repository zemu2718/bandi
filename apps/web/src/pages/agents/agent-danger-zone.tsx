import { useEffect, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/ui/button'
import { AppDialog } from '../../components/ui/dialog'
import { ErrorNotice, errorFromCause, type UserFacingError } from '../../components/app/error-notice'
import type { ManagedAgentDeletionImpactDto, ManagedAgentDeletionPreviewDto } from '../../contracts'
import {
  commitManagedAgentDeletion,
  isDesktopRuntime,
  previewManagedAgentDeletion,
} from '../../desktop-bridge'
import type { FullAgent } from '../../domain'
import { useApp } from '../../state'
import { formatDisplayTimestamp, formatRelativeExpiry, localizeDomainText } from '../../presentation'

const impactGroups: Array<{
  key: Exclude<keyof ManagedAgentDeletionPreviewDto['impacts'], 'blockers'>
  title: string
}> = [
  { key: 'sharedAssetReferences', title: '共享资产引用' },
  { key: 'organizationRelationships', title: '组织关系' },
  { key: 'reviewResponsibilities', title: '审核责任' },
  { key: 'formalMemory', title: '正式记忆' },
  { key: 'automaticCleanup', title: '自动清理项' },
  { key: 'historyAndBackups', title: '历史与备份' },
]

const shortId = (value: string) => value.length <= 16 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`

function ImpactList({ items }: { items: ManagedAgentDeletionImpactDto[] }) {
  return (
    <ul className="mt-3 space-y-2 text-sm">
      {items.map((item) => (
        <li key={item.id} className="min-w-0 rounded-md border border-border p-3 [overflow-wrap:anywhere]">
          <b>{localizeDomainText(item.label)}</b>
          <p className="mt-1 break-words leading-6 text-muted-foreground">{localizeDomainText(item.detail)}</p>
          {item.remediation && <p className="mt-1 break-words text-xs leading-5 text-warning">解除建议：{localizeDomainText(item.remediation)}</p>}
        </li>
      ))}
    </ul>
  )
}

export function AgentDangerZone({ agent }: { agent: FullAgent }) {
  const { state, dispatch } = useApp()
  const navigate = useNavigate()
  const submitting = useRef(false)
  const confirmationRef = useRef<HTMLInputElement>(null)
  const recheckRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<ManagedAgentDeletionPreviewDto>()
  const [confirmation, setConfirmation] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<UserFacingError>()
  const [stale, setStale] = useState(false)
  const eligible = isDesktopRuntime()
    && agent.packageSource.kind === 'bandi-managed'
    && agent.packageSchema.compatibility === 'current'
  const blockers = preview?.impacts.blockers ?? []
  const groups = preview ? impactGroups.filter(({ key }) => preview.impacts[key].length > 0) : []
  const impactCount = preview ? groups.reduce((total, { key }) => total + preview.impacts[key].length, 0) : 0
  const expired = preview ? Date.parse(preview.expiresAt) <= Date.now() : false
  const canConfirm = Boolean(preview?.canCommit && !blockers.length && !stale && !expired)

  useEffect(() => {
    if (!preview) return
    const delay = Date.parse(preview.expiresAt) - Date.now()
    if (delay <= 0) {
      setStale(true)
      setConfirmation('')
      return
    }
    const timer = window.setTimeout(() => {
      setStale(true)
      setConfirmation('')
    }, delay)
    return () => window.clearTimeout(timer)
  }, [preview])

  useEffect(() => {
    if (!open || loading || (!preview && !error && !stale)) return
    const timer = window.setTimeout(() => {
      if (canConfirm) confirmationRef.current?.focus()
      else recheckRef.current?.focus()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [canConfirm, error, loading, open, preview, stale])

  if (!eligible) return null

  const close = () => {
    if (loading) return
    setOpen(false)
    setPreview(undefined)
    setConfirmation('')
    setError(undefined)
    setStale(false)
  }

  const showPreview = async () => {
    setOpen(true)
    setLoading(true)
    setError(undefined)
    setPreview(undefined)
    setConfirmation('')
    setStale(false)
    const requestId = `delete-agent-${agent.id}-${crypto.randomUUID()}`
    try {
      setPreview(await previewManagedAgentDeletion({ requestId, agentId: agent.id }))
    } catch (cause) {
      setError(errorFromCause(
        cause,
        '无法检查删除影响',
        'Agent 配置没有变化。请检查本地服务后重新检查。',
      ))
    } finally {
      setLoading(false)
    }
  }

  const commit = async () => {
    if (!preview || loading || submitting.current || !canConfirm
      || confirmation !== preview.confirmationText) return
    submitting.current = true
    setLoading(true)
    setError(undefined)
    try {
      const result = await commitManagedAgentDeletion({
        requestId: preview.requestId,
        agentId: agent.id,
        previewRef: preview.previewRef,
        confirmationText: confirmation,
      })
      dispatch({ type: 'REMOVE_MANAGED_AGENT', agentId: agent.id })
      if (result.status === 'cleanup_pending') {
        dispatch({
          type: 'HYDRATE_AGENT_RECOVERY',
          operations: [...state.agentRecoveryOperations.filter((item) => item.id !== result.operationId), {
            id: result.operationId,
            agentId: result.agentId,
            operationKind: 'delete',
            status: 'database_committed',
            createdAt: result.createdAt,
            safeReason: result.safeReason,
          }],
        })
        dispatch({
          type: 'SHOW_NOTICE',
          notice: {
            tone: 'warning',
            title: 'Agent 配置已删除',
            description: result.safeReason ?? '部分本机清理仍待完成，请勿重复删除。',
          },
        })
      }
      navigate('/agents')
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (message.includes('AGENT_DELETE_PREVIEW_EXPIRED') || message.includes('AGENT_DELETE_TARGET_CHANGED')) {
        setPreview(undefined)
        setConfirmation('')
        setStale(true)
        setError({
          title: message.includes('EXPIRED') ? '删除预览已过期' : '删除目标已变化',
          description: 'Agent 配置没有变化。请重新检查删除影响后再确认。',
          technicalDetails: message,
        })
      } else {
        setError(errorFromCause(
          cause,
          '无法永久删除 Agent',
          '删除尚未提交。请检查本地服务后重新检查；不要重复提交。',
        ))
      }
    } finally {
      submitting.current = false
      setLoading(false)
    }
  }

  const needsRecheck = stale || Boolean(preview && !canConfirm)
  const footer = <>
    <Button variant="outline" disabled={loading} onClick={close}>取消</Button>
    {needsRecheck || (!preview && error) ? <Button ref={recheckRef} disabled={loading} onClick={() => void showPreview()}>{loading ? '正在重新检查…' : '重新检查'}</Button> : preview && <Button variant="danger" disabled={loading || confirmation !== preview.confirmationText} onClick={commit}>{loading ? '删除中…' : '永久删除'}</Button>}
  </>

  return (
    <section aria-labelledby="agent-danger-zone-title" className="panel mt-5 border-danger/30 p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="label text-danger">危险区</div>
          <h2 id="agent-danger-zone-title" className="mt-2 font-semibold">永久删除 Agent</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">永久删除受管目录、配置版本和相关索引。独立备份不会随之删除；此操作不等同于隐私擦除。</p>
        </div>
        <Button variant="danger" onClick={() => void showPreview()}><Trash2 size={16} aria-hidden="true" />预览永久删除影响</Button>
      </div>
      <AppDialog open={open} onOpenChange={(next) => { if (!next) close() }} title={`永久删除 ${agent.name}`} description="本地服务会重新计算全部影响；有阻塞项时不能提交。" size="lg" footer={footer}>
        {loading && !preview && <p role="status" className="text-sm text-muted-foreground">正在计算删除影响…</p>}
        {error && <ErrorNotice error={error} />}
        {preview && <div className="min-w-0 space-y-5">
          <div className="min-w-0 rounded-lg border border-warning/30 bg-warning/8 p-4 text-sm leading-6">
            <b className="break-words">删除目标：{agent.name}</b>
            <p className="mt-1 font-mono text-xs text-muted-foreground" title={agent.id}>Agent ID：{shortId(agent.id)}</p>
            <p className="mt-2 text-muted-foreground">发现 {groups.length} 个受影响分组，共 {impactCount} 项影响；{blockers.length ? `当前有 ${blockers.length} 个阻塞项。` : '当前无阻塞项，可以继续确认。'}</p>
            <p className="mt-2 text-muted-foreground">Agent 配置及其版本历史将被删除。已有备份快照可能仍包含历史副本，但不能直接恢复该 Agent。</p>
          </div>
          {blockers.length > 0 && <section className="rounded-lg border border-danger/30 bg-danger/5 p-4">
            <h3 className="text-sm font-semibold">先解除以下阻塞项</h3>
            <ImpactList items={blockers} />
          </section>}
          {stale && <p className="rounded-lg border border-warning/30 bg-warning/8 p-3 text-sm">删除预览已失效，请重新检查。</p>}
          {groups.map(({ key, title }) => <details key={key} className="min-w-0 rounded-lg border border-border p-4">
            <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{title}<span className="text-xs font-normal text-muted-foreground">{preview.impacts[key].length} 项</span></summary>
            <ImpactList items={preview.impacts[key]} />
          </details>)}
          {canConfirm && <label className="block text-sm font-medium" htmlFor="agent-deletion-confirmation">输入“{preview.confirmationText}”确认
            <input ref={confirmationRef} id="agent-deletion-confirmation" autoComplete="off" className="mt-2 h-10 w-full px-3" value={confirmation} disabled={loading} onChange={(event) => setConfirmation(event.target.value)} />
          </label>}
          <p className="text-xs text-muted-foreground">预览 <time dateTime={preview.expiresAt} title={formatDisplayTimestamp(preview.expiresAt)}>{formatRelativeExpiry(preview.expiresAt)}</time>。提交时会再次检查 Agent 配置和全部影响是否变化。</p>
        </div>}
      </AppDialog>
    </section>
  )
}
