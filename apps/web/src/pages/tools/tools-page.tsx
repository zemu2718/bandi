import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, FolderOpen, Play, RefreshCw } from 'lucide-react'
import { AiClientIcon } from '../../components/ai-clients'
import { EmptyState, PageHeader, StatusBadge } from '../../components/app/page'
import { Button } from '../../components/ui/button'
import { AppDialog } from '../../components/ui/dialog'
import type { AiToolAvailability, AiToolHostStatusDto, AiToolUpgradePreviewDto } from '../../contracts'
import { commitAiToolUpgrade, isDesktopRuntime, listAiToolHostStatuses, openAiToolInstallPage, previewAiToolUpgrade, revealAiToolConfigLocation } from '../../desktop-bridge'
import { cn } from '../../lib'
import type { AiClient } from '../../mock'
import { aiClients } from '../../mock'
import { useApp } from '../../state'

type ToolFilter = 'installed' | 'not_found' | 'all'

const availabilityLabels: Record<AiToolAvailability, string> = {
  installed: '已检测到',
  not_found: '未检测到',
  unsupported_platform: '当前平台暂不支持',
  detection_failed: '检查失败',
}

const availabilityTones: Record<AiToolAvailability, 'success' | 'neutral' | 'warning' | 'danger'> = {
  installed: 'success',
  not_found: 'neutral',
  unsupported_platform: 'warning',
  detection_failed: 'danger',
}

const contextLabels: Record<AiToolHostStatusDto['contextMode'], string> = {
  initial_prompt: '可携带所选上下文启动',
  manual_context: '启动后需手动粘贴上下文',
  unavailable: '当前不支持上下文启动',
}

const browserStatus = (toolId: AiToolHostStatusDto['toolId']): AiToolHostStatusDto => ({
  toolId,
  availability: 'unsupported_platform',
  contextMode: 'unavailable',
  configLocationLabel: '仅 Bandi Desktop 可读取固定位置',
  canRevealConfig: false,
  canOpenOfficialInstallPage: false,
  reasonCode: 'DESKTOP_REQUIRED',
  currentVersion: null,
  latestVersion: null,
  installSource: 'not_applicable',
  versionState: 'not_applicable',
  canUpgrade: false,
  versionReasonCode: 'DESKTOP_REQUIRED',
  installationCount: 0,
})

const sourceLabels: Record<AiToolHostStatusDto['installSource'], string> = {
  npm: 'npm',
  homebrew: 'Homebrew',
  native: '工具自带',
  app_bundle: '应用程序',
  unknown: '未知',
  not_applicable: '不适用',
}

const upgradeOutcomeMessages: Record<string, string> = {
  updated: '升级完成，版本已重新检查。',
  already_current: '重新检查后已是最新版本。',
  process_failed: '升级进程失败，工具版本未确认更新。',
  timed_out: '升级超时，工具版本未确认更新，请稍后重新检查。',
  postcheck_failed: '升级命令已结束，但无法确认新版本，请重新检查。',
  version_unchanged: '升级命令已结束，但版本没有变化。',
  target_changed: '工具安装已发生变化，本次升级已取消，请重新检查。',
  unsupported_installation: '当前安装来源不支持由 Bandi 升级，请使用官方方式更新。',
}

export function ToolsPage() {
  const { dispatch } = useApp()
  const desktop = isDesktopRuntime()
  const [statuses, setStatuses] = useState<AiToolHostStatusDto[]>(() => aiClients.map((client) => browserStatus(client.id as AiToolHostStatusDto['toolId'])))
  const [selectedToolId, setSelectedToolId] = useState(aiClients[0].id)
  const [filter, setFilter] = useState<ToolFilter>('all')
  const [loading, setLoading] = useState(desktop)
  const [busyAction, setBusyAction] = useState<'install' | 'reveal' | 'upgrade'>()
  const [upgradePreview, setUpgradePreview] = useState<AiToolUpgradePreviewDto>()
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')

  const load = async () => {
    if (!desktop) return
    setLoading(true)
    setError('')
    try {
      setStatuses(await listAiToolHostStatuses())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!desktop) return
    void listAiToolHostStatuses()
      .then(setStatuses)
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setLoading(false))
  }, [desktop])

  const statusById = useMemo(() => new Map(statuses.map((status) => [status.toolId, status])), [statuses])
  const visibleClients = aiClients.filter((client) => {
    if (filter === 'all') return true
    return statusById.get(client.id)?.availability === filter
  })
  const selectedClient = visibleClients.find((client) => client.id === selectedToolId) ?? visibleClients[0]
  const selectedStatus = selectedClient ? statusById.get(selectedClient.id) ?? browserStatus(selectedClient.id as AiToolHostStatusDto['toolId']) : undefined

  useEffect(() => {
    if (selectedClient && selectedClient.id !== selectedToolId) setSelectedToolId(selectedClient.id)
  }, [selectedClient, selectedToolId])

  const runAction = async (kind: 'install' | 'reveal', operation: () => Promise<unknown>, message: string) => {
    setBusyAction(kind)
    setError('')
    setFeedback('')
    try {
      await operation()
      setFeedback(message)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusyAction(undefined)
    }
  }

  const request = () => ({ toolId: selectedStatus!.toolId, requestId: crypto.randomUUID() })
  const openInstall = () => runAction('install', () => openAiToolInstallPage(request()), '已请求在浏览器中打开官方安装页面。')
  const revealConfig = () => runAction('reveal', () => revealAiToolConfigLocation(request()), '已请求在文件管理器中显示固定配置位置。')
  const openLaunch = () => selectedClient && dispatch({ type: 'OPEN_DIALOG', dialog: { kind: 'client-guide', clientId: selectedClient.id } })
  const previewUpgrade = async () => {
    setBusyAction('upgrade')
    setError('')
    setFeedback('')
    try {
      setUpgradePreview(await previewAiToolUpgrade(request()))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusyAction(undefined)
    }
  }
  const commitUpgrade = async () => {
    if (!upgradePreview) return
    setBusyAction('upgrade')
    setError('')
    try {
      const result = await commitAiToolUpgrade({
        toolId: upgradePreview.toolId,
        requestId: upgradePreview.requestId,
        previewRef: upgradePreview.previewRef,
        confirmation: true,
      })
      setUpgradePreview(undefined)
      await load()
      const message = upgradeOutcomeMessages[result.outcome] ?? '升级请求已结束，请重新检查版本。'
      if (result.outcome === 'updated' || result.outcome === 'already_current') setFeedback(message)
      else setError(message)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusyAction(undefined)
    }
  }

  return <>
    <PageHeader title="AI 工具" description="检查本机工具、查看固定配置位置，并选择 Team、Agent 与可选需求后继续。" />
    {!desktop && <p className="mb-5 rounded-lg border border-warning/25 bg-warning/8 px-4 py-3 text-sm text-warning">本机检查、配置位置、升级和启动仅在 Bandi Desktop 中可用；浏览器不会读取或启动电脑上的工具。</p>}
    <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(240px,0.72fr)_minmax(0,1.7fr)]">
      <ToolList clients={visibleClients} statuses={statusById} selectedToolId={selectedClient?.id} filter={filter} loading={loading} onFilter={setFilter} onSelect={setSelectedToolId} />
      {selectedClient && selectedStatus
        ? <ToolDetails client={selectedClient} status={selectedStatus} desktop={desktop} loading={loading} busyAction={busyAction} error={error} feedback={feedback} onReload={load} onInstall={openInstall} onReveal={revealConfig} onUpgrade={() => void previewUpgrade()} onLaunch={openLaunch} />
        : <section className="panel p-5"><EmptyState title="此筛选下没有工具" description="请选择其他筛选查看固定内置工具。" action={<Button size="sm" variant="outline" onClick={() => setFilter('all')}>查看全部</Button>} /></section>}
    </div>
    <AppDialog
      open={Boolean(upgradePreview)}
      onOpenChange={(open) => { if (!open) setUpgradePreview(undefined) }}
      title={`升级 ${selectedClient?.name ?? 'AI 工具'}`}
      description="Bandi 将使用已识别的安装来源升级这一项，并在完成后重新检查版本。"
      dismissible={busyAction !== 'upgrade'}
      size="sm"
      footer={<><Button variant="outline" disabled={busyAction === 'upgrade'} onClick={() => setUpgradePreview(undefined)}>取消</Button><Button disabled={busyAction === 'upgrade'} onClick={() => void commitUpgrade()}>{busyAction === 'upgrade' ? '正在升级…' : '确认升级'}</Button></>}
    >
      {upgradePreview && <div className="space-y-4 text-sm">
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-muted/25 p-4">
          <div><div className="text-xs text-muted-foreground">当前版本</div><p className="mt-1 font-medium">{upgradePreview.currentVersion}</p></div>
          <div><div className="text-xs text-muted-foreground">目标版本</div><p className="mt-1 font-medium">{upgradePreview.latestVersion}</p></div>
        </div>
        <p className="leading-6 text-muted-foreground">{upgradePreview.confirmationText}</p>
        {error && <p role="alert" className="text-danger">{error}</p>}
      </div>}
    </AppDialog>
  </>
}

function ToolList({ clients, statuses, selectedToolId, filter, loading, onFilter, onSelect }: {
  clients: AiClient[]
  statuses: Map<string, AiToolHostStatusDto>
  selectedToolId?: string
  filter: ToolFilter
  loading: boolean
  onFilter: (filter: ToolFilter) => void
  onSelect: (id: AiClient['id']) => void
}) {
  const filters: Array<[ToolFilter, string]> = [['installed', '已检测到'], ['not_found', '未检测到'], ['all', '全部']]
  return <section className="panel min-w-0 overflow-hidden lg:min-h-[38rem]">
    <div className="border-b border-border p-3">
      <div className="grid grid-cols-3 gap-1" aria-label="AI 工具筛选">{filters.map(([id, label]) => <Button key={id} size="sm" variant={filter === id ? 'default' : 'ghost'} aria-pressed={filter === id} onClick={() => onFilter(id)}>{label}</Button>)}</div>
    </div>
    {loading && <p className="p-4 text-sm text-muted-foreground" role="status">正在检查本机工具…</p>}
    <div className="divide-y divide-border" role="list" aria-label="AI 编程工具">{clients.map((client) => {
      const status = statuses.get(client.id)
      const selected = client.id === selectedToolId
      return <button key={client.id} type="button" aria-current={selected ? 'true' : undefined} onClick={() => onSelect(client.id)} className={cn('flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', selected && 'bg-muted/70')}>
        <AiClientIcon client={client} size={38} tile />
        <span className="min-w-0 flex-1"><b className="block truncate text-sm">{client.name}</b><small className="text-muted-foreground">{status ? availabilityLabels[status.availability] : '尚未检查'}</small></span>
        {status && <span className={cn('size-2 shrink-0 rounded-full', status.availability === 'installed' ? 'bg-success' : status.availability === 'detection_failed' ? 'bg-danger' : 'bg-muted-foreground/45')} aria-hidden="true" />}
      </button>
    })}</div>
  </section>
}

function ToolDetails({ client, status, desktop, loading, busyAction, error, feedback, onReload, onInstall, onReveal, onUpgrade, onLaunch }: {
  client: AiClient
  status: AiToolHostStatusDto
  desktop: boolean
  loading: boolean
  busyAction?: 'install' | 'reveal' | 'upgrade'
  error: string
  feedback: string
  onReload: () => Promise<void>
  onInstall: () => void
  onReveal: () => void
  onUpgrade: () => void
  onLaunch: () => void
}) {
  const canLaunch = desktop && status.availability === 'installed' && status.contextMode !== 'unavailable'
  return <section className="min-w-0 space-y-5">
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-5">
        <div className="flex min-w-0 items-center gap-4"><AiClientIcon client={client} size={52} tile /><div className="min-w-0"><h2 className="truncate text-xl font-semibold">{client.name}</h2><p className="mt-1 text-sm text-muted-foreground">{client.description}</p></div></div>
        <StatusBadge tone={availabilityTones[status.availability]}>{availabilityLabels[status.availability]}</StatusBadge>
      </div>
      <div className="space-y-5 p-5">
        <div className="grid gap-4 text-sm sm:grid-cols-2">
          <div><div className="text-xs text-muted-foreground">本机工具</div><p className="mt-1 font-medium">{availabilityLabels[status.availability]}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">仅围绕固定工具检查受限 PATH 和明确的安装位置，不读取工具配置。</p></div>
          <div><div className="text-xs text-muted-foreground">上下文启动</div><p className="mt-1 font-medium">{contextLabels[status.contextMode]}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">启动请求不代表工具已完成初始化或登录。</p></div>
          <div><div className="text-xs text-muted-foreground">当前版本</div><p className="mt-1 font-medium">{status.currentVersion ?? '暂时无法识别'}</p><p className="mt-1 text-xs text-muted-foreground">安装来源：{sourceLabels[status.installSource]}</p></div>
          <div><div className="text-xs text-muted-foreground">最新版本</div><p className="mt-1 font-medium">{status.latestVersion ?? '暂时无法查询'}</p><p className="mt-1 text-xs text-muted-foreground">{status.installationCount > 1 ? `检测到 ${status.installationCount} 个安装，暂不支持自动选择。` : status.versionState === 'up_to_date' ? '当前已是最新版本。' : status.versionState === 'ahead_or_prerelease' ? '当前版本高于公开稳定版或为预发布版。' : '版本查询与本机检测相互独立。'}</p></div>
        </div>
        <div className="rounded-lg border border-border bg-muted/25 p-4"><div className="text-xs text-muted-foreground">固定配置位置</div><code className="mt-2 block break-all text-sm">{status.configLocationLabel}</code><Button className="mt-3" size="sm" variant="outline" disabled={!desktop || !status.canRevealConfig || Boolean(busyAction)} onClick={onReveal}><FolderOpen size={15} aria-hidden="true" />{busyAction === 'reveal' ? '正在显示…' : '在文件管理器中显示'}</Button></div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
          <Button size="sm" variant="ghost" disabled={!desktop || loading} onClick={() => void onReload()}><RefreshCw size={15} aria-hidden="true" />{loading ? '正在检查…' : '重新检查'}</Button>
          <div className="flex flex-wrap gap-2">{status.availability !== 'installed' && <Button variant="outline" disabled={!desktop || !status.canOpenOfficialInstallPage || Boolean(busyAction)} onClick={onInstall}><ExternalLink size={15} aria-hidden="true" />{busyAction === 'install' ? '正在打开…' : '查看官方安装方式'}</Button>}{status.versionState === 'update_available' && <Button variant="outline" disabled={!desktop || !status.canUpgrade || Boolean(busyAction)} onClick={onUpgrade}><RefreshCw size={15} aria-hidden="true" />{busyAction === 'upgrade' ? '正在准备…' : `升级到 ${status.latestVersion ?? '最新版本'}`}</Button>}<Button disabled={!canLaunch || Boolean(busyAction)} onClick={onLaunch}><Play size={15} aria-hidden="true" />在此工具中启动</Button></div>
        </div>
        {feedback && <p role="status" className="text-sm text-success">{feedback}</p>}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    </div>
  </section>
}
