import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useApp } from '../../state'
import { Copy, Github, RefreshCw, RotateCcw, Upload } from 'lucide-react'
import type {
  BackupOverviewDto,
  GithubDeviceFlowDto,
  GithubDeviceFlowPollDto,
  PortableRestorePreviewDto,
  PortableRestoreResultDto,
  PortableRestoreScope,
  RemoteBackupHistoryItemDto,
  RemoteRepositoryDto,
} from '../../contracts'
import { ErrorNotice, errorFromCause, type UserFacingError } from '../../components/app/error-notice'
import { MonoPath, StatusBadge } from '../../components/app/page'
import { Button } from '../../components/ui/button'
import { AppDialog } from '../../components/ui/dialog'
import { Switch } from '../../components/ui/switch'
import {
  connectPrivateBackupRepository,
  createPortableSnapshot,
  createPrivateBackupRepository,
  disconnectGithub,
  disconnectRemoteBackupRepository,
  getBackupOverview,
  isDesktopRuntime,
  listRemoteBackupHistory,
  pollGithubDeviceFlow,
  previewPortableRestore,
  restorePortableSnapshot,
  setAutomaticRemoteBackup,
  setRemoteMemoryPolicy,
  startGithubDeviceFlow,
  uploadPortableSnapshot,
} from '../../desktop-bridge'
import { formatDisplayTimestamp } from '../../presentation'

function requestId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

function operationError(cause: unknown, title: string, description: string): UserFacingError {
  return errorFromCause(cause, title, description)
}

const githubStatusLabel: Record<BackupOverviewDto['github']['status'], string> = {
  connected: '已连接',
  disconnected: '未连接',
  unavailable: '当前不可用',
}

const historyStatusLabel: Record<RemoteBackupHistoryItemDto['status'], string> = {
  uploaded: '已上传',
  pending_upload: '等待上传',
  failed: '上传失败',
}

export function RemoteBackupPanel() {
  const desktop = isDesktopRuntime()
  const { state } = useApp()
  const [overview, setOverview] = useState<BackupOverviewDto>()
  const [history, setHistory] = useState<RemoteBackupHistoryItemDto[]>([])
  const [flow, setFlow] = useState<GithubDeviceFlowDto>()
  const [repositoryOpen, setRepositoryOpen] = useState(false)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [restoreTarget, setRestoreTarget] = useState<RemoteBackupHistoryItemDto>()
  const [restorePreview, setRestorePreview] = useState<PortableRestorePreviewDto>()
  const [restoreResult, setRestoreResult] = useState<PortableRestoreResultDto>()
  const [restoreConfirmed, setRestoreConfirmed] = useState(false)
  const [memoryRestoreConfirmed, setMemoryRestoreConfirmed] = useState(false)
  const [restoreScope, setRestoreScope] = useState<PortableRestoreScope>({ kind: 'all' })
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<UserFacingError>()
  const [notice, setNotice] = useState<string>()

  const refresh = useCallback(async () => {
    if (!desktop) return
    setBusy('refresh')
    setError(undefined)
    try {
      const [nextOverview, nextHistory] = await Promise.all([
        getBackupOverview(),
        listRemoteBackupHistory(),
      ])
      setOverview(nextOverview)
      setHistory(nextHistory)
    } catch (cause) {
      setError(operationError(cause, '无法读取远程备份', '备份设置没有变化。请检查网络和 Bandi Desktop 后重试。'))
    } finally {
      setBusy(undefined)
    }
  }, [desktop])

  useEffect(() => { void refresh() }, [refresh])

  if (!desktop) return <section className="panel p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><b>Private Git 远程备份</b><StatusBadge tone="neutral">仅 Desktop 可用</StatusBadge></div>
    <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">完整备份需要由 Bandi Desktop 安全读取受管数据并连接 Private Git 仓库。浏览器不会登录 GitHub、创建仓库、上传或恢复数据。</p>
  </section>

  const githubConnected = overview?.github.status === 'connected'
  const repository = overview?.repository ?? undefined
  const canBackup = githubConnected && Boolean(repository)

  const startLogin = async () => {
    if (busy) return
    setBusy('login')
    setError(undefined)
    try {
      setFlow(await startGithubDeviceFlow({ requestId: requestId('github-device') }))
    } catch (cause) {
      setError(operationError(cause, '无法开始 GitHub 登录', '尚未连接 GitHub。请检查网络或应用的 GitHub 登录配置后重试。'))
    } finally {
      setBusy(undefined)
    }
  }

  const pollLogin = async () => {
    if (!flow || busy) return
    setBusy('poll')
    setError(undefined)
    try {
      const result: GithubDeviceFlowPollDto = await pollGithubDeviceFlow({ requestId: requestId('github-poll'), flowId: flow.flowId })
      if (result.status === 'authorized') {
        setFlow(undefined)
        setNotice(`已连接 GitHub${result.login ? `：${result.login}` : ''}`)
        await refresh()
      } else if (result.status === 'pending' || result.status === 'slow_down') {
        setNotice(result.status === 'slow_down'
          ? `GitHub 要求降低检查频率，请在 ${result.retryAfterEpochSeconds ? formatDisplayTimestamp(new Date(result.retryAfterEpochSeconds * 1000).toISOString()) : '稍后'} 再确认。`
          : '尚未完成授权。请在 GitHub 页面输入设备代码。')
      } else {
        setFlow(undefined)
        setError({ title: result.status === 'denied' ? 'GitHub 授权已拒绝' : 'GitHub 登录已过期', description: '没有保存登录凭据。请重新开始登录。' })
      }
    } catch (cause) {
      setError(operationError(cause, '无法确认 GitHub 登录', '尚未确认授权。请稍后重试；不要重复开始多个登录流程。'))
    } finally {
      setBusy(undefined)
    }
  }

  const disconnectAccount = async () => {
    if (busy) return
    setBusy('disconnect-account')
    setError(undefined)
    try {
      await disconnectGithub({ requestId: requestId('github-disconnect') })
      setNotice('已移除这台设备上的 GitHub 连接。远端仓库和备份没有删除。')
      await refresh()
    } catch (cause) {
      setError(operationError(cause, '无法断开 GitHub', '连接可能仍保存在这台设备上。请重试或检查系统钥匙串。'))
    } finally {
      setBusy(undefined)
    }
  }

  const disconnectRepository = async () => {
    if (busy) return
    setBusy('disconnect-repository')
    setError(undefined)
    try {
      await disconnectRemoteBackupRepository({ requestId: requestId('repository-disconnect') })
      setNotice('已停止使用该仓库。GitHub 上的仓库和备份没有删除。')
      await refresh()
    } catch (cause) {
      setError(operationError(cause, '无法断开备份仓库', '仓库连接没有变化。请稍后重试。'))
    } finally {
      setBusy(undefined)
    }
  }

  const upload = async () => {
    if (!canBackup || busy) return
    setBusy('upload')
    setError(undefined)
    setNotice(undefined)
    try {
      const snapshot = await createPortableSnapshot({ requestId: requestId('portable-snapshot'), includeMemory: overview?.includeMemory ?? false })
      const result = await uploadPortableSnapshot({ requestId: requestId('remote-upload'), snapshotId: snapshot.snapshotId })
      setNotice(`远程备份已上传：${result.snapshotId}`)
      await refresh()
    } catch (cause) {
      setError(operationError(cause, '无法完成远程备份', '本机快照可能已经保存，但尚未确认上传成功。请读取历史后再决定是否重试。'))
    } finally {
      setBusy(undefined)
    }
  }

  const toggleAutomatic = async (enabled: boolean) => {
    if (!overview || busy) return
    setBusy('automatic')
    setError(undefined)
    try {
      setOverview(await setAutomaticRemoteBackup({ requestId: requestId('automatic-backup'), enabled }))
      setNotice(enabled ? '自动备份已开启，仅在 Bandi Desktop 运行期间生效。' : '自动备份已关闭。')
    } catch (cause) {
      setError(operationError(cause, '无法更新自动备份', '自动备份设置没有变化。请检查仓库连接后重试。'))
    } finally {
      setBusy(undefined)
    }
  }

  const openRestore = (snapshot: RemoteBackupHistoryItemDto) => {
    setRestoreTarget(snapshot)
    setRestorePreview(undefined)
    setRestoreResult(undefined)
    setRestoreConfirmed(false)
    setMemoryRestoreConfirmed(false)
    setRestoreScope({ kind: 'all' })
    setError(undefined)
  }

  const closeRestore = () => {
    setRestoreTarget(undefined)
    setRestorePreview(undefined)
    setRestoreResult(undefined)
    setRestoreConfirmed(false)
    setMemoryRestoreConfirmed(false)
  }

  const previewRestore = async () => {
    if (!restoreTarget || busy) return
    setBusy('portable-restore-preview')
    setError(undefined)
    try {
      setRestorePreview(await previewPortableRestore({
        requestId: requestId('portable-restore-preview'),
        snapshotId: restoreTarget.snapshotId,
        scope: restoreScope,
      }))
    } catch (cause) {
      setError(operationError(cause, '无法预览便携快照恢复', '没有读取或校验该快照，当前数据没有变化。请重新读取后重试。'))
    } finally { setBusy(undefined) }
  }

  const restore = async () => {
    if (!restoreTarget || !restorePreview?.canRestore || !restoreConfirmed || (restorePreview.closure.memoryIds.length > 0 && !memoryRestoreConfirmed) || busy) return
    setBusy('portable-restore')
    setError(undefined)
    try {
      setRestoreResult(await restorePortableSnapshot({
        requestId: requestId('portable-restore'),
        snapshotId: restoreTarget.snapshotId,
        scope: restorePreview.scope,
        previewRef: restorePreview.previewRef,
        confirmed: true,
      }))
    } catch (cause) {
      setError(operationError(cause, '无法完成便携快照恢复', '可能已经部分恢复。请查看恢复结果，不要直接重复提交。'))
    } finally { setBusy(undefined) }
  }

  const excludeMemory = async () => {
    if (!overview || busy) return
    setBusy('memory')
    setError(undefined)
    try {
      setOverview(await setRemoteMemoryPolicy({ requestId: requestId('memory-policy'), includeMemory: false, confirmed: true }))
      setNotice('Agent 长期记忆已从后续远程备份中排除。已有远端历史不会被删除。')
    } catch (cause) {
      setError(operationError(cause, '无法更新长期记忆范围', '备份范围没有变化。请稍后重试。'))
    } finally {
      setBusy(undefined)
    }
  }

  return <div className="space-y-5">
    <section className="panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><div className="flex flex-wrap items-center gap-2"><b>Private Git 远程备份</b><StatusBadge tone={canBackup ? 'success' : 'warning'}>{canBackup ? '可以备份' : '尚未就绪'}</StatusBadge></div><p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">将 Bandi 的便携快照保存到你的 GitHub Private 仓库。不会上传凭据、Token、钥匙串、聊天、日志、Todo 或执行过程。</p></div>
        <Button variant="outline" size="sm" disabled={Boolean(busy)} onClick={() => void refresh()}><RefreshCw size={14} aria-hidden="true" />重新读取</Button>
      </div>
      {error && <ErrorNotice error={error} className="mt-4" />}
      {notice && <p role="status" aria-live="polite" className="mt-4 rounded-lg border border-border bg-muted/40 p-3 text-sm">{notice}</p>}
      {!overview && <p className="mt-5 text-sm text-muted-foreground">正在读取远程备份状态…</p>}
      {overview && <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Summary label="GitHub" value={githubStatusLabel[overview.github.status]} detail={overview.github.login} tone={githubConnected ? 'success' : 'warning'} />
        <Summary label="Private 仓库" value={repository ? `${repository.owner}/${repository.name}` : '未连接'} tone={repository ? 'success' : 'warning'} />
        <Summary label="自动备份" value={overview.automaticBackupEnabled ? '已开启' : '已关闭'} detail={overview.lastSuccessfulBackupAt ? `最近成功：${formatDisplayTimestamp(overview.lastSuccessfulBackupAt)}` : undefined} tone={overview.automaticBackupEnabled ? 'success' : 'neutral'} />
        <Summary label="Agent 长期记忆" value={overview.includeMemory ? '包含' : '已排除'} tone={overview.includeMemory ? 'warning' : 'neutral'} />
      </div>}
    </section>

    {overview && <section className="panel divide-y divide-border overflow-hidden">
      <SettingsRow title="GitHub 账号" description={overview.github.reason ?? (githubConnected ? '访问令牌只保存在系统钥匙串。' : '使用 GitHub Device Flow 登录，不需要在 Bandi 输入密码。')} action={githubConnected ? <Button variant="outline" disabled={Boolean(busy)} onClick={() => void disconnectAccount()}>断开账号</Button> : <Button disabled={Boolean(busy) || overview.github.status === 'unavailable'} onClick={() => void startLogin()}><Github size={16} aria-hidden="true" />登录 GitHub</Button>} />
      <SettingsRow title="备份仓库" description={repository ? `固定使用 Private 仓库 ${repository.owner}/${repository.name}；Bandi 不会 force push。` : '创建新 Private 仓库，或用 owner 和 name 连接已有 Private 仓库。'} action={repository ? <Button variant="outline" disabled={Boolean(busy)} onClick={() => void disconnectRepository()}>断开仓库</Button> : <Button variant="outline" disabled={!githubConnected || Boolean(busy)} onClick={() => setRepositoryOpen(true)}>创建或连接</Button>} />
      <SettingsRow title="手动备份" description="先在本机生成便携快照，完整校验后再上传；上传成功以远端返回结果为准。" action={<Button disabled={!canBackup || Boolean(busy)} onClick={() => void upload()}><Upload size={15} aria-hidden="true" />{busy === 'upload' ? '备份中…' : '立即备份'}</Button>} />
      <SettingsRow title="自动备份" description="配置稳定后再上传，仅在 Bandi Desktop 运行期间生效；默认关闭。" action={<Switch aria-label="启用自动远程备份" checked={overview.automaticBackupEnabled} disabled={!canBackup || Boolean(busy)} onCheckedChange={(checked) => void toggleAutomatic(checked)} />} />
      <SettingsRow title="包含 Agent 长期记忆" description="默认排除。开启只影响后续快照，且需要针对当前仓库单独确认。" action={<Switch aria-label="远程备份包含 Agent 长期记忆" checked={overview.includeMemory} disabled={!repository || Boolean(busy)} onCheckedChange={(checked) => checked ? setMemoryOpen(true) : void excludeMemory()} />} />
    </section>}

    <section className="panel overflow-hidden">
      <div className="border-b border-border p-5"><b>远端历史</b><p className="mt-1 text-xs leading-5 text-muted-foreground">仅显示后端确认的真实快照和上传状态。远端恢复入口将在安全恢复提交链接入后提供。</p></div>
      <div className="divide-y divide-border">{history.map((item) => <article key={`${item.snapshotId}-${item.commitOid ?? ''}`} className="grid min-w-0 gap-3 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><b className="text-sm">{formatDisplayTimestamp(item.createdAt)}</b><StatusBadge tone={item.status === 'uploaded' ? 'success' : item.status === 'failed' ? 'danger' : 'warning'}>{historyStatusLabel[item.status]}</StatusBadge>{item.includeMemory && <StatusBadge tone="warning">包含长期记忆</StatusBadge>}</div><MonoPath>{item.snapshotId}</MonoPath>{item.commitOid && <MonoPath>{item.commitOid}</MonoPath>}</div>{item.status === 'uploaded' && <Button variant="outline" size="sm" disabled={Boolean(busy)} onClick={() => openRestore(item)}><RotateCcw size={14} aria-hidden="true" />预览恢复</Button>}</article>)}{!history.length && <p className="p-5 text-sm text-muted-foreground">尚无远端备份记录。</p>}</div>
    </section>

    <DeviceFlowDialog flow={flow} busy={busy === 'poll'} error={error} onPoll={() => void pollLogin()} onClose={() => { setFlow(undefined); setError(undefined) }} />
    <RepositoryDialog open={repositoryOpen} busy={Boolean(busy)} onClose={() => setRepositoryOpen(false)} onConnected={async (next) => { setRepositoryOpen(false); setNotice(`已连接 Private 仓库：${next.owner}/${next.name}`); await refresh() }} setBusy={setBusy} setError={setError} />
    <MemoryDialog open={memoryOpen} repository={repository} busy={busy === 'memory'} onClose={() => setMemoryOpen(false)} onConfirm={async () => { setBusy('memory'); setError(undefined); try { setOverview(await setRemoteMemoryPolicy({ requestId: requestId('memory-policy'), includeMemory: true, confirmed: true })); setMemoryOpen(false); setNotice('Agent 长期记忆将加入后续远程备份。') } catch (cause) { setError(operationError(cause, '无法确认长期记忆范围', '备份范围没有变化。请检查仓库连接后重试。')) } finally { setBusy(undefined) } }} />
    <PortableRestoreDialog target={restoreTarget} preview={restorePreview} result={restoreResult} confirmed={restoreConfirmed} memoryConfirmed={memoryRestoreConfirmed} scope={restoreScope} teams={state.teams} agents={state.agents} busy={busy} error={error} onScopeChange={(scope) => { setRestoreScope(scope); setRestorePreview(undefined); setRestoreConfirmed(false); setMemoryRestoreConfirmed(false) }} onConfirmChange={setRestoreConfirmed} onMemoryConfirmChange={setMemoryRestoreConfirmed} onPreview={() => void previewRestore()} onRestore={() => void restore()} onClose={closeRestore} />
  </div>
}

function Summary({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone: 'success' | 'warning' | 'neutral' }) {
  return <div className="min-w-0 rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">{label}</p><div className="mt-2"><StatusBadge tone={tone}>{value}</StatusBadge></div>{detail && <p className="mt-2 break-words text-xs text-muted-foreground">{detail}</p>}</div>
}

function SettingsRow({ title, description, action }: { title: string; description: string; action: ReactNode }) {
  return <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><b className="text-sm">{title}</b><p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">{description}</p></div><div className="shrink-0">{action}</div></div>
}

function DeviceFlowDialog({ flow, busy, error, onPoll, onClose }: { flow?: GithubDeviceFlowDto; busy: boolean; error?: UserFacingError; onPoll: () => void; onClose: () => void }) {
  const copy = async () => { if (flow) await navigator.clipboard.writeText(flow.userCode) }
  return <AppDialog open={Boolean(flow)} onOpenChange={(open) => { if (!open) onClose() }} title="在 GitHub 完成登录" description="Bandi 不会读取你的 GitHub 密码。" footer={<><Button variant="outline" onClick={onClose}>取消</Button><Button disabled={busy} onClick={onPoll}>{busy ? '检查中…' : '我已完成授权'}</Button></>}>
    {flow && <div className="space-y-4">{error && <ErrorNotice error={error} />}<div><p className="text-sm font-medium">设备代码</p><div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 p-3"><code className="min-w-0 flex-1 break-all text-lg font-semibold tracking-widest">{flow.userCode}</code><Button variant="outline" size="sm" onClick={() => void copy()}><Copy size={14} aria-hidden="true" />复制</Button></div></div><p className="text-sm leading-6">打开 <a className="font-medium underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={flow.verificationUri} target="_blank" rel="noreferrer">GitHub 设备授权页面</a>，输入上方代码并批准访问。</p><p className="text-xs text-muted-foreground">代码有效期至 {formatDisplayTimestamp(flow.expiresAt)}。完成前不会保存访问令牌。</p></div>}
  </AppDialog>
}

function RepositoryDialog({ open, busy, onClose, onConnected, setBusy, setError }: { open: boolean; busy: boolean; onClose: () => void; onConnected: (repository: RemoteRepositoryDto) => Promise<void>; setBusy: (value?: string) => void; setError: (value?: UserFacingError) => void }) {
  const [mode, setMode] = useState<'create' | 'connect'>('create')
  const [owner, setOwner] = useState('')
  const [name, setName] = useState('bandi-backup')
  const close = () => { onClose(); setMode('create'); setOwner(''); setName('bandi-backup'); setError(undefined) }
  const submit = async () => {
    if (!name.trim() || (mode === 'connect' && !owner.trim()) || busy) return
    setBusy('repository'); setError(undefined)
    try {
      const repository = mode === 'create'
        ? await createPrivateBackupRepository({ requestId: requestId('repository-create'), name: name.trim() })
        : await connectPrivateBackupRepository({ requestId: requestId('repository-connect'), owner: owner.trim(), name: name.trim() })
      await onConnected(repository)
      close()
    } catch (cause) {
      setError(operationError(cause, '无法连接 Private 仓库', '没有保存仓库连接。请确认名称、Private 可见性和写入权限后重试。'))
    } finally { setBusy(undefined) }
  }
  return <AppDialog open={open} onOpenChange={(next) => { if (!next) close() }} title="创建或连接 Private 仓库" description="只接受结构化的 owner 和 name；不接受仓库 URL、分支或 Git 命令。" footer={<><Button variant="outline" onClick={close}>取消</Button><Button disabled={!name.trim() || (mode === 'connect' && !owner.trim()) || busy} onClick={() => void submit()}>{busy ? '校验中…' : mode === 'create' ? '创建并连接' : '校验并连接'}</Button></>}>
    <fieldset><legend className="text-sm font-medium">操作</legend><div className="mt-2 grid grid-cols-2 gap-2"><Button type="button" variant={mode === 'create' ? 'default' : 'outline'} onClick={() => setMode('create')}>创建新仓库</Button><Button type="button" variant={mode === 'connect' ? 'default' : 'outline'} onClick={() => setMode('connect')}>连接已有仓库</Button></div></fieldset>{mode === 'connect' && <label className="mt-4 block text-sm font-medium" htmlFor="remote-repository-owner">仓库所有者<input id="remote-repository-owner" autoComplete="off" className="mt-2 h-11 w-full px-3" value={owner} onChange={(event) => setOwner(event.target.value)} /></label>}<label className="mt-4 block text-sm font-medium" htmlFor="remote-repository-name">仓库名称<input id="remote-repository-name" autoComplete="off" className="mt-2 h-11 w-full px-3" value={name} onChange={(event) => setName(event.target.value)} /></label><p className="mt-4 text-xs leading-5 text-muted-foreground">创建操作固定创建 Private 仓库；连接操作会重新校验 Private 可见性和写入权限。仓库不满足要求时不会保存连接。</p>
  </AppDialog>
}

function PortableRestoreDialog({ target, preview, result, confirmed, memoryConfirmed, scope, teams, agents, busy, error, onScopeChange, onConfirmChange, onMemoryConfirmChange, onPreview, onRestore, onClose }: { target?: RemoteBackupHistoryItemDto; preview?: PortableRestorePreviewDto; result?: PortableRestoreResultDto; confirmed: boolean; memoryConfirmed: boolean; scope: PortableRestoreScope; teams: { id: string; name: string }[]; agents: { id: string; name: string }[]; busy?: string; error?: UserFacingError; onScopeChange: (scope: PortableRestoreScope) => void; onConfirmChange: (value: boolean) => void; onMemoryConfirmChange: (value: boolean) => void; onPreview: () => void; onRestore: () => void; onClose: () => void }) {
  const scopeLabel = (value: PortableRestoreScope) => value.kind === 'all' ? '全部受管数据' : value.kind === 'team' ? `Team：${teams.find((team) => team.id === value.teamId)?.name ?? value.teamId}` : `Agent：${agents.find((agent) => agent.id === value.agentId)?.name ?? value.agentId}`
  const memoryRequired = Boolean(preview?.closure.memoryIds.length)
  return <AppDialog open={Boolean(target)} onOpenChange={(open) => { if (!open) onClose() }} title="恢复便携快照" description={target ? `${target.snapshotId} · ${scopeLabel(scope)}` : undefined} size="lg" footer={<><Button variant="outline" onClick={onClose}>{result ? '关闭' : '取消'}</Button>{!result && (!preview ? <Button disabled={!target || Boolean(busy)} onClick={onPreview}>{busy === 'portable-restore-preview' ? '校验中…' : '校验并预览'}</Button> : <Button variant="danger" disabled={!preview.canRestore || !confirmed || (memoryRequired && !memoryConfirmed) || Boolean(busy)} onClick={onRestore}>{busy === 'portable-restore' ? '恢复中…' : '确认恢复'}</Button>)}</>}>
    {error && <ErrorNotice error={error} className="mb-4" />}
    {!preview && !result && <div className="space-y-4"><p className="text-sm leading-6">先选择恢复范围。Bandi 只按受管数据的 Team、Agent 关系计算依赖闭包，不会读取或恢复范围外的数据。</p><label className="block text-sm font-medium" htmlFor="portable-restore-scope">恢复范围<select id="portable-restore-scope" className="mt-2 h-11 w-full px-3" value={scope.kind === 'all' ? 'all' : `${scope.kind}:${scope.kind === 'team' ? scope.teamId : scope.agentId}`} onChange={(event) => { const [kind, id] = event.target.value.split(':'); onScopeChange(kind === 'team' ? { kind, teamId: id } : kind === 'agent' ? { kind, agentId: id } : { kind: 'all' }) }}><option value="all">全部受管数据</option><optgroup label="Team">{teams.map((team) => <option key={team.id} value={`team:${team.id}`}>{team.name}</option>)}</optgroup><optgroup label="Agent">{agents.map((agent) => <option key={agent.id} value={`agent:${agent.id}`}>{agent.name}</option>)}</optgroup></select></label></div>}
    {preview && !result && <div className="space-y-4"><div className="rounded-lg border border-border bg-muted/40 p-3 text-sm"><p><b>恢复范围：</b>{scopeLabel(preview.scope)}</p><p className="mt-1"><b>将处理：</b>{preview.entries.length} 项 · Team {preview.closure.teamIds.length} · Agent {preview.closure.agentIds.length} · 需求 {preview.closure.taskBriefIds.length} · Memory {preview.closure.memoryIds.length}</p><p className="mt-1 text-xs text-muted-foreground">预览有效期至 {formatDisplayTimestamp(preview.expiresAt)} · 清单哈希 {preview.packageHash}</p></div><div className="max-h-64 space-y-2 overflow-auto">{preview.entries.map((entry) => <div key={`${entry.kind}-${entry.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm"><span><b>{entry.kind}</b><MonoPath>{entry.id}</MonoPath></span><StatusBadge tone={entry.action === 'preserve' ? 'neutral' : 'warning'}>{entry.action === 'create' ? '将创建' : entry.action === 'update' ? '将更新' : '将保留'}</StatusBadge></div>)}</div>{preview.diagnostics?.length ? <p className="text-xs leading-5 text-muted-foreground">{preview.diagnostics.join(' ')}</p> : null}<label className="flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={confirmed} onChange={(event) => onConfirmChange(event.target.checked)} /><span>我确认按上述范围恢复便携快照。恢复前会保留当前数据。</span></label>{memoryRequired && <label className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm"><input className="mt-1" type="checkbox" checked={memoryConfirmed} onChange={(event) => onMemoryConfirmChange(event.target.checked)} /><span><b>单独确认恢复 Agent 长期 Memory</b><br /><span className="text-xs text-muted-foreground">该范围包含 {preview.closure.memoryIds.length} 个 Memory；未单独确认时不会提交恢复。</span></span></label>}</div>}
    {result && <RestoreResult result={result} />}
  </AppDialog>
}

function RestoreResult({ result }: { result: PortableRestoreResultDto }) {
  const restored = result.entries.filter((entry) => entry.status === 'restored').length
  return <div className="space-y-3"><StatusBadge tone={result.status === 'restored' ? 'success' : 'warning'}>{result.status === 'restored' ? '恢复完成' : result.status === 'partial_failure' ? '部分恢复' : '恢复失败'}</StatusBadge><p className="text-sm">已完成 {restored} 项，共 {result.entries.length} 项。失败项保留实际状态，请按恢复引用继续处理。</p><p className="text-xs text-muted-foreground">恢复前安全快照：<MonoPath>{result.preRestoreSnapshotId}</MonoPath></p>{result.entries.map((entry) => <div key={`${entry.kind}-${entry.id}`} className="rounded-lg border border-border p-3 text-sm"><b>{entry.status === 'restored' ? '已恢复' : entry.status === 'partial_failure' ? '部分完成' : '未完成'}</b><MonoPath>{entry.kind} · {entry.id}</MonoPath>{entry.recoveryRef && <p className="mt-1 text-xs text-muted-foreground">恢复引用：{entry.recoveryRef}{entry.retryable ? '（可重试）' : '（需按 recovery 处理）'}</p>}{entry.diagnostics?.length ? <p className="mt-1 text-xs text-muted-foreground">{entry.diagnostics.join(' ')}</p> : null}</div>)}{result.diagnostics?.length ? <p className="text-xs leading-5 text-muted-foreground">{result.diagnostics.join(' ')}</p> : null}</div>
}

function MemoryDialog({ open, repository, busy, onClose, onConfirm }: { open: boolean; repository?: RemoteRepositoryDto; busy: boolean; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [confirmed, setConfirmed] = useState(false)
  const close = () => { setConfirmed(false); onClose() }
  return <AppDialog open={open} onOpenChange={(next) => { if (!next) close() }} title="确认远程备份长期记忆" description={repository ? `目标 Private 仓库：${repository.owner}/${repository.name}` : undefined} footer={<><Button variant="outline" onClick={close}>取消</Button><Button disabled={!confirmed || busy} onClick={() => void onConfirm()}>{busy ? '保存中…' : '确认包含长期记忆'}</Button></>}>
    <p className="text-sm leading-6">后续便携快照将包含当前 Agent 的长期记忆内容。仓库身份或策略版本变化后，需要重新确认。</p><div className="mt-4 rounded-lg border border-border bg-muted/40 p-3 text-xs leading-5 text-muted-foreground"><b className="text-foreground">仍然永不包含</b><p className="mt-1">凭据、Token、Cookie、私钥、钥匙串、聊天、工具调用、Todo、日志、Session 和执行过程。</p></div><label className="mt-4 flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>我确认将 Agent 长期记忆备份到上述 Private 仓库。</span></label>
  </AppDialog>
}
