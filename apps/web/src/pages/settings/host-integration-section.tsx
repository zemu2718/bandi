import { useCallback, useEffect, useState } from 'react'
import { FolderOpen, RefreshCw } from 'lucide-react'
import { AiClientIcon } from '../../components/ai-clients'
import { ErrorNotice, errorFromCause, type UserFacingError } from '../../components/app/error-notice'
import { EmptyState, StatusBadge } from '../../components/app/page'
import { Button } from '../../components/ui/button'
import { AppDialog } from '../../components/ui/dialog'
import type { HostIntegrationDto, HostIntegrationPreviewDto } from '../../contracts'
import {
  commitHostIntegrationInstall,
  commitHostIntegrationUninstall,
  listHostIntegrations,
  previewHostIntegrationInstall,
  previewHostIntegrationUninstall,
  revealHostDirectory,
} from '../../desktop-bridge'
import type { AiClient } from '../../mock'
import { formatDisplayTimestamp } from '../../presentation'
import { useApp } from '../../state'

const entryLabels: Record<HostIntegrationDto['toolId'], string> = {
  'claude-code': 'Skill',
  'claude-desktop': 'MCPB（官方界面安装）',
  codex: 'Agent Skill',
  'gemini-cli': 'Extension + Skill / Command',
  'grok-build': 'Skill',
  opencode: 'Skill',
  openclaw: 'Skill',
  hermes: 'Skill',
  pi: 'Skill',
}

const stateLabels: Record<HostIntegrationDto['installationState'], string> = {
  not_installed: '未安装',
  installed: '已安装',
  update_available: '有可用更新',
  foreign_collision: '目标位置已被占用',
  unsupported: '需在工具中安装',
  unknown: '无法检查',
}

const stateTones: Record<HostIntegrationDto['installationState'], 'neutral' | 'success' | 'warning' | 'danger'> = {
  not_installed: 'neutral',
  installed: 'success',
  update_available: 'warning',
  foreign_collision: 'danger',
  unsupported: 'warning',
  unknown: 'warning',
}

const statusLabels = { not_checked: '尚未验证', degraded: '部分能力可用' } as const
const statusTones = { not_checked: 'neutral', degraded: 'warning' } as const
const needsAttention = new Set<HostIntegrationDto['installationState']>(['update_available', 'foreign_collision', 'unsupported', 'unknown'])

function requestFor(item: HostIntegrationDto) {
  return { toolId: item.toolId, targetId: item.targetId, requestId: crypto.randomUUID() }
}

export function HostIntegrationSection({ toolId }: { toolId?: string }) {
  const { state } = useApp()
  const [items, setItems] = useState<HostIntegrationDto[]>([])
  const [loading, setLoading] = useState(true)
  const [busyToolId, setBusyToolId] = useState<string>()
  const [preview, setPreview] = useState<HostIntegrationPreviewDto>()
  const [confirmation, setConfirmation] = useState('')
  const [filter, setFilter] = useState<'all' | 'needs_attention'>('all')
  const [lastCheckedAt, setLastCheckedAt] = useState<string>()
  const [error, setError] = useState<UserFacingError>()
  const [feedback, setFeedback] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      setItems(await listHostIntegrations())
      setLastCheckedAt(new Date().toISOString())
    }
    catch (cause) { setError(errorFromCause(cause, '无法检查 Bandi 集成', '安装位置的状态没有变化，请稍后重试。')) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  const openPreview = async (item: HostIntegrationDto, action: 'install' | 'uninstall') => {
    setBusyToolId(item.toolId)
    setError(undefined)
    setFeedback('')
    try {
      const request = requestFor(item)
      setPreview(await (action === 'install'
        ? previewHostIntegrationInstall(request)
        : previewHostIntegrationUninstall(request)))
      setConfirmation('')
    } catch (cause) {
      setError(errorFromCause(cause, '无法预览集成变更', '安装位置的状态可能已经变化，请重新检查后重试。'))
    } finally { setBusyToolId(undefined) }
  }

  const commit = async () => {
    if (!preview || confirmation !== confirmText(preview)) return
    setBusyToolId(preview.toolId)
    setError(undefined)
    try {
      const request = { toolId: preview.toolId, targetId: preview.targetId, requestId: preview.requestId, previewRef: preview.previewRef, confirmation: true }
      const result = await (preview.action === 'install'
        ? commitHostIntegrationInstall(request)
        : commitHostIntegrationUninstall(request))
      const clientName = state.aiClients.find((item) => item.id === result.toolId)?.name ?? result.toolId
      const outcome = preview.action === 'uninstall' ? '已卸载' : preview.installationState === 'update_available' ? '已更新' : '已安装'
      setFeedback(`${clientName} 的 Bandi 集成${outcome}。工具是否已识别该集成尚未验证。`)
      setPreview(undefined)
    } catch (cause) {
      setError(errorFromCause(cause, '无法更改 Bandi 集成', '安装位置可能已变化。请重新检查后重试。'))
      setBusyToolId(undefined)
      return
    }

    setBusyToolId(undefined)
    await load()
  }

  const reveal = async (item: HostIntegrationDto) => {
    setBusyToolId(item.toolId)
    setError(undefined)
    setFeedback('')
    try {
      const result = await revealHostDirectory(requestFor(item))
      if (result.revealed) {
        const clientName = state.aiClients.find((candidate) => candidate.id === item.toolId)?.name ?? item.toolId
        setFeedback(`${clientName} 的预设安装位置已在文件管理器中显示。Bandi 未读取文件夹内容；工具是否已识别该集成尚未验证。`)
      }
    } catch (cause) {
      setError(errorFromCause(cause, '无法在文件管理器中显示', '预设安装位置不存在或当前不可用。'))
    } finally { setBusyToolId(undefined) }
  }

  const scopedItems = toolId ? items.filter((item) => item.toolId === toolId) : items
  const attentionCount = scopedItems.filter((item) => needsAttention.has(item.installationState)).length
  const visibleItems = filter === 'needs_attention' ? scopedItems.filter((item) => needsAttention.has(item.installationState)) : scopedItems
  const busy = Boolean(busyToolId)
  const previewVerb = preview?.action === 'uninstall' ? '卸载' : preview?.installationState === 'update_available' ? '更新' : '安装'

  return <section className="panel overflow-hidden">
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border p-5">
      <div><b>Bandi 集成</b><p className="mt-1 text-sm text-muted-foreground">管理当前工具预设安装位置中的 Bandi 集成；工具本体安装状态与集成状态相互独立。</p><p className="mt-2 text-xs text-muted-foreground">{lastCheckedAt ? `安装状态上次检查：${formatDisplayTimestamp(lastCheckedAt)}` : '本页尚未完成安装状态检查'}</p></div>
      <Button size="sm" variant="outline" aria-label="重新检查 Bandi 集成状态" disabled={loading || busy} onClick={() => void load()}><RefreshCw size={15} aria-hidden="true" />重新检查</Button>
    </div>
    {loading && <p role="status" className="p-5 text-sm text-muted-foreground">正在检查 Bandi 集成状态…</p>}
    {error && <ErrorNotice className="m-5" error={error} />}
    {feedback && <p role="status" className="mx-5 mt-4 rounded-lg border border-border bg-muted/30 p-3 text-sm">{feedback}</p>}
    {!loading && !toolId && scopedItems.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3"><p className="text-xs text-muted-foreground">共 {scopedItems.length} 个集成 · {attentionCount} 个需处理</p><div className="flex gap-2" aria-label="Bandi 集成筛选"><Button size="sm" variant={filter === 'all' ? 'default' : 'outline'} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>全部（{scopedItems.length}）</Button><Button size="sm" variant={filter === 'needs_attention' ? 'default' : 'outline'} aria-pressed={filter === 'needs_attention'} onClick={() => setFilter('needs_attention')}>需处理（{attentionCount}）</Button></div></div>}
    {!loading && scopedItems.length === 0 && !error && <div className="p-5"><EmptyState title="没有可用的 Bandi 集成" description="Bandi Desktop 没有返回此工具的预设安装位置。" action={<Button size="sm" variant="outline" onClick={() => void load()}>重新检查</Button>} /></div>}
    {!loading && scopedItems.length > 0 && visibleItems.length === 0 && <div className="p-5"><EmptyState title="没有需要处理的集成" description="当前没有待更新、位置占用或检查失败的集成；工具是否已识别集成仍需单独确认。" action={<Button size="sm" variant="outline" onClick={() => setFilter('all')}>查看全部</Button>} /></div>}
    {!loading && visibleItems.length > 0 && <div className="divide-y divide-border">{visibleItems.map((item) => {
      const client = state.aiClients.find((candidate) => candidate.id === item.toolId) as AiClient | undefined
      return <div key={`${item.toolId}:${item.targetId}`} className="grid min-w-0 gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="flex min-w-0 items-center gap-3">{client && <AiClientIcon client={client} size={36} tile />}<span className="min-w-0"><b className="block truncate">{client?.name ?? item.toolId}</b><small className="text-muted-foreground">{entryLabels[item.toolId]}</small></span></div>
        <div className="min-w-0 sm:col-span-2"><dl className="grid gap-3 text-xs sm:grid-cols-2"><div><dt className="mb-1 text-muted-foreground">Bandi 集成</dt><dd><StatusBadge tone={stateTones[item.installationState]}>{stateLabels[item.installationState]}</StatusBadge></dd></div><div><dt className="mb-1 text-muted-foreground">工具是否识别该集成</dt><dd><StatusBadge tone={statusTones[item.status]}>{statusLabels[item.status]}</StatusBadge></dd></div></dl><p className="mt-3 text-xs leading-5 text-muted-foreground">{item.reason}</p></div>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          {item.canInstall && <Button size="sm" disabled={busy} onClick={() => void openPreview(item, 'install')}>{item.installationState === 'update_available' ? '更新集成' : '安装集成'}</Button>}
          {item.canUninstall && <Button size="sm" variant="outline" disabled={busy} onClick={() => void openPreview(item, 'uninstall')}>卸载集成</Button>}
          <Button size="sm" variant="outline" disabled={busy || !item.canReveal} title={!item.canReveal ? '当前后端未提供真实系统显示能力' : undefined} onClick={() => void reveal(item)}><FolderOpen size={15} aria-hidden="true" />在文件管理器中显示</Button>
        </div>
      </div>
    })}</div>}
    <AppDialog
      open={Boolean(preview)}
      onOpenChange={(open) => { if (!open && !busyToolId) { setPreview(undefined); setConfirmation('') } }}
      title={`确认${previewVerb} Bandi 集成`}
      description="只修改 Bandi 预设的安装位置，不读取或展示工具已有配置。安装或卸载文件不代表工具已经识别该集成。"
      footer={<><Button variant="outline" disabled={busy} onClick={() => setPreview(undefined)}>取消</Button><Button variant={preview?.action === 'uninstall' ? 'danger' : 'default'} disabled={!preview?.canCommit || busy || confirmation !== (preview ? confirmText(preview) : '')} onClick={() => void commit()}>{busy ? '处理中…' : `${previewVerb} Bandi 集成`}</Button></>}
    >
      {preview && <><dl className="grid gap-3 text-sm sm:grid-cols-[8rem_1fr]"><dt className="text-muted-foreground">工具</dt><dd>{state.aiClients.find((item) => item.id === preview.toolId)?.name ?? preview.toolId}</dd><dt className="text-muted-foreground">集成类型</dt><dd>{entryLabels[preview.toolId]}</dd><dt className="text-muted-foreground">当前状态</dt><dd>{stateLabels[preview.installationState]}</dd><dt className="text-muted-foreground">影响</dt><dd>{preview.reason}</dd></dl><label htmlFor="host-integration-confirmation" className="mt-5 block text-sm font-medium">输入“{confirmText(preview)}”确认<input id="host-integration-confirmation" autoFocus className="mt-2 h-10 w-full px-3" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>{!preview.canCommit && <p role="alert" className="mt-3 text-sm text-danger">当前目标状态不允许提交。</p>}</>}
    </AppDialog>
  </section>
}

function confirmText(preview: HostIntegrationPreviewDto) {
  return preview.action === 'uninstall' ? '卸载 Bandi 集成' : '安装 Bandi 集成'
}
