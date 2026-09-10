// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentsPage, getAgentConfigIssueTarget } from '../pages/agents/agents-page'
import { AppProvider, initialState } from '../state'
import type { FullAgent } from '../domain'

function renderAgents(state = initialState, initialEntry = '/agents') {
  const router = createMemoryRouter([{ path: '/agents', element: <AppProvider initialState={state}><AgentsPage /></AppProvider> }], { initialEntries: [initialEntry] })
  return render(<RouterProvider router={router} />)
}

function teamAgents() {
  return initialState.agents.filter((agent) => agent.teamId === initialState.currentTeamId)
}

function repeatAgents(count: number): FullAgent[] {
  const source = teamAgents()[0]
  return Array.from({ length: count }, (_, index) => ({ ...source, id: `agent-${index}`, name: `Agent ${index}`, status: 'active' }))
}

afterEach(cleanup)

describe('Agents 列表入口', () => {
  it('新建和导入 Agent 使用菜单入口', () => {
    renderAgents()
    const trigger = screen.getByRole('button', { name: '添加 Agent' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(screen.queryByRole('dialog', { name: '新建 Agent' })).not.toBeInTheDocument()
  })

  it('首次空状态隐藏筛选并就近提供创建与导入入口', () => {
    renderAgents({ ...initialState, agents: [], agentDiagnostics: [] })
    expect(screen.getByText('当前 Team 还没有 Agent')).toBeInTheDocument()
    expect(screen.getByText('添加一个长期 Agent，或导入已有配置。')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: '添加 Agent' })).toHaveLength(1)
    expect(screen.getAllByRole('link', { name: '导入已有 Agent' })).toHaveLength(1)
    expect(screen.queryByRole('textbox', { name: '搜索 Agent' })).not.toBeInTheDocument()
  })

  it('少量 Agent 默认隐藏搜索和筛选', () => {
    renderAgents()
    expect(screen.queryByRole('textbox', { name: '搜索 Agent' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '筛选' })).not.toBeInTheDocument()
    expect(screen.queryByText(/显示 .* 个/)).not.toBeInTheDocument()
  })

  it('中等数量只显示搜索，大量 Agent 再显示筛选入口', () => {
    const medium = renderAgents({ ...initialState, agents: repeatAgents(6) })
    expect(screen.getByRole('textbox', { name: '搜索 Agent' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '筛选' })).not.toBeInTheDocument()
    medium.unmount()

    renderAgents({ ...initialState, agents: repeatAgents(16) })
    expect(screen.getByRole('button', { name: '筛选' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '职能' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '筛选' }))
    expect(screen.getByRole('combobox', { name: '职能' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '配置状态' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '使用状态' })).toBeInTheDocument()
  })

  it('筛选无结果时只提供一处清除操作和一处结果数', () => {
    renderAgents(initialState, '/agents?q=不存在的Agent')
    expect(screen.getByText('没有匹配的 Agent')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '清除筛选' })).toHaveLength(1)
    expect(screen.getByText('找到 0 个 Agent')).toBeInTheDocument()
  })

  it('Agent 名称固定进入概览，异常状态单独进入处理位置', () => {
    renderAgents()
    expect(screen.getByRole('link', { name: '查看 周策 Agent 详情' })).toHaveAttribute('href', '/agents/zhouce')
    expect(screen.getByRole('link', { name: '处理 周策 的外部有修改' })).toHaveAttribute('href', '/agents/zhouce?tab=package&path=instructions.md&view=preview')
    expect(screen.getAllByText('配置正常').every((status) => status.closest('a') === null)).toBe(true)
  })

  it('外部变化缺少对应文件时安全降级到 AgentPackage', () => {
    const agent = initialState.agents.find((item) => item.id === 'zhouce')!
    expect(getAgentConfigIssueTarget({ ...agent, files: agent.files.map((file) => ({ ...file, status: '已索引' })) }, 'warning', '外部变化')).toBe('/agents/zhouce?tab=package')
  })

  it('只显示当前 Team 的 Agent', () => {
    const other = { ...teamAgents()[0], id: 'other-agent', name: '其他 Team Agent', teamId: 'team-other' }
    renderAgents({ ...initialState, teams: [...initialState.teams, { ...initialState.teams[0], id: 'team-other', name: '其他 Team' }], agents: [...initialState.agents, other] })
    expect(screen.queryByRole('link', { name: /查看 其他 Team Agent/ })).not.toBeInTheDocument()
  })

  it('已归档 Agent 与当前列表分区显示', () => {
    renderAgents()
    const archived = screen.getByText(/已归档 \d+/).closest('details')!
    expect(archived).not.toHaveAttribute('open')
    expect(within(archived).getByRole('link', { name: '查看 宋研 Agent 详情' })).toBeInTheDocument()
  })

  it('归档筛选深链直接打开归档区域', () => {
    renderAgents(initialState, '/agents?lifecycle=archived')
    expect(screen.getByText(/已归档 \d+/).closest('details')).toHaveAttribute('open')
    expect(screen.getByRole('combobox', { name: '使用状态' })).toHaveValue('archived')
  })

  it('更多操作按生命周期提供正确动作', () => {
    renderAgents()
    fireEvent.keyDown(screen.getByRole('button', { name: '更多操作：知衡' }), {
      key: 'Enter',
    })
    expect(screen.getByRole('menuitem', { name: '停用 Agent' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '归档 Agent' })).toBeInTheDocument()
  })

  it('Web 生命周期操作经过确认后更新状态', () => {
    renderAgents()
    fireEvent.keyDown(screen.getByRole('button', { name: '更多操作：知衡' }), {
      key: 'Enter',
    })
    fireEvent.click(screen.getByRole('menuitem', { name: '停用 Agent' }))
    expect(screen.getByRole('dialog', { name: '停用 知衡' })).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('dialog', { name: '停用 知衡' })).getByRole('button', { name: '停用 Agent' }))
    expect(screen.getByText('已停用')).toBeInTheDocument()
  })
})
