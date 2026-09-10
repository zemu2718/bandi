import { Check, Copy, Info, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { launchDescriptor } from '../client-adapters'
import { getAvailableAgents } from '../domain-selectors'
import { isDesktopRuntime, requestClientLaunchV3, type CapabilityFactDto } from '../desktop-bridge'
import type { AiClient } from '../mock'
import { normalizeTerminalId } from '../terminal-model'
import { useApp } from '../state'
import { Button } from './ui/button'
import { AppDialog } from './ui/dialog'

function buildContextSummary(teamName: string, agentName: string, task?: { title: string; goal: string; context: string; constraints: string; expectedOutput: string }): string {
  return [
    `Team：${teamName}`,
    `Agent：${agentName}`,
    `需求：${task?.title ?? '未附加'}`,
    task?.goal && `想完成什么：${task.goal}`,
    task?.context && `相关背景：${task.context}`,
    task?.constraints && `任务要求：${task.constraints}`,
    task?.expectedOutput && `希望得到什么：${task.expectedOutput}`,
    '',
    '请使用以上上下文继续。Bandi 不会授予更多权限；任务执行、Todo、日志、审批和验收仍在当前 AI 编程工具中完成。',
  ].filter(Boolean).join('\n')
}

export function ClientLaunchDialog({ client, initialAgentId, close }: { client: AiClient; initialAgentId?: string; close: () => void }) {
  const { state, dispatch } = useApp()
  const initialTeam = state.teams.find((team) => team.id === state.agents.find((agent) => agent.id === initialAgentId)?.teamId)
    ?? state.teams.find((team) => team.id === state.currentTeamId)
    ?? state.teams[0]
  const [teamId, setTeamId] = useState(initialTeam?.id ?? '')
  const [contextExpanded, setContextExpanded] = useState(false)
  const [agentId, setAgentId] = useState(initialAgentId ?? '')
  const [taskId, setTaskId] = useState('')
  const [opening, setOpening] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const [capability, setCapability] = useState<CapabilityFactDto>()
  const descriptor = launchDescriptor(client.id)
  const desktop = isDesktopRuntime()
  const terminalId = normalizeTerminalId(state.runtime === 'desktop' ? state.uiPreferences.terminal : state.settings.terminal)
  const agents = getAvailableAgents(state, teamId)
  const tasks = state.taskBriefs.filter((item) => item.teamId === teamId && !item.archivedAt)
  const team = state.teams.find((item) => item.id === teamId)
  const agent = agents.find((item) => item.id === agentId)
  const task = tasks.find((item) => item.id === taskId)
  const summary = useMemo(() => buildContextSummary(team?.name ?? '未选择', agent?.name ?? '未选择', task), [agent, task, team])

  useEffect(() => {
    if (!agents.some((item) => item.id === agentId)) setAgentId(agents[0]?.id ?? '')
  }, [agentId, agents])

  const selectTeam = (nextTeamId: string) => {
    setTeamId(nextTeamId)
    setAgentId('')
    setTaskId('')
    setError('')
    setCapability(undefined)
  }

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(summary)
      setCopied(true)
    } catch {
      setError('系统未允许访问剪贴板。请手动选择并复制上下文。')
    }
  }

  const launch = async () => {
    if (!desktop || !descriptor || !team || !agent || opening) return
    setOpening(true)
    setError('')
    setCapability(undefined)
    try {
      const result = await requestClientLaunchV3({
        clientId: descriptor.clientId,
        adapterId: descriptor.adapterId,
        terminalId,
        intent: 'start_with_context',
        teamId: team.id,
        agentId: agent.id,
        taskId: task?.id,
      })
      setCapability(result.capability)
      if (result.outcome === 'manual_context_required') {
        if (result.manualPrompt) {
          await navigator.clipboard.writeText(result.manualPrompt)
          setCopied(true)
        }
        close()
        dispatch({ type: 'SHOW_NOTICE', notice: { tone: 'info', title: `${client.name} 打开请求已发送`, description: result.manualPrompt ? '上下文已复制，请在工具中粘贴后继续。' : '此工具暂不支持自动携带上下文。', duration: 6000 } })
      } else {
        close()
        dispatch({ type: 'SHOW_NOTICE', notice: { tone: 'success', title: `${client.name} 启动请求已发送`, description: 'Bandi 不会跟踪工具中的会话、任务或输出。', duration: 5000 } })
      }
    } catch {
      setError('无法启动工具。请确认工具和首选终端可用后重试。')
    } finally {
      setOpening(false)
    }
  }

  return <AppDialog open onOpenChange={(open) => { if (!open) close() }} title={`在 ${client.name} 中继续`} description="选择 Agent，并可附加一条需求作为上下文。" size="lg" footer={<><Button variant="outline" onClick={close}>取消</Button>{desktop ? <Button disabled={!team || !agent || opening} onClick={launch}>{opening ? '正在启动…' : '启动'}</Button> : <Button disabled={!team || !agent} onClick={copySummary}>{copied ? '上下文已复制' : '复制上下文'}</Button>}</>}>
    <div className="space-y-5">
      {state.teams.length > 1 && <label className="block text-sm font-medium">1. Team<select className="mt-2 h-10 w-full px-3" value={teamId} onChange={(event) => selectTeam(event.target.value)}>{state.teams.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      {state.teams.length === 1 && <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm"><span className="text-muted-foreground">Team</span><b className="ml-3">{team?.name}</b></div>}
      <label className="block text-sm font-medium">{state.teams.length > 1 ? '2.' : '1.'} Agent<select className="mt-2 h-10 w-full px-3" value={agentId} onChange={(event) => setAgentId(event.target.value)}><option value="">选择已启用 Agent</option>{agents.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{!agents.length && <span className="mt-2 block text-xs text-warning">此 Team 暂无已启用 Agent。</span>}</label>
      {!contextExpanded && <Button type="button" variant="outline" className="justify-self-start" onClick={() => setContextExpanded(true)}><Plus size={15} aria-hidden="true" />添加需求</Button>}
      {contextExpanded && <>
        <div><label htmlFor="client-launch-task" className="block text-sm font-medium">需求（可选）</label><select id="client-launch-task" className="mt-2 h-10 w-full px-3" value={taskId} onChange={(event) => setTaskId(event.target.value)}><option value="">不附加需求</option>{tasks.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select><span className="mt-1 block text-xs text-muted-foreground">需求只作为上下文，不会在 Bandi 中创建或跟踪执行进度。</span></div>
        <section className="rounded-lg border border-border bg-muted/30 p-4" aria-labelledby="launch-context-summary"><div className="flex items-center justify-between gap-3"><h3 id="launch-context-summary" className="text-sm font-semibold">本次上下文</h3><Button variant="ghost" size="sm" disabled={!team || !agent} onClick={copySummary}>{copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}{copied ? '已复制' : '复制'}</Button></div><pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs leading-6 text-muted-foreground">{summary}</pre></section>
      </>}
      <div className="flex gap-2 rounded-md bg-muted p-3 text-sm leading-6 text-muted-foreground"><Info size={18} className="mt-0.5 shrink-0" aria-hidden="true" /><span>Bandi 只把所选长期上下文交给固定工具入口；不会授予更多权限，也不会跟踪工具中的会话、任务或输出。</span></div>
      {capability && <details className="rounded-md border border-border p-3 text-sm"><summary className="cursor-pointer font-medium">技术详情</summary><p className="mt-2 text-xs text-muted-foreground">{capability.reason}</p>{capability.remediation.map((item) => <p key={item} className="mt-1 text-xs text-muted-foreground">{item}</p>)}</details>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  </AppDialog>
}
