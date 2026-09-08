// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentsPage, getAgentListTarget } from '../pages/agents/agents-page'
import { AppProvider, initialState } from '../state'

function renderAgents(state = initialState) {
  const router = createMemoryRouter([{
    path: '/agents',
    element: <AppProvider initialState={state}><AgentsPage /></AppProvider>,
  }], { initialEntries: ['/agents'] })
  return render(<RouterProvider router={router} />)
}

afterEach(cleanup)

describe('Agents 列表入口', () => {
  it('新建和导入 Agent 使用各自的页面入口', () => {
    renderAgents()

    expect(screen.getByRole('link', { name: '新建 Agent' })).toHaveAttribute('href', '/agents/new')
    expect(screen.getByRole('link', { name: '导入 Agent' })).toHaveAttribute('href', '/agents/new?mode=import')
    expect(screen.queryByRole('link', { name: '仅登记外部引用' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '新建 Agent' })).not.toBeInTheDocument()
  })

  it('表格滚动区域支持键盘聚焦', () => {
    renderAgents()

    expect(screen.getByRole('region', { name: 'Agent 列表，可横向滚动' })).toHaveAttribute('tabindex', '0')
  })

  it('每个 Agent 只提供一个统一详情入口', () => {
    renderAgents()

    const links = screen.getAllByRole('link', { name: /查看 .* Agent 详情/ })
    expect(links).toHaveLength(initialState.agents.filter((agent) => agent.teamId === initialState.currentTeamId).length)
    expect(links.every((link) => !link.classList.contains('absolute'))).toBe(true)
    expect(screen.queryByRole('link', { name: /编辑基本信息|Agent 配置/ })).not.toBeInTheDocument()
  })

  it('按配置状态生成最相关的详情落点', () => {
    renderAgents()

    expect(screen.getByRole('link', { name: '查看 知衡 Agent 详情' })).toHaveAttribute('href', '/agents/zhiheng')
    expect(screen.getByRole('link', { name: '查看 周策 Agent 详情，外部变化' })).toHaveAttribute('href', '/agents/zhouce?tab=package&path=instructions.md&view=preview')
    expect(screen.getByRole('link', { name: '查看 林序 Agent 详情' })).toHaveAttribute('href', '/agents/linxu')
  })

  it('只显示当前 Team 的 Agent', () => {
    const other = { ...initialState.agents[0], id: 'other-agent', name: '其他 Team Agent', teamId: 'team-other' }
    renderAgents({
      ...initialState,
      teams: [...initialState.teams, { ...initialState.teams[0], id: 'team-other', name: '其他 Team' }],
      agents: [...initialState.agents, other],
    })

    expect(screen.queryByRole('link', { name: /查看 其他 Team Agent/ })).not.toBeInTheDocument()
    const count = initialState.agents.filter((agent) => agent.teamId === initialState.currentTeamId).length
    expect(screen.getByText(`${count} / ${count} 个 Agent`)).toBeInTheDocument()
  })

  it('外部变化缺少对应文件时安全降级到 AgentPackage', () => {
    const agent = initialState.agents.find((item) => item.id === 'zhouce')!
    expect(getAgentListTarget({
      ...agent,
      files: agent.files.map((file) => ({ ...file, status: '已索引' })),
    })).toBe('/agents/zhouce?tab=package')
  })
})
