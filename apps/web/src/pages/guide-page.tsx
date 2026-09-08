import { ArrowLeft, Plus, Upload } from 'lucide-react'
import { Link } from 'react-router-dom'
import { MockBoundaryNote, PageHeader } from '../components/app/page'
import { Button } from '../components/ui/button'
import { useApp } from '../state'

const guideSteps = [
  ['01', '导入或创建 Agent', '建立独立、稳定的受管配置'],
  ['02', '按需创建任务简报', '补充目标、背景、约束和期望产出，不影响 Agent 使用'],
  ['03', '选择工具并继续工作', '可选关联上下文，任务执行仍在 CLI 中完成'],
] as const

export function GuidePage() {
  const { state } = useApp()
  return <>
    <PageHeader title="使用引导" description="重新了解 Bandi 的核心流程；现有 Agent、任务简报、记忆和设置不会改变。" backTo="/settings?section=recovery" />
    <section className="panel overflow-hidden">
      <div className="grid gap-8 p-6 sm:p-10 lg:grid-cols-[1.1fr_.9fr]">
        <div>
          <div className="label">引导回顾</div>
          <h1 className="mt-3 max-w-xl text-3xl font-semibold tracking-tight">从长期配置回到 Claude Code</h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground">Bandi 用于管理多个长期 Agent 及其配置资产。新建或导入 Agent 后，可按需附加任务简报，再回到你自己的 Claude Code 完成任务。</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button asChild><Link to="/agents/new"><Plus size={16} aria-hidden="true" />新建 Agent</Link></Button>
            <Button asChild variant="outline"><Link to="/agents/new?mode=import"><Upload size={16} aria-hidden="true" />导入 Agent</Link></Button>
          </div>
          <Button asChild variant="ghost" className="mt-4"><Link to="/"><ArrowLeft size={16} aria-hidden="true" />返回配置状态</Link></Button>
        </div>
        <ol className="space-y-3" aria-label="Bandi 使用步骤">
          {guideSteps.map(([number, title, text]) => <li key={number} className="flex gap-4 rounded-lg border border-border p-4"><span className="font-mono text-xs text-muted-foreground">{number}</span><span><b className="block text-sm">{title}</b><small className="mt-1 block text-muted-foreground">{text}</small></span></li>)}
        </ol>
      </div>
      <MockBoundaryNote>{state.runtime === 'desktop' ? '这是只读引导回顾，不会重置首次使用状态，也不会删除、移动或修改任何本机数据。' : '浏览器演示不会读取或写入本机文件；此页面也不会改变当前演示数据。'}</MockBoundaryNote>
    </section>
  </>
}
