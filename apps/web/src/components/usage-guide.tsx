import { Button } from './ui/button'

export type UsageGuideTopic = 'quick-start' | 'teams' | 'agent-config' | 'assets' | 'handoff' | 'recovery'

type GuideStep = {
  title: string
  description: string
}

type GuideTopic = {
  id: UsageGuideTopic
  navLabel: string
  title: string
  summary: string
  steps: readonly GuideStep[]
  actions: readonly { label: string; to: string; primary?: boolean }[]
}

export const usageGuideTopics: readonly GuideTopic[] = [
  {
    id: 'quick-start',
    navLabel: '开始使用',
    title: '从一个 Agent 开始',
    summary: '新建或导入 Agent，并为它维护独立的长期配置、记忆和版本。',
    steps: [
      { title: '确认 Team', description: '每个 Agent 只属于一个 Team；归属不会自动授予权限。' },
      { title: '新建或导入 Agent', description: '新建 Agent，或导入已有配置。导入不会改写来源文件。' },
      { title: '完善长期配置', description: '按需维护 Instructions、Rules、Skills、MCP、权限、SOP 和长期记忆。' },
      { title: '在 AI 工具中使用', description: '选择 Team、Agent 和可选需求后打开外部工具；任务执行、权限、日志和验收都在该工具中完成。' },
    ],
    actions: [{ label: '新建 Agent', to: '/agents/new', primary: true }, { label: '导入已有 Agent', to: '/agents/new?mode=import' }],
  },
  {
    id: 'teams',
    navLabel: 'Team 与 Agent',
    title: '用 Team 组织 Agent',
    summary: 'Team 只表示 Agent 的长期归属，不表示当前任务协作关系。',
    steps: [
      { title: '确认归属', description: '每个 Agent 只属于一个 Team。' },
      { title: '调整 Team', description: '内置的“个人”Team 始终保留，不能删除。' },
      { title: '核对权限', description: 'Team 不会自动授予权限，需要为 Agent 单独配置。' },
    ],
    actions: [{ label: '查看 Team', to: '/organization' }],
  },
  {
    id: 'agent-config',
    navLabel: '长期配置',
    title: '完善 Agent 的长期配置',
    summary: '按职责维护 Agent 的配置、权限和长期记忆。',
    steps: [
      { title: '维护配置', description: '按需编辑 Instructions、Rules、Skills、MCP、权限和 SOP。' },
      { title: '记录长期记忆', description: '只保存跨任务信息；聊天、Todo 和任务过程不会自动写入。' },
      { title: '处理外部变化', description: '先查看来源和差异，Bandi 不会自动覆盖当前版本。' },
    ],
    actions: [{ label: '查看 Agent', to: '/agents' }],
  },
  {
    id: 'assets',
    navLabel: '配置资产',
    title: '复用长期配置资产',
    summary: '集中查看 Bandi 管理的 Rules、Skills、MCP 和 SOP。',
    steps: [
      { title: '查看资产', description: '按类型查看配置、来源和引用关系。' },
      { title: '显式引用', description: '共享资产不会自动应用，需要由 Agent 明确引用。' },
      { title: '核对影响', description: '修改前查看影响范围；保存不表示外部工具已加载该资产。' },
    ],
    actions: [{ label: '查看配置资产', to: '/assets' }],
  },
  {
    id: 'handoff',
    navLabel: '需求池与 AI 工具',
    title: '把长期上下文带到 AI 工具',
    summary: '整理需求，选择 Team、Agent 和可选需求，再提交启动请求。',
    steps: [
      { title: '整理需求', description: '记录目标、背景、约束和期望产出；需求不关联 Agent，也不记录执行状态。' },
      { title: '选择上下文', description: '临时选择 Team、Agent 和可选需求。' },
      { title: '在外部工具中继续', description: 'Bandi 只提交启动请求；任务执行、权限、日志和验收都在所选工具中完成。' },
    ],
    actions: [{ label: '查看需求池', to: '/tasks' }, { label: '选择 AI 工具', to: '/tools', primary: true }],
  },
  {
    id: 'recovery',
    navLabel: '备份与恢复',
    title: '安全保存和恢复配置',
    summary: '通过版本保护和本地快照维护 Bandi 配置。',
    steps: [
      { title: '直接保存', description: '普通配置直接保存；检测到外部变化时，先比较差异。' },
      { title: '查看历史', description: '按需查看来源、历史和差异；恢复会生成新版本。' },
      { title: '按需恢复', description: '备份与恢复不代替普通保存，只处理 Bandi 自有数据。' },
    ],
    actions: [{ label: '查看备份与恢复', to: '/settings?section=recovery' }],
  },
]

export function getUsageGuideTopic(id: UsageGuideTopic): GuideTopic {
  return usageGuideTopics.find((topic) => topic.id === id) ?? usageGuideTopics[0]
}

export function UsageGuideTopicContent({ topic, onNavigate }: { topic: UsageGuideTopic; onNavigate: (to: string) => void }) {
  const content = getUsageGuideTopic(topic)
  return <section className="max-w-2xl" aria-labelledby={`guide-topic-${content.id}`}>
    <h2 id={`guide-topic-${content.id}`} className="text-xl font-semibold tracking-tight">{content.title}</h2>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">{content.summary}</p>
    <ol className="mt-5 space-y-1" aria-label={`${content.title}步骤`}>
      {content.steps.map((step, index) => <li key={step.title} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 rounded-lg px-1 py-3">
        <span className="font-mono text-xs font-semibold leading-6 text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
        <span>
          <strong className="block text-sm font-semibold leading-6">{step.title}</strong>
          <span className="mt-0.5 block text-sm leading-6 text-muted-foreground">{step.description}</span>
        </span>
      </li>)}
    </ol>
    <div className="mt-5 flex flex-wrap gap-2">
      {content.actions.map((action) => <Button key={action.to} className="min-h-11" variant={action.primary ? 'default' : 'outline'} onClick={() => onNavigate(action.to)}>{action.label}</Button>)}
    </div>
  </section>
}
