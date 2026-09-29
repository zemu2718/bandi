import { useState } from 'react'
import { ArrowRight, CheckCircle2, CircleAlert, Plus, RefreshCw, ScanSearch } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { continueAgentRecovery } from '../desktop-bridge'
import { Button } from '../components/ui/button'
import { PageHeader, StatusBadge } from '../components/app/page'
import { useApp } from '../state'
import { getConfigurationStatusSummary, type ConfigurationStatusItem } from '../domain-selectors'

export function HomePage() {
  const { state, dispatch, hydrateDesktop } = useApp()
  const navigate = useNavigate()
  const [recovering, setRecovering] = useState<string>()
  const summary = getConfigurationStatusSummary(state)
  if (summary.phase === 'failed') return <HomeHydrationFailed onRetry={hydrateDesktop} />
  if (summary.phase === 'loading') return <HomeHydrationPending />
  if (summary.phase === 'first-use') return <FirstAgentWelcome />
  const desktop = state.runtime === 'desktop'
  const refreshing = desktop && Object.values(state.hydration).some((status) => status === 'loading')
  const recover = async (operationId: string) => {
    if (recovering) return
    setRecovering(operationId)
    try {
      const result = await continueAgentRecovery(operationId)
      dispatch({ type: 'SYNC_AGENT_RECOVERY', operation: result.operation, agent: result.agent })
      const deleting = result.operation.operationKind === 'delete'
      dispatch({
        type: 'SHOW_NOTICE',
        notice: result.operation.status === 'completed'
          ? deleting
            ? { tone: 'success', title: 'Agent 清理已完成', description: '待清理的本机文件和配置版本已处理。' }
            : { tone: 'success', title: 'Agent 配置已修复', description: '文件、配置版本与组织关系已完成保存。' }
          : deleting
            ? { tone: 'warning', title: 'Agent 清理仍需处理', description: result.operation.safeReason ?? 'Agent 配置已删除，请勿重复删除。' }
            : { tone: 'warning', title: 'Agent 配置仍需处理', description: result.operation.safeReason ?? '请查看当前恢复阶段。' },
      })
    } catch (error) {
      dispatch({ type: 'SHOW_NOTICE', notice: { tone: 'error', title: '无法继续修复 Agent 配置', description: error instanceof Error ? error.message : String(error) } })
    } finally {
      setRecovering(undefined)
    }
  }
  const renderItem = (item: ConfigurationStatusItem) => {
    if (item.kind === 'agent') return <button key={`agent-${item.agent.id}`} onClick={() => navigate(`/agents/${item.agent.id}`)} className="flex w-full items-start gap-3 text-left"><CircleAlert size={18} className={item.status.level === 'warning' ? 'mt-0.5 text-warning' : 'mt-0.5 text-danger'} aria-hidden="true" /><span className="flex-1"><b className="block text-sm">{item.status.label}</b><small className="text-muted-foreground">{item.agent.name} · {item.status.issues[0]?.label}</small></span><ArrowRight size={16} aria-hidden="true" /></button>
    if (item.kind === 'diagnostic') {
      const { diagnostic } = item
      return <div key={`diagnostic-${diagnostic.source}-${diagnostic.code}-${diagnostic.path}-${item.index}`} className="flex items-start gap-3"><CircleAlert size={18} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" /><span className="min-w-0 flex-1"><b className="block text-sm">Agent 配置需要处理</b><small className="block text-muted-foreground">{diagnostic.message}</small>{diagnostic.remediation && <small className="block text-muted-foreground">{diagnostic.remediation}</small>}<details className="mt-1 text-xs text-muted-foreground"><summary className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">技术详情</summary><span className="mt-1 block break-words font-mono [overflow-wrap:anywhere]">{diagnostic.code}{diagnostic.source ? ` · ${diagnostic.source}` : ''}{diagnostic.path ? ` · ${diagnostic.path}` : ''}</span></details></span><Button variant="outline" size="sm" disabled={refreshing} aria-busy={refreshing} onClick={hydrateDesktop}><RefreshCw size={14} aria-hidden="true" />{refreshing ? '读取中…' : '重新读取'}</Button></div>
    }
    const { operation } = item
    const deleting = operation.operationKind === 'delete'
    return <div key={`recovery-${operation.id}`} className="flex items-start gap-3"><CircleAlert size={18} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" /><span className="min-w-0 flex-1"><b className="block text-sm">{deleting ? 'Agent 删除清理尚未完成' : 'Agent 配置尚未完整保存'}</b><small className="block text-muted-foreground">{state.agents.find((agent) => agent.id === operation.agentId)?.name ?? operation.agentId} · {operation.status === 'blocked' ? '内容已变化，不会自动覆盖' : deleting ? 'Agent 配置已删除，请勿重复删除' : '可安全继续未完成阶段'}</small></span>{operation.status === 'blocked' ? <Button asChild variant="outline" size="sm"><Link to={`/agents/${operation.agentId}`}>查看 Agent</Link></Button> : <Button variant="outline" size="sm" disabled={Boolean(recovering)} aria-busy={recovering === operation.id} onClick={() => void recover(operation.id)}>{recovering === operation.id ? (deleting ? '清理中…' : '修复中…') : (deleting ? '继续清理' : '继续修复')}</Button>}</div>
  }

  return <>
    <PageHeader title="配置状态" description={desktop ? '集中查看并处理 Agent 的长期配置问题。' : '查看演示配置与待处理事项。'} action={!desktop ? <Button variant="outline" onClick={() => dispatch({ type: 'TOAST', text: '浏览器演示未执行本机扫描 · 未读取文件或运行命令' })}><ScanSearch size={16} aria-hidden="true" />查看扫描边界</Button> : undefined} />
    {summary.items.length ? <section id="pending-config" className="panel max-w-5xl scroll-mt-24 border-l-[3px] border-l-warning p-5">
      <div className="flex items-center justify-between"><div className="label">待处理配置</div><StatusBadge tone="warning">{summary.items.length} 项</StatusBadge></div>
      <div className="mt-4 space-y-4">{summary.items.map(renderItem)}</div>
    </section> : <section id="pending-config" className="panel grid min-h-56 max-w-5xl scroll-mt-24 place-items-center p-6 text-center">
      <div><CheckCircle2 className="mx-auto text-success" size={28} aria-hidden="true" /><h2 className="mt-3 font-semibold">配置正常</h2><p className="mt-2 text-sm text-muted-foreground">{desktop ? '当前没有需要处理的 Agent 配置问题。' : '当前演示配置已就绪。'}</p><Button asChild variant="outline" size="sm" className="mt-5"><Link to="/agents">管理 Agent</Link></Button></div>
    </section>}
  </>
}

function HomeHydrationPending() {
  return <div className="mx-auto max-w-5xl py-8 sm:py-14"><section className="panel p-6 sm:p-10" aria-busy="true"><div className="label">正在读取本机配置</div><h1 className="mt-3 text-3xl font-semibold tracking-tight">恢复你的 Agent 配置</h1><p className="mt-4 text-sm leading-7 text-muted-foreground">Bandi 正在读取 Agent 和组织配置；完成前不会展示演示数据，也不会误判为首次使用。</p></section></div>
}

const hydrationLabels = {
  managedAgents: 'Agent 配置',
  organization: '组织配置',
  sharedAssets: '共享资产索引',
  agentRecovery: '待恢复的 Agent 配置',
} as const

function HomeHydrationFailed({ onRetry }: { onRetry: () => void }) {
  const { state } = useApp()
  if (state.factoryReset.status === 'legacy-database-required') {
    return <div className="mx-auto max-w-5xl py-8 sm:py-14"><section className="panel p-6 sm:p-10" role="alert"><div className="label text-warning">需要重置</div><h1 className="mt-3 text-3xl font-semibold tracking-tight">旧版开发数据无法继续使用</h1><p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground">Bandi 不会迁移或读取旧数据。请重置 Bandi；确认后应用会自动重新打开。</p><Button asChild variant="danger" className="mt-6"><Link to="/settings?section=recovery&tab=reset">前往重置 Bandi</Link></Button><details className="mt-4 text-xs text-muted-foreground"><summary className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">查看技术详情</summary><p className="mt-2 break-words font-mono [overflow-wrap:anywhere]">{state.factoryReset.technicalDetails}</p></details></section></div>
  }
  return <div className="mx-auto max-w-5xl py-8 sm:py-14">
    <section className="panel p-6 sm:p-10" role="alert">
      <div className="label text-danger">读取未完成</div>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">无法完整读取本机配置</h1>
      <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground">Bandi 不会把读取失败当作首次使用，也不会用演示数据替代本机事实。请查看具体失败项后重新读取。</p>
      <ul className="mt-6 space-y-3">
        {(Object.keys(hydrationLabels) as Array<keyof typeof hydrationLabels>).map((key) => {
          const status = state.hydration[key]
          return <li key={key} className="rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><b className="text-sm">{hydrationLabels[key]}</b><StatusBadge tone={status === 'failed' ? 'danger' : status === 'succeeded' ? 'success' : 'neutral'}>{status === 'failed' ? '读取失败' : status === 'succeeded' ? '读取成功' : '仍在读取'}</StatusBadge></div>
            {state.hydrationErrors[key] && <p className="mt-2 text-sm leading-6 text-danger">{state.hydrationErrors[key]}</p>}
          </li>
        })}
      </ul>
      <div className="mt-6"><Button onClick={onRetry} disabled={Object.values(state.hydration).every((status) => status === 'loading')}><RefreshCw size={16} aria-hidden="true" />重新读取</Button></div>
    </section>
  </div>
}

function FirstAgentWelcome() {
  const { state, dispatch } = useApp()
  const capabilities = [
    ['Skills（技能）', '为 Agent 提供可复用的专业能力。'],
    ['职责与指令', '定义它负责什么，以及如何工作。'],
    ['长期记忆', '保留需要持续使用的信息。'],
    ['权限与其他配置', '约束访问范围，并连接所需配置资产。'],
  ]
  return <div className="mx-auto max-w-5xl pb-8 sm:pb-10"><section className="panel overflow-hidden"><div className="grid gap-10 p-6 sm:p-10 lg:grid-cols-[1.1fr_.9fr] lg:gap-14"><div className="self-center"><div className="label">欢迎使用 Bandi</div><h1 className="mt-3 max-w-xl text-3xl font-semibold tracking-tight sm:text-4xl">创建你的第一个长期 Agent</h1><p className="mt-4 max-w-xl text-[15px] leading-7 text-muted-foreground">Bandi 用于管理不同职责 Agent 的长期配置。首次新建或导入的 Agent 会加入“个人” Team。</p><div className="mt-7 flex flex-wrap items-center gap-3"><Button asChild><Link to="/agents/new"><Plus size={16} aria-hidden="true" />新建 Agent</Link></Button><Button asChild variant="outline"><Link to="/agents/new?mode=import">导入已有 Agent</Link></Button><Button variant="ghost" className="text-muted-foreground" onClick={() => dispatch({ type: 'COMPLETE_ONBOARDING' })}>稍后设置</Button></div><p className="mt-4 text-xs leading-5 text-muted-foreground">{state.runtime === 'desktop' ? '仅在你主动操作时检查固定配置位置。' : '浏览器演示不会读取或写入本机文件。'}</p></div><section className="border-y border-border py-1" aria-labelledby="agent-capabilities-title"><h2 id="agent-capabilities-title" className="sr-only">一个长期 Agent 包含</h2><div className="label py-4">一个长期 Agent 包含</div><ul className="divide-y divide-border">{capabilities.map(([title, text], index) => <li key={title} className="py-4"><b className={`block text-sm ${index === 0 ? 'text-foreground' : ''}`}>{title}</b><p className="mt-1 text-sm leading-6 text-muted-foreground">{text}</p></li>)}</ul></section></div></section></div>
}
