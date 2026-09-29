// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UsageGuideTopicContent, usageGuideTopics } from '../components/usage-guide'

describe('使用指南内容', () => {
  it('使用唯一的六主题内容源并提供步骤和页面入口', () => {
    expect(usageGuideTopics).toHaveLength(6)
    expect(new Set(usageGuideTopics.map((topic) => topic.id)).size).toBe(6)
    expect(usageGuideTopics.every((topic) => topic.steps.length > 0 && topic.actions.length > 0 && topic.actions.every((action) => action.to.startsWith('/')))).toBe(true)
  })

  it('用四个步骤引导开始使用，并区分新建和导入操作', () => {
    const onNavigate = vi.fn()
    render(<UsageGuideTopicContent topic="quick-start" onNavigate={onNavigate} />)

    expect(screen.getByRole('heading', { level: 2, name: '从一个 Agent 开始' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
    expect(screen.getAllByRole('listitem').map((item) => item.querySelector('strong')?.textContent)).toEqual([
      '确认 Team',
      '新建或导入 Agent',
      '完善长期配置',
      '在 AI 工具中使用',
    ])
    expect(screen.queryByText('当前主题')).not.toBeInTheDocument()
    expect(screen.queryByText(/不会修改配置、首次使用状态或本机数据/)).not.toBeInTheDocument()

    const createButton = screen.getByRole('button', { name: '新建 Agent' })
    const importButton = screen.getByRole('button', { name: '导入已有 Agent' })
    expect(createButton).toHaveClass('bg-foreground', 'text-background')
    expect(importButton).toHaveClass('border')
    fireEvent.click(createButton)
    fireEvent.click(importButton)
    expect(onNavigate).toHaveBeenNthCalledWith(1, '/agents/new')
    expect(onNavigate).toHaveBeenNthCalledWith(2, '/agents/new?mode=import')
  })

  it('明确任务在外部 AI 工具中完成并打开所选页面', () => {
    const onNavigate = vi.fn()
    render(<UsageGuideTopicContent topic="handoff" onNavigate={onNavigate} />)

    expect(screen.getByRole('heading', { level: 2, name: '把长期上下文带到 AI 工具' })).toBeInTheDocument()
    expect(screen.getByText(/Bandi 只提交启动请求/)).toBeInTheDocument()
    expect(screen.getByText(/任务执行、权限、日志和验收都在所选工具中完成/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '选择 AI 工具' }))
    expect(onNavigate).toHaveBeenCalledWith('/tools')
  })
})
