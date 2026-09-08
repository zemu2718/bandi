import { describe, expect, it } from 'vitest'
import { getFilesForAgentSection, agentFilePreview, resolveAgentConfigRoute } from '../agent-config-projection'
import { initialAgents, initialAssets, initialMemorySpaces } from '../domain'

const agent = initialAgents.find((item) => item.id === 'zhouce')!
const context = { assets: initialAssets, memorySpaces: initialMemorySpaces }

describe('Agent 配置文件投影', () => {
  it('缺省 URL 进入管理概览且不需要规范化', () => {
    const route = resolveAgentConfigRoute(agent, new URLSearchParams())
    expect(route.section).toBe('overview')
    expect(route.path).toBeUndefined()
    expect(route.canonicalParams.toString()).toBe('')
    expect(route.needsReplace).toBe(false)
  })

  it('已规范的 AgentPackage URL 再次解析保持稳定', () => {
    const first = resolveAgentConfigRoute(agent, new URLSearchParams('tab=package'))
    const second = resolveAgentConfigRoute(agent, first.canonicalParams)
    expect(second.canonicalParams.toString()).toBe(first.canonicalParams.toString())
    expect(second.needsReplace).toBe(false)
  })

  it('结构化预览随当前内存事实更新', () => {
    const changed = { ...agent, instructions: '新的演示正文' }
    expect(agentFilePreview(changed, context, 'instructions.md')?.fields[0].value).toBe('新的演示正文')
  })

  it('上下文预览只展示长期策略与输出格式引用', () => {
    const preview = agentFilePreview(agent, context, 'config/context.yaml')!
    expect(preview.fields.map((field) => field.label)).toEqual(['规划上下文窗口', '压缩策略', '消息保护', '输出格式', '输出参数'])
    expect(preview.fields[0].value).toBe('200,000 Token')
    expect(preview.notice).toContain('尚未应用')
    expect(preview.notice).toContain('不包含当前会话')
  })

  it('AgentPackage 包含全部已登记文件', () => {
    expect(getFilesForAgentSection(agent, 'package').map((item) => item.file.path)).toEqual(
      expect.arrayContaining(['agent.yaml', 'instructions.md']),
    )
  })

  it('agent.yaml 只归属概览和身份，编排文件归属唯一协作入口', () => {
    expect(getFilesForAgentSection(agent, 'permissions').map((item) => item.file.path)).not.toContain('agent.yaml')
    expect(getFilesForAgentSection(agent, 'sop').map((item) => item.file.path)).not.toContain('agent.yaml')
    expect(getFilesForAgentSection(agent, 'collaboration').map((item) => item.file.path)).toContain('config/orchestration.yaml')
  })

  it('AgentPackage 无路径时选择默认文件并规范 URL', () => {
    const route = resolveAgentConfigRoute(agent, new URLSearchParams('tab=package'))
    expect(route.section).toBe('package')
    expect(route.path).toBe('agent.yaml')
    expect(route.view).toBe('preview')
    expect(route.canonicalParams.toString()).toBe('tab=package&path=agent.yaml&view=preview')
  })

  it('AgentPackage 保留源码深链', () => {
    const route = resolveAgentConfigRoute(agent, new URLSearchParams('tab=package&path=config/rules.yaml&view=source'))
    expect(route.section).toBe('package')
    expect(route.path).toBe('config/rules.yaml')
    expect(route.view).toBe('source')
    expect(route.needsReplace).toBe(false)
  })

  it('兼容旧 files 深链并规范到 AgentPackage', () => {
    const route = resolveAgentConfigRoute(agent, new URLSearchParams('tab=files&path=config/rules.yaml'))
    expect(route.section).toBe('package')
    expect(route.path).toBe('config/rules.yaml')
    expect(route.canonicalParams.toString()).toBe('tab=package&path=config%2Frules.yaml&view=preview')
    expect(route.needsReplace).toBe(true)
  })

  it('非法路径不会回退冒充其他文件', () => {
    const route = resolveAgentConfigRoute(agent, new URLSearchParams('tab=instructions&path=../secret&view=source'))
    expect(route.path).toBeUndefined()
    expect(route.section).toBe('instructions')
    expect(route.notice).toContain('文件不存在或路径无效')
    expect(route.canonicalParams.toString()).toBe('tab=instructions')
  })

  it('AgentPackage 不存在路径返回目录模式且不冒充默认文件', () => {
    const route = resolveAgentConfigRoute(agent, new URLSearchParams('tab=package&path=missing.yaml&view=source'))
    expect(route.section).toBe('package')
    expect(route.path).toBeUndefined()
    expect(route.notice).toContain('文件不存在或路径无效')
    expect(route.canonicalParams.toString()).toBe('tab=package')
  })
})
