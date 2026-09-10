import { Button } from './ui/button'

export type UsageGuideTopic = 'quick-start' | 'teams' | 'agent-config' | 'assets' | 'handoff' | 'recovery'

type GuideTopic = {
  id: UsageGuideTopic
  navLabel: string
  title: string
  summary: string
  points: readonly string[]
  actions: readonly { label: string; to: string }[]
}

export const usageGuideTopics: readonly GuideTopic[] = [
  {
    id: 'quick-start',
    navLabel: '快速开始',
    title: '开始管理长期 Agent',
    summary: '新建或导入 Agent，再按职责调整长期配置。每个 Agent 都有独立的受管配置、长期记忆和版本。',
    points: ['Agent 默认属于当前 Team。', '导入后编辑 Bandi 受管副本，不写回导入来源。', '普通配置直接保存，需要时再查看来源、历史或差异。'],
    actions: [{ label: '新建 Agent', to: '/agents/new' }, { label: '导入 Agent', to: '/agents/new?mode=import' }],
  },
  {
    id: 'teams',
    navLabel: '管理 Team',
    title: '用 Team 组织长期 Agent',
    summary: 'Team 表达 Agent 的稳定归属，不表示当前任务中的参与或协作关系。',
    points: ['每个 Agent 必须且只能属于一个 Team。', 'Personal Team 始终存在且不可删除。', 'Team 归属不会自动授予 Agent 权限。'],
    actions: [{ label: '管理 Team', to: '/organization' }],
  },
  {
    id: 'agent-config',
    navLabel: '配置与记忆',
    title: '维护 Agent 配置与长期记忆',
    summary: '按职责维护身份、Instructions、Rules、Skills、MCP、权限、SOP 和长期记忆。',
    points: ['长期记忆只保存这个 Agent 需要长期保留的信息。', '聊天、Todo、工具输出和当前任务过程不会自动进入长期记忆。', '外部修改发生时，Bandi 不会自动覆盖当前版本。'],
    actions: [{ label: '查看 Agent', to: '/agents' }],
  },
  {
    id: 'assets',
    navLabel: '配置资产',
    title: '管理可复用配置资产',
    summary: '查看 Bandi 自有或明确纳管的 Rules、Skills、MCP、SOP 等长期配置及其引用关系。',
    points: ['Team 内共享资产必须由 Agent 显式引用。', '来源、共享影响和诊断只在需要时展开。', '保存配置资产不表示已在外部工具中安装、加载或运行。'],
    actions: [{ label: '查看配置资产', to: '/assets' }],
  },
  {
    id: 'handoff',
    navLabel: '需求与 AI 工具',
    title: '整理需求并在外部工具中继续',
    summary: '按需整理目标、背景、约束和期望产出，再选择 Team、Agent 与可选需求启动外部工具。',
    points: ['需求只属于一个 Team，不关联 Agent，也不记录执行状态。', 'Bandi 只提交受控启动请求；请求已提交不表示工具已完成初始化或登录。', '任务执行、参与 Agent 选择、权限批准、日志和验收都在所选外部工具中完成。'],
    actions: [{ label: '查看需求池', to: '/tasks' }, { label: '选择 AI 工具', to: '/tools' }],
  },
  {
    id: 'recovery',
    navLabel: '保存与恢复',
    title: '处理保存、备份与恢复',
    summary: '通过版本、外部变化保护和本地快照维护 Bandi 受管配置。',
    points: ['配置变化时先比较当前版本和你的修改。', '备份与恢复是独立设置，不代替普通保存。', '删除和重置只处理 Bandi 自有数据，不处理任意用户目录。'],
    actions: [{ label: '查看备份与恢复', to: '/settings?section=recovery' }],
  },
]

export function getUsageGuideTopic(id: UsageGuideTopic): GuideTopic {
  return usageGuideTopics.find((topic) => topic.id === id) ?? usageGuideTopics[0]
}

export function UsageGuideTopicContent({ topic, onNavigate }: { topic: UsageGuideTopic; onNavigate: (to: string) => void }) {
  const content = getUsageGuideTopic(topic)
  return <section aria-labelledby={`guide-topic-${content.id}`}>
    <div className="label">当前主题</div>
    <h2 id={`guide-topic-${content.id}`} className="mt-3 text-xl font-semibold tracking-tight">{content.title}</h2>
    <p className="mt-2 text-sm leading-7 text-muted-foreground">{content.summary}</p>
    <ol className="mt-6 divide-y divide-border border-y border-border" aria-label={`${content.title}要点`}>
      {content.points.map((point, index) => <li key={point} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-4 py-4 text-sm leading-6">
        <span className="font-mono text-xs font-semibold text-primary">{String(index + 1).padStart(2, '0')}</span>
        <span>{point}</span>
      </li>)}
    </ol>
    <div className="mt-6 flex flex-wrap gap-2">
      {content.actions.map((action) => <Button key={action.to} variant="outline" onClick={() => onNavigate(action.to)}>{action.label}</Button>)}
    </div>
    <p className="mt-6 rounded-lg bg-muted px-4 py-3 text-xs leading-6 text-muted-foreground">使用指南只提供说明和页面入口，不会修改配置、首次使用状态或本机数据。</p>
  </section>
}
