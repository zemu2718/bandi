// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UsageGuideTopicContent, usageGuideTopics } from '../components/usage-guide'

describe('使用指南内容', () => {
  it('使用唯一的六主题内容源并提供页面入口', () => {
    expect(usageGuideTopics).toHaveLength(6)
    expect(new Set(usageGuideTopics.map((topic) => topic.id)).size).toBe(6)
    expect(usageGuideTopics.every((topic) => topic.actions.length > 0 && topic.actions.every((action) => action.to.startsWith('/')))).toBe(true)
  })

  it('显示当前主题、产品边界并打开所选页面', () => {
    const onNavigate = vi.fn()
    render(<UsageGuideTopicContent topic="handoff" onNavigate={onNavigate} />)

    expect(screen.getByRole('heading', { level: 2, name: '整理需求并在外部工具中继续' })).toBeInTheDocument()
    expect(screen.getByText(/Bandi 只提交受控启动请求/)).toBeInTheDocument()
    expect(screen.getByText(/任务执行、参与 Agent 选择、权限批准、日志和验收/)).toBeInTheDocument()
    expect(screen.getByText(/不会修改配置、首次使用状态或本机数据/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '选择 AI 工具' }))
    expect(onNavigate).toHaveBeenCalledWith('/tools')
  })
})
