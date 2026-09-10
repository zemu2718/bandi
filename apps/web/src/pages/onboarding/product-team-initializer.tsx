import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ErrorNotice, errorFromCause, type UserFacingError } from '../../components/app/error-notice'
import { Button } from '../../components/ui/button'
import { AppDialog } from '../../components/ui/dialog'
import type { TeamDto } from '../../contracts'
import {
  allocateAgentId,
  commitManagedAgentCreation,
  generateEntityId,
  isDesktopRuntime,
  saveTeamV4,
} from '../../desktop-bridge'
import { useApp } from '../../state'
import { agentTemplates, createAgentFromTemplate, createAgentPackageFiles } from '../agents/agent-creation'

const presetIds = ['product', 'design', 'engineering', 'testing'] as const
const presets = presetIds.map((id) => agentTemplates.find((item) => item.id === id)!)

export function ProductTeamInitializer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { dispatch } = useApp()
  const navigate = useNavigate()
  const [saving, setSaving] = useState(false)
  const [completed, setCompleted] = useState<string[]>([])
  const [error, setError] = useState<UserFacingError>()
  const desktop = isDesktopRuntime()

  const initialize = async () => {
    if (saving) return
    setSaving(true)
    setError(undefined)
    setCompleted([])
    const successful: string[] = []
    try {
      const teamId = desktop ? await generateEntityId('team', '产品研发 Team') : `team-${crypto.randomUUID()}`
      const team: TeamDto = {
        id: teamId,
        name: '产品研发 Team',
        mission: '协同完成产品定义、体验设计、软件研发与质量验证。',
        boundary: '只管理长期配置；任务执行、协作与验收在外部 AI 编程工具中完成。',
        memberAgentIds: [],
        sharedAssetIds: [],
      }
      const savedTeam = desktop ? await saveTeamV4(team) : team
      if (desktop) dispatch({ type: 'SYNC_PERSISTED_TEAMS', teams: [savedTeam] })
      else dispatch({ type: 'CREATE_TEAM', team: savedTeam })
      dispatch({ type: 'SELECT_TEAM', teamId })
      successful.push('产品研发 Team')
      setCompleted([...successful])

      for (const template of presets) {
        const requestId = `initialize-${template.id}-${crypto.randomUUID()}`
        const agentId = desktop ? await allocateAgentId(requestId) : `agent-${crypto.randomUUID()}`
        const agent = createAgentFromTemplate(agentId, teamId, template, `${template.name} Agent`, desktop)
        if (desktop) {
          const result = await commitManagedAgentCreation(requestId, agent, createAgentPackageFiles(agent), undefined, teamId)
          dispatch({ type: 'SYNC_AGENT_RECOVERY', operation: result.operation, agent: result.agent })
          if (result.operation.status !== 'completed' || !result.agent) {
            throw new Error(result.operation.safeReason ?? `${template.name} Agent 配置尚未完整保存`)
          }
          dispatch({ type: 'UPSERT_MANAGED_AGENT', agent: result.agent, message: `${template.name} Agent 已创建` })
        } else {
          dispatch({ type: 'CREATE_AGENT', agent })
        }
        successful.push(`${template.name} Agent`)
        setCompleted([...successful])
      }

      dispatch({ type: 'COMPLETE_ONBOARDING' })
      dispatch({
        type: 'SHOW_NOTICE',
        notice: desktop
          ? { tone: 'success', title: '产品研发团队已创建', description: '4 个长期 Agent 已创建，初始权限均未授予。' }
          : { tone: 'success', title: '产品研发团队已添加', description: '仅保存在当前页面；未写入本机配置。' },
      })
      onOpenChange(false)
      navigate('/agents')
    } catch (cause) {
      setError(errorFromCause(
        cause,
        '创建未完成',
        successful.length
          ? `已保留：${successful.join('、')}。后续项目尚未创建，请处理待恢复配置或从“添加 Agent”继续。`
          : 'Team 尚未创建。请检查本地服务后重试。',
      ))
    } finally {
      setSaving(false)
    }
  }

  return <AppDialog
    open={open}
    onOpenChange={(nextOpen) => { if (!saving) onOpenChange(nextOpen) }}
    title="创建产品研发团队"
    description="将创建 1 个 Team，并依次添加 4 个 Agent。"
    size="lg"
    dismissible={!saving}
    footer={<><Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>取消</Button><Button disabled={saving} aria-busy={saving} onClick={() => void initialize()}>{saving ? '正在创建…' : '创建团队和 Agent'}</Button></>}
  >
    <div className="space-y-5">
      <section className="rounded-lg border border-border p-4">
        <div className="label">1 个 Team</div>
        <h3 className="mt-2 font-semibold">产品研发 Team</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">用于组织从产品定义到质量验证的长期 Agent 配置。</p>
      </section>
      <div>
        <div className="label mb-3">4 个 Agent</div>
        <ul className="grid gap-3 sm:grid-cols-2" aria-label="将创建的 Agent">
        {presets.map((template) => <li key={template.id} className="rounded-lg border border-border p-4"><b className="text-sm">{template.name} Agent</b><p className="mt-1 text-xs leading-5 text-muted-foreground">{template.mission}</p></li>)}
        </ul>
      </div>
      <div className="rounded-lg bg-muted/60 p-4 text-sm leading-6 text-muted-foreground">所有 Agent 初始均不授予文件、命令、网络或委派权限，也不会自动引用 Team 共享资产。之后可逐个调整长期配置。</div>
      {completed.length > 0 && saving && <p className="text-sm" aria-live="polite">已完成：{completed.join('、')}</p>}
      {error && <ErrorNotice error={error} />}
    </div>
  </AppDialog>
}
